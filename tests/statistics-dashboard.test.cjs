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
console.log('PASS all five combined outcome selectors are connected to period-filtered calculations');
