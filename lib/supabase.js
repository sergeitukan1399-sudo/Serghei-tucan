// Серверный клиент Supabase с сервисным ключом. Ключ берётся только из переменных окружения Vercel
// и никогда не попадает в браузер. В тестах клиент подменяется через setSupabaseForTests().

import { createClient } from '@supabase/supabase-js';

let client = null;

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function db() {
  if (client) return client;
  if (!supabaseConfigured()) return null;
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function setSupabaseForTests(fake) {
  client = fake;
}
