// POST /api/lead — публичный приём заявки из квиза.
import { handler, method, readJson, send, clientIp } from '../lib/http.js';
import { validateLead, looksLikeBot } from '../lib/validate.js';
import { acceptLead, checkRateLimit } from '../lib/leads.js';
import { db } from '../lib/supabase.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { ok: false, error: 'Неверный формат данных' }); }

  const bot = looksLikeBot(body);
  if (bot === 'honeypot') return send(res, 200, { ok: true });            // ботам не сообщаем, что их распознали
  if (bot === 'too_fast') return send(res, 400, { ok: false, error: 'Пожалуйста, проверьте ответы и отправьте заявку ещё раз.' });

  const v = validateLead(body);
  if (!v.ok) return send(res, 400, { ok: false, error: v.errors[0], errors: v.errors });

  if (db()) {
    try {
      if (!(await checkRateLimit(clientIp(req)))) return send(res, 429, { ok: false, error: 'Слишком много заявок подряд. Попробуйте через 10 минут или напишите нам в Instagram.' });
    } catch (e) { console.error('[rate]', e.message); }                   // сбой лимита не должен терять заявку
  }

  const r = await acceptLead(v.lead);
  send(res, r.status, r.body);
});
