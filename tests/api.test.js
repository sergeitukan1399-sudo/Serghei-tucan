// Тесты серверной логики: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeSupabase } from './fake-supabase.js';
import { setSupabaseForTests } from '../lib/supabase.js';
import leadApi from '../api/lead.js';
import leadsApi from '../api/admin/leads.js';
import leadOne from '../api/admin/lead.js';
import statsApi from '../api/admin/stats.js';
import exportApi from '../api/admin/export.js';
import notifyApi from '../api/admin/notify.js';
import meApi from '../api/admin/me.js';
import { resolvePeriod, zonedMidnight } from '../lib/period.js';
import { computeStats } from '../lib/stats.js';

const ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@alisa.md' };
const STRANGER = { id: '22222222-2222-2222-2222-222222222222', email: 'x@y.z' };

let fake, tgCalls, tgMode;
function setup({ tg = 'ok', telegram = true } = {}) {
  fake = createFakeSupabase({ users: { 'tok-admin': ADMIN, 'tok-stranger': STRANGER }, admins: [{ user_id: ADMIN.id, email: ADMIN.email }] });
  setSupabaseForTests(fake);
  if (telegram) { process.env.TELEGRAM_BOT_TOKEN = '123:TEST'; process.env.TELEGRAM_CHAT_ID = '42'; }
  else { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; }
  tgCalls = []; tgMode = tg;
  globalThis.fetch = async (url, init) => {
    tgCalls.push({ url, body: JSON.parse(init.body) });
    if (tgMode === 'ok') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (tgMode === 'throw') throw new Error('network down');
    return new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 });
  };
}

function call(fn, { method = 'GET', url = '/', body, headers = {}, ip = '10.0.0.1' } = {}) {
  return new Promise(resolve => {
    const u = new URL(url, 'http://t');
    const req = { method, url, headers: { 'x-forwarded-for': ip, ...headers }, body, query: Object.fromEntries(u.searchParams), socket: {} };
    const out = { headers: {}, statusCode: 200, chunks: '' };
    const res = {
      get headersSent() { return out.ended; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      end(s) { out.ended = true; out.chunks = s || ''; let json = null; try { json = JSON.parse(out.chunks); } catch {} resolve({ status: out.statusCode, headers: out.headers, json, text: out.chunks }); },
    };
    fn(req, res);
  });
}

const quiz = (o = {}) => ({
  occasion: 'Свадьба', date_iso: '2027-06-12', date_unknown: false, place: 'Ресторан или банкетный зал', city: 'Комрат',
  style: 'Элегантный и минималистичный', budget: '3 000 – 7 000 MDL', name: 'Анна', phone: '+373 600 00 001',
  contact_method: 'WhatsApp', comment: 'Белый и золото', consent: true, website: '', elapsed_ms: 45000,
  submission_id: crypto.randomUUID(), ...o,
});
const auth = { authorization: 'Bearer tok-admin' };

test('заявка сохраняется в базе и уходит в Telegram', async () => {
  setup();
  const r = await call(leadApi, { method: 'POST', body: quiz() });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.lead_no, 1); assert.equal(r.json.notified, true);
  const l = fake.tables.leads[0];
  assert.equal(l.event_type, 'Свадьба'); assert.equal(l.event_date, '2027-06-12'); assert.equal(l.notify_status, 'sent');
  assert.equal(tgCalls.length, 1); assert.equal(tgCalls[0].body.chat_id, '42');
  assert.match(tgCalls[0].body.text, /Заявка №1/); assert.match(tgCalls[0].body.text, /12\.06\.2027/);
  assert.deepEqual(fake.tables.lead_events.map(e => e.action), ['created', 'notify_sent']);
});

test('повторная отправка той же заявки не создаёт дубль', async () => {
  setup();
  const b = quiz();
  await call(leadApi, { method: 'POST', body: b });
  const r2 = await call(leadApi, { method: 'POST', body: b });
  assert.equal(r2.json.duplicate, true);
  const r3 = await call(leadApi, { method: 'POST', body: { ...b, submission_id: crypto.randomUUID(), phone: '+373 (600) 00-001' } });
  assert.equal(r3.json.duplicate, true, 'тот же телефон и повод за 10 минут');
  assert.equal(fake.tables.leads.length, 1); assert.equal(tgCalls.length, 1);
});

test('Telegram недоступен — заявка всё равно принята и сохранена, ошибка зафиксирована', async () => {
  setup({ tg: 'fail' });
  const r = await call(leadApi, { method: 'POST', body: quiz() });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.notified, false);
  const l = fake.tables.leads[0];
  assert.equal(l.notify_status, 'failed'); assert.match(l.notify_error, /chat not found/);
  // повтор из панели — без создания новой заявки
  tgMode = 'ok';
  const rr = await call(notifyApi, { method: 'POST', headers: auth, body: { id: l.id } });
  assert.equal(rr.json.ok, true);
  assert.equal(fake.tables.leads.length, 1); assert.equal(fake.tables.leads[0].notify_status, 'sent');
  assert.match(tgCalls.at(-1).body.text, /Повторная отправка/);
  // ещё один повтор не шлёт дубль
  const again = await call(notifyApi, { method: 'POST', headers: auth, body: { id: l.id } });
  assert.equal(again.json.already, true);
  assert.equal(tgCalls.filter(c => tgMode === 'ok').length, tgCalls.length);
  assert.equal(tgCalls.length, 2);
});

test('база недоступна — заявка уходит в Telegram с пометкой; если и он недоступен — 503', async () => {
  setup();
  const broken = { from: () => { throw new Error('db down'); }, auth: fake.auth };
  setSupabaseForTests(broken);
  const r = await call(leadApi, { method: 'POST', body: quiz() });
  assert.equal(r.status, 200); assert.equal(r.json.stored, 'telegram');
  assert.match(tgCalls.at(-1).body.text, /НЕ сохранилась в базе/);
  tgMode = 'throw';
  const r2 = await call(leadApi, { method: 'POST', body: quiz({ submission_id: crypto.randomUUID() }) });
  assert.equal(r2.status, 503); assert.equal(r2.json.ok, false);
});

test('проверка данных на сервере', async () => {
  setup();
  for (const [o, re] of [[{ name: 'А' }, /имя/i], [{ phone: '12ab' }, /телефон/i], [{ consent: false }, /согласие/i], [{ occasion: 'Хакатон' }, /праздник/i],
    [{ date_iso: '2027-02-31' }, /дата/i], [{ date_iso: '', date_unknown: false }, /дату/i], [{ contact_method: 'Telegram' }, /способ/i], [{ submission_id: 'x' }, /ещё раз/i]]) {
    const r = await call(leadApi, { method: 'POST', body: quiz(o) });
    assert.equal(r.status, 400, JSON.stringify(o)); assert.match(r.json.error, re);
  }
  const unknownDate = await call(leadApi, { method: 'POST', body: quiz({ date_iso: '', date_unknown: true }) });
  assert.equal(unknownDate.status, 200); assert.equal(fake.tables.leads[0].event_date, null);
  assert.equal(fake.tables.leads.length, 1);
});

test('антиспам: скрытое поле, слишком быстро, лимит частоты', async () => {
  setup();
  const hp = await call(leadApi, { method: 'POST', body: quiz({ website: 'http://spam' }) });
  assert.equal(hp.status, 200); assert.equal(fake.tables.leads.length, 0, 'бот не сохраняется');
  const fast = await call(leadApi, { method: 'POST', body: quiz({ elapsed_ms: 800 }) });
  assert.equal(fast.status, 400);
  let last;
  for (let i = 0; i < 6; i++) last = await call(leadApi, { method: 'POST', ip: '9.9.9.9', body: quiz({ phone: '+373 600 00 1' + i + '0', submission_id: crypto.randomUUID() }) });
  assert.equal(last.status, 429);
  assert.ok(fake.tables.submission_log.every(r => !r.ip_hash.includes('9.9.9.9')), 'IP хранится только в виде хеша');
});

test('доступ к панели только администратору', async () => {
  setup();
  assert.equal((await call(leadsApi)).status, 401);
  assert.equal((await call(leadsApi, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(leadsApi, { headers: { authorization: 'Bearer tok-stranger' } })).status, 403);
  assert.equal((await call(exportApi, { headers: { authorization: 'Bearer tok-stranger' } })).status, 403);
  assert.equal((await call(statsApi)).status, 401);
  assert.equal((await call(meApi, { headers: auth })).status, 200);
});

test('список: поиск, фильтр, сортировка, страницы', async () => {
  setup();
  const names = ['Анна', 'Мария', 'Ольга', 'Ирина', 'Елена'];
  for (let i = 0; i < 30; i++) await call(leadApi, { method: 'POST', ip: '10.0.' + i + '.1', body: quiz({ name: names[i % 5] + ' ' + i, phone: '+373 6' + String(1000000 + i), occasion: i % 2 ? 'Юбилей' : 'Свадьба' }) });
  assert.equal(fake.tables.leads.length, 30);
  const p1 = await call(leadsApi, { url: '/?per=10&page=1', headers: auth });
  assert.equal(p1.json.total, 30); assert.equal(p1.json.items.length, 10); assert.equal(p1.json.items[0].lead_no, 30);
  const p3 = await call(leadsApi, { url: '/?per=10&page=3&sort=lead_no&dir=asc', headers: auth });
  assert.equal(p3.json.items[0].lead_no, 21);
  const s = await call(leadsApi, { url: '/?q=' + encodeURIComponent('Ольга'), headers: auth });
  assert.equal(s.json.total, 6);
  const ph = await call(leadsApi, { url: '/?q=61000007', headers: auth });
  assert.equal(ph.json.total, 1);
  const id = fake.tables.leads[3].id;
  await call(leadOne, { method: 'PATCH', url: '/?id=' + id, headers: auth, body: { status: 'contacted' } });
  const f = await call(leadsApi, { url: '/?status=contacted', headers: auth });
  assert.equal(f.json.total, 1);
});

test('статусы, сумма, заметки, история и пересчёт конверсии', async () => {
  setup();
  for (let i = 0; i < 4; i++) await call(leadApi, { method: 'POST', ip: '1.1.1.' + i, body: quiz({ phone: '+373 6900000' + i, occasion: i < 2 ? 'Свадьба' : 'День рождения' }) });
  const [a, b, c] = fake.tables.leads;
  const pa = await call(leadOne, { method: 'PATCH', url: '/?id=' + a.id, headers: auth, body: { status: 'confirmed', order_amount: '4 500,50', manager_notes: 'Арка + 2 стола' } });
  assert.equal(pa.status, 200); assert.equal(pa.json.lead.status, 'confirmed'); assert.equal(pa.json.lead.order_amount, 4500.5);
  assert.ok(pa.json.lead.confirmed_at);
  assert.deepEqual(pa.json.events.filter(e => ['status', 'amount', 'notes'].includes(e.action)).map(e => [e.action, e.actor_email]),
    [['status', ADMIN.email], ['amount', ADMIN.email], ['notes', ADMIN.email]]);
  await call(leadOne, { method: 'PATCH', url: '/?id=' + b.id, headers: auth, body: { status: 'done', order_amount: 2000 } });
  await call(leadOne, { method: 'PATCH', url: '/?id=' + c.id, headers: auth, body: { status: 'rejected' } });
  assert.equal((await call(leadOne, { method: 'PATCH', url: '/?id=' + c.id, headers: auth, body: { order_amount: -5 } })).status, 400);
  assert.equal((await call(leadOne, { method: 'PATCH', url: '/?id=' + c.id, headers: auth, body: { status: 'paid' } })).status, 400);

  let st = await call(statsApi, { url: '/?preset=month', headers: auth });
  assert.equal(st.json.cards.leads, 4); assert.equal(st.json.cards.cohort_orders, 2); assert.equal(st.json.cards.conversion, 50);
  assert.equal(st.json.cards.orders_sum, 6500.5); assert.equal(st.json.extra.avg_order, 3250); assert.equal(st.json.extra.rejected, 1);
  assert.equal(st.json.extra.awaiting_reply, 1);

  // отмена: заказ уходит из действующих, но история и дата подтверждения сохраняются
  const pc = await call(leadOne, { method: 'PATCH', url: '/?id=' + a.id, headers: auth, body: { status: 'cancelled' } });
  assert.ok(pc.json.lead.confirmed_at); assert.ok(pc.json.lead.cancelled_at);
  assert.deepEqual(pc.json.events.filter(e => e.action === 'status').map(e => e.new_value), ['confirmed', 'cancelled']);
  st = await call(statsApi, { url: '/?preset=month', headers: auth });
  assert.equal(st.json.cards.cohort_orders, 1); assert.equal(st.json.cards.conversion, 25); assert.equal(st.json.cards.orders_sum, 2000);
  assert.equal(st.json.extra.cancelled_in_period, 1);
  assert.equal(st.json.monthly.length, 12); assert.equal(st.json.monthly.at(-1).leads, 4);
  const sv = st.json.by_type.find(t => t.type === 'Свадьба'); assert.deepEqual([sv.leads, sv.orders, sv.conversion], [2, 1, 50]);
});

test('экспорт CSV: BOM, разделитель, фильтры, защита от формул', async () => {
  setup();
  await call(leadApi, { method: 'POST', ip: '2.2.2.1', body: quiz({ name: 'Ольга', comment: '=HYPERLINK("x");"кавычки"' }) });
  await call(leadApi, { method: 'POST', ip: '2.2.2.2', body: quiz({ name: 'Мария', phone: '+373 777 77 777', occasion: 'Юбилей' }) });
  const r = await call(exportApi, { url: '/?q=' + encodeURIComponent('Ольга'), headers: auth });
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/csv/);
  assert.ok(r.text.startsWith('﻿')); const lines = r.text.trim().split('\r\n');
  assert.equal(lines.length, 2); assert.match(lines[0], /^Номер;Дата заявки;Имя/);
  assert.match(lines[1], /Ольга/); assert.doesNotMatch(lines[1], /Мария/);
  assert.match(lines[1], /"'=HYPERLINK\(""x""\);""кавычки"""/);
});

test('периоды по времени Кишинёва', () => {
  const now = new Date('2026-11-12T08:00:00Z');
  const m = resolvePeriod({ preset: 'month' }, now);
  assert.equal(m.from.toISOString(), '2026-10-31T22:00:00.000Z');   // 1 ноября 00:00 по Кишинёву (UTC+2)
  assert.equal(m.to.toISOString(), '2026-11-30T22:00:00.000Z');
  const summer = zonedMidnight(2026, 7, 1);
  assert.equal(summer.toISOString(), '2026-06-30T21:00:00.000Z');   // летнее время UTC+3
  const pm = resolvePeriod({ preset: 'prev_month' }, now); assert.equal(pm.from.toISOString(), '2026-09-30T21:00:00.000Z');
  const q = resolvePeriod({ preset: 'quarter' }, now); assert.equal(q.from.toISOString(), '2026-09-30T21:00:00.000Z');
  const c = resolvePeriod({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' }, now);
  assert.equal(c.from.toISOString(), '2026-02-28T22:00:00.000Z'); assert.equal(c.to.toISOString(), '2026-03-31T21:00:00.000Z');
  assert.throws(() => resolvePeriod({ preset: 'custom', from: '2026-03-10', to: '2026-03-01' }));
});

test('две разные метрики: заявки периода, ставшие заказами, и заказы, подтверждённые в периоде', () => {
  const now = new Date('2026-11-12T08:00:00Z');
  const leads = [
    { created_at: '2026-10-20T10:00:00Z', status: 'confirmed', order_amount: 1000, confirmed_at: '2026-11-03T10:00:00Z', event_type: 'Свадьба' },
    { created_at: '2026-11-02T10:00:00Z', status: 'new', order_amount: null, confirmed_at: null, event_type: 'Юбилей' },
    { created_at: '2026-11-04T10:00:00Z', status: 'done', order_amount: 3000, confirmed_at: '2026-11-05T10:00:00Z', event_type: 'Крещение' },
  ];
  const s = computeStats(leads, resolvePeriod({ preset: 'month' }, now), now);
  assert.equal(s.cards.leads, 2);              // заявки ноября
  assert.equal(s.cards.cohort_orders, 1);      // из них стали заказом
  assert.equal(s.extra.confirmed_in_period, 2); // подтверждено в ноябре (включая октябрьскую заявку)
  assert.equal(s.cards.orders_sum, 4000);
  assert.equal(s.cards.conversion, 50);
  const empty = computeStats([], resolvePeriod({ preset: 'today' }, now), now);
  assert.equal(empty.cards.conversion, null); assert.equal(empty.extra.avg_order, null);
});
