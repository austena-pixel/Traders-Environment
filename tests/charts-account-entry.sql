-- Run using the trusted SQL connection. Tests real authenticated/anonymous roles,
-- RLS and grants. Existing Auth users supply IDs, but NO stored user records are
-- changed: a PL/pgSQL subtransaction always rolls back both test profile inserts.
create temporary table chart_profile_qa_result (result jsonb);
do $$
declare
  ids uuid[];
  results jsonb := '{}'::jsonb;
  before_profiles bigint := (select count(*) from public.chart_workspace_profiles);
  before_preferences text := (select md5(coalesce(string_agg(user_id::text || configuration::text || revision::text, ',' order by user_id),'')) from public.chart_workspace_preferences);
begin
  select array_agg(id) into ids from (
    select id from auth.users u where not exists
      (select 1 from public.chart_workspace_profiles p where p.user_id=u.id)
    order by id limit 2
  ) users_without_profiles;
  if array_length(ids,1) is distinct from 2 then
    raise exception 'Charts RLS verification needs two existing users without Charts profiles.';
  end if;
  begin
    results := results || jsonb_build_object(
      'rls_enabled',(select relrowsecurity from pg_class where oid='public.chart_workspace_profiles'::regclass),
      'anonymous_grants_removed',not has_table_privilege('anon','public.chart_workspace_profiles','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES'),
      'authenticated_can_read_and_create',has_table_privilege('authenticated','public.chart_workspace_profiles','SELECT') and has_table_privilege('authenticated','public.chart_workspace_profiles','INSERT'),
      'authenticated_cannot_modify_delete_or_truncate',not has_table_privilege('authenticated','public.chart_workspace_profiles','UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
    );
    insert into public.chart_workspace_profiles(user_id) values(ids[2]);
    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ids[1],'role','authenticated')::text,true);
    insert into public.chart_workspace_profiles(user_id) values(ids[1]);
    results := results || jsonb_build_object(
      'owner_can_create_profile',exists(select 1 from public.chart_workspace_profiles where user_id=ids[1]),
      'owner_sees_only_own_profile',(select count(*)=1 from public.chart_workspace_profiles),
      'foreign_profile_hidden',not exists(select 1 from public.chart_workspace_profiles where user_id=ids[2])
    );
    begin
      insert into public.chart_workspace_profiles(user_id) values(ids[2]);
      results := results || '{"foreign_insert_denied":false}'::jsonb;
    exception when insufficient_privilege then
      results := results || '{"foreign_insert_denied":true}'::jsonb;
    end;
    begin
      insert into public.chart_workspace_profiles(user_id) values(ids[1]);
      results := results || '{"duplicate_registration_blocked":false}'::jsonb;
    exception when unique_violation then
      results := results || '{"duplicate_registration_blocked":true}'::jsonb;
    end;
    begin
      update public.chart_workspace_profiles set user_id=ids[2] where user_id=ids[1];
      results := results || '{"ownership_change_denied":false}'::jsonb;
    exception when insufficient_privilege then
      results := results || '{"ownership_change_denied":true}'::jsonb;
    end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ids[2],'role','authenticated')::text,true);
    results := results || jsonb_build_object('second_account_isolated',
      (select count(*)=1 from public.chart_workspace_profiles) and
      not exists(select 1 from public.chart_workspace_profiles where user_id=ids[1]) and
      exists(select 1 from public.chart_workspace_profiles where user_id=ids[2]));
    perform set_config('role','anon',true);
    perform set_config('request.jwt.claims','{}',true);
    begin
      perform user_id from public.chart_workspace_profiles;
      results := results || '{"anonymous_read_denied":false}'::jsonb;
    exception when insufficient_privilege then
      results := results || '{"anonymous_read_denied":true}'::jsonb;
    end;
    -- Unconditionally rollback all profile fixtures and temporary role changes.
    raise exception using errcode='PZ001',message='Rollback Charts RLS fixtures';
  exception when sqlstate 'PZ001' then null;
  end;
  results := results || jsonb_build_object(
    'profile_records_unchanged',before_profiles=(select count(*) from public.chart_workspace_profiles),
    'saved_preferences_unchanged',before_preferences=(select md5(coalesce(string_agg(user_id::text || configuration::text || revision::text, ',' order by user_id),'')) from public.chart_workspace_preferences)
  );
  insert into chart_profile_qa_result values(results);
end;
$$;
select result from chart_profile_qa_result;
