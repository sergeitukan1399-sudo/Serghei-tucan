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
    out = out.split(from).join(to);
  };
  swap('<html lang="ru">', '<html lang="ro">\n<!-- Versiunea în limba română. Не редактировать вручную: собирается из index.html командой npm run build:ro -->');
  swap('<link rel="canonical" href="https://alisa-decor.vercel.app/">', '<link rel="canonical" href="https://alisa-decor.vercel.app/ro">');
  swap('<span class="lang2"><b>RU</b> / <a href="/ro" lang="ro" hreflang="ro" title="Versiunea în limba română">RO</a></span>',
    '<span class="lang2"><a href="/" lang="ru" hreflang="ru" title="Русская версия">RU</a> / <b>RO</b></span>');
  swap('<link rel="preload" href="/fonts/geologica-cyrillic-wght-normal.woff2"', '<link rel="preload" href="/fonts/geologica-latin-ext-wght-normal.woff2"');
  swap('<meta property="og:url" content="https://alisa-decor.vercel.app/">', '<meta property="og:url" content="https://alisa-decor.vercel.app/ro">');
  swap('<meta property="og:image" content="https://alisa-decor.vercel.app/img/og/og-ru.jpg">', '<meta property="og:image" content="https://alisa-decor.vercel.app/img/og/og-ro.jpg">');
  swap('<meta property="og:locale" content="ru_RU">\n<meta property="og:locale:alternate" content="ro_RO">', '<meta property="og:locale" content="ro_RO">\n<meta property="og:locale:alternate" content="ru_RU">');
  // данные для Google: румынское описание, адрес страницы, язык
  out = out.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (m, j) => {
    const ld = JSON.parse(j);
    const biz = ld['@graph'].find(x => x['@type'] === 'LocalBusiness');
    biz.description = dict[biz.description.replace(/&/g, '&amp;')]?.replace(/&amp;/g, '&') || biz.description;
    biz.image = biz.image.replace('og-ru.jpg', 'og-ro.jpg');
    biz.address = { ...biz.address, addressLocality: 'Comrat', addressRegion: 'UTA Găgăuzia' };
    biz.areaServed = [{ '@type': 'City', name: 'Comrat' }, { '@type': 'AdministrativeArea', name: 'Găgăuzia' }];
    biz.makesOffer = ['Decor cu baloane pentru zile de naștere', 'Decor de nuntă', 'Fotozone din baloane', 'Decor pentru jubileu', 'Baloane-surpriză cadou', 'Decor de Anul Nou']
      .map(name => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name } }));
    const site = ld['@graph'].find(x => x['@type'] === 'WebSite');
    site.url = 'https://alisa-decor.vercel.app/ro'; site.inLanguage = 'ro';
    return '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>';
  });
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
