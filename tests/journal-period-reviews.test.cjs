const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');
const start = source.indexOf('function journalLocalDateKey(');
const end = source.indexOf('function journalScopePercent(',start);
assert.ok(start >= 0 && end > start, 'journal period helpers should be present');
const context = {};
vm.runInNewContext(
  source.slice(start,end)+'\nthis.journalPeriodBounds=journalPeriodBounds;this.journalTradingDayRuleDates=journalTradingDayRuleDates;',
  context
);
const bounds = (date,period) => JSON.parse(JSON.stringify(context.journalPeriodBounds(date,period)));
const ruleDates = (records,startDate,endDate) => JSON.parse(JSON.stringify(context.journalTradingDayRuleDates(records,startDate,endDate)));

test('Journal daily review selects only its anchor date', () => {
  assert.deepEqual(bounds('2026-10-11','day'), {start:'2026-10-11',end:'2026-10-11'});
});

test('Journal weekly review uses Monday through Sunday boundaries', () => {
  assert.deepEqual(bounds('2026-10-11','week'), {start:'2026-10-05',end:'2026-10-11'});
  assert.deepEqual(bounds('2026-10-05','week'), {start:'2026-10-05',end:'2026-10-11'});
});

test('Journal monthly review includes the correct month length', () => {
  assert.deepEqual(bounds('2024-02-15','month'), {start:'2024-02-01',end:'2024-02-29'});
  assert.deepEqual(bounds('2026-10-31','month'), {start:'2026-10-01',end:'2026-10-31'});
});


test('Trading Day Rules count each distinct date once', () => {
  const records=[
    {ruleScope:'daily',period:{startDate:'2026-10-05'},documentId:'rules-a'},
    {ruleScope:'daily',period:{startDate:'2026-10-05'},documentId:'rules-b'},
    {ruleScope:'daily',period:{startDate:'2026-10-06'},documentId:'rules-a'},
    {ruleScope:'session',period:{startDate:'2026-10-05'},documentId:'session-rules'},
    {ruleScope:'weekly',period:{startDate:'2026-10-05'},documentId:'week-rules'}
  ];
  assert.deepEqual(ruleDates(records), ['2026-10-05','2026-10-06']);
});

test('Trading Day Rules follow the selected daily, weekly or monthly date bounds', () => {
  const records=[
    {ruleScope:'daily',period:{startDate:'2026-10-04'}},
    {ruleScope:'daily',period:{startDate:'2026-10-05'}},
    {ruleScope:'daily',period:{startDate:'2026-10-11'}},
    {ruleScope:'daily',period:{startDate:'2026-10-12'}}
  ];
  assert.deepEqual(ruleDates(records,'2026-10-05','2026-10-11'), ['2026-10-05','2026-10-11']);
});

test('Trading Day Rules ignore malformed review dates', () => {
  const records=[
    {ruleScope:'daily',period:{startDate:'2026-02-30'}},
    {ruleScope:'daily',period:{}},
    null
  ];
  assert.deepEqual(ruleDates(records), []);
});
