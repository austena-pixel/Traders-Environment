'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const P=require('../core/chart-workspace.js'),F=require('../core/chart-feed-verification.js');
const settle=()=>new Promise(r=>setImmediate(r));
function environment(){
 const dom=new JSDOM('<div id="host"></div>',{url:'https://tios.test/t-ios.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(w.crypto,'randomUUID',{value:require('node:crypto').randomUUID});
 let user={id:'owner'};const account={id:'account',user_id:'owner',account_name:'Deriv Demo',platform:'MT5',bridge_enabled:true,connection_status:'connected',last_sync_at:'2026-09-25T00:00:00Z'};
 const prefs=P.defaults();for(const mode of ['single','multiple'])for(const c of prefs.charts[mode])c.symbol=P.preferredDerivSymbol;
 const opening=F.lastClosedOpening('H1'),bar={open:100,high:110,low:90,close:105};
 const trade={id:'trade',user_id:'owner',account_id:'account',source:'mt5',instrument:'Volatility 75 (1s) Index.0',opened_at:new Date(Date.parse(opening)+1800000).toISOString(),mt5_position_id:'position',is_deleted:false};
 const tables={chart_workspace_preferences:[{user_id:'owner',configuration:prefs,revision:1,schema_version:1}],trades:[trade],mt5_market_symbols:[],mt5_market_candles:[{id:'candle',account_id:'account',user_id:'owner',instrument_key:'v75_1s',mt5_symbol:trade.instrument,timeframe:'H1',candle_open_at:opening,ohlc:bar,clock_confirmed:true,completed:true,retrieved_at:new Date().toISOString(),terminal_retrieved_at:new Date().toISOString(),broker_utc_offset_seconds:0}],mt5_candle_requests:[],market_feed_comparisons:[]};
 tables.mt5_market_candles.push({...tables.mt5_market_candles[0],id:'prior-candle',candle_open_at:F.lastClosedOpening('H1',Date.parse(trade.opened_at))});
 const writes=[];
 const client={from(table){const filters=[],q={method:'get',row:null,start:0,end:Infinity,singleRow:false,select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(n){q.end=n-1;return q},range(a,b){q.start=a;q.end=b;return q},maybeSingle(){q.singleRow=true;return q},single(){q.singleRow=true;return q},insert(row){q.method='insert';q.row=row;return q},update(row){q.method='update';q.row=row;return q},then(resolve,reject){return Promise.resolve().then(()=>{
 let rows=(tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));
 if(q.method==='insert'){
  writes.push({table,row:structuredClone(q.row)});const saved={...q.row,id:'saved-'+writes.length,created_at:new Date().toISOString()};
  if(table==='market_feed_comparisons'){saved.status='Unverified Market Data';saved.mt5_position_id='position';saved.mt5_deal_ids=['a','b'];saved.differences={open:0,high:0,low:0,close:0};saved.broker_source=q.row.broker_candle_id?'mt5_bridge':'manual_mt5_chart';saved.closed_before_recorded_entry=false;}
  tables[table].unshift(saved);rows=[saved];
 }
 if(q.method==='update'){writes.push({table,row:q.row});rows=rows.map(r=>Object.assign(r,q.row,{revision:r.revision+1}));}
 rows=rows.slice(q.start,q.end+1);return {data:q.singleRow?rows[0]||null:rows,error:null};
 }).then(resolve,reject)}};return q}};
 for(const file of ['core/chart-workspace.js','core/chart-feed-verification.js','tios-market-verification.js','tios-charts.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 const controller=w.TIOSCharts.create({host:w.document.querySelector('#host'),getClient:()=>client,getUser:()=>user,getAccounts:()=>[account],getSelectedAccount:()=>account,getNumber:()=>1});
 const find=s=>w.document.querySelector(s),field=name=>find('[data-market-field="'+name+'"]');
 const change=(name,value)=>{field(name).value=value;field(name).dispatchEvent(new w.Event('change',{bubbles:true}))};
 const input=(name,value)=>{field(name).value=String(value);field(name).dispatchEvent(new w.Event('input',{bubbles:true}))};
 return {w,dom,controller,tables,writes,find,field,change,input,trade,setUser:v=>{user=v}};
}
test('Charts retains chart display, exposes stale mapping honestly, calculates and saves linked evidence',async()=>{
 const e=environment();try{
 e.controller.show();await settle();await settle();
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
 e.controller.show();await settle();await settle();e.change('mode','manual_mt5_chart');await settle();
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
 e.controller.reset();e.setUser({id:'other'});e.controller.show();await settle();await settle();assert.equal(e.field('tv_open').value,'');assert.equal(e.find('[data-market-history]').textContent.includes('Linked position'),false);
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
