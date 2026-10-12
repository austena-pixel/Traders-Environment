const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../t-ios.html'),'utf8');
const nodes=new Map();
const scores=new Map();
const context=vm.createContext({
  Intl,Number,
  executionScoreForTrade:id=>scores.get(id),
  signedMoney:value=>(value<0?'-$':'+$')+Math.abs(value).toFixed(2),
  document:{getElementById:id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',setAttribute(k,v){this[k]=v;}});
    return nodes.get(id);
  }}
});
vm.runInContext(html.slice(html.indexOf('function executionProfitabilityStats('),html.indexOf('function renderDrawdownExpectancyDiagram(')),context);
const stats=rows=>context.executionProfitabilityStats(rows,id=>scores.get(id));
const rows=[0,49,49.9,50,79,79.9,80,100,null,undefined,NaN,-1,101,'80'].map((score,id)=>{
 scores.set(id,score); return {id,pnl:id<3?-6:id<6?3:12};
});
let result=stats(rows);
assert.deepEqual(Array.from(result.groups,g=>g.count),[3,3,2]);
assert.deepEqual(Array.from(result.groups,g=>g.average),[-6,3,12]);
assert.equal(result.excluded,6);
assert.match(context.executionProfitabilityInsight(result),/Insufficient evidence/);
for(const pnl of [null,undefined,'', ' ', NaN,Infinity,'bad',true]){
 assert.equal(stats([{id:0,pnl}]).eligible,0);
}
assert.equal(stats([{id:0,pnl:'0'}]).groups[0].average,0,'valid zero score and P&L are included');
assert.equal(stats([{id:7,pnl:'12.50'},{id:7,pnl:'-2.50'}]).groups[2].average,5);
assert.match(context.executionProfitabilityInsight(stats([])),/No eligible trades/);
const sample=Array.from({length:15},(_,id)=>({id:id<5?0:id<10?3:7,pnl:id<5?-10:id<10?0:20}));
result=stats(sample);
assert.match(context.executionProfitabilityInsight(result),/associated with better/);
assert.match(context.executionProfitabilityInsight(result),/not causation or statistical proof/);
assert.match(context.executionProfitabilityInsight(stats(sample.map(t=>({...t,pnl:-t.pnl})))),/associated with lower/);
assert.match(context.executionProfitabilityInsight(stats(sample.map(t=>({...t,pnl:0})))),/No consistent association/);
context.renderExecutionProfitability(sample);
const chart=nodes.get('statExecutionProfitChart');
assert.match(chart.innerHTML,/#25d07d/);
assert.match(chart.innerHTML,/#ff5d68/);
assert.match(chart.innerHTML,/stroke-width="1.5"/);
assert.match(chart['aria-label'],/5 trades/);
scores.set(7,20); // A Journal score change moves the same trades to a different group.
context.renderExecutionProfitability(sample);
assert.match(chart['aria-label'],/0–49%: 10 trades/);
context.renderExecutionProfitability([]);
assert.doesNotMatch(chart.innerHTML,/<rect /,'empty groups must not look like zero-profit observations');
assert.match(nodes.get('statExecutionProfitInsight').textContent,/No eligible trades/);
assert.ok(html.includes('const source=series.selectedTrades;'));
assert.ok(html.includes('renderExecutionProfitability(source);'));
assert.match(html,/async function updateTradeExecutionCompositeScore[\s\S]*?renderStatistics\(\);/);
// All three neighboring cards keep their original IDs.
for(const id of ['statProfitFactorDiagramTitle','statWinRateGaugeTitle','statExpectancyTitle'])assert.ok(html.includes('id="'+id+'"'));
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
 if(!/src=|application\/|importmap/.test(match[1]))new vm.Script(match[2]);
}
console.log('PASS execution groups, eligibility, averages, sparse evidence, sign colors, baseline, Journal updates and filtered-source wiring');
