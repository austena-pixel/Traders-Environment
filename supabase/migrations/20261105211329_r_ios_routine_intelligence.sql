begin;

create table if not exists public.routine_source_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_product_id text not null check (source_product_id in ('tios', 'gios', 'healthios', 'sios')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_product_id)
);

create table if not exists public.routine_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_product_id text not null check (source_product_id in ('tios', 'gios', 'healthios', 'sios')),
  source_table text not null,
  source_record_id text not null,
  activity_key text not null,
  label text not null,
  observed_at timestamptz,
  observed_on date not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  source_reference jsonb not null default '{}'::jsonb check (jsonb_typeof(source_reference) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_product_id, source_table, source_record_id, activity_key)
);

create index if not exists routine_observations_user_source_day_idx
  on public.routine_observations (user_id, source_product_id, observed_on);

create table if not exists public.routine_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_product_id text not null check (source_product_id in ('tios', 'gios', 'healthios', 'sios')),
  pattern_key text not null,
  title text not null,
  sequence jsonb not null check (jsonb_typeof(sequence) = 'array'),
  observation_count integer not null default 0 check (observation_count >= 0),
  consistency_percent numeric(5, 2) not null default 0 check (consistency_percent >= 0 and consistency_percent <= 100),
  first_observed_on date,
  last_observed_on date,
  evaluation_status text not null default 'insufficient_evidence'
    check (evaluation_status in ('insufficient_evidence', 'early_signal', 'supported_association')),
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source_product_id, pattern_key)
);

create table if not exists public.routine_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_id uuid not null,
  status text not null default 'insufficient_evidence'
    check (status in ('insufficient_evidence', 'early_signal', 'supported_association')),
  direction text not null default 'unavailable'
    check (direction in ('positive', 'negative', 'no_clear_difference', 'unavailable')),
  outcome_metric text not null default 'execution_score',
  with_pattern_days integer not null default 0 check (with_pattern_days >= 0),
  without_pattern_days integer not null default 0 check (without_pattern_days >= 0),
  with_pattern_mean numeric,
  without_pattern_mean numeric,
  difference numeric,
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  method text not null,
  caveat text not null,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (pattern_id, user_id) references public.routine_patterns(id, user_id) on delete cascade,
  unique (user_id, pattern_id)
);

create table if not exists public.routine_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_product_id text not null check (source_product_id in ('tios', 'gios', 'healthios', 'sios')),
  discovery_key text not null,
  pattern_id uuid,
  evaluation_id uuid,
  discovery_type text not null default 'test_candidate'
    check (discovery_type in ('positive_association', 'negative_association', 'test_candidate')),
  title text not null,
  summary text not null,
  recommended_test text not null,
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  status text not null default 'new' check (status in ('new', 'adopted', 'dismissed', 'investigating')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (pattern_id, user_id) references public.routine_patterns(id, user_id) on delete cascade,
  foreign key (evaluation_id, user_id) references public.routine_evaluations(id, user_id) on delete set null (evaluation_id),
  unique (user_id, discovery_key)
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_id uuid,
  pattern_id uuid,
  source_product_id text not null check (source_product_id in ('tios', 'gios', 'healthios', 'sios')),
  name text not null,
  description text not null default '',
  target_sequence jsonb not null default '[]'::jsonb check (jsonb_typeof(target_sequence) = 'array'),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  adopted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (discovery_id, user_id) references public.routine_discoveries(id, user_id) on delete set null (discovery_id),
  foreign key (pattern_id, user_id) references public.routine_patterns(id, user_id) on delete set null (pattern_id),
  unique (user_id, discovery_id)
);

create table if not exists public.routine_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  baseline jsonb not null default '{}'::jsonb check (jsonb_typeof(baseline) = 'object'),
  results jsonb not null default '{}'::jsonb check (jsonb_typeof(results) = 'object'),
  started_at timestamptz,
  ended_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (routine_id, user_id) references public.routines(id, user_id) on delete cascade
);

create index if not exists routine_experiments_user_routine_status_idx
  on public.routine_experiments (user_id, routine_id, status);

create table if not exists public.routine_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_id uuid,
  routine_id uuid,
  experiment_id uuid,
  action text not null check (action in ('adopted', 'dismissed', 'investigated', 'helpful', 'not_helpful', 'edited', 'experiment_started', 'experiment_completed')),
  feedback text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (discovery_id, user_id) references public.routine_discoveries(id, user_id) on delete set null (discovery_id),
  foreign key (routine_id, user_id) references public.routines(id, user_id) on delete set null (routine_id),
  foreign key (experiment_id, user_id) references public.routine_experiments(id, user_id) on delete set null (experiment_id)
);

do $$
declare
  table_name text;
  table_names text[] := array[
    'routine_source_settings',
    'routine_observations',
    'routine_patterns',
    'routine_evaluations',
    'routine_discoveries',
    'routines',
    'routine_experiments',
    'routine_feedback'
  ];
begin
  foreach table_name in array table_names loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);

    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);

    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);

    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);

    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end;
$$;

commit;
