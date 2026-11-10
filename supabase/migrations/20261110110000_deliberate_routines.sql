begin;

-- Keep deliberate execution evidence inside the existing R-IOS analysis pipeline.
alter table public.routine_observations
  drop constraint if exists routine_observations_source_product_id_check;
alter table public.routine_observations
  add constraint routine_observations_source_product_id_check
  check (source_product_id in ('tios', 'gios', 'healthios', 'sios', 'rios'));

alter table public.routine_patterns
  drop constraint if exists routine_patterns_source_product_id_check;
alter table public.routine_patterns
  add constraint routine_patterns_source_product_id_check
  check (source_product_id in ('tios', 'gios', 'healthios', 'sios', 'rios'));

alter table public.routine_discoveries
  drop constraint if exists routine_discoveries_source_product_id_check;
alter table public.routine_discoveries
  add constraint routine_discoveries_source_product_id_check
  check (source_product_id in ('tios', 'gios', 'healthios', 'sios', 'rios'));

create table if not exists public.deliberate_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  purpose text not null default '',
  desired_outcome text not null default '',
  start_time time,
  end_time time,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  schedule_kind text not null default 'daily'
    check (schedule_kind in ('daily', 'weekly', 'monthly', 'custom')),
  schedule_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schedule_data) = 'object'),
  timezone text not null default 'UTC',
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.deliberate_routine_activities (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  user_id uuid not null,
  parent_activity_id uuid,
  activity_kind text not null default 'activity'
    check (activity_kind in ('activity', 'group')),
  title text not null check (length(btrim(title)) > 0),
  sort_order integer not null default 0,
  start_time time,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  completion_criteria text not null default '',
  instructions text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, routine_id, user_id),
  foreign key (routine_id, user_id)
    references public.deliberate_routines(id, user_id) on delete cascade,
  foreign key (parent_activity_id, routine_id, user_id)
    references public.deliberate_routine_activities(id, routine_id, user_id) on delete cascade,
  check (parent_activity_id is null or parent_activity_id <> id),
  check (activity_kind <> 'group' or parent_activity_id is null)
);

create table if not exists public.deliberate_routine_sessions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  user_id uuid not null,
  scheduled_for date not null,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  missed_recorded_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'partially_completed', 'missed', 'interrupted')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, routine_id, user_id),
  foreign key (routine_id, user_id)
    references public.deliberate_routines(id, user_id) on delete cascade
);

create table if not exists public.deliberate_routine_session_activities (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  routine_id uuid not null,
  user_id uuid not null,
  source_activity_id uuid,
  activity_key text not null,
  parent_activity_key text,
  activity_kind text not null default 'activity'
    check (activity_kind in ('activity', 'group')),
  activity_title text not null,
  sort_order integer not null default 0,
  planned_start_time time,
  planned_duration_minutes integer,
  completion_criteria text not null default '',
  instructions text not null default '',
  activity_notes text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'partial', 'skipped')),
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  status_recorded_at timestamptz,
  execution_note text not null default '',
  resistance_occurred boolean,
  resistance_nature text not null default '',
  resistance_intensity smallint check (resistance_intensity is null or resistance_intensity between 0 and 10),
  resistance_influenced_execution boolean,
  resistance_response text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, session_id, routine_id, user_id),
  foreign key (session_id, routine_id, user_id)
    references public.deliberate_routine_sessions(id, routine_id, user_id) on delete cascade,
  foreign key (source_activity_id, routine_id, user_id)
    references public.deliberate_routine_activities(id, routine_id, user_id)
    on delete set null (source_activity_id)
);

create table if not exists public.deliberate_routine_reviews (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  user_id uuid not null,
  review_type text not null check (review_type in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  planned_outcomes text not null default '',
  actual_outcomes text not null default '',
  execution_gaps text not null default '',
  self_discovery text not null default '',
  conscious_development text not null default '',
  next_experiment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (routine_id, user_id, review_type, period_start, period_end),
  foreign key (routine_id, user_id)
    references public.deliberate_routines(id, user_id) on delete cascade,
  check (period_end >= period_start)
);

create index if not exists deliberate_routines_user_status_idx
  on public.deliberate_routines (user_id, status, start_time);
create index if not exists deliberate_routine_activities_user_routine_order_idx
  on public.deliberate_routine_activities (user_id, routine_id, sort_order);
create index if not exists deliberate_routine_sessions_user_routine_day_idx
  on public.deliberate_routine_sessions (user_id, routine_id, scheduled_for desc);
create unique index if not exists deliberate_routine_sessions_one_active_per_routine_idx
  on public.deliberate_routine_sessions (user_id, routine_id)
  where status = 'in_progress';
create index if not exists deliberate_routine_session_activities_user_session_order_idx
  on public.deliberate_routine_session_activities (user_id, session_id, sort_order);
create index if not exists deliberate_routine_session_activities_evidence_idx
  on public.deliberate_routine_session_activities (user_id, activity_key, status, status_recorded_at);
create index if not exists deliberate_routine_reviews_user_routine_period_idx
  on public.deliberate_routine_reviews (user_id, routine_id, review_type, period_start desc);

do $$
declare
  table_name text;
  table_names text[] := array[
    'deliberate_routines',
    'deliberate_routine_activities',
    'deliberate_routine_sessions',
    'deliberate_routine_session_activities',
    'deliberate_routine_reviews'
  ];
begin
  foreach table_name in array table_names loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end;
$$;

commit;
