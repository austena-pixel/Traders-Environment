'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../core/deriv-public-ticks.js');
const {FakeSocket,clock,catalog,resolve,tick}=require('./helpers/deriv-public-ticks-context.cjs');
function environment(){
 const time=clock(),sockets=[],changes=[];
 const client=api.create({...time,socketFactory:url=>{const socket=new FakeSocket(url);sockets.push(socket);return socket;},onChange:state=>changes.push(state)});
 return {time,sockets,changes,client,start(key='v75_1s'){client.connect(key);const socket=sockets.at(-1);resolve(socket);return socket;}};
}
test('no connection until requested; exact live catalogue identities keep the two markets separate',()=>{
 const e=environment();assert.equal(e.sockets.length,0);assert.equal(e.client.snapshot().lastTick,null);
 const first=e.start();assert.equal(first.url,api.endpoint);
 assert.deepEqual(first.sent,[{active_symbols:'brief',req_id:1},{ticks:'catalog-one-second',subscribe:1,req_id:2}]);
 assert.equal(e.client.snapshot().status,'awaiting_ticks');assert.equal(e.client.snapshot().lastTick,null);
 assert.equal(e.client.connect('v75_1s'),false);assert.equal(e.sockets.length,1);
 const second=e.start('v75');assert.equal(first.closeCount,1);assert.equal(second.sent[1].ticks,'catalog-standard');
 assert.equal(e.client.snapshot().market.label,'Volatility 75 Index');e.client.dispose();assert.equal(e.time.timers.size,0);
});
test('missing, ambiguous, suspended, legacy or hostile catalogue identities fail before a tick subscription',()=>{
 for(const items of [[],[catalog[1]],[catalog[0],catalog[0]],[{...catalog[0],is_trading_suspended:1}],[{...catalog[0],exchange_is_open:0}],[{symbol:'1HZ75V',display_name:catalog[0].underlying_symbol_name}],[{...catalog[0],underlying_symbol:'<script>'}]]){
  const e=environment(),socket=e.start('v75_1s'); // Resolve the default catalogue, then test resolution independently.
  assert.throws(()=>api.resolveMarket(items,'v75_1s'));
  e.client.stop();e.client.connect('v75_1s');const rejected=e.sockets.at(-1);resolve(rejected,items);
  assert.equal(e.client.snapshot().errorCode,'UnverifiedSymbol');assert.equal(rejected.sent.length,1);assert.equal(rejected.closeCount,1);assert.equal(e.time.timers.size,0);e.client.dispose();
  assert.equal(socket.closeCount,1);
 }
});
test('actual source values and browser arrivals remain separate; repeated prices count as ticks, not price changes',()=>{
 const e=environment(),socket=e.start(),epoch=Math.floor(e.time.now()/1000);
 tick(socket,epoch,123.456789);assert.equal(e.client.snapshot().status,'streaming');
 e.time.advance(1000);tick(socket,epoch+1,123.456789);
 e.time.advance(1200);tick(socket,epoch+2,124.987654);
 let state=e.client.snapshot();assert.equal(state.lastTick.quote,124.987654);assert.equal(state.lastTick.epoch,epoch+2);
 assert.equal(state.lastTick.receivedAtMs,e.time.now());assert.equal(state.lastGapMs,1200);assert.equal(state.medianGapMs,1100);
 assert.equal(state.totalTicks,3);assert.equal(state.priceChanges,1);
 tick(socket,epoch+2,124.987654);tick(socket,epoch-1,999);assert.equal(e.client.snapshot().totalTicks,3);
 state.lastTick.quote=0;state.samples[0].quote=0;assert.equal(e.client.snapshot().lastTick.quote,124.987654);
 e.client.stop();state=e.client.snapshot();assert.equal(state.status,'stopped');assert.equal(state.lastTick.quote,124.987654);assert.equal(e.time.timers.size,0);e.client.dispose();
});
test('foreign instrument and invalid values are rejected without replacing an observed safe price',()=>{
 for(const value of [{quote:123,symbol:'catalog-standard',epoch:1791633601},{quote:'123',symbol:'catalog-one-second',epoch:1791633601},{quote:0,symbol:'catalog-one-second',epoch:1791633601},{quote:123,symbol:'catalog-one-second',epoch:1.1},{quote:123,symbol:'catalog-one-second',epoch:Number.MAX_SAFE_INTEGER}]){
  const e=environment(),socket=e.start();tick(socket,1791633600,123.456789);socket.receive({msg_type:'tick',tick:value});
  const state=e.client.snapshot();assert.equal(state.status,'error');assert.equal(state.totalTicks,1);assert.equal(state.lastTick.quote,123.456789);assert.equal(socket.closeCount,1);assert.equal(e.time.timers.size,0);e.client.dispose();
 }
});
test('RateLimit closes the connection, blocks all markets for 60 seconds, and never automatically retries',()=>{
 const e=environment();e.client.connect('v75_1s');const socket=e.sockets[0];socket.open();
 socket.receive({error:{code:'RateLimit',message:'You have reached the rate limit.'},msg_type:'active_symbols'});
 assert.equal(e.client.snapshot().status,'rate_limit');assert.equal(e.time.timers.size,0);assert.equal(socket.closeCount,1);
 e.time.advance(59000);assert.equal(e.client.connect('v75'),false);assert.equal(e.sockets.length,1);
 e.time.advance(1000);assert.equal(e.sockets.length,1);assert.equal(e.client.connect('v75'),true);assert.equal(e.sockets.length,2);e.client.dispose();
});
test('timeout, staleness, recovery and disposal have bounded timers and retain honest connection status',()=>{
 const e=environment();e.client.connect('v75_1s');e.time.advance(15000);
 assert.equal(e.client.snapshot().errorCode,'Timeout');assert.equal(e.time.timers.size,0);
 const socket=e.start();tick(socket,1791633615);e.time.advance(15000);
 assert.equal(e.client.snapshot().status,'stale');assert.equal(e.client.snapshot().totalTicks,1);
 tick(socket,1791633630,124);assert.equal(e.client.snapshot().status,'streaming');
 e.time.advance(15000);assert.deepEqual(socket.sent.at(-1),{ping:1,req_id:3});
 e.client.dispose();assert.equal(e.time.timers.size,0);socket.receive({error:{code:'Fake',message:'old socket'}});
 assert.equal(e.client.snapshot().status,'stale');assert.equal(e.client.connect('v75'),false);
});
test('unexpected close, malformed response and provider errors stop without a reconnect loop',()=>{
 for(const action of [socket=>socket.close(),socket=>socket.emit('message',{data:'not json'}),socket=>socket.receive({error:{code:'InvalidSymbol',message:'Unavailable'}}),socket=>socket.emit('error')]){
  const e=environment(),socket=e.start();action(socket);assert.ok(['error','disconnected'].includes(e.client.snapshot().status));
  e.time.advance(120000);assert.equal(e.sockets.length,1);assert.equal(e.time.timers.size,0);e.client.dispose();
 }
});
test('connection traffic is restricted to public catalogue, one subscription and heartbeat; recent history is bounded',()=>{
 const e=environment(),socket=e.start();for(let i=0;i<50;i++){tick(socket,1791633600+i,123+i);e.time.advance(1000);}
 assert.equal(e.client.snapshot().totalTicks,50);assert.equal(e.client.snapshot().samples.length,20);
 for(const message of socket.sent){assert.ok(Object.hasOwn(message,'active_symbols')||Object.hasOwn(message,'ticks')||Object.hasOwn(message,'ping'));assert.equal(Object.keys(message).some(key=>/buy|sell|authorize|token|password|account|balance/.test(key)),false);}
 e.client.stop('Market changed.',true);assert.equal(e.client.snapshot().lastTick,null);assert.equal(e.client.snapshot().apiSymbol,null);assert.equal(e.client.snapshot().samples.length,0);e.client.dispose();
});
