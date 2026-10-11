// Regression coverage for the Statistics maximum-loss / profit-peak illustration.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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

const context=vm.createContext({});
vm.runInContext(
  extractFunction('maxDrawdownFromProfitPeak')+'\\n'+
  extractFunction('buildDrawdownProfileDiagram'),
  context
);

const points=[100,120,110,130,105,125].map(equity=>({equity}));
const drawdown=context.maxDrawdownFromProfitPeak(points,100);
assert.equal(drawdown.amount,25,'maximum loss is measured from the $130 profit peak to the $105 trough');
assert.equal(drawdown.pct,25/30*100);
assert.equal(drawdown.profitPeak,30);
assert.equal(drawdown.peakIndex,3);
assert.equal(drawdown.troughIndex,4);

const profile=context.buildDrawdownProfileDiagram({points,openingEquity:100},drawdown);
assert.ok(profile.equityPath.startsWith('M7.0 '),'gold equity path begins at opening equity');
assert.ok(profile.peakGuidePath.startsWith('M130.6 '),'green reference starts at the actual profit peak');
assert.ok(profile.maxLossPath.startsWith('M130.6 '),'red segment starts at the peak');
assert.ok(profile.lossDropPath,'red connector marks the peak-to-trough loss');
assert.ok(profile.peakPoint&&profile.troughPoint,'profit peak and maximum-loss trough are marked');
assert.match(html,/class="stats-drawdown-legend"[^>]*aria-hidden="true"/);
assert.match(html,/<span><i class="peak"><\\/i>Profit peak<\\/span>/);
assert.match(html,/<span><i class="equity"><\\/i>Equity path<\\/span>/);
assert.match(html,/<span><i class="loss"><\\/i>Max loss<\\/span>/);

const losingPoints=[100,95,90].map(equity=>({equity}));
const noPositivePeak=context.maxDrawdownFromProfitPeak(losingPoints,100);
assert.equal(noPositivePeak.amount,10);
assert.equal(noPositivePeak.pct,null,'percentage is unavailable without a positive profit peak');
assert.equal(noPositivePeak.peakIndex,0);
assert.equal(noPositivePeak.troughIndex,2);
assert.ok(context.buildDrawdownProfileDiagram({points:losingPoints,openingEquity:100},noPositivePeak).maxLossPath);

const winningPoints=[100,110,120].map(equity=>({equity}));
const noLoss=context.maxDrawdownFromProfitPeak(winningPoints,100);
const noLossProfile=context.buildDrawdownProfileDiagram({points:winningPoints,openingEquity:100},noLoss);
assert.equal(noLoss.amount,0);
assert.ok(noLossProfile.equityPath);
assert.equal(noLossProfile.maxLossPath,'','no red loss segment is drawn when there is no drawdown');

const missingPnl=context.buildDrawdownProfileDiagram({
  openingEquity:100,
  points:[{equity:100},{equity:null}]
},drawdown);
assert.equal(missingPnl.equityPath,'','missing equity is not plotted as a verified zero');

console.log('PASS maximum drawdown endpoints, percentage, and illustration paths match known equity data');
console.log('PASS no-positive-peak, no-loss, and missing-equity states are handled');
