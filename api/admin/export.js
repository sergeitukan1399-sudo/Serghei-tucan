// GET /api/admin/export — CSV для Excel (UTF-8 с BOM, разделитель «;»), с учётом фильтров списка.
import { handler, method, query } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { db } from '../../lib/supabase.js';
import { parseListParams, applyFilters, fmtDateTime, fmtDate } from '../../lib/listing.js';
import { STATUSES } from '../../lib/constants.js';

const COLUMNS = [
  ['Номер', l => l.lead_no], ['Дата заявки', l => fmtDateTime(l.created_at)], ['Имя', l => l.client_name],
  ['Телефон', l => l.client_phone], ['Способ связи', l => l.contact_method], ['Праздник', l => l.event_type],
  ['Дата праздника', l => fmtDate(l.event_date) || 'не определена'], ['Место', l => l.event_location], ['Город', l => l.event_city],
  ['Стиль', l => l.event_style], ['Бюджет', l => l.budget_range], ['Комментарий клиента', l => l.comment],
  ['Статус', l => STATUSES[l.status] || l.status], ['Сумма заказа, MDL', l => (l.order_amount == null ? '' : String(l.order_amount).replace('.', ','))],
  ['Дата подтверждения', l => fmtDateTime(l.confirmed_at)], ['Заметки менеджера', l => l.manager_notes], ['Источник', l => l.source],
];

const cell = v => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // защита от формул в Excel
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  await requireAdmin(req);
  const p = parseListParams(query(req));
  const rows = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await applyFilters(db().from('leads').select('*'), p)
      .order(p.sort, { ascending: p.asc, nullsFirst: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const csv = '﻿' + [COLUMNS.map(c => cell(c[0])).join(';'), ...rows.map(l => COLUMNS.map(c => cell(c[1](l))).join(';'))].join('\r\n') + '\r\n';
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Chisinau' }).format(new Date());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="alisa-zayavki-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(csv);
});
