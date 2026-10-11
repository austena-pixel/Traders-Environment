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
  source.slice(start,end)+'\nthis.journalPeriodBounds=journalPeriodBounds;this.journalTradingDayRuleDates=journalTradingDayRuleDates;this.journalTradingDayGroups=journalTradingDayGroups;this.journalRuleDocumentsForScope=journalRuleDocumentsForScope;',
  context
);
const bounds = (date,period) => JSON.parse(JSON.stringify(context.journalPeriodBounds(date,period)));
const ruleDates = (records,startDate,endDate) => JSON.parse(JSON.stringify(context.journalTradingDayRuleDates(records,startDate,endDate)));
const tradingDays = records => JSON.parse(JSON.stringify(context.journalTradingDayGroups(records)));
const rulesForScope = (documents,scope) => JSON.parse(JSON.stringify(context.journalRuleDocumentsForScope(documents,scope)));

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


test('Trading Day records group by date, newest day first, without discarding same-day entries', () => {
  const groups=tradingDays([
    {id:'older',session_date:'2026-10-05',created_at:'2026-10-05T08:00:00Z'},
    {id:'new-day',session_date:'2026-10-06',created_at:'2026-10-06T08:00:00Z'},
    {id:'latest',session_date:'2026-10-05',updated_at:'2026-10-05T17:00:00Z'},
    {id:'bad-date',session_date:'2026-02-30'}
  ]);
  assert.deepEqual(groups.map(group=>group.date),['2026-10-06','2026-10-05']);
  assert.deepEqual(groups[1].records.map(record=>record.id),['latest','older']);
});

test('Journal Rules filter Technical Instruments by the selected supported scope', () => {
  const documents=[
    {id:'day',name:'Daily plan',ruleScope:'daily'},
    {id:'week',name:'Weekly plan',ruleScope:'weekly'},
    {id:'draft',name:'Draft day plan',ruleScope:'daily',templateDraft:true},
    {id:'intraday',name:'Intraday plan',ruleScope:'session'}
  ];
  assert.deepEqual(rulesForScope(documents,'daily').map(document=>document.id),['day']);
  assert.deepEqual(rulesForScope(documents,'weekly').map(document=>document.id),['week']);
  assert.deepEqual(rulesForScope(documents,'session'),[]);
});

test('Journal navigation uses Trading Day and Rules tabs, with daily, weekly and monthly rule scopes', () => {
  const journalStart=source.indexOf('<section class="page" id="page-journal">');
  const journalEnd=source.indexOf('<!-- PLACEHOLDERS -->',journalStart);
  const journal=source.slice(journalStart,journalEnd);
  const tabs=journal.slice(journal.indexOf('role="tablist"'),journal.indexOf('</div>',journal.indexOf('role="tablist"')));
  const views=[...tabs.matchAll(/data-journal-view="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(views,['trades','trading-days','rules','reviews']);
  assert.match(journal,/data-journal-rule-scope="daily"[^>]*>Trading Day</);
  assert.match(journal,/data-journal-rule-scope="weekly"[^>]*>Weekly</);
  assert.match(journal,/data-journal-rule-scope="monthly"[^>]*>Monthly</);
  const visibleJournal=journal.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.doesNotMatch(visibleJournal,/\bsessions?\b/i);
});

test('Psychology displays saved daily records as Trading Days and translates legacy labels', () => {
  const start=source.indexOf('<section class="page" id="page-psychology">');
  const end=source.indexOf('<section class="page" id="page-playbook">',start);
  const visible=source.slice(start,end).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.doesNotMatch(visible,/\bsessions?\b/i);
  const labelStart=source.indexOf('function psychologyTradingDayLabel(');
  const labelEnd=source.indexOf('function clearPsychForm(',labelStart);
  assert.ok(labelStart>=0&&labelEnd>labelStart);
  const labelContext={};
  vm.runInNewContext(source.slice(labelStart,labelEnd)+'\nthis.display=psychologyTradingDayLabel;',labelContext);
  assert.equal(labelContext.display('Session 2'),'');
  assert.equal(labelContext.display('Session 12 / New York'),'New York');
});


test('Execution review uses Trading Day and Intraday Window language',()=>{
  const executionStart=source.indexOf('<section class="page" id="page-execution">');
  const executionEnd=source.indexOf('<section class="page" id="page-settings">',executionStart);
  assert.ok(executionStart>=0&&executionEnd>executionStart);
  const visibleExecution=source.slice(executionStart,executionEnd).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.doesNotMatch(visibleExecution,/\bsessions?\b/i);
  assert.match(source,/Review behaviour across this intraday window/);
  const scopes=fs.readFileSync(path.join(__dirname,'..','technical-instruments','period-rules.js'),'utf8');
  assert.match(scopes,/session:'Intraday Window',daily:'Trading Day',weekly:'Weekly',monthly:'Monthly'/);
});
