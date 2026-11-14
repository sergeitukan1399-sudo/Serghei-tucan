// Серверная проверка заявки из квиза. Всё, что пришло из браузера, считается непроверенным.

import { EVENT_TYPES, PLACES, STYLES, METHODS } from './constants.js';

const clean = (v, max) => {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
};
const cleanMultiline = (v, max) => {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function phoneDigits(p) {
  return String(p || '').replace(/\D/g, '');
}

export function validateLead(body, { now = new Date() } = {}) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const event_type = clean(b.occasion, 60);
  if (!EVENT_TYPES.includes(event_type)) errors.push('Выберите праздник из списка.');

  let event_date = null;
  const rawDate = clean(b.date_iso, 10);
  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) errors.push('Неверный формат даты.');
    else {
      const d = new Date(rawDate + 'T00:00:00Z');
      const y = d.getUTCFullYear();
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== rawDate) errors.push('Неверная дата праздника.');
      else if (y < now.getUTCFullYear() - 1 || y > now.getUTCFullYear() + 5) errors.push('Проверьте год праздника.');
      else event_date = rawDate;
    }
  } else if (!b.date_unknown) {
    errors.push('Укажите дату праздника или отметьте, что она пока не определена.');
  }

  const event_location = clean(b.place, 60);
  if (!PLACES.includes(event_location)) errors.push('Выберите место проведения.');
  const event_city = clean(b.city, 80) || null;

  const event_style = clean(b.style, 60);
  if (!STYLES.includes(event_style)) errors.push('Выберите стиль оформления.');

  const budget_range = clean(b.budget, 60);
  if (!budget_range) errors.push('Выберите ориентир бюджета.');

  const client_name = clean(b.name, 80);
  if (client_name.length < 2) errors.push('Укажите имя.');

  const rawPhone = clean(b.phone, 32);
  const digits = phoneDigits(rawPhone);
  if (digits.length < 8 || digits.length > 15 || /[^\d\s+()\-]/.test(rawPhone)) errors.push('Проверьте номер телефона.');

  const contact_method = clean(b.contact_method, 20);
  if (!METHODS.includes(contact_method)) errors.push('Выберите способ связи.');

  const comment = cleanMultiline(b.comment, 1000) || null;

  if (b.consent !== true) errors.push('Нужно согласие на обработку персональных данных.');

  const submission_id = UUID.test(String(b.submission_id || '')) ? String(b.submission_id).toLowerCase() : null;
  if (!submission_id) errors.push('Обновите страницу и отправьте заявку ещё раз.');

  return {
    ok: errors.length === 0,
    errors,
    lead: {
      event_type, event_date, event_location, event_city, event_style, budget_range,
      client_name, client_phone: rawPhone, contact_method, comment, submission_id,
      source: 'site_quiz',
    },
  };
}

// Признаки автоматической отправки: заполнено скрытое поле или форма пройдена слишком быстро
export function looksLikeBot(body) {
  if (body && typeof body.website === 'string' && body.website.trim() !== '') return 'honeypot';
  const ms = Number(body && body.elapsed_ms);
  if (Number.isFinite(ms) && ms >= 0 && ms < 3000) return 'too_fast';
  return null;
}
