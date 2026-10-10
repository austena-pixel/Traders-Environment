-- Additive evidence only. Existing trades, deals, reflections and pictures are untouched.
begin;
create function public.market_symbol_key(symbol text) returns text
language sql immutable strict set search_path = '' as $$
  select case
    when symbol ~* '^Volatility 75 \(1s\) Index([._#-][a-z0-9._#-]{0,15})?$' then 'v75_1s'
    when symbol ~* '^Volatility 75 Index([._#-][a-z0-9._#-]{0,15})?$' then 'v75'
    else null end;
$$;
create function public.market_valid_ohlc(bar jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare o numeric; h numeric; l numeric; c numeric;
begin
  if bar is null or jsonb_typeof(bar) <> 'object' then return false; end if;
  if jsonb_typeof(bar->'open') is distinct from 'number' or jsonb_typeof(bar->'high') is distinct from 'number'
    or jsonb_typeof(bar->'low') is distinct from 'number' or jsonb_typeof(bar->'close') is distinct from 'number' then return false; end if;
  o := (bar->>'open')::numeric; h := (bar->>'high')::numeric; l := (bar->>'low')::numeric; c := (bar->>'close')::numeric;
  return h >= greatest(o,c,l) and l <= least(o,c,h);
end;
$$;

create table public.mt5_market_symbols (
  account_id uuid not null references public.trading_accounts(id),
  user_id uuid not null references auth.users(id),
  mt5_symbol text not null check (length(mt5_symbol) <= 100),
  instrument_key text not null check (instrument_key in ('v75_1s','v75')),
  digits integer not null check (digits between 0 and 12),
  point numeric not null check (point > 0),
  description text not null default '',
  broker_server text not null,
  retrieved_at timestamptz not null default now(),
  source text not null default 'mt5_bridge' check (source='mt5_bridge'),
  primary key(account_id, mt5_symbol),
  check (public.market_symbol_key(mt5_symbol) is not null and public.market_symbol_key(mt5_symbol) = instrument_key)
);
create table public.mt5_candle_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.trading_accounts(id),
  instrument_key text not null check (instrument_key in ('v75_1s','v75')),
  mt5_symbol text not null check (length(mt5_symbol) <= 100),
  tv_symbol text not null,
  timeframe text not null check (timeframe in ('H4','H1','M5')),
  candle_open_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','completed','unavailable')),
  message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  completed_at timestamptz,
  unique(id,user_id,account_id),
  check (public.market_symbol_key(mt5_symbol) is not null and public.market_symbol_key(mt5_symbol) = instrument_key)
);
create table public.mt5_market_candles (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.trading_accounts(id),
  instrument_key text not null check (instrument_key in ('v75_1s','v75')),
  mt5_symbol text not null,
  tv_symbol text not null,
  timeframe text not null check (timeframe in ('H4','H1','M5')),
  candle_open_at timestamptz not null,
  broker_open_epoch bigint not null,
  broker_utc_offset_seconds integer not null check (broker_utc_offset_seconds between -50400 and 50400),
  clock_confirmed boolean not null default false,
  ohlc jsonb not null check (public.market_valid_ohlc(ohlc)),
  raw_metadata jsonb not null default '{}',
  terminal_retrieved_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  completed boolean not null,
  source text not null default 'mt5_bridge' check (source='mt5_bridge'),
  foreign key(request_id,user_id,account_id) references public.mt5_candle_requests(id,user_id,account_id),
  check (public.market_symbol_key(mt5_symbol) is not null and public.market_symbol_key(mt5_symbol) = instrument_key),
  check (extract(epoch from candle_open_at) = broker_open_epoch - broker_utc_offset_seconds)
);
create table public.market_feed_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.trading_accounts(id),
  trade_id uuid references public.trades(id),
  mt5_position_id text,
  mt5_deal_ids text[] not null default '{}',
  trade_entry_at timestamptz,
  entry_clock_verified boolean not null default false check (entry_clock_verified = false),
  instrument_key text not null check (instrument_key in ('v75_1s','v75')),
  mt5_symbol text not null,
  tv_symbol text,
  timeframe text not null check (timeframe in ('H4','H1','M5')),
  candle_open_at timestamptz not null,
  broker_candle_id uuid references public.mt5_market_candles(id),
  broker_source text not null default 'manual_mt5_chart' check (broker_source in ('mt5_bridge','manual_mt5_chart')),
  mt5_ohlc jsonb,
  mt5_retrieved_at timestamptz,
  tv_source text not null default 'manual_tradingview' check (tv_source='manual_tradingview'),
  tv_ohlc jsonb,
  tv_timeframe text check (tv_timeframe in ('H4','H1','M5')),
  tv_candle_open_at timestamptz,
  tv_observed_at timestamptz,
  tv_identity_confirmed boolean not null default false,
  differences jsonb,
  interpretation text,
  status text not null default 'Insufficient Data' check (status in ('Unverified Market Data','Mismatch','Insufficient Data')),
  completed boolean not null default false,
  stale boolean not null default true,
  authoritative boolean not null default false check (authoritative = false),
  closed_before_recorded_entry boolean,
  conditions jsonb not null default '{"broker_ohlc":"unverified","tradingview_ohlc":"user_observed","at_entry_context":"unverified","spread_cause":"unknown"}',
  notes text not null default '' check (length(notes)<=1000),
  created_at timestamptz not null default now(),
  check (mt5_ohlc is null or public.market_valid_ohlc(mt5_ohlc)),
  check (tv_ohlc is null or public.market_valid_ohlc(tv_ohlc))
);
create index mt5_symbols_user_account on public.mt5_market_symbols(user_id,account_id);
create index candle_requests_user_account on public.mt5_candle_requests(user_id,account_id,created_at desc);
create index candle_requests_queue on public.mt5_candle_requests(account_id,created_at) where status='queued';
create index market_candles_user_account on public.mt5_market_candles(user_id,account_id,candle_open_at desc);
create index feed_comparisons_user_account on public.market_feed_comparisons(user_id,account_id,created_at desc);
create index feed_comparisons_trade on public.market_feed_comparisons(trade_id,created_at desc) where trade_id is not null;
create index feed_comparisons_candle on public.market_feed_comparisons(broker_candle_id) where broker_candle_id is not null;

alter table public.mt5_market_symbols enable row level security;
alter table public.mt5_candle_requests enable row level security;
alter table public.mt5_market_candles enable row level security;
alter table public.market_feed_comparisons enable row level security;
revoke all on public.mt5_market_symbols, public.mt5_candle_requests, public.mt5_market_candles, public.market_feed_comparisons from anon, authenticated;
grant select on public.mt5_market_symbols, public.mt5_market_candles to authenticated;
grant select, insert on public.mt5_candle_requests, public.market_feed_comparisons to authenticated;
grant all on public.mt5_market_symbols, public.mt5_candle_requests, public.mt5_market_candles, public.market_feed_comparisons to service_role;
create policy market_symbols_read_own on public.mt5_market_symbols for select to authenticated using (user_id=(select auth.uid()));
create policy market_candles_read_own on public.mt5_market_candles for select to authenticated using (user_id=(select auth.uid()));
create policy candle_requests_read_own on public.mt5_candle_requests for select to authenticated using (user_id=(select auth.uid()));
create policy candle_requests_insert_own on public.mt5_candle_requests for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.trading_accounts a where a.id=account_id and a.user_id=(select auth.uid()) and a.platform='MT5' and a.bridge_enabled)
);
create policy feed_comparisons_read_own on public.market_feed_comparisons for select to authenticated using (user_id=(select auth.uid()));
create policy feed_comparisons_insert_own on public.market_feed_comparisons for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.trading_accounts a where a.id=account_id and a.user_id=(select auth.uid()))
);

create function public.prepare_mt5_candle_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare seconds integer;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'Request owner must be authenticated' using errcode='42501'; end if;
  if public.market_symbol_key(new.mt5_symbol) is distinct from new.instrument_key then raise exception 'Different MT5 market'; end if;
  seconds:=case new.timeframe when 'H4' then 14400 when 'H1' then 3600 when 'M5' then 300 else null end;
  if seconds is null or new.candle_open_at + seconds * interval '1 second' > now() then raise exception 'Choose a completed candle'; end if;
  if extract(epoch from new.candle_open_at)::numeric <> trunc(extract(epoch from new.candle_open_at)) then raise exception 'Candle timestamp must use whole seconds'; end if;
  if (select count(*) from public.mt5_candle_requests where account_id=new.account_id and user_id=new.user_id and status='queued' and expires_at>now()) >= 10 then raise exception 'Ten requests are already pending'; end if;
  new.tv_symbol:=case new.instrument_key when 'v75_1s' then 'DERIV:VOLATILITY_75_1S_INDEX' else 'DERIV:VOLATILITY_75_INDEX' end;
  new.status:='queued'; new.message:=null; new.created_at:=now(); new.expires_at:=now()+interval '15 minutes'; new.completed_at:=null;
  return new;
end;
$$;
create trigger prepare_mt5_candle_request before insert on public.mt5_candle_requests for each row execute function public.prepare_mt5_candle_request();

create function public.prepare_market_feed_comparison() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare b public.mt5_market_candles; t public.trades; expected text; seconds integer; key text; delta numeric; min_delta numeric; max_delta numeric; unequal boolean:=false; identity_ok boolean;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'Comparison owner must be authenticated' using errcode='42501'; end if;
  if not exists(select 1 from public.trading_accounts a where a.id=new.account_id and a.user_id=new.user_id) then raise exception 'Account not owned' using errcode='42501'; end if;
  if public.market_symbol_key(new.mt5_symbol) is distinct from new.instrument_key then raise exception 'Different MT5 market'; end if;
  new.created_at:=now(); new.authoritative:=false; new.entry_clock_verified:=false;
  new.tv_source:='manual_tradingview'; new.conditions:='{"broker_ohlc":"unverified","tradingview_ohlc":"user_observed","at_entry_context":"unverified","spread_cause":"unknown"}';
  new.mt5_position_id:=null; new.mt5_deal_ids:='{}'; new.trade_entry_at:=null; new.closed_before_recorded_entry:=null;
  if new.trade_id is not null then
    select * into t from public.trades where id=new.trade_id and user_id=new.user_id and account_id=new.account_id and source='mt5' and not is_deleted;
    if not found or t.instrument is distinct from new.mt5_symbol then raise exception 'Trade/account/instrument mismatch' using errcode='42501'; end if;
    new.mt5_position_id:=t.mt5_position_id; new.trade_entry_at:=t.opened_at;
    select coalesce(array_agg(d.deal_id order by d.deal_time,d.deal_id),'{}') into new.mt5_deal_ids from public.mt5_deals d where d.user_id=new.user_id and d.account_id=new.account_id and d.position_id=t.mt5_position_id;
  end if;
  if new.broker_candle_id is not null then
    select * into b from public.mt5_market_candles where id=new.broker_candle_id and user_id=new.user_id and account_id=new.account_id;
    if not found or b.mt5_symbol is distinct from new.mt5_symbol or b.timeframe is distinct from new.timeframe or b.candle_open_at is distinct from new.candle_open_at then raise exception 'Broker candle identity mismatch' using errcode='42501'; end if;
    new.broker_source:='mt5_bridge'; new.mt5_ohlc:=b.ohlc; new.mt5_retrieved_at:=b.retrieved_at;
    if b.clock_confirmed and b.completed then new.conditions:=jsonb_set(new.conditions,'{broker_ohlc}','"broker_observed"'); end if;
  else new.broker_source:='manual_mt5_chart'; end if;
  if (new.mt5_ohlc is not null and not public.market_valid_ohlc(new.mt5_ohlc)) or (new.tv_ohlc is not null and not public.market_valid_ohlc(new.tv_ohlc)) then raise exception 'Invalid OHLC'; end if;
  if new.mt5_retrieved_at>now()+interval '30 seconds' or new.tv_observed_at>now()+interval '30 seconds' then raise exception 'Observation timestamp is in the future'; end if;
  expected:=case new.instrument_key when 'v75_1s' then 'DERIV:VOLATILITY_75_1S_INDEX' else 'DERIV:VOLATILITY_75_INDEX' end;
  seconds:=case new.timeframe when 'H4' then 14400 when 'H1' then 3600 when 'M5' then 300 end;
  new.completed:=new.candle_open_at + seconds*interval '1 second'<=now();
  new.stale:=new.mt5_retrieved_at is null or new.tv_observed_at is null or new.mt5_retrieved_at<now()-interval '24 hours' or new.tv_observed_at<now()-interval '24 hours';
  identity_ok:=coalesce(new.tv_symbol=expected and new.tv_timeframe=new.timeframe and new.tv_candle_open_at=new.candle_open_at,false);
  new.differences:=null; new.interpretation:=null; new.status:='Insufficient Data';
  if new.mt5_ohlc is not null and new.tv_ohlc is not null then
    new.differences:='{}';
    foreach key in array array['open','high','low','close'] loop
      delta:=round((new.mt5_ohlc->>key)::numeric-(new.tv_ohlc->>key)::numeric,8);
      new.differences:=new.differences||jsonb_build_object(key,delta);
      min_delta:=least(min_delta,delta); max_delta:=greatest(max_delta,delta);
      unequal:=unequal or abs(delta)>0.00001;
    end loop;
    new.interpretation:=case when not unequal then 'equal_prices' when max_delta-min_delta<=0.00001 then 'consistent_offset' else 'different_candle_values' end;
    new.status:=case when not identity_ok then 'Mismatch'
      when not new.completed or new.stale or not new.tv_identity_confirmed or (new.broker_candle_id is not null and (not b.clock_confirmed or not b.completed)) then 'Insufficient Data'
      when unequal then 'Mismatch' else 'Unverified Market Data' end;
  end if;
  if new.trade_entry_at is not null then new.closed_before_recorded_entry:=new.candle_open_at+seconds*interval '1 second'<=new.trade_entry_at; end if;
  return new;
end;
$$;
create trigger prepare_market_feed_comparison before insert on public.market_feed_comparisons for each row execute function public.prepare_market_feed_comparison();
revoke all on function public.prepare_mt5_candle_request(), public.prepare_market_feed_comparison() from public;
comment on table public.market_feed_comparisons is 'Immutable comparisons. TradingView OHLC is user-observed, never authoritative. Matching names or prices cannot verify price history.';
comment on table public.mt5_market_candles is 'Original OHLC from authenticated read-only companion. Explicit clock configuration is recorded. No broker price adjustment.';
commit;
