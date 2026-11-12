// Ежедневный повтор неотправленных уведомлений (Vercel Cron). Защищён секретом CRON_SECRET.
import { handler, send } from '../../lib/http.js';
import { retryFailedNotifications } from '../../lib/leads.js';

export default handler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, await retryFailedNotifications(20, { id: null, email: 'cron' }));
});
