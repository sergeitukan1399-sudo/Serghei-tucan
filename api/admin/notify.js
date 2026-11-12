// POST /api/admin/notify — повторить уведомление в Telegram: {id} для одной заявки или {all:true} для всех неотправленных.
// Заявка при этом не создаётся заново; уже доставленное уведомление не дублируется.
import { handler, method, send, readJson, httpError } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { notifyLead, retryFailedNotifications } from '../../lib/leads.js';
import { telegramConfigured } from '../../lib/telegram.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const admin = await requireAdmin(req);
  if (!telegramConfigured()) throw httpError(503, 'Telegram не настроен в переменных Vercel');
  const body = await readJson(req);
  if (body.all) return send(res, 200, await retryFailedNotifications(20, admin));
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) throw httpError(400, 'Неверный номер заявки');
  send(res, 200, await notifyLead(body.id, { retry: true, actor: admin }));
});
