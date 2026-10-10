-- Preserve every numeric price difference; shape tolerance never means equal prices.
begin;
create or replace function public.prepare_market_feed_comparison() returns trigger
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
      delta:=(new.mt5_ohlc->>key)::numeric-(new.tv_ohlc->>key)::numeric;
      new.differences:=new.differences||jsonb_build_object(key,delta);
      min_delta:=least(min_delta,delta); max_delta:=greatest(max_delta,delta);
      unequal:=unequal or delta<>0;
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
commit;
