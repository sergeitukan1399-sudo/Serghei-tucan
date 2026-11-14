// GET /api/admin/stats?preset=month|today|prev_month|quarter|year|custom&from=&to=
import { handler, method, send, query } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { resolvePeriod } from '../../lib/period.js';
import { fetchAllLeads, computeStats } from '../../lib/stats.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  await requireAdmin(req);
  const period = resolvePeriod(query(req));
  const leads = await fetchAllLeads();
  send(res, 200, computeStats(leads, period));
});
