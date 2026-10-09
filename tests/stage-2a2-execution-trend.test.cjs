const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {executionContext, recommendedCriteria} = require('./helpers/execution-intelligence-context.cjs');

function fixture(){
  const EXECUTION_CRITERIA=recommendedCriteria();
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
      const criterion=EXECUTION_CRITERIA[j];
      executionChecks.push({review_id:'r'+(i+1),criterion_key:criterion.key,criterion_label:criterion.label,sort_order:criterion.sort,complied});
    }
  }
  return {EXECUTION_CRITERIA,trades,executionReviews,executionChecks};
}

const contextFor=executionContext;

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
