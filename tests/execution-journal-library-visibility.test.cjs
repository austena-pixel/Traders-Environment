const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');

test('saved Execution journals remain visible while viewing reviewed trades',()=>{
  assert.ok(source.includes('id="executionJournalLibraryLabel"'));
  assert.ok(source.includes("libraryLabel.textContent='My Journals • '+store.structures.length"));
  assert.ok(source.includes('select.hidden=false;'));
  assert.ok(source.includes('this trade keeps its original journal'));
});

test('journal selector represents active journal for future reviews',()=>{
  assert.ok(source.includes("setActiveExecutionStructure(event.target.value)"));
  assert.ok(source.includes('Active journal changed for future/unreviewed trades'));
});
