// Расчёт показателей панели. Определения:
//  • Когорта периода — заявки, созданные в выбранном периоде, с их текущими статусами.
//    Конверсия = действующие заказы когорты (подтверждён + выполнен) / все заявки когорты × 100%.
//    Отменённые заказы в действующие не входят.
//  • Подтверждено в периоде — заказы, у которых дата подтверждения попала в период
//    (независимо от того, когда пришла заявка). Сумма заказов считается по ним.
//  • «Сумма заказов» — сумма согласованных заказов, а не полученная оплата.

import { db } from './supabase.js';
import { ACTIVE_ORDER, CHART_GROUPS, chartGroup, EVENT_TYPES } from './constants.js';
import { monthKey, lastMonths } from './period.js';

const COLS = 'id, created_at, status, order_amount, confirmed_at, cancelled_at, event_type';

export async function fetchAllLeads(cols = COLS, apply = q => q) {
  const sb = db();
  const out = [];
  const page = 1000;
  for (let from = 0; from < 50_000; from += page) {
    const { data, error } = await apply(sb.from('leads').select(cols)).order('created_at', { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

const inRange = (iso, a, b) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= a.getTime() && t < b.getTime(); };
const amount = l => Number(l.order_amount) || 0;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function computeStats(leads, period, now = new Date()) {
  const { from, to } = period;
  const cohort = leads.filter(l => inRange(l.created_at, from, to));
  const cohortOrders = cohort.filter(l => ACTIVE_ORDER.includes(l.status));
  const confirmedInPeriod = leads.filter(l => ACTIVE_ORDER.includes(l.status) && inRange(l.confirmed_at, from, to));
  const cancelledInPeriod = leads.filter(l => l.status === 'cancelled' && inRange(l.cancelled_at, from, to));
  const sum = confirmedInPeriod.reduce((s, l) => s + amount(l), 0);
  const withAmount = confirmedInPeriod.filter(l => Number(l.order_amount) > 0);

  const byType = {};
  for (const t of EVENT_TYPES) byType[t] = { leads: 0, orders: 0 };
  for (const l of cohort) {
    const k = byType[l.event_type] ? l.event_type : 'Другое';
    byType[k].leads++;
    if (ACTIVE_ORDER.includes(l.status)) byType[k].orders++;
  }

  const groups = Object.fromEntries(CHART_GROUPS.map(g => [g, 0]));
  for (const l of cohort) groups[chartGroup(l.event_type)]++;

  const months = lastMonths(12, now);
  const monthly = months.map(m => {
    const ml = leads.filter(l => monthKey(l.created_at) === m);
    const mo = ml.filter(l => ACTIVE_ORDER.includes(l.status)).length;
    const conf = leads.filter(l => ACTIVE_ORDER.includes(l.status) && l.confirmed_at && monthKey(l.confirmed_at) === m);
    return { month: m, leads: ml.length, orders: mo, conversion: pct(mo, ml.length), amount: conf.reduce((s, l) => s + amount(l), 0), confirmed: conf.length };
  });

  return {
    period: { from: from.toISOString(), to: to.toISOString(), label: period.label, preset: period.preset },
    cards: {
      leads: cohort.length,
      cohort_orders: cohortOrders.length,
      conversion: pct(cohortOrders.length, cohort.length),
      orders_sum: sum,
    },
    extra: {
      confirmed_in_period: confirmedInPeriod.length,
      cancelled_in_period: cancelledInPeriod.length,
      avg_order: withAmount.length ? Math.round(withAmount.reduce((s, l) => s + amount(l), 0) / withAmount.length) : null,
      orders_without_amount: confirmedInPeriod.length - withAmount.length,
      awaiting_reply: leads.filter(l => l.status === 'new').length,
      rejected: cohort.filter(l => l.status === 'rejected').length,
      cancelled_from_cohort: cohort.filter(l => l.status === 'cancelled').length,
    },
    by_type: Object.entries(byType).filter(([, v]) => v.leads > 0)
      .map(([type, v]) => ({ type, leads: v.leads, orders: v.orders, conversion: pct(v.orders, v.leads) }))
      .sort((a, b) => b.leads - a.leads),
    popular: CHART_GROUPS.map(g => ({ type: g, leads: groups[g] })),
    monthly,
    total_leads: leads.length,
  };
}
