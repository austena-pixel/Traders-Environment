begin;
select plan(15);

select ok(to_regclass('public.tios_personal_intelligence_conversations') is not null,'conversation table exists');
select ok(to_regclass('public.tios_personal_intelligence_messages') is not null,'message table exists');
select ok(to_regclass('public.tios_personal_intelligence_preferences') is not null,'preferences table exists');

select ok((select relrowsecurity from pg_class where oid='public.tios_personal_intelligence_conversations'::regclass),'conversation RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.tios_personal_intelligence_messages'::regclass),'message RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.tios_personal_intelligence_preferences'::regclass),'preferences RLS is enabled');

select ok(not has_table_privilege('anon','public.tios_personal_intelligence_conversations','select'),'anonymous role cannot read conversations');
select ok(has_table_privilege('authenticated','public.tios_personal_intelligence_conversations','select'),'authenticated role can read RLS-filtered conversations');
select ok(not has_table_privilege('anon','public.tios_personal_intelligence_messages','select'),'anonymous role cannot read messages');
select ok(has_table_privilege('authenticated','public.tios_personal_intelligence_messages','select'),'authenticated role can read RLS-filtered messages');
select ok(not has_table_privilege('anon','public.tios_personal_intelligence_preferences','select'),'anonymous role cannot read preferences');

select ok(has_column_privilege('authenticated','public.tios_personal_intelligence_messages','feedback','update'),'authenticated users can update message feedback');
select ok(not has_column_privilege('authenticated','public.tios_personal_intelligence_messages','content','update'),'authenticated users cannot rewrite saved message content');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='tios_pi_conversation_observation_dedupe_idx' and indexdef not like '% WHERE %'),'observation fingerprints have a unique index that the browser upsert can infer');
select ok(
  coalesce((select qual||' '||coalesce(with_check,'') from pg_policies where schemaname='public' and tablename='tios_personal_intelligence_conversations' and policyname='tios_pi_conversations_select_own'),'') like '%auth.uid%'
  and coalesce((select qual||' '||coalesce(with_check,'') from pg_policies where schemaname='public' and tablename='tios_personal_intelligence_messages' and policyname='tios_pi_messages_select_own'),'') like '%auth.uid%',
  'conversation and message policies scope rows to the authenticated user'
);

select * from finish();
rollback;
