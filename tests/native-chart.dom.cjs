/* Real native tools, persistence and Charts lifecycle; deterministic transport,
   public feed and rendering API fixtures. No visual browser QA is claimed. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),P=require('../core/chart-workspace.js'),A=require('../core/chart-analysis.js'),F=require('../core/deriv-chart-feed.js');
const clone=v=>JSON.parse(JSON.stringify(v)),settle=()=>new Promise(r=>setImmediate(r));
const prices=Array.from({length:40},(_,n)=>({time:1791650000+n*300,open:100+n,high:102+n,low:99+n,close:101+n}));
function environment({rows={},userId='owner',preferences=P.defaults(),hook=()=>null}={}){
 const dom=new JSDOM('<div id="chartsWorkspace"></div>',{url:'https://tios.test/t-ios.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.matchMedia=()=>({matches:false});Object.defineProperty(w.crypto,'randomUUID',{value:require('node:crypto').randomUUID});
 let user={id:userId};const tables={chart_workspace_profiles:[{user_id:userId}],chart_workspace_preferences:[{user_id:userId,configuration:clone(preferences),revision:1,schema_version:1}],chart_workspace_analysis:Object.values(clone(rows))};
 const writes=[],charts=[],subscriptions=[];let disposedFeeds=0;
 const client={auth:{getUser:async()=>({data:{user},error:null})},from(table){let method='read',body,filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle(){return q;},insert(v){method='insert';body=clone(v);return q;},update(v){method='update';body=clone(v);return q;},then(resolve,reject){return Promise.resolve().then(async()=>{
  const result=await hook({method,table,body,filters});if(result)return result;
  let resultRows=(tables[table]||[]).filter(r=>r.user_id===user.id&&filters.every(([k,v])=>r[k]===v));
  if(method==='insert'){if(body.user_id!==user.id)return {data:null,error:{code:'42501'}};if((tables[table]||[]).some(r=>r.user_id===user.id))return {data:null,error:{code:'23505'}};const row={...body,revision:1};tables[table].push(row);resultRows=[row];writes.push({table,body});}
  if(method==='update'){resultRows=resultRows.map(r=>Object.assign(r,body,{revision:r.revision+1}));if(resultRows.length)writes.push({table,body});}
  return {data:resultRows[0]?clone(resultRows[0]):null,error:null};
 }).then(resolve,reject);}};return q;}};
 w.TIOSChartPreferences=P;w.TIOSMarketVerification={create:()=>({setControlsVisible(){},mount(){},hide(){},reset(){},openTrade(){}})};
 const chartLibrary={CandlestickSeries:'candles',LineSeries:'line',createChart(surface,options){
   const state={surface,options,series:[],click:null,crosshair:null,range:null,removed:false,primitive:null};charts.push(state);
   const time={timeToCoordinate:t=>(t-1791650000)/300,setVisibleRange:r=>{state.range=clone(r);},fitContent:()=>{},subscribeVisibleTimeRangeChange:f=>{state.rangeChanged=f;}};
   const api={timeScale:()=>time,addSeries(type,opts){const series={type,opts,data:[],setData(v){this.data=clone(v);},coordinateToPrice:y=>100+y/100,priceToCoordinate:p=>(p-100)*100,attachPrimitive(p){state.primitive=p;p.attached({chart:api,series:this,requestUpdate(){}});}};state.series.push(series);return series;},removeSeries(s){state.series=state.series.filter(v=>v!==s);},subscribeClick:f=>{state.click=f;},subscribeCrosshairMove:f=>{state.crosshair=f;},applyOptions:opts=>{state.applied=opts;},remove(){state.removed=true;state.primitive?.detached();}};
   return api;
 }};
 w.LightweightCharts=chartLibrary;
 w.TIOSDerivChartFeed={...F,create:()=>({subscribe(market,interval,listener,requiredFrom){const item={market,interval,listener,requiredFrom,stopped:false};subscriptions.push(item);listener({bars:clone(prices),status:'live',message:'Fixture public candles'});return ()=>{item.stopped=true;};},loadEarlier(){},dispose(){disposedFeeds++;}})};
 for(const file of ['core/chart-analysis.js','core/native-chart.js','tios-charts.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 const host=w.document.querySelector('#chartsWorkspace');const controller=w.TIOSCharts.create({host,getClient:()=>client,getUser:()=>user,getAccounts:()=>[],getSelectedAccount:()=>null,getNumber:()=>1,loadNative:async()=>w.TIOSNativeChart});
 const $=s=>host.querySelector(s),click=s=>$(s).click();
 async function wait(predicate){for(let i=0;i<100;i++){if(predicate())return;await settle();}assert.ok(predicate(),'Native UI did not settle: '+host.textContent);}
 return {w,host,$,click,controller,tables,writes,charts,subscriptions,wait,
  async open(){controller.show();await wait(()=> $('[data-analysis-engine="native"]')&&!$('[data-analysis-engine="native"]').disabled);},
  async native(){click('[data-analysis-engine="native"]');await wait(()=>!!$('[data-native-tool]'));},
  async saved(){await wait(()=>tables.chart_workspace_analysis[0]&&$('[data-analysis-status]').textContent==='Analysis saved to your Charts account');},
  activeChart:()=>charts.filter(c=>!c.removed).at(-1),setUser:id=>{user={id};tables.chart_workspace_profiles.push({user_id:id});tables.chart_workspace_preferences.push({user_id:id,configuration:P.defaults(),revision:1,schema_version:1});},
  close(){controller.reset();w.close();},get disposedFeeds(){return disposedFeeds;}};
}
test('native mode is opt-in; existing TradingView frames and account entry are preserved',async()=>{
 const e=environment();try{await e.open();assert.equal(e.host.querySelectorAll('.charts-frame').length,1);assert.equal(e.charts.length,0);assert.equal(e.writes.length,0);await e.native();assert.equal(e.host.querySelectorAll('.charts-frame').length,0);assert.equal(e.subscriptions[0].market,'v75_1s');e.click('[data-analysis-engine="tradingview"]');await e.wait(()=>!!e.$('.charts-frame'));assert.equal(e.activeChart(),undefined);}finally{e.close();}
});
test('native tools save price-anchored levels, trends, zones and notes; refresh restores each item and indicator',async()=>{
 const e=environment();try{
  await e.open();await e.native();const chart=e.activeChart();
  e.click('[data-native-tool="level"]');chart.click({time:prices[0].time,point:{x:1,y:200}});
  for(const tool of ['trend','rectangle']){e.click('[data-native-tool="'+tool+'"]');chart.click({time:prices[1].time,point:{x:2,y:100}});chart.crosshair({time:prices[2].time,point:{x:3,y:300}});chart.click({time:prices[2].time,point:{x:3,y:300}});}
  e.click('[data-native-tool="text"]');e.$('[data-native-note]').value='Context: wait for entry';chart.click({time:prices[3].time,point:{x:4,y:300}});
  e.$('[data-native-period]').value='7';e.click('[data-native-add-indicator]');await e.saved();
  const state=e.tables.chart_workspace_analysis[0].content.panes.single_single.contexts.v75_1s;
  assert.deepEqual(state.drawings.map(d=>d.type),['level','trend','rectangle','text']);assert.equal(state.drawings[0].points[0].price,102);assert.equal(state.indicators[0].period,7);
  const draws=[];const ctx=new Proxy({}, {get:(_,k)=> (...args)=>{draws.push([k,args]);},set:()=>true});chart.primitive.updateAllViews();chart.primitive.paneViews()[0].renderer().draw({useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width:500,height:300}})});assert.ok(draws.some(([k])=>k==='strokeRect'));assert.ok(draws.some(([k,args])=>k==='fillText'&&args[0]==='Context: wait for entry'));
  const fresh=environment({rows:{owner:e.tables.chart_workspace_analysis[0]}});try{await fresh.open();await fresh.wait(()=>!!fresh.$('[data-native-items]'));assert.equal(fresh.$('[data-native-items]').children.length,5);assert.equal(fresh.activeChart().series.filter(s=>s.type==='line').length,1);}finally{fresh.close();}
 }finally{e.close();}
});
test('Remove persists deletion and refresh never inserts a default indicator',async()=>{
 const e=environment();try{await e.open();await e.native();e.click('[data-native-add-indicator]');e.click('[data-native-tool="level"]');e.activeChart().click({time:prices[0].time,point:{x:1,y:200}});await e.saved();e.click('[data-native-remove="drawing"]');e.click('[data-native-remove="indicator"]');await e.saved();
  const fresh=environment({rows:{owner:e.tables.chart_workspace_analysis[0]}});try{await fresh.open();await fresh.wait(()=>!!fresh.$('[data-native-items]'));assert.equal(fresh.activeChart().series.filter(s=>s.type==='line').length,0);assert.match(fresh.$('[data-native-summary]').textContent,/0 drawings · 0 indicators/);}finally{fresh.close();}
 }finally{e.close();}
});
test('instrument and timeframe changes retain analysis, save their selection and stop obsolete subscriptions',async()=>{
 const e=environment();try{await e.open();await e.native();e.click('[data-native-tool="level"]');e.activeChart().click({time:prices[0].time,point:{x:1,y:200}});await e.saved();
  e.$('[data-native-market]').value='v75';e.$('[data-native-market]').dispatchEvent(new e.w.Event('change',{bubbles:true}));assert.match(e.$('[data-native-summary]').textContent,/0 drawings/);
  e.$('[data-native-interval]').value='15';e.$('[data-native-interval]').dispatchEvent(new e.w.Event('change',{bubbles:true}));await e.saved();assert.equal(e.tables.chart_workspace_analysis[0].content.panes.single_single.interval,'15');
  e.$('[data-native-market]').value='v75_1s';e.$('[data-native-market]').dispatchEvent(new e.w.Event('change',{bubbles:true}));assert.match(e.$('[data-native-summary]').textContent,/1 drawing/);assert.ok(e.subscriptions.slice(0,-1).every(s=>s.stopped));
 }finally{e.close();}
});
test('Charts navigation, layout changes and Reload analysis do not erase native analysis',async()=>{
 const e=environment();try{await e.open();await e.native();e.click('[data-native-tool="level"]');e.activeChart().click({time:prices[0].time,point:{x:1,y:200}});await e.saved();e.click('[data-charts-action="reset-chart"]');await e.wait(()=>e.charts.length===2);assert.match(e.$('[data-native-summary]').textContent,/1 drawing/);
  e.controller.hide();assert.equal(e.activeChart(),undefined);assert.ok(e.disposedFeeds>0);await e.open();await e.wait(()=>!!e.$('[data-native-summary]'));assert.match(e.$('[data-native-summary]').textContent,/1 drawing/);
  e.click('[data-charts-layout="multiple"]');await e.wait(()=>e.host.querySelectorAll('.charts-frame').length===3);e.click('[data-charts-layout="single"]');await e.wait(()=>!!e.$('[data-native-summary]'));assert.match(e.$('[data-native-summary]').textContent,/1 drawing/);
 }finally{e.close();}
});
test('switching T-IOS accounts immediately disposes private analysis and checks the new account state',async()=>{
 const e=environment();try{await e.open();await e.native();e.click('[data-native-tool="text"]');e.$('[data-native-note]').value='Private account analysis';e.activeChart().click({time:prices[0].time,point:{x:1,y:200}});await e.saved();e.setUser('other');e.controller.reset();await e.open();assert.equal(e.activeChart(),undefined);assert.equal(e.host.textContent.includes('Private account analysis'),false);assert.equal(e.host.querySelectorAll('.charts-frame').length,1);}finally{e.close();}
});
test('native view range restores without startup overwriting it, and explicit pan persists the new range',async()=>{
 let doc=A.apply(A.empty(),{type:'settings',pane:'single_single',value:{engine:'native',interval:'5'}});doc=A.apply(doc,{type:'view',pane:'single_single',market:'v75_1s',interval:'5',value:{from:prices[2].time,to:prices[25].time}});
 const e=environment({rows:{owner:{user_id:'owner',content:doc,revision:1}}});try{await e.open();await e.wait(()=>!!e.$('[data-native-surface]'));assert.deepEqual(e.activeChart().range,{from:prices[2].time,to:prices[25].time});assert.equal(e.writes.length,0);
  e.$('[data-native-surface]').dispatchEvent(new e.w.Event('wheel',{bubbles:true}));e.activeChart().rangeChanged({from:prices[4].time,to:prices[20].time});await e.saved();assert.deepEqual(e.tables.chart_workspace_analysis[0].content.panes.single_single.contexts.v75_1s.views['5'],{from:prices[4].time,to:prices[20].time});
 }finally{e.close();}
});
test('feed errors do not clear saved items or create fictional candle data',async()=>{
 const e=environment();try{await e.open();await e.native();e.click('[data-native-tool="level"]');e.activeChart().click({time:prices[0].time,point:{x:1,y:200}});await e.saved();e.subscriptions.at(-1).listener({bars:[],status:'error',message:'Rate limited'});assert.match(e.$('[data-native-summary]').textContent,/1 drawing/);assert.equal(e.$('[data-native-retry]').hidden,false);assert.equal(e.activeChart().series[0].data.length,40);}finally{e.close();}
});
test('the pinned production chart runtime exports the public API used by native charts',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});try{dom.window.eval(fs.readFileSync(path.join(__dirname,'..','vendor/lightweight-charts/lightweight-charts-5.2.0.js'),'utf8'));assert.equal(dom.window.LightweightCharts.version(),'5.2.0');assert.equal(typeof dom.window.LightweightCharts.createChart,'function');assert.ok(dom.window.LightweightCharts.CandlestickSeries);assert.ok(dom.window.LightweightCharts.LineSeries);}finally{dom.window.close();}
});
