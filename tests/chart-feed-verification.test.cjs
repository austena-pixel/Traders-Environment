'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../core/chart-feed-verification.js');
const candle={open:100,high:110,low:90,close:105};
test('initial comparator preserves original OHLC and distinguishes offset from different shape',()=>{
 const tv=structuredClone(candle),broker={open:102,high:112,low:92,close:107};
 assert.deepEqual(F.compare(tv,broker).deltas,{open:2,high:2,low:2,close:2});
 assert.equal(F.compare(tv,broker).interpretation,'consistent_offset');assert.deepEqual(tv,candle);assert.equal(broker.open,102);
 assert.equal(F.compare(tv,{...broker,close:106}).interpretation,'different_candle_values');
 const tiny=F.compare(tv,{...tv,close:tv.close+0.000000001});assert.equal(tiny.interpretation,'consistent_offset');assert.notEqual(tiny.deltas.close,0);
 assert.equal(F.compare(tv,{...broker,high:101}).ok,false);assert.equal(F.compare(tv,{...broker,close:NaN}).ok,false);
});
test('instrument families never mix, and conservative broker suffixes resolve independently',()=>{
 for(const suffix of ['','.0','_pro','#1','-demo']){
 assert.equal(F.marketForSymbol('Volatility 75 (1s) Index'+suffix).key,'v75_1s');assert.equal(F.marketForSymbol('Volatility 75 Index'+suffix).key,'v75');}
 for(const value of ['Volatility 75 (1s) Index standard','Volatility 750 Index.0','Volatility 75 Index (1s)','Volatility 75 (1s) Index.0 other'])assert.equal(F.marketForSymbol(value),null);
});
test('known completed candle comparisons calculate all differences without claiming verification',()=>{
 const opening='2026-10-09T08:00:00Z',now=Date.parse('2026-10-09T12:00:00Z'),stamp=new Date(now).toISOString();
 const input={broker:{ohlc:candle,symbol:'Volatility 75 (1s) Index.0',timeframe:'H1',opening,retrievedAt:stamp},tv:{ohlc:candle,symbol:'DERIV:VOLATILITY_75_1S_INDEX',timeframe:'H1',opening,observedAt:stamp},market:'v75_1s',timeframe:'H1',opening,now};
 const equal=F.assess(input);assert.equal(equal.status,'Unverified Market Data');assert.equal(equal.authoritative,false);
 assert.deepEqual(equal.deltas,{open:0,high:0,low:0,close:0});
 assert.equal(F.assess({...input,tv:{...input.tv,symbol:'DERIV:VOLATILITY_75_INDEX'}}).status,'Mismatch');
 assert.equal(F.assess({...input,tv:{...input.tv,timeframe:'M5'}}).status,'Mismatch');
 assert.equal(F.assess({...input,tv:{...input.tv,opening:'2026-10-09T09:00:00Z'}}).status,'Mismatch');
 assert.equal(F.assess({...input,broker:{...input.broker,ohlc:{...candle,open:101}}}).status,'Mismatch');
 assert.equal(F.assess({...input,broker:{...input.broker,retrievedAt:'2026-10-01T00:00:00Z'}}).status,'Insufficient Data');
 assert.equal(F.assess({...input,now:Date.parse('2026-10-09T08:30:00Z')}).status,'Insufficient Data');
 assert.equal(F.assess({...input,tv:null}).status,'Insufficient Data');
});
test('live connectivity is freshness-sensitive and latest completed defaults use explicit UTC',()=>{
 const at=Date.parse('2026-10-10T12:02:10Z');assert.equal(F.lastClosedOpening('H4',at),'2026-10-10T08:00:00.000Z');
 assert.equal(F.lastClosedOpening('H1',at),'2026-10-10T11:00:00.000Z');assert.equal(F.lastClosedOpening('M5',at),'2026-10-10T11:55:00.000Z');
 assert.equal(F.connection({bridge_enabled:true,connection_status:'connected',last_sync_at:'2026-09-25T19:17:14Z'},at),'Stale / offline');
 assert.equal(F.connection({bridge_enabled:true,connection_status:'connected',last_sync_at:new Date(at-5000).toISOString()},at),'Connected');
});
test('strategy safeguards reject lookahead, unverified clocks, unrelated accounts and unsupported conditions',()=>{
 const c={timeframe:'H1',candle_open_at:'2026-10-10T10:00:00Z',instrument_key:'v75_1s',source:'mt5_bridge',clock_confirmed:true,completed:true,user_id:'u',account_id:'a'};
 const t={source:'mt5',mt5_position_id:'position',opened_at:'2026-10-10T11:15:00Z',instrument:'Volatility 75 (1s) Index.0',user_id:'u',account_id:'a',entry_clock_verified:true};
 const run=(candle=c,trade=t)=>F.strategyEvidence({candle,trade,conditions:['candle_close','discipline','spread_cause']});
 assert.equal(run().authoritativeAtEntry,true);assert.deepEqual(run().conditions.map(x=>x.status),['verifiable','unverified','unverified']);
 assert.equal(run(c,{...t,entry_clock_verified:false}).authoritativeAtEntry,false);
 assert.equal(run(c,{...t,opened_at:'2026-10-10T10:15:00Z'}).lookahead,true);assert.equal(run(c,{...t,opened_at:'2026-10-10T10:15:00Z'}).authoritativeAtEntry,false);
 assert.equal(run(c,{...t,account_id:'other'}).authoritativeAtEntry,false);assert.equal(run(c,{...t,instrument:'Volatility 75 Index.0'}).authoritativeAtEntry,false);
 assert.equal(run({...c,source:'manual_mt5_chart'}).authoritativeAtEntry,false);assert.equal(run().executionScoreAdjustment,0);assert.equal(run().priceComparisonAuthoritative,false);
});
