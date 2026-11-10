begin;

create table if not exists public.deliberate_routine_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '06:00',
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

create table if not exists public.deliberate_routine_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(btrim(device_id)) between 16 and 100),
  endpoint text not null check (length(endpoint) between 20 and 2048),
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  active boolean not null default true,
  expires_at timestamptz,
  last_seen_at timestamptz not null default now(),
  last_delivery_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists public.deliberate_routine_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  session_id uuid,
  occurrence_key text not null unique,
  event_kind text not null check (event_kind in ('start', 'review', 'follow_up')),
  scheduled_at timestamptz not null,
  local_date date not null,
  local_time time not null,
  timezone text not null,
  routine_name text not null,
  title text not null,
  body text not null,
  auto_popup boolean not null default true,
  in_app_state text not null default 'pending'
    check (in_app_state in ('pending', 'shown', 'snoozed', 'dismissed', 'opened')),
  in_app_claim_device_id text,
  in_app_claim_until timestamptz,
  shown_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  opened_at timestamptz,
  follow_up_due_at timestamptz,
  follow_up_dispatched_at timestamptz,
  push_dispatched_at timestamptz,
  push_state text not null default 'pending'
    check (push_state in ('pending', 'sent', 'no_device', 'suppressed', 'failed')),
  push_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (routine_id, user_id)
    references public.deliberate_routines(id, user_id) on delete cascade
);

create table if not exists public.deliberate_routine_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.deliberate_routine_notification_events(id) on delete cascade,
  subscription_id uuid not null references public.deliberate_routine_push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'expired')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  http_status integer,
  error_text text not null default '',
  attempted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, subscription_id)
);

create index if not exists deliberate_routine_push_subscriptions_user_active_idx
  on public.deliberate_routine_push_subscriptions (user_id, active);
create index if not exists deliberate_routine_notification_events_user_queue_idx
  on public.deliberate_routine_notification_events (user_id, in_app_state, scheduled_at);
create index if not exists deliberate_routine_notification_events_dispatch_idx
  on public.deliberate_routine_notification_events (scheduled_at)
  where push_dispatched_at is null;
create index if not exists deliberate_routine_notification_deliveries_user_idx
  on public.deliberate_routine_notification_deliveries (user_id, status, created_at desc);

alter table public.deliberate_routine_notification_preferences enable row level security;
alter table public.deliberate_routine_push_subscriptions enable row level security;
alter table public.deliberate_routine_notification_events enable row level security;
alter table public.deliberate_routine_notification_deliveries enable row level security;

grant select, insert, update, delete on public.deliberate_routine_notification_preferences to authenticated;
grant select, insert, update, delete on public.deliberate_routine_push_subscriptions to authenticated;
grant select, insert, update on public.deliberate_routine_notification_events to authenticated;
grant select on public.deliberate_routine_notification_deliveries to authenticated;

drop policy if exists deliberate_routine_notification_preferences_own on public.deliberate_routine_notification_preferences;
create policy deliberate_routine_notification_preferences_own on public.deliberate_routine_notification_preferences
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists deliberate_routine_push_subscriptions_own on public.deliberate_routine_push_subscriptions;
create policy deliberate_routine_push_subscriptions_own on public.deliberate_routine_push_subscriptions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists deliberate_routine_notification_events_select_own on public.deliberate_routine_notification_events;
create policy deliberate_routine_notification_events_select_own on public.deliberate_routine_notification_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists deliberate_routine_notification_events_insert_own on public.deliberate_routine_notification_events;
create policy deliberate_routine_notification_events_insert_own on public.deliberate_routine_notification_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists deliberate_routine_notification_events_update_own on public.deliberate_routine_notification_events;
create policy deliberate_routine_notification_events_update_own on public.deliberate_routine_notification_events
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists deliberate_routine_notification_deliveries_select_own on public.deliberate_routine_notification_deliveries;
create policy deliberate_routine_notification_deliveries_select_own on public.deliberate_routine_notification_deliveries
  for select to authenticated using ((select auth.uid()) = user_id);

commit;
