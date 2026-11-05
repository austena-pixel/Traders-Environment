const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../r-ios-engine.js');

test('buildObservations preserves real T-IOS source references and avoids inventing times', () => {
  const result = engine.buildObservations({
    sessions: [{ id: 'session-1', session_date: '2026-11-01', session_label: 'London', created_at: null }],
    trades: [{ id: 'trade-1', trade_date: '2026-11-01', execution_score: 72 }]
  });

  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].observed_at, null);
  assert.equal(result.observations[0].observed_on, '2026-11-01');
  assert.equal(result.observations[0].source_reference.record_id, 'session-1');
  assert.equal(result.outcomes[0].source_record_id, 'trade-1');
  assert.equal(result.outcomes[0].observed_at, null);
});

test('buildObservations does not treat missing execution scores as zero outcomes', () => {
  const result = engine.buildObservations({
    trades: [
      { id: 'trade-null', trade_date: '2026-11-01', execution_score: null },
      { id: 'trade-open', trade_date: '2026-11-02', execution_score: 0, position_status: 'OPEN' },
      { id: 'trade-closed', trade_date: '2026-11-03', execution_score: 0, closed_at: '2026-11-03T08:30:00Z', position_status: 'closed' }
    ]
  });

  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].source_record_id, 'trade-closed');
  assert.equal(result.outcomes[0].execution_score, 0);
  assert.equal(result.outcomes[0].observed_at, '2026-11-03T08:30:00.000Z');
});

test('buildObservations groups checklist rows into one source-linked review event', () => {
  const result = engine.buildObservations({
    trades: [{ id: 'trade-1', trade_date: '2026-11-01', execution_score: 70 }],
    planReviews: [{ id: 'plan-1', trade_id: 'trade-1', created_at: '2026-11-01T08:00:00Z' }],
    planChecks: [
      { id: 'check-1', review_id: 'plan-1', complied: true, created_at: '2026-11-01T08:01:00Z' },
      { id: 'check-2', review_id: 'plan-1', complied: false, created_at: '2026-11-01T08:02:00Z' }
    ]
  });
  const event = result.observations.find(row => row.activity_key === 'plan_checklist_review');

  assert.ok(event);
  assert.equal(event.details.check_count, 2);
  assert.equal(event.details.complied_count, 1);
  assert.deepEqual(event.source_reference.check_ids, ['check-1', 'check-2']);
});

test('buildObservations includes playbook-to-trade links as recorded behavior', () => {
  const result = engine.buildObservations({
    trades: [{ id: 'trade-1', trade_date: '2026-11-01', execution_score: 70 }],
    playbookLinks: [{
      trade_id: 'trade-1',
      playbook_id: 'playbook-1',
      playbook_name: 'London setup',
      required_sections: ['context', 'entry'],
      assigned_at: '2026-11-01T07:30:00Z'
    }]
  });
  const event = result.observations.find(row => row.activity_key === 'playbook_linked_to_trade');

  assert.ok(event);
  assert.equal(event.observed_on, '2026-11-01');
  assert.equal(event.details.required_section_count, 2);
  assert.equal(event.source_reference.trade_id, 'trade-1');
});

test('detectPatterns reports repeated sequences across distinct days', () => {
  const observations = [
    { activity_key: 'trade_plan_review', observed_at: '2026-11-01T08:00:00Z', observed_on: '2026-11-01', source_reference: { record_id: 'p1' } },
    { activity_key: 'trade_execution_review', observed_at: '2026-11-01T09:00:00Z', observed_on: '2026-11-01', source_reference: { record_id: 'e1' } },
    { activity_key: 'trade_plan_review', observed_at: '2026-11-02T08:00:00Z', observed_on: '2026-11-02', source_reference: { record_id: 'p2' } },
    { activity_key: 'trade_execution_review', observed_at: '2026-11-02T09:00:00Z', observed_on: '2026-11-02', source_reference: { record_id: 'e2' } }
  ];
  const patterns = engine.detectPatterns(observations, []);
  const sequence = patterns.find(row => row.sequence.join(',') === 'trade_plan_review,trade_execution_review');

  assert.ok(sequence);
  assert.equal(sequence.observation_count, 2);
  assert.equal(sequence.evaluation.status, 'insufficient_evidence');
  assert.equal(sequence.evidence_references.length, 2);
});

test('evaluation requires comparable days and labels a relationship as an association', () => {
  const matched = Array.from({ length: 10 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`);
  const allDays = [...matched, ...Array.from({ length: 10 }, (_, index) => `2026-11-${String(index + 11).padStart(2, '0')}`)];
  const outcomes = allDays.map((day, index) => ({ observed_on: day, execution_score: index < 10 ? 80 : 60 }));
  const result = engine.evaluatePattern(matched, allDays, outcomes);
  const copy = engine.discoveryCopy({ observation_count: 5, evaluation: result });

  assert.equal(result.status, 'supported_association');
  assert.equal(result.direction, 'positive');
  assert.equal(result.difference, 20);
  assert.match(copy.summary, /association/);
  assert.match(result.caveat, /does not show/);
});

test('three comparable days per group are shown as an early signal', () => {
  const matched = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const allDays = [...matched, '2026-11-04', '2026-11-05', '2026-11-06'];
  const outcomes = allDays.map((day, index) => ({ observed_on: day, execution_score: index < 3 ? 80 : 60 }));
  assert.equal(engine.evaluatePattern(matched, allDays, outcomes).status, 'early_signal');
});

test('missing comparison observations keep an evaluation at insufficient evidence', () => {
  const result = engine.evaluatePattern(
    ['2026-11-01', '2026-11-02', '2026-11-03'],
    ['2026-11-01', '2026-11-02', '2026-11-03'],
    [
      { observed_on: '2026-11-01', execution_score: 80 },
      { observed_on: '2026-11-02', execution_score: 70 },
      { observed_on: '2026-11-03', execution_score: 75 }
    ]
  );
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.without_pattern_days, 0);
  assert.equal(result.with_pattern_mean, 75);
});
