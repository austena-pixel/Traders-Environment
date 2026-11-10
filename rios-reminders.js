(function registerRIOSRoutineReminders(root) {
  'use strict';

  const SUPABASE_URL = 'https://tmxosoyqflmwqzjgnkez.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_meHq49fLyw8PVNPZxWacnw_SQMj5B-h';
  const EVENTS_TABLE = 'deliberate_routine_notification_events';
  const SUBSCRIPTIONS_TABLE = 'deliberate_routine_push_subscriptions';
  const DEVICE_KEY = 'rios_push_device_id_v1';
  const TAB_CLAIM_KEY = 'rios_reminder_popup_claim_v1';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/rios-routine-notifications`;
  const state = { db: null, user: null, mode: '', showNotice: null, pollTimer: null, heartbeatTimer: null, openEvent: null, working: false, busy: false, eventsBound: false, channel: null, serviceWorker: null };
  const $ = selector => root.document?.querySelector(selector) || null;
  const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const dateLabel = value => {
    const date = value ? (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value)) : new Date();
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date) : '';
  };
  const timeLabel = value => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';

  function deviceId() {
    let id = root.localStorage?.getItem(DEVICE_KEY);
    if (!id) {
      id = root.crypto?.randomUUID?.();
      if (!id) return '';
      root.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function notice(message, tone = 'info') {
    if (typeof state.showNotice === 'function' && state.mode === 'rios') state.showNotice(message, tone);
    else if (message) console.info(`[R-IOS reminders] ${message}`);
  }

  function installStyles() {
    if ($('#riosReminderStyles')) return;
    const style = root.document.createElement('style');
    style.id = 'riosReminderStyles';
    style.textContent = `
      .rios-reminder-shade{position:fixed;inset:0;z-index:10050;background:rgba(3,8,12,.78);backdrop-filter:blur(8px);display:grid;place-items:center;padding:16px}
      .rios-reminder-card{width:min(680px,100%);max-height:min(88vh,900px);overflow:auto;border:1px solid rgba(112,223,183,.26);border-radius:18px;background:#0f171d;color:#f0f5f7;box-shadow:0 24px 80px rgba(0,0,0,.5);padding:22px;font:inherit}
      .rios-reminder-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.rios-reminder-kicker{margin:0 0 6px;color:#70dfb7;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.rios-reminder-card h2{margin:0;font-size:clamp(20px,4vw,28px)}.rios-reminder-meta{margin:7px 0 0;color:#9eabb4;font-size:12px}.rios-reminder-close{border:1px solid #31404a;border-radius:9px;background:#141f27;color:#dce6ea;font-size:20px;width:38px;height:38px;cursor:pointer;flex:0 0 auto}
      .rios-reminder-purpose{margin:18px 0;padding:13px 14px;border:1px solid #263943;border-radius:12px;background:#0c1419;color:#c8d7dc;font-size:13px;line-height:1.55}.rios-reminder-progress{display:flex;justify-content:space-between;gap:12px;color:#abb9c1;font-size:12px;margin:14px 0 7px}.rios-reminder-track{height:7px;border-radius:99px;background:#202d34;overflow:hidden}.rios-reminder-track span{display:block;height:100%;background:linear-gradient(90deg,#38c798,#8ff0c7);border-radius:inherit;transition:width .2s}
      .rios-reminder-list{display:grid;gap:9px;margin:15px 0}.rios-reminder-item{padding:12px;border:1px solid #27343d;border-radius:12px;background:#121c23}.rios-reminder-item.group{background:#10191f;border-color:#31434b;padding:10px 12px}.rios-reminder-item.group b{color:#9edfc6;font-size:12px}.rios-reminder-item.child{margin-left:16px}.rios-reminder-item-top{display:flex;align-items:flex-start;gap:9px}.rios-reminder-item-top b{font-size:13px;line-height:1.4;flex:1}.rios-reminder-item-top small{color:#8c9ca5;font-size:10px;text-align:right}.rios-reminder-state{color:#89daba;font-size:10px}.rios-reminder-notes{width:100%;min-height:54px;margin-top:9px;padding:9px 10px;resize:vertical;border:1px solid #2c3b45;border-radius:8px;background:#091116;color:#e7f0f1;font:inherit;font-size:12px}.rios-reminder-item-actions,.rios-reminder-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.rios-reminder-button{min-height:38px;padding:8px 12px;border:1px solid #31434b;border-radius:9px;background:#15212a;color:#e7f0f1;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.rios-reminder-button:hover{border-color:#70dfb7}.rios-reminder-button.primary{color:#04140e;background:#70dfb7;border-color:#70dfb7}.rios-reminder-button.quiet{color:#aab8bd}.rios-reminder-button:disabled{opacity:.55;cursor:wait}.rios-reminder-empty{padding:14px;border:1px dashed #34434b;border-radius:10px;color:#aab8bd;font-size:12px;line-height:1.5}.rios-reminder-banner{position:fixed;z-index:10040;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));display:flex;align-items:center;gap:12px;padding:12px;border:1px solid rgba(112,223,183,.35);border-radius:12px;background:#0f191f;color:#eef6f4;box-shadow:0 10px 40px #0009;font:inherit}.rios-reminder-banner div{flex:1}.rios-reminder-banner b{display:block;font-size:12px}.rios-reminder-banner small{color:#a4b1b7;font-size:10px}.rios-reminder-queued{margin:12px 0 0;color:#95a7ad;font-size:11px}
      @media(max-width:560px){.rios-reminder-shade{padding:8px;align-items:end}.rios-reminder-card{max-height:94vh;border-radius:16px 16px 10px 10px;padding:16px}.rios-reminder-item.child{margin-left:8px}.rios-reminder-banner{right:8px;bottom:8px;width:calc(100vw - 16px)}}`;
    root.document.head.appendChild(style);
  }

  function mountUi() {
    installStyles();
    if (!$('#riosReminderShade')) {
      root.document.body.insertAdjacentHTML('beforeend', `<div id="riosReminderHost"></div>`);
    }
  }

  async function ensureServiceWorker() {
    if (!root.navigator?.serviceWorker || !root.isSecureContext) throw new Error('This browser does not support secure service worker notifications.');
    if (!state.serviceWorker) state.serviceWorker = await root.navigator.serviceWorker.register('/rios-service-worker.js', { scope: '/' });
    await root.navigator.serviceWorker.ready;
    return state.serviceWorker;
  }

  function permissionLabel() {
    const host = $('#drNotificationPermission');
    if (!host) return;
    if (!('Notification' in root)) host.textContent = 'This browser does not support device notifications.';
    else if (root.Notification.permission === 'granted') host.textContent = 'Device notification permission is enabled.';
    else if (root.Notification.permission === 'denied') host.textContent = 'Notifications are blocked in browser settings. Change the permission there to re-enable them.';
    else host.textContent = 'Device notification permission has not been requested.';
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = root.atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function getVapidPublicKey() {
    const response = await root.fetch(FUNCTION_URL, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.publicKey) throw new Error(payload.error || 'Push delivery has not been configured on the R-IOS server yet.');
    return payload.publicKey;
  }

  async function enablePush() {
    if (!state.user || !state.db) return notice('Sign in to H-IOS before enabling routine reminders.', 'warning');
    if (!('Notification' in root) || !root.navigator?.serviceWorker || !root.PushManager) return notice('This browser does not support Web Push. In-app reminders remain available while R-IOS is open.', 'warning');
    if (/iPhone|iPad|iPod/i.test(root.navigator.userAgent) && !root.navigator.standalone && !root.matchMedia('(display-mode: standalone)').matches) {
      return notice('On iPhone or iPad, add H-IOS to the Home Screen and open it there before enabling Web Push.', 'warning');
    }
    let permission = root.Notification.permission;
    if (permission === 'default') permission = await root.Notification.requestPermission();
    permissionLabel();
    if (permission !== 'granted') return notice('Notification permission was not granted. You can change it in your browser settings.', 'warning');
    try {
      const registration = await ensureServiceWorker();
      const publicKey = await getVapidPublicKey();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = subscription.toJSON();
      const { error } = await state.db.from(SUBSCRIPTIONS_TABLE).upsert({
        user_id: state.user.id, device_id: deviceId(), endpoint: json.endpoint,
        p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: root.navigator.userAgent.slice(0, 500),
        active: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,device_id' });
      if (error) throw error;
      notice('Push notifications are enabled for this device.', 'good');
      permissionLabel();
    } catch (error) {
      console.error('Could not enable R-IOS push notifications:', error);
      notice(error.message || 'Could not register this device for routine notifications.', 'error');
    }
  }

  async function disablePush() {
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return notice('There is no active R-IOS push subscription on this device.', 'info');
      await subscription.unsubscribe();
      if (state.db && state.user) {
        const { error } = await state.db.from(SUBSCRIPTIONS_TABLE).update({ active: false, updated_at: new Date().toISOString() })
          .eq('user_id', state.user.id).eq('device_id', deviceId());
        if (error) throw error;
      }
      notice('Push notifications are disabled for this device. In-app reminders are unchanged.', 'good');
    } catch (error) {
      console.error('Could not disable R-IOS push notifications:', error);
      notice(error.message || 'Could not disable this device subscription.', 'error');
    }
  }

  async function heartbeatDevice() {
    if (!state.db || !state.user) return;
    const id = deviceId();
    if (!id) return;
    await state.db.from(SUBSCRIPTIONS_TABLE).update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('device_id', id).eq('active', true);
    if (state.openEvent && !state.openEvent.synthetic) {
      const until = new Date(Date.now() + 120000).toISOString();
      await state.db.from(EVENTS_TABLE).update({ in_app_claim_until: until, updated_at: new Date().toISOString() })
        .eq('user_id', state.user.id).eq('id', state.openEvent.id).eq('in_app_claim_device_id', id).eq('in_app_state', 'shown');
    }
  }

  async function testPush() {
    if (!state.user || !state.db) return notice('Sign in to H-IOS before testing a notification.', 'warning');
    try {
      if (!('Notification' in root) || root.Notification.permission !== 'granted') return notice('Enable notifications on this device first.', 'warning');
      const registration = await ensureServiceWorker();
      await registration.showNotification('R-IOS — Test notification', {
        body: 'Device notifications are working on this browser.',
        tag: `rios-test-${deviceId()}`, renotify: false,
        data: { url: `${root.location.origin}/r-ios.html` }
      });
      notice('A test notification was displayed on this device.', 'good');
    } catch (error) {
      notice(error.message || 'Push testing is not available yet.', 'warning');
    }
  }

  function isCriticalInteraction() {
    if (root.document.querySelector('dialog[open], [data-critical-operation="true"]')) return true;
    const active = root.document.activeElement;
    return Boolean(active?.matches?.('input, textarea, select, [contenteditable="true"]'));
  }

  function activityStatusText(row) {
    return ({ pending: 'Not recorded', in_progress: 'In progress', completed: 'Completed', partial: 'Partially completed', skipped: 'Skipped' })[row.status] || 'Not recorded';
  }

  function isQuietNow(preferences, fallbackZone) {
    if (!preferences?.quiet_hours_enabled) return false;
    try {
      const timeZone = preferences.timezone || fallbackZone || 'UTC';
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const current = `${parts.find(part => part.type === 'hour')?.value}:${parts.find(part => part.type === 'minute')?.value}`;
      const start = String(preferences.quiet_hours_start || '22:00').slice(0, 5);
      const end = String(preferences.quiet_hours_end || '06:00').slice(0, 5);
      if (start === end) return false;
      return start < end ? current >= start && current < end : current >= start || current < end;
    } catch (_) { return false; }
  }

  function activityMarkup(row, editable) {
    if (row.activity_kind === 'group') return `<div class="rios-reminder-item group"><b>${escapeHtml(row.title || row.activity_title)}</b></div>`;
    const title = row.title || row.activity_title || 'Activity';
    const status = row.status || 'pending';
    const planned = [row.start_time || row.planned_start_time, row.duration_minutes || row.planned_duration_minutes ? `${row.duration_minutes || row.planned_duration_minutes} min` : ''].filter(Boolean).join(' · ');
    const note = row.execution_note || '';
    const child = row.parent_activity_id || row.parent_activity_key ? ' child' : '';
    const canEdit = editable && !['completed', 'partially_completed', 'missed'].includes(state.openEvent?.session?.status);
    const id = row.id;
    return `<article class="rios-reminder-item${child}" data-checklist-item="${escapeHtml(id)}"><div class="rios-reminder-item-top"><b>${escapeHtml(title)}</b><small>${escapeHtml(planned || activityStatusText(row))}</small></div>
      ${row.completion_criteria ? `<div class="rios-reminder-meta">${escapeHtml(row.completion_criteria)}</div>` : ''}
      ${row.instructions ? `<div class="rios-reminder-meta">${escapeHtml(row.instructions)}</div>` : ''}
      ${state.openEvent?.session ? `<div class="rios-reminder-meta">Status: <span class="rios-reminder-state">${escapeHtml(activityStatusText(row))}</span>${row.actual_completed_at ? ` · Recorded ${escapeHtml(timeLabel(row.actual_completed_at))}` : ''}</div>` : ''}
      ${canEdit ? `<textarea class="rios-reminder-notes" data-checklist-note="${escapeHtml(id)}" maxlength="1000" placeholder="Optional execution note">${escapeHtml(note)}</textarea><details class="rios-reminder-resistance"><summary>Optional psychological resistance record</summary><div><label>Did resistance occur?<select data-resistance="occurred"><option value="">Not recorded</option><option value="no" ${row.resistance_occurred === false ? 'selected' : ''}>No</option><option value="yes" ${row.resistance_occurred === true ? 'selected' : ''}>Yes</option></select></label><label>Intensity (0–10)<input data-resistance="intensity" type="number" min="0" max="10" step="1" value="${escapeHtml(row.resistance_intensity ?? '')}"></label><label>What did you notice?<input data-resistance="nature" maxlength="240" value="${escapeHtml(row.resistance_nature || '')}" placeholder="Your words, not an assumption"></label><label>Did it influence execution?<select data-resistance="influenced"><option value="">Not recorded</option><option value="no" ${row.resistance_influenced_execution === false ? 'selected' : ''}>No</option><option value="yes" ${row.resistance_influenced_execution === true ? 'selected' : ''}>Yes</option></select></label><label>How did you respond?<input data-resistance="response" maxlength="300" value="${escapeHtml(row.resistance_response || '')}"></label></div></details><div class="rios-reminder-item-actions"><button class="rios-reminder-button" type="button" data-reminder-action="activity" data-id="${escapeHtml(id)}" data-status="completed">Complete</button><button class="rios-reminder-button" type="button" data-reminder-action="activity" data-id="${escapeHtml(id)}" data-status="partial">Partial</button><button class="rios-reminder-button quiet" type="button" data-reminder-action="activity" data-id="${escapeHtml(id)}" data-status="skipped">Skip</button></div>` : ''}</article>`;
  }

  function claimThisTab(eventId) {
    if (state.channel) {
      try { state.channel.postMessage({ type: 'reminder-open', eventId, tab: deviceId() }); } catch (_) {}
    }
    try {
      const claim = JSON.parse(root.localStorage.getItem(TAB_CLAIM_KEY) || '{}');
      if (claim.eventId === eventId && claim.until > Date.now() && claim.tab !== deviceId()) return false;
      root.localStorage.setItem(TAB_CLAIM_KEY, JSON.stringify({ eventId, until: Date.now() + 120000, tab: deviceId() }));
    } catch (_) {}
    return true;
  }

  async function updateEvent(event, values) {
    if (!state.user || !event?.id) return;
    if (event.synthetic) { Object.assign(event, values); return; }
    const { error } = await state.db.from(EVENTS_TABLE).update({ ...values, updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', event.id);
    if (error) throw error;
    Object.assign(event, values);
  }

  async function claimOccurrence(event, force = false) {
    if (event.synthetic) return true;
    const now = new Date();
    const nowText = now.toISOString();
    let query = state.db.from(EVENTS_TABLE).update({
      in_app_state: 'shown', in_app_claim_device_id: deviceId(),
      in_app_claim_until: new Date(now.getTime() + 120000).toISOString(),
      shown_at: nowText, updated_at: nowText
    }).eq('user_id', state.user.id).eq('id', event.id);
    if (!force) {
      if (event.in_app_state === 'pending') query = query.eq('in_app_state', 'pending');
      else if (event.in_app_state === 'snoozed') query = query.eq('in_app_state', 'snoozed').lte('snoozed_until', nowText);
      else if (event.in_app_state === 'shown') query = query.eq('in_app_state', 'shown').or(`in_app_claim_until.is.null,in_app_claim_until.lt.${nowText}`);
      else return false;
    }
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) return false;
    Object.assign(event, data);
    return true;
  }

  async function waitForRoutineStorage(api) {
    for (let attempt = 0; attempt < 20 && !api.isReady?.(); attempt += 1) {
      await api.refresh();
      if (api.isReady?.()) break;
      await new Promise(resolve => root.setTimeout(resolve, 250));
    }
  }

  function renderReminder(event) {
    state.openEvent = event;
    const host = $('#riosReminderHost');
    if (!host) return;
    const data = event.checklist || {};
    const routine = data.routine;
    const session = data.session;
    const activities = data.activities || [];
    const activityRows = activities.filter(row => row.activity_kind !== 'group');
    const done = activityRows.filter(row => ['completed', 'partial', 'skipped'].includes(row.status)).length;
    const percent = activityRows.length ? Math.round(done * 100 / activityRows.length) : 0;
    const heading = event.event_kind === 'review' ? `${routine?.name || 'Routine'} review` : routine?.name || 'Routine checklist';
    const subtitle = `${dateLabel(event.scheduled_at || event.local_date)}${event.local_time ? ` · ${escapeHtml(event.local_time)}` : ''}`;
    const eventCopy = event.event_kind === 'review'
      ? 'Your routine has reached its scheduled end. Review the execution evidence you recorded.'
      : event.event_kind === 'follow_up'
        ? 'A gentle reminder to begin, if this still fits your plan.'
        : 'Your routine is ready. Open your checklist to begin.';
    const canStart = routine && routine.status === 'active' && event.event_kind !== 'review' && !session;
    const canResume = session && ['in_progress', 'interrupted'].includes(session.status);
    const completed = session && ['completed', 'partially_completed', 'missed'].includes(session.status);
    const title = routine?.purpose || routine?.description || 'Your plan describes what you intend to do. Execution records capture what you actually did.';
    host.innerHTML = `<div class="rios-reminder-shade" role="presentation"><section class="rios-reminder-card" role="dialog" aria-modal="true" aria-labelledby="riosReminderTitle"><div class="rios-reminder-head"><div><p class="rios-reminder-kicker">R-IOS · ${event.event_kind === 'review' ? 'Execution review' : 'Routine checklist'}</p><h2 id="riosReminderTitle">${escapeHtml(heading)}</h2><p class="rios-reminder-meta">${subtitle}</p></div><button class="rios-reminder-close" type="button" data-reminder-action="close" aria-label="Close checklist">×</button></div>
      <p class="rios-reminder-purpose">${escapeHtml(eventCopy)}<br><br>${escapeHtml(title)}</p>
      ${activityRows.length ? `<div class="rios-reminder-progress"><span>${done} of ${activityRows.length} activities recorded</span><b>${percent}%</b></div><div class="rios-reminder-track" aria-label="${percent}% complete"><span style="width:${percent}%"></span></div><div class="rios-reminder-list">${activities.map(row => activityMarkup(row, Boolean(session) && !completed)).join('')}</div>` : `<div class="rios-reminder-empty">This routine has no activities yet. Open Deliberate Routines to add its checklist.</div>`}
      ${event.event_kind === 'review' && !session ? `<div class="rios-reminder-empty">No execution session has been recorded for this scheduled date. R-IOS does not create a missed session automatically.</div>` : ''}
      <div class="rios-reminder-actions">${canStart ? `<button class="rios-reminder-button primary" type="button" data-reminder-action="start">Start routine</button>` : ''}${canResume ? `<button class="rios-reminder-button primary" type="button" data-reminder-action="resume">${session.status === 'interrupted' ? 'Resume routine' : 'Continue routine'}</button>` : ''}${completed ? `<span class="rios-reminder-button quiet">Session ${escapeHtml(session.status.replaceAll('_', ' '))}</span>` : ''}${session && !completed ? `<button class="rios-reminder-button primary" type="button" data-reminder-action="finish">Complete and close</button>` : ''}<button class="rios-reminder-button quiet" type="button" data-reminder-action="snooze">Remind me in 10 minutes</button><button class="rios-reminder-button quiet" type="button" data-reminder-action="dismiss">Dismiss</button></div>
      ${state.queueCount > 1 ? `<p class="rios-reminder-queued">${state.queueCount - 1} more routine reminder${state.queueCount === 2 ? '' : 's'} in your queue.</p>` : ''}</section></div>`;
    host.querySelector('[data-reminder-action="close"]')?.focus();
  }

  function hideReminder() {
    const host = $('#riosReminderHost');
    if (host) host.innerHTML = '';
    state.openEvent = null;
    state.busy = false;
    try { const claim = JSON.parse(root.localStorage.getItem(TAB_CLAIM_KEY) || '{}'); if (claim.tab === deviceId()) root.localStorage.removeItem(TAB_CLAIM_KEY); } catch (_) {}
  }

  async function openEvent(event) {
    if (state.openEvent) return;
    if (!claimThisTab(event.id)) return;
    const api = root.RIOSDeliberateRoutines;
    if (!api) return notice('Routine checklist could not open. Refresh H-IOS and try again.', 'warning');
    await waitForRoutineStorage(api);
    const checklist = api.getChecklistData(event.routine_id, event.local_date, event.session_id);
    if (!checklist) {
      await updateEvent(event, { in_app_state: 'dismissed' });
      return;
    }
    if (!await claimOccurrence(event, Boolean(event.forceOpen))) return;
    event.checklist = checklist;
    event.session = checklist.session;
    renderReminder(event);
  }

  function showBanner(event) {
    if ($('#riosReminderBanner')) return;
    const banner = root.document.createElement('div');
    banner.className = 'rios-reminder-banner';
    banner.id = 'riosReminderBanner';
    banner.innerHTML = `<div><b>${escapeHtml(event.routine_name || 'Routine reminder')}</b><small>Your checklist is ready. Open it when you are free.</small></div><button class="rios-reminder-button primary" type="button" data-reminder-open-banner>Open</button><button class="rios-reminder-close" type="button" data-reminder-dismiss-banner aria-label="Dismiss reminder">×</button>`;
    root.document.body.appendChild(banner);
    banner.querySelector('[data-reminder-open-banner]')?.addEventListener('click', () => { banner.remove(); openEvent(event).catch(error => notice(error.message, 'error')); });
    banner.querySelector('[data-reminder-dismiss-banner]')?.addEventListener('click', async () => { banner.remove(); await updateEvent(event, { in_app_state: 'dismissed', dismissed_at: new Date().toISOString() }).catch(error => console.warn(error)); });
  }

  async function nextDueEvents() {
    if (!state.db || !state.user || state.busy) return [];
    if (root.RIOSDeliberateRoutines?.getReminderPreferences?.().enabled === false) return [];
    const { data, error } = await state.db.from(EVENTS_TABLE).select('*').eq('user_id', state.user.id)
      .in('in_app_state', ['pending', 'snoozed', 'shown']).order('scheduled_at', { ascending: true }).limit(30);
    if (error) {
      const status = $('#drReminderStorageStatus');
      const missing = /relation .* does not exist|schema cache|could not find the table/i.test(error.message || '');
      if (status && missing) status.textContent = 'Reminder storage is not set up in this database yet.';
      else if (status) status.textContent = 'Could not reach the reminder queue. Check the connection and refresh.';
      if (!missing) console.warn('R-IOS reminder queue could not load:', error);
      return [];
    }
    const status = $('#drReminderStorageStatus');
    if (status) status.textContent = 'Reminder storage is connected. Server scheduling is required for phone delivery while H-IOS is closed.';
    const now = Date.now();
    const preferences = root.RIOSDeliberateRoutines?.getReminderPreferences?.();
    return (data || []).filter(event => {
      if (event.auto_popup === false || Date.parse(event.scheduled_at) > now) return false;
      if (isQuietNow(preferences, event.timezone)) return false;
      if (event.in_app_state === 'snoozed' && event.snoozed_until && Date.parse(event.snoozed_until) > now) return false;
      if (event.in_app_state === 'shown' && event.in_app_claim_until && Date.parse(event.in_app_claim_until) > now) return false;
      if (event.event_kind === 'follow_up' && root.RIOSDeliberateRoutines?.getChecklistData?.(event.routine_id, event.local_date)?.session) return false;
      return true;
    });
  }

  async function poll() {
    if (!state.user || root.document.hidden || state.openEvent) return;
    const events = await nextDueEvents();
    state.queueCount = events.length;
    if (!events.length) return;
    const next = events[0];
    if (isCriticalInteraction()) return showBanner(next);
    try { await openEvent(next); }
    catch (error) { console.error('R-IOS reminder popup could not open:', error); }
  }

  async function handleAction(button) {
    const event = state.openEvent;
    if (!event || state.working) return;
    const action = button.dataset.reminderAction;
    const api = root.RIOSDeliberateRoutines;
    state.working = true;
    try {
      if (action === 'close' || action === 'dismiss') {
        await updateEvent(event, { in_app_state: 'dismissed', dismissed_at: new Date().toISOString() });
        hideReminder();
        return poll();
      }
      if (action === 'snooze') {
        const until = new Date(Date.now() + 10 * 60000).toISOString();
        const snoozeEvent = {
          user_id: state.user.id, routine_id: event.routine_id, event_kind: 'follow_up',
          occurrence_key: `${event.occurrence_key || event.id}:snooze:${Date.now()}`,
          scheduled_at: until, local_date: event.local_date || new Date().toISOString().slice(0, 10),
          local_time: event.local_time || '00:00', timezone: event.timezone || 'UTC',
          routine_name: event.routine_name || event.checklist?.routine?.name || 'Routine',
          title: `R-IOS — ${event.routine_name || event.checklist?.routine?.name || 'Routine'}`,
          body: 'A gentle reminder to begin, if this still fits your plan.', auto_popup: true
        };
        const { error: queueError } = await state.db.from(EVENTS_TABLE).insert(snoozeEvent);
        if (queueError) throw queueError;
        await updateEvent(event, { in_app_state: 'dismissed', snoozed_until: until, dismissed_at: new Date().toISOString() });
        hideReminder();
        return;
      }
      if (action === 'start') {
        button.disabled = true;
        const sessionId = await api.startRoutine(event.routine_id);
        event.session_id = sessionId || null;
        if (sessionId) await updateEvent(event, { session_id: sessionId, opened_at: new Date().toISOString() });
        event.checklist = api.getChecklistData(event.routine_id, event.local_date, sessionId);
        event.session = event.checklist?.session;
        return renderReminder(event);
      }
      if (action === 'resume') {
        await api.resumeSession(event.session.id);
        event.session = api.getChecklistData(event.routine_id, event.local_date, event.session.id)?.session;
        event.checklist = api.getChecklistData(event.routine_id, event.local_date, event.session.id);
        return renderReminder(event);
      }
      if (action === 'activity') {
        const card = button.closest('[data-checklist-item]');
        const note = card?.querySelector('[data-checklist-note]')?.value || '';
        const resistance = readResistance(card);
        await api.setChecklistActivityStatus(button.dataset.id, button.dataset.status, note, resistance);
        event.checklist = api.getChecklistData(event.routine_id, event.local_date, event.session?.id);
        event.session = event.checklist?.session;
        return renderReminder(event);
      }
      if (action === 'finish') {
        await api.finishSession(event.session.id);
        await updateEvent(event, { in_app_state: 'opened', opened_at: new Date().toISOString() });
        hideReminder();
        return;
      }
    } catch (error) {
      notice(error.message || 'Could not update this checklist. Your recorded progress is retained.', 'error');
    } finally { state.working = false; }
  }

  function bindUi() {
    if (state.eventsBound) return;
    mountUi();
    state.eventsBound = true;
    root.document.addEventListener('click', event => {
      const button = event.target.closest('[data-reminder-action]');
      if (button && $('#riosReminderHost')?.contains(button)) handleAction(button);
    });
    root.document.addEventListener('change', event => {
      const target = event.target;
      if (!target.matches('[data-checklist-note], [data-resistance]')) return;
      const card = target.closest('[data-checklist-item]');
      const id = card?.dataset.checklistItem;
      if (!id) return;
      const note = card.querySelector('[data-checklist-note]')?.value || '';
      root.RIOSDeliberateRoutines?.saveChecklistNote(id, note, readResistance(card))
        .catch(error => notice(error.message || 'Execution notes could not be saved.', 'error'));
    });
    root.addEventListener('storage', event => {
      if (event.key === TAB_CLAIM_KEY && state.openEvent && event.newValue) {
        try { if (JSON.parse(event.newValue).eventId === state.openEvent.id) hideReminder(); } catch (_) {}
      }
    });
    if ('BroadcastChannel' in root) {
      state.channel = new BroadcastChannel('rios-reminder-popup-v1');
      state.channel.addEventListener('message', event => { if (event.data?.type === 'reminder-open' && event.data.eventId === state.openEvent?.id) hideReminder(); });
    }
    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) poll(); });
    root.addEventListener('focus', poll);
    root.addEventListener('pageshow', poll);
  }

  function readResistance(card) {
    if (!card) return {};
    const value = key => card.querySelector(`[data-resistance="${key}"]`)?.value ?? '';
    const occurred = value('occurred'), influenced = value('influenced'), intensityText = value('intensity');
    const intensity = intensityText === '' ? null : Number(intensityText);
    if (intensity !== null && (!Number.isInteger(intensity) || intensity < 0 || intensity > 10)) throw new Error('Resistance intensity must be a whole number from 0 to 10.');
    return {
      resistance_occurred: occurred === 'yes' ? true : occurred === 'no' ? false : null,
      resistance_nature: value('nature').trim(), resistance_intensity: intensity,
      resistance_influenced_execution: influenced === 'yes' ? true : influenced === 'no' ? false : null,
      resistance_response: value('response').trim()
    };
  }

  async function openDeepLink() {
    const params = new URLSearchParams(root.location.search);
    const eventId = params.get('event');
    if (!eventId || !state.db || !state.user) return;
    const { data, error } = await state.db.from(EVENTS_TABLE).select('*').eq('user_id', state.user.id).eq('id', eventId).maybeSingle();
    if (!error && data) {
      data.forceOpen = true;
      await openEvent(data);
      return;
    }
    const routineId = params.get('routine');
    if (routineId && root.RIOSDeliberateRoutines) {
      await root.RIOSDeliberateRoutines.refresh();
      const checklist = root.RIOSDeliberateRoutines.getChecklistData(routineId, params.get('date') || '');
      if (checklist) renderReminder({ id: `deep-${routineId}`, synthetic: true, routine_id: routineId, event_kind: 'start', scheduled_at: new Date().toISOString(), local_date: params.get('date') || '', checklist });
    }
  }

  async function init(options = {}) {
    state.db = options.db || state.db;
    state.user = options.user || null;
    state.mode = options.mode || state.mode;
    state.showNotice = options.showNotice || state.showNotice;
    if (!state.user) return reset();
    if (!state.working) root.RIOSDeliberateRoutines?.init({ db: state.db, user: state.user, showNotice: state.showNotice, refreshEvidence: options.refreshEvidence });
    bindUi();
    permissionLabel();
    ensureServiceWorker().catch(error => console.info('R-IOS service worker registration skipped:', error.message));
    if (!state.pollTimer) state.pollTimer = root.setInterval(poll, 30000);
    if (!state.heartbeatTimer) {
      heartbeatDevice().catch(() => {});
      state.heartbeatTimer = root.setInterval(() => heartbeatDevice().catch(() => {}), 45000);
    }
    await openDeepLink().catch(error => console.warn('R-IOS reminder deep link could not open:', error));
    await poll();
  }

  function reset() {
    if (state.pollTimer) root.clearInterval(state.pollTimer);
    if (state.heartbeatTimer) root.clearInterval(state.heartbeatTimer);
    state.pollTimer = null;
    state.heartbeatTimer = null;
    state.user = null;
    state.db = null;
    state.openEvent = null;
    state.mode = '';
    const host = $('#riosReminderHost');
    if (host) host.innerHTML = '';
    $('#riosReminderBanner')?.remove();
  }

  const api = Object.freeze({ init, reset, enablePush, disablePush, testPush, permissionLabel, poll });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RIOSRoutineReminders = api;
})(typeof globalThis === 'object' ? globalThis : this);
