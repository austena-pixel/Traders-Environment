const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
