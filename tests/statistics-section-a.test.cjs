// Regression coverage for the Section A financial-outcome layout and summary metrics.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stats=require('../core/statistics-environments.js');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

function extractFunction(name){
  const start=html.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const signatureEnd=html.indexOf('){',start);
  assert.ok(signatureEnd>=0,'Missing body for '+name);
  let depth=0;
  for(let index=signatureEnd+1;index<html.length;index++){
    if(html[index]==='{')depth++;
    else if(html[index]==='}'&&--depth===0)return html.slice(start,index+1);
  }
  throw new Error('Unclosed '+name);
}

const sectionStart=html.indexOf('<section class="panel stats-section-a"');
const layoutStart=html.indexOf('<div class="stats-section-a-workspace">',sectionStart);
const chartStart=html.indexOf('<section class="stats-combined-outcomes"',layoutStart);
const optionalStart=html.indexOf('<aside class="stats-dashboard-section"',layoutStart);
assert.ok(sectionStart>=0&&layoutStart>sectionStart,'Section A groups the metrics, chart and optional indicator space.');
assert.ok(chartStart>layoutStart&&optionalStart>chartStart,'The main outcomes chart sits beside the optional indicator area.');
assert.ok(html.indexOf('</aside>',optionalStart)<html.indexOf('<dialog',optionalStart),'The optional indicator area remains inside Section A, before the indicator picker dialog.');
assert.ok(!html.includes('class="stats-lower"'),'the retired lower Statistics panels are removed');
assert.ok(!html.includes('Performance Details')&&!html.includes('Performance by Instrument'),'the circled legacy panels are no longer rendered');
assert.ok(!html.includes('id="instrumentStatsBody"')&&!html.includes('function renderInstrumentStats'),'legacy instrument breakdown rendering is removed');
for(const id of [
  'statEquityHeaderEnding','statEquityHeaderNetPnl','statWinRateGauge','statWinRateGaugeValue',
  'statWinRateReturnLabel','statProfitFactorDiagramValue','statsPrimaryAvgPnlValue',
  'statsPrimaryAvgProfit','statsPrimaryAvgLoss','statsOutcomeTabEquity','statsIndicatorStack'
])assert.ok(html.includes('id="'+id+'"'),'Missing Section A measurement '+id);
assert.match(html,/const groups=\['Edge Performance','Execution Quality'\]/,'optional indicators come from the specialist environments');
assert.match(html,/Latest balance reported by the selected account/,'current balance prefers the selected account value');

function node(){return{textContent:'',className:'',style:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}}
const ids=[
  'statProfitFactorDiagramValue','statProfitFactorExplanation','statProfitFactorBar',
  'statProfitFactorProfitFill','statProfitFactorLossFill','statProfitFactorGrossProfit',
  'statProfitFactorGrossLoss','statWinRateGauge','statWinRateGaugeProgress',
  'statWinRateGaugeValue','statWinRateGaugeCount','statWinRateReturnLabel',
  'statsPrimaryAvgPnlValue','statsPrimaryAvgPnlCount','statsPrimaryAvgProfit','statsPrimaryAvgLoss'
];
const nodes=new Map(ids.map(id=>[id,node()]));
const context=vm.createContext({
  $:selector=>nodes.get(selector.replace(/^#/,'') )||null,
  setStatisticsText(id,value,className){const item=nodes.get(id);if(item){item.textContent=String(value);if(className)item.className=className;}},
  statsAnalytics:()=>stats,
  formatProfitFactorCurrency:value=>'$'+Number(value).toFixed(2),
  formatReturnPct:value=>(value>=0?'+':'')+Number(value).toFixed(2)+'%',
  pnlClass:value=>value>0?'pos':value<0?'neg':'neutral',
  signedMoney:value=>(value>0?'+':value<0?'-':'')+'$'+Math.abs(Number(value)).toFixed(2),
  Number,Math,String
});
vm.runInContext(extractFunction('renderProfitFactorIndicator')+'\n'+extractFunction('renderStatisticsIndicators'),context);

const winnersAndLosers=[{pnl:80},{pnl:-20},{pnl:40}];
const complete=stats.summarizePnl(winnersAndLosers);
const factor={state:'finite',value:6,grossProfit:120,grossLoss:20,recordedTradeCount:3,missingPnlCount:0};
context.renderStatisticsIndicators(2.5,200/3,winnersAndLosers,factor,complete);
assert.equal(nodes.get('statWinRateGaugeValue').textContent,'66.7%');
assert.equal(nodes.get('statWinRateReturnLabel').textContent,'+2.50% return');
assert.equal(nodes.get('statProfitFactorDiagramValue').textContent,'6.00×');
assert.equal(nodes.get('statsPrimaryAvgPnlValue').textContent,'+$33.33');
assert.equal(nodes.get('statsPrimaryAvgProfit').textContent,'+$60.00');
assert.equal(nodes.get('statsPrimaryAvgLoss').textContent,'-$20.00');

const incompleteTrades=[{pnl:80},{pnl:null}];
context.renderStatisticsIndicators(null,null,incompleteTrades,{state:'incomplete',value:null,grossProfit:80,grossLoss:0,recordedTradeCount:1,missingPnlCount:1},stats.summarizePnl(incompleteTrades));
assert.equal(nodes.get('statWinRateGaugeValue').textContent,'—','missing P&L keeps the win rate unavailable');
assert.equal(nodes.get('statWinRateReturnLabel').textContent,'— return','unverified opening equity keeps return unavailable');
assert.equal(nodes.get('statsPrimaryAvgPnlValue').textContent,'—','missing P&L keeps average trade P&L unavailable');
assert.equal(nodes.get('statsPrimaryAvgProfit').textContent,'—','incomplete samples do not imply average profit');
assert.equal(nodes.get('statsPrimaryAvgLoss').textContent,'—','incomplete samples do not imply average loss');

const balanceContext=vm.createContext({
  tradingAccount:{current_balance:250,starting_balance:100},
  trades:[{pnl:5}],
  statsAnalytics:()=>stats,
  Number,String
});
vm.runInContext(extractFunction('verifiedCurrentAccountBalance'),balanceContext);
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,250,'current account data takes precedence over a calculated historical balance');
balanceContext.tradingAccount={starting_balance:100};
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,105,'a complete journal history can calculate a verified balance');
balanceContext.trades=[{pnl:5},{pnl:null}];
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,null,'incomplete P&L does not create a guessed current balance');

console.log('PASS Section A keeps the primary outcome chart beside a blank, optional-indicator panel');
console.log('PASS the legacy Performance Details and Performance by Instrument panels are removed');
console.log('PASS current balance, net P&L, win rate, period return, profit factor, and average P&L render from complete data');
console.log('PASS missing recorded P&L stays unavailable instead of becoming a zero');
