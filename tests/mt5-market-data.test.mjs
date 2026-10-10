import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validateCandle,marketKey} from '../supabase/functions/mt5-market-data/handler.mjs';
const id='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-10-10T12:00:00Z');
const account={id,user_id:'owner',mt5_login:'12345',mt5_server:'Deriv-Demo',account_type:'demo',platform:'MT5',broker:'Deriv'};
const identity={login:'12345',server:'Deriv-Demo',account_type:'demo'};
const request={id:rid,account_id:id,user_id:'owner',mt5_symbol:'Volatility 75 (1s) Index.0',instrument_key:'v75_1s',timeframe:'H1',candle_open_at:'2026-10-10T10:00:00Z',expires_at:'2026-10-10T12:15:00Z',status:'queued'};
const body={action:'result',request_id:rid,account:identity,symbol:request.mt5_symbol,timeframe:'H1',open_epoch:Date.parse(request.candle_open_at)/1000,utc_offset_seconds:0,clock_confirmed:true,retrieved_epoch:now/1000,ohlc:{open:100,high:110,low:90,close:105}};
function db(overrides={}){
 const writes=[];
 return {writes,select:async(t,p)=>t==='trading_accounts'?[account]:t==='mt5_candle_requests'?[request]:[],insert:async(t,b)=>{writes.push({t,b,method:'insert'});return [b]},update:async(t,p,b)=>{writes.push({t,p,b,method:'update'});return []},upsert:async(t,b)=>{writes.push({t,b,method:'upsert'});return []},...overrides};
}
const req=(b,headers={'x-te-connection-id':id,'x-te-bridge-key':'disposable-unit-test-key'})=>new Request('https://example.test',{method:'POST',headers,body:JSON.stringify(b)});
test('completed broker data passes exact timestamp/market/timeframe validation with unchanged prices',()=>{
 const result=validateCandle(body,request,now);assert.deepEqual(result.ohlc,body.ohlc);
 assert.throws(()=>validateCandle({...body,symbol:'Volatility 75 Index.0'},request,now),/mismatch/);
 assert.throws(()=>validateCandle({...body,open_epoch:body.open_epoch+1},request,now),/opening/);
 assert.throws(()=>validateCandle({...body,timeframe:'M5'},request,now),/mismatch/);
 assert.throws(()=>validateCandle({...body,clock_confirmed:false},request,now),/confirmation/);
 assert.throws(()=>validateCandle({...body,retrieved_epoch:body.retrieved_epoch-300},request,now),/Stale/);
 assert.throws(()=>validateCandle({...body,ohlc:{...body.ohlc,high:80}},request,now),/OHLC/);
 assert.equal(marketKey('Volatility 75 Index.0'),'v75');assert.equal(marketKey('Volatility 75 (1s) Index_pro'),'v75_1s');
});
test('authentication fails closed for missing credentials, wrong user account, server or account type',async()=>{
 for(const b of [{...body,account:{...identity,login:'999'}},{...body,account:{...identity,server:'Other'}},{...body,account:{...identity,account_type:'real'}},{...body,account:{...identity,login:''}},{...body,account:null}]){
  const database=db();assert.equal((await createHandler({database,now:()=>now})(req(b))).status,401);assert.equal(database.writes.length,0);
 }
 assert.equal((await createHandler({database:db(),now:()=>now})(req(body,{}))).status,401);
 assert.equal((await createHandler({database:db({select:async()=>[]}),now:()=>now})(req(body))).status,401);
});
test('result ingestion derives ownership, never touches trades, and retains raw OHLC',async()=>{
 const database=db();const response=await createHandler({database,now:()=>now})(req({...body,user_id:'attacker',account_id:'other'}));assert.equal(response.status,200);
 const saved=database.writes.find(w=>w.method==='insert').b;assert.equal(saved.user_id,'owner');assert.equal(saved.account_id,id);assert.deepEqual(saved.ohlc,body.ohlc);
 assert.equal(saved.source,'mt5_bridge');assert.ok(database.writes.every(w=>!['trades','mt5_deals','trade_setup_evidence'].includes(w.t)));
});
test('cross-account request, expired response, stale clock and open candle are rejected',async()=>{
 const missing=db({select:async(t)=>t==='trading_accounts'?[account]:[]});assert.equal((await createHandler({database:missing,now:()=>now})(req(body))).status,404);
 const expired=db({select:async(t)=>t==='trading_accounts'?[account]:[{...request,expires_at:'2026-10-10T11:00:00Z'}]});assert.equal((await createHandler({database:expired,now:()=>now})(req(body))).status,409);
 const database=db();assert.equal((await createHandler({database,now:()=>now})(req({...body,retrieved_epoch:body.retrieved_epoch-999}))).status,400);assert.equal(database.writes.length,0);
 const open={...request,candle_open_at:'2026-10-10T12:00:00Z'};assert.throws(()=>validateCandle({...body,open_epoch:now/1000},open,now),/completed/);
});
test('idempotent retries do not replace the accepted candle and polling scopes all work to the bridge owner',async()=>{
 const database=db({select:async(t,p)=>t==='trading_accounts'?[account]:t==='mt5_candle_requests'?[request]:[{id:'old'}],insert:async()=>{const e=Error();e.code='23505';throw e}});
 assert.equal((await createHandler({database,now:()=>now})(req(body))).status,200);
 const pollDb=db();let filters;
 pollDb.select=async(t,p)=>{if(t==='trading_accounts')return [account];filters=p;return [request]};
 const response=await createHandler({database:pollDb,now:()=>now})(req({action:'poll',account:identity,symbols:[{symbol:'Volatility 75 (1s) Index.0',digits:2,point:0.01},{symbol:'Volatility 75 Index.0',digits:2,point:0.01}]}));
 assert.equal(response.status,200);assert.equal(filters.user_id,'eq.owner');assert.equal(filters.account_id,'eq.'+id);
 assert.equal((await response.json()).open_epoch,Date.parse(request.candle_open_at)/1000);
 assert.deepEqual(pollDb.writes.find(w=>w.method==='upsert').b.map(s=>s.instrument_key),['v75_1s','v75']);
});
test('H4, H1 and M5 each accept their exact completed candle with an explicit historical clock offset',()=>{
 const opening=Date.parse('2026-10-10T08:00:00Z')/1000;
 for(const timeframe of ['H4','H1','M5']){
  const r={...request,timeframe,candle_open_at:new Date(opening*1000).toISOString()};
  const result=validateCandle({...body,timeframe,open_epoch:opening+7200,utc_offset_seconds:7200},r,now);
  assert.equal(result.broker_open_epoch,opening+7200);assert.equal(result.broker_utc_offset_seconds,7200);assert.deepEqual(result.ohlc,body.ohlc);
 }
});
