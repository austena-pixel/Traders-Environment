-- Additive, user-level preferences. Existing accounts, trades and evidence are untouched.
create function public.valid_chart_workspace_configuration(config jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare
  mode text;
  chart jsonb;
  collection jsonb;
  ids text[];
begin
  if config is null or jsonb_typeof(config) <> 'object' or octet_length(config::text) > 32768 then return false; end if;
  if (select count(*) from jsonb_object_keys(config)) <> 5
    or not config ?& array['version','layout','theme','timezone','charts']
    or config->'version' is distinct from '1'::jsonb
    or config->>'layout' not in ('single','multiple')
    or config->>'theme' not in ('dark','light')
    or config->>'timezone' not in ('Etc/UTC','exchange')
    or jsonb_typeof(config->'layout') <> 'string'
    or jsonb_typeof(config->'theme') <> 'string'
    or jsonb_typeof(config->'timezone') <> 'string'
    or jsonb_typeof(config->'charts') <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(config->'charts')) <> 2
    or not (config->'charts') ?& array['single','multiple'] then return false; end if;
  foreach mode in array array['single','multiple'] loop
    collection := config->'charts'->mode;
    if jsonb_typeof(collection) <> 'array' then return false; end if;
    if jsonb_array_length(collection) not between 1 and 12
      or (mode = 'single' and jsonb_array_length(collection) <> 1) then return false; end if;
    ids := array[]::text[];
    for chart in select value from jsonb_array_elements(collection) loop
      if jsonb_typeof(chart) <> 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(chart)) <> 4
        or not chart ?& array['id','symbol','interval','responsibility']
        or jsonb_typeof(chart->'id') <> 'string'
        or jsonb_typeof(chart->'symbol') <> 'string'
        or jsonb_typeof(chart->'interval') <> 'string'
        or jsonb_typeof(chart->'responsibility') <> 'string'
        or chart->>'id' !~ '^[a-z0-9_-]{1,40}$'
        or chart->>'id' = any(ids)
        or chart->>'symbol' !~ '^[A-Z0-9_]{1,20}:[A-Z0-9_./!^\-]{1,60}$'
        or chart->>'interval' not in ('1','3','5','15','30','60','120','240','D','W','M')
        or char_length(chart->>'responsibility') > 120 then return false; end if;
      ids := array_append(ids,chart->>'id');
    end loop;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_chart_workspace_configuration(jsonb) from public, anon, authenticated;
grant execute on function public.valid_chart_workspace_configuration(jsonb) to authenticated;

create table public.chart_workspace_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version smallint not null default 1 check (schema_version = 1),
  configuration jsonb not null check (public.valid_chart_workspace_configuration(configuration)),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.chart_workspace_preferences is 'Versioned TradingView workspace defaults per authenticated user. Separate single and multiple chart configurations; no market data, account drawings, images, evaluations or trading credentials.';
alter table public.chart_workspace_preferences enable row level security;
revoke all on public.chart_workspace_preferences from public, anon, authenticated;
grant select, insert, update on public.chart_workspace_preferences to authenticated;

create policy chart_workspace_select_own on public.chart_workspace_preferences
for select to authenticated using (user_id = (select auth.uid()));
create policy chart_workspace_insert_own on public.chart_workspace_preferences
for insert to authenticated with check (user_id = (select auth.uid()));
create policy chart_workspace_update_own on public.chart_workspace_preferences
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A revision guards against overwriting preferences saved on another device.
create function public.chart_workspace_preferences_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := now();
  else
    if new.user_id is distinct from old.user_id then raise exception 'Chart preferences ownership cannot be changed'; end if;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.chart_workspace_preferences_revision() from public, anon, authenticated;
create trigger chart_workspace_preferences_revision before insert or update on public.chart_workspace_preferences
for each row execute function public.chart_workspace_preferences_revision();
