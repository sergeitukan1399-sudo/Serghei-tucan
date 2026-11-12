// GET /api/admin/me — проверка доступа и состояние интеграций.
import { handler, method, send } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { db } from '../../lib/supabase.js';
import { telegramConfigured } from '../../lib/telegram.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const admin = await requireAdmin(req);
  const { count } = await db().from('leads').select('id', { count: 'exact', head: true }).neq('notify_status', 'sent');
  send(res, 200, { admin, telegram: telegramConfigured(), unsent_notifications: count || 0, cron: Boolean(process.env.CRON_SECRET) });
});
