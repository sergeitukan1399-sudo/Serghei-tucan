// Проверка администратора на сервере: токен сессии Supabase → пользователь → запись в таблице admins.
// Скрытая ссылка или проверка в интерфейсе защитой не считаются: каждый запрос к /api/admin проходит здесь.

import { db } from './supabase.js';
import { httpError } from './http.js';

export async function requireAdmin(req) {
  const sb = db();
  if (!sb) throw httpError(503, 'База данных ещё не подключена');
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 4096) throw httpError(401, 'Войдите в панель');

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'Сессия истекла, войдите снова');
  const user = data.user;

  const adm = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (adm.error) throw adm.error;
  if (!adm.data) throw httpError(403, 'У этой учётной записи нет доступа к панели');
  return { id: user.id, email: user.email };
}
