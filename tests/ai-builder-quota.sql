-- Run only in the configured project with administrative SQL access.
-- Every counter write is rolled back; no user identity or content is returned.
begin;
do $$
declare
  fixture_user uuid;
  reservation record;
  attempt integer;
begin
  select id into fixture_user from auth.users where not exists (
    select 1 from tios_ai_private.usage u where u.user_id = auth.users.id
  ) limit 1;
  if fixture_user is null then raise exception 'No unused authenticated account is available for the rollback-only quota test'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture_user,'role','authenticated','is_anonymous',false)::text,true);
  for attempt in 1..6 loop
    select * into reservation from public.tios_ai_reserve_request();
    if reservation.allowed is not true then raise exception 'Expected minute reservation % to succeed',attempt; end if;
  end loop;
  select * into reservation from public.tios_ai_reserve_request();
  if reservation.allowed is not false or reservation.retry_after < 1 then raise exception 'Minute quota failed to reject the seventh request'; end if;
  update tios_ai_private.usage set minute_start = clock_timestamp() - interval '2 minutes', minute_count = 0, day_count = 39 where user_id = fixture_user;
  select * into reservation from public.tios_ai_reserve_request();
  if reservation.allowed is not true then raise exception 'Expected the fortieth daily reservation to succeed'; end if;
  select * into reservation from public.tios_ai_reserve_request();
  if reservation.allowed is not false or reservation.retry_after < 1 then raise exception 'Daily quota failed to reject the forty-first request'; end if;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin
    perform public.tios_ai_reserve_request();
    raise exception 'Unsigned quota request unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
