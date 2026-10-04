const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../core/evidence-contract.js');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const userId = '00000000-0000-4000-8000-000000000001';
const tiosSlice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
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

test('Stage 1B routes one T-IOS activity through the shared connector and H-IOS receives it once', () => {
  const { run } = browser();
  run(read('hios-connection-layer.js'));
  run(`localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']));
    const currentUser = { id: '${userId}' }; const tradingAccount = {id:'test-account'};
    const HIOS_STRUCTURED_EVIDENCE_BUS_KEY='test-bus'; const HIOS_STRUCTURED_EVIDENCE_LIMIT=500;
    const HIOS_STRUCTURED_EVIDENCE_RECEIPTS_KEY='test-receipts'; const HIOS_VERIFIED_EVIDENCE_KEY='test-verified';
    const readHiosJson=(key,fallback)=>JSON.parse(localStorage.getItem(key)||'null')??fallback;
    const writeHiosJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
    const readHiosEcosystemJson=readHiosJson; const writeHiosEcosystemJson=writeHiosJson;
    const setTiosConnectionStatus=()=>{};
    const isProductAdded=id=>JSON.parse(localStorage.getItem('hios_added_products_v1')||'[]').includes(id);
    const tiosHiosBridge=HIOSConnectionLayer.connect('t-ios');`);

  const tios = read('t-ios.html');
  assert.ok(tios.indexOf('src="core/evidence-contract.js"') < tios.indexOf('src="hios-connection-layer.js"'));
  assert.ok(tios.indexOf('src="hios-connection-layer.js"') < tios.indexOf('function publishTiosStructuredEvidence'));
  const saveStart=tios.indexOf('async function saveEdgeReview()');
  const saveEnd=tios.indexOf('async function deleteEdgeReview()',saveStart);
  const saveBlock=tios.slice(saveStart,saveEnd);
  assert.ok(saveBlock.includes("db.from('trade_plan_reviews').update"));
  assert.ok(saveBlock.includes("db.from('trade_plan_reviews').insert"));
  assert.ok(saveBlock.includes("db.from('trade_plan_checks').upsert"));
  assert.ok(saveBlock.indexOf('if(checkResult.error)') < saveBlock.indexOf('publishPlaybookReviewStructuredEvidence(trade.id);'));

  run(tios.slice(tios.indexOf('function publishTiosStructuredEvidence('), tios.indexOf('function publishTiosSnapshot(')));
  run(`const published = publishTiosStructuredEvidence({ evidenceType:'rule_compliance_assessment',
    subject:{type:'trade',id:'test-trade'}, observation:{reviewId:'test-review'},
    evaluation:{metric:'playbook_adherence',value:50}, model:{version:'v2'},
    observedAt:'2026-10-04T14:00:00+02:00' });`);
  assert.equal(run('HIOSEvidenceContract.validateEvidence(published).valid'), true);
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).source"), 't-ios');
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).type"), 'evidence.observed');
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).payload.evidence.id === published.id"), true);

  const index = read('index.html');
  assert.ok(index.indexOf('src="core/evidence-contract.js"') < index.indexOf('function verifyHiosStructuredEvidence'));
  assert.ok(index.includes("source:'t-ios',types:['evidence.observed']"));
  run(index.slice(index.indexOf('function verifyHiosStructuredEvidence('), index.indexOf('function hiosStructuredEvidenceDiagnostic(')));
  assert.equal(run("receiveHiosStructuredEvidence([JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).payload.evidence])"), 1);
  assert.equal(run("receiveHiosStructuredEvidence([JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).payload.evidence])"), 0);
  assert.equal(run('receiveHiosStructuredEvidence()'), 0);
  assert.equal(run("readHiosJson('test-verified',{}).tios[0].evaluation.value"), 50);

  run("localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios']))");
  run(`const rejected = publishTiosStructuredEvidence({ evidenceType:'rule_compliance_assessment',
    subject:{type:'trade',id:'test-trade-2'}, observation:{reviewId:'test-review-2'},
    evaluation:{metric:'playbook_adherence',value:75} });`);
  assert.equal(run('rejected'), null);
  assert.equal(run("readHiosJson('test-bus',[]).length"), 1);
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_log_v1')).at(-1).status"), 'rejected');
  assert.match(run("JSON.parse(localStorage.getItem('hios_communication_log_v1')).at(-1).errors.join(' ')"), /disconnected/);
});


test('Stage 1C routes only selected G-IOS evidence metrics through H-IOS to T-IOS', () => {
  const { run } = browser();
  run(read('hios-connection-layer.js'));
  run(`localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']));
    const GIOS_EVIDENCE_REQUESTS_KEY='test-requests';
    const TIOS_EVIDENCE_RESPONSES_KEY='test-responses';
    const PRODUCT_GOAL_EVIDENCE_KEY='test-goal-evidence';
    const HIOS_PRODUCT_STATUS_KEY='test-status';
    const HIOS_EVIDENCE_REQUEST_RECEIPTS_KEY='test-request-receipts';
    const readHiosJson=(key,fallback)=>JSON.parse(localStorage.getItem(key)||'null')??fallback;
    const writeHiosJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
    const readHiosEcosystemJson=readHiosJson; const writeHiosEcosystemJson=writeHiosJson;
    const goalsBridge=HIOSConnectionLayer.connect('goals-ios');
    const productLinkForArea=()=>({productId:'tios'});
    const activeProgressPhase=model=>model.phases[0];
    const groupedEvidenceIds=(productId,ids)=>({technical:ids.filter(id=>id==='playbook_adherence'),psychological:ids.filter(id=>id==='discipline_score'),general:[]});`);

  const gios=read('g-ios.html');
  run(gios.slice(gios.indexOf('function publishGoalEvidenceRequest('), gios.indexOf('function currentEvidenceRequest(')));
  run(`const request = publishGoalEvidenceRequest('Trading',{
    name:'Trading Progress Model',
    phases:[{id:'phase-1',title:'Execution Quality',evidence:['playbook_adherence','discipline_score','playbook_adherence']}]
  });`);

  assert.deepEqual([...run('request.metrics')], ['playbook_adherence','discipline_score']);
  assert.equal(run('request.status'), 'routed');
  assert.equal(run('request.router'), 'hios-communication-centre');
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).source"), 'goals-ios');
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).type"), 'evidence.requested');
  assert.deepEqual([...run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).payload.request.metrics")], ['playbook_adherence','discipline_score']);
  assert.equal(run("JSON.parse(localStorage.getItem('test-requests')).tios.hiosSignalId === request.hiosSignalId"), true);

  run(`const isProductAdded=id=>JSON.parse(localStorage.getItem('hios_added_products_v1')||'[]').includes(id);
    const hiosBridge=HIOSConnectionLayer.connect('h-ios');`);
  const index=read('index.html');
  run(index.slice(index.indexOf('function verifyGoalEvidenceRequest('), index.indexOf('function hiosGoalEvidenceDiagnostic(')));
  run(`const routedSignal=JSON.parse(localStorage.getItem('hios_communication_last_signal_v1'));
    receiveGoalEvidenceRequestSignal(routedSignal);`);
  assert.equal(run("JSON.parse(localStorage.getItem('test-request-receipts'))[request.requestId].verified"), true);
  assert.equal(run("JSON.parse(localStorage.getItem('test-requests')).tios.status"), 'routed');
  assert.equal(run("hiosBridge.getPendingRequests().some(row=>row.signalId===routedSignal.signalId)"), false);

  run(`const currentUser={id:'00000000-0000-4000-8000-000000000001'};
    const tradingAccount={id:'test-account'};
    const tiosRequestedEvidenceMetric=metric=>({available:true,value:metric==='playbook_adherence'?80:90,unit:'%'});
    const tiosEvidenceFamily=metric=>metric==='discipline_score'?'psychological':'technical';
    const setTiosConnectionStatus=()=>{};
    const tiosHiosBridge=HIOSConnectionLayer.connect('t-ios');`);
  run(tiosSlice(read('t-ios.html'),'function currentTiosEvidenceRequest()','function roundEvidence('));
  run(tiosSlice(read('t-ios.html'),"function respondToGoalEvidenceRequest(reason='refresh')",'window.TIOSGoalEvidenceDiagnostic'));
  run("const routedResponse=respondToGoalEvidenceRequest('stage_1c_test')");
  assert.deepEqual([...run('routedResponse.requestedMetrics')], ['playbook_adherence','discipline_score']);
  assert.deepEqual([...run('routedResponse.deliveredMetrics')], ['playbook_adherence','discipline_score']);
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).type"), 'evidence.responded');
});

test('Stage 1C does not create a T-IOS request with no selected metrics or a disconnected target', () => {
  const { run } = browser();
  run(read('hios-connection-layer.js'));
  run(`const GIOS_EVIDENCE_REQUESTS_KEY='test-requests';
    const goalsBridge=HIOSConnectionLayer.connect('goals-ios');
    const productLinkForArea=()=>({productId:'tios'});
    const activeProgressPhase=model=>model.phases[0];
    const groupedEvidenceIds=(productId,ids)=>({technical:ids,psychological:[],general:[]});`);
  const gios=read('g-ios.html');
  run(gios.slice(gios.indexOf('function publishGoalEvidenceRequest('), gios.indexOf('function currentEvidenceRequest(')));

  run("localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']))");
  assert.equal(run("publishGoalEvidenceRequest('Trading',{phases:[{id:'p1',title:'P1',evidence:[]}]})"), null);
  assert.equal(run("localStorage.getItem('test-requests')"), null);

  run("localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios']))");
  assert.equal(run("publishGoalEvidenceRequest('Trading',{phases:[{id:'p2',title:'P2',evidence:['playbook_adherence']}]})"), null);
  assert.equal(run("localStorage.getItem('test-requests')"), null);
  assert.match(run("JSON.parse(localStorage.getItem('hios_communication_log_v1')).at(-1).errors.join(' ')"), /disconnected/);
});


test('Stage 1D routes T-IOS response through H-IOS and G-IOS applies it once', () => {
  const { run } = browser();
  run(read('hios-connection-layer.js'));
  run(`localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']));
    const GIOS_EVIDENCE_REQUESTS_KEY='hios_goal_evidence_requests_v1';
    const TIOS_EVIDENCE_RESPONSES_KEY='test-responses';
    const PRODUCT_GOAL_EVIDENCE_KEY='test-goal-evidence';
    const HIOS_PRODUCT_STATUS_KEY='test-status';
    const request={requestId:'req-stage-1d',schema:'hios.goal-evidence-request.v1',source:'goals-ios',targetProductId:'tios',area:'Trading',modelName:'Trading Progress Model',phaseId:'phase-1',phaseName:'Stage 1',metrics:['execution_errors'],metricGroups:{technical:['execution_errors'],psychological:[],general:[]},requestedAt:'2026-10-04T16:20:00+02:00',status:'routed'};
    localStorage.setItem(GIOS_EVIDENCE_REQUESTS_KEY,JSON.stringify({tios:request}));
    const readHiosJson=(key,fallback)=>JSON.parse(localStorage.getItem(key)||'null')??fallback;
    const writeHiosJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
    const currentUser={id:'00000000-0000-4000-8000-000000000001'};
    const tradingAccount={id:'test-account'};
    const tiosRequestedEvidenceMetric=metric=>metric==='execution_errors'?{available:true,value:3,unit:'errors',sampleSize:2,details:{checks:8}}:{available:false,reason:'not requested'};
    const tiosEvidenceFamily=()=> 'technical';
    const setTiosConnectionStatus=()=>{};
    const tiosHiosBridge=HIOSConnectionLayer.connect('t-ios');`);
  const tios=read('t-ios.html');
  run(tiosSlice(tios,'function currentTiosEvidenceRequest()','function roundEvidence('));
  run(tiosSlice(tios,"function respondToGoalEvidenceRequest(reason='refresh')",'window.TIOSGoalEvidenceDiagnostic'));
  run("const response=respondToGoalEvidenceRequest('stage_1d_test')");
  assert.equal(run('response.status'),'fulfilled');
  assert.deepEqual([...run('response.deliveredMetrics')],['execution_errors']);
  assert.equal(run("JSON.parse(localStorage.getItem('test-goal-evidence')||'null')"),null);
  assert.equal(run("JSON.parse(localStorage.getItem('test-responses')||'null')"),null);
  assert.equal(run("JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')).type"),'evidence.responded');
  assert.equal(run("HIOSConnectionLayer.connect('goals-ios').getPendingRequests().some(row=>row.type==='evidence.responded')"),true);

  run(`const goalsBridge=HIOSConnectionLayer.connect('goals-ios');
    const evidenceFamily=()=> 'technical';
    const renderProductEvidenceReceiver=()=>{};
    const renderPersonalIntelligenceResponse=()=>{};`);
  const gios=read('g-ios.html');
  run(gios.slice(gios.indexOf('function validTiosEvidenceResponse('), gios.indexOf('const PRODUCT_FOCUS_CATALOG')));
  run("const responseSignal=JSON.parse(localStorage.getItem('hios_communication_last_signal_v1')); receiveTiosGoalEvidenceResponseSignal(responseSignal)");
  assert.equal(run("JSON.parse(localStorage.getItem('test-responses')).tios.status"),'fulfilled');
  assert.equal(run("JSON.parse(localStorage.getItem(GIOS_EVIDENCE_REQUESTS_KEY)).tios.status"),'fulfilled');
  assert.equal(run("JSON.parse(localStorage.getItem('test-goal-evidence')).tios.length"),1);
  assert.equal(run("JSON.parse(localStorage.getItem('test-goal-evidence')).tios[0].metric"),'execution_errors');
  assert.equal(run("JSON.parse(localStorage.getItem('test-goal-evidence')).tios[0].value"),3);
  assert.equal(run("HIOSConnectionLayer.connect('goals-ios').getPendingRequests().some(row=>row.type==='evidence.responded')"),false);
  run("receiveTiosGoalEvidenceResponseSignal(responseSignal)");
  assert.equal(run("JSON.parse(localStorage.getItem('test-goal-evidence')).tios.length"),1);
});

test('Stage 1D rejects a T-IOS response that exceeds the selected request scope', () => {
  const { run } = browser();
  run(read('hios-connection-layer.js'));
  run(`localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']));
    localStorage.setItem('hios_goal_evidence_requests_v1',JSON.stringify({tios:{requestId:'req-scope',metrics:['execution_errors']}}));
    const tiosHiosBridge=HIOSConnectionLayer.connect('t-ios');`);
  run(`const bad=tiosHiosBridge.emit('evidence.responded',{response:{
    schema:'hios.goal-evidence-response.v1',requestId:'req-scope',source:'t-ios',target:'goals-ios',productId:'tios',
    requestedMetrics:['execution_errors'],deliveredMetrics:['execution_errors','discipline_score'],
    unavailableMetrics:[],evidence:[{metric:'execution_errors',value:1},{metric:'discipline_score',value:90}],
    status:'fulfilled',respondedAt:'2026-10-04T16:30:00+02:00'
  }},{requestId:'req-scope'});`);
  assert.equal(run('bad.ok'),false);
  assert.match(run("bad.errors.join(' ')"),/requested metric scope|deliver every requested metric/);
});
