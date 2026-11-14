// Периоды считаются по календарю Кишинёва, а в базу уходят границы в UTC.

import { TZ } from './constants.js';

function parts(date, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = Object.fromEntries(f.formatToParts(date).map(p => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

function offsetMs(date, tz = TZ) {
  const p = parts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

// Полночь указанного дня по Кишинёву → момент в UTC
export function zonedMidnight(y, m, d, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);   // поправка на переход летнего времени
  return new Date(t);
}

export function localDay(date, tz = TZ) {
  const p = parts(date, tz);
  return { y: p.y, m: p.m, d: p.d };
}

export function monthKey(date, tz = TZ) {
  const p = parts(new Date(date), tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

const addMonths = (y, m, k) => {
  const t = y * 12 + (m - 1) + k;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};

// preset: today | month | prev_month | quarter | year | custom (from/to — YYYY-MM-DD включительно)
export function resolvePeriod({ preset = 'month', from, to } = {}, now = new Date()) {
  const t = localDay(now);
  let a, b, label;
  switch (preset) {
    case 'today':
      a = zonedMidnight(t.y, t.m, t.d); b = zonedMidnight(t.y, t.m, t.d + 1); label = 'Сегодня'; break;
    case 'prev_month': {
      const p = addMonths(t.y, t.m, -1);
      a = zonedMidnight(p.y, p.m, 1); b = zonedMidnight(t.y, t.m, 1); label = 'Прошлый месяц'; break;
    }
    case 'quarter': {
      const qm = Math.floor((t.m - 1) / 3) * 3 + 1; const n = addMonths(t.y, qm, 3);
      a = zonedMidnight(t.y, qm, 1); b = zonedMidnight(n.y, n.m, 1); label = 'Этот квартал'; break;
    }
    case 'year':
      a = zonedMidnight(t.y, 1, 1); b = zonedMidnight(t.y + 1, 1, 1); label = 'Этот год'; break;
    case 'custom': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(from || '') || !re.test(to || '')) throw Object.assign(new Error('Укажите даты периода'), { status: 400, publicMessage: 'Укажите даты периода' });
      const [fy, fm, fd] = from.split('-').map(Number); const [ty, tm, td] = to.split('-').map(Number);
      a = zonedMidnight(fy, fm, fd); b = zonedMidnight(ty, tm, td + 1);
      if (b <= a) throw Object.assign(new Error('bad range'), { status: 400, publicMessage: 'Дата «по» раньше даты «с»' });
      label = `${from.split('-').reverse().join('.')} — ${to.split('-').reverse().join('.')}`; break;
    }
    case 'month':
    default: {
      const n = addMonths(t.y, t.m, 1);
      a = zonedMidnight(t.y, t.m, 1); b = zonedMidnight(n.y, n.m, 1); label = 'Этот месяц'; break;
    }
  }
  return { from: a, to: b, label, preset };
}

// Последние n месяцев (по Кишинёву), заканчивая месяцем даты `end`
export function lastMonths(n, end = new Date()) {
  const t = localDay(end);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const p = addMonths(t.y, t.m, -k);
    out.push(`${p.y}-${String(p.m).padStart(2, '0')}`);
  }
  return out;
}
