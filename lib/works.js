// Галерея работ: проверка данных из панели, разбор загруженных фото и запись в хранилище Supabase.

import crypto from 'node:crypto';
import { httpError } from './http.js';

export const BUCKET = 'works';

// Метки работ. Ключи совпадают с фильтрами галереи на сайте и с data-c у карточек «Поводов».
export const WORK_TAGS = {
  'ДР': 'День рождения',
  'Дети': 'Детский праздник',
  'Юбилей': 'Юбилей',
  'Свадьба': 'Свадьба',
  'Девичник': 'Девичник',
  'Крещение': 'Крещение',
  'Любовь': 'Второй половинке',
  'Подарок': 'Подарок',
  'Новый год': 'Новый год',
  'Фотозона': 'Фотозона',
  'Зал': 'Оформление зала',
  'Фасад': 'Оформление фасада',
  'Бизнес': 'Для бизнеса',
};

export const WORK_COLS = 'id, image_url, thumb_url, image_path, thumb_path, title_ru, sub_ru, desc_ru, title_ro, sub_ro, desc_ro, tags, sort, visible, created_at, updated_at';

const LIMITS = { title_ru: 80, sub_ru: 80, desc_ru: 300, title_ro: 80, sub_ro: 80, desc_ro: 300 };
const MAX_IMAGE = 2_500_000;   // крупное фото после сжатия в браузере
const MAX_THUMB = 300_000;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Поля работы из панели. partial = правка: проверяются только присланные поля.
export function validateWork(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const errors = [];
  for (const [k, max] of Object.entries(LIMITS)) {
    if (partial && b[k] === undefined) continue;
    out[k] = clean(b[k], max);
  }
  if ((!partial || b.title_ru !== undefined) && !out.title_ru) errors.push('Укажите название работы на русском.');
  if (!partial || b.tags !== undefined) {
    if (!Array.isArray(b.tags)) errors.push('Выберите хотя бы одну категорию.');
    else {
      const tags = [...new Set(b.tags.map(t => String(t)))].filter(t => WORK_TAGS[t]);
      if (!tags.length) errors.push('Выберите хотя бы одну категорию.');
      out.tags = tags;
    }
  }
  if (b.visible !== undefined) out.visible = b.visible === true;
  if (b.sort !== undefined) {
    const n = Number(b.sort);
    if (!Number.isInteger(n) || Math.abs(n) > 1e6) errors.push('Неверный порядок.');
    else out.sort = n;
  }
  return { ok: errors.length === 0, errors, work: out };
}

// Фото приходит из браузера уже сжатым: data:image/webp;base64,… или JPEG (Safari не умеет WebP в canvas).
export function decodeImage(dataUrl, max) {
  const m = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'Фото должно быть в формате WebP или JPEG.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw httpError(400, 'Файл фото пустой.');
  if (buf.length > max) throw httpError(413, 'Фото слишком большое. Выберите файл поменьше.');
  const isWebp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (m[1] === 'image/webp' ? !isWebp : !isJpeg) throw httpError(400, 'Файл не похож на фото.');
  return { buf, type: m[1], ext: m[1] === 'image/webp' ? 'webp' : 'jpg' };
}

// Загружает пару «фото + миниатюра» в хранилище. Имена случайные — старая версия не останется в кэше браузеров.
export async function uploadPair(sb, image, thumb) {
  const big = decodeImage(image, MAX_IMAGE);
  const small = decodeImage(thumb, MAX_THUMB);
  const base = crypto.randomUUID();
  const image_path = `${base}.${big.ext}`;
  const thumb_path = `${base}-t.${small.ext}`;
  const st = sb.storage.from(BUCKET);
  for (const [path, f] of [[image_path, big], [thumb_path, small]]) {
    const { error } = await st.upload(path, f.buf, { contentType: f.type, cacheControl: '31536000', upsert: false });
    if (error) {
      if (path === thumb_path) await st.remove([image_path]).catch(() => {});
      throw Object.assign(new Error('storage upload: ' + error.message), { publicMessage: 'Не удалось загрузить фото в хранилище. Проверьте, что выполнена миграция галереи.' });
    }
  }
  return {
    image_path, thumb_path,
    image_url: st.getPublicUrl(image_path).data.publicUrl,
    thumb_url: st.getPublicUrl(thumb_path).data.publicUrl,
  };
}

export async function removeFiles(sb, row) {
  const paths = [row?.image_path, row?.thumb_path].filter(Boolean);
  if (!paths.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error) console.error('[works] storage remove', error.message);
}

// Публичный вид работы для сайта: только то, что нужно для показа.
export function publicWork(r) {
  return {
    id: r.id, img: r.image_url, thumb: r.thumb_url, tags: r.tags || [],
    ru: [r.title_ru, r.sub_ru || '', r.desc_ru || ''],
    ro: [r.title_ro || r.title_ru, r.sub_ro || r.sub_ru || '', r.desc_ro || r.desc_ru || ''],
  };
}
