// Alisa CRM — разделы панели: Обзор, Заявки, Аналитика, Настройки.
(() => {
  const view = document.getElementById('view');
  const state = {
    me: null,
    period: { preset: 'month', from: '', to: '' },
    list: { q: '', status: '', from: '', to: '', sort: 'created_at', dir: 'desc', page: 1, per: 25 },
  };

  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>',
  };

  const statusPill = st => h('span', { class: 'st st-' + st }, STATUSES[st] || st);
  const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

  // ---------- период ----------
  function periodBar(onChange) {
    const presets = [['today', 'Сегодня'], ['month', 'Этот месяц'], ['prev_month', 'Прошлый месяц'], ['quarter', 'Квартал'], ['year', 'Год'], ['custom', 'Период']];
    const wrap = h('div', { class: 'custom' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Период' });
    const from = h('input', { class: 'inp', type: 'date', value: state.period.from, 'aria-label': 'С' });
    const to = h('input', { class: 'inp', type: 'date', value: state.period.to, 'aria-label': 'По' });
    const apply = h('button', { class: 'btn', type: 'button', onclick: () => {
      if (!from.value || !to.value) return toast('Укажите обе даты', true);
      state.period = { preset: 'custom', from: from.value, to: to.value }; onChange();
    } }, 'Показать');
    const custom = h('div', { class: 'custom', hidden: state.period.preset !== 'custom' }, from, '—', to, apply);
    presets.forEach(([k, l]) => chips.append(h('button', {
      type: 'button', class: 'chip' + (state.period.preset === k ? ' on' : ''), 'aria-pressed': String(state.period.preset === k),
      onclick: () => {
        if (k === 'custom') { state.period.preset = 'custom'; [...chips.children].forEach(c => c.classList.toggle('on', c.textContent === 'Период')); custom.hidden = false; return; }
        state.period = { preset: k, from: '', to: '' }; onChange();
      },
    }, l)));
    wrap.append(chips, custom);
    return wrap;
  }
  const periodQuery = () => qs(state.period.preset === 'custom' ? state.period : { preset: state.period.preset });

  function header(title, sub, right) {
    return h('div', { class: 'top' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null), right || null);
  }

  async function notifyBanner() {
    try {
      const me = await Alisa.api('/api/admin/me');
      state.me = me;
      if (!me.unsent_notifications) return null;
      const btn = h('button', { class: 'btn', type: 'button', html: ICON.refresh + 'Отправить повторно' });
      btn.onclick = async () => {
        btn.disabled = true;
        try { const r = await Alisa.api('/api/admin/notify', { method: 'POST', body: { all: true } }); toast(`Отправлено уведомлений: ${r.sent} из ${r.tried}`); route(); }
        catch (e) { toast(e.message, true); btn.disabled = false; }
      };
      return h('div', { class: 'banner', role: 'status' },
        h('span', {}, `Уведомлений в Telegram не доставлено: ${me.unsent_notifications}. Заявки сохранены в базе.`), me.telegram ? btn : h('span', {}, 'Telegram не настроен'));
    } catch { return null; }
  }

  // ---------- Обзор ----------
  async function overview() {
    view.replaceChildren(header('Обзор', 'Заявки и заказы за выбранный период', null), h('p', { class: 'empty' }, 'Загружаем показатели…'));
    const [st, banner, recent] = await Promise.all([
      Alisa.api('/api/admin/stats?' + periodQuery()),
      notifyBanner(),
      Alisa.api('/api/admin/leads?' + qs({ per: 10, page: 1 })),
    ]);
    const c = st.cards, x = st.extra;
    const kpis = h('div', { class: 'kpis' },
      h('div', { class: 'card kpi' }, h('span', {}, 'Заявки'), h('b', {}, fmt.num(c.leads)), h('small', {}, 'новых за период')),
      h('div', { class: 'card kpi' }, h('span', {}, 'Подтверждённые заказы'), h('b', {}, fmt.num(c.cohort_orders)), h('small', {}, 'из заявок этого периода (без отменённых)')),
      h('div', { class: 'card kpi' }, h('span', {}, 'Конверсия'), h('b', {}, fmt.pct(c.conversion)), h('small', {}, 'заказы ÷ заявки периода × 100%')),
      h('div', { class: 'card kpi acc' }, h('span', {}, 'Сумма заказов'), h('b', {}, fmt.mdl(c.orders_sum)), h('small', {}, 'договорённости по заказам, подтверждённым в периоде; это не полученная оплата')));
    const extra = h('div', { class: 'extra' },
      mini('Подтверждено в периоде', fmt.num(x.confirmed_in_period), 'по дате подтверждения'),
      mini('Средний заказ', x.avg_order == null ? '—' : fmt.mdl(x.avg_order), x.orders_without_amount ? `без суммы: ${x.orders_without_amount}` : ''),
      mini('Ждут ответа', fmt.num(x.awaiting_reply), 'статус «Новая», все'),
      mini('Отказы', fmt.num(x.rejected), 'из заявок периода'),
      mini('Отменено в периоде', fmt.num(x.cancelled_in_period), ''));

    const list = h('div', { class: 'card' });
    list.append(h('div', { class: 'pad sec-h', style: 'margin:0;padding-bottom:6px' }, h('h2', {}, 'Последние заявки'), h('a', { href: '#leads' }, 'Все заявки →')));
    list.append(recent.items.length ? recentList(recent.items) : h('div', { class: 'empty' }, h('b', {}, 'Заявок пока нет'), 'Новые заявки с сайта появятся здесь автоматически.'));

    const byType = h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Конверсия по праздникам'), h('small', {}, st.period.label)), typeTable(st.by_type));

    view.replaceChildren(header('Обзор', `Период: ${st.period.label} · время Кишинёва`, periodBar(overview)), banner || '', kpis, extra, h('div', { class: 'grid2' }, list, byType));
  }
  function recentList(items) {
    return h('div', { class: 'tbl-wrap', style: 'display:block' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Клиент'), h('th', {}, 'Праздник'), h('th', {}, 'Статус'))),
      h('tbody', {}, items.map(l => h('tr', { tabindex: '0', onclick: () => openLead(l.id), onkeydown: e => { if (e.key === 'Enter') openLead(l.id); } },
        h('td', { class: 'num' }, l.lead_no),
        h('td', {}, h('span', { class: 'nm' }, l.client_name), h('span', { class: 'sub' }, fmt.dt(l.created_at))),
        h('td', {}, l.event_type),
        h('td', {}, statusPill(l.status)))))));
  }
  const mini = (l, v, s) => h('div', { class: 'card mini' }, h('span', {}, l), h('b', {}, v), s ? h('span', {}, s) : null);

  function typeTable(rows) {
    if (!rows.length) return Charts.empty('Пока нет заявок за этот период');
    return h('div', { class: 'tbl-wrap', style: 'display:block' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Праздник'), h('th', {}, 'Заявки'), h('th', {}, 'Заказы'), h('th', {}, 'Конверсия'))),
      h('tbody', {}, rows.map(r => h('tr', { style: 'cursor:default' }, h('td', {}, r.type), h('td', { class: 'num' }, r.leads), h('td', { class: 'num' }, r.orders), h('td', { class: 'num' }, fmt.pct(r.conversion)))))));
  }

  // ---------- Заявки ----------
  function leadsTable(items, withMobile = true) {
    const L = state.list;
    const th = (key, label) => h('th', {}, key ? h('button', { type: 'button', onclick: () => { if (L.sort === key) L.dir = L.dir === 'asc' ? 'desc' : 'asc'; else { L.sort = key; L.dir = key === 'client_name' ? 'asc' : 'desc'; } L.page = 1; leads(); } },
      label + (L.sort === key ? (L.dir === 'asc' ? ' ↑' : ' ↓') : '')) : label);
    const sortable = withMobile;
    const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {},
        th(sortable && 'lead_no', '№'), th(sortable && 'created_at', 'Поступила'), th(sortable && 'client_name', 'Клиент'), th(null, 'Праздник'),
        th(sortable && 'event_date', 'Дата праздника'), th(null, 'Бюджет'), th(sortable && 'status', 'Статус'), th(sortable && 'order_amount', 'Сумма'), th(null, ''))),
      h('tbody', {}, items.map(l => h('tr', { tabindex: '0', onclick: () => openLead(l.id), onkeydown: e => { if (e.key === 'Enter') openLead(l.id); } },
        h('td', { class: 'num' }, l.lead_no),
        h('td', { class: 'num' }, fmt.dt(l.created_at)),
        h('td', {}, h('span', { class: 'nm' }, l.client_name), h('span', { class: 'sub' }, l.client_phone + (l.contact_method ? ' · ' + l.contact_method : ''))),
        h('td', {}, l.event_type),
        h('td', { class: 'num' }, fmt.date(l.event_date)),
        h('td', {}, l.budget_range || '—'),
        h('td', {}, statusPill(l.status), l.notify_status !== 'sent' ? h('span', { class: 'warn-dot', title: 'Уведомление в Telegram не доставлено' }) : null),
        h('td', { class: 'num' }, l.order_amount == null ? '—' : fmt.mdl(l.order_amount)),
        h('td', {}, h('a', { href: 'tel:' + l.client_phone.replace(/[^\d+]/g, ''), onclick: e => e.stopPropagation(), 'aria-label': 'Позвонить ' + l.client_name, html: ICON.phone, class: 'btn ghost', style: 'min-height:34px;padding:0 10px' })))))));
    const mob = h('div', { class: 'mcards' }, items.map(l => h('button', { class: 'mcard', type: 'button', onclick: () => openLead(l.id) },
      h('div', { class: 'r1' }, h('b', {}, `№${l.lead_no} · ${l.client_name}`), statusPill(l.status)),
      h('div', { class: 'r2' }, h('span', {}, `${l.event_type} · ${fmt.date(l.event_date)}`), h('span', {}, fmt.dt(l.created_at))),
      h('div', { class: 'r2' }, h('span', {}, l.client_phone), h('span', {}, l.order_amount == null ? (l.budget_range || '') : fmt.mdl(l.order_amount))))));
    return h('div', {}, table, mob);
  }

  let searchTimer;
  async function leads() {
    const L = state.list;
    const search = h('input', { class: 'inp search', type: 'search', placeholder: 'Поиск по имени, телефону или №', value: L.q, 'aria-label': 'Поиск' });
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { L.q = search.value.trim(); L.page = 1; loadList(); }, 350); };
    const status = h('select', { class: 'sel', 'aria-label': 'Статус' }, h('option', { value: '' }, 'Все статусы'), h('option', { value: 'active' }, 'Действующие заказы'),
      Object.entries(STATUSES).map(([k, v]) => h('option', { value: k }, v)));
    status.value = L.status; status.onchange = () => { L.status = status.value; L.page = 1; loadList(); };
    const from = h('input', { class: 'inp', type: 'date', value: L.from, 'aria-label': 'Поступила с' });
    const to = h('input', { class: 'inp', type: 'date', value: L.to, 'aria-label': 'Поступила по' });
    from.onchange = to.onchange = () => { L.from = from.value; L.to = to.value; L.page = 1; loadList(); };
    const exp = h('button', { class: 'btn pri', type: 'button', html: ICON.dl + 'Экспорт' });
    exp.onclick = async () => {
      exp.disabled = true;
      try {
        const r = await Alisa.api('/api/admin/export?' + qs({ q: L.q, status: L.status, from: L.from, to: L.to, sort: L.sort, dir: L.dir }), { raw: true });
        const blob = await r.blob();
        const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'zayavki.csv';
        const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) { toast(e.message, true); } finally { exp.disabled = false; }
    };
    const box = h('div', { class: 'card', id: 'listBox' });
    view.replaceChildren(header('Заявки', 'Нажмите на заявку, чтобы открыть карточку клиента'), (await notifyBanner()) || '',
      h('div', { class: 'toolbar' }, search, status, from, to, exp), box);
    await loadList();
  }

  async function loadList() {
    const L = state.list, box = document.getElementById('listBox');
    if (!box) return;
    box.classList.add('loading');
    try {
      const r = await Alisa.api('/api/admin/leads?' + qs(L));
      const pages = Math.max(1, Math.ceil(r.total / r.per));
      const pager = h('div', { class: 'pager' }, h('span', {}, r.total ? `Показано ${(r.page - 1) * r.per + 1}–${Math.min(r.page * r.per, r.total)} из ${r.total}` : ''),
        h('div', { class: 'chips' },
          h('button', { class: 'btn', type: 'button', disabled: r.page <= 1, onclick: () => { L.page--; loadList(); } }, '← Назад'),
          h('span', { style: 'align-self:center;padding:0 6px' }, `${r.page} / ${pages}`),
          h('button', { class: 'btn', type: 'button', disabled: r.page >= pages, onclick: () => { L.page++; loadList(); } }, 'Далее →')));
      box.replaceChildren(r.items.length ? leadsTable(r.items) : h('div', { class: 'empty' }, h('b', {}, L.q || L.status || L.from || L.to ? 'Ничего не найдено' : 'Заявок пока нет'),
        L.q || L.status || L.from || L.to ? 'Измените поиск или фильтры.' : 'Новые заявки с сайта появятся здесь автоматически.'), r.total > r.per ? pager : '');
    } catch (e) { box.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Не удалось загрузить заявки'), e.message)); }
    finally { box.classList.remove('loading'); }
  }

  // ---------- карточка заявки ----------
  const EVENT_LABEL = {
    created: 'Заявка поступила с сайта', status: 'Статус изменён', amount: 'Сумма заказа изменена', notes: 'Заметки менеджера',
    notify_sent: 'Уведомление доставлено в Telegram', notify_failed: 'Уведомление в Telegram не доставлено', notify_retry: 'Повторная отправка уведомления',
  };
  function evText(e) {
    if (e.action === 'status') return `${STATUSES[e.old_value] || e.old_value || '—'} → ${STATUSES[e.new_value] || e.new_value}`;
    if (e.action === 'amount') return `${e.old_value == null ? '—' : fmt.mdl(e.old_value)} → ${e.new_value == null ? '—' : fmt.mdl(e.new_value)}`;
    return e.new_value || '';
  }

  async function openLead(id) {
    closeDrawer();
    const bg = h('div', { class: 'drawer-bg', onclick: closeDrawer });
    const dr = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Карточка заявки' }, h('div', { class: 'dr-b' }, h('p', { class: 'empty' }, 'Загрузка…')));
    document.body.append(bg, dr);
    document.addEventListener('keydown', escClose);
    try { renderLead(dr, await Alisa.api('/api/admin/lead?id=' + encodeURIComponent(id))); }
    catch (e) { dr.replaceChildren(h('div', { class: 'dr-b' }, h('p', { class: 'err-msg' }, e.message), h('button', { class: 'btn', onclick: closeDrawer }, 'Закрыть'))); }
  }
  function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
  function closeDrawer() { document.querySelectorAll('.drawer,.drawer-bg').forEach(n => n.remove()); document.removeEventListener('keydown', escClose); }

  function renderLead(dr, { lead: l, events }) {
    const digits = l.client_phone.replace(/\D/g, '');
    const tel = l.client_phone.replace(/[^\d+]/g, '');
    const ans = h('dl', { class: 'ans' },
      h('dt', {}, '1. Праздник'), h('dd', {}, l.event_type),
      h('dt', {}, '2. Дата'), h('dd', {}, fmt.date(l.event_date)),
      h('dt', {}, '3. Место'), h('dd', {}, [l.event_location, l.event_city].filter(Boolean).join(', ') || '—'),
      h('dt', {}, '4. Стиль'), h('dd', {}, l.event_style || '—'),
      h('dt', {}, '5. Бюджет'), h('dd', {}, l.budget_range || '—'),
      h('dt', {}, '6. Имя'), h('dd', {}, l.client_name),
      h('dt', {}, 'Телефон'), h('dd', {}, h('a', { href: 'tel:' + tel }, l.client_phone)),
      h('dt', {}, 'Способ связи'), h('dd', {}, l.contact_method || '—'),
      h('dt', {}, 'Комментарий'), h('dd', { style: 'white-space:pre-wrap' }, l.comment || '—'),
      h('dt', {}, 'Источник'), h('dd', {}, { site_quiz: 'Квиз на сайте', site_quiz_ro: 'Квиз на сайте, румынская версия' }[l.source] || l.source));
    const contact = h('div', { class: 'contact' },
      h('a', { class: 'btn pri', href: 'tel:' + tel, html: ICON.phone + 'Позвонить' }),
      h('a', { class: 'btn', href: 'https://wa.me/' + digits, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
      h('a', { class: 'btn', href: 'viber://chat?number=%2B' + digits }, 'Viber'));

    const status = h('select', { class: 'sel', id: 'fStatus' }, Object.entries(STATUSES).map(([k, v]) => h('option', { value: k }, v)));
    status.value = l.status;
    const amount = h('input', { class: 'inp', id: 'fAmount', inputmode: 'decimal', placeholder: 'например, 3500', value: l.order_amount == null ? '' : String(Number(l.order_amount)) });
    const notes = h('textarea', { class: 'inp', id: 'fNotes', maxlength: '4000', placeholder: 'Детали договорённости, цвета, адрес, время монтажа…' }, l.manager_notes || '');
    const msg = h('span', { class: 'save-msg', role: 'status' });
    const hint = h('p', { class: 'err-msg', hidden: true });
    const upd = () => { const need = ['confirmed', 'done'].includes(status.value) && !amount.value.trim(); hint.textContent = need ? 'Укажите сумму заказа — без неё он не попадёт в «Сумму заказов».' : ''; hint.hidden = !need; };
    status.onchange = amount.oninput = upd; upd();
    const save = h('button', { class: 'btn pri', type: 'button' }, 'Сохранить');
    save.onclick = async () => {
      save.disabled = true; msg.textContent = '';
      try {
        const r = await Alisa.api('/api/admin/lead?id=' + encodeURIComponent(l.id), { method: 'PATCH', body: { status: status.value, order_amount: amount.value.trim(), manager_notes: notes.value } });
        renderLead(dr, r); toast('Сохранено'); if (document.getElementById('listBox')) loadList();
      } catch (e) { msg.className = 'err-msg'; msg.textContent = e.message; save.disabled = false; }
    };

    const notifyBox = l.notify_status === 'sent'
      ? h('p', { class: 'save-msg', style: 'margin:0' }, `Уведомление доставлено в Telegram ${fmt.dt(l.notified_at)}`)
      : h('div', {}, h('p', { class: 'err-msg', style: 'margin:0 0 8px' }, `Уведомление в Telegram не доставлено${l.notify_error ? ': ' + l.notify_error : ''}. Заявка сохранена.`),
        h('button', { class: 'btn', type: 'button', html: ICON.refresh + 'Отправить повторно', onclick: async ev => {
          ev.currentTarget.disabled = true;
          try { const r = await Alisa.api('/api/admin/notify', { method: 'POST', body: { id: l.id } }); toast(r.ok ? 'Уведомление отправлено' : 'Не удалось: ' + (r.error || r.reason), !r.ok); renderLead(dr, await Alisa.api('/api/admin/lead?id=' + l.id)); }
          catch (e) { toast(e.message, true); }
        } }));

    const hist = h('ol', { class: 'hist' }, [...events].reverse().map(e => h('li', {}, h('div', {},
      h('b', {}, EVENT_LABEL[e.action] || e.action), evText(e) ? h('div', {}, evText(e)) : null,
      h('time', {}, fmt.dt(e.created_at) + (e.actor_email ? ' · ' + e.actor_email : ''))))));

    dr.replaceChildren(
      h('div', { class: 'dr-h' }, h('div', {}, h('h2', {}, `Заявка №${l.lead_no} · ${l.client_name}`), h('small', {}, 'Поступила ' + fmt.dt(l.created_at))),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Закрыть', html: ICON.x, onclick: closeDrawer })),
      h('div', { class: 'dr-b' },
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Ответы квиза'), statusPill(l.status)), ans, contact),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Работа с заказом')),
          h('div', { class: 'form-row' }, h('label', { class: 'f' }, 'Статус', status), h('label', { class: 'f' }, 'Сумма заказа, MDL', amount)),
          hint,
          h('label', { class: 'f', style: 'margin-top:12px' }, 'Заметки менеджера (видны только в панели)', notes),
          h('div', { style: 'display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap' }, save, msg),
          l.confirmed_at ? h('p', { style: 'margin:10px 0 0;font-size:13px;color:var(--muted)' }, 'Заказ подтверждён ' + fmt.dt(l.confirmed_at) + (l.status === 'cancelled' ? ` · отменён ${fmt.dt(l.cancelled_at)}` : '')) : null),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Уведомление')), notifyBox),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'История изменений')), events.length ? hist : h('p', { class: 'empty' }, 'Изменений пока нет'))));
  }

  // ---------- Аналитика ----------
  async function analytics() {
    view.replaceChildren(header('Аналитика', 'Загрузка…'));
    const st = await Alisa.api('/api/admin/stats?' + periodQuery());
    const labels = st.monthly.map(m => fmt.month(m.month));
    const card = (title, sub, body) => h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, title), h('small', {}, sub)), body);
    view.replaceChildren(
      header('Аналитика', `Графики по месяцам — последние 12 месяцев. Распределение праздников — за период «${st.period.label}».`, periodBar(analytics)),
      h('div', { class: 'grid2' },
        card('Заявки и заказы', 'по месяцу поступления заявки', Charts.bars(labels, [
          { name: 'Заявки', color: Charts.colors.b, values: st.monthly.map(m => m.leads) },
          { name: 'Стали заказом', color: Charts.colors.a, values: st.monthly.map(m => m.orders) }], { title: 'Заявки и заказы по месяцам' })),
        card('Конверсия', 'заказы ÷ заявки месяца', Charts.line(labels, st.monthly.map(m => m.conversion), { title: 'Конверсия по месяцам' })),
        card('Популярные праздники', st.period.label, Charts.hbars(st.popular.map(p => ({ label: p.type, value: p.leads })))),
        card('Сумма заказов', 'по месяцу подтверждения, MDL', Charts.bars(labels, [{ name: 'Сумма заказов', color: Charts.colors.d, values: st.monthly.map(m => m.amount), fmt: fmt.mdl }], { title: 'Сумма заказов по месяцам' }))),
      h('div', { class: 'card pad', style: 'margin-top:14px' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Конверсия по типу праздника'), h('small', {}, st.period.label)), typeTable(st.by_type)));
  }

  // ---------- Настройки ----------
  async function settings() {
    const me = await Alisa.api('/api/admin/me');
    const ok = (b, yes, no) => h('span', { class: b ? 'stat-ok' : 'stat-no' }, b ? yes : no);
    const p1 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', minlength: '10', placeholder: 'Не короче 10 символов' });
    const p2 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Повторите пароль' });
    const pmsg = h('span', { role: 'status' });
    const pbtn = h('button', { class: 'btn pri', type: 'button', onclick: async () => {
      pmsg.className = 'err-msg';
      if (p1.value.length < 10) return (pmsg.textContent = 'Пароль должен быть не короче 10 символов');
      if (p1.value !== p2.value) return (pmsg.textContent = 'Пароли не совпадают');
      const { error } = await (await Alisa.sb()).auth.updateUser({ password: p1.value });
      if (error) return (pmsg.textContent = error.message);
      p1.value = p2.value = ''; pmsg.className = 'save-msg'; pmsg.textContent = 'Пароль изменён';
    } }, 'Сменить пароль');
    const retry = h('button', { class: 'btn', type: 'button', html: ICON.refresh + 'Отправить неотправленные', disabled: !me.unsent_notifications || !me.telegram });
    retry.onclick = async () => { retry.disabled = true; try { const r = await Alisa.api('/api/admin/notify', { method: 'POST', body: { all: true } }); toast(`Отправлено: ${r.sent} из ${r.tried}`); settings(); } catch (e) { toast(e.message, true); retry.disabled = false; } };

    const hookState = h('span', {}, me.telegram ? 'проверяю…' : 'сначала настройте Telegram');
    const hookBtn = h('button', { class: 'btn', type: 'button', html: ICON.refresh + 'Подключить заново', hidden: !me.telegram });
    const showHook = st => { hookState.replaceChildren(st.ok ? h('span', { class: 'stat-ok' }, 'работают') : h('span', { class: 'stat-no' }, 'не подключены' + (st.last_error ? ': ' + st.last_error : ''))); };
    if (me.telegram) Alisa.api('/api/admin/notify', { method: 'POST', body: { action: 'webhook_status' } }).then(showHook).catch(e => hookState.replaceChildren(h('span', { class: 'stat-no' }, e.message)));
    hookBtn.onclick = async () => { hookBtn.disabled = true; try { const st = await Alisa.api('/api/admin/notify', { method: 'POST', body: { action: 'webhook_setup' } }); showHook(st); toast(st.ok ? 'Кнопки в Telegram подключены' : 'Не удалось подключить', !st.ok); } catch (e) { toast(e.message, true); } finally { hookBtn.disabled = false; } };

    view.replaceChildren(header('Настройки', 'Учётная запись и состояние интеграций'),
      h('div', { class: 'grid2' },
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Учётная запись')),
          h('p', {}, 'Вы вошли как ', h('b', {}, me.admin.email)),
          h('div', { style: 'display:grid;gap:10px;max-width:360px' }, h('label', { class: 'f' }, 'Новый пароль', p1), h('label', { class: 'f' }, 'Ещё раз', p2), h('div', {}, pbtn), pmsg),
          h('p', { style: 'font-size:13px;color:var(--muted)' }, 'Новых администраторов добавляет владелец проекта в Supabase — публичной регистрации нет.')),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Интеграции')),
          h('dl', { class: 'defs' },
            h('dt', {}, 'База заявок (Supabase)'), h('dd', {}, ok(true, 'подключена', '')),
            h('dt', {}, 'Уведомления в Telegram'), h('dd', {}, ok(me.telegram, 'настроены на сервере', 'не настроены — добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в Vercel')),
            h('dt', {}, 'Кнопки статусов в Telegram'), h('dd', {}, hookState, ' ', hookBtn),
            h('dt', {}, 'Неотправленные уведомления'), h('dd', {}, String(me.unsent_notifications), ' ', retry),
            h('dt', {}, 'Ежедневный автоповтор'), h('dd', {}, ok(me.cron, 'включён (CRON_SECRET задан)', 'выключен — задайте CRON_SECRET в Vercel')),
            h('dt', {}, 'Часовой пояс'), h('dd', {}, 'Europe/Chisinau; в базе время хранится в UTC'))),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Статусы заявок')),
          h('dl', { class: 'defs' }, [
            ['new', 'заявка поступила, с клиентом ещё не связались'], ['contacted', 'менеджер начал обсуждать оформление'], ['pending', 'клиент рассматривает предложение'],
            ['confirmed', 'клиент согласовал заказ — фиксируется дата подтверждения'], ['done', 'оформление завершено'], ['rejected', 'клиент отказался'],
            ['cancelled', 'подтверждённый заказ отменён; дата подтверждения и история сохраняются']].map(([k, d]) => [h('dt', {}, statusPill(k)), h('dd', {}, d)]))),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Как считаются показатели')),
          h('dl', { class: 'defs' },
            h('dt', {}, 'Заявки'), h('dd', {}, 'созданные в выбранном периоде'),
            h('dt', {}, 'Подтверждённые заказы'), h('dd', {}, 'заявки периода, которые сейчас в статусе «Заказ подтверждён» или «Выполнен»'),
            h('dt', {}, 'Конверсия'), h('dd', {}, 'подтверждённые заказы ÷ все заявки периода × 100%; отменённые не учитываются'),
            h('dt', {}, 'Подтверждено в периоде'), h('dd', {}, 'заказы, подтверждённые в эти даты, даже если заявка пришла раньше'),
            h('dt', {}, 'Сумма заказов'), h('dd', {}, 'сумма действующих заказов, подтверждённых в периоде; это договорённости, а не полученная оплата')))));
  }

  // ---------- Галерея работ ----------
  const gal = { items: [], tags: {} };

  // Фото сжимается в браузере: крупное — до 1200 px по длинной стороне, миниатюра — 240 px в ширину.
  // WebP, а если браузер его не умеет кодировать (Safari) — JPEG.
  async function prepImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Выберите фото в формате JPG, PNG или WebP.');
    if (file.size > 40e6) throw new Error('Файл больше 40 МБ — выберите фото поменьше.');
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Не удалось открыть фото.')); im.src = URL.createObjectURL(file); });
    }
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    if (w0 < 400 || h0 < 400) throw new Error('Фото слишком маленькое: нужно хотя бы 400 × 400 пикселей.');
    const enc = (w, hgt, q) => {
      const c = document.createElement('canvas'); c.width = w; c.height = hgt;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, w, hgt);
      const url = c.toDataURL('image/webp', q);
      return url.startsWith('data:image/webp') ? url : c.toDataURL('image/jpeg', q);
    };
    const s = Math.min(1, 1200 / Math.max(w0, h0));
    const W = Math.round(w0 * s), H = Math.round(h0 * s);
    let image = enc(W, H, 0.82);
    if (image.length > 3.2e6) image = enc(W, H, 0.65);
    const thumb = enc(240, Math.min(400, Math.round(H / W * 240)), 0.78);
    return { image, thumb, w: W, h: H };
  }

  async function gallery() {
    view.replaceChildren(header('Галерея', 'Загрузка…'));
    const r = await Alisa.api('/api/admin/works');
    gal.items = r.items; gal.tags = r.tags;
    renderGallery();
  }

  function renderGallery() {
    const add = h('button', { class: 'btn pri', type: 'button', onclick: () => editWork(null) }, '+ Добавить работу');
    const shown = gal.items.filter(w => w.visible).length;
    const box = h('div', { class: 'gal' }, gal.items.map((w, k) => {
      const move = async d => {
        const ids = gal.items.map(x => x.id); const j = k + d;
        if (j < 0 || j >= ids.length) return;
        [ids[k], ids[j]] = [ids[j], ids[k]];
        try { gal.items = (await Alisa.api('/api/admin/works', { method: 'POST', body: { action: 'reorder', ids } })).items; renderGallery(); }
        catch (e) { toast(e.message, true); }
      };
      const toggle = async () => {
        try { const x = await Alisa.api('/api/admin/works?id=' + w.id, { method: 'PATCH', body: { visible: !w.visible } }); gal.items[k] = x.work; renderGallery(); toast(x.work.visible ? 'Работа показана на сайте' : 'Работа скрыта с сайта'); }
        catch (e) { toast(e.message, true); }
      };
      return h('article', { class: 'gw' + (w.visible ? '' : ' off') },
        h('button', { class: 'gw-ph', type: 'button', onclick: () => editWork(w), 'aria-label': 'Изменить: ' + w.title_ru },
          h('img', { src: absImg(w.thumb_url), alt: '', loading: 'lazy' }),
          h('span', { class: 'gw-n' }, String(k + 1)), w.visible ? null : h('span', { class: 'gw-hid' }, 'Скрыта')),
        h('div', { class: 'gw-b' },
          h('b', {}, w.title_ru), h('small', {}, w.sub_ru || ' '),
          h('div', { class: 'gw-tags' }, (w.tags || []).map(t => h('span', {}, gal.tags[t] || t))),
          w.title_ro ? null : h('small', { class: 'gw-warn' }, 'Нет перевода на румынский')),
        h('div', { class: 'gw-a' },
          h('button', { class: 'btn sm', type: 'button', title: 'Выше', 'aria-label': 'Переместить выше', disabled: k === 0, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn sm', type: 'button', title: 'Ниже', 'aria-label': 'Переместить ниже', disabled: k === gal.items.length - 1, onclick: () => move(1) }, '↓'),
          h('button', { class: 'btn sm', type: 'button', onclick: toggle }, w.visible ? 'Скрыть' : 'Показать'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => editWork(w) }, 'Изменить')));
    }));
    view.replaceChildren(
      header('Галерея', `Блок «Наши работы» на сайте: на сайте ${shown} из ${gal.items.length}. Порядок здесь — порядок на сайте. Изменения появляются в течение минуты.`, add),
      gal.items.length ? box : h('div', { class: 'card empty' }, h('b', {}, 'Работ пока нет'), 'Нажмите «Добавить работу», чтобы загрузить первое фото.'));
  }

  // Стартовые работы лежат в папке сайта (img/…), новые — в хранилище по полной ссылке
  const absImg = u => /^https?:/.test(u) ? u : '/' + String(u).replace(/^\/+/, '');

  function editWork(w) {
    closeDrawer();
    const isNew = !w;
    const v = w || { title_ru: '', sub_ru: '', desc_ru: '', title_ro: '', sub_ro: '', desc_ro: '', tags: [], visible: true };
    let photo = null;
    const inp = (k, max, ph) => h('input', { class: 'inp', maxlength: String(max), value: v[k] || '', placeholder: ph || '' });
    const area = (k, ph) => h('textarea', { class: 'inp', maxlength: '300', rows: '3', placeholder: ph || '' }, v[k] || '');
    const f = {
      title_ru: inp('title_ru', 80, 'Например, Юбилей 50 лет'), sub_ru: inp('sub_ru', 80, 'Короткая подпись: Чёрно-золотая фотозона'), desc_ru: area('desc_ru', 'Одно-два предложения: что сделали'),
      title_ro: inp('title_ro', 80, 'De exemplu, Jubileu de 50 de ani'), sub_ro: inp('sub_ro', 80, 'Fotozonă negru cu auriu'), desc_ro: area('desc_ro', 'Una-două propoziții'),
    };
    const vis = h('input', { type: 'checkbox' }); vis.checked = v.visible !== false;
    const tagBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Категории' }, Object.entries(gal.tags).map(([k, label]) => {
      const b = h('button', { type: 'button', class: 'chip' + (v.tags.includes(k) ? ' on' : ''), 'aria-pressed': String(v.tags.includes(k)), 'data-k': k }, label);
      b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
      return b;
    }));
    const prev = h('img', { class: 'ge-img', alt: '', src: w ? absImg(w.image_url) : '', hidden: !w });
    const pmsg = h('p', { class: 'gw-hint' }, isNew ? 'JPG, PNG или WebP. Фото уменьшится до 1200 px и сожмётся автоматически.' : 'Чтобы заменить фото, выберите новый файл.');
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'ge-file' });
    file.onchange = async () => {
      const fl = file.files[0]; if (!fl) return;
      pmsg.className = 'gw-hint'; pmsg.textContent = 'Обрабатываю фото…';
      try { photo = await prepImage(fl); prev.src = photo.image; prev.hidden = false; pmsg.textContent = `Готово: ${photo.w} × ${photo.h} px, ${Math.round(photo.image.length * 0.75 / 1024)} КБ.`; }
      catch (e) { photo = null; pmsg.className = 'err-msg'; pmsg.textContent = e.message; file.value = ''; }
    };
    const msg = h('span', { class: 'save-msg', role: 'status' });
    const save = h('button', { class: 'btn pri', type: 'button' }, isNew ? 'Добавить на сайт' : 'Сохранить');
    save.onclick = async () => {
      msg.className = 'err-msg';
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      body.tags = [...tagBox.querySelectorAll('.chip.on')].map(b => b.dataset.k);
      body.visible = vis.checked;
      if (!body.title_ru.trim()) { msg.textContent = 'Укажите название на русском.'; f.title_ru.focus(); return; }
      if (!body.tags.length) { msg.textContent = 'Выберите хотя бы одну категорию.'; return; }
      if (isNew && !photo) { msg.textContent = 'Добавьте фото работы.'; return; }
      if (photo) { body.image = photo.image; body.thumb = photo.thumb; }
      save.disabled = true; msg.className = 'save-msg'; msg.textContent = photo ? 'Загружаю фото…' : 'Сохраняю…';
      try {
        const r = isNew ? await Alisa.api('/api/admin/works', { method: 'POST', body }) : await Alisa.api('/api/admin/works?id=' + w.id, { method: 'PATCH', body });
        closeDrawer(); toast(isNew ? 'Работа добавлена в галерею' : 'Сохранено');
        await gallery();
      } catch (e) { msg.className = 'err-msg'; msg.textContent = e.message; save.disabled = false; }
    };
    let armed = false;
    const del = isNew ? null : h('button', { class: 'btn danger', type: 'button' }, 'Удалить работу');
    if (del) del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = 'Нажмите ещё раз, чтобы удалить навсегда'; setTimeout(() => { armed = false; del.textContent = 'Удалить работу'; }, 4000); return; }
      del.disabled = true;
      try { await Alisa.api('/api/admin/works?id=' + w.id, { method: 'DELETE' }); closeDrawer(); toast('Работа удалена'); await gallery(); }
      catch (e) { toast(e.message, true); del.disabled = false; }
    };

    const bg = h('div', { class: 'drawer-bg', onclick: closeDrawer });
    const dr = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Новая работа' : 'Работа' },
      h('div', { class: 'dr-h' }, h('div', {}, h('h2', {}, isNew ? 'Новая работа' : v.title_ru), h('small', {}, 'Блок «Наши работы» на сайте')),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Закрыть', html: ICON.x, onclick: closeDrawer })),
      h('div', { class: 'dr-b' },
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Фото')), prev, h('label', { class: 'btn ge-pick' }, isNew ? 'Выбрать фото' : 'Заменить фото', file), pmsg),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Категории'), h('small', {}, 'по ним работает фильтр на сайте')), tagBox,
          h('label', { class: 'ge-vis' }, vis, 'Показывать на сайте')),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Русский')),
          h('div', { class: 'ge-f' }, h('label', { class: 'f' }, 'Название *', f.title_ru), h('label', { class: 'f' }, 'Подзаголовок', f.sub_ru), h('label', { class: 'f' }, 'Описание', f.desc_ru))),
        h('div', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', {}, 'Română'), h('small', {}, 'для румынской версии сайта; если пусто — покажется русский текст')),
          h('div', { class: 'ge-f' }, h('label', { class: 'f' }, 'Titlu', f.title_ro), h('label', { class: 'f' }, 'Subtitlu', f.sub_ro), h('label', { class: 'f' }, 'Descriere', f.desc_ro))),
        h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, save, msg),
        del ? h('div', { style: 'margin-top:8px' }, del) : null));
    document.body.append(bg, dr);
    document.addEventListener('keydown', escClose);
    (isNew ? file : f.title_ru).focus();
  }

  // ---------- маршруты ----------
  const ROUTES = { overview, leads, gallery, analytics, settings };
  async function route() {
    let r = (location.hash || '#overview').slice(1);
    const deep = /^lead=([0-9a-f-]{36})$/i.exec(r);       // ссылка «Открыть в панели» из Telegram
    if (deep) r = 'leads';
    const fn = ROUTES[r] || overview;
    document.querySelectorAll('.nav a[data-r]').forEach(a => { const on = a.dataset.r === (ROUTES[r] ? r : 'overview'); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    closeDrawer();
    try { await fn(); if (deep) { history.replaceState(null, '', '#leads'); openLead(deep[1]); } } catch (e) { if (e.message !== 'unauthorized' && e.message !== 'no session') view.replaceChildren(header('Ошибка'), h('div', { class: 'card pad' }, h('p', { class: 'err-msg' }, e.message), h('button', { class: 'btn', onclick: route }, 'Повторить'))); }
  }

  (async () => {
    const boot = document.getElementById('boot');
    try {
      if (!(await Alisa.session())) { Alisa.rememberTarget(); return location.replace('/admin/login'); }
      const me = await Alisa.api('/api/admin/me');
      state.me = me;
      document.getElementById('who').textContent = me.admin.email;
      boot.remove(); document.getElementById('app').hidden = false;
      document.getElementById('logout').onclick = e => { e.preventDefault(); Alisa.signOut(); };
      addEventListener('hashchange', route);
      route();
    } catch (e) {
      if (e.status === 403) { await (await Alisa.sb()).auth.signOut(); location.replace('/admin/login'); return; }
      if (e.message === 'unauthorized' || e.message === 'no session') return;
      boot.replaceChildren(h('div', { class: 'card pad', style: 'max-width:520px' }, h('h1', { style: 'font-size:20px;margin:0 0 8px' }, 'Панель недоступна'), h('p', {}, e.message)));
    }
  })();
})();
