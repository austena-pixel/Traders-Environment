import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';
import { addDateDays, dateString, dueWithinGrace, normalizedTime, quietUntil, recurrenceMatches, zonedInstant } from '../_shared/routine-schedule.mjs';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-routine-scheduler-secret',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};
const EVENT_TABLE = 'deliberate_routine_notification_events';
const PREFS_TABLE = 'deliberate_routine_notification_preferences';
const SUBSCRIPTIONS_TABLE = 'deliberate_routine_push_subscriptions';
const DELIVERY_TABLE = 'deliberate_routine_notification_deliveries';
const MAX_SCHEDULE_LATE_MINUTES = 15;
const MAX_SCHEDULE_CATCHUP_MINUTES = 1440;
const SUPPORTED_REMINDER_KINDS = ['start', 'review'];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

function env(name, required = true) {
  const value = Deno.env.get(name) || '';
  if (required && !value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function dbClient(key) {
  return createClient(env('SUPABASE_URL'), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function eventText(kind, routineName) {
  if (kind === 'review') {
    return {
      title: /^morning/i.test(routineName) ? 'R-IOS — Morning Review' : `R-IOS — ${routineName} Review`,
      body: `Your ${routineName.toLowerCase()} has reached its scheduled end. Review your execution.`
    };
  }
  if (kind === 'follow_up') return { title: `R-IOS — ${routineName}`, body: 'A gentle reminder to begin, if this still fits your plan.' };
  return { title: `R-IOS — ${routineName}`, body: `Your ${routineName.toLowerCase()} is ready. Open your checklist to begin.` };
}

async function getPreferences(service, userIds) {
  if (!userIds.length) return new Map();
  const result = new Map();
  const uniqueUsers = [...new Set(userIds)];
  for (let index = 0; index < uniqueUsers.length; index += 400) {
    const { data, error } = await service.from(PREFS_TABLE).select('*').in('user_id', uniqueUsers.slice(index, index + 400));
    if (error) throw error;
    for (const row of data || []) result.set(row.user_id, row);
  }
  return result;
}

async function insertOccurrence(service, routine, preferences, kind, time, localDate, now, silentStart = false) {
  const timeZone = routine.timezone || preferences?.timezone || 'UTC';
  const scheduled = zonedInstant(localDate, time, timeZone);
  if (!scheduled || !dueWithinGrace(scheduled, now, MAX_SCHEDULE_CATCHUP_MINUTES)) return null;
  const deferred = quietUntil(now, preferences, timeZone);
  const deliveryTime = deferred && deferred.getTime() > scheduled.getTime() ? deferred : scheduled;
  const stalePush = deliveryTime.getTime() <= now.getTime() && dueWithinGrace(scheduled, now, MAX_SCHEDULE_CATCHUP_MINUTES) && now.getTime() - scheduled.getTime() > MAX_SCHEDULE_LATE_MINUTES * 60000;
  let sessionId = null;
  if (kind === 'review') {
    const { data: sessions, error: sessionError } = await service.from('deliberate_routine_sessions')
      .select('id,status,actual_started_at,created_at').eq('user_id', routine.user_id).eq('routine_id', routine.id)
      .eq('scheduled_for', localDate).order('created_at', { ascending: false }).limit(1);
    if (sessionError) throw sessionError;
    sessionId = sessions?.[0]?.id || null;
  }
  const identity = `${routine.id}:${kind}:${localDate}:${time}`;
  const text = eventText(kind, routine.name || 'Routine');
  const reminderSettings = routine.schedule_data?.notifications || {};
  const row = {
    user_id: routine.user_id, routine_id: routine.id, session_id: sessionId,
    occurrence_key: identity, event_kind: kind, scheduled_at: deliveryTime.toISOString(),
    local_date: localDate, local_time: time, timezone: timeZone, routine_name: routine.name,
    title: text.title, body: text.body, auto_popup: silentStart ? false : reminderSettings.autoPopup !== false,
    in_app_state: silentStart ? 'opened' : 'pending',
    follow_up_due_at: kind === 'start' && reminderSettings.followUp?.enabled
      ? new Date(scheduled.getTime() + Math.max(5, Number(reminderSettings.followUp.delayMinutes || 15)) * 60000).toISOString()
      : null,
    push_state: silentStart || stalePush ? 'suppressed' : 'pending',
    push_dispatched_at: silentStart || stalePush ? now.toISOString() : null,
    push_error: stalePush ? 'Server recovery exceeded the device push grace period; the in-app reminder was retained.' : '',
    updated_at: now.toISOString()
  };
  const { data, error } = await service.from(EVENT_TABLE).insert(row).select('*').maybeSingle();
  if (error?.code === '23505') return null;
  if (error) throw error;
  return data;
}

async function createDueOccurrences(service, now) {
  const rows = [];
  for (let offset = 0; offset < 50000; offset += 500) {
    const { data, error } = await service.from('deliberate_routines').select('*').eq('status', 'active').order('created_at').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  const preferences = await getPreferences(service, rows.map(row => row.user_id));
  let created = 0;
  for (const routine of rows) {
    const reminder = routine.schedule_data?.notifications;
    if (!reminder?.enabled) continue;
    const prefs = preferences.get(routine.user_id);
    if (prefs?.enabled === false) continue;
    const timeZone = routine.timezone || prefs?.timezone || 'UTC';
    let today = '';
    try { today = dateString(now, timeZone); } catch (_) { continue; }
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
      const localDate = addDateDays(today, -dayOffset);
      if (!recurrenceMatches(routine, localDate, timeZone)) continue;
      for (const kind of SUPPORTED_REMINDER_KINDS) {
        const rule = kind === 'start' ? reminder.start : reminder.review;
        const silentStart = kind === 'start' && !rule?.enabled && reminder.followUp?.enabled;
        if (!rule?.enabled && !silentStart) continue;
        const time = normalizedTime(rule?.time || (kind === 'start' ? routine.start_time : routine.end_time));
        if (!time) continue;
        if (await insertOccurrence(service, routine, prefs, kind, time, localDate, now, silentStart)) created += 1;
      }
    }
  }
  return created;
}

async function createDueFollowUps(service, now) {
  const { data: starts, error } = await service.from(EVENT_TABLE).select('*').eq('event_kind', 'start')
    .is('follow_up_dispatched_at', null).lte('follow_up_due_at', now.toISOString()).not('follow_up_due_at', 'is', null).limit(500);
  if (error) throw error;
  let created = 0;
  for (const start of starts || []) {
    const { data: routine } = await service.from('deliberate_routines').select('*').eq('id', start.routine_id).eq('user_id', start.user_id).maybeSingle();
    if (start.in_app_state !== 'dismissed' && routine?.status === 'active' && routine.schedule_data?.notifications?.enabled && routine.schedule_data?.notifications?.followUp?.enabled) {
      const { data: sessions, error: sessionError } = await service.from('deliberate_routine_sessions').select('id,status')
        .eq('user_id', start.user_id).eq('routine_id', start.routine_id).eq('scheduled_for', start.local_date).limit(10);
      if (sessionError) throw sessionError;
      const hasSession = (sessions || []).some(session => ['in_progress', 'interrupted', 'completed', 'partially_completed', 'missed'].includes(session.status));
      if (!hasSession) {
        const preferences = (await getPreferences(service, [start.user_id])).get(start.user_id);
        if (preferences?.enabled !== false) {
          const due = new Date(start.follow_up_due_at);
          if (start.in_app_state === 'snoozed' && start.snoozed_until && new Date(start.snoozed_until) > due) due.setTime(new Date(start.snoozed_until).getTime());
          const deferred = quietUntil(now, preferences, start.timezone);
          const scheduled = deferred && deferred.getTime() > due.getTime() ? deferred : due;
          const message = eventText('follow_up', start.routine_name);
          const row = {
            user_id: start.user_id, routine_id: start.routine_id, occurrence_key: `${start.occurrence_key}:follow-up`,
            event_kind: 'follow_up', scheduled_at: scheduled.toISOString(), local_date: start.local_date,
            local_time: start.local_time, timezone: start.timezone, routine_name: start.routine_name,
            title: message.title, body: message.body, auto_popup: start.auto_popup, updated_at: now.toISOString()
          };
          const result = await service.from(EVENT_TABLE).insert(row).select('id').maybeSingle();
          if (result.error && result.error.code !== '23505') throw result.error;
          if (result.data) created += 1;
        }
      }
    }
    const { error: markError } = await service.from(EVENT_TABLE).update({ follow_up_dispatched_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', start.id).eq('user_id', start.user_id);
    if (markError) throw markError;
  }
  return created;
}

function pushPayload(event) {
  const appBase = env('RIOS_APP_URL', false) || 'https://traders-environment-j.vercel.app';
  const url = new URL('/r-ios.html', appBase);
  url.searchParams.set('routine', event.routine_id);
  url.searchParams.set('event', event.id);
  url.searchParams.set('date', event.local_date);
  return JSON.stringify({
    title: event.title, body: event.body, eventId: event.id,
    tag: `rios-routine-${event.id}`, timestamp: new Date(event.scheduled_at).getTime(),
    url: url.toString()
  });
}

function configureWebPush() {
  webPush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
}

async function dispatchPending(service, now) {
  const { data: events, error } = await service.from(EVENT_TABLE).select('*').is('push_dispatched_at', null)
    .lte('scheduled_at', now.toISOString()).order('scheduled_at').limit(200);
  if (error) throw error;
  for (const event of events || []) {
    const preferences = (await getPreferences(service, [event.user_id])).get(event.user_id);
    if (preferences?.enabled === false) {
      await service.from(EVENT_TABLE).update({ push_state: 'suppressed', push_dispatched_at: now.toISOString(), in_app_state: 'dismissed', updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    if (now.getTime() - new Date(event.scheduled_at).getTime() > MAX_SCHEDULE_LATE_MINUTES * 60000) {
      await service.from(EVENT_TABLE).update({ push_state: 'suppressed', push_dispatched_at: now.toISOString(), push_error: 'Notification became too old for push delivery; the in-app reminder remains available.', updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    const deferred = quietUntil(now, preferences, event.timezone);
    if (deferred && deferred.getTime() > now.getTime()) {
      await service.from(EVENT_TABLE).update({ scheduled_at: deferred.toISOString(), updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    const { data: routine, error: routineError } = await service.from('deliberate_routines').select('status,schedule_data')
      .eq('id', event.routine_id).eq('user_id', event.user_id).maybeSingle();
    if (routineError) throw routineError;
    if (!routine || routine.status !== 'active' || !routine.schedule_data?.notifications?.enabled) {
      await service.from(EVENT_TABLE).update({ push_state: 'suppressed', push_dispatched_at: now.toISOString(), in_app_state: 'dismissed', updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    if (event.event_kind === 'follow_up') {
      const { data: sessions, error: sessionError } = await service.from('deliberate_routine_sessions').select('id,status')
        .eq('user_id', event.user_id).eq('routine_id', event.routine_id).eq('scheduled_for', event.local_date).limit(10);
      if (sessionError) throw sessionError;
      if ((sessions || []).some(session => ['in_progress', 'interrupted', 'completed', 'partially_completed', 'missed'].includes(session.status))) {
        await service.from(EVENT_TABLE).update({ push_state: 'suppressed', push_dispatched_at: now.toISOString(), in_app_state: 'dismissed', updated_at: now.toISOString() }).eq('id', event.id);
        continue;
      }
    }
    const { data: subscriptions, error: subscriptionError } = await service.from(SUBSCRIPTIONS_TABLE).select('*')
      .eq('user_id', event.user_id).eq('active', true);
    if (subscriptionError) throw subscriptionError;
    if (!subscriptions?.length) {
      await service.from(EVENT_TABLE).update({ push_state: 'no_device', push_dispatched_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    const activeAppAlreadyHandling = event.auto_popup && subscriptions.some(subscription => {
      const lastSeenAt = new Date(subscription.last_seen_at || 0).getTime();
      return Number.isFinite(lastSeenAt) && now.getTime() - lastSeenAt < 90000;
    });
    if (activeAppAlreadyHandling) {
      await service.from(EVENT_TABLE).update({ push_state: 'suppressed', push_dispatched_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', event.id);
      continue;
    }
    let sent = 0;
    let allDone = true;
    for (const subscription of subscriptions) {
      const { data: previous, error: previousError } = await service.from(DELIVERY_TABLE).select('*')
        .eq('event_id', event.id).eq('subscription_id', subscription.id).maybeSingle();
      if (previousError) throw previousError;
      if (previous?.status === 'sent' || previous?.status === 'expired' || Number(previous?.attempt_count || 0) >= 3) {
        if (previous?.status === 'sent') sent += 1;
        continue;
      }
      const attempt = Number(previous?.attempt_count || 0) + 1;
      const attemptedAt = now.toISOString();
      try {
        const result = await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, pushPayload(event), { TTL: 1800, urgency: 'normal' });
        sent += 1;
        await service.from(DELIVERY_TABLE).upsert({
          user_id: event.user_id, event_id: event.id, subscription_id: subscription.id,
          status: 'sent', attempt_count: attempt, http_status: result.statusCode || 201,
          error_text: '', attempted_at: attemptedAt, delivered_at: attemptedAt, updated_at: attemptedAt
        }, { onConflict: 'event_id,subscription_id' });
        await service.from(SUBSCRIPTIONS_TABLE).update({ last_delivery_at: attemptedAt, last_error: '', updated_at: attemptedAt }).eq('id', subscription.id);
      } catch (deliveryError) {
        const status = Number(deliveryError?.statusCode || deliveryError?.status || 0);
        const expired = status === 404 || status === 410;
        allDone = false;
        await service.from(DELIVERY_TABLE).upsert({
          user_id: event.user_id, event_id: event.id, subscription_id: subscription.id,
          status: expired ? 'expired' : 'failed', attempt_count: attempt, http_status: status || null,
          error_text: String(deliveryError?.message || deliveryError).slice(0, 1000), attempted_at: attemptedAt, updated_at: attemptedAt
        }, { onConflict: 'event_id,subscription_id' });
        await service.from(SUBSCRIPTIONS_TABLE).update({ active: !expired, last_error: String(deliveryError?.message || deliveryError).slice(0, 1000), updated_at: attemptedAt }).eq('id', subscription.id);
        if (attempt >= 3 || expired) allDone = true;
      }
    }
    if (allDone) {
      await service.from(EVENT_TABLE).update({
        push_state: sent ? 'sent' : 'failed', push_dispatched_at: now.toISOString(),
        push_error: sent ? '' : 'No push endpoint accepted this notification after the available retries.', updated_at: now.toISOString()
      }).eq('id', event.id);
    }
  }
  return (events || []).length;
}

async function runScheduler() {
  const service = dbClient(env('SUPABASE_SERVICE_ROLE_KEY'));
  const now = new Date();
  const created = await createDueOccurrences(service, now);
  const followUps = await createDueFollowUps(service, now);
  let pushError = '';
  try { configureWebPush(); await dispatchPending(service, now); }
  catch (error) { pushError = String(error?.message || error); }
  return { ok: true, checked_at: now.toISOString(), created, follow_ups: followUps, push_error: pushError || undefined };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (request.method === 'GET') {
      const publicKey = env('VAPID_PUBLIC_KEY', false);
      return publicKey ? response({ publicKey }) : response({ error: 'Web Push has not been configured for this environment.' }, 503);
    }
    if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
    const schedulerSecret = env('RIOS_SCHEDULER_SECRET', false);
    if (schedulerSecret && request.headers.get('x-routine-scheduler-secret') === schedulerSecret) return response(await runScheduler());
    return response({ error: 'Unauthorized scheduler request.' }, 401);
  } catch (error) {
    console.error('R-IOS routine notification function failed:', error);
    return response({ error: String(error?.message || error) }, 500);
  }
});
