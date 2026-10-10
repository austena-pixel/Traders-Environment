'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../core/deriv-chart-feed.js');
const settle=()=>new Promise(r=>setImmediate(r));
const bars=[{epoch:1000,open:100,high:102,low:99,close:101},{epoch:1300,open:101,high:103,low:100,close:102}];
const catalogue=[{underlying_symbol_name:F.marketLabels.v75_1s,underlying_symbol:'one-second'},{underlying_symbol_name:F.marketLabels.v75,underlying_symbol:'standard'}];
function fixture(){
 const sockets=[],timers=new Map();let now=0,id=0;
 class Socket{constructor(){this.listeners={};this.sent=[];this.readyState=0;this.closed=false;sockets.push(this);}addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}emit(name,data){if(name==='open')this.readyState=1;for(const fn of this.listeners[name]||[])fn(name==='message'?{data:JSON.stringify(data)}:{});}send(s){this.sent.push(JSON.parse(s));}close(){this.closed=true;this.readyState=3;}}
 const feed=F.create({socketFactory:url=>{assert.equal(url,F.endpoint);return new Socket();},schedule:(fn,ms)=>{const n=++id;timers.set(n,{fn,ms});return n;},cancel:n=>timers.delete(n),now:()=>now});
 const updates=[];const listen=()=>feed.subscribe('v75_1s','5',s=>updates.push(s));
 async function connected(){sockets[0].emit('open');sockets[0].emit('message',{msg_type:'active_symbols',active_symbols:catalogue});await settle();sockets[1].emit('open');}
 return {feed,sockets,timers,updates,listen,connected,setNow:v=>{now=v;}};
}
test('history validates real OHLC and rejects malformed, impossible or duplicate candles',()=>{
 assert.deepEqual(F.history(bars).map(b=>b.time),[1000,1300]);assert.equal(F.candle({open_time:1000,open:'1.12345',high:'1.12346',low:'1.12344',close:'1.12345'}).close,1.12345);
 for(const data of [[],[bars[0],bars[0]],[{...bars[0],low:105}],[{...bars[0],high:99}],[{...bars[0],epoch:1.1}],[{...bars[0],close:NaN}]])assert.throws(()=>F.history(data));
});
test('native panes use the exact public catalogue identity and only public read-only requests',async()=>{
 const e=fixture(),stop=e.listen();await e.connected();assert.deepEqual(e.sockets[0].sent,[{active_symbols:'brief',req_id:1}]);assert.deepEqual(e.sockets[1].sent[0],{ticks_history:'one-second',style:'candles',granularity:300,end:'latest',count:1000,subscribe:1,req_id:2});assert.equal(e.sockets.flatMap(s=>s.sent).some(r=>r.authorize||r.buy||r.proposal),false);stop();e.feed.dispose();
});
test('matching panes share one candle stream and disposing one does not stop the other',async()=>{
 const e=fixture(),one=e.listen(),two=e.listen();assert.equal(e.sockets.length,1);await e.connected();assert.equal(e.sockets.length,2);e.sockets[1].emit('message',{msg_type:'candles',candles:bars,req_id:2});assert.equal(e.updates.at(-1).bars.length,2);one();assert.equal(e.sockets[1].closed,false);two();assert.equal(e.sockets[1].closed,true);assert.equal(e.timers.size,0);e.feed.dispose();
});
test('streaming OHLC uses open_time for the bar anchor and preserves the current candle on tick updates',async()=>{
 const e=fixture();e.listen();await e.connected();const s=e.sockets[1];s.emit('message',{msg_type:'candles',candles:bars,req_id:2});s.emit('message',{msg_type:'ohlc',ohlc:{symbol:'one-second',granularity:300,epoch:1399,open_time:1300,open:'101',high:'104',low:'100',close:'103'}});assert.equal(e.updates.at(-1).bars.length,2);assert.equal(e.updates.at(-1).bars[1].time,1300);assert.equal(e.updates.at(-1).bars[1].close,103);
 s.emit('message',{msg_type:'ohlc',ohlc:{symbol:'one-second',granularity:300,epoch:1601,open_time:1600,open:'103',high:'104',low:'102',close:'104'}});assert.equal(e.updates.at(-1).bars.length,3);e.feed.dispose();
});
test('out-of-order updates are ignored and market/timeframe mismatches stop the stream',async()=>{
 const e=fixture();e.listen();await e.connected();const s=e.sockets[1];s.emit('message',{msg_type:'candles',candles:bars,req_id:2});s.emit('message',{msg_type:'ohlc',ohlc:{symbol:'one-second',granularity:300,epoch:1200,open_time:1000,open:100,high:102,low:99,close:101}});assert.equal(e.updates.at(-1).bars[1].time,1300);
 s.emit('message',{msg_type:'ohlc',ohlc:{symbol:'standard',granularity:300,epoch:1600,open_time:1600,open:100,high:102,low:99,close:101}});assert.equal(e.updates.at(-1).status,'error');assert.equal(e.updates.at(-1).bars.length,2);assert.equal(s.closed,true);e.feed.dispose();
});
test('rate limits keep observations, enforce a cooldown, and never reconnect automatically',async()=>{
 const e=fixture(),stop=e.listen();await e.connected();e.sockets[1].emit('message',{msg_type:'candles',candles:bars,req_id:2});e.sockets[1].emit('message',{error:{code:'RateLimit',message:'Wait before retrying'}});assert.equal(e.updates.at(-1).bars.length,2);assert.equal(e.updates.at(-1).status,'error');assert.equal(e.timers.size,0);stop();e.listen();await settle();assert.equal(e.sockets.length,2);assert.match(e.updates.at(-1).message,/rate limiting/);e.feed.dispose();
});
test('earlier history loads around retained drawing anchors and merges without replacing current candles',async()=>{
 const e=fixture();e.feed.subscribe('v75_1s','5',s=>e.updates.push(s),700);await e.connected();const s=e.sockets[1];s.emit('message',{msg_type:'candles',candles:bars,req_id:2});assert.deepEqual(s.sent.at(-1),{ticks_history:'one-second',style:'candles',granularity:300,end:999,count:1000,subscribe:0,req_id:4});s.emit('message',{msg_type:'candles',req_id:4,candles:[{...bars[0],epoch:700}]});assert.deepEqual(e.updates.at(-1).bars.map(b=>b.time),[700,1000,1300]);assert.equal(e.updates.at(-1).bars[2].close,102);assert.equal(s.sent.length,2);e.feed.dispose();
});
test('manual history loading cannot generate simultaneous duplicate requests',async()=>{
 const e=fixture();e.listen();await e.connected();const s=e.sockets[1];s.emit('message',{msg_type:'candles',candles:bars,req_id:2});e.feed.loadEarlier('v75_1s','5');e.feed.loadEarlier('v75_1s','5');assert.equal(s.sent.filter(r=>r.req_id===4).length,1);e.feed.dispose();assert.equal(e.timers.size,0);
});
test('stale and stopped feeds remain explicit and retain observed candles without inventing updates',async()=>{
 const e=fixture();e.listen();await e.connected();e.sockets[1].emit('message',{msg_type:'candles',candles:bars,req_id:2});const stale=[...e.timers.values()].filter(t=>t.ms===30000).at(-1);stale.fn();assert.equal(e.updates.at(-1).status,'stale');assert.equal(e.updates.at(-1).bars.length,2);e.sockets[1].emit('close');assert.equal(e.updates.at(-1).status,'error');assert.equal(e.updates.at(-1).bars.length,2);e.feed.dispose();
});
