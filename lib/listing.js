// Фильтры списка заявок — общие для таблицы и экспорта.

import { STATUSES, TZ } from './constants.js';
import { zonedMidnight } from './period.js';

const SORTS = { created_at: 'created_at', lead_no: 'lead_no', event_date: 'event_date', order_amount: 'order_amount', client_name: 'client_name', status: 'status' };

export function parseListParams(q) {
  const p = {};
  const s = String(q.q || '').trim().slice(0, 60);
  if (s) p.q = s.replace(/[%,()*\\]/g, ' ').trim();
  if (q.status && (STATUSES[q.status] || q.status === 'active')) p.status = q.status;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (re.test(q.from || '')) { const [y, m, d] = q.from.split('-').map(Number); p.from = zonedMidnight(y, m, d).toISOString(); }
  if (re.test(q.to || '')) { const [y, m, d] = q.to.split('-').map(Number); p.to = zonedMidnight(y, m, d + 1).toISOString(); }
  p.sort = SORTS[q.sort] || 'created_at';
  p.asc = q.dir === 'asc';
  p.page = Math.max(1, Math.min(10_000, parseInt(q.page, 10) || 1));
  p.per = Math.max(10, Math.min(100, parseInt(q.per, 10) || 25));
  return p;
}

export function applyFilters(query, p) {
  let x = query;
  if (p.q) {
    const digits = p.q.replace(/\D/g, '');
    const parts = [`client_name.ilike.%${p.q}%`, `client_phone.ilike.%${p.q}%`];
    if (digits.length >= 3) parts.push(`client_phone_digits.ilike.%${digits}%`);
    if (/^\d{1,9}$/.test(p.q)) parts.push(`lead_no.eq.${p.q}`);
    x = x.or(parts.join(','));
  }
  if (p.status === 'active') x = x.in('status', ['confirmed', 'done']);
  else if (p.status) x = x.eq('status', p.status);
  if (p.from) x = x.gte('created_at', p.from);
  if (p.to) x = x.lt('created_at', p.to);
  return x;
}

export const fmtDateTime = iso => {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
};
export const fmtDate = d => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
