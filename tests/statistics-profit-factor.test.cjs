// Profit Factor aggregation and Statistics card regression coverage.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

function block(name,nextName){
  const start=html.indexOf('function '+name+'(');
  const end=html.indexOf('\nfunction '+nextName+'(',start);
  assert.ok(start>=0&&end>start,'Missing '+name+' in t-ios.html');
  return html.slice(start,end);
}

const modelContext={Intl,Number,String,Array,Math,tradingAccount:{currency:'USD'}};
vm.runInNewContext(block('calculateProfitFactorStats','formatProfitFactorCurrency')+
  '\nthis.calculateProfitFactorStats=calculateProfitFactorStats;',modelContext);
const calculate=modelContext.calculateProfitFactorStats;

let stats=calculate([{pnl:652},{pnl:-100}]);
assert.equal(stats.grossProfit,652);
assert.equal(stats.grossLoss,100);
assert.equal(stats.value,6.52);
assert.equal(stats.state,'finite');

stats=calculate([{pnl:50},{pnl:-100}]);
assert.equal(stats.value,.5);
stats=calculate([{pnl:40},{pnl:10}]);
assert.equal(stats.value,Infinity);
assert.equal(stats.state,'infinite');
stats=calculate([{pnl:-25}]);
assert.equal(stats.value,0);
stats=calculate([{pnl:0},{pnl:0}]);
assert.equal(stats.value,null);
assert.equal(stats.state,'no-outcomes');
stats=calculate([]);
assert.equal(stats.value,null);
assert.equal(stats.state,'no-trades');
stats=calculate([{pnl:200},{pnl:null},{pnl:-25}]);
assert.equal(stats.value,null,'unknown P&L must not be treated as zero');
assert.equal(stats.grossProfit,200);
assert.equal(stats.grossLoss,25);
assert.equal(stats.missingPnlCount,1);
assert.equal(stats.state,'incomplete');
stats=calculate([{pnl:''},{pnl:undefined},{pnl:'not-a-number'}]);
assert.equal(stats.recordedTradeCount,0);
assert.equal(stats.missingPnlCount,3);

for(const id of ['statProfitFactorDiagramValue','statProfitFactorExplanation','statProfitFactorBar','statProfitFactorProfitFill','statProfitFactorLossFill','statProfitFactorGrossProfit','statProfitFactorGrossLoss']){
  assert.ok(html.includes('id="'+id+'"'),'Missing diagram element '+id);
}
assert.match(html,/\.eq\('account_id',\s*tradingAccount\.id\)/,'closed trades remain scoped to the selected account');
assert.match(html,/\.eq\('position_status',\s*'closed'\)/,'source remains closed trades only');
assert.ok(html.includes("calculateProfitFactorStats(source)"),'diagram uses the selected-period trades');
assert.ok(html.includes("id=\"statWinRateReturnLabel\""),'Win Rate header Return remains');
assert.ok(html.includes('id="equityChart"'),'Equity Curve remains');
assert.ok(html.includes('class="stats-future-analysis"'),'future instrument placeholder remains');
assert.ok(!html.includes('statReturnGauge'),'separate Return diagram was removed');

console.log('PASS Profit Factor: finite, below-one, infinite, zero, break-even, no-trade and incomplete P&L cases');
console.log('PASS scope and preservation: selected account, closed trades, selected period, Win Rate Return, Equity Curve and future instruments');
