const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const deliberate = require('../r-ios-deliberate.js');
const engine = require('../r-ios-engine.js');

function fakeDb(rows, error = null) {
  const calls = [];
  const tables = Array.isArray(rows) ? { deliberate_routine_session_activities: rows } : rows;
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) { calls.push(['select', table, columns]); return this; },
        eq(column, value) { calls.push(['eq', column, value]); return this; },
        in(column, values) { calls.push(['in', column, values]); return this; },
        order(column, options) { calls.push(['order', column, options]); return this; },
        then(resolve, reject) {
          const tableError = error || tables?.errors?.[table] || null;
          return Promise.resolve({ data: tables?.[table] || [], error: tableError }).then(resolve, reject);
        }
      };
    }
  };
}

test('deliberate execution observations use recorded terminal states and preserve source evidence', async () => {
  const db = fakeDb({
    deliberate_routine_session_activities: [
    { id: 'session-activity-1', routine_id: 'routine-1', activity_key: 'activity-1', activity_title: 'Wake up', activity_kind: 'activity', status: 'completed', actual_completed_at: '2026-11-10T04:20:00Z', status_recorded_at: '2026-11-10T04:20:00Z' },
    { id: 'session-activity-2', routine_id: 'routine-1', activity_key: 'activity-2', activity_title: 'Gym', activity_kind: 'activity', status: 'partial', actual_started_at: '2026-11-10T04:35:00Z', status_recorded_at: '2026-11-10T05:00:00Z' },
    { id: 'session-activity-3', routine_id: 'routine-1', activity_key: 'activity-3', activity_title: 'Breakfast', activity_kind: 'activity', status: 'skipped', status_recorded_at: '2026-11-10T05:10:00Z' },
    { id: 'session-activity-4', routine_id: 'routine-1', activity_key: 'activity-4', activity_title: 'Next step', activity_kind: 'activity', status: 'pending' },
    { id: 'session-activity-5', routine_id: 'routine-1', activity_key: 'group-1', activity_title: 'Preparation block', activity_kind: 'group', status: 'pending' }
    ],
    deliberate_routine_sessions: [
      { id: 'session-start', routine_id: 'routine-1', scheduled_for: '2026-11-10', actual_started_at: '2026-11-10T04:00:00Z', status: 'in_progress' },
      { id: 'session-missed', routine_id: 'routine-1', scheduled_for: '2026-11-09', missed_recorded_at: '2026-11-09T04:10:00Z', status: 'missed' }
    ],
    deliberate_routines: [{ id: 'routine-1', name: 'Morning Routine' }]
  });

  const observations = await deliberate.buildObservations(db, 'user-1', engine);
  assert.equal(observations.length, 5);
  assert.deepEqual(observations.slice(0, 3).map(row => row.details.status), ['completed', 'partial', 'skipped']);
  assert.equal(observations[0].source_product_id, 'rios');
  assert.equal(observations[0].source_reference.record_id, 'session-activity-1');
  assert.equal(observations[1].observed_on, '2026-11-10');
  assert.match(observations[2].label, /Breakfast — skipped/);
  assert.equal(observations[3].source_table, 'deliberate_routine_sessions');
  assert.match(observations[3].label, /Morning Routine — session started/);
  assert.match(observations[4].label, /recorded as missed/);
  assert.equal(observations[4].source_reference.table, 'deliberate_routine_sessions');
  assert.ok(db.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-1'));
  assert.ok(db.calls.some(call => call[0] === 'in' && call[1] === 'status'));
});

test('the existing R-IOS analysis engine detects repeated user-authored execution using activity labels', async () => {
  const db = fakeDb({ deliberate_routine_session_activities: [
    { id: 'run-1', routine_id: 'routine-1', activity_key: 'activity-1', activity_title: 'Wake up', activity_kind: 'activity', status: 'completed', actual_completed_at: '2026-11-08T04:20:00Z', status_recorded_at: '2026-11-08T04:20:00Z' },
    { id: 'run-2', routine_id: 'routine-1', activity_key: 'activity-1', activity_title: 'Wake up', activity_kind: 'activity', status: 'completed', actual_completed_at: '2026-11-09T04:30:00Z', status_recorded_at: '2026-11-09T04:30:00Z' }
  ], deliberate_routine_sessions: [], deliberate_routines: [] });
  const observations = await deliberate.buildObservations(db, 'user-1', engine);
  const patterns = engine.detectPatterns(observations, []);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].observation_count, 2);
  assert.equal(patterns[0].title, 'Wake up — completed');
  assert.equal(patterns[0].evaluation.outcome_metric, 'none');
  assert.match(patterns[0].evaluation.caveat, /does not show/);
});

test('R-IOS can detect repeated explicitly recorded misses without inferring their cause', async () => {
  const db = fakeDb({
    deliberate_routine_session_activities: [],
    deliberate_routine_sessions: [
      { id: 'miss-1', routine_id: 'routine-1', scheduled_for: '2026-11-08', missed_recorded_at: '2026-11-08T04:10:00Z', status: 'missed' },
      { id: 'miss-2', routine_id: 'routine-1', scheduled_for: '2026-11-09', missed_recorded_at: '2026-11-09T04:15:00Z', status: 'missed' }
    ],
    deliberate_routines: [{ id: 'routine-1', name: 'Morning Routine' }]
  });
  const observations = await deliberate.buildObservations(db, 'user-1', engine);
  const patterns = engine.detectPatterns(observations, []);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].title, 'Morning Routine — session recorded as missed');
  assert.equal(patterns[0].evaluation.outcome_metric, 'none');
  assert.match(patterns[0].evaluation.caveat, /does not show/);
  assert.equal(Object.hasOwn(observations[0].details, 'resistance_occurred'), false);
});

test('missing migration is treated as unavailable evidence instead of breaking existing R-IOS', async () => {
  const db = fakeDb(null, { message: 'Could not find the table public.deliberate_routine_session_activities in the schema cache' });
  assert.deepEqual(await deliberate.buildObservations(db, 'user-1', engine), []);
});

test('routine time windows support overnight durations and period boundaries', () => {
  assert.equal(deliberate.durationBetween('21:00', '22:00'), 60);
  assert.equal(deliberate.durationBetween('21:00', '06:00'), 540);
  assert.deepEqual(deliberate.periodBounds('daily', new Date(2026, 10, 10)), { start: '2026-11-10', end: '2026-11-10' });
  assert.deepEqual(deliberate.periodBounds('weekly', new Date(2026, 10, 10)), { start: '2026-11-09', end: '2026-11-10' });
});

test('new deliberate data uses owner-scoped RLS policies and keeps intention separate from observation records', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261110110000_deliberate_routines.sql'), 'utf8');
  for (const table of [
    'deliberate_routines',
    'deliberate_routine_activities',
    'deliberate_routine_sessions',
    'deliberate_routine_session_activities',
    'deliberate_routine_reviews'
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
    assert.match(migration, /enable row level security/);
    assert.match(migration, /\(select auth\.uid\(\)\) = user_id/);
  }
  assert.match(migration, /routine_patterns_source_product_id_check/);
  assert.match(migration, /'rios'/);
  assert.match(migration, /on delete set null \(source_activity_id\)/);
});
