// GET /api/works — опубликованные работы для галереи на сайте (русская и румынская версии).
// Ответ кэшируется на минуту: новая работа из панели появится на сайте в течение минуты.
import { handler, method, send } from '../lib/http.js';
import { db } from '../lib/supabase.js';
import { WORK_COLS, publicWork } from '../lib/works.js';

export default handler(async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const sb = db();
  if (!sb) return send(res, 503, { error: 'База данных ещё не подключена' });
  const { data, error } = await sb.from('works').select(WORK_COLS).eq('visible', true)
    .order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  send(res, 200, { items: (data || []).map(publicWork) }, {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
  });
});
