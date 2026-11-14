// POST /api/telegram — нажатия кнопок статусов под уведомлениями о заявках.
// Telegram присылает сюда callback_query. Проверки:
//   1) заголовок X-Telegram-Bot-Api-Secret-Token совпадает с секретом, выведенным из токена бота;
//   2) кнопка нажата в том самом чате, куда приходят заявки (TELEGRAM_CHAT_ID).
// Ответ всегда 200, иначе Telegram будет повторять запрос.
import { handler, method, send, readJson } from '../lib/http.js';
import { db } from '../lib/supabase.js';
import { STATUSES } from '../lib/constants.js';
import { logEvent } from '../lib/leads.js';
import { telegramConfigured, webhookSecret, tgApi, leadText, leadKeyboard, TG_BUTTONS } from '../lib/telegram.js';

const ALLOWED = new Set(TG_BUTTONS.map(b => b[0]));

async function answer(id, text, alert = false) {
  try { await tgApi('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }); } catch (e) { console.error('[tg answer]', e.message); }
}

export default handler(async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  if (!telegramConfigured()) return send(res, 200, { ok: true });
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== webhookSecret()) return send(res, 401, { error: 'unauthorized' });

  const update = await readJson(req).catch(() => ({}));
  const cq = update && update.callback_query;
  if (!cq || !cq.id) return send(res, 200, { ok: true });

  try {
    if (String(cq.message?.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
      await answer(cq.id, 'Нет доступа');
      return send(res, 200, { ok: true });
    }
    const m = /^s:([0-9a-f-]{36}):([a-z]+)$/i.exec(String(cq.data || ''));
    if (!m || !ALLOWED.has(m[2])) { await answer(cq.id, 'Неизвестная кнопка'); return send(res, 200, { ok: true }); }
    const [, id, status] = m;

    const sb = db();
    const cur = await sb.from('leads').select('*').eq('id', id).maybeSingle();
    if (cur.error) throw cur.error;
    const lead = cur.data;
    if (!lead) { await answer(cq.id, 'Заявка не найдена — возможно, удалена', true); return send(res, 200, { ok: true }); }

    let updated = lead;
    if (lead.status !== status) {
      const up = await sb.from('leads').update({ status }).eq('id', id).select('*').single();
      if (up.error) throw up.error;
      updated = up.data;
      const who = cq.from ? (cq.from.username ? '@' + cq.from.username : [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ')) : '';
      await logEvent(id, 'status', lead.status, status, { id: null, email: ('Telegram ' + who).trim().slice(0, 120) });
    }

    try {
      await tgApi('editMessageText', {
        chat_id: cq.message.chat.id, message_id: cq.message.message_id,
        text: leadText(updated), disable_web_page_preview: true, reply_markup: leadKeyboard(updated),
      });
    } catch (e) {
      if (!/not modified/i.test(e.message)) console.error('[tg edit]', e.message);
    }

    const needAmount = ['confirmed', 'done'].includes(status) && updated.order_amount == null;
    await answer(cq.id, lead.status === status
      ? `Статус уже: ${STATUSES[status]}`
      : `Статус: ${STATUSES[status]}${needAmount ? '. Укажите сумму заказа в панели.' : ''}`, needAmount && lead.status !== status);
  } catch (e) {
    console.error('[telegram webhook]', e);
    await answer(cq.id, 'Не удалось сохранить. Попробуйте ещё раз или откройте панель.', true);
  }
  send(res, 200, { ok: true });
});
