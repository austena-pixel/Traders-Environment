-- Durable pilot limits: 6 requests per minute and 40 per UTC day, per authenticated user.
-- This stores counters only. No prompts, strategies, tokens or conversation history.
create schema if not exists tios_ai_private;
revoke all on schema tios_ai_private from public, anon, authenticated;
create table if not exists tios_ai_private.usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null,
  minute_count integer not null check (minute_count >= 0),
  day_start date not null,
  day_count integer not null check (day_count >= 0)
);
alter table tios_ai_private.usage enable row level security;
revoke all on tios_ai_private.usage from public, anon, authenticated;
create or replace function public.tios_ai_reserve_request()
returns table(allowed boolean, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  moment timestamptz := clock_timestamp();
  utc_day date := (moment at time zone 'UTC')::date;
  used tios_ai_private.usage%rowtype;
begin
  if uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'An authenticated user is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into used from tios_ai_private.usage where user_id = uid;
  if not found then
    insert into tios_ai_private.usage values (uid, moment, 1, utc_day, 1);
    return query select true, 0; return;
  end if;
  if used.day_start <> utc_day then used.day_count := 0; used.day_start := utc_day; end if;
  if used.minute_start <= moment - interval '1 minute' then used.minute_count := 0; used.minute_start := moment; end if;
  if used.day_count >= 40 then
    return query select false, greatest(1,ceil(extract(epoch from ((utc_day + 1)::timestamp at time zone 'UTC') - moment))::integer); return;
  end if;
  if used.minute_count >= 6 then
    return query select false, greatest(1,ceil(extract(epoch from used.minute_start + interval '1 minute' - moment))::integer); return;
  end if;
  update tios_ai_private.usage set minute_start = used.minute_start, minute_count = used.minute_count + 1,
    day_start = used.day_start, day_count = used.day_count + 1 where user_id = uid;
  return query select true, 0;
end;
$$;
revoke all on function public.tios_ai_reserve_request() from public, anon;
grant execute on function public.tios_ai_reserve_request() to authenticated;
