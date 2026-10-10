'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {FakeSocket,clock,resolve,tick}=require('./helpers/deriv-public-ticks-context.cjs');
function environment(){
 const root=path.join(__dirname,'..'),dom=new JSDOM(fs.readFileSync(path.join(root,'deriv-feed-check.html'),'utf8'),{url:'https://tios.test/deriv-feed-check.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,time=clock(),sockets=[];w.Date.now=time.now;w.setTimeout=time.setTimeout;w.clearTimeout=time.clearTimeout;
 w.WebSocket=class extends FakeSocket{constructor(url){super(url);sockets.push(this);}};
 for(const file of ['core/deriv-public-ticks.js','deriv-feed-check.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 const find=name=>w.document.querySelector('[data-feed-'+name+']');
 return {dom,w,time,sockets,find,start(){find('connect').click();const socket=sockets.at(-1);resolve(socket);return socket;},close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
test('standalone page has no fabricated quotes, displays original tick evidence and stops when backgrounded',()=>{
 const e=environment();try{
  assert.equal(e.sockets.length,0);assert.equal(e.find('price').textContent,'—');assert.match(e.w.document.body.textContent,/unverified against your MT5 account/);
  const socket=e.start();tick(socket,1791633600,123.456789);
  e.time.advance(1000);tick(socket,1791633601,124.987654);
  assert.equal(e.find('price').textContent,'124.987654');assert.equal(e.find('count').textContent,'2 / 1');assert.equal(e.find('gap').textContent,'1.000 s / 1.000 s');
  assert.equal(e.find('history').rows.length,2);assert.equal(e.find('status').textContent,'Streaming public ticks');
  assert.equal(e.find('connect').disabled,true);assert.equal(e.find('market').disabled,true);
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:true});e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  assert.equal(socket.closeCount,1);assert.match(e.find('live').textContent,/retained observation, not live/);assert.equal(e.time.timers.size,0);
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:false});e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  assert.equal(e.sockets.length,1);assert.equal(e.find('connect').disabled,false);
  e.find('market').value='v75';e.find('market').dispatchEvent(new e.w.Event('change'));
  assert.equal(e.find('price').textContent,'—');assert.equal(e.find('tv').textContent,'DERIV:VOLATILITY_75_INDEX');
  const standard=e.start();assert.equal(standard.sent[1].ticks,'catalog-standard');tick(standard,1791633602,987,'catalog-standard');assert.equal(e.find('price').textContent,'987');
 }finally{e.close();}
});
test('provider errors are plain text; rate limits show a manual cooldown without reconnecting',()=>{
 const e=environment();try{
  e.find('connect').click();const socket=e.sockets[0];socket.open();socket.receive({error:{code:'RateLimit',message:'<img src=x onerror=alert(1)> Rate limited'}});
  assert.equal(e.find('message').querySelector('img'),null);assert.match(e.find('message').textContent,/<img/);
  assert.equal(e.find('status').textContent,'Rate limited');assert.match(e.find('retry').textContent,/60 s/);assert.equal(e.find('connect').disabled,true);
  e.time.advance(60000);assert.equal(e.sockets.length,1);assert.equal(e.find('connect').disabled,false);assert.equal(e.time.timers.size,0);
 }finally{e.close();}
});
