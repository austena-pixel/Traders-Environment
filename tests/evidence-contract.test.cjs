const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../core/evidence-contract.js');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const userId = '00000000-0000-4000-8000-000000000001';
const example = () => ({
  schema: contract.SCHEMA,
  id: 'test-evidence-1', sourceProductId: 'tios', domain: 'trading', userId,
  evidenceType: 'rule_compliance_assessment', observedAt: '2026-10-04T14:00:00+02:00',
  subject: { type: 'trade', id: 'test-trade-1' },
  observation: { reviewId: 'test-review-1', criteria: [true, false], note: null }
});

test('minimal evidence, JSON round trip and optional domain interpretation', () => {
  const evidence = example();
  assert.equal(contract.validateEvidence(evidence).valid, true);
  assert.equal(contract.validateEvidence(JSON.parse(JSON.stringify(evidence))).valid, true);
  evidence.evaluation = { metric: 'domain-owned', value: -12, unit: 'custom' };
  evidence.model = { version: 'Playbook v23' };
  evidence.context = { accountId: 'test-account' };
  evidence.source = 't-ios';
  assert.equal(contract.validateEvidence(evidence).valid, true);
  evidence.sourceProductId = 'future-product';
  evidence.domain = 'future-domain';
  assert.equal(contract.validateEvidence(evidence).valid, true);
});

test('creation defaults only schema and copies payload without changing input', () => {
  const input = example(); delete input.schema;
  const before = JSON.stringify(input);
  const created = contract.createEvidence(input);
  assert.equal(created.schema, 'hios.evidence.v1');
  assert.equal(JSON.stringify(input), before);
  created.observation.criteria.push(true);
  assert.equal(input.observation.criteria.length, 2);
  assert.equal('evaluation' in created, false);
  assert.throws(() => contract.createEvidence({ ...input, schema: 'hios.evidence.v2' }), TypeError);
  assert.throws(() => contract.createEvidence({}), TypeError);
});

for (const field of ['id', 'sourceProductId', 'domain', 'userId', 'evidenceType', 'observedAt', 'subject', 'observation', 'schema']) {
  test('missing required field: ' + field, () => {
    const evidence = example(); delete evidence[field];
    assert.equal(contract.validateEvidence(evidence).valid, false);
  });
}

test('malformed roots, identity, payloads and optional fields are rejected', () => {
  for (const input of [null, undefined, 3, 'evidence', [], new Date()]) {
    assert.equal(contract.validateEvidence(input).valid, false);
  }
  for (const change of [
    { schema: 'hios.signal.v1' }, { id: ' ' }, { sourceProductId: 1 },
    { userId: 'someone@example.com' }, { userId: 'local-user' },
    { subject: { type: 'trade' } }, { subject: [] }, { observation: [] },
    { observation: null }, { evaluation: null }, { evaluation: [] },
    { context: [] }, { model: 2 }, { source: '' }
  ]) assert.equal(contract.validateEvidence({ ...example(), ...change }).valid, false);
  assert.equal(contract.validateEvidence({ ...example(), model: null }).valid, true);
});

test('occurrence dates require a real date and explicit timezone', () => {
  for (const observedAt of ['2026-02-30T12:00:00Z', '2025-02-29T00:00:00Z',
    '2026-10-04', '2026-10-04T12:00:00', '2026-10-04T24:00:00Z',
    '2026-10-04T12:00:00+25:00', 'yesterday', 123]) {
    assert.equal(contract.validateEvidence({ ...example(), observedAt }).valid, false);
  }
  for (const observedAt of ['2024-02-29T00:00:00.123Z', '2026-10-04T01:00:00-05:30']) {
    assert.equal(contract.validateEvidence({ ...example(), observedAt }).valid, true);
  }
});

test('non-JSON values cannot be silently lost or converted in transport', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = {}; Object.defineProperty(accessor, 'secret', { enumerable: true, get() { throw Error('must not run'); } });
  const sparse = new Array(1); sparse.extra = 1;
  for (const value of [undefined, NaN, Infinity, 1n, () => {}, Symbol('x'), new Date(),
    new Map(), cyclic, accessor, sparse, new Array(2)]) {
    assert.equal(contract.validateEvidence({ ...example(), observation: { value } }).valid, false);
  }
  const repeated = { value: 1 };
  assert.equal(contract.validateEvidence({ ...example(), observation: { a: repeated, b: repeated } }).valid, true);
});

function browser() {
  const storage = new Map();
  const context = vm.createContext({
    console, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {}
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(read('core/evidence-contract.js'), context);
  return { context, storage, run: script => vm.runInContext(script, context) };
}

test('classic browser registration coexists with unchanged communication API', () => {
  const { run, storage } = browser();
  assert.equal(storage.size, 0);
  run(read('hios-connection-layer.js'));
  assert.equal(run("HIOSConnectionLayer.connect('goals-ios').emit('task.created', { id: 'test-task' }).ok"), true);
  assert.equal(run("HIOSConnectionLayer.connect('h-ios').emit('task.delete.requested', { id: 'test-task' }).ok"), true);
  assert.equal(run("HIOSConnectionLayer.connect('goals-ios').getPendingRequests().length"), 1);
  const before = [...storage];
  run('const originalContract = HIOSEvidenceContract');
  run(read('core/evidence-contract.js'));
  assert.equal(run('HIOSEvidenceContract === originalContract'), true);
  assert.deepEqual([...storage], before);
});

test('actual T-IOS publisher output passes shared validation; H-IOS receives once', () => {
  const { run } = browser();
  run(`const currentUser = { id: '${userId}' }; const tradingAccount = {id:'test-account'};
    const HIOS_STRUCTURED_EVIDENCE_BUS_KEY='test-bus'; const HIOS_STRUCTURED_EVIDENCE_LIMIT=500;
    const HIOS_STRUCTURED_EVIDENCE_RECEIPTS_KEY='test-receipts'; const HIOS_VERIFIED_EVIDENCE_KEY='test-verified';
    const readHiosJson=(key,fallback)=>JSON.parse(localStorage.getItem(key)||'null')??fallback;
    const writeHiosJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
    const readHiosEcosystemJson=readHiosJson; const writeHiosEcosystemJson=writeHiosJson;
    const setTiosConnectionStatus=()=>{};`);
  const tios = read('t-ios.html');
  run(tios.slice(tios.indexOf('function publishTiosStructuredEvidence('), tios.indexOf('function publishTiosSnapshot(')));
  run(`const published = publishTiosStructuredEvidence({ evidenceType:'rule_compliance_assessment',
    subject:{type:'trade',id:'test-trade'}, observation:{reviewId:'test-review'},
    evaluation:{metric:'playbook_adherence',value:50}, model:{version:'v2'} });`);
  assert.equal(run('HIOSEvidenceContract.validateEvidence(published).valid'), true);
  const index = read('index.html');
  assert.ok(index.indexOf('src="core/evidence-contract.js"') < index.indexOf('function verifyHiosStructuredEvidence'));
  run(index.slice(index.indexOf('function verifyHiosStructuredEvidence('), index.indexOf('function hiosStructuredEvidenceDiagnostic(')));
  assert.equal(run('receiveHiosStructuredEvidence()'), 1);
  assert.equal(run('receiveHiosStructuredEvidence()'), 0);
  assert.equal(run("readHiosJson('test-verified',{}).tios[0].evaluation.value"), 50);
  run("writeHiosJson('test-bus',[{...published,id:'bad',userId:null}])");
  assert.equal(run('receiveHiosStructuredEvidence()'), 0);
  assert.equal(run("readHiosJson('test-verified',{}).tios.length"), 1);
});
