-- Charts registration is separate from existing saved preferences. No backfill:
-- every user explicitly creates their private Charts profile in the application.
create table if not exists public.chart_workspace_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.chart_workspace_profiles enable row level security;

-- TRUNCATE bypasses RLS. Remove the default public/anon/authenticated grants;
-- clients only need to read and create their own profile, never alter/delete it.
revoke all on public.chart_workspace_profiles from public, anon, authenticated;
grant select, insert on public.chart_workspace_profiles to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='chart_workspace_profiles' and policyname='chart_profile_select_own') then
    create policy chart_profile_select_own on public.chart_workspace_profiles
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='chart_workspace_profiles' and policyname='chart_profile_create_own') then
    create policy chart_profile_create_own on public.chart_workspace_profiles
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
end;
$$;
comment on table public.chart_workspace_profiles is
  'Explicit T-IOS Charts registration per Supabase Auth user. A row is an active Charts profile; no TradingView credentials or authentication.';
