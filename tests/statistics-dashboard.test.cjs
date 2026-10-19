// Regression coverage for customizable Statistics indicators and honest equity calculations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stats=require('../core/statistics-environments.js');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

const defaults=[...stats.DEFAULT_STATISTICS_INDICATORS];
assert.deepEqual(defaults,[],'the optional indicator area starts empty, as shown in the Section A draft');
assert.deepEqual(stats.normalizeStatisticsIndicatorIds(undefined),defaults,'new users start with no optional indicators');
assert.deepEqual(stats.normalizeStatisticsIndicatorIds(['win-rate','net-pnl','win-rate','untrusted-id']),['win-rate','net-pnl'],'saved layouts keep valid unique IDs in user order');
assert.deepEqual(stats.normalizeStatisticsIndicatorIds([]),[],'an intentionally empty dashboard remains empty');
assert.deepEqual(stats.addStatisticsIndicatorIds(['net-pnl'],['win-rate','net-pnl','bad-id']),['net-pnl','win-rate']);
assert.deepEqual(stats.removeStatisticsIndicatorId(['net-pnl','win-rate'],'net-pnl'),['win-rate']);
assert.deepEqual(stats.removeStatisticsIndicatorId(['net-pnl'],'net-pnl'),[],'the user may remove every card');
assert.deepEqual(stats.moveStatisticsIndicatorId(['net-pnl','win-rate','profit-factor'],'profit-factor',-1),['net-pnl','profit-factor','win-rate']);
assert.deepEqual(stats.moveStatisticsIndicatorId(['net-pnl','win-rate'],'net-pnl',-1),['net-pnl','win-rate'],'moving past an edge preserves order');

const trades=[
  {id:'a',trade_date:'2026-10-02',created_at:'2026-10-02T10:00:00Z',pnl:120},
  {id:'b',trade_date:'2026-10-03',created_at:'2026-10-03T10:00:00Z',pnl:-40},
  {id:'c',trade_date:'2026-10-04',created_at:'2026-10-04T10:00:00Z',pnl:0}
];
const cumulative=stats.buildCumulativePnlSeries(trades);
assert.equal(cumulative.complete,true);
assert.deepEqual(cumulative.points.map(point=>point.cumulativePnl),[0,120,80,80]);
assert.equal(cumulative.netPnl,80);
assert.equal(stats.buildCumulativePnlSeries([{pnl:120},{pnl:null}]).complete,false,
  'cumulative P&L does not turn a missing trade result into zero');

const distribution=stats.buildTradeOutcomeDistribution([{pnl:-10},{pnl:0},{pnl:10}],3);
assert.equal(distribution.complete,true);
assert.deepEqual(distribution.bins.map(bin=>bin.count),[1,1,1]);
assert.deepEqual(stats.buildTradeOutcomeDistribution([{pnl:8},{pnl:8}]).bins,[{min:8,max:8,count:2}]);
assert.equal(stats.buildTradeOutcomeDistribution([{pnl:8},{pnl:''}]).complete,false);

const comparison=stats.summarizeProfitLoss([{pnl:100},{pnl:50},{pnl:-40},{pnl:0}]);
assert.equal(comparison.complete,true);
assert.equal(comparison.wins,2);
assert.equal(comparison.losses,1);
assert.equal(comparison.averageWin,75);
assert.equal(comparison.averageLoss,-40);
assert.equal(stats.summarizeProfitLoss([{pnl:100},{pnl:null}]).averageWin,null);

const equityStats=stats.buildDrawdownSeries([
  {label:'T0',equity:100,date:'2026-10-01'},
  {label:'T1',equity:120,date:'2026-10-02'},
  {label:'T2',equity:110,date:'2026-10-03'},
  {label:'T3',equity:130,date:'2026-10-04'},
  {label:'T4',equity:105,date:'2026-10-05'}
]);
assert.equal(equityStats.complete,true);
assert.equal(equityStats.maxDrawdown,25);
assert.equal(equityStats.points[4].peakEquity,130);
assert.equal(equityStats.points[4].drawdownPct,25/130*100);
assert.equal(stats.buildDrawdownSeries([{equity:100},{equity:null}]).complete,false);

function extractFunction(name){
  const start=html.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const open=html.indexOf('{',html.indexOf(')',start));
  let depth=0;
  for(let index=open;index<html.length;index++){
    if(html[index]==='{')depth++;
    else if(html[index]==='}'&&--depth===0)return html.slice(start,index+1);
  }
  throw new Error('Unclosed '+name);
}
const executionTabsMarkup=(html.match(/<div class="stats-execution-section-tabs"[\s\S]*?<\/div>/)||[])[0]||'';
const executionTabNames=Array.from(executionTabsMarkup.matchAll(/data-execution-quality-tab>([^<]+)<\/button>/g),match=>match[1]);
assert.deepEqual(executionTabNames,[
  'Execution Overview','Profit Gap Analysis','Execution Diagnostics','Behavioral Research'
],'Execution Quality exposes only the four requested top-level views');
const executionTabPanels=Array.from(html.matchAll(/<section class="stats-execution-section"([^>]*)>/g),match=>match[1]);
assert.equal(executionTabPanels.length,4,'the four tab buttons have four content panels');
assert.equal(executionTabPanels.filter(attributes=>!/\shidden(?:\s|$)/.test(attributes)).length,1,
  'only the default Execution Overview panel is visible initially');
assert.match(executionTabPanels[0],/id="statsExecutionOverview"[^>]*role="tabpanel"/);

const executionPanelIds=['statsExecutionOverview','statsExecutionProfitGap','statsExecutionDiagnostics','statsExecutionBehavioralResearch'];
const executionPanelMocks=new Map(executionPanelIds.map((id,index)=>[id,{id,hidden:index!==0}]));
const executionTabMocks=executionPanelIds.map((id,index)=>({
  attributes:{'aria-controls':id,'aria-selected':String(index===0)},
  tabIndex:index===0?0:-1,
  setAttribute(name,value){this.attributes[name]=value;},
  getAttribute(name){return this.attributes[name];}
}));
const executionTabContext=vm.createContext({
  document:{querySelectorAll:()=>executionTabMocks,getElementById:id=>executionPanelMocks.get(id)},
  requestAnimationFrame:callback=>callback(),
  statsExecutionTrendInstance:null
});
vm.runInContext(extractFunction('activateExecutionQualityTab'),executionTabContext);
executionTabMocks.forEach((tab,selectedIndex)=>{
  executionTabContext.activateExecutionQualityTab(tab);
  assert.deepEqual(executionTabMocks.map(item=>item.attributes['aria-selected']),
    executionTabMocks.map((_,index)=>String(index===selectedIndex)),
    'selecting a top-level tab updates its selected state');
  assert.deepEqual(executionPanelIds.map(id=>executionPanelMocks.get(id).hidden),
    executionPanelIds.map((_,index)=>index!==selectedIndex),
    'selecting a top-level tab shows only its matching panel');
});
const edgeTabsMarkup=(html.match(/<div class="stats-edge-section-tabs"[\s\S]*?<\/div>/)||[])[0]||'';
const edgeTabNames=Array.from(edgeTabsMarkup.matchAll(/data-edge-performance-tab>([^<]+)<\/button>/g),match=>match[1]);
assert.deepEqual(edgeTabNames,[
  'Edge Overview','Methodology Research','Experimental Trading','Edge Diagnostics'
],'Edge Performance exposes the four requested top-level views');
const edgePanelAttributes=Array.from(html.matchAll(/<section class="(?:stats-execution-section )?stats-edge-section"([^>]*)>/g),match=>match[1]);
assert.equal(edgePanelAttributes.length,4,'the Edge Performance tabs have four content panels');
assert.equal(edgePanelAttributes.filter(attributes=>!/\shidden(?:\s|$)/.test(attributes)).length,1,
  'Edge Overview is the only visible Edge Performance panel by default');
assert.match(edgePanelAttributes[0],/id="statsEdgeOverview"[^>]*role="tabpanel"/);
for(const id of ['statsEdgeExpectancyValue','statsEdgeProfitFactorValue','statsEdgeSampleCount','statsEdgeRiskCoverage','statsEdgeTimelineChart','statsEdgeSetupBody','statsEdgeMarketBody','statsEdgeEntryBody','statsEdgeTimeframeBody']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'preserved Edge Performance element '+id+' exists once');
}
assert.match(html,/Reference Expectancy \(R\)<\/span><strong>Not yet measured/);
assert.match(html,/Reference Profit Factor<\/span><strong>Not yet measured/);
assert.match(html,/Reference Win Rate<\/span><strong>Not yet measured/);
assert.match(html,/Evidence Reliability<\/span><strong>Not yet measured/);
assert.match(html,/statsEdgeOverview[^]*Observed Trading Evidence/);
assert.match(html,/Methodology Version Comparison/);
assert.match(html,/Foundational capabilities not yet connected/);
assert.deepEqual(Array.from(html.matchAll(/<option value="(?:reference-equity|expectancy-time|drawdown|profit-loss|edge-stability)">([^<]+)<\/option>/g),match=>match[1]),[
  'Reference Equity Curve','Expectancy Over Time','Drawdown','Profit/Loss Distribution','Edge Stability'
],'the future reference diagram selector includes all five requested views');
assert.match(html,/stats-edge-section-tabs\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,'Edge Performance tabs stay horizontal at desktop sizes');
assert.match(html,/#statsEdgeView \.stats-edge-section-tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Edge Performance tabs reflow for mobile');

const edgePanelIds=['statsEdgeOverview','statsEdgeMethodology','statsEdgeExperimental','statsEdgeDiagnostics'];
const edgePanelMocks=new Map(edgePanelIds.map((id,index)=>[id,{id,hidden:index!==0}]));
const edgeTabMocks=edgePanelIds.map((id,index)=>({
  attributes:{'aria-controls':id,'aria-selected':String(index===0)},
  tabIndex:index===0?0:-1,
  focused:false,
  setAttribute(name,value){this.attributes[name]=value;},
  getAttribute(name){return this.attributes[name];},
  focus(){this.focused=true;}
}));
const edgeTabContext=vm.createContext({
  document:{querySelectorAll:()=>edgeTabMocks,getElementById:id=>edgePanelMocks.get(id)},
  requestAnimationFrame:callback=>callback(),
  statsEdgeTimelineInstance:null
});
vm.runInContext(extractFunction('activateEdgePerformanceTab')+'\n'+extractFunction('handleEdgePerformanceTabKeydown'),edgeTabContext);
edgeTabMocks.forEach((tab,selectedIndex)=>{
  edgeTabContext.activateEdgePerformanceTab(tab);
  assert.deepEqual(edgeTabMocks.map(item=>item.attributes['aria-selected']),
    edgeTabMocks.map((_,index)=>String(index===selectedIndex)),
    'selecting an Edge Performance tab updates its accessible selected state');
  assert.deepEqual(edgePanelIds.map(id=>edgePanelMocks.get(id).hidden),
    edgePanelIds.map((_,index)=>index!==selectedIndex),
    'selecting an Edge Performance tab shows only its matching panel');
});
const edgeArrowEvent={key:'ArrowRight',preventDefault(){this.prevented=true;}};
edgeTabContext.handleEdgePerformanceTabKeydown(edgeTabMocks[0],edgeArrowEvent);
assert.equal(edgeArrowEvent.prevented,true,'arrow navigation prevents unwanted page scrolling');
assert.equal(edgeTabMocks[1].focused,true,'arrow navigation moves focus to the next Edge Performance tab');
assert.equal(edgeTabMocks[1].attributes['aria-selected'],'true','arrow navigation selects the focused tab');
const edgeHomeEvent={key:'Home',preventDefault(){}};
edgeTabContext.handleEdgePerformanceTabKeydown(edgeTabMocks[3],edgeHomeEvent);
assert.equal(edgeTabMocks[0].focused,true,'Home returns focus to the first Edge Performance tab');
assert.equal(edgePanelMocks.get('statsEdgeOverview').hidden,false,'keyboard navigation returns to the matching panel');
const renderedIndicatorStack={innerHTML:''};
const renderContext=vm.createContext({
  $:selector=>selector==='#statsIndicatorStack'?renderedIndicatorStack:selector==='#statsIndicatorEmpty'?{classList:{toggle(){}}}:null,
  statsIndicatorDraft:['net-pnl','win-rate'],
  statsArrangeMode:false,
  lastStatisticsIndicatorSnapshot:{'net-pnl':{value:'+$80.00',detail:'Test measurement.'},'win-rate':{value:'60%',detail:'Test measurement.'}},
  STATISTICS_INDICATOR_CATALOG:[
    {id:'net-pnl',title:'Net P&L',group:'Combined Outcomes'},
    {id:'win-rate',title:'Win Rate',group:'Combined Outcomes'}
  ],
  escapeHtml:value=>String(value)
});
vm.runInContext(extractFunction('renderStatisticsIndicatorCards'),renderContext);
renderContext.renderStatisticsIndicatorCards();
assert.equal((renderedIndicatorStack.innerHTML.match(/data-indicator-action="remove"/g)||[]).length,2,
  'each optional indicator has its own remove control outside Arrange mode');
assert.match(renderedIndicatorStack.innerHTML,/aria-label="Remove Net P&L"/);
assert.doesNotMatch(renderedIndicatorStack.innerHTML,/data-indicator-action="up"/,
  'move controls remain exclusive to Arrange mode');
renderContext.statsArrangeMode=true;
renderContext.renderStatisticsIndicatorCards();
assert.equal((renderedIndicatorStack.innerHTML.match(/data-indicator-action="remove"/g)||[]).length,2,
  'per-indicator remove controls remain available while arranging');
assert.match(renderedIndicatorStack.innerHTML,/data-indicator-action="up"/);
function equityContext(records,startingBalance){
  const context=vm.createContext({
    trades:records,
    tradingAccount:{starting_balance:startingBalance},
    statsAnalytics:()=>stats,
    localDateString:value=>value,
    tradesInDateRange:(start,end)=>records.filter(trade=>trade.trade_date>=start&&trade.trade_date<=end),
    tradeReturnPct:()=>null
  });
  vm.runInContext(extractFunction('pnlBeforeDate')+'\n'+extractFunction('buildDailyEquitySeries'),context);
  return context;
}
let context=equityContext([
  {trade_date:'2026-10-02',pnl:50},
  {trade_date:'2026-10-03',pnl:-20},
  {trade_date:'2026-10-10',pnl:null}
],1000);
let series=context.buildDailyEquitySeries('2026-10-03','2026-10-03');
assert.equal(series.equityAvailable,true);
assert.equal(series.openingEquity,1050);
assert.deepEqual(Array.from(series.points,point=>point.equity),[1050,1030]);
assert.equal(series.equityAvailable,true,'future incomplete records do not invalidate an earlier reporting period');

context=equityContext([{trade_date:'2026-10-03',pnl:20}],0);
series=context.buildDailyEquitySeries('2026-10-03','2026-10-03');
assert.equal(series.equityAvailable,false,'the default zero starting balance is not used as account equity');
assert.equal(series.points.length,0);

context=equityContext([
  {trade_date:'2026-10-02',pnl:null},
  {trade_date:'2026-10-03',pnl:20}
],1000);
series=context.buildDailyEquitySeries('2026-10-03','2026-10-03');
assert.equal(series.equityAvailable,false,'an incomplete prior history makes selected-period equity unavailable');
assert.match(series.unavailableReason,/complete P&L history/);

async function runPreferencePersistenceChecks(){
const preferenceElements=new Map([
  ['#statsSaveIndicators',{disabled:false}],
  ['#statsIndicatorSaveStatus',{textContent:''}],
  ['#statsArrangeIndicators',{attributes:{},setAttribute(name,value){this.attributes[name]=value;},textContent:'Done'}]
]);
const preferenceContext=vm.createContext({
  db:{auth:{
    async getUser(){return{data:{user:{id:'user-1',user_metadata:{existingPreference:'keep'}}},error:null};},
    async updateUser(payload){this.savedMetadata=payload.data;return{data:{user:{id:'user-1',user_metadata:payload.data}},error:null};}
  }},
  currentUser:{id:'user-1'},
  $:selector=>preferenceElements.get(selector),
  setStatisticsText:(id,value)=>{const node=preferenceElements.get('#'+id);if(node)node.textContent=String(value);},
  normalizedStatisticsIndicatorIds:value=>stats.normalizeStatisticsIndicatorIds(value),
  renderStatisticsIndicatorCards(){},
  console,
  JSON
});
vm.runInContext("const STATS_INDICATOR_PREFERENCE_KEY='tios_statistics_indicators_v1';let statsIndicatorIds=['net-pnl'];let statsIndicatorDraft=['win-rate','profit-factor'];let statsIndicatorLayoutDirty=true;let statsArrangeMode=false;",preferenceContext);
vm.runInContext(extractFunction('loadStatisticsIndicatorLayout')+'\n'+extractFunction('saveStatisticsIndicatorLayout').replace('function saveStatisticsIndicatorLayout','async function saveStatisticsIndicatorLayout'),preferenceContext);
assert.equal(await vm.runInContext('saveStatisticsIndicatorLayout()',preferenceContext),true);
assert.deepEqual(Array.from(preferenceContext.db.auth.savedMetadata.tios_statistics_indicators_v1),['win-rate','profit-factor']);
assert.equal(preferenceContext.db.auth.savedMetadata.existingPreference,'keep','saving the layout preserves unrelated user metadata');
assert.equal(vm.runInContext('statsIndicatorLayoutDirty',preferenceContext),false);
assert.equal(preferenceElements.get('#statsIndicatorSaveStatus').textContent,'Layout saved to your account.');
preferenceContext.loadStatisticsIndicatorLayout({id:'user-2',user_metadata:{tios_statistics_indicators_v1:['max-drawdown']}});
assert.deepEqual(Array.from(vm.runInContext('statsIndicatorDraft',preferenceContext)),['max-drawdown'],'the next authenticated account loads its own indicator arrangement');
preferenceContext.loadStatisticsIndicatorLayout({id:'user-1',user_metadata:preferenceContext.db.auth.savedMetadata});
assert.deepEqual(Array.from(vm.runInContext('statsIndicatorDraft',preferenceContext)),['win-rate','profit-factor'],'a restored session reloads the saved arrangement');
}
runPreferencePersistenceChecks().catch(error=>{console.error(error);process.exitCode=1;});

for(const section of ['Optional Indicators','Combined Outcomes'])assert.ok(html.includes(section),'missing '+section+' section');
for(const id of ['statsAddIndicator','statsArrangeIndicators','statsSaveIndicators','statsResetIndicators','statsIndicatorDialog','statsIndicatorStack'])assert.ok(html.includes('id="'+id+'"'),'missing indicator control '+id);
for(const outcome of ['equity','drawdown','cumulative','distribution','comparison'])assert.ok(html.includes('data-stats-outcome="'+outcome+'"'),'missing outcome selector '+outcome);
assert.ok(html.includes('tios_statistics_indicators_v1'),'per-user layout metadata uses a versioned preference key');
assert.ok(html.includes('db.auth.getUser()'),'layout writes verify the active authenticated user');
assert.ok(html.includes('db.auth.updateUser({data:metadata})'),'layout is saved to the authenticated user metadata');
assert.ok(html.includes('renderStatisticsOutcomeChart(statsSelectedOutcome,source,series)'));
assert.ok(html.includes('buildCumulativePnlSeries(source)'));
assert.ok(html.includes('buildTradeOutcomeDistribution(source,8)'));
assert.ok(html.includes('summarizeProfitLoss(source)'));

console.log('PASS indicator add/remove/reorder normalization, persistence guard, and strict outcome calculators');
console.log('PASS selected-period equity requires a verified opening balance and complete recorded history');

const adherenceTrades=[{id:'complete'},{id:'partial'},{id:'unassessed'}];
const adherenceEvidence={
  complete:{checklist:{values:[1,0]},playbook:{values:[1]}},
  partial:{checklist:{values:[0.5,'invalid',2]},playbook:{values:[]}},
  unassessed:{checklist:{values:[]},playbook:{values:[]}}
};
const adherence=stats.summarizeExecutionAdherence(adherenceTrades,trade=>adherenceEvidence[trade.id]);
assert.equal(adherence.selectedTradeCount,3);
assert.equal(adherence.fullyAssessedTradeCount,1,'complete coverage requires both Rules and Playbook evidence on the same trade');
assert.equal(adherence.partiallyAssessedTradeCount,1,'one-sided evidence is reported as partial, not failed');
assert.equal(adherence.unassessedTradeCount,1,'unassessed trades stay outside the adherence score');
assert.equal(adherence.itemCount,4,'invalid and out-of-range values are excluded');
assert.equal(adherence.adherencePct,62.5,'recorded Rules and Playbook evidence is pooled by measured item');
assert.equal(adherence.categories.rules.assessedTradeCount,2);
assert.equal(adherence.categories.playbook.assessedTradeCount,1);

for(const id of ['statsExecutionOverview','statsExecutionProfitGap','statsExecutionDiagnostics','statsExecutionBehavioralResearch'])
  assert.ok(html.includes('id="'+id+'"'),'missing Execution Quality section '+id);
for(const tab of ['reference-actual','gap-over-time','gap-by-deviation','consistency','behavior'])
  assert.ok(html.includes('data-execution-diagram="'+tab+'"'),'missing Profit Gap workspace tab '+tab);
assert.ok(html.includes('statsExecutionTimelineBody'),'missing trade-linked assessment timeline');
assert.ok(html.includes('statsExecutionReflectionList'),'missing trade-linked reflection records');
assert.ok(html.includes('No Shadow Trading or matched reference-results table'),'missing honest reference-data state');

console.log('PASS all five combined outcome selectors are connected to period-filtered calculations');
console.log('PASS execution adherence pools only recorded Rules/Playbook evidence and reports full, partial, and missing coverage');
console.log('PASS Execution Quality uses four accessible top-level tabs with one visible panel at a time');
console.log('PASS Profit Gap diagram tabs and evidence-backed empty states are present');
console.log('PASS Edge Performance uses four accessible tabs, honest reference placeholders, and preserved observed-trade evidence');
