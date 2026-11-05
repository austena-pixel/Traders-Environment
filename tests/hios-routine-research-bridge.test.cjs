const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'hios-connection-layer.js'), 'utf8');
const REQUESTS_KEY = 'hios_goal_routine_research_requests_v1';

function makeBridge() {
  const values = new Map();
  const listeners = new Map();
  let nextUuid = 0;
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const window = {
    localStorage,
    crypto: { randomUUID: () => `test-uuid-${++nextUuid}` },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)),
    dispatchEvent: event => { (listeners.get(event.type) || []).forEach(fn => fn(event)); return true; }
  };
  window.window = window;
  vm.runInNewContext(bridgeSource, { window, localStorage, CustomEvent, console: { warn() {}, log() {}, error() {} } });
  return { bridge: window.HIOSConnectionLayer, localStorage };
}

test('G-IOS routine research requests and R-IOS responses use validated, acknowledged bridge signals', () => {
  const { bridge, localStorage } = makeBridge();
  const request = {
    schema: 'hios.routine-research-request.v1', source: 'goals-ios', targetProductId: 'rios',
    requestId: 'routine_req_1', area: 'Trading', gapSummary: 'Execution goal is 42% complete.',
    goalSummaries: [{ goalId: 'goal-1', title: 'Improve execution', progress: 42, remaining: 58 }],
    requestedAt: '2026-11-05T12:00:00.000Z', status: 'prepared'
  };
  localStorage.setItem(REQUESTS_KEY, JSON.stringify({ [request.requestId]: request }));

  const goals = bridge.connect('goals-ios');
  const sent = goals.emit('routine.research.requested', { request }, { targetProductId: 'rios', requestId: request.requestId });
  assert.equal(sent.ok, true);

  const pendingRequest = goals.getPendingRequests().find(item => item.type === 'routine.research.requested');
  assert.ok(pendingRequest);
  const routine = bridge.connect('r-ios');
  const response = {
    schema: 'hios.routine-research-response.v1', source: 'r-ios', target: 'goals-ios',
    requestId: request.requestId, area: 'Trading', status: 'insufficient_evidence',
    summary: 'There is not enough comparable evidence yet.', evidence_references: [],
    recommended_next_step: 'Continue recording trading journals.', respondedAt: '2026-11-05T12:05:00.000Z'
  };
  const returned = routine.emit('routine.research.responded', { response }, { requestId: request.requestId });
  assert.equal(returned.ok, true);
  assert.equal(routine.acknowledgeRequest(pendingRequest.signalId, { status: response.status }, pendingRequest), true);

  const pendingResponse = goals.getPendingRequests().find(item => item.type === 'routine.research.responded');
  assert.ok(pendingResponse);
  assert.equal(goals.acknowledgeRequest(pendingResponse.signalId, { status: 'received' }, pendingResponse), true);
  assert.equal(goals.getPendingRequests().length, 0);
});

test('the bridge rejects research responses that do not match a stored request', () => {
  const { bridge } = makeBridge();
  const routine = bridge.connect('r-ios');
  const result = routine.emit('routine.research.responded', { response: {
    schema: 'hios.routine-research-response.v1', source: 'r-ios', target: 'goals-ios',
    requestId: 'missing', area: 'Trading', status: 'evaluated', summary: 'No evidence.',
    evidence_references: [], respondedAt: '2026-11-05T12:05:00.000Z'
  } }, { requestId: 'missing' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /stored Goals-IOS request/);
});
