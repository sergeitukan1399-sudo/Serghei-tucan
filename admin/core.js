// Общая часть панели: вход через Supabase Auth и запросы к защищённому API.
// Supabase загружается с CDN; адрес проекта и публичный anon-ключ приходят с сервера (/api/config).
// Сервисного ключа и токенов Telegram в браузере нет.

const Alisa = (() => {
  let client = null;
  let cfg = null;

  async function config() {
    if (cfg) return cfg;
    const r = await fetch('/api/config', { cache: 'no-store' });
    cfg = await r.json();
    return cfg;
  }

  async function sb() {
    if (client) return client;
    const c = await config();
    if (!c.configured) throw Object.assign(new Error('Панель ещё не подключена к Supabase: добавьте переменные SUPABASE_URL и SUPABASE_ANON_KEY в настройках Vercel.'), { setup: true });
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'alisa-crm-auth' },
    });
    return client;
  }

  async function session() {
    const s = await sb();
    const { data } = await s.auth.getSession();
    return data.session || null;
  }

  async function api(path, { method = 'GET', body, raw = false } = {}) {
    const ses = await session();
    if (!ses) { location.replace('/admin/login'); throw new Error('no session'); }
    const r = await fetch(path, {
      method,
      headers: { Authorization: 'Bearer ' + ses.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (r.status === 401) { await (await sb()).auth.signOut(); location.replace('/admin/login?expired=1'); throw new Error('unauthorized'); }
    if (raw) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Ошибка ' + r.status); return r; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Ошибка ' + r.status), { status: r.status });
    return j;
  }

  async function signIn(email, password) {
    const s = await sb();
    const { error } = await s.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : error.message);
  }

  async function signOut() {
    try { await (await sb()).auth.signOut(); } catch {}
    location.replace('/admin/login');
  }

  return { config, sb, session, api, signIn, signOut };
})();

// Формат и мелочи
const TZ = 'Europe/Chisinau';
const fmt = {
  dt: iso => iso ? new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—',
  d: iso => iso ? new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '—',
  date: d => d ? String(d).slice(0, 10).split('-').reverse().join('.') : 'не определена',
  mdl: n => n == null || n === '' ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n)) + ' MDL',
  num: n => new Intl.NumberFormat('ru-RU').format(n || 0),
  pct: n => n == null ? '—' : String(n).replace('.', ',') + '%',
  month: k => { const [y, m] = k.split('-'); return ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][+m - 1] + (m === '01' ? ' ' + y.slice(2) : ''); },
};

const STATUSES = {
  new: 'Новая', contacted: 'Связались', pending: 'Ожидает решения', confirmed: 'Заказ подтверждён',
  done: 'Выполнен', rejected: 'Отказ', cancelled: 'Отменён',
};

// Безопасная сборка DOM: пользовательские данные попадают только в textContent
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;        // только для своих статичных иконок
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function toast(msg, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
