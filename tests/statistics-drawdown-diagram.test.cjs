// Regression coverage for the combined-outcome Drawdown diagram.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const stats=require('../core/statistics-environments.js');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

const points=[100,120,110,130,105,125].map((equity,index)=>({
  label:'T'+index,
  date:index?'2026-10-0'+(index+1):'2026-10-01',
  equity
}));
const drawdown=stats.buildDrawdownSeries(points);
assert.equal(drawdown.complete,true);
assert.deepEqual(drawdown.points.map(point=>point.drawdown),[0,0,10,0,25,5]);
assert.equal(drawdown.maxDrawdown,25,'maximum deterioration is measured from the $130 peak to the $105 trough');
assert.equal(drawdown.points[4].peakEquity,130);
assert.equal(drawdown.points[4].drawdownPct,25/130*100,'equity drawdown percentage uses the actual account equity peak');
assert.equal(stats.buildDrawdownSeries([{equity:100},{equity:null}]).complete,false,'missing equity is not plotted as a verified zero');
assert.equal(stats.buildDrawdownSeries([]).complete,false,'drawdown is unavailable without account-equity observations');

assert.ok(html.includes('id="statsOutcomeTabDrawdown"'),'Drawdown is available in the combined-outcome selector');
assert.match(html,/if\(kind==='drawdown'\)\{[\s\S]*?buildDrawdownSeries\(series\.points\)/,'Drawdown plots the verified account equity sequence');
assert.match(html,/Peak-to-trough drawdown/,'the chart names the measured series');
assert.match(html,/Peak equity: \$\{money\(point\.peakEquity\)\}/,'tooltip reports the actual equity peak');
assert.match(html,/Peak-to-trough: \$\{point\.drawdownPct\.toFixed\(2\)\}%/,'tooltip reports the account-equity drawdown percentage');
assert.match(html,/if\(statsSelectedOutcome==='drawdown'&&!series\.equityAvailable\)/,'the diagram is withheld when account equity is unverified');
assert.match(html,/const equityAvailable=actualOpeningBalance&&historyComplete&&priorPnl!==null&&selectedComplete/,'drawdown input requires a verified nonzero opening balance and complete P&L history');
assert.match(html,/id="statsOutcomeTabEquity"[^>]*aria-selected="true"/,'Equity Curve is the default diagram');
assert.match(html,/let statsSelectedOutcome\s*=\s*'equity'/,'the first view is initialized to Equity Curve');

console.log('PASS Drawdown peak, trough, amount and percentage match verified equity values');
console.log('PASS Drawdown tooltips expose actual peak equity and incomplete equity data stays unavailable');
