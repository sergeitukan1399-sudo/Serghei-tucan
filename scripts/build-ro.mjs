// Собирает румынскую версию сайта (ro.html → адрес /ro) из index.html и словаря i18n/ro.json.
//   node scripts/build-ro.mjs          — собрать ro.html
//   node scripts/build-ro.mjs --check  — проверить, что ro.html совпадает со сборкой (для тестов)
// Переводятся тексты страницы и подписи (alt, aria-label, title, placeholder, meta). Значения полей квиза
// (value, data-q, data-c) остаются русскими: по ним CRM узнаёт ответы. Тексты, которые создаёт скрипт,
// лежат в самом index.html (объект TX) на двух языках — их сборка не трогает.
// Если на русской странице появился новый текст без перевода, сборка остановится и покажет его.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYR = /[А-Яа-яЁё]/;

export function buildRo() {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'i18n/ro.json'), 'utf8'));
  const missing = new Set();
  const tr = t => {
    const key = t.replace(/\s+/g, ' ').trim();
    if (!CYR.test(key)) return t;
    const v = dict[key];
    if (v == null) { missing.add(key); return t; }
    return t.match(/^\s*/)[0] + v + t.match(/\s*$/)[0];
  };

  let out = src.replace(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->)|(<[^>]+>)|([^<]+)/g, (m, keep, tag, text) => {
    if (keep) return keep;
    if (tag) return tag.replace(/(\s(?:alt|aria-label|aria-roledescription|title|placeholder|content)=")([^"]*)(")/g, (x, a, v, b) => a + tr(v) + b);
    return tr(text);
  });

  const swap = (from, to) => {
    if (!out.includes(from)) throw new Error('В index.html не найдено: ' + from);
    out = out.replace(from, to);
  };
  swap('<html lang="ru">', '<html lang="ro">\n<!-- Versiunea în limba română. Не редактировать вручную: собирается из index.html командой npm run build:ro -->');
  swap('<link rel="canonical" href="https://alisa-decor.vercel.app/">', '<link rel="canonical" href="https://alisa-decor.vercel.app/ro">');
  swap('<span class="lang2"><b>RU</b> / <a href="/ro" lang="ro" hreflang="ro" title="Versiunea în limba română">RO</a></span>',
    '<span class="lang2"><a href="/" lang="ru" hreflang="ru" title="Русская версия">RU</a> / <b>RO</b></span>');
  if (!out.includes('href="/privacy"')) throw new Error('В index.html не найдена ссылка на /privacy');
  out = out.replaceAll('href="/privacy"', 'href="/privacy-ro"');   // румынская политика конфиденциальности

  if (missing.size) {
    const list = [...missing].map(s => '  • ' + s).join('\n');
    throw new Error(`Нет румынского перевода для ${missing.size} текстов. Добавьте их в i18n/ro.json:\n${list}`);
  }
  // Контроль: вне скриптов, стилей и служебных атрибутов кириллицы не осталось
  const visible = out.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '')
    .replace(/\s(?:value|data-[\w-]+|name|id|href|class|lang|title)="[^"]*"/g, ' ');
  const left = visible.match(/[^<>"]*[А-Яа-яЁё][^<>"]*/g);
  if (left) throw new Error('На румынской странице остался русский текст:\n' + left.slice(0, 10).map(s => '  • ' + s.trim()).join('\n'));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const html = buildRo();
    const target = path.join(root, 'ro.html');
    if (process.argv.includes('--check')) {
      const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (cur !== html) { console.error('ro.html устарел — выполните: npm run build:ro'); process.exit(1); }
      console.log('ro.html актуален');
    } else {
      fs.writeFileSync(target, html);
      console.log('ro.html собран');
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
