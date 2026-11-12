// Мелкие помощники для серверных функций Vercel (Node.js runtime).

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export async function readJson(req, limit = 20_000) {
  if (req.body && typeof req.body === 'object') return req.body;          // Vercel уже разобрал JSON
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  send(res, 405, { error: 'Метод не поддерживается' });
  return false;
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export function query(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, 'http://local');
  return Object.fromEntries(u.searchParams);
}

// Все обработчики оборачиваются, чтобы любая ошибка отдавала аккуратный JSON без деталей сервера
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[api]', e);
      if (!res.headersSent) send(res, status, { error: e.publicMessage || (status >= 500 ? 'Внутренняя ошибка сервера' : e.message) });
    }
  };
}

export function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}
