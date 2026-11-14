// Тесты галереи работ: публичный список и управление из панели.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';
import { setSupabaseForTests } from '../lib/supabase.js';
import worksApi from '../api/works.js';
import adminWorks from '../api/admin/works.js';

const ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@alisa.md' };
const auth = { authorization: 'Bearer tok-admin' };
let fake;

const seed = (o = {}) => ({ image_url: 'img/01.webp', thumb_url: 'img/t/01.webp', title_ru: 'Свадьба', sub_ru: 'Арка', desc_ru: 'Белые цветы', title_ro: 'Nuntă', sub_ro: 'Arcadă', desc_ro: 'Flori albe', tags: ['Свадьба'], sort: 10, ...o });
function setup(works = [seed(), seed({ title_ru: 'Скрытая', sort: 20, visible: false }), seed({ title_ru: 'День рождения', title_ro: '', tags: ['ДР'], sort: 5 })]) {
  fake = createFakeSupabase({ users: { 'tok-admin': ADMIN, 'tok-x': { id: '2', email: 'x@y' } }, admins: [{ user_id: ADMIN.id, email: ADMIN.email }], works });
  setSupabaseForTests(fake);
}

function call(fn, { method = 'GET', url = '/', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const u = new URL(url, 'http://t');
    const req = { method, url, headers, body, query: Object.fromEntries(u.searchParams), socket: {} };
    const out = { headers: {}, statusCode: 200 };
    const res = {
      get headersSent() { return out.ended; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      end(s) { out.ended = true; let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: out.statusCode, headers: out.headers, json }); },
    };
    fn(req, res);
  });
}

// Минимальные файлы с правильными «подписями» форматов
const webp = n => 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(n)]).toString('base64');
const jpeg = n => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]).toString('base64');

test('сайт получает только опубликованные работы по порядку, румынский текст подставляется из русского, если пуст', async () => {
  setup();
  const r = await call(worksApi);
  assert.equal(r.status, 200);
  assert.match(r.headers['cache-control'], /s-maxage=60/);
  assert.deepEqual(r.json.items.map(w => w.ru[0]), ['День рождения', 'Свадьба']);
  assert.deepEqual(r.json.items[1].ro, ['Nuntă', 'Arcadă', 'Flori albe']);
  assert.equal(r.json.items[0].ro[0], 'День рождения');
  assert.equal(r.json.items[0].img, 'img/01.webp');
  assert.equal('image_path' in r.json.items[0], false, 'служебные поля наружу не отдаются');
});

test('без входа и для чужой учётной записи галерея в панели закрыта', async () => {
  setup();
  assert.equal((await call(adminWorks)).status, 401);
  assert.equal((await call(adminWorks, { headers: { authorization: 'Bearer tok-x' } })).status, 403);
  assert.equal((await call(adminWorks, { method: 'DELETE', url: '/?id=' + fake.tables.works[0].id })).status, 401);
  assert.equal(fake.tables.works.length, 3);
});

test('новая работа: фото уходит в хранилище, работа встаёт первой и сразу видна на сайте', async () => {
  setup();
  const r = await call(adminWorks, { method: 'POST', headers: auth, body: {
    image: webp(5000), thumb: jpeg(500), title_ru: '  Выпускной  ', sub_ru: 'Золото', desc_ru: 'Арка', title_ro: 'Absolvire', tags: ['Фотозона', 'нет-такой'],
  } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const w = r.json.work;
  assert.equal(w.title_ru, 'Выпускной'); assert.deepEqual(w.tags, ['Фотозона']);
  assert.equal(w.sort, -5, 'раньше всех (минимальный порядок был 5)');
  assert.match(w.image_url, /\/storage\/v1\/object\/public\/works\/[0-9a-f-]+\.webp$/);
  assert.match(w.thumb_url, /-t\.jpg$/);
  assert.equal(Object.keys(fake.files).length, 2);
  const site = await call(worksApi);
  assert.equal(site.json.items[0].ru[0], 'Выпускной');
});

test('новая работа без фото, без названия или без категорий не сохраняется', async () => {
  setup();
  const r1 = await call(adminWorks, { method: 'POST', headers: auth, body: { title_ru: 'Без фото', tags: ['ДР'] } });
  assert.equal(r1.status, 400); assert.match(r1.json.error, /фото/);
  const r2 = await call(adminWorks, { method: 'POST', headers: auth, body: { image: webp(10), thumb: webp(10), title_ru: ' ', tags: [] } });
  assert.equal(r2.status, 400); assert.match(r2.json.error, /названи/); assert.match(r2.json.error, /категори/);
  assert.equal(fake.tables.works.length, 3); assert.equal(Object.keys(fake.files).length, 0);
});

test('файл, который не является фото, или слишком большой, отклоняется', async () => {
  setup();
  const fakePng = 'data:image/webp;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64');
  const r1 = await call(adminWorks, { method: 'POST', headers: auth, body: { image: fakePng, thumb: webp(10), title_ru: 'X', tags: ['ДР'] } });
  assert.equal(r1.status, 400);
  const r2 = await call(adminWorks, { method: 'POST', headers: auth, body: { image: 'data:image/svg+xml;base64,PHN2Zz4=', thumb: webp(10), title_ru: 'X', tags: ['ДР'] } });
  assert.equal(r2.status, 400);
  const r3 = await call(adminWorks, { method: 'POST', headers: auth, body: { image: webp(2_600_000), thumb: webp(10), title_ru: 'X', tags: ['ДР'] } });
  assert.equal(r3.status, 413);
  assert.equal(Object.keys(fake.files).length, 0);
});

test('правка: подписи, скрытие, замена фото удаляет старые файлы', async () => {
  setup();
  const add = await call(adminWorks, { method: 'POST', headers: auth, body: { image: webp(100), thumb: webp(10), title_ru: 'Было', tags: ['ДР'] } });
  const id = add.json.work.id;
  const oldPaths = [add.json.work.image_path, add.json.work.thumb_path];
  const r = await call(adminWorks, { method: 'PATCH', url: '/?id=' + id, headers: auth, body: { title_ru: 'Стало', desc_ro: 'Descriere', visible: false, image: webp(200), thumb: webp(20) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.work.title_ru, 'Стало'); assert.equal(r.json.work.desc_ro, 'Descriere'); assert.equal(r.json.work.visible, false);
  assert.deepEqual(r.json.work.tags, ['ДР'], 'не присланные поля не меняются');
  for (const p of oldPaths) assert.equal(fake.files['works/' + p], undefined);
  assert.ok(fake.files['works/' + r.json.work.image_path]);
  const site = await call(worksApi);
  assert.equal(site.json.items.some(w => w.ru[0] === 'Стало'), false, 'скрытая работа не показывается на сайте');
  const bad = await call(adminWorks, { method: 'PATCH', url: '/?id=' + id, headers: auth, body: { title_ru: '' } });
  assert.equal(bad.status, 400);
});

test('порядок работ меняется целиком, удаление убирает работу и файлы', async () => {
  setup();
  const ids = fake.tables.works.map(w => w.id);
  const r = await call(adminWorks, { method: 'POST', headers: auth, body: { action: 'reorder', ids: [ids[2], ids[0], ids[1]] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items.map(w => w.id), [ids[2], ids[0], ids[1]]);
  assert.equal((await call(adminWorks, { method: 'POST', headers: auth, body: { action: 'reorder', ids: ['x'] } })).status, 400);

  const add = await call(adminWorks, { method: 'POST', headers: auth, body: { image: webp(100), thumb: webp(10), title_ru: 'Удалить', tags: ['ДР'] } });
  assert.equal(Object.keys(fake.files).length, 2);
  const d = await call(adminWorks, { method: 'DELETE', url: '/?id=' + add.json.work.id, headers: auth });
  assert.equal(d.status, 200);
  assert.equal(Object.keys(fake.files).length, 0);
  assert.equal(fake.tables.works.length, 3);
  assert.equal((await call(adminWorks, { method: 'DELETE', url: '/?id=' + add.json.work.id, headers: auth })).status, 404);
  assert.equal((await call(adminWorks, { method: 'DELETE', url: '/?id=../../etc', headers: auth })).status, 400);
});
