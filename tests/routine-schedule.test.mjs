import test from 'node:test';
import assert from 'node:assert/strict';
import { dateString, dueWithinGrace, quietUntil, recurrenceMatches, zonedInstant, partsInZone } from '../supabase/functions/_shared/routine-schedule.mjs';

const routine = (schedule_kind, schedule_data, created_at = '2026-11-02T10:00:00.000Z') => ({ schedule_kind, schedule_data, created_at });

test('daily recurrence respects interval and anchor date', () => {
  assert.equal(recurrenceMatches(routine('daily', { interval: 2 }), '2026-11-04', 'UTC'), true);
  assert.equal(recurrenceMatches(routine('daily', { interval: 2 }), '2026-11-03', 'UTC'), false);
  assert.equal(recurrenceMatches(routine('daily', { interval: 1 }), '2026-11-01', 'UTC'), false);
});

test('weekly recurrence uses selected weekdays and interval weeks', () => {
  const weekly = routine('weekly', { interval: 2, weekdays: [1, 3] }, '2026-11-04T10:00:00Z');
  assert.equal(recurrenceMatches(weekly, '2026-11-09', 'UTC'), false);
  assert.equal(recurrenceMatches(weekly, '2026-11-16', 'UTC'), true);
  assert.equal(recurrenceMatches(weekly, '2026-11-17', 'UTC'), false);
});

test('monthly recurrence selects calendar day and month interval', () => {
  const monthly = routine('monthly', { interval: 2, monthDays: [15] });
  assert.equal(recurrenceMatches(monthly, '2026-12-15', 'UTC'), false);
  assert.equal(recurrenceMatches(monthly, '2027-01-15', 'UTC'), true);
  assert.equal(recurrenceMatches(monthly, '2027-01-14', 'UTC'), false);
});

test('custom day, week and month recurrence options are evaluated', () => {
  assert.equal(recurrenceMatches(routine('custom', { customFrequency: 'days', customInterval: 3 }), '2026-11-05', 'UTC'), true);
  assert.equal(recurrenceMatches(routine('custom', { customFrequency: 'days', customInterval: 3 }), '2026-11-04', 'UTC'), false);
  assert.equal(recurrenceMatches(routine('custom', { customFrequency: 'weeks', customInterval: 2 }, '2026-11-02T12:00:00Z'), '2026-11-16', 'UTC'), true);
  assert.equal(recurrenceMatches(routine('custom', { customFrequency: 'months', customInterval: 2 }), '2027-01-02', 'UTC'), true);
});

test('scheduled time converts through daylight-saving boundaries', () => {
  const springGap = zonedInstant('2026-03-08', '02:30', 'America/New_York');
  assert.ok(springGap);
  assert.deepEqual(partsInZone(springGap, 'America/New_York'), { year: 2026, month: 3, day: 8, hour: 3, minute: 0 });
  const fallBack = zonedInstant('2026-11-01', '01:30', 'America/New_York');
  assert.deepEqual(partsInZone(fallBack, 'America/New_York'), { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  assert.equal(dateString(fallBack, 'America/New_York'), '2026-11-01');
});

test('quiet hours defer reminders to their local end across midnight', () => {
  const preferences = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '06:00', timezone: 'UTC' };
  assert.equal(quietUntil(new Date('2026-11-10T23:30:00Z'), preferences, 'UTC')?.toISOString(), '2026-11-11T06:00:00.000Z');
  assert.equal(quietUntil(new Date('2026-11-11T05:30:00Z'), preferences, 'UTC')?.toISOString(), '2026-11-11T06:00:00.000Z');
  assert.equal(quietUntil(new Date('2026-11-11T12:00:00Z'), preferences, 'UTC'), null);
});

test('scheduler grace window is bounded and dedupe is handled separately by event key', () => {
  const scheduled = new Date('2026-11-10T06:00:00Z');
  assert.equal(dueWithinGrace(scheduled, new Date('2026-11-10T06:10:00Z'), 15), true);
  assert.equal(dueWithinGrace(scheduled, new Date('2026-11-10T06:16:00Z'), 15), false);
  assert.equal(dueWithinGrace(scheduled, new Date('2026-11-10T05:59:00Z'), 15), false);
});
