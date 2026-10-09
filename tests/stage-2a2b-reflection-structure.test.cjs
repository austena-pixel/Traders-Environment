const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {executionContext, recommendedCriteria} = require('./helpers/execution-intelligence-context.cjs');

function fixture(){
  const recommended=recommendedCriteria();
  const custom=[
    {key:'wait_confirmation',label:'Waited for confirmation.',sort:1},
    {key:'planned_location',label:'Entered at the planned location.',sort:2},
    {key:'risk_limit',label:'Stayed within my risk limit.',sort:3}
  ];
  const trades=Array.from({length:7},(_,i)=>({
    id:'t'+(i+1),trade_date:'2026-09-'+String(18+i).padStart(2,'0'),
    created_at:'2026-09-'+String(18+i).padStart(2,'0')+'T10:00:00Z'
  }));
  const executionReviews=Array.from({length:7},(_,i)=>({
    id:'r'+(i+1),trade_id:'t'+(i+1),
    created_at:'2026-09-'+String(18+i).padStart(2,'0')+'T12:00:00Z'
  }));
  const executionChecks=[];
  for(let i=0;i<6;i++){
    for(const c of recommended){
      executionChecks.push({review_id:'r'+(i+1),criterion_key:c.key,criterion_label:c.label,sort_order:c.sort,complied:true});
    }
  }
  executionChecks.find(row=>row.review_id==='r2'&&row.criterion_key==='exit_execution').complied=false;
  for(const c of custom){
    executionChecks.push({review_id:'r7',criterion_key:c.key,criterion_label:c.label,sort_order:c.sort,complied:true});
  }
  return {trades,executionReviews,executionChecks};
}

function context(){
  return executionContext(fixture());
}

test('recommended execution checklist is a versioned reflection template', () => {
  const ctx=context();
  assert.equal(vm.runInContext('EXECUTION_RECOMMENDED_TEMPLATE.id',ctx),'tios-recommended-execution');
  assert.equal(vm.runInContext('EXECUTION_RECOMMENDED_TEMPLATE.version',ctx),1);
  assert.equal(vm.runInContext("executionReflectionStructureForReview(executionReviews[0]).source",ctx),'recommended-legacy');
  assert.equal(vm.runInContext("executionReflectionStructureForReview(executionReviews[6]).source",ctx),'historical');
});

test('a custom review is scored from its own saved criteria', () => {
  const ctx=context();
  assert.equal(vm.runInContext("executionScoreForTrade('t7')",ctx),100);
  assert.equal(vm.runInContext("executionRatingForTrade('t7')",ctx),'A+');
});

test('trend intelligence does not mix different reflection structures', () => {
  const ctx=context();
  const trend=vm.runInContext('buildExecutionTrend()',ctx);
  assert.equal(trend.state,'insufficient-evidence');
  assert.equal(trend.reason,'reflection-structure-changed');
  assert.equal(trend.comparableReviewedTrades,1);
  assert.equal(trend.excludedIncompatibleReviews,6);
});

test('canonical execution intelligence follows the latest comparable reflection structure', () => {
  const ctx=context();
  const model=vm.runInContext('buildExecutionIntelligenceModel()',ctx);
  assert.equal(model.sample.totalReviewedTrades,7);
  assert.equal(model.sample.reviewedTrades,1);
  assert.equal(model.reflectionStructure.current.source,'historical');
  assert.equal(model.criteria.length,3);
});

test('saved reflection identity and version are scoped to the user and trading account', () => {
  const ctx=context();
  vm.runInContext(`saveExecutionStructureStore({activeId:'custom-v3',structures:[{
    id:'custom-v3',name:'My execution reflection',version:3,
    items:executionReflectionStructureForReview(executionReviews[6]).items
  }]})`,ctx);
  const saved=vm.runInContext('buildExecutionIntelligenceModel().reflectionStructure.current',ctx);
  assert.equal(saved.source,'user');
  assert.equal(saved.templateId,'custom-v3');
  assert.equal(saved.name,'My execution reflection');
  assert.equal(saved.version,3);
  vm.runInContext("tradingAccount={id:'another-account'}",ctx);
  assert.equal(vm.runInContext('latestExecutionReflectionStructure().source',ctx),'historical');
  vm.runInContext("tradingAccount={id:'acct-test'};currentUser={id:'another-user'}",ctx);
  assert.equal(vm.runInContext('latestExecutionReflectionStructure().source',ctx),'historical');
});

test('renaming a saved criterion starts a separate comparable evidence sample', () => {
  const data=fixture();
  data.executionChecks=data.executionChecks.filter(row=>row.review_id!=='r7');
  for(const criterion of recommendedCriteria()){
    data.executionChecks.push({review_id:'r7',criterion_key:criterion.key,
      criterion_label:criterion.key==='entry_timing'?'Waited for a different trigger.':criterion.label,
      sort_order:criterion.sort,complied:true});
  }
  const ctx=executionContext(data);
  const trend=vm.runInContext('buildExecutionTrend()',ctx);
  assert.equal(trend.state,'insufficient-evidence');
  assert.equal(trend.comparableReviewedTrades,1);
  assert.equal(trend.excludedIncompatibleReviews,6);
});

function mixedReflectionData(textOnly=false){
  const data=fixture();
  data.executionReviews=data.executionReviews.slice(0,6);
  data.executionChecks=data.executionReviews.flatMap(review=>[
    ...(textOnly?[]:[{review_id:review.id,criterion_key:'check__risk',criterion_label:'Stayed within risk limit.',sort_order:1,complied:review.id!=='r1'}]),
    {review_id:review.id,criterion_key:'text__notes',criterion_label:'What did I learn?',sort_order:2,complied:false,comment:'A qualitative reflection.'}
  ]);
  return data;
}

test('qualitative responses do not add errors or inflate quantitative execution scoring', () => {
  const ctx=executionContext(mixedReflectionData());
  const model=vm.runInContext('buildExecutionIntelligenceModel()',ctx);
  assert.equal(model.sample.totalChecks,6);
  assert.equal(model.sample.missedChecks,1);
  assert.equal(model.sample.tradesWithErrors,1);
  assert.equal(model.execution.adherencePct,83.3);
  assert.equal(model.criteria.length,1);
  assert.equal(vm.runInContext("executionScoreForTrade('t2')",ctx),100);
});

test('text-only reflections cannot establish a quantitative execution trend', () => {
  const ctx=executionContext(mixedReflectionData(true));
  const model=vm.runInContext('buildExecutionIntelligenceModel()',ctx);
  assert.equal(model.sample.reviewedTrades,6);
  assert.equal(model.sample.totalChecks,0);
  assert.equal(model.sample.aPlusExecutions,0);
  assert.equal(model.execution.adherencePct,null);
  assert.equal(model.execution.averageScorePct,null);
  assert.equal(vm.runInContext("executionRatingForTrade('t2')",ctx),null);
  assert.equal(model.trend.state,'insufficient-evidence');
  assert.equal(model.trend.reason,'no-quantitative-execution-checks');
  assert.equal(model.trend.delta.adherencePctPoints,null);
  assert.equal(model.trend.delta.averageScorePctPoints,null);
  assert.equal(model.trend.mostImprovedCriteria.length,0);
  assert.equal(model.trend.mostWorsenedCriteria.length,0);
});
