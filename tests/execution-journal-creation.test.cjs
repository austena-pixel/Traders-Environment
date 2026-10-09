const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');

test('Execution exposes the current route back to instrument creation and editing', () => {
  assert.ok(source.includes('id="executionBackToInstrumentsBtn"'));
  assert.ok(source.includes("$('#executionBackToInstrumentsBtn')?.addEventListener"));
  assert.ok(source.includes('Back to Instruments'));
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
