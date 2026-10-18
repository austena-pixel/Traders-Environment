// Integration-style checks for outcome chart data, tooltips and selector switching.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stats=require('../core/statistics-environments.js');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

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
let latestChart=null;
function MockChart(context,config){
  this.context=context;
  this.config=config;
  this.destroyed=false;
  this.resize=()=>{this.resized=true};
  this.update=mode=>{this.updateMode=mode};
  this.destroy=()=>{this.destroyed=true};
  latestChart=this;
}
const themeObservers=[];
class MockMutationObserver{
  constructor(callback){this.callback=callback;themeObservers.push(this)}
  observe(){}
}
function mockClassList(initial=[]){
  const values=new Set(initial);
  return{
    add(name){values.add(name)},
    remove(name){values.delete(name)},
    contains(name){return values.has(name)},
    toggle(name,force){const enabled=force===undefined?!values.has(name):Boolean(force);if(enabled)values.add(name);else values.delete(name);return enabled}
  };
}
function mockTab(outcome,active=false){
  return{dataset:{statsOutcome:outcome},classList:mockClassList(active?['active']:[]),attributes:{},tabIndex:active?0:-1,setAttribute(name,value){this.attributes[name]=value}};
}
const nodes=new Map();
for(const [selector,classes] of [
  ['#equityCanvasWrap',[]],['#equityEmptyState',['hidden']],['#statsOutcomeCanvasWrap',['hidden']],
  ['#statsOutcomeEmpty',['hidden']],['#statsOutcomeUnavailable',['hidden']],['#statsOutcomeWorkspace',[]],
  ['#statsOutcomeTitle',[]],['#equityChartDescription',[]],['#statsOutcomePeriod',[]],['#statsDateRange',[]]
])nodes.set(selector,{classList:mockClassList(classes),attributes:{},textContent:selector==='#statsDateRange'?'Oct 2 – Oct 3':'',setAttribute(name,value){this.attributes[name]=value}});
nodes.set('#statsOutcomeChart',{getContext:()=>({kind:'canvas'}),setAttribute(name,value){this[name]=value}});
const tabs=['equity','drawdown','cumulative','distribution','comparison'].map((name,index)=>mockTab(name,index===0));
const selectedTrades=[
  {trade_date:'2026-10-02',instrument:'EURUSD',direction:'Long',pnl:120},
  {trade_date:'2026-10-03',instrument:'EURUSD',direction:'Short',pnl:-40}
];
const equitySeries={equityAvailable:true,openingEquity:1000,points:[
  {label:'T0',date:'2026-10-01',equity:1000,isOpening:true},
  {label:'T1',date:'2026-10-02',equity:1120,tradePnl:120,instrument:'EURUSD',direction:'Long'},
  {label:'T2',date:'2026-10-03',equity:1080,tradePnl:-40,instrument:'EURUSD',direction:'Short'}
]};
const context=vm.createContext({
  statsAnalytics:()=>stats,
  Chart:MockChart,
  $:selector=>nodes.get(selector),
  $$:selector=>{assert.equal(selector,'[data-stats-outcome]');return tabs},
  requestAnimationFrame:callback=>callback(),
  MutationObserver:MockMutationObserver,
  document:{documentElement:{},getElementById:id=>nodes.get('#'+id)},
  getComputedStyle:()=>({backgroundColor:'#151515'}),
  setStatisticsText:(id,value)=>{const node=nodes.get('#'+id);if(node)node.textContent=String(value??'—')},
  money:value=>'$'+Number(value).toFixed(2),
  signedMoney:value=>(Number(value)>0?'+$':Number(value)<0?'-$':'$')+Math.abs(Number(value)).toFixed(2),
  formatDate:value=>String(value),
  Number,String,Array,Math,
  statsOutcomeChartInstance:null,
  equityChartInstance:null,
  statsSelectedOutcome:'equity',
  statsRange:'1m'
});
vm.runInContext('let renderedEquitySeries=null;function renderEquityChart(series){renderedEquitySeries=series;equityChartInstance={resized:false,resize(){this.resized=true}}}',context);
vm.runInContext([
  'let statisticsChartThemeObserver=null;let statisticsChartThemeRefreshFrame=0;',
  extractFunction('statisticsChartSurfaceColor'),
  extractFunction('ensureStatisticsChartThemeObserver'),
  extractFunction('destroyStatisticsOutcomeChart'),
  extractFunction('renderStatisticsOutcomeChart'),
  extractFunction('renderCombinedOutcomeDiagram')
].join('\n'),context);

let result=vm.runInContext('renderStatisticsOutcomeChart("drawdown",selectedTrades,equitySeries)',Object.assign(context,{selectedTrades,equitySeries}));
assert.ok(result.chart);
assert.deepEqual(Array.from(latestChart.config.data.datasets[0].data),[0,0,40]);
assert.equal(latestChart.config.options.scales.x.grid.color(), '#151515','grid lines match the rendered chart surface');
assert.equal(latestChart.config.options.scales.y.border.color(), '#151515','axis borders match the rendered chart surface');
themeObservers[0].callback([{attributeName:'data-hios-theme'}]);
assert.equal(latestChart.updateMode,'none','theme changes redraw the chart without animation');
const drawdownTooltip=latestChart.config.options.plugins.tooltip.callbacks.label({dataIndex:2});
assert.deepEqual(Array.from(drawdownTooltip),['Drawdown: $40.00','Peak equity: $1120.00','Peak-to-trough: 3.57%']);

result=vm.runInContext('renderStatisticsOutcomeChart("cumulative",selectedTrades,equitySeries)',context);
assert.deepEqual(Array.from(latestChart.config.data.datasets[0].data),[0,120,80]);
const cumulativeTooltip=latestChart.config.options.plugins.tooltip.callbacks.label({dataIndex:2});
assert.deepEqual(Array.from(cumulativeTooltip),['Trade P&L: -$40.00','Cumulative net P&L: +$80.00']);

result=vm.runInContext('renderStatisticsOutcomeChart("distribution",[{pnl:-10},{pnl:0},{pnl:10}],equitySeries)',context);
assert.equal(latestChart.config.type,'bar');
assert.equal(Array.from(latestChart.config.data.datasets[0].data).reduce((sum,count)=>sum+count,0),3);
assert.deepEqual(Array.from(latestChart.config.options.plugins.tooltip.callbacks.label({dataIndex:0})),['Trades: 1','P&L range: $-10.00 to $-7.50']);

result=vm.runInContext('renderStatisticsOutcomeChart("comparison",selectedTrades,equitySeries)',context);
assert.deepEqual(Array.from(latestChart.config.data.labels),['Average winning trade','Average losing trade']);
assert.deepEqual(Array.from(latestChart.config.data.datasets[0].data),[120,-40]);
const comparisonTooltip=latestChart.config.options.plugins.tooltip.callbacks.label({dataIndex:1,parsed:{y:-40}});
assert.deepEqual(Array.from(comparisonTooltip),['Average P&L: -$40.00','1 losing trade']);
const incomplete=vm.runInContext('renderStatisticsOutcomeChart("cumulative",[{pnl:120},{pnl:null}],equitySeries)',context);
assert.match(incomplete.error,/complete recorded P&L/,'incomplete outcomes do not enter a cumulative chart');
const unverified=vm.runInContext('renderStatisticsOutcomeChart("drawdown",selectedTrades,{equityAvailable:false,points:[],unavailableReason:"Opening balance missing."})',context);
assert.equal(unverified.error,'Opening balance missing.','drawdown is unavailable without verified equity');

const equityCanvas={getContext:()=>({kind:'equity-canvas'})};
const equityContext=vm.createContext({
  Chart:MockChart,
  console,
  $:selector=>selector==='#equityChart'?equityCanvas:null,
  MutationObserver:MockMutationObserver,
  document:{documentElement:{},getElementById:()=>({})},
  getComputedStyle:()=>({backgroundColor:'#151515'}),
  requestAnimationFrame:callback=>callback(),
  statsOutcomeChartInstance:null,
  statsRange:'1m',equityChartInstance:null,
  Number,Math,
  money:value=>'$'+Number(value).toFixed(2),
  signedMoney:value=>(Number(value)>0?'+$':Number(value)<0?'-$':'$')+Math.abs(Number(value)).toFixed(2),
  formatDate:value=>String(value),
  formatReturnPct:value=>Number.isFinite(value)?(value>=0?'+':'')+Number(value).toFixed(2)+'%':'—'
});
vm.runInContext([
  'let statisticsChartThemeObserver=null;let statisticsChartThemeRefreshFrame=0;',
  extractFunction('statisticsChartSurfaceColor'),
  extractFunction('ensureStatisticsChartThemeObserver'),
  extractFunction('renderEquityChart')
].join('\\n'),equityContext);
const equityRenderSeries={...equitySeries,points:[
  {...equitySeries.points[0]},
  {...equitySeries.points[1],tradeReturn:1.2},
  {...equitySeries.points[2],tradeReturn:-.4}
],selectedTrades};
vm.runInContext('renderEquityChart(equityRenderSeries)',Object.assign(equityContext,{equityRenderSeries}));
assert.deepEqual(Array.from(latestChart.config.data.labels),['T0','T1','T2']);
assert.deepEqual(Array.from(latestChart.config.data.datasets[0].data),[1000,1120,1080]);
assert.equal(latestChart.config.options.scales.x.grid.color(), '#151515','Equity Curve grid lines match the rendered chart surface');
const equityTooltip=latestChart.config.options.plugins.tooltip.callbacks.label({dataIndex:1});
assert.deepEqual(Array.from(equityTooltip),['EURUSD • Long','Trade P&L: +$120.00','Trade return: +1.20%','Equity: $1120.00']);

vm.runInContext("statsSelectedOutcome='cumulative';renderCombinedOutcomeDiagram(equitySeries,selectedTrades)",context);
assert.equal(nodes.get('#equityCanvasWrap').classList.contains('hidden'),true);
assert.equal(nodes.get('#statsOutcomeCanvasWrap').classList.contains('hidden'),false);
assert.equal(tabs.find(tab=>tab.dataset.statsOutcome==='cumulative').attributes['aria-selected'],'true');
const cumulativeChart=latestChart;

vm.runInContext("statsSelectedOutcome='equity';renderCombinedOutcomeDiagram(equitySeries,selectedTrades)",context);
assert.equal(nodes.get('#equityCanvasWrap').classList.contains('hidden'),false);
assert.equal(nodes.get('#statsOutcomeCanvasWrap').classList.contains('hidden'),true);
assert.equal(tabs.find(tab=>tab.dataset.statsOutcome==='equity').attributes['aria-selected'],'true');
assert.equal(cumulativeChart.destroyed,true,'switching diagrams disposes the previous chart');
assert.equal(vm.runInContext('renderedEquitySeries===equitySeries',context),true,'switching back rerenders the preserved Equity Curve data');

console.log('PASS all five outcome charts use recorded values and preserve Equity Curve trade tooltips');
console.log('PASS outcome selectors switch panels, update accessibility state and dispose the inactive chart');
