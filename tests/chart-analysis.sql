-- Real RLS and persistence checks. All fixtures run in a subtransaction that
-- always rolls back. Existing user records and saved analysis are untouched.
create temporary table chart_analysis_qa_result(result jsonb);
do $$
declare
  ids uuid[]; results jsonb:='{}'; changed bigint;
  before_profiles text:=(select md5(coalesce(string_agg(user_id::text||created_at::text,',' order by user_id),'')) from public.chart_workspace_profiles);
  before_prefs text:=(select md5(coalesce(string_agg(user_id::text||configuration::text||revision::text,',' order by user_id),'')) from public.chart_workspace_preferences);
  before_analysis text:=(select md5(coalesce(string_agg(user_id::text||content::text||revision::text,',' order by user_id),'')) from public.chart_workspace_analysis);
  populated jsonb:='{"version":1,"panes":{"single_single":{"engine":"native","market":"v75_1s","interval":"5","contexts":{"v75_1s":{"drawings":[{"id":"level","type":"level","points":[{"time":1791657000,"price":101.12345}],"color":"#a78bfa","text":""}],"indicators":[{"id":"ema","type":"ema","period":20,"color":"#a78bfa"}],"views":{"5":{"from":1791650000,"to":1791659000}}}}}}}';
  removed jsonb;
begin
  select array_agg(id) into ids from (select id from auth.users u where not exists
    (select 1 from public.chart_workspace_analysis a where a.user_id=u.id) order by id limit 2) users;
  if array_length(ids,1) is distinct from 2 then raise exception 'Two existing users without analysis are needed for rollback-only QA.';end if;
  begin
    results:=results||jsonb_build_object(
      'rls_enabled',(select relrowsecurity from pg_class where oid='public.chart_workspace_analysis'::regclass),
      'anonymous_has_no_table_grants',not has_table_privilege('anon','public.chart_workspace_analysis','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'authenticated_cannot_delete_or_truncate',not has_table_privilege('authenticated','public.chart_workspace_analysis','DELETE,TRUNCATE,TRIGGER,REFERENCES'),
      'authenticated_cannot_reassign_owner',not has_column_privilege('authenticated','public.chart_workspace_analysis','user_id','UPDATE'),
      'authenticated_cannot_forge_revision',not has_column_privilege('authenticated','public.chart_workspace_analysis','revision','UPDATE'),
      'valid_full_state',public.valid_chart_workspace_analysis(populated),
      'invalid_document_rejected',not public.valid_chart_workspace_analysis('{"version":99,"panes":{}}'),
      'unsafe_pane_rejected',not public.valid_chart_workspace_analysis(jsonb_build_object('version',1,'panes',jsonb_build_object('__proto__',populated->'panes'->'single_single'))),
      'duplicate_drawing_rejected',not public.valid_chart_workspace_analysis(jsonb_set(populated,'{panes,single_single,contexts,v75_1s,drawings}',(populated#>'{panes,single_single,contexts,v75_1s,drawings}')||(populated#>'{panes,single_single,contexts,v75_1s,drawings}')))
    );
    insert into public.chart_workspace_profiles(user_id) values(ids[1]),(ids[2]) on conflict do nothing;
    insert into public.chart_workspace_analysis(user_id,content) values(ids[2],' {"version":1,"panes":{}}');
    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ids[1],'role','authenticated','is_anonymous',false)::text,true);
    insert into public.chart_workspace_analysis(user_id,content) values(ids[1],populated);
    results:=results||jsonb_build_object(
      'own_analysis_created',exists(select 1 from public.chart_workspace_analysis where user_id=ids[1] and content=populated and revision=1),
      'foreign_analysis_hidden',not exists(select 1 from public.chart_workspace_analysis where user_id=ids[2]),
      'own_drawings_indicators_and_view_restored',(select content#>>'{panes,single_single,contexts,v75_1s,drawings,0,id}'='level' and content#>>'{panes,single_single,contexts,v75_1s,indicators,0,period}'='20' and content#>>'{panes,single_single,contexts,v75_1s,views,5,from}'='1791650000' from public.chart_workspace_analysis where user_id=ids[1])
    );
    update public.chart_workspace_analysis set content='{"version":1,"panes":{}}' where user_id=ids[2];get diagnostics changed=row_count;
    results:=results||jsonb_build_object('foreign_update_denied',changed=0);
    begin
      insert into public.chart_workspace_analysis(user_id,content) values(ids[2],populated);
      results:=results||'{"foreign_insert_denied":false}';
    exception when insufficient_privilege then results:=results||'{"foreign_insert_denied":true}';end;
    removed:=jsonb_set(jsonb_set(populated,'{panes,single_single,contexts,v75_1s,drawings}','[]'),'{panes,single_single,contexts,v75_1s,indicators}','[]');
    update public.chart_workspace_analysis set content=removed where user_id=ids[1] and revision=1;
    results:=results||jsonb_build_object('explicit_removal_restores_empty_lists',
      (select content#>'{panes,single_single,contexts,v75_1s,drawings}'='[]'::jsonb and content#>'{panes,single_single,contexts,v75_1s,indicators}'='[]'::jsonb and revision=2 from public.chart_workspace_analysis where user_id=ids[1]));
    update public.chart_workspace_analysis set content=populated where user_id=ids[1] and revision=1;get diagnostics changed=row_count;
    results:=results||jsonb_build_object('stale_revision_cannot_resurrect_analysis',changed=0 and (select content=removed from public.chart_workspace_analysis where user_id=ids[1]));
    begin
      update public.chart_workspace_analysis set content='{"version":7,"panes":{}}' where user_id=ids[1];
      results:=results||'{"malformed_update_denied":false}';
    exception when check_violation then results:=results||'{"malformed_update_denied":true}';end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ids[1],'role','authenticated','is_anonymous',true)::text,true);
    begin
      update public.chart_workspace_analysis set content=populated where user_id=ids[1];
      results:=results||'{"anonymous_auth_write_denied":false}';
    exception when insufficient_privilege then results:=results||'{"anonymous_auth_write_denied":true}';end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ids[2],'role','authenticated','is_anonymous',false)::text,true);
    results:=results||jsonb_build_object('account_switch_isolated',not exists(select 1 from public.chart_workspace_analysis where user_id=ids[1]) and exists(select 1 from public.chart_workspace_analysis where user_id=ids[2]));
    perform set_config('role','anon',true);perform set_config('request.jwt.claims','{}',true);
    begin
      perform content from public.chart_workspace_analysis;results:=results||'{"anonymous_read_denied":false}';
    exception when insufficient_privilege then results:=results||'{"anonymous_read_denied":true}';end;
    raise exception using errcode='PZ001',message='Rollback analysis QA fixtures';
  exception when sqlstate 'PZ001' then null;end;
  results:=results||jsonb_build_object(
    'existing_profiles_unchanged',before_profiles=(select md5(coalesce(string_agg(user_id::text||created_at::text,',' order by user_id),'')) from public.chart_workspace_profiles),
    'existing_preferences_unchanged',before_prefs=(select md5(coalesce(string_agg(user_id::text||configuration::text||revision::text,',' order by user_id),'')) from public.chart_workspace_preferences),
    'existing_analysis_unchanged',before_analysis=(select md5(coalesce(string_agg(user_id::text||content::text||revision::text,',' order by user_id),'')) from public.chart_workspace_analysis)
  );
  insert into chart_analysis_qa_result values(results);
end;
$$;
select result from chart_analysis_qa_result;
