// /api/admin/works — галерея в панели.
//   GET                      все работы, включая скрытые
//   POST {image, thumb, …}   новая работа (фото уже сжато в браузере)
//   POST {action:'reorder', ids:[…]}   новый порядок
//   PATCH ?id=… {…}          правка подписей, категорий, видимости; новое фото — image + thumb
//   DELETE ?id=…             удалить работу и её файлы из хранилища
import { handler, method, send, readJson, query, httpError } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { db } from '../../lib/supabase.js';
import { WORK_COLS, WORK_TAGS, validateWork, uploadPair, removeFiles } from '../../lib/works.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_LIMIT = 3_600_000;   // фото + миниатюра в base64; у Vercel предел 4,5 МБ

// Таблицы ещё нет — миграция галереи не выполнена
const notReady = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .*works.* does not exist|Could not find the table/i.test(e.message || ''));
const NOT_READY = 'Галерея ещё не подключена к базе: выполните в Supabase миграцию supabase/migrations/20261114000000_works.sql (SQL Editor → Run). Пока на сайте показываются встроенные работы.';

async function list(sb) {
  const { data, error } = await sb.from('works').select(WORK_COLS)
    .order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (notReady(error)) throw httpError(503, NOT_READY);
  if (error) throw error;
  return data || [];
}

async function getOne(sb, id) {
  if (!UUID.test(String(id || ''))) throw httpError(400, 'Неверный номер работы');
  const { data, error } = await sb.from('works').select(WORK_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, 'Работа не найдена');
  return data;
}

export default handler(async (req, res) => {
  if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  await requireAdmin(req);
  const sb = db();

  if (req.method === 'GET') return send(res, 200, { items: await list(sb), tags: WORK_TAGS });

  if (req.method === 'DELETE') {
    const row = await getOne(sb, query(req).id);
    const { error } = await sb.from('works').delete().eq('id', row.id);
    if (error) throw error;
    await removeFiles(sb, row);
    return send(res, 200, { ok: true });
  }

  const body = await readJson(req, BODY_LIMIT);

  if (req.method === 'POST' && body.action === 'reorder') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length || ids.length > 500 || ids.some(id => !UUID.test(id)) || new Set(ids).size !== ids.length) throw httpError(400, 'Неверный порядок работ');
    for (let i = 0; i < ids.length; i++) {
      const { error } = await sb.from('works').update({ sort: (i + 1) * 10 }).eq('id', ids[i]);
      if (error) throw error;
    }
    return send(res, 200, { items: await list(sb) });
  }

  if (req.method === 'POST') {
    const v = validateWork(body);
    if (!body.image || !body.thumb) v.errors.push('Добавьте фото работы.');
    if (v.errors.length) throw httpError(400, v.errors.join(' '));
    // новая работа встаёт первой в галерее
    const { data: first, error: e1 } = await sb.from('works').select('sort').order('sort', { ascending: true }).limit(1);
    if (e1) throw e1;
    const sort = v.work.sort ?? ((first?.[0]?.sort ?? 10) - 10);
    const files = await uploadPair(sb, body.image, body.thumb);
    const { data, error } = await sb.from('works').insert({ visible: true, ...v.work, ...files, sort }).select(WORK_COLS).single();
    if (error) { await removeFiles(sb, files); throw error; }
    return send(res, 201, { work: data });
  }

  // PATCH
  const row = await getOne(sb, query(req).id);
  const v = validateWork(body, { partial: true });
  if (v.errors.length) throw httpError(400, v.errors.join(' '));
  let files = null;
  if (body.image || body.thumb) {
    if (!body.image || !body.thumb) throw httpError(400, 'Нужны и фото, и миниатюра');
    files = await uploadPair(sb, body.image, body.thumb);
  }
  const patch = { ...v.work, ...(files || {}) };
  if (!Object.keys(patch).length) return send(res, 200, { work: row });
  const { data, error } = await sb.from('works').update(patch).eq('id', row.id).select(WORK_COLS).single();
  if (error) { if (files) await removeFiles(sb, files); throw error; }
  if (files) await removeFiles(sb, row);
  send(res, 200, { work: data });
});
