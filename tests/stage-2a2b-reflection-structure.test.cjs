const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const slice = (source,start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

function fixture(){
  const recommended=[
    {key:'entry_timing',label:'Entry timing matched the selected valid entry moment and trigger.',sort:1},
    {key:'entry_accuracy',label:'The actual entry/order execution matched the intended trade.',sort:2},
    {key:'stop_placement',label:'The initial stop loss was placed according to the plan.',sort:3},
    {key:'risk_sizing',label:'Position size and risk stayed within the predefined limit.',sort:4},
    {key:'trade_management',label:'In-trade management followed the intended process.',sort:5},
    {key:'exit_execution',label:'The applicable exit rule was executed correctly.',sort:6}
  ];
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
  const source=read('t-ios.html');
  const data=fixture();
  const ctx=vm.createContext({
    ...data,window:{},Object,Math,tradingAccount:{id:'acct'},
    roundEvidence(value,digits=2){const n=Number(value);if(!Number.isFinite(n))return null;const f=10**digits;return Math.round(n*f)/f;},
    averageFinite(values){const nums=values.filter(Number.isFinite);return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;}
  });
  ctx.activeExecutionReviews=()=>data.executionReviews;
  vm.runInContext(
    slice(source,'const EXECUTION_REFLECTION_TEMPLATE_SCHEMA','function journalExecutionBadge')+'\n'+
    slice(source,'function shortExecutionCriterionLabel','function marketStateStats'),
    ctx
  );
  return ctx;
}

test('recommended execution checklist is a versioned reflection template', () => {
  const ctx=context();
  assert.equal(vm.runInContext('EXECUTION_RECOMMENDED_TEMPLATE.id',ctx),'tios-recommended-execution');
  assert.equal(vm.runInContext('EXECUTION_RECOMMENDED_TEMPLATE.version',ctx),1);
  assert.equal(vm.runInContext("executionReflectionStructureForReview(executionReviews[0]).source",ctx),'recommended');
  assert.equal(vm.runInContext("executionReflectionStructureForReview(executionReviews[6]).source",ctx),'user-or-legacy');
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
  assert.equal(model.reflectionStructure.current.source,'user-or-legacy');
  assert.equal(model.criteria.length,3);
});
