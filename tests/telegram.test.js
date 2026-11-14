// Кнопки статусов в Telegram: уведомление с кнопками и обработка нажатий.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeSupabase } from './fake-supabase.js';
import { setSupabaseForTests } from '../lib/supabase.js';
import leadApi from '../api/lead.js';
import tgHook from '../api/telegram.js';
import { webhookSecret, leadKeyboard } from '../lib/telegram.js';

let fake, calls;
function setup() {
  fake = createFakeSupabase({ users: {}, admins: [] });
  setSupabaseForTests(fake);
  process.env.TELEGRAM_BOT_TOKEN = '123:TEST'; process.env.TELEGRAM_CHAT_ID = '42';
  process.env.SITE_URL = 'https://alisa-decor.vercel.app';
  delete process.env.VERCEL_ENV;
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };
}

function call(fn, { method = 'POST', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = { method, url: '/', headers: { 'x-forwarded-for': '10.0.0.9', ...headers }, body, query: {}, socket: {} };
    const out = { statusCode: 200 };
    const res = {
      get headersSent() { return out.ended; }, setHeader() {},
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      end(s) { out.ended = true; resolve({ status: out.statusCode, json: JSON.parse(s || '{}') }); },
    };
    fn(req, res);
  });
}

const quiz = () => ({
  occasion: 'Юбилей', date_iso: '', date_unknown: true, place: 'Дома', city: '', style: 'Яркий и праздничный', budget: 'До 1 000 MDL',
  name: 'Ольга', phone: '+373 600 22 333', contact_method: 'Звонок', consent: true, website: '', elapsed_ms: 20000, submission_id: crypto.randomUUID(),
});
const press = (data, { chat = 42, secret = webhookSecret(), from = { id: 42, username: 'nina' } } = {}) => call(tgHook, {
  headers: { 'x-telegram-bot-api-secret-token': secret },
  body: { update_id: 1, callback_query: { id: 'cb1', from, data, message: { message_id: 77, chat: { id: chat } } } },
});

test('уведомление о заявке приходит с кнопками статусов и ссылкой на карточку в панели', async () => {
  setup();
  await call(leadApi, { body: quiz() });
  const msg = calls.find(c => c.method === 'sendMessage');
  const kb = msg.body.reply_markup.inline_keyboard;
  const lead = fake.tables.leads[0];
  assert.deepEqual(kb.flat().filter(b => b.callback_data).map(b => b.callback_data.split(':')[2]), ['contacted', 'pending', 'confirmed', 'done', 'rejected']);
  assert.ok(kb.flat().every(b => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64), 'callback_data не длиннее 64 байт');
  assert.equal(kb.at(-1)[0].url, `https://alisa-decor.vercel.app/admin#lead=${lead.id}`);
});

test('нажатие кнопки меняет статус, пишет историю и обновляет сообщение', async () => {
  setup();
  await call(leadApi, { body: quiz() });
  const lead = fake.tables.leads[0];
  calls = [];
  const r = await press(`s:${lead.id}:contacted`);
  assert.equal(r.status, 200);
  assert.equal(fake.tables.leads[0].status, 'contacted');
  const ev = fake.tables.lead_events.find(e => e.action === 'status');
  assert.equal(ev.new_value, 'contacted'); assert.equal(ev.actor_email, 'Telegram @nina');
  const edit = calls.find(c => c.method === 'editMessageText');
  assert.equal(edit.body.message_id, 77);
  assert.match(edit.body.text, /Статус: Связались/);
  assert.ok(edit.body.reply_markup.inline_keyboard[0][0].text.startsWith('● '), 'текущий статус отмечен');
  const ans = calls.find(c => c.method === 'answerCallbackQuery');
  assert.match(ans.body.text, /Связались/);
});

test('подтверждение без суммы напоминает указать сумму в панели', async () => {
  setup();
  await call(leadApi, { body: quiz() });
  calls = [];
  await press(`s:${fake.tables.leads[0].id}:confirmed`);
  assert.equal(fake.tables.leads[0].status, 'confirmed');
  const ans = calls.find(c => c.method === 'answerCallbackQuery');
  assert.match(ans.body.text, /сумму/); assert.equal(ans.body.show_alert, true);
});

test('чужой секрет, чужой чат и подделанные кнопки ничего не меняют', async () => {
  setup();
  await call(leadApi, { body: quiz() });
  const id = fake.tables.leads[0].id;
  assert.equal((await press(`s:${id}:done`, { secret: 'wrong' })).status, 401);
  assert.equal((await press(`s:${id}:done`, { secret: '' })).status, 401);
  await press(`s:${id}:done`, { chat: 999 });
  await press(`s:${id}:new`);                    // «новая» из Telegram не ставится
  await press(`s:${id}:cancelled`);
  await press(`s:../../x:done`);
  assert.equal(fake.tables.leads[0].status, 'new');
  assert.equal(fake.tables.lead_events.filter(e => e.action === 'status').length, 0);
});

test('повторное нажатие того же статуса не пишет историю второй раз', async () => {
  setup();
  await call(leadApi, { body: quiz() });
  const id = fake.tables.leads[0].id;
  await press(`s:${id}:pending`); await press(`s:${id}:pending`);
  assert.equal(fake.tables.lead_events.filter(e => e.action === 'status').length, 1);
});

test('без адреса сайта кнопки есть, а ссылки на панель нет', () => {
  delete process.env.SITE_URL; delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const kb = leadKeyboard({ id: '00000000-0000-4000-8000-000000000000', status: 'new' }).inline_keyboard;
  assert.equal(kb.flat().some(b => b.url), false);
  assert.equal(kb.flat().length, 5);
});
