// Простые графики на SVG без сторонних библиотек: столбцы, линия, горизонтальные полосы.
// При отсутствии данных показывается пустое состояние, а не выдуманные значения.

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, a = {}, txt) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
  const C = { a: '#2b7a6c', b: '#bfded6', d: '#12352f', grid: '#e5ece9' };

  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const short = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + ' млн' : v >= 1e3 ? Math.round(v / 1e3) + ' тыс' : String(Math.round(v * 10) / 10);

  function empty(msg = 'Пока нет данных за этот период') { const d = document.createElement('div'); d.className = 'chart-empty'; d.textContent = msg; return d; }

  function frame(labels, max, { W = 640, H = 240, unit = '' } = {}) {
    const P = { l: 44, r: 8, t: 10, b: 28 };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    for (let i = 0; i <= 4; i++) {
      const y = P.t + ih - (ih * i) / 4;
      svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, stroke: C.grid }));
      svg.append(s('text', { x: P.l - 6, y: y + 4, 'text-anchor': 'end' }, short((max * i) / 4) + unit));
    }
    const step = iw / labels.length;
    labels.forEach((l, i) => svg.append(s('text', { x: P.l + step * i + step / 2, y: H - 8, 'text-anchor': 'middle' }, l)));
    return { svg, P, iw, ih, step, W, H };
  }

  function bars(labels, series, { unit = '', title = '' } = {}) {
    const all = series.flatMap(x => x.values);
    if (!all.some(v => v > 0)) return empty();
    const max = niceMax(Math.max(...all));
    const f = frame(labels, max, { unit });
    f.svg.setAttribute('aria-label', title);
    const gw = f.step * 0.7, bw = gw / series.length;
    labels.forEach((l, i) => series.forEach((sr, k) => {
      const v = sr.values[i] || 0, hgt = (f.ih * v) / max;
      const x = f.P.l + f.step * i + (f.step - gw) / 2 + bw * k;
      const r = s('rect', { x: x + 1, y: f.P.t + f.ih - hgt, width: Math.max(bw - 2, 2), height: Math.max(hgt, v > 0 ? 2 : 0), rx: 3, fill: sr.color });
      r.append(s('title', {}, `${l}: ${sr.name} — ${sr.fmt ? sr.fmt(v) : v}`));
      f.svg.append(r);
    }));
    const wrap = document.createElement('div');
    const lg = document.createElement('div'); lg.className = 'legend';
    series.forEach(sr => { const it = document.createElement('span'); const i = document.createElement('i'); i.style.background = sr.color; it.append(i, sr.name); lg.append(it); });
    if (series.length > 1) wrap.append(lg);
    wrap.append(f.svg);
    return wrap;
  }

  function line(labels, values, { unit = '%', title = '' } = {}) {
    if (!values.some(v => v != null)) return empty('Пока нет заявок, чтобы посчитать конверсию');
    const max = Math.max(10, niceMax(Math.max(...values.filter(v => v != null))));
    const f = frame(labels, max, { unit });
    f.svg.setAttribute('aria-label', title);
    const pts = values.map((v, i) => v == null ? null : [f.P.l + f.step * i + f.step / 2, f.P.t + f.ih - (f.ih * v) / max]);
    let d = '', pen = false;
    pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; pen = true; });
    f.svg.append(s('path', { d, fill: 'none', stroke: C.a, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    pts.forEach((p, i) => { if (!p) return; const c = s('circle', { cx: p[0], cy: p[1], r: 4, fill: '#fff', stroke: C.a, 'stroke-width': 2 }); c.append(s('title', {}, `${labels[i]}: ${String(values[i]).replace('.', ',')}%`)); f.svg.append(c); });
    return f.svg;
  }

  function hbars(items) {
    const max = Math.max(0, ...items.map(i => i.value));
    if (max <= 0) return empty('Пока нет заявок за этот период');
    const box = document.createElement('div'); box.className = 'hbars';
    items.forEach(it => {
      const row = document.createElement('div'); row.className = 'hb';
      const n = document.createElement('span'); n.textContent = it.label;
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = (it.value / max) * 100 + '%'; bar.append(fill);
      const b = document.createElement('b'); b.textContent = it.value;
      row.append(n, bar, b); box.append(row);
    });
    return box;
  }

  return { bars, line, hbars, empty, colors: C };
})();
