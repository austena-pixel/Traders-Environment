const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture(){
  const EXECUTION_CRITERIA=[
    {key:'entry_timing',sort:1},{key:'entry_accuracy',sort:2},{key:'stop_placement',sort:3},
    {key:'risk_sizing',sort:4},{key:'trade_management',sort:5},{key:'exit_execution',sort:6}
  ];
  const trades=Array.from({length:7},(_,i)=>({
    id:'t'+(i+1),
    trade_date:'2026-09-'+String(18+i).padStart(2,'0'),
    created_at:'2026-09-'+String(18+i).padStart(2,'0')+'T10:00:00Z'
  }));
  const executionReviews=Array.from({length:6},(_,i)=>({
    id:'r'+(i+1),trade_id:'t'+(i+1),created_at:'2026-09-'+String(18+i).padStart(2,'0')+'T12:00:00Z'
  }));
  const executionChecks=[];
  for(let i=0;i<6;i++){
    for(let j=0;j<EXECUTION_CRITERIA.length;j++){
      let complied=true;
      if(i<3 && j>=4) complied=false;
      if(i===3 && j===5) complied=false;
      executionChecks.push({review_id:'r'+(i+1),criterion_key:EXECUTION_CRITERIA[j].key,complied});
    }
  }
  return {EXECUTION_CRITERIA,trades,executionReviews,executionChecks};
}

function contextFor(data, activeReviews=data.executionReviews){
  const context=vm.createContext({
    ...data,window:{},tradingAccount:{id:'acct'},
    roundEvidence(value,digits=2){const n=Number(value);if(!Number.isFinite(n))return null;const f=10**digits;return Math.round(n*f)/f;},
    averageFinite(values){const nums=values.filter(Number.isFinite);return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;}
  });
  context.activeExecutionReviews=()=>activeReviews;
  context.executionScoreForTrade=tradeId=>{
    const review=data.executionReviews.find(row=>row.trade_id===tradeId);
    if(!review)return null;
    const rows=data.executionChecks.filter(row=>row.review_id===review.id);
    const passed=data.EXECUTION_CRITERIA.filter(c=>rows.find(row=>row.criterion_key===c.key)?.complied).length;
    return passed/data.EXECUTION_CRITERIA.length*100;
  };
  context.executionRatingForTrade=tradeId=>{
    const score=context.executionScoreForTrade(tradeId);
    if(score===null)return null;
    const passed=Math.round(score/100*data.EXECUTION_CRITERIA.length);
    return passed===6?'A+':passed===5?'A':'B';
  };
  const source=read('t-ios.html');
  vm.runInContext(slice(source,'function shortExecutionCriterionLabel','function marketStateStats'),context);
  return context;
}

test('Stage 2A-2 compares the latest three reviewed trades with the prior three', () => {
  const data=fixture();
  const context=contextFor(data);
  const trend=vm.runInContext('buildExecutionTrend()',context);
  assert.equal(trend.state,'improving');
  assert.equal(trend.windowSize,3);
  assert.equal(trend.previous.adherencePct,66.7);
  assert.equal(trend.recent.adherencePct,94.4);
  assert.equal(trend.delta.adherencePctPoints,27.7);
  assert.deepEqual([...trend.previous.reviewIds],['r1','r2','r3']);
  assert.deepEqual([...trend.recent.reviewIds],['r4','r5','r6']);
  assert.ok(trend.mostImprovedCriteria.length>=1);
});

test('Stage 2A-2 treats a small one-check window difference as stable', () => {
  const data=fixture();
  data.executionChecks.forEach(row=>row.complied=true);
  data.executionChecks.find(row=>row.review_id==='r3'&&row.criterion_key==='exit_execution').complied=false;
  const context=contextFor(data);
  const trend=vm.runInContext('buildExecutionTrend()',context);
  assert.equal(trend.previous.adherencePct,94.4);
  assert.equal(trend.recent.adherencePct,100);
  assert.equal(trend.delta.adherencePctPoints,5.6);
  assert.equal(trend.state,'stable');
});

test('Stage 2A-2 refuses to infer a trend before six comparable reviews', () => {
  const data=fixture();
  const context=contextFor(data,data.executionReviews.slice(0,5));
  const trend=vm.runInContext('buildExecutionTrend()',context);
  assert.equal(trend.state,'insufficient-evidence');
  assert.equal(trend.minimumComparableReviews,6);
  assert.equal(trend.recent,null);
  assert.equal(trend.previous,null);
});
