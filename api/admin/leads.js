// GET /api/admin/leads — список заявок с поиском, фильтрами, сортировкой и страницами.
import { handler, method, send, query } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { db } from '../../lib/supabase.js';
import { parseListParams, applyFilters } from '../../lib/listing.js';

const COLS = 'id, lead_no, created_at, client_name, client_phone, contact_method, event_type, event_date, budget_range, status, order_amount, notify_status';

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  await requireAdmin(req);
  const p = parseListParams(query(req));
  const start = (p.page - 1) * p.per;
  let q = applyFilters(db().from('leads').select(COLS, { count: 'exact' }), p)
    .order(p.sort, { ascending: p.asc, nullsFirst: false });
  if (p.sort !== 'created_at') q = q.order('created_at', { ascending: false });
  if (p.sort !== 'lead_no') q = q.order('lead_no', { ascending: p.sort === 'created_at' ? p.asc : false });
  const { data, count, error } = await q.range(start, start + p.per - 1);
  if (error) throw error;
  send(res, 200, { items: data || [], total: count || 0, page: p.page, per: p.per });
});
