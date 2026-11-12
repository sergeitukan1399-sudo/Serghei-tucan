// GET /api/admin/lead?id=… — карточка заявки с историей.
// PATCH /api/admin/lead?id=… — смена статуса, суммы заказа, заметок. Каждое изменение пишется в историю.
import { handler, method, send, query, readJson, httpError } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { db } from '../../lib/supabase.js';
import { STATUSES } from '../../lib/constants.js';
import { logEvent } from '../../lib/leads.js';

const UUID = /^[0-9a-f-]{36}$/i;

async function load(id) {
  const sb = db();
  const l = await sb.from('leads').select('*').eq('id', id).maybeSingle();
  if (l.error) throw l.error;
  if (!l.data) throw httpError(404, 'Заявка не найдена');
  const ev = await sb.from('lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: true }).order('id', { ascending: true });
  if (ev.error) throw ev.error;
  const { submission_id, ...lead } = l.data;
  return { lead, events: ev.data || [] };
}

export default handler(async (req, res) => {
  if (!method(req, res, ['GET', 'PATCH'])) return;
  const admin = await requireAdmin(req);
  const id = String(query(req).id || '');
  if (!UUID.test(id)) throw httpError(400, 'Неверный номер заявки');

  if (req.method === 'GET') return send(res, 200, await load(id));

  const body = await readJson(req);
  const { lead: before } = await load(id);
  const patch = {};

  if ('status' in body) {
    if (!STATUSES[body.status]) throw httpError(400, 'Неизвестный статус');
    if (body.status !== before.status) patch.status = body.status;
  }
  if ('order_amount' in body) {
    let a = body.order_amount;
    if (a === '' || a === null) a = null;
    else {
      a = Number(String(a).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(a) || a < 0 || a > 10_000_000) throw httpError(400, 'Сумма заказа должна быть числом от 0 до 10 000 000 MDL');
      a = Math.round(a * 100) / 100;
    }
    if (String(a ?? '') !== String(before.order_amount == null ? '' : Number(before.order_amount))) patch.order_amount = a;
  }
  if ('manager_notes' in body) {
    const n = String(body.manager_notes ?? '').slice(0, 4000).trim() || null;
    if (n !== (before.manager_notes || null)) patch.manager_notes = n;
  }
  if (!Object.keys(patch).length) return send(res, 200, await load(id));

  const { error } = await db().from('leads').update(patch).eq('id', id);
  if (error) throw error;

  if ('status' in patch) await logEvent(id, 'status', before.status, patch.status, admin);
  if ('order_amount' in patch) await logEvent(id, 'amount', before.order_amount, patch.order_amount, admin);
  if ('manager_notes' in patch) await logEvent(id, 'notes', null, patch.manager_notes ? 'заметка обновлена' : 'заметка удалена', admin);

  send(res, 200, await load(id));
});
