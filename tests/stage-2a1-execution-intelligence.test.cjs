const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function executionFixture(){
  const EXECUTION_CRITERIA=[
    {key:'entry_timing',sort:1},{key:'entry_accuracy',sort:2},{key:'stop_placement',sort:3},
    {key:'risk_sizing',sort:4},{key:'trade_management',sort:5},{key:'exit_execution',sort:6}
  ];
  const trades=[{id:'t1'},{id:'t2'},{id:'t3'},{id:'t4'}];
  const executionReviews=[
    {id:'r1',trade_id:'t1'},{id:'r2',trade_id:'t2'},{id:'r3',trade_id:'t3'}
  ];
  const executionChecks=[];
  for(const review of executionReviews){
    for(const criterion of EXECUTION_CRITERIA){
      let complied=true;
      if(review.id==='r2'&&criterion.key==='trade_management')complied=false;
      if(review.id==='r3'&&['trade_management','risk_sizing'].includes(criterion.key))complied=false;
      executionChecks.push({review_id:review.id,criterion_key:criterion.key,complied});
    }
  }
  return {EXECUTION_CRITERIA,trades,executionReviews,executionChecks};
}

test('Stage 2A-1 builds one evidence-linked execution intelligence model', () => {
  const source=read('t-ios.html');
  const block=slice(source,'function shortExecutionCriterionLabel','function marketStateStats');
  const fixture=executionFixture();
  const context=vm.createContext({
    ...fixture,
    window:{},
    tradingAccount:{id:'acct-test'},
    roundEvidence(value,digits=2){const n=Number(value);if(!Number.isFinite(n))return null;const f=10**digits;return Math.round(n*f)/f;},
    averageFinite(values){const nums=values.filter(Number.isFinite);return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;}
  });
  vm.runInContext(`
    activeExecutionReviews=()=>executionReviews.filter(r=>trades.some(t=>t.id===r.trade_id));
    executionScoreForTrade=tradeId=>{
      const review=executionReviews.find(r=>r.trade_id===tradeId);
      if(!review)return null;
      const rows=executionChecks.filter(c=>c.review_id===review.id);
      const passed=EXECUTION_CRITERIA.filter(c=>rows.find(r=>r.criterion_key===c.key)?.complied).length;
      return passed/EXECUTION_CRITERIA.length*100;
    };
    executionRatingForTrade=tradeId=>{
      const score=executionScoreForTrade(tradeId);
      if(score===null)return null;
      const passed=Math.round(score/100*6);
      return passed===6?'A+':passed===5?'A':'B';
    };
  `,context);
  vm.runInContext(block,context);

  const model=vm.runInContext('buildExecutionIntelligenceModel()',context);
  assert.equal(model.schema,'tios.execution-intelligence.v1');
  assert.equal(model.sample.reviewedTrades,3);
  assert.equal(model.sample.totalTrades,4);
  assert.equal(model.sample.totalChecks,18);
  assert.equal(model.sample.compliedChecks,15);
  assert.equal(model.sample.missedChecks,3);
  assert.equal(model.sample.tradesWithErrors,2);
  assert.equal(model.sample.aPlusExecutions,1);
  assert.equal(model.execution.adherencePct,83.3);
  assert.equal(model.execution.averageScorePct,83.3);
  assert.equal(model.currentWeakestCriteria[0].key,'trade_management');
  assert.equal(model.currentWeakestCriteria[0].misses,2);
  assert.deepEqual([...model.evidence.reviewIds],['r1','r2','r3']);
  assert.deepEqual([...model.evidence.tradeIds],['t1','t2','t3']);

  const behaviour=vm.runInContext('intelligenceBehaviourPattern()',context);
  assert.equal(behaviour.top.key,'trade_management');
  assert.equal(behaviour.top.count,2);
});

test('Stage 2A-1 execution evidence responses consume the canonical model', () => {
  const source=read('t-ios.html');
  const metricBlock=slice(source,'function tiosRequestedEvidenceMetric','function sameGoalEvidenceSnapshot');
  const context=vm.createContext({
    EXECUTION_CRITERIA:[{key:'entry_timing'}],
    roundEvidence(value){return Number(value);},
    buildExecutionIntelligenceModel(){return {
      schema:'tios.execution-intelligence.v1',
      sample:{totalChecks:48,compliedChecks:42,missedChecks:6,reviewedTrades:8,tradesWithErrors:4},
      execution:{adherencePct:87.5}
    };}
  });
  vm.runInContext(metricBlock,context);
  const adherence=vm.runInContext("tiosRequestedEvidenceMetric('execution_adherence')",context);
  const errors=vm.runInContext("tiosRequestedEvidenceMetric('execution_errors')",context);
  assert.equal(adherence.value,87.5);
  assert.equal(adherence.sampleSize,8);
  assert.equal(adherence.details.modelSchema,'tios.execution-intelligence.v1');
  assert.equal(errors.value,6);
  assert.equal(errors.sampleSize,8);
  assert.equal(errors.details.tradesWithErrors,4);
  assert.equal(errors.details.modelSchema,'tios.execution-intelligence.v1');
});
