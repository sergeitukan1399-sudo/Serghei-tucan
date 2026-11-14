-- Alisa Decor & Balloons — мини-CRM
-- Миграция: заявки, история изменений, администраторы, журнал отправок для антиспама.
-- Время хранится в UTC (timestamptz). Отображение — в Europe/Chisinau на стороне панели.
-- Выполнить один раз: Supabase → SQL Editor → вставить файл целиком → Run.

begin;


-- ---------------------------------------------------------------------------
-- Администраторы: только пользователи из этой таблицы получают доступ к CRM.
-- Публичной регистрации нет — администратор добавляется вручную (см. docs/CRM-SETUP.md).
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Заявки
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  lead_no         bigint generated always as identity unique,   -- короткий номер для людей: №1, №2…
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- ответы квиза
  event_type      text not null,
  event_date      date,                         -- null = «дата пока не определена»
  event_location  text,
  event_city      text,
  event_style     text,
  budget_range    text,
  client_name     text not null,
  client_phone    text not null,
  client_phone_digits text generated always as (regexp_replace(client_phone, '\D', '', 'g')) stored,  -- для поиска по номеру без пробелов и скобок
  contact_method  text,
  comment         text,

  -- работа менеджера
  status          text not null default 'new',
  order_amount    numeric(12,2),
  confirmed_at    timestamptz,                  -- первая дата подтверждения; при отмене не стирается
  cancelled_at    timestamptz,
  manager_notes   text,

  -- служебное
  source          text not null default 'site_quiz',
  submission_id   uuid unique,                  -- ключ идемпотентности: повторная отправка не создаёт дубль
  notify_status   text not null default 'pending',
  notify_attempts integer not null default 0,
  notify_error    text,
  notified_at     timestamptz,

  constraint leads_status_chk check (status in ('new','contacted','pending','confirmed','done','rejected','cancelled')),
  constraint leads_notify_chk check (notify_status in ('pending','sending','sent','failed')),
  constraint leads_amount_chk check (order_amount is null or order_amount >= 0),
  constraint leads_contact_chk check (contact_method is null or contact_method in ('WhatsApp','Viber','Звонок')),
  constraint leads_name_len check (char_length(client_name) between 2 and 80),
  constraint leads_phone_len check (char_length(client_phone) between 6 and 32),
  constraint leads_type_len check (char_length(event_type) between 1 and 60),
  constraint leads_comment_len check (comment is null or char_length(comment) <= 1000),
  constraint leads_notes_len check (manager_notes is null or char_length(manager_notes) <= 4000),
  constraint leads_city_len check (event_city is null or char_length(event_city) <= 80)
);

create index if not exists leads_created_at_idx   on public.leads (created_at desc);
create index if not exists leads_status_idx       on public.leads (status);
create index if not exists leads_confirmed_at_idx on public.leads (confirmed_at);
create index if not exists leads_notify_idx       on public.leads (notify_status) where notify_status <> 'sent';
create index if not exists leads_phone_idx        on public.leads (client_phone_digits);

-- updated_at и даты подтверждения/отмены ставятся базой, чтобы не зависеть от клиента
create or replace function public.leads_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'confirmed' and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;
    if new.status = 'done' and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;
    if new.status = 'cancelled' then
      new.cancelled_at := now();
    elsif old.status = 'cancelled' then
      new.cancelled_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_touch_trg on public.leads;
create trigger leads_touch_trg
  before update on public.leads
  for each row execute function public.leads_touch();

-- ---------------------------------------------------------------------------
-- История изменений: только добавление, без правок и удаления
-- ---------------------------------------------------------------------------
create table if not exists public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  created_at  timestamptz not null default now(),
  action      text not null,
  old_value   text,
  new_value   text,
  actor_id    uuid,
  actor_email text,
  constraint lead_events_action_chk check (action in
    ('created','status','amount','notes','notify_sent','notify_failed','notify_retry'))
);

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at);
create index if not exists lead_events_status_idx on public.lead_events (action, created_at) where action = 'status';

create or replace function public.lead_events_readonly()
returns trigger
language plpgsql
as $$
begin
  raise exception 'История изменений заявок не редактируется и не удаляется';
end;
$$;

drop trigger if exists lead_events_no_update on public.lead_events;
create trigger lead_events_no_update
  before update or delete on public.lead_events
  for each row execute function public.lead_events_readonly();

-- ---------------------------------------------------------------------------
-- Журнал отправок формы для ограничения частоты.
-- Хранится только хеш IP с секретной солью, без самого адреса; записи старше суток удаляются.
-- ---------------------------------------------------------------------------
create table if not exists public.submission_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists submission_log_idx on public.submission_log (ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Публичного доступа нет: анонимный ключ не читает и не пишет ни одну таблицу.
-- Заявки с сайта записывает только сервер (service role, ключ хранится в Vercel).
-- Администраторы, вошедшие через Supabase Auth, могут читать и править заявки.
-- ---------------------------------------------------------------------------
alter table public.admins         enable row level security;
alter table public.leads          enable row level security;
alter table public.lead_events    enable row level security;
alter table public.submission_log enable row level security;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads
  for select to authenticated using (public.is_admin());

drop policy if exists leads_admin_update on public.leads;
create policy leads_admin_update on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists lead_events_admin_read on public.lead_events;
create policy lead_events_admin_read on public.lead_events
  for select to authenticated using (public.is_admin());

drop policy if exists lead_events_admin_insert on public.lead_events;
create policy lead_events_admin_insert on public.lead_events
  for insert to authenticated with check (public.is_admin());

-- submission_log: политик нет — доступ только у сервера.

revoke all on public.leads, public.lead_events, public.admins, public.submission_log from anon;

commit;
