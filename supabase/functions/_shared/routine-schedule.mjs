export function partsInZone(date, timeZone) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = type => values.find(part => part.type === type)?.value || '';
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')), minute: Number(get('minute')) };
}

export function dateString(date, timeZone) {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function isoWeekday(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

function dayNumber(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function monthNumber(date) {
  const [year, month] = date.split('-').map(Number);
  return year * 12 + month - 1;
}

export function addDateDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function recurrenceMatches(routine, today, timeZone) {
  const schedule = routine.schedule_data || {};
  const interval = Math.max(1, Math.min(365, Number(schedule.interval || 1)));
  const anchor = dateString(new Date(routine.created_at || Date.now()), timeZone);
  const elapsedDays = dayNumber(today) - dayNumber(anchor);
  if (elapsedDays < 0) return false;
  if (routine.schedule_kind === 'daily') return elapsedDays % interval === 0;
  if (routine.schedule_kind === 'weekly') {
    const days = Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number) : [];
    if (!days.includes(isoWeekday(today))) return false;
    const anchorMonday = dayNumber(anchor) - (isoWeekday(anchor) - 1);
    const currentMonday = dayNumber(today) - (isoWeekday(today) - 1);
    return Math.floor((currentMonday - anchorMonday) / 7) % interval === 0;
  }
  if (routine.schedule_kind === 'monthly') {
    const selected = Array.isArray(schedule.monthDays) ? schedule.monthDays.map(Number) : [];
    return monthNumber(today) >= monthNumber(anchor) && (monthNumber(today) - monthNumber(anchor)) % interval === 0 && selected.includes(Number(today.slice(-2)));
  }
  if (routine.schedule_kind === 'custom') {
    const customInterval = Math.max(1, Math.min(365, Number(schedule.customInterval || schedule.interval || 1)));
    if (schedule.customFrequency === 'weeks') {
      const anchorMonday = dayNumber(anchor) - (isoWeekday(anchor) - 1);
      const currentMonday = dayNumber(today) - (isoWeekday(today) - 1);
      return isoWeekday(today) === isoWeekday(anchor) && Math.floor((currentMonday - anchorMonday) / 7) % customInterval === 0;
    }
    if (schedule.customFrequency === 'months') {
      return monthNumber(today) >= monthNumber(anchor) && (monthNumber(today) - monthNumber(anchor)) % customInterval === 0 && Number(today.slice(-2)) === Number(anchor.slice(-2));
    }
    return elapsedDays % customInterval === 0;
  }
  return false;
}

export function zonedInstant(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let shift = 0; shift <= 180; shift += 1) {
    const shiftedTarget = target + shift * 60000;
    let guess = shiftedTarget;
    try {
      for (let step = 0; step < 5; step += 1) {
        const local = partsInZone(new Date(guess), timeZone);
        const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
        const difference = shiftedTarget - represented;
        if (!difference) return new Date(guess);
        guess += difference;
      }
    } catch (_) { return null; }
  }
  return null;
}

function timeString(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function quietUntil(now, preferences, routineTimeZone) {
  if (!preferences?.quiet_hours_enabled) return null;
  const timeZone = preferences.timezone || routineTimeZone;
  const local = partsInZone(now, timeZone);
  const today = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const current = timeString(local.hour, local.minute);
  const start = String(preferences.quiet_hours_start || '22:00').slice(0, 5);
  const end = String(preferences.quiet_hours_end || '06:00').slice(0, 5);
  if (start === end) return null;
  let quiet = false;
  let endDate = today;
  if (start < end) quiet = current >= start && current < end;
  else if (current >= start) { quiet = true; endDate = addDateDays(today, 1); }
  else if (current < end) quiet = true;
  if (!quiet) return null;
  return zonedInstant(endDate, end, timeZone);
}

export function dueWithinGrace(scheduled, now, minutes = 15) {
  const late = now.getTime() - scheduled.getTime();
  return late >= 0 && late <= minutes * 60000;
}

export function normalizedTime(value) {
  const time = String(value || '').slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '';
}
