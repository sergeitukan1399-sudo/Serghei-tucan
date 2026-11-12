// GET /api/config — публичные параметры для входа в панель (адрес проекта и публичный anon-ключ).
// Сервисный ключ и токены сюда не попадают.
import { handler, method, send } from '../lib/http.js';
import { telegramConfigured } from '../lib/telegram.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const url = process.env.SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || '';
  send(res, 200, { supabaseUrl: url, supabaseAnonKey: anon, configured: Boolean(url && anon), telegram: telegramConfigured() });
});
