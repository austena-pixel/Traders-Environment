const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');

test('Execution exposes saved instrument selectors beside the selected trade',()=>{
  assert.ok(source.includes('id="executionMapPlaybookSelect"'));
  assert.ok(source.includes('id="executionMapChecklistSelect"'));
  assert.ok(source.includes('id="executionMapPsychSelect"'));
  assert.ok(source.includes('function renderExecutionMappingControls()'));
});

test('journal selector represents active journal for future reviews',()=>{
  assert.ok(source.includes("setActiveExecutionStructure(event.target.value)"));
  assert.ok(source.includes('Active journal changed for future/unreviewed trades'));
});
