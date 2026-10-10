-- Run through the existing project SQL connection. All QA rows are rolled back.
-- Only users explicitly marked tios_charts_qa are used. No customer row is changed.
begin;
select set_config('tios_feed.owner',(select id::text from auth.users where raw_user_meta_data->>'tios_charts_qa'='true' order by id limit 1),true);
select set_config('tios_feed.other',(select id::text from auth.users where raw_user_meta_data->>'tios_charts_qa'='true' order by id offset 1 limit 1),true);
do $$ begin
  assert current_setting('tios_feed.owner',true) is not null and current_setting('tios_feed.other',true) is not null, 'Two marked QA users required';
  assert not has_table_privilege('anon','public.market_feed_comparisons','SELECT'), 'Anonymous evidence access';
  assert not has_table_privilege('authenticated','public.mt5_market_candles','INSERT'), 'Client can forge broker candles';
  assert not has_table_privilege('authenticated','public.market_feed_comparisons','UPDATE'), 'Client can overwrite evidence';
end $$;
select set_config('request.jwt.claim.sub',current_setting('tios_feed.owner'),true);
set local role authenticated;
do $$
declare aid uuid; tid uuid; rid uuid; cid uuid; row public.market_feed_comparisons; bar jsonb:='{"open":100,"high":110,"low":90,"close":105}'; opening timestamptz:=date_trunc('hour',now())-interval '4 hours';
begin
  insert into public.trading_accounts(user_id,account_name,broker,platform,account_type,bridge_enabled,mt5_login,mt5_server) values(auth.uid(),'Feed QA rollback only','Deriv','MT5','demo',true,'QA123','QA-Server') returning id into aid;
  perform set_config('tios_feed.account',aid::text,true);
  insert into public.trades(user_id,account_id,trade_date,instrument,direction,source,mt5_position_id,opened_at,entry_price,pnl) values(auth.uid(),aid,opening::date,'Volatility 75 (1s) Index.0','Buy','mt5','qa-position',opening+interval '30 minutes',101,0) returning id into tid;
  perform set_config('tios_feed.trade',tid::text,true);
  insert into public.mt5_candle_requests(user_id,account_id,instrument_key,mt5_symbol,timeframe,candle_open_at,status,tv_symbol) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','H1',opening,'completed','FORGED:SYMBOL') returning id into rid;
  assert (select status='queued' and tv_symbol='DERIV:VOLATILITY_75_1S_INDEX' from public.mt5_candle_requests where id=rid), 'Request fields were not normalised';
  perform set_config('tios_feed.request',rid::text,true);
  insert into public.market_feed_comparisons(user_id,account_id,trade_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed,status,authoritative,broker_source) values(auth.uid(),aid,tid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,bar,now(),bar,'H1',opening,now(),true,'Mismatch',true,'mt5_bridge') returning * into row;
  assert row.status='Unverified Market Data' and not row.authoritative and row.broker_source='manual_mt5_chart', 'Forged verification accepted';
  assert row.mt5_position_id='qa-position' and not row.closed_before_recorded_entry and not row.entry_clock_verified, 'Entry/lookahead evidence is wrong';
  assert row.differences='{"open":0,"high":0,"low":0,"close":0}'::jsonb, 'Equal OHLC differences wrong';
  perform set_config('tios_feed.comparison',row.id::text,true);
  insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,'{"open":102,"high":112,"low":92,"close":107}',now(),bar,'H1',opening,now(),true) returning * into row;
  assert row.status='Mismatch' and row.interpretation='consistent_offset' and row.differences='{"open":2,"high":2,"low":2,"close":2}'::jsonb, 'Offset calculation wrong';
  insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_INDEX','H1',opening,bar,now(),bar,'H1',opening,now(),true) returning * into row;
  assert row.status='Mismatch', 'Standard and 1s symbols mixed';
  insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,'{"open":100.000000001,"high":110,"low":90,"close":105}',now(),bar,'H1',opening,now(),true) returning * into row;
  assert row.status='Mismatch' and (row.differences->>'open')::numeric=0.000000001, 'Small price difference rounded away';
  insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,bar,now()-interval '2 days',bar,'H1',opening,now(),true) returning * into row;
  assert row.status='Insufficient Data' and row.stale, 'Stale source accepted';
  insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,mt5_ohlc,mt5_retrieved_at,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),aid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,bar,now(),bar,'M5',opening,now(),true) returning * into row;
  assert row.status='Mismatch', 'Timeframes mixed';
  begin
    insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,timeframe,candle_open_at) values(current_setting('tios_feed.other')::uuid,aid,'v75_1s','Volatility 75 (1s) Index.0','H1',opening);
    raise exception 'Cross-user insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.mt5_candle_requests(user_id,account_id,instrument_key,mt5_symbol,timeframe,candle_open_at,tv_symbol) values(auth.uid(),aid,'v75','Volatility 75 (1s) Index.0','H1',opening,'DERIV:VOLATILITY_75_INDEX');
    raise exception 'Different market unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='Different market unexpectedly succeeded' then raise; end if; end;
  assert (select entry_price=101 and pnl=0 from public.trades where id=tid), 'Trade mutated by comparison';
end $$;
reset role;
-- Emulate bridge-only write using a synthetic known candle; rolled back below.
insert into public.mt5_market_candles(request_id,user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,broker_open_epoch,broker_utc_offset_seconds,clock_confirmed,ohlc,terminal_retrieved_at,completed)
select id,user_id,account_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,extract(epoch from candle_open_at)::bigint,0,true,'{"open":100,"high":110,"low":90,"close":105}',now(),true from public.mt5_candle_requests where id=current_setting('tios_feed.request')::uuid;
select set_config('tios_feed.candle',(select id::text from public.mt5_market_candles where request_id=current_setting('tios_feed.request')::uuid),true);
insert into public.mt5_deals(user_id,account_id,deal_id,position_id,entry_type,side,symbol,volume,price,profit,commission,swap,fee,deal_time,trade_date)
values(current_setting('tios_feed.owner')::uuid,current_setting('tios_feed.account')::uuid,'qa-open','qa-position','in','buy','Volatility 75 (1s) Index.0',1,101,0,0,0,0,now()-interval '3 hours',current_date),
(current_setting('tios_feed.owner')::uuid,current_setting('tios_feed.account')::uuid,'qa-partial','qa-position','out','sell','Volatility 75 (1s) Index.0',0.5,102,0.5,0,0,0,now()-interval '2 hours',current_date),
(current_setting('tios_feed.owner')::uuid,current_setting('tios_feed.account')::uuid,'qa-close','qa-position','out','sell','Volatility 75 (1s) Index.0',0.5,103,1,0,0,0,now()-interval '1 hour',current_date);
set local role authenticated;
do $$ declare row public.market_feed_comparisons; opening timestamptz; begin
  select candle_open_at into opening from public.mt5_market_candles where id=current_setting('tios_feed.candle')::uuid;
  insert into public.market_feed_comparisons(user_id,account_id,trade_id,instrument_key,mt5_symbol,tv_symbol,timeframe,candle_open_at,broker_candle_id,mt5_ohlc,tv_ohlc,tv_timeframe,tv_candle_open_at,tv_observed_at,tv_identity_confirmed) values(auth.uid(),current_setting('tios_feed.account')::uuid,current_setting('tios_feed.trade')::uuid,'v75_1s','Volatility 75 (1s) Index.0','DERIV:VOLATILITY_75_1S_INDEX','H1',opening,current_setting('tios_feed.candle')::uuid,'{"open":999,"high":999,"low":999,"close":999}','{"open":100,"high":110,"low":90,"close":105}','H1',opening,now(),true) returning * into row;
  assert row.mt5_ohlc='{"open":100,"high":110,"low":90,"close":105}'::jsonb and row.broker_source='mt5_bridge', 'Client replaced broker prices';
  assert array_length(row.mt5_deal_ids,1)=3 and row.mt5_position_id='qa-position', 'Partial/multiple deals not linked';
  assert (select count(*)=1 from public.trades where account_id=current_setting('tios_feed.account')::uuid), 'Partial deals duplicated trades';
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('tios_feed.other'),true);
set local role authenticated;
do $$ begin
  assert (select count(*)=0 from public.market_feed_comparisons where account_id=current_setting('tios_feed.account')::uuid), 'Other user sees comparisons';
  assert (select count(*)=0 from public.mt5_market_candles where id=current_setting('tios_feed.candle')::uuid), 'Other user sees broker candle';
  assert (select count(*)=0 from public.mt5_candle_requests where id=current_setting('tios_feed.request')::uuid), 'Other user sees request';
  begin
    insert into public.market_feed_comparisons(user_id,account_id,instrument_key,mt5_symbol,timeframe,candle_open_at) values(auth.uid(),current_setting('tios_feed.account')::uuid,'v75_1s','Volatility 75 (1s) Index.0','H1',now()-interval '2 hours');
    raise exception 'Cross-account write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: real database ownership, RLS, saved comparisons, exact OHLC deltas, lookahead flags, broker-price forgery rejection, partial deal links; all QA records rolled back' as result;
