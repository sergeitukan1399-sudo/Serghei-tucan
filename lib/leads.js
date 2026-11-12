// Логика приёма заявок и уведомлений.
// Порядок: проверка → сохранение в Supabase → уведомление в Telegram → ответ клиенту.
// Заявка считается принятой, только если она сохранена хотя бы в одном надёжном месте
// (база или доставленное сообщение в Telegram).

import crypto from 'node:crypto';
import { db, supabaseConfigured } from './supabase.js';
import { sendTelegram, telegramConfigured, leadText } from './telegram.js';
import { phoneDigits } from './validate.js';

const RATE_WINDOW_MIN = 10;
const RATE_MAX = 5;
const DUP_WINDOW_MIN = 10;
const STALE_SENDING_MIN = 5;

export function ipHash(ip) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'alisa';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32);
}

const minutesAgo = (m, now = Date.now()) => new Date(now - m * 60_000).toISOString();

export async function checkRateLimit(ip) {
  const sb = db();
  const h = ipHash(ip);
  const { count, error } = await sb.from('submission_log').select('id', { count: 'exact', head: true })
    .eq('ip_hash', h).gte('created_at', minutesAgo(RATE_WINDOW_MIN));
  if (error) throw error;
  if ((count || 0) >= RATE_MAX) return false;
  await sb.from('submission_log').insert({ ip_hash: h });
  // уборка: журнал храним не дольше суток
  await sb.from('submission_log').delete().lt('created_at', minutesAgo(24 * 60));
  return true;
}

async function findDuplicate(lead) {
  const sb = db();
  const bySub = await sb.from('leads').select('id, lead_no, notify_status').eq('submission_id', lead.submission_id).maybeSingle();
  if (bySub.error) throw bySub.error;
  if (bySub.data) return bySub.data;
  // та же заявка с того же телефона за последние минуты (двойной клик, повтор с другой вкладки)
  const recent = await sb.from('leads').select('id, lead_no, notify_status, client_phone')
    .eq('event_type', lead.event_type).gte('created_at', minutesAgo(DUP_WINDOW_MIN)).limit(50);
  if (recent.error) throw recent.error;
  const d = phoneDigits(lead.client_phone);
  return (recent.data || []).find(r => phoneDigits(r.client_phone) === d) || null;
}

async function logEvent(lead_id, action, old_value, new_value, actor) {
  const { error } = await db().from('lead_events').insert({
    lead_id, action,
    old_value: old_value == null ? null : String(old_value).slice(0, 500),
    new_value: new_value == null ? null : String(new_value).slice(0, 500),
    actor_id: actor?.id || null, actor_email: actor?.email || null,
  });
  if (error) console.error('[lead_events]', error.message);
}
export { logEvent };

// Безопасно «забираем» заявку на отправку уведомления: только одна попытка за раз,
// повтор не создаёт новую заявку и не шлёт дубль, если уведомление уже доставлено.
export async function notifyLead(id, { retry = false, actor = null } = {}) {
  const sb = db();
  const cur = await sb.from('leads').select('*').eq('id', id).maybeSingle();
  if (cur.error) throw cur.error;
  const lead = cur.data;
  if (!lead) return { ok: false, reason: 'not_found' };
  if (lead.notify_status === 'sent') return { ok: true, already: true };
  const staleSending = lead.notify_status === 'sending' && new Date(lead.updated_at) < new Date(minutesAgo(STALE_SENDING_MIN));
  if (lead.notify_status === 'sending' && !staleSending) return { ok: false, reason: 'in_progress' };

  const claim = await sb.from('leads')
    .update({ notify_status: 'sending', notify_attempts: (lead.notify_attempts || 0) + 1 })
    .eq('id', id).eq('notify_status', lead.notify_status).select('id');
  if (claim.error) throw claim.error;
  if (!claim.data || claim.data.length === 0) return { ok: false, reason: 'in_progress' };

  if (retry) await logEvent(id, 'notify_retry', null, `попытка ${(lead.notify_attempts || 0) + 1}`, actor);
  try {
    await sendTelegram(leadText({ ...lead, retry }));
    await sb.from('leads').update({ notify_status: 'sent', notified_at: new Date().toISOString(), notify_error: null }).eq('id', id);
    await logEvent(id, 'notify_sent', null, 'Telegram', actor);
    return { ok: true };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await sb.from('leads').update({ notify_status: 'failed', notify_error: msg }).eq('id', id);
    await logEvent(id, 'notify_failed', null, msg, actor);
    return { ok: false, reason: 'telegram', error: msg };
  }
}

export async function retryFailedNotifications(limit = 3, actor = null) {
  if (!supabaseConfigured() && !db()) return { tried: 0, sent: 0 };
  if (!telegramConfigured()) return { tried: 0, sent: 0, skipped: 'telegram_not_configured' };
  const sb = db();
  const { data, error } = await sb.from('leads').select('id, notify_status, updated_at')
    .in('notify_status', ['failed', 'pending', 'sending']).order('created_at', { ascending: true }).limit(limit * 3);
  if (error) throw error;
  let tried = 0, sent = 0;
  for (const r of data || []) {
    if (tried >= limit) break;
    if (r.notify_status === 'sending' && new Date(r.updated_at) >= new Date(minutesAgo(STALE_SENDING_MIN))) continue;
    tried++;
    const res = await notifyLead(r.id, { retry: true, actor });
    if (res.ok) sent++;
  }
  return { tried, sent };
}

// Основной сценарий приёма заявки
export async function acceptLead(lead) {
  const hasDb = Boolean(db());
  const hasTg = telegramConfigured();
  if (!hasDb && !hasTg) return { status: 503, body: { ok: false, error: 'Приём заявок ещё не настроен.' } };

  if (hasDb) {
    try {
      const dup = await findDuplicate(lead);
      if (dup) return { status: 200, body: { ok: true, lead_no: dup.lead_no, duplicate: true } };

      const ins = await db().from('leads').insert({ ...lead, status: 'new', notify_status: hasTg ? 'pending' : 'failed', notify_error: hasTg ? null : 'Telegram не настроен' })
        .select('id, lead_no').single();
      if (ins.error) {
        if (ins.error.code === '23505') {             // гонка двух одинаковых отправок
          const again = await findDuplicate(lead);
          if (again) return { status: 200, body: { ok: true, lead_no: again.lead_no, duplicate: true } };
        }
        throw ins.error;
      }
      const saved = ins.data;
      await logEvent(saved.id, 'created', null, 'Заявка с сайта', null);

      let notified = false;
      if (hasTg) {
        const n = await notifyLead(saved.id);
        notified = n.ok;
        if (n.ok) {
          // заодно пробуем дослать старые неотправленные уведомления, если такие есть
          try { await retryFailedNotifications(2); } catch (e) { console.error('[retry]', e.message); }
        }
      }
      return { status: 200, body: { ok: true, lead_no: saved.lead_no, notified } };
    } catch (e) {
      console.error('[leads] база недоступна:', e.message || e);
      // база не ответила — пробуем сохранить заявку хотя бы в Telegram
    }
  }

  if (hasTg) {
    try {
      await sendTelegram(leadText({ ...lead, lead_no: '—' }) + (hasDb ? '\n\n⚠ Заявка НЕ сохранилась в базе CRM — внесите её вручную.' : ''));
      return { status: 200, body: { ok: true, stored: 'telegram' } };
    } catch (e) {
      console.error('[leads] telegram:', e.message);
    }
  }
  return { status: 503, body: { ok: false, error: 'Не удалось принять заявку. Попробуйте ещё раз через минуту.' } };
}
