const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');

test('new execution journal is available as a page-level action', () => {
  assert.ok(source.includes('id="executionNewJournalTopBtn"'));
  assert.ok(source.includes("$('#executionNewJournalTopBtn').addEventListener"));
  assert.ok(source.includes('Create Execution Journal'));
});

test('reviewed trades do not block creating another journal', () => {
  assert.ok(source.includes('newBtn.hidden=false;'));
  assert.ok(!source.includes("recommendedBtn.hidden=true;\n    newBtn.hidden=true;"));
});

test('journal builder remains above the fixed Execution workspace', () => {
  assert.ok(source.includes('#executionStructureModal{'));
  assert.ok(source.includes('z-index:220'));
  assert.ok(source.includes('body.execution-workspace #executionStructureModal.open'));
});
