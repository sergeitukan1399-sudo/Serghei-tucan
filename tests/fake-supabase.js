// Упрощённая подмена клиента Supabase для локальных тестов: хранит данные в памяти
// и повторяет правила миграции (номер заявки, даты подтверждения/отмены, уникальность, неизменяемая история).

import crypto from 'node:crypto';

export function createFakeSupabase({ users = {}, admins = [], works = [] } = {}) {
  const tables = { leads: [], lead_events: [], admins: admins.map(a => ({ ...a })), submission_log: [], works: [] };
  const files = {};   // хранилище: bucket/path → { size, contentType }
  let leadNo = 0, evId = 0, logId = 0;
  const nowIso = () => new Date().toISOString();

  function applyInsert(table, row) {
    const r = { ...row };
    if (table === 'leads') {
      if (r.submission_id && tables.leads.some(l => l.submission_id === r.submission_id))
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "leads_submission_id_key"' } };
      Object.assign(r, {
        id: crypto.randomUUID(), lead_no: ++leadNo, created_at: r.created_at || nowIso(), updated_at: nowIso(),
        status: r.status || 'new', notify_status: r.notify_status || 'pending', notify_attempts: r.notify_attempts || 0,
        order_amount: r.order_amount ?? null, confirmed_at: r.confirmed_at ?? null, cancelled_at: null, manager_notes: r.manager_notes ?? null,
        notify_error: r.notify_error ?? null, notified_at: null, source: r.source || 'site_quiz',
      });
      r.client_phone_digits = String(r.client_phone || '').replace(/\D/g, '');
    }
    if (table === 'lead_events') Object.assign(r, { id: ++evId, created_at: nowIso() });
    if (table === 'works') {
      if (!r.title_ru) return { error: { code: '23514', message: 'violates check constraint "works_title_ru_check"' } };
      r.id = r.id || crypto.randomUUID(); r.created_at = r.created_at || nowIso(); r.updated_at = nowIso();
      for (const [k, d] of Object.entries({ sub_ru: '', desc_ru: '', title_ro: '', sub_ro: '', desc_ro: '', tags: [], sort: 0, visible: true, image_path: null, thumb_path: null })) if (r[k] === undefined) r[k] = d;
    }
    if (table === 'submission_log') Object.assign(r, { id: ++logId, created_at: nowIso() });
    tables[table].push(r);
    return { row: r };
  }

  function applyUpdate(table, row, patch) {
    if (table === 'lead_events') return { error: { message: 'История изменений заявок не редактируется и не удаляется' } };
    const old = { ...row };
    Object.assign(row, patch);
    if (table === 'works') row.updated_at = nowIso();
    if (table === 'leads') {
      row.updated_at = nowIso();
      if (patch.status !== undefined && patch.status !== old.status) {
        if ((row.status === 'confirmed' || row.status === 'done') && !row.confirmed_at) row.confirmed_at = nowIso();
        if (row.status === 'cancelled') row.cancelled_at = nowIso();
        else if (old.status === 'cancelled') row.cancelled_at = null;
      }
    }
    return {};
  }

  const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

  class Q {
    constructor(table) { this.t = table; this.filters = []; this.orders = []; this.op = 'select'; this.cols = '*'; this.opts = {}; this.rng = null; this.lim = null; this.mode = 'many'; this.ret = false; }
    select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.opts = opts; } else this.ret = true; return this; }
    insert(v) { this.op = 'insert'; this.payload = Array.isArray(v) ? v : [v]; return this; }
    update(v) { this.op = 'update'; this.payload = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
    neq(c, v) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
    in(c, vs) { this.filters.push(r => vs.map(String).includes(String(r[c]))); return this; }
    gte(c, v) { this.filters.push(r => r[c] != null && r[c] >= v); return this; }
    lt(c, v) { this.filters.push(r => r[c] != null && r[c] < v); return this; }
    lte(c, v) { this.filters.push(r => r[c] != null && r[c] <= v); return this; }
    or(expr) {
      const parts = expr.split(',').map(p => { const [col, op, ...rest] = p.split('.'); return { col, op, val: rest.join('.') }; });
      this.filters.push(r => parts.some(({ col, op, val }) => {
        if (op === 'eq') return String(r[col]) === val;
        if (op === 'ilike') { const needle = val.replace(/^%|%$/g, '').toLowerCase(); return String(r[col] ?? '').toLowerCase().includes(needle); }
        return false;
      }));
      return this;
    }
    order(c, { ascending = true, nullsFirst } = {}) { this.orders.push({ c, asc: ascending, nullsFirst }); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    pick(r) {
      if (this.cols === '*' || !this.cols) return { ...r };
      const o = {}; for (const c of this.cols.split(',').map(s => s.trim())) o[c] = r[c]; return o;
    }
    exec() {
      const rows = tables[this.t];
      if (!rows) return { data: null, error: { message: 'no table ' + this.t } };
      if (this.op === 'insert') {
        const out = [];
        for (const p of this.payload) { const r = applyInsert(this.t, p); if (r.error) return { data: null, error: r.error }; out.push(r.row); }
        return this.finish(out);
      }
      let sel = rows.filter(r => this.filters.every(f => f(r)));
      if (this.op === 'update') {
        for (const r of sel) { const e = applyUpdate(this.t, r, this.payload); if (e.error) return { data: null, error: e.error }; }
        return this.ret ? this.finish(sel) : { data: null, error: null };
      }
      if (this.op === 'delete') {
        if (this.t === 'lead_events' && sel.length) return { data: null, error: { message: 'История изменений заявок не редактируется и не удаляется' } };
        tables[this.t] = rows.filter(r => !sel.includes(r));
        return { data: null, error: null };
      }
      for (const o of [...this.orders].reverse()) sel = [...sel].sort((a, b) => { const v = cmp(a[o.c], b[o.c]); return o.asc ? v : -v; });
      const count = sel.length;
      if (this.rng) sel = sel.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) sel = sel.slice(0, this.lim);
      if (this.opts.head) return { data: null, count, error: null };
      const res = this.finish(sel);
      if (this.opts.count) res.count = count;
      return res;
    }
    finish(list) {
      const data = list.map(r => this.pick(r));
      if (this.mode === 'single') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'single row expected' } };
      if (this.mode === 'maybe') return { data: data[0] || null, error: null };
      return { data, error: null };
    }
    then(res, rej) { try { res(this.exec()); } catch (e) { rej(e); } }
  }

  for (const w of works) applyInsert('works', w);

  const storage = {
    from: bucket => ({
      async upload(path, buf, opts = {}) {
        const key = bucket + '/' + path;
        if (files[key] && !opts.upsert) return { data: null, error: { message: 'The resource already exists' } };
        files[key] = { size: buf.length, contentType: opts.contentType };
        return { data: { path }, error: null };
      },
      async remove(paths) { for (const p of paths) delete files[bucket + '/' + p]; return { data: paths, error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
    }),
  };

  return {
    tables,
    files,
    storage,
    from: t => new Q(t),
    auth: {
      async getUser(token) {
        const u = users[token];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
  };
}
