// Уведомления в Telegram. Токен и номер чата — только в переменных окружения Vercel.

import crypto from 'node:crypto';
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

// Общий вызов Bot API. Токен берётся только из переменных окружения.
export async function tgApi(methodName, payload, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!telegramConfigured()) throw new Error('Telegram не настроен');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${methodName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.description || `HTTP ${r.status}`);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

export async function sendTelegram(text, { replyMarkup, ...opts } = {}) {
  await tgApi('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, opts);
  return true;
}

// ---------- кнопки статусов под уведомлением ----------

// Адрес сайта для ссылки «Открыть в панели» и для вебхука
export function siteUrl() {
  const u = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '');
  return u.replace(/\/+$/, '');
}

// Какие статусы можно поставить из Telegram. callback_data: «s:<id заявки>:<статус>» — короче 64 байт.
export const TG_BUTTONS = [
  ['contacted', '📞 Связались'], ['pending', '⏳ Думает'],
  ['confirmed', '✅ Заказ подтверждён'], ['done', '🎉 Выполнен'],
  ['rejected', '✖ Отказ'],
];

export function leadKeyboard(lead) {
  const btn = ([st, label]) => ({ text: (lead.status === st ? '● ' : '') + label, callback_data: `s:${lead.id}:${st}` });
  const rows = [[btn(TG_BUTTONS[0]), btn(TG_BUTTONS[1])], [btn(TG_BUTTONS[2]), btn(TG_BUTTONS[3])], [btn(TG_BUTTONS[4])]];
  const base = siteUrl();
  if (base) rows.push([{ text: 'Открыть в панели', url: `${base}/admin#lead=${lead.id}` }]);
  return { inline_keyboard: rows };
}

// Секрет вебхука выводится из токена бота: отдельная переменная не нужна, а без токена его не подобрать.
export function webhookSecret() {
  return crypto.createHmac('sha256', String(process.env.TELEGRAM_BOT_TOKEN || '')).update('alisa-crm-webhook').digest('hex').slice(0, 48);
}

export function webhookUrl() {
  const base = siteUrl();
  return base ? base + '/api/telegram' : '';
}

export async function webhookStatus() {
  const info = await tgApi('getWebhookInfo', {});
  return { url: info.url || '', expected: webhookUrl(), ok: Boolean(info.url) && info.url === webhookUrl(), last_error: info.last_error_message || null };
}

export async function setupWebhook() {
  const url = webhookUrl();
  if (!url) throw new Error('Не удалось определить адрес сайта: задайте SITE_URL в Vercel');
  await tgApi('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['callback_query'], drop_pending_updates: false });
  return webhookStatus();
}

// Подключает кнопки сам, без участия владельца: один раз на запуск сервера, только на боевом сайте.
let webhookChecked = false;
export async function ensureWebhook() {
  if (webhookChecked || process.env.VERCEL_ENV !== 'production' || !telegramConfigured() || !webhookUrl()) return;
  webhookChecked = true;
  try {
    const st = await webhookStatus();
    if (!st.ok) await setupWebhook();
  } catch (e) {
    webhookChecked = false;
    console.error('[telegram] webhook:', e.message);
  }
}
