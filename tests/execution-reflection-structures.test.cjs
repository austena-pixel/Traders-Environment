const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');

test('Execution page no longer contains the permanent six-item static checklist', () => {
  assert.ok(source.includes('id="executionMapFormBody"'));
  assert.ok(source.includes('id="executionStructureModal"'));
  assert.ok(!source.includes('data-execution-key="entry_timing"'));
  assert.ok(!source.includes('id="executionWentWell"'));
});

test('Execution supports multiple saved structures and mixed item types', () => {
  assert.ok(source.includes("EXECUTION_STRUCTURE_STORAGE_PREFIX='tios_execution_structures_v1'"));
  assert.ok(source.includes("addExecutionBuilderItem('check')"));
  assert.ok(source.includes("addExecutionBuilderItem('text')"));
  assert.ok(source.includes('executionStructureSelect'));
  assert.ok(source.includes('executionUseRecommendedBtn'));
});

test('Qualitative reflection rows are excluded from execution scoring', () => {
  assert.ok(source.includes("executionItemTypeFromKey(row.criterion_key)==='check'"));
  assert.ok(source.includes("if(!checks.length)return null;"));
  assert.ok(source.includes("scorePct===null?null"));
});

test('Historical review metadata remains available to canonical execution intelligence', () => {
  assert.ok(source.includes('executionReflectionStructureForReview(review)'));
  assert.ok(source.includes('Historical execution reflection'));
  assert.ok(source.includes('Historical reviews will not be deleted.'));
});

test('Journal groups Setup / Edge, Rules, and Psychology on each trade row', () => {
  const table = source.slice(source.indexOf('<table class="trade-table">'), source.indexOf('</table>', source.indexOf('<table class="trade-table">')));
  const headers = [...table.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1].replace(/&amp;/g, '&'));
  assert.deepEqual(headers, ['Trade','Instrument','Direction','Setup / Edge','Rules','Psychology','P&L','Execution','Actions']);
  assert.ok(source.includes('journalRulesCellHtml(t,number)'));
  assert.ok(source.includes('journalPsychologyCellHtml(t,number)'));
  assert.ok(source.includes('data-journal-rules='));
  assert.ok(source.includes('journalReflectionEntries(trade.id,\'checklist\')'));
  assert.ok(source.includes('colspan="9"'));
});

test('Rules viewer reads the selected trade’s saved checklist reflection rows', () => {
  assert.ok(source.includes("function journalReflectionEntries(tradeId,kind='psych')"));
  assert.ok(source.includes("row.trade_id===tradeId&&review.user_id===owner"));
  assert.ok(source.includes("openJournalReflection(button.dataset.journalRules,button,'checklist')"));
  assert.ok(source.includes("saved.kind!==kind"));
});

test('Per-trade Execution score averages Psychology, Playbook / Edge, and Rules equally', () => {
  const start = source.indexOf('function executionMappedValuesForKind(');
  const end = source.indexOf('async function updateTradeExecutionCompositeScore(', start);
  assert.ok(start >= 0 && end > start, 'combined score helpers should be present');
  const checks = [];
  const stateRow = (kind, documentId, definition, controls) => ({
    criterion_key: 'text__ti_state__' + kind + '__' + encodeURIComponent(documentId),
    comment: JSON.stringify({
      schema: 'tios.execution-form.v1',
      kind,
      documentId,
      definition: JSON.stringify(definition),
      controls
    })
  });
  checks.push(stateRow('playbook', 'edge-a',
    [{type:'checkbox'}, {type:'checkbox'}],
    [{checked:true}, {checked:false}]));
  checks.push(stateRow('checklist', 'rules-a',
    [{type:'checkbox'}, {type:'radio',name:'choice'}, {type:'radio',name:'choice'}],
    [{checked:true}, {checked:false}, {checked:true}]));
  checks.push(stateRow('psych', 'psych-a',
    [{type:'checkbox'}],
    [{checked:true}]));
  checks.push({
    criterion_key:'text__ti__psych__psych-a__score_energy',
    comment:JSON.stringify({type:'score',value:5,max:10})
  });
  const context = {
    executionIsScoreResponseKey:key=>String(key||'').startsWith('text__ti__')&&/__score_[a-zA-Z0-9_-]+$/.test(key),
    executionScoreResponseFromComment:comment=>{
      try{const score=JSON.parse(comment);return score?.type==='score'&&score.max===10?score:null}catch(error){return null}
    },
    executionReviewForTrade:tradeId=>tradeId==='trade-1'?{id:'review-1'}:null,
    executionChecksForReview:reviewId=>reviewId==='review-1'?checks:[]
  };
  vm.runInNewContext(source.slice(start,end)+'\nthis.result=executionMappedCompositeForTrade("trade-1");',context);
  assert.ok(Math.abs(context.result.score-7.5)<0.0001);
  assert.deepEqual(Object.keys(context.result.categories).sort(),['checklist','playbook','psych']);
});

test('Combined Execution score remains pending until all three areas have measurable inputs', () => {
  const start = source.indexOf('function executionMappedValuesForKind(');
  const end = source.indexOf('async function updateTradeExecutionCompositeScore(', start);
  const oneArea = [{
    criterion_key:'text__ti_state__playbook__edge-a',
    comment:JSON.stringify({
      schema:'tios.execution-form.v1',kind:'playbook',documentId:'edge-a',
      definition:JSON.stringify([{type:'checkbox'}]),controls:[{checked:true}]
    })
  }];
  const context = {
    executionIsScoreResponseKey:key=>String(key||'').startsWith('text__ti__')&&/__score_[a-zA-Z0-9_-]+$/.test(key),
    executionScoreResponseFromComment:()=>null,
    executionReviewForTrade:()=>({id:'review-1'}),
    executionChecksForReview:()=>oneArea
  };
  vm.runInNewContext(source.slice(start,end)+'\nthis.result=executionMappedCompositeForTrade("trade-1");',context);
  assert.equal(context.result.hasMappedData,true);
  assert.equal(context.result.score,null);
});
