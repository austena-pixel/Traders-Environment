'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {FakeSocket,clock,resolve,tick}=require('./helpers/deriv-public-ticks-context.cjs');
const {installRecordingWorkspace}=require('./helpers/chart-recording-workspace.cjs');
const P=require('../core/chart-workspace.js'),F=require('../core/chart-feed-verification.js');
const settle=()=>new Promise(r=>setImmediate(r));
function environment({loadPublicTicks,loadInstruments,mobile=false}={}){
 const dom=new JSDOM('<div id="host"></div>',{url:'https://tios.test/t-ios.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.matchMedia=()=>({matches:mobile});w.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(w.crypto,'randomUUID',{value:require('node:crypto').randomUUID});
 let user={id:'owner'};const account={id:'account',user_id:'owner',account_name:'Deriv Demo',platform:'MT5',bridge_enabled:true,connection_status:'connected',last_sync_at:'2026-09-25T00:00:00Z'};
 const prefs=P.defaults();for(const mode of ['single','multiple'])for(const c of prefs.charts[mode])c.symbol=P.preferredDerivSymbol;
 const opening=F.lastClosedOpening('H1'),bar={open:100,high:110,low:90,close:105};
 const trade={id:'trade',user_id:'owner',account_id:'account',source:'mt5',instrument:'Volatility 75 (1s) Index.0',opened_at:new Date(Date.parse(opening)+1800000).toISOString(),mt5_position_id:'position',is_deleted:false};
 const tables={chart_workspace_preferences:[{user_id:'owner',configuration:prefs,revision:1,schema_version:1}],trades:[trade],mt5_market_symbols:[],mt5_market_candles:[{id:'candle',account_id:'account',user_id:'owner',instrument_key:'v75_1s',mt5_symbol:trade.instrument,timeframe:'H1',candle_open_at:opening,ohlc:bar,clock_confirmed:true,completed:true,retrieved_at:new Date().toISOString(),terminal_retrieved_at:new Date().toISOString(),broker_utc_offset_seconds:0}],mt5_candle_requests:[],market_feed_comparisons:[]};
 tables.mt5_market_candles.push({...tables.mt5_market_candles[0],id:'prior-candle',candle_open_at:F.lastClosedOpening('H1',Date.parse(trade.opened_at))});
 const writes=[],reads=[];
 const client={from(table){const filters=[],q={method:'get',row:null,start:0,end:Infinity,singleRow:false,columns:'*',select(columns='*'){q.columns=columns;return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(n){q.end=n-1;return q},range(a,b){q.start=a;q.end=b;return q},maybeSingle(){q.singleRow=true;return q},single(){q.singleRow=true;return q},insert(row){q.method='insert';q.row=row;return q},update(row){q.method='update';q.row=row;return q},then(resolve,reject){return Promise.resolve().then(()=>{
 if(q.method==='get')reads.push({table,columns:q.columns});
 let rows=(tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));
 if(q.method==='insert'){
  writes.push({table,row:structuredClone(q.row)});const saved={...q.row,id:'saved-'+writes.length,created_at:new Date().toISOString()};
  if(table==='mt5_candle_requests'){saved.status='queued';saved.expires_at=new Date(Date.now()+900000).toISOString();}
  if(table==='market_feed_comparisons'){saved.status='Unverified Market Data';saved.mt5_position_id='position';saved.mt5_deal_ids=['a','b'];saved.differences={open:0,high:0,low:0,close:0};saved.broker_source=q.row.broker_candle_id?'mt5_bridge':'manual_mt5_chart';saved.closed_before_recorded_entry=false;}
  tables[table].unshift(saved);rows=[saved];
 }
 if(q.method==='update'){writes.push({table,row:q.row});rows=rows.map(r=>Object.assign(r,q.row,{revision:r.revision+1}));}
 rows=rows.slice(q.start,q.end+1);return {data:q.singleRow?rows[0]||null:rows,error:null};
 }).then(resolve,reject)}};return q}};
 for(const file of ['core/chart-workspace.js','core/chart-feed-verification.js','core/deriv-public-ticks.js','core/chart-instruments.js','tios-market-verification.js','tios-charts.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 const controller=w.TIOSCharts.create({host:w.document.querySelector('#host'),getClient:()=>client,getUser:()=>user,getAccounts:()=>[account],getSelectedAccount:()=>account,getNumber:()=>1,loadPublicTicks:()=>loadPublicTicks?loadPublicTicks(w):Promise.resolve(w.TIOSDerivPublicTicks),loadInstruments:()=>loadInstruments?loadInstruments(w):Promise.resolve(w.TIOSChartInstruments)});
 const find=s=>w.document.querySelector(s),field=name=>find('[data-market-field="'+name+'"]');
 const change=(name,value)=>{field(name).value=value;field(name).dispatchEvent(new w.Event('change',{bubbles:true}))};
 const input=(name,value)=>{field(name).value=String(value);field(name).dispatchEvent(new w.Event('input',{bubbles:true}))};
 const openEvidence=async()=>{const panel=find('.market-verification');panel.open=true;panel.dispatchEvent(new w.Event('toggle'));await settle();await settle();};
 return {w,dom,controller,tables,writes,reads,find,field,change,input,trade,openEvidence,setUser:v=>{user=v}};
}
function publicTransport(e){
 const time=clock(),sockets=[];e.w.Date.now=time.now;e.w.setTimeout=time.setTimeout;e.w.clearTimeout=time.clearTimeout;
 e.w.WebSocket=class extends FakeSocket{constructor(url){super(url);sockets.push(this);}};
 const find=name=>e.find('[data-charts-public-'+name+']');
 const action=name=>e.find('[data-charts-action="'+name+'-public-quote"]').click();
 return {time,sockets,find,action,async start(){action('start');await settle();const socket=sockets.at(-1);resolve(socket);return socket;}};
}
test('TradingView sign-in remains external, private and available with mobile controls or Instruments open',async()=>{
 for(const mobile of [false,true]){
  const e=environment({mobile,loadInstruments:async()=>({create:()=>({mount(panel){panel.textContent='Recording workspace'},unmount(){},reset(){}})})});
  try{
   e.controller.show();await settle();await settle();
   const card=e.find('.charts-card'),frame=card.querySelector('.charts-frame');
   const login=card.querySelector('[data-charts-tv-signin]');
   assert.equal(login.hidden,false);assert.equal(e.find('.charts-panel').getAttribute('aria-hidden'),String(mobile));
   for(const link of e.w.document.querySelectorAll('[data-charts-tv-signin]')){
    assert.equal(link.href,'https://www.tradingview.com/accounts/signin/');assert.equal(link.target,'_blank');
    assert.ok(link.relList.contains('noopener'));assert.ok(link.relList.contains('noreferrer'));
    assert.match(e.w.document.getElementById(link.getAttribute('aria-describedby')).textContent,/does not sign in or sync the embedded T-IOS charts/);
    const activated=new e.w.MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(activated);
    assert.equal(activated.defaultPrevented,false);assert.equal(card.querySelector('.charts-frame'),frame);
   }
   if(mobile)e.find('[data-charts-action="toggle-panel"]').click();
   const symbol=e.find('[data-chart-field="symbol"]'),responsibility=e.find('[data-chart-field="responsibility"]');
   symbol.value='DERIV:VOLATILITY_75_INDEX';symbol.dispatchEvent(new e.w.Event('input',{bubbles:true}));
   responsibility.value='Private journal / owner / account';responsibility.dispatchEvent(new e.w.Event('input',{bubbles:true}));
   symbol.closest('form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));
   const fullChart=e.find('[data-charts-tv-chart]'),url=new URL(fullChart.href);
   assert.equal(url.origin,'https://www.tradingview.com');assert.equal(url.pathname,'/chart/');
   assert.deepEqual([...url.searchParams.entries()],[['symbol','DERIV:VOLATILITY_75_INDEX']]);
   assert.ok(fullChart.relList.contains('noreferrer'));
   e.find('[data-charts-action="reset-chart"]').click();assert.equal(new URL(fullChart.href).searchParams.get('symbol'),P.preferredDerivSymbol);
   const savedFrame=card.querySelector('.charts-frame');
   e.find('[data-charts-action="instruments"]').click();await settle();
   assert.equal(e.find('.charts-toolbar').hidden,true);assert.equal(login.closest('[hidden]'),null);
   login.click();assert.equal(card.querySelector('.charts-frame'),savedFrame);assert.equal(e.writes.length,0);
  }finally{e.controller.reset();e.dom.window.close()}
 }
});
test('Charts retains chart display, exposes stale mapping honestly, calculates and saves linked evidence',async()=>{
 const e=environment();try{
 e.controller.show();await settle();await settle();await e.openEvidence();
 assert.equal(e.find('.charts-frame')!==null,true);assert.equal(e.find('[data-market-connection]').textContent.includes('Stale / offline'),true);
 assert.match(e.find('[data-market-mapping]').textContent,/Verified Mapping.*historical/);
 assert.equal(e.field('mt5_open').value,'100');assert.equal(e.field('mt5_open').readOnly,true);
 for(const [name,value] of Object.entries({open:100,high:110,low:90,close:105}))e.input('tv_'+name,value);
 e.field('confirmed').checked=true;e.field('confirmed').dispatchEvent(new e.w.Event('input',{bubbles:true}));
 assert.equal(e.find('[data-market-result]').textContent,'Unverified Market Data');assert.equal(e.find('[data-market-delta="close"]').textContent,'0.00000');
 e.controller.openTrade(e.trade);await settle();await settle();
 assert.equal(e.field('trade').value,'trade');assert.match(e.find('[data-market-trade]').textContent,/position.*entry clock unverified/);
 for(const [name,value] of Object.entries({open:100,high:110,low:90,close:105}))e.input('tv_'+name,value);
 e.field('confirmed').checked=true;e.field('confirmed').dispatchEvent(new e.w.Event('input',{bubbles:true}));
 e.find('[data-market-action="save"]').click();await settle();await settle();
 const saved=e.writes.find(x=>x.table==='market_feed_comparisons');assert.ok(saved);assert.equal(saved.row.trade_id,'trade');assert.equal(saved.row.account_id,'account');assert.equal(saved.row.broker_candle_id,'prior-candle');assert.deepEqual(saved.row.tv_ohlc,{open:100,high:110,low:90,close:105});
 assert.match(e.find('[data-market-history]').textContent,/Linked position position.*2 deal/);assert.equal(e.tables.trades.length,1);
 assert.equal(e.writes.some(x=>['trades','mt5_deals','trade_setup_evidence','trade_execution_reviews'].includes(x.table)),false);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('manual fallback, market mismatch, reload to saved symbol and session disposal preserve isolation',async()=>{
 const e=environment();try{
 e.controller.show();await settle();await settle();await e.openEvidence();e.change('mode','manual_mt5_chart');await settle();
 assert.equal(e.field('mt5_open').readOnly,false);
 for(const [name,value] of Object.entries({open:102,high:112,low:92,close:107})){e.input('mt5_'+name,value);e.input('tv_'+name,value-2)}
 assert.equal(e.find('[data-market-result]').textContent,'Mismatch');assert.match(e.find('[data-market-explanation]').textContent,/cause is unknown/);
 e.change('tv_symbol','DERIV:VOLATILITY_75_INDEX');assert.equal(e.find('[data-market-result]').textContent,'Mismatch');assert.match(e.find('[data-market-explanation]').textContent,/does not match/);
 const chart=e.find('[data-chart-field="symbol"]');chart.value='DERIV:VOLATILITY_75_INDEX';chart.dispatchEvent(new e.w.Event('input',{bubbles:true}));chart.closest('form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));
 const modified=e.find('.charts-frame').src;assert.equal(JSON.parse(decodeURIComponent(new URL(modified).hash.slice(1))).chart.symbol,'DERIV:VOLATILITY_75_INDEX');
 e.find('[data-charts-action="reset-chart"]').click();assert.equal(JSON.parse(decodeURIComponent(new URL(e.find('.charts-frame').src).hash.slice(1))).chart.symbol,P.preferredDerivSymbol);
 const frame=e.find('.charts-frame');e.find('[data-charts-action="toggle-panel"]').click();assert.equal(frame.isConnected,true);e.find('[data-charts-action="toggle-panel"]').click();assert.equal(frame.isConnected,true);
 e.find('[data-charts-layout="multiple"]').click();assert.equal(e.w.document.querySelectorAll('.charts-frame').length,3);assert.equal(e.field('mt5_open').value,'102');
 e.controller.hide();assert.equal(e.find('.charts-frame'),null);e.controller.show();await settle();assert.equal(e.field('mt5_open').value,'102');
 e.controller.reset();e.setUser({id:'other'});e.controller.show();await settle();await settle();await e.openEvidence();assert.equal(e.field('tv_open').value,'');assert.equal(e.find('[data-market-history]').textContent.includes('Linked position'),false);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('day-trade modal yields to market evidence without resetting the journal draft',async()=>{
 const e=environment();try{
 e.controller.show();await settle();await settle();
 const source=fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');
 const handler=source.match(/document\.addEventListener\('click',event=>\{\n  const button=event\.target\.closest\('\[data-market-evidence-trade\]'\);[\s\S]*?\n\}\);/)[0];
 e.w.document.body.insertAdjacentHTML('beforeend','<button class="nav-btn" data-page="charts"></button><div id="tradeModal" class="modal open"><input id="journalDraft" value="unsaved reflection"><button data-market-evidence-trade="trade">Market evidence</button></div>');
 Object.assign(e.w,{trades:[e.trade],currentUser:{id:'owner'},chartWorkspace:e.controller,$:s=>e.w.document.querySelector(s)});
 e.w.eval(handler);e.find('[data-market-evidence-trade]').click();await settle();await settle();
 assert.equal(e.find('#tradeModal').classList.contains('open'),false);assert.equal(e.find('#journalDraft').value,'unsaved reflection');assert.equal(e.field('trade').value,'trade');assert.equal(e.tables.trades.length,1);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('ordinary chart viewing has no verification queries; only a pending candle is polled',async()=>{
 const e=environment(),timers=new Map();let nextTimer=0;
 e.w.setTimeout=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;};
 e.w.clearTimeout=id=>timers.delete(id);
 const tick=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();await settle();await settle();};
 try{
  e.controller.show();await settle();await settle();
  assert.deepEqual(e.reads.map(r=>r.table),['chart_workspace_preferences']);assert.equal(timers.size,0);
  const frame=e.find('.charts-frame');await e.openEvidence();
  const projection=e.reads.find(r=>r.table==='trades').columns;
  assert.equal(projection.includes('*'),false);assert.match(projection,/mt5_position_id/);assert.equal(timers.size,0);
  e.find('[data-market-action="request"]').click();await settle();await settle();
  assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,3000);
  let start=e.reads.length;await tick();
  assert.deepEqual(e.reads.slice(start).map(r=>r.table),['mt5_market_candles','mt5_candle_requests']);
  assert.equal(frame.isConnected,true);assert.equal(timers.size,1);
  e.find('[data-charts-action="toggle-panel"]').click();assert.equal(timers.size,0);
  start=e.reads.length;await settle();assert.equal(e.reads.length,start);
  e.find('[data-charts-action="toggle-panel"]').click();await settle();await settle();assert.equal(timers.size,1);
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:true});
  e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));assert.equal(timers.size,0);
  start=e.reads.length;await settle();assert.equal(e.reads.length,start);
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:false});
  e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));await settle();await settle();assert.equal(timers.size,1);
  e.tables.mt5_candle_requests[0].status='completed';await tick();assert.equal(timers.size,0);
  e.find('.market-verification').open=false;e.find('.market-verification').dispatchEvent(new e.w.Event('toggle'));
  start=e.reads.length;await settle();assert.equal(e.reads.length,start);assert.equal(timers.size,0);
  assert.equal(frame.isConnected,true);assert.equal(e.writes.some(r=>r.table==='trades'),false);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('reselecting the preferred instrument preserves running charts and manual evidence drafts',async()=>{
 const e=environment();try{
  e.controller.show();await settle();await settle();await e.openEvidence();
  e.input('tv_open',321);e.find('[data-charts-layout="multiple"]').click();await settle();await settle();
  const frames=[...e.w.document.querySelectorAll('.charts-frame')],reads=e.reads.length;
  e.find('[data-charts-action="prefer-deriv"]').click();
  assert.deepEqual([...e.w.document.querySelectorAll('.charts-frame')],frames);
  assert.equal(e.reads.length,reads);assert.equal(e.field('tv_open').value,'321');assert.equal(e.find('.market-verification').open,true);
  const setup=e.find('[data-charts-setup-id="entry"]'),symbol=setup.querySelector('[data-chart-field="symbol"]');
  symbol.value='DERIV:VOLATILITY_75_INDEX';symbol.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  setup.querySelector('form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));
  const changed=e.find('[data-chart-id="entry"] .charts-frame');assert.notEqual(changed,frames[2]);
  e.find('[data-charts-action="prefer-deriv"]').click();
  const after=[...e.w.document.querySelectorAll('.charts-frame')];assert.equal(after[0],frames[0]);assert.equal(after[1],frames[1]);assert.notEqual(after[2],changed);
  assert.equal(JSON.parse(decodeURIComponent(new URL(after[2].src).hash.slice(1))).chart.symbol,P.preferredDerivSymbol);
  assert.equal(e.field('tv_open').value,'321');assert.deepEqual(after.map(f=>JSON.parse(decodeURIComponent(new URL(f.src).hash.slice(1))).chart.interval),['240','60','5']);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('optional public quote preserves raw prices and chart frames, separates markets and never saves trade evidence',async()=>{
 const e=environment(),p=publicTransport(e);try{
  e.controller.show();await settle();await settle();
  const frame=e.find('.charts-frame'),reads=e.reads.length;
  assert.equal(p.sockets.length,0);assert.equal(p.find('quote').hidden,true);
  assert.equal(p.find('value').textContent,'—');assert.match(p.find('quote').textContent,/MT5 \/ TradingView parity unverified/);
  const socket=await p.start();tick(socket,1791633600,123.456789);
  p.time.advance(1000);tick(socket,1791633601,124.987654);
  assert.equal(p.find('value').textContent,'124.987654');assert.match(p.find('identity').textContent,/Volatility 75 \(1s\) Index \/ catalog-one-second/);
  assert.equal(p.find('price-state').textContent,'Receiving ticks');assert.match(p.find('time').textContent,/Source: .*browser arrival: .*arrival interval: 1.000 s/);
  assert.equal(e.find('.charts-frame'),frame);assert.equal(e.reads.length,reads);assert.equal(e.writes.length,0);
  assert.deepEqual(socket.sent,[{active_symbols:'brief',req_id:1},{ticks:'catalog-one-second',subscribe:1,req_id:2}]);
  e.find('[data-charts-action="toggle-panel"]').click();assert.equal(frame.isConnected,true);assert.equal(socket.closeCount,0);assert.equal(p.find('quote').hidden,false);
  e.find('[data-charts-layout="multiple"]').click();assert.equal(p.sockets.length,1);assert.equal(socket.closeCount,0);assert.equal(p.find('value').textContent,'124.987654');
  p.action('stop');assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);assert.match(p.find('price-state').textContent,/not live/);assert.equal(p.find('value').textContent,'124.987654');
  p.find('market').value='v75';p.find('market').dispatchEvent(new e.w.Event('change',{bubbles:true}));assert.equal(p.find('value').textContent,'—');
  const standard=await p.start();assert.equal(standard.sent[1].ticks,'catalog-standard');tick(standard,1791633602,987.654321,'catalog-standard');
  assert.equal(p.find('value').textContent,'987.654321');assert.match(p.find('identity').textContent,/Volatility 75 Index \/ catalog-standard/);
  const frames=[...e.w.document.querySelectorAll('.charts-frame')];p.action('hide');assert.equal(standard.closeCount,1);assert.equal(p.find('quote').hidden,true);assert.deepEqual([...e.w.document.querySelectorAll('.charts-frame')],frames);
  assert.equal(e.writes.length,0);assert.equal(e.tables.trades.length,1);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('public quote pauses without reconnecting on background, expand, page exit and Charts navigation; stale sessions are disposed',async()=>{
 const e=environment(),p=publicTransport(e);try{
  e.controller.show();await settle();await settle();let socket=await p.start();tick(socket,1791633600,123);
  p.time.advance(15000);assert.match(p.find('price-state').textContent,/not live/);assert.match(p.find('status').textContent,/15 seconds/);
  tick(socket,1791633615,124);assert.equal(p.find('price-state').textContent,'Receiving ticks');
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:true});e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);assert.match(p.find('price-state').textContent,/not live/);
  Object.defineProperty(e.w.document,'hidden',{configurable:true,value:false});e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));assert.equal(p.sockets.length,1);
  socket=await p.start();e.find('[data-charts-action="expand"]').click();assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);
  e.find('[data-charts-action="expand"]').click();assert.equal(p.sockets.length,2);
  socket=await p.start();e.w.dispatchEvent(new e.w.Event('pagehide'));assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);
  e.w.dispatchEvent(new e.w.Event('pageshow'));assert.equal(p.sockets.length,3);
  socket=await p.start();e.controller.hide();assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);assert.equal(p.find('quote'),null);
  e.controller.show();await settle();assert.equal(p.sockets.length,4);assert.match(p.find('status').textContent,/Charts is closed/);
  socket=await p.start();tick(socket,1791633620,500);e.setUser({id:'other'});tick(socket,1791633621,501);
  assert.equal(socket.closeCount,1);assert.equal(p.time.timers.size,0);assert.equal(p.find('quote').hidden,true);assert.equal(p.find('value').textContent,'—');
  e.controller.show();await settle();await settle();assert.equal(p.find('quote').hidden,true);assert.equal(p.find('value').textContent,'—');assert.equal(p.sockets.length,5);assert.equal(e.writes.length,0);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('public quote rate-limit cooldown and deferred module loading cannot reconnect automatically or outlive a closed workspace',async()=>{
 let release,loads=0;
 const e=environment({loadPublicTicks:w=>{loads++;if(loads===1)return new Promise(r=>{release=()=>r(w.TIOSDerivPublicTicks)});if(loads===2)return Promise.reject(Error('Network unavailable'));return Promise.resolve(w.TIOSDerivPublicTicks);}}),p=publicTransport(e);
 try{
  e.controller.show();await settle();await settle();p.action('start');assert.match(p.find('status').textContent,/Loading/);assert.equal(p.sockets.length,0);
  e.controller.hide();release();await settle();assert.equal(p.sockets.length,0);assert.equal(p.time.timers.size,0);
  e.controller.show();await settle();p.action('start');await settle();assert.match(p.find('status').textContent,/could not be loaded/);assert.equal(e.find('[data-charts-action="start-public-quote"]').disabled,false);
  p.action('start');await settle();const socket=p.sockets[0];socket.open();socket.receive({error:{code:'RateLimit',message:'<img src=x onerror=alert(1)> Rate limited'}});
  assert.equal(socket.closeCount,1);assert.equal(p.find('status').querySelector('img'),null);assert.match(p.find('status').textContent,/<img.*Retry available in 60 s/);
  assert.equal(e.find('[data-charts-action="start-public-quote"]').disabled,true);
  p.find('market').value='v75';p.find('market').dispatchEvent(new e.w.Event('change',{bubbles:true}));assert.equal(e.find('[data-charts-action="start-public-quote"]').disabled,true);
  p.time.advance(60000);assert.equal(p.sockets.length,1);assert.equal(p.time.timers.size,0);assert.equal(e.find('[data-charts-action="start-public-quote"]').disabled,false);
  const standard=await p.start();assert.equal(standard.sent[1].ticks,'catalog-standard');standard.receive({error:{code:'RateLimit',message:'Rate limited'}});e.w.dispatchEvent(new e.w.Event('pagehide'));assert.equal(p.time.timers.size,0);
  e.w.dispatchEvent(new e.w.Event('pageshow'));assert.equal(p.sockets.length,2);assert.equal(e.find('[data-charts-action="start-public-quote"]').disabled,true);
  e.controller.reset();assert.equal(p.time.timers.size,0);assert.equal(e.writes.length,0);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('Instruments replaces only the Charts rail, preserves running widgets and restores one original recording workspace',async()=>{
 const e=environment(),r=installRecordingWorkspace(e),p=publicTransport(e);try{
  e.controller.show();await settle();await settle();const socket=await p.start();tick(socket,1791633600,123);
  const frame=e.find('.charts-frame'),symbol=e.find('[data-chart-field="symbol"]');symbol.value='DERIV:VOLATILITY_75_INDEX';symbol.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  e.find('[data-charts-action="instruments"]').click();await settle();await settle();
  assert.equal(e.find('.charts-toolbar').hidden,true);assert.equal(e.find('[data-charts-instruments]').hidden,false);assert.equal(e.find('[data-charts-sidebar-title]').textContent,'Instruments');
  assert.equal(r.workspace.parentNode,e.find('[data-charts-instruments]'));assert.equal(e.w.document.querySelectorAll('#executionMapFormBody').length,1);
  assert.equal(e.find('.charts-frame'),frame);assert.equal(socket.closeCount,0);assert.equal(e.writes.length,0);assert.equal(r.writes.length,0);
  r.input('pb-note','Unsaved entry context');e.find('[data-charts-action="instruments"]').click();
  assert.equal(r.workspace.parentNode,e.find('#page-execution'));assert.equal(e.find('.charts-toolbar').hidden,false);assert.equal(symbol.value,'DERIV:VOLATILITY_75_INDEX');
  e.find('[data-charts-action="instruments"]').click();await settle();assert.equal(e.find('[data-execution-reflection-id="pb-note"]').value,'Unsaved entry context');
  r.select('psych');r.input('psych-note','Unsaved mindset');r.select('playbook');assert.equal(e.find('[data-execution-reflection-id="pb-note"]').value,'Unsaved entry context');
  e.find('[data-charts-action="toggle-panel"]').click();e.find('[data-charts-action="toggle-panel"]').click();assert.equal(e.find('.charts-frame'),frame);assert.equal(socket.closeCount,0);
  e.controller.openTrade(e.trade);await settle();assert.equal(e.find('.charts-toolbar').hidden,false);assert.equal(r.workspace.parentNode,e.find('#page-execution'));
  e.find('[data-charts-action="instruments"]').click();await settle();e.controller.hide();assert.equal(r.workspace.parentNode,e.find('#page-execution'));assert.equal(r.workspace.isConnected,true);
  e.controller.show();await settle();assert.equal(r.workspace.parentNode,e.find('[data-charts-instruments]'));assert.equal(e.find('[data-execution-reflection-id="pb-note"]').value,'Unsaved entry context');
 }finally{e.controller.reset();e.dom.window.close()}
});
test('Charts records Playbook, Rules and Psychology through existing saves, retains prior evidence and keeps period reviews separate',async()=>{
 const e=environment(),r=installRecordingWorkspace(e);try{
  const original=structuredClone(r.tables.trade_execution_checks[0]),review=structuredClone(r.tables.trade_execution_reviews[0]),trades=JSON.stringify(e.w.trades);
  e.controller.show();await settle();await settle();e.find('[data-charts-action="instruments"]').click();await settle();
  r.input('pb-note','Recorded entry');const condition=e.find('[data-execution-map-check]');condition.checked=true;condition.dispatchEvent(new e.w.Event('change',{bubbles:true}));
  const balance=e.find('[data-execution-map-choice][value="Balance"]'),imbalance=e.find('[data-execution-map-choice][value="Imbalance"]');
  const activate=input=>{input.dispatchEvent(new e.w.Event('pointerdown',{bubbles:true}));input.click();};
  activate(balance);assert.equal(balance.checked,true);activate(imbalance);assert.equal(imbalance.checked,true);assert.equal(balance.checked,false);
  activate(imbalance);assert.equal(imbalance.checked,false);activate(balance);assert.equal(e.find('#executionMapScore').textContent,'100.0%');
  e.find('#executionMapSaveReflectionsBtn').click();await settle();await settle();
  assert.ok(r.tables.trade_execution_checks.some(row=>row.comment==='Recorded entry'));assert.match(e.find('#executionMapReflectionSaveState').textContent,/saved for this trade/);
  r.select('checklist');const rule=e.find('[data-execution-checklist-check]');rule.checked=true;rule.dispatchEvent(new e.w.Event('change',{bubbles:true}));e.find('#executionMapSaveReflectionsBtn').click();await settle();await settle();
  const rules=r.tables.trade_execution_checks.find(row=>row.criterion_key.startsWith('text__ti_state__checklist'));assert.ok(rules);assert.equal(JSON.parse(rules.comment).controls[0].checked,true);
  r.select('playbook');assert.equal(e.find('[data-execution-map-choice][value="Balance"]').checked,true);assert.equal(e.find('[data-execution-map-choice][value="Imbalance"]').checked,false);assert.equal(e.find('#executionMapScore').textContent,'100.0%');
  r.select('psych');r.input('psych-note','Recorded reflection');r.input('score_discipline',8);assert.equal(e.find('#executionMapScore').textContent,'80.0%');
  e.find('#executionMapSaveReflectionsBtn').click();await settle();await settle();assert.ok(r.tables.trade_execution_checks.some(row=>row.comment==='Recorded reflection'));
  assert.ok(r.tables.trade_execution_checks.some(row=>row.criterion_key.includes('score_discipline')&&JSON.parse(row.comment).value===8));
  assert.deepEqual(r.tables.trade_execution_checks[0],original);assert.deepEqual(r.tables.trade_execution_reviews[0],review);assert.equal(JSON.stringify(e.w.trades),trades);
  const count=r.tables.trade_execution_checks.length;e.find('#executionMapSaveReflectionsBtn').click();await settle();await settle();assert.equal(r.tables.trade_execution_checks.length,count);assert.equal(r.tables.trade_execution_reviews.length,1);
  const trade=e.find('#executionMapTradeSelect');trade.value='trade-2';trade.dispatchEvent(new e.w.Event('change'));assert.equal(e.find('[data-execution-reflection-id="psych-note"]').value,'');
  r.input('psych-note','Second trade');e.find('#executionMapSaveReflectionsBtn').click();await settle();await settle();assert.equal(r.tables.trade_execution_reviews.length,2);
  const writes=r.writes.length;
  for(const scope of ['session','daily','weekly','monthly']){
   e.find('[data-execution-period-view="'+scope+'"]').click();assert.equal(e.find('#executionMapTradeControl').hidden,true);assert.equal(e.find('#executionMapPeriodContext').hidden,false);
   r.input('period-note',scope+' behaviour');e.find('#executionMapSaveReflectionsBtn').click();await settle();
   assert.match(e.find('#executionMapReflectionSaveState').textContent,/Saved on this device/);
  }
  const periods=e.w.TIOSPeriodRules.read(e.w.localStorage,'owner','account');assert.equal(periods.length,4);assert.equal(r.writes.length,writes);assert.equal(JSON.stringify(e.w.trades),trades);
  assert.ok(r.writes.every(write=>['trade_execution_reviews','trade_execution_checks'].includes(write.table)));assert.ok(r.writes.every(write=>write.rows.every(row=>row.user_id==='owner')));
  assert.equal(e.writes.length,0);
 }finally{e.controller.reset();e.dom.window.close()}
});
test('deferred Instruments loading is cancelled on view/session changes; retry and cleanup preserve the original form',async()=>{
 let release,loads=0;
 const e=environment({loadInstruments:w=>{loads++;if(loads===1)return new Promise(resolve=>{release=()=>resolve(w.TIOSChartInstruments)});if(loads===2)return Promise.reject(Error('Unavailable'));return Promise.resolve(w.TIOSChartInstruments);}}),r=installRecordingWorkspace(e);
 try{
  e.controller.show();await settle();await settle();const frame=e.find('.charts-frame');e.find('[data-charts-action="instruments"]').click();
  e.find('[data-charts-action="instruments"]').click();release();await settle();assert.equal(r.workspace.parentNode,e.find('#page-execution'));assert.equal(e.find('.charts-frame'),frame);
  e.find('[data-charts-action="instruments"]').click();await settle();assert.match(e.find('[data-charts-instruments]').textContent,/could not be opened/);assert.equal(r.workspace.parentNode,e.find('#page-execution'));
  e.find('[data-charts-action="retry-instruments"]').click();await settle();r.input('pb-note','Private unsaved answer');assert.equal(e.w.document.querySelectorAll('#executionMapFormBody').length,1);
  e.controller.reset();assert.equal(r.workspace.parentNode,e.find('#page-execution'));assert.equal(e.find('[data-execution-reflection-id="pb-note"]'),null);
  e.setUser({id:'other'});e.w.currentUser={id:'other'};e.w.trades=[];e.w.tradingAccount={id:'other-account'};
  e.controller.show();await settle();await settle();assert.equal(e.find('[data-charts-instruments]').hidden,true);
  e.find('[data-charts-action="instruments"]').click();await settle();assert.equal(e.find('[data-execution-reflection-id="pb-note"]').value,'');assert.equal(e.find('[data-execution-reflection-id="pb-note"]').disabled,true);
  assert.equal(e.w.document.querySelectorAll('#executionMapFormBody').length,1);assert.equal(r.writes.length,0);assert.equal(e.writes.length,0);
 }finally{e.controller.reset();e.dom.window.close()}
});
