-- Additive, append-oriented foundation for independently generated T-IOS Reference Performance.
-- Existing trades, journals, rules, Playbooks and market-data rows are not modified.
begin;

create table public.reference_methodology_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  name text not null check (length(name) between 1 and 160),
  approval_status text not null default 'draft' check (approval_status in ('draft','approved')),
  approved_at timestamptz,
  plan_snapshot jsonb not null,
  source_playbook_ids text[] not null default '{}',
  source_rule_ids text[] not null default '{}',
  snapshot_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, version_number),
  unique (user_id, id),
  check ((approval_status = 'approved') = (approved_at is not null))
);

create function public.prevent_approved_reference_methodology_version_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.approval_status = 'approved' then
    raise exception using errcode = '55000',
      message = 'Approved reference methodology versions are immutable; create a new version.';
  end if;
  return new;
end;
$$;

create trigger reference_methodology_versions_immutable
before update on public.reference_methodology_versions
for each row execute function public.prevent_approved_reference_methodology_version_changes();

create table public.reference_market_data_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  methodology_version_id uuid not null,
  source_table text not null check (source_table in ('mt5_market_candles','deriv_public_ticks','manual_upload')),
  source_record_ids uuid[] not null default '{}',
  source_query jsonb not null default '{}',
  instrument_key text not null,
  symbol text not null,
  timeframe text not null check (timeframe in ('H4','H1','M5')),
  available_from timestamptz,
  available_to timestamptz,
  candle_count integer not null default 0 check (candle_count >= 0),
  expected_candle_count integer check (expected_candle_count is null or expected_candle_count >= 0),
  completeness_ratio numeric(6,5) check (completeness_ratio is null or completeness_ratio between 0 and 1),
  availability_status text not null default 'unknown' check (availability_status in ('available','partial','unavailable','unknown')),
  data_validation_status text not null default 'unvalidated' check (data_validation_status in ('unvalidated','validated','rejected')),
  source_metadata jsonb not null default '{}',
  check (data_validation_status <> 'validated' or (availability_status = 'available' and (completeness_ratio is null or completeness_ratio = 1))),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, id, methodology_version_id),
  foreign key (user_id, methodology_version_id)
    references public.reference_methodology_versions(user_id, id) on delete cascade,
  check (available_from is null or available_to is null or available_from <= available_to)
);

create table public.reference_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  methodology_version_id uuid not null,
  market_data_ref_id uuid not null,
  opportunity_status text not null default 'candidate' check (opportunity_status in ('candidate','eligible','ineligible','unvalidated','missed')),
  detector_validation_status text not null default 'unvalidated' check (detector_validation_status in ('unvalidated','validated')),
  observed_at timestamptz not null,
  instrument_key text not null,
  symbol text not null,
  timeframe text not null check (timeframe in ('H4','H1','M5')),
  market_conditions jsonb not null default '{}',
  supporting_evidence jsonb not null default '{}',
  detector_version text,
  created_at timestamptz not null default now(),
  unique (user_id, id, methodology_version_id),
  foreign key (user_id, methodology_version_id)
    references public.reference_methodology_versions(user_id, id) on delete cascade,
  foreign key (user_id, market_data_ref_id, methodology_version_id)
    references public.reference_market_data_refs(user_id, id, methodology_version_id) on delete cascade
);

create table public.reference_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  methodology_version_id uuid not null,
  opportunity_id uuid not null,
  execution_mode text not null default 'simulation' check (execution_mode = 'simulation'),
  execution_status text not null default 'queued' check (execution_status in ('queued','simulated','completed','blocked','failed','incomplete')),
  direction text check (direction in ('long','short')),
  entry_price numeric,
  exit_price numeric,
  stop_loss_price numeric,
  take_profit_price numeric,
  risk_plan jsonb not null default '{}',
  realized_r numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  execution_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, id, methodology_version_id),
  foreign key (user_id, methodology_version_id)
    references public.reference_methodology_versions(user_id, id) on delete cascade,
  foreign key (user_id, opportunity_id, methodology_version_id)
    references public.reference_opportunities(user_id, id, methodology_version_id) on delete cascade,
  check (closed_at is null or opened_at is null or opened_at <= closed_at),
  check (execution_status <> 'completed' or (closed_at is not null and realized_r is not null))
);

create table public.reference_execution_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  methodology_version_id uuid not null,
  execution_attempt_id uuid not null,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','failed','insufficient_evidence')),
  execution_accuracy_pct numeric(6,3) check (execution_accuracy_pct is null or execution_accuracy_pct between 0 and 100),
  rule_checks jsonb not null default '[]',
  detected_errors jsonb not null default '[]',
  verification_version text not null default 'tios.reference-verification.v1',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, methodology_version_id)
    references public.reference_methodology_versions(user_id, id) on delete cascade,
  foreign key (user_id, execution_attempt_id, methodology_version_id)
    references public.reference_execution_attempts(user_id, id, methodology_version_id) on delete cascade,
  check (jsonb_typeof(rule_checks) = 'array'),
  check (jsonb_typeof(detected_errors) = 'array'),
  check (verification_status <> 'verified' or (
    verified_at is not null and jsonb_array_length(rule_checks) > 0 and
    execution_accuracy_pct = 100 and jsonb_array_length(detected_errors) = 0
  ))
);

create table public.reference_performance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  methodology_version_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  measurement_status text not null default 'pending' check (measurement_status in ('pending','insufficient_evidence','validated','rejected')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  verified_attempt_count integer not null default 0 check (verified_attempt_count >= 0),
  evidence_reliability text not null default 'not_measured' check (evidence_reliability in ('not_measured','preliminary_sample','descriptive_sample')),
  expectancy_r numeric,
  profit_factor numeric,
  win_rate_pct numeric(6,3) check (win_rate_pct is null or win_rate_pct between 0 and 100),
  max_drawdown_r numeric check (max_drawdown_r is null or max_drawdown_r >= 0),
  equity_curve jsonb not null default '[]',
  expectancy_series jsonb not null default '[]',
  drawdown_series jsonb not null default '[]',
  profit_loss_distribution jsonb not null default '[]',
  edge_stability_series jsonb not null default '[]',
  source_metadata jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (user_id, methodology_version_id)
    references public.reference_methodology_versions(user_id, id) on delete cascade,
  check (period_start <= period_end),
  check (verified_attempt_count <= attempt_count),
  check (measurement_status <> 'validated' or (
    attempt_count > 0 and verified_attempt_count = attempt_count and
    expectancy_r is not null and win_rate_pct is not null and max_drawdown_r is not null
  ))
);

create index reference_methodology_versions_owner_version
  on public.reference_methodology_versions(user_id, version_number desc);
create index reference_market_data_refs_owner_period
  on public.reference_market_data_refs(user_id, methodology_version_id, available_from desc);
create index reference_opportunities_owner_time
  on public.reference_opportunities(user_id, methodology_version_id, observed_at desc);
create index reference_opportunities_detector_validation
  on public.reference_opportunities(user_id, methodology_version_id, detector_validation_status, opportunity_status);
create index reference_execution_attempts_owner_time
  on public.reference_execution_attempts(user_id, methodology_version_id, closed_at desc);
create index reference_execution_verifications_owner_attempt
  on public.reference_execution_verifications(user_id, execution_attempt_id, verified_at desc);
create index reference_performance_records_owner_period
  on public.reference_performance_records(user_id, methodology_version_id, period_start, period_end);

alter table public.reference_methodology_versions enable row level security;
alter table public.reference_market_data_refs enable row level security;
alter table public.reference_opportunities enable row level security;
alter table public.reference_execution_attempts enable row level security;
alter table public.reference_execution_verifications enable row level security;
alter table public.reference_performance_records enable row level security;

revoke all on public.reference_methodology_versions, public.reference_market_data_refs, public.reference_opportunities,
  public.reference_execution_attempts, public.reference_execution_verifications, public.reference_performance_records
  from anon, authenticated;
grant select on public.reference_methodology_versions, public.reference_market_data_refs, public.reference_opportunities,
  public.reference_execution_attempts, public.reference_execution_verifications, public.reference_performance_records
  to authenticated;
-- Authenticated users may save an explicitly approved, immutable snapshot of their own plan.
grant insert on public.reference_methodology_versions to authenticated;
-- Browser sessions can record source references but cannot assert trusted data validation.
grant insert (user_id, methodology_version_id, source_table, source_record_ids, source_query,
  instrument_key, symbol, timeframe, available_from, available_to, candle_count, expected_candle_count,
  completeness_ratio, availability_status, source_metadata)
  on public.reference_market_data_refs to authenticated;
-- Opportunity writes remain unvalidated candidates until a trusted detector updates them.
grant insert (user_id, methodology_version_id, market_data_ref_id, observed_at,
  instrument_key, symbol, timeframe, market_conditions, supporting_evidence, detector_version)
  on public.reference_opportunities to authenticated;
-- Browser sessions can queue simulation requests. Status and realized outcome fields stay trusted-writer only.
grant insert (user_id, methodology_version_id, opportunity_id, direction, entry_price,
  stop_loss_price, take_profit_price, risk_plan, execution_metadata)
  on public.reference_execution_attempts to authenticated;
-- Clients may request verification but cannot write outcomes or accuracy values.
grant insert (user_id, methodology_version_id, execution_attempt_id)
  on public.reference_execution_verifications to authenticated;
-- Clients may request a measurement but cannot write status, counts, metrics or chart series.
grant insert (user_id, methodology_version_id, period_start, period_end, source_metadata)
  on public.reference_performance_records to authenticated;
revoke all on function public.prevent_approved_reference_methodology_version_changes() from public, anon, authenticated;

create policy reference_methodology_versions_select_own on public.reference_methodology_versions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_methodology_versions_insert_own on public.reference_methodology_versions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reference_market_data_refs_select_own on public.reference_market_data_refs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_market_data_refs_insert_own on public.reference_market_data_refs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reference_opportunities_select_own on public.reference_opportunities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_opportunities_insert_own on public.reference_opportunities
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reference_execution_attempts_select_own on public.reference_execution_attempts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_execution_attempts_insert_own on public.reference_execution_attempts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reference_execution_verifications_select_own on public.reference_execution_verifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_execution_verifications_insert_own on public.reference_execution_verifications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reference_performance_records_select_own on public.reference_performance_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reference_performance_records_insert_own on public.reference_performance_records
  for insert to authenticated with check ((select auth.uid()) = user_id);

commit;
