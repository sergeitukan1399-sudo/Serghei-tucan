// Уведомления в Telegram. Токен и номер чата — только в переменных окружения Vercel.

import { STATUSES } from './constants.js';

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function fmtDate(d) {
  if (!d) return 'Пока не определена';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
}

export function leadText(l) {
  const lines = [
    `🎈 Заявка №${l.lead_no ?? '—'} — Alisa Decor & Balloons`,
    '',
    `1. Праздник: ${l.event_type}`,
    `2. Дата: ${fmtDate(l.event_date)}`,
    `3. Место: ${l.event_location || '—'}${l.event_city ? ', ' + l.event_city : ''}`,
    `4. Стиль: ${l.event_style || '—'}`,
    `5. Бюджет: ${l.budget_range || '—'}`,
    `6. Контакты: ${l.client_name}, ${l.client_phone}${l.contact_method ? ' (' + l.contact_method + ')' : ''}`,
  ];
  if (l.comment) lines.push(`Комментарий: ${l.comment}`);
  if (l.source === 'site_quiz_ro') lines.push('Язык клиента: румынский (заявка с /ro)');
  if (l.status && l.status !== 'new') lines.push(`Статус: ${STATUSES[l.status] || l.status}`);
  if (l.retry) lines.push('', '↻ Повторная отправка уведомления');
  return lines.join('\n');
}

export async function sendTelegram(text, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!telegramConfigured()) throw new Error('Telegram не настроен');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.description || `HTTP ${r.status}`);
    return true;
  } finally {
    clearTimeout(t);
  }
}
