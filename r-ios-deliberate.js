(function registerDeliberateRoutines(root) {
  'use strict';

  const STATUS_LABELS = Object.freeze({
    active: 'Active', paused: 'Paused', archived: 'Archived',
    in_progress: 'In progress', completed: 'Completed', partially_completed: 'Partially completed',
    interrupted: 'Interrupted', missed: 'Recorded as missed', pending: 'Not recorded yet',
    partial: 'Partially completed', skipped: 'Skipped'
  });
  const DAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const TERMINAL_ACTIVITY_STATES = new Set(['completed', 'partial', 'skipped']);
  const WEEKDAYS = new Set(['1', '2', '3', '4', '5', '6', '7']);

  const state = {
    db: null,
    user: null,
    showNotice: null,
    refreshEvidence: null,
    page: null,
    routines: [],
    activities: [],
    sessions: [],
    sessionActivities: [],
    reviews: [],
    period: 'daily',
    view: 'routines',
    loading: false,
    eventsBound: false,
    available: false,
    error: ''
  };

  const $ = selector => root.document?.querySelector(selector) || null;
  const cryptoApi = () => root.crypto || root.window?.crypto;

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function makeId() {
    const crypto = cryptoApi();
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    throw new Error('This browser does not support secure routine identifiers. Update your browser and try again.');
  }

  function localDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function timeLabel(value) {
    if (!value) return '';
    return String(value).slice(0, 5);
  }

  function dateTimeLabel(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function durationBetween(start, end) {
    if (!start || !end) return null;
    const parse = value => {
      const [hours, minutes] = String(value).split(':').map(Number);
      return hours * 60 + minutes;
    };
    const from = parse(start), to = parse(end);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return (to - from + 1440) % 1440;
  }

  function addDays(dateString, amount) {
    const value = new Date(`${dateString}T12:00:00`);
    value.setDate(value.getDate() + amount);
    return localDate(value);
  }

  function timestampAt(dateString, time, dayOffset = 0) {
    if (!dateString || !time) return null;
    const value = new Date(`${dateString}T${String(time).slice(0, 5)}:00`);
    if (!Number.isFinite(value.getTime())) return null;
    value.setDate(value.getDate() + dayOffset);
    return value.toISOString();
  }

  function isMissingSchema(error) {
    return /relation .* does not exist|schema cache|could not find the table|table .* not found/i.test(error?.message || '');
  }

  function asArray(value) { return Array.isArray(value) ? value : []; }

  async function fetchRows(table, userId, orderColumn, ascending = true, limit = 500) {
    let query = state.db.from(table).select('*').eq('user_id', userId);
    if (orderColumn) query = query.order(orderColumn, { ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return asArray(data);
  }

  function sortActivities(rows) {
    return asArray(rows).slice().sort((left, right) =>
      Number(left.sort_order || 0) - Number(right.sort_order || 0) || String(left.created_at || '').localeCompare(String(right.created_at || ''))
    );
  }

  async function buildObservations(db, userId, engine) {
    if (!db || !userId) return [];
    const { data, error } = await db.from('deliberate_routine_session_activities')
      .select('id,routine_id,user_id,activity_key,activity_title,activity_kind,status,actual_started_at,actual_completed_at,status_recorded_at,planned_start_time,planned_duration_minutes')
      .eq('user_id', userId)
      .in('status', ['completed', 'partial', 'skipped'])
      .order('status_recorded_at', { ascending: true });
    if (error) {
      if (isMissingSchema(error)) return [];
      throw error;
    }
    const { data: sessions, error: sessionError } = await db.from('deliberate_routine_sessions')
      .select('id,routine_id,user_id,scheduled_for,planned_start_at,planned_end_at,actual_started_at,actual_completed_at,missed_recorded_at,updated_at,status')
      .eq('user_id', userId)
      .in('status', ['in_progress', 'completed', 'partially_completed', 'missed', 'interrupted'])
      .order('scheduled_for', { ascending: true });
    if (sessionError) {
      if (isMissingSchema(sessionError)) return [];
      throw sessionError;
    }
    const { data: routines, error: routineError } = await db.from('deliberate_routines')
      .select('id,name')
      .eq('user_id', userId);
    if (routineError) {
      if (isMissingSchema(routineError)) return [];
      throw routineError;
    }
    const dateOnly = typeof engine?.dateOnly === 'function'
      ? engine.dateOnly
      : value => /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || '';
    const routineNames = new Map(asArray(routines).map(row => [String(row.id), String(row.name || 'Routine')]));
    const activityObservations = asArray(data).filter(row => row.activity_kind !== 'group').map(row => {
      const labelState = row.status === 'completed' ? 'completed' : row.status === 'partial' ? 'partially completed' : 'skipped';
      const observedAt = row.actual_completed_at || row.status_recorded_at || row.actual_started_at || null;
      const observedOn = dateOnly(observedAt || '');
      if (!row.id || !row.routine_id || !row.activity_key || !row.activity_title || !observedOn) return null;
      return {
        source_product_id: 'rios',
        source_table: 'deliberate_routine_session_activities',
        source_record_id: String(row.id),
        activity_key: `deliberate:${row.routine_id}:${row.activity_key}:${row.status}`,
        label: `${row.activity_title} — ${labelState}`,
        observed_at: observedAt,
        observed_on: observedOn,
        details: {
          routine_id: row.routine_id,
          activity_key: row.activity_key,
          status: row.status,
          planned_start_time: row.planned_start_time || null,
          planned_duration_minutes: row.planned_duration_minutes ?? null
        },
        source_reference: {
          product_id: 'rios',
          table: 'deliberate_routine_session_activities',
          record_id: String(row.id),
          routine_id: row.routine_id
        }
      };
    }).filter(Boolean);
    const sessionObservations = asArray(sessions).map(row => {
      const statusLabel = {
        in_progress: 'started',
        completed: 'completed',
        partially_completed: 'partially completed',
        missed: 'recorded as missed',
        interrupted: 'interrupted'
      }[row.status];
      const observedAt = row.status === 'in_progress'
        ? row.actual_started_at
        : row.status === 'missed'
          ? row.missed_recorded_at
          : row.status === 'interrupted'
            ? row.updated_at || row.actual_started_at
            : row.actual_completed_at || row.updated_at || row.actual_started_at;
      const observedOn = dateOnly(observedAt || row.scheduled_for || '');
      if (!row.id || !row.routine_id || !statusLabel || !observedOn) return null;
      const routineName = routineNames.get(String(row.routine_id)) || 'Routine';
      return {
        source_product_id: 'rios',
        source_table: 'deliberate_routine_sessions',
        source_record_id: String(row.id),
        activity_key: 'deliberate:' + row.routine_id + ':session:' + row.status,
        label: routineName + ' — session ' + statusLabel,
        observed_at: observedAt || null,
        observed_on: observedOn,
        details: {
          routine_id: row.routine_id,
          scheduled_for: row.scheduled_for || null,
          status: row.status,
          planned_start_at: row.planned_start_at || null,
          planned_end_at: row.planned_end_at || null,
          actual_started_at: row.actual_started_at || null,
          actual_completed_at: row.actual_completed_at || null,
          missed_recorded_at: row.missed_recorded_at || null
        },
        source_reference: {
          product_id: 'rios',
          table: 'deliberate_routine_sessions',
          record_id: String(row.id),
          routine_id: row.routine_id
        }
      };
    }).filter(Boolean);
    return [...activityObservations, ...sessionObservations];
  }

  function notify(message, tone = 'info') {
    if (typeof state.showNotice === 'function') state.showNotice(message, tone);
  }

  async function refresh() {
    if (!state.db || !state.user || state.loading) return;
    state.loading = true;
    state.error = '';
    try {
      const [routines, activities, sessions, sessionActivities, reviews] = await Promise.all([
        fetchRows('deliberate_routines', state.user.id, 'created_at', false, 1000),
        fetchRows('deliberate_routine_activities', state.user.id, 'sort_order', true, 5000),
        fetchRows('deliberate_routine_sessions', state.user.id, 'scheduled_for', false, 500),
        fetchRows('deliberate_routine_session_activities', state.user.id, 'sort_order', true, 10000),
        fetchRows('deliberate_routine_reviews', state.user.id, 'period_end', false, 500)
      ]);
      state.routines = routines;
      state.activities = activities;
      state.sessions = sessions;
      state.sessionActivities = sessionActivities;
      state.reviews = reviews;
      state.available = true;
    } catch (error) {
      state.available = false;
      state.error = isMissingSchema(error)
        ? 'Routine storage is waiting for the Deliberate Routines Supabase migration included with this change.'
        : 'R-IOS could not load your deliberate routines. Check your connection and refresh.';
      console.warn('R-IOS deliberate routines could not load:', error);
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function reset() {
    state.user = null;
    state.routines = [];
    state.activities = [];
    state.sessions = [];
    state.sessionActivities = [];
    state.reviews = [];
    state.available = false;
    state.error = '';
    renderAll();
  }

  function setView(name) {
    if (!['routines', 'execution', 'development'].includes(name)) return;
    state.view = name;
    root.document?.querySelectorAll('[data-deliberate-panel]').forEach(panel => {
      panel.hidden = panel.dataset.deliberatePanel !== name;
    });
    root.document?.querySelectorAll('[data-deliberate-view]').forEach(button => {
      const selected = button.dataset.deliberateView === name;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function scheduleLabel(routine) {
    const data = routine.schedule_data || {};
    const interval = Math.max(1, Number(data.interval || 1));
    const prefix = interval > 1 ? `Every ${interval} ` : '';
    if (routine.schedule_kind === 'weekly') {
      const days = asArray(data.weekdays).map(day => DAYS[Number(day) - 1]).filter(Boolean);
      return `${prefix}week · ${days.length ? days.join(', ') : 'no days selected'}`;
    }
    if (routine.schedule_kind === 'monthly') {
      const days = asArray(data.monthDays).map(Number).filter(day => day >= 1 && day <= 31);
      return `${prefix}month · day${days.length === 1 ? '' : 's'} ${days.join(', ') || 'not selected'}`;
    }
    if (routine.schedule_kind === 'custom') return data.description || 'Custom recurring';
    return 'Every day';
  }

  function routineActivityRows(routineId) {
    return sortActivities(state.activities.filter(row => row.routine_id === routineId));
  }

  function inProgressSession(routineId) {
    return state.sessions.find(row => row.routine_id === routineId && row.status === 'in_progress') || null;
  }

  function interruptedSession(routineId) {
    return state.sessions.find(row => row.routine_id === routineId && row.status === 'interrupted') || null;
  }

  function sessionItems(sessionId) {
    return sortActivities(state.sessionActivities.filter(row => row.session_id === sessionId));
  }

  function routineCard(routine) {
    const activities = routineActivityRows(routine.id);
    const activeSession = inProgressSession(routine.id);
    const pausedSession = interruptedSession(routine.id);
    const canStart = routine.status === 'active' && !activeSession && !pausedSession;
    const time = [timeLabel(routine.start_time), timeLabel(routine.end_time)].filter(Boolean).join('–');
    const activityMarkup = activities.length
      ? activities.map(activity => activity.activity_kind === 'group'
        ? `<div class="dr-activity-preview group"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(timeLabel(activity.start_time) || 'Time block')}</span></div>`
        : `<div class="dr-activity-preview"><span>${escapeHtml(activity.title)}</span><small>${escapeHtml(activity.parent_activity_id ? 'Grouped activity' : 'Activity')}${activity.start_time ? ' · ' + escapeHtml(timeLabel(activity.start_time)) : ''}${activity.duration_minutes ? ' · ' + escapeHtml(activity.duration_minutes + ' min') : ''}</small></div>`
      ).join('')
      : '<div class="dr-inline-empty">No activities added yet.</div>';
    const sessionButton = activeSession
      ? `<button class="ri-button primary" type="button" data-routine-action="open-session" data-id="${escapeHtml(activeSession.id)}">Resume execution</button>`
      : pausedSession
        ? `<button class="ri-button primary" type="button" data-routine-action="resume-session" data-id="${escapeHtml(pausedSession.id)}">Resume interrupted routine</button>`
        : `<button class="ri-button primary" type="button" data-routine-action="start-routine" data-id="${escapeHtml(routine.id)}" ${canStart ? '' : 'disabled'}>Start routine</button>`;
    const toggleLabel = routine.status === 'active' ? 'Pause' : routine.status === 'paused' ? 'Activate' : 'Reopen';
    return `<article class="dr-routine-card">
      <div class="dr-routine-card-head"><div><span class="dr-kicker">${escapeHtml(STATUS_LABELS[routine.status] || routine.status)} · ${escapeHtml(scheduleLabel(routine))}</span><h4>${escapeHtml(routine.name)}</h4><p>${escapeHtml(time || 'No time window set')}${routine.duration_minutes ? ` · ${escapeHtml(routine.duration_minutes)} min planned` : ''}</p></div><span class="ri-badge ${routine.status === 'active' ? 'good' : 'muted'}">${escapeHtml(STATUS_LABELS[routine.status] || routine.status)}</span></div>
      ${routine.purpose ? `<p class="dr-routine-copy"><b>Purpose</b>${escapeHtml(routine.purpose)}</p>` : ''}
      ${routine.desired_outcome ? `<p class="dr-routine-copy"><b>Desired outcome</b>${escapeHtml(routine.desired_outcome)}</p>` : ''}
      ${routine.description ? `<p class="dr-routine-description">${escapeHtml(routine.description)}</p>` : ''}
      <div class="dr-activity-preview-list">${activityMarkup}</div>
      <div class="dr-routine-actions">${sessionButton}
        <button class="ri-button" type="button" data-routine-action="edit-routine" data-id="${escapeHtml(routine.id)}">Edit</button>
        <button class="ri-button" type="button" data-routine-action="open-review" data-id="${escapeHtml(routine.id)}" data-review-type="daily">Daily review</button>
        <button class="ri-button" type="button" data-routine-action="record-missed" data-id="${escapeHtml(routine.id)}" ${routine.status !== 'active' || activeSession ? 'disabled' : ''}>Record missed session</button>
        <button class="ri-button quiet" type="button" data-routine-action="toggle-routine-status" data-id="${escapeHtml(routine.id)}">${toggleLabel}</button>
      </div>
    </article>`;
  }

  function sessionStateLabel(session) {
    return STATUS_LABELS[session.status] || session.status;
  }

  function sessionSummary(session) {
    const items = sessionItems(session.id).filter(row => row.activity_kind !== 'group');
    const total = items.length;
    const completed = items.filter(row => row.status === 'completed').length;
    const partial = items.filter(row => row.status === 'partial').length;
    const skipped = items.filter(row => row.status === 'skipped').length;
    const pending = items.filter(row => row.status === 'pending' || row.status === 'in_progress').length;
    return { items, total, completed, partial, skipped, pending };
  }

  function currentActivityId(items) {
    const activities = items.filter(row => row.activity_kind !== 'group');
    return activities.find(row => row.status === 'in_progress')?.id || activities.find(row => row.status === 'pending')?.id || null;
  }

  function resistanceEditor(item) {
    return `<details class="dr-resistance" data-resistance-box>
      <summary>Optional psychological resistance record</summary>
      <div class="dr-resistance-fields">
        <label>Did resistance occur?<select data-resistance="occurred"><option value="">Not recorded</option><option value="no" ${item.resistance_occurred === false ? 'selected' : ''}>No</option><option value="yes" ${item.resistance_occurred === true ? 'selected' : ''}>Yes</option></select></label>
        <label>Intensity (0–10)<input data-resistance="intensity" type="number" min="0" max="10" step="1" value="${escapeHtml(item.resistance_intensity ?? '')}" placeholder="Optional"></label>
        <label class="wide">What resistance did you notice?<input data-resistance="nature" maxlength="240" value="${escapeHtml(item.resistance_nature || '')}" placeholder="Describe what you experienced"></label>
        <label>Did it influence execution?<select data-resistance="influenced"><option value="">Not recorded</option><option value="no" ${item.resistance_influenced === false ? 'selected' : ''}>No</option><option value="yes" ${item.resistance_influenced === true ? 'selected' : ''}>Yes</option></select></label>
        <label class="wide">How did you respond?<input data-resistance="response" maxlength="300" value="${escapeHtml(item.resistance_response || '')}" placeholder="Optional response"></label>
      </div>
      <button class="ri-button small" type="button" data-routine-action="save-item-notes" data-id="${escapeHtml(item.id)}">Save note and resistance record</button>
    </details>`;
  }

  function sessionActivityMarkup(items) {
    const groups = new Map(items.filter(row => row.activity_kind === 'group').map(row => [String(row.activity_key), row]));
    const currentId = currentActivityId(items);
    return items.filter(row => row.activity_kind === 'group' || row.activity_kind === 'activity').map(item => {
      if (item.activity_kind === 'group') {
        return `<div class="dr-execution-group"><div class="dr-timeblock-head"><b>${escapeHtml(item.activity_title)}</b><span>${escapeHtml(timeLabel(item.planned_start_time) || 'Time block')}${item.planned_duration_minutes ? ' · ' + escapeHtml(item.planned_duration_minutes + ' min') : ''}</span></div><p>${escapeHtml(item.completion_criteria || item.instructions || '')}</p></div>`;
      }
      const group = item.parent_activity_key ? groups.get(String(item.parent_activity_key)) : null;
      const current = item.id === currentId;
      const disabled = !current || !['pending', 'in_progress'].includes(item.status);
      const showStart = item.status === 'pending';
      const note = item.execution_note || '';
      const timing = [timeLabel(item.planned_start_time) ? 'Planned ' + timeLabel(item.planned_start_time) : '', item.actual_started_at ? 'Started ' + dateTimeLabel(item.actual_started_at) : '', item.actual_completed_at ? 'Completed ' + dateTimeLabel(item.actual_completed_at) : ''].filter(Boolean).join(' · ');
      return `<article class="dr-execution-activity ${current ? 'current' : ''}" data-session-activity-card data-id="${escapeHtml(item.id)}">
        ${group ? `<div class="dr-group-label">${escapeHtml(group.activity_title)}</div>` : ''}
        <div class="dr-execution-activity-head"><div><span class="dr-kicker">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><h5>${escapeHtml(item.activity_title)}</h5></div>${current ? '<span class="pill accent">Current activity</span>' : ''}</div>
        ${item.completion_criteria ? `<p class="dr-criteria"><b>Completion:</b> ${escapeHtml(item.completion_criteria)}</p>` : ''}
        ${item.instructions ? `<p class="dr-criteria"><b>Instructions:</b> ${escapeHtml(item.instructions)}</p>` : ''}
        ${timing ? `<p class="dr-actual-times">${escapeHtml(timing)}</p>` : ''}
        <label class="dr-execution-note">Execution note<textarea data-execution-note rows="2" maxlength="500" placeholder="A brief note about what happened">${escapeHtml(note)}</textarea></label>
        ${resistanceEditor(item)}
        <div class="dr-item-actions">
          ${showStart ? `<button class="ri-button" type="button" data-routine-action="start-activity" data-id="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}>Start activity</button>` : ''}
          <button class="ri-button primary" type="button" data-routine-action="complete-activity" data-id="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}>Complete</button>
          <button class="ri-button" type="button" data-routine-action="partial-activity" data-id="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}>Partially done</button>
          <button class="ri-button quiet" type="button" data-routine-action="skip-activity" data-id="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}>Skip</button>
        </div>
      </article>`;
    }).join('');
  }

  function executionCard(session) {
    const routine = state.routines.find(row => row.id === session.routine_id);
    const summary = sessionSummary(session);
    const isInterrupted = session.status === 'interrupted';
    const finished = summary.total > 0 && summary.pending === 0;
    const content = sessionActivityMarkup(summary.items);
    return `<article class="dr-session-card" data-session-card="${escapeHtml(session.id)}">
      <div class="dr-session-head"><div><span class="dr-kicker">${escapeHtml(sessionStateLabel(session))} · ${escapeHtml(localizeDate(session.scheduled_for))}</span><h4>${escapeHtml(routine?.name || 'Archived routine')}</h4><p>Session started ${escapeHtml(dateTimeLabel(session.actual_started_at))}</p></div><span class="ri-badge ${finished ? 'good' : 'muted'}">${summary.completed}/${summary.total} completed</span></div>
      ${isInterrupted ? '<div class="dr-interrupted-note">This session is saved. Resume it when you are ready.</div>' : ''}
      ${content || '<p class="dr-inline-empty">This session has no activity snapshot. Edit the routine and add activities before starting another session.</p>'}
      <div class="dr-session-footer">
        ${isInterrupted ? `<button class="ri-button primary" type="button" data-routine-action="resume-session" data-id="${escapeHtml(session.id)}">Resume session</button>` : ''}
        ${!isInterrupted ? `<button class="ri-button primary" type="button" data-routine-action="finish-session" data-id="${escapeHtml(session.id)}" ${finished ? '' : 'disabled'}>${finished ? 'Finish routine session' : 'Complete or skip each activity first'}</button><button class="ri-button quiet" type="button" data-routine-action="interrupt-session" data-id="${escapeHtml(session.id)}">Save and interrupt</button>` : ''}
      </div>
    </article>`;
  }

  function localizeDate(value) {
    if (!value) return 'Date not recorded';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  function routineById(id) { return state.routines.find(row => row.id === id) || null; }

  function sessionCard(session) {
    const routine = routineById(session.routine_id);
    const summary = sessionSummary(session);
    const label = routine?.name || 'Archived routine';
    const completedAt = session.actual_completed_at ? ` · Finished ${dateTimeLabel(session.actual_completed_at)}` : '';
    const itemHtml = summary.items.map(item => {
      const resistance = item.resistance_occurred === true
        ? `Resistance recorded${item.resistance_intensity === null ? '' : ` · intensity ${item.resistance_intensity}/10`}${item.resistance_influenced_execution === true ? ' · influenced execution' : ''}`
        : item.resistance_occurred === false ? 'Resistance recorded: no' : 'Resistance not recorded';
      return `<div class="dr-session-history-row"><span class="ri-badge ${item.status === 'completed' ? 'good' : 'muted'}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span><div><b>${escapeHtml(item.activity_title)}</b><small>${escapeHtml(item.execution_note || 'No execution note')}${item.resistance_occurred !== null ? ' · ' + escapeHtml(resistance) : ''}</small></div></div>`;
    }).join('');
    return `<details class="dr-session-history"><summary><span><b>${escapeHtml(label)}</b><small>${escapeHtml(sessionStateLabel(session))} · ${escapeHtml(localizeDate(session.scheduled_for))} · ${summary.completed}/${summary.total} completed${completedAt}</small></span><span class="dr-history-chevron">＋</span></summary><div class="dr-session-history-content"><p>Planned start: ${escapeHtml(dateTimeLabel(session.planned_start_at))} · Actual start: ${escapeHtml(dateTimeLabel(session.actual_started_at))}</p>${itemHtml || '<p>No activity snapshots for this session.</p>'}</div></details>`;
  }

  function periodBounds(period, reference = new Date()) {
    const today = localDate(reference);
    if (period === 'daily') return { start: today, end: today };
    if (period === 'weekly') {
      const weekday = (reference.getDay() + 6) % 7;
      return { start: addDays(today, -weekday), end: today };
    }
    const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
    return { start: localDate(first), end: today };
  }

  function previousPeriodBounds(period, reference = new Date()) {
    const current = periodBounds(period, reference);
    if (period === 'daily') return { start: addDays(current.start, -1), end: addDays(current.end, -1) };
    if (period === 'weekly') return { start: addDays(current.start, -7), end: addDays(current.end, -7) };
    const previousStart = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
    const lastDay = new Date(reference.getFullYear(), reference.getMonth(), 0).getDate();
    const matchingDay = Math.min(reference.getDate(), lastDay);
    const previousEnd = new Date(reference.getFullYear(), reference.getMonth() - 1, matchingDay);
    return { start: localDate(previousStart), end: localDate(previousEnd) };
  }

  function sessionsInPeriod(routineId, bounds) {
    return state.sessions.filter(session => session.routine_id === routineId && session.scheduled_for >= bounds.start && session.scheduled_for <= bounds.end);
  }

  function summarizeRoutine(routine, bounds) {
    const sessions = sessionsInPeriod(routine.id, bounds);
    const recorded = sessions.filter(row => row.status !== 'in_progress' && row.status !== 'interrupted');
    const completed = sessions.filter(row => row.status === 'completed').length;
    const partial = sessions.filter(row => row.status === 'partially_completed').length;
    const missed = sessions.filter(row => row.status === 'missed').length;
    const interrupted = sessions.filter(row => row.status === 'interrupted' || row.status === 'in_progress').length;
    const consistency = recorded.length ? Math.round(completed / recorded.length * 100) : null;
    const sessionIds = new Set(sessions.map(row => row.id));
    const items = state.sessionActivities.filter(row => sessionIds.has(row.session_id) && row.activity_kind !== 'group');
    const gaps = new Map();
    items.filter(row => row.status === 'partial' || row.status === 'skipped').forEach(row => {
      const current = gaps.get(row.activity_title) || { title: row.activity_title, partial: 0, skipped: 0, sessionIds: new Set() };
      current[row.status === 'partial' ? 'partial' : 'skipped'] += 1;
      current.sessionIds.add(String(row.session_id));
      gaps.set(row.activity_title, current);
    });
    const selfReportedResistance = items.filter(row => row.resistance_occurred === true);
    const intensities = selfReportedResistance.map(row => Number(row.resistance_intensity)).filter(Number.isFinite);
    const delays = sessions.filter(row => row.actual_started_at && row.planned_start_at).map(row => {
      return (Date.parse(row.actual_started_at) - Date.parse(row.planned_start_at)) / 60000;
    }).filter(Number.isFinite);
    const actualDurations = sessions.filter(row => row.actual_started_at && row.actual_completed_at).map(row => {
      return (Date.parse(row.actual_completed_at) - Date.parse(row.actual_started_at)) / 60000;
    }).filter(value => Number.isFinite(value) && value >= 0);
    return {
      sessions, recordedCount: recorded.length, completed, partial, missed, interrupted, consistency,
      gaps: [...gaps.values()].filter(gap => gap.sessionIds.size >= 2)
        .map(({ sessionIds, ...gap }) => gap)
        .sort((a, b) => b.partial + b.skipped - a.partial - a.skipped).slice(0, 4),
      resistanceCount: selfReportedResistance.length,
      resistanceInfluenceCount: selfReportedResistance.filter(row => row.resistance_influenced_execution === true).length,
      averageResistance: intensities.length ? intensities.reduce((sum, value) => sum + value, 0) / intensities.length : null,
      averageDelay: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
      averageDuration: actualDurations.length ? actualDurations.reduce((sum, value) => sum + value, 0) / actualDurations.length : null
    };
  }

  function performanceCard(routine, bounds) {
    const metrics = summarizeRoutine(routine, bounds);
    const previous = summarizeRoutine(routine, previousPeriodBounds(state.period));
    const gapMarkup = metrics.gaps.length
      ? metrics.gaps.map(gap => `<div class="dr-gap-row"><b>${escapeHtml(gap.title)}</b><span>${gap.partial ? gap.partial + ' partial' : ''}${gap.partial && gap.skipped ? ' · ' : ''}${gap.skipped ? gap.skipped + ' skipped' : ''}</span></div>`).join('')
      : '<p class="dr-inline-empty">No recurring partial or skipped activities recorded in this period.</p>';
    const consistency = metrics.consistency === null ? '—' : `${metrics.consistency}%`;
    const consistencyChange = metrics.consistency === null || previous.consistency === null
      ? null
      : metrics.consistency - previous.consistency;
    const resistanceChange = metrics.averageResistance === null || previous.averageResistance === null
      ? 'Not enough self-reported resistance records in both periods to compare.'
      : `Mean recorded intensity changed by ${(metrics.averageResistance - previous.averageResistance) > 0 ? '+' : ''}${(metrics.averageResistance - previous.averageResistance).toFixed(1)} points.`;
    const consistencyChangeText = consistencyChange === null
      ? 'No previous period comparison yet.'
      : `${consistencyChange > 0 ? '+' : ''}${consistencyChange.toFixed(0)} percentage points in fully completed sessions.`;
    const resistanceText = metrics.resistanceCount
      ? `${metrics.resistanceCount} self-reported event${metrics.resistanceCount === 1 ? '' : 's'}${metrics.averageResistance === null ? '' : ` · mean intensity ${metrics.averageResistance.toFixed(1)}/10`} · influenced execution ${metrics.resistanceInfluenceCount} time${metrics.resistanceInfluenceCount === 1 ? '' : 's'}`
      : 'No psychological resistance recorded in this period.';
    const timingText = metrics.averageDelay === null
      ? 'No paired planned and actual start times.'
      : `${metrics.averageDelay >= 0 ? 'Average start delay' : 'Average start lead'} ${Math.abs(metrics.averageDelay).toFixed(0)} min. Timing is an observation, not a psychological explanation.`;
    return `<article class="dr-performance-card">
      <div class="dr-performance-head"><div><span class="dr-kicker">${escapeHtml(scheduleLabel(routine))}</span><h4>${escapeHtml(routine.name)}</h4><p>${escapeHtml(bounds.start === bounds.end ? localizeDate(bounds.start) : `${localizeDate(bounds.start)} – ${localizeDate(bounds.end)}`)}</p></div><button class="ri-button" type="button" data-routine-action="open-review" data-id="${escapeHtml(routine.id)}" data-review-type="${escapeHtml(state.period)}">Write ${escapeHtml(state.period)} review</button></div>
      <div class="dr-performance-metrics"><div><small>Execution consistency</small><b>${consistency}</b><span>Fully completed / recorded sessions</span></div><div><small>Completed</small><b>${metrics.completed}</b><span>sessions</span></div><div><small>Partially completed</small><b>${metrics.partial}</b><span>sessions</span></div><div><small>Missed</small><b>${metrics.missed}</b><span>explicitly recorded</span></div><div><small>Open or interrupted</small><b>${metrics.interrupted}</b><span>not counted as missed</span></div></div>
      <div class="dr-trend-summary"><div><small>Change in execution consistency vs previous comparable period</small><b>${escapeHtml(consistencyChangeText)}</b></div><div><small>Change in self-reported resistance intensity</small><b>${escapeHtml(resistanceChange)}</b></div></div>
      <div class="dr-performance-subgrid"><section><h5>Planned versus actual</h5><p>${escapeHtml(timingText)}</p><p>${metrics.averageDuration === null ? 'No completed session duration to compare.' : `Average recorded duration ${metrics.averageDuration.toFixed(0)} min.`}</p></section><section><h5>Recurring execution gaps</h5>${gapMarkup}</section><section><h5>Psychological resistance</h5><p>${escapeHtml(resistanceText)}</p><small>Based only on resistance you chose to record.</small></section></div>
    </article>`;
  }

  function reviewCard(review) {
    const routine = routineById(review.routine_id);
    return `<article class="dr-review-card"><div class="dr-review-card-head"><div><span class="dr-kicker">${escapeHtml(review.review_type)} review · ${escapeHtml(localizeDate(review.period_start))}${review.period_end !== review.period_start ? ' – ' + escapeHtml(localizeDate(review.period_end)) : ''}</span><h4>${escapeHtml(routine?.name || 'Archived routine')}</h4></div><span class="ri-badge muted">Saved ${escapeHtml(dateTimeLabel(review.updated_at || review.created_at))}</span></div>
      ${review.planned_outcomes ? `<p><b>Planned</b>${escapeHtml(review.planned_outcomes)}</p>` : ''}${review.actual_outcomes ? `<p><b>Actual</b>${escapeHtml(review.actual_outcomes)}</p>` : ''}${review.execution_gaps ? `<p><b>Gap</b>${escapeHtml(review.execution_gaps)}</p>` : ''}${review.self_discovery ? `<p><b>Self-discovery</b>${escapeHtml(review.self_discovery)}</p>` : ''}${review.conscious_development ? `<p><b>Development</b>${escapeHtml(review.conscious_development)}</p>` : ''}${review.next_experiment ? `<p><b>Next experiment</b>${escapeHtml(review.next_experiment)}</p>` : ''}
      <button class="ri-button" type="button" data-routine-action="open-review" data-id="${escapeHtml(review.routine_id)}" data-review-type="${escapeHtml(review.review_type)}" data-review-id="${escapeHtml(review.id)}">Edit review</button>
    </article>`;
  }

  function renderStorageNotice() {
    const box = $('#drStorageNotice');
    if (!box) return;
    box.textContent = state.error;
    box.hidden = !state.error;
    box.classList.toggle('warning', Boolean(state.error));
  }

  function renderRoutines() {
    const host = $('#drRoutineList');
    if (!host) return;
    const sorted = state.routines.slice().sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : b.status === 'active' ? 1 : a.status === 'paused' ? -1 : 1;
      return String(a.start_time || '99:99').localeCompare(String(b.start_time || '99:99'));
    });
    host.innerHTML = sorted.length
      ? sorted.map(routineCard).join('')
      : `<div class="ri-empty ri-large-empty"><b>No deliberate routines yet</b><p>Create a routine for what you intend to do. Add the optional Daily Operating System example if you want a starting structure.</p></div>`;
  }

  function renderExecution() {
    const activeHost = $('#drExecutionList');
    const historyHost = $('#drRecentSessions');
    if (!activeHost || !historyHost) return;
    const openSessions = state.sessions.filter(row => row.status === 'in_progress' || row.status === 'interrupted')
      .sort((a, b) => String(b.actual_started_at || b.created_at).localeCompare(String(a.actual_started_at || a.created_at)));
    const activeRoutines = state.routines.filter(row => row.status === 'active');
    const routineQuickStart = activeRoutines.length
      ? `<div class="dr-quick-start-list">${activeRoutines.map(routine => {
        const session = inProgressSession(routine.id) || interruptedSession(routine.id);
        return `<div class="dr-quick-start"><div><b>${escapeHtml(routine.name)}</b><small>${escapeHtml(scheduleLabel(routine))}${routine.start_time ? ' · ' + escapeHtml(timeLabel(routine.start_time)) : ''}</small></div>${session ? `<button class="ri-button primary" type="button" data-routine-action="${session.status === 'interrupted' ? 'resume-session' : 'open-session'}" data-id="${escapeHtml(session.id)}">${session.status === 'interrupted' ? 'Resume' : 'Continue'}</button>` : `<button class="ri-button primary" type="button" data-routine-action="start-routine" data-id="${escapeHtml(routine.id)}">Start</button>`}</div>`;
      }).join('')}</div>`
      : '<div class="ri-empty">Activate a routine to start an execution session.</div>';
    activeHost.innerHTML = openSessions.map(executionCard).join('') + `<section class="dr-quick-start-panel"><div class="dr-section-heading"><div><h4>Available active routines</h4><p>Choose a routine when you are ready to begin.</p></div></div>${routineQuickStart}</section>`;
    historyHost.innerHTML = state.sessions.length
      ? state.sessions.slice().sort((a, b) => String(b.actual_started_at || b.missed_recorded_at || b.created_at).localeCompare(String(a.actual_started_at || a.missed_recorded_at || a.created_at))).slice(0, 20).map(sessionCard).join('')
      : '<div class="ri-empty">Completed session records will appear here.</div>';
  }

  function renderPerformance() {
    const performanceHost = $('#drPerformanceList');
    const reviewsHost = $('#drReviewsList');
    if (!performanceHost || !reviewsHost) return;
    const bounds = periodBounds(state.period);
    const routines = state.routines.filter(row => row.status !== 'archived');
    performanceHost.innerHTML = routines.length
      ? routines.map(routine => performanceCard(routine, bounds)).join('')
      : '<div class="ri-empty">Create a routine to start reviewing its execution.</div>';
    reviewsHost.innerHTML = state.reviews.length
      ? state.reviews.slice().sort((a, b) => String(b.period_end).localeCompare(String(a.period_end))).map(reviewCard).join('')
      : '<div class="ri-empty">No development reviews recorded yet.</div>';
  }

  function renderAll() {
    renderStorageNotice();
    renderRoutines();
    renderExecution();
    renderPerformance();
    setView(state.view);
  }

  function showDialog(dialog) {
    if (dialog?.showModal) dialog.showModal();
    else if (dialog) dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (dialog?.close) dialog.close();
    else dialog?.removeAttribute('open');
  }

  function field(id) { return $(id); }

  function setScheduleFields() {
    const kind = field('#drScheduleKind')?.value || 'daily';
    const weekdays = $('#drWeekdaysField');
    const monthDays = $('#drMonthDaysField');
    const custom = $('#drCustomScheduleField');
    if (weekdays) weekdays.hidden = kind !== 'weekly';
    if (monthDays) monthDays.hidden = kind !== 'monthly';
    if (custom) custom.hidden = kind !== 'custom';
    const interval = field('#drScheduleInterval');
    if (interval) interval.disabled = kind === 'daily';
  }

  function activityRowHtml(activity = {}) {
    const id = activity.id || makeId();
    return `<article class="dr-builder-row" data-activity-row data-activity-id="${escapeHtml(id)}">
      <div class="dr-builder-row-head"><span class="dr-drag-label">Activity order</span><div><button class="ri-button small" type="button" data-routine-action="move-activity-up" aria-label="Move activity up">↑</button><button class="ri-button small" type="button" data-routine-action="move-activity-down" aria-label="Move activity down">↓</button><button class="ri-button small quiet" type="button" data-routine-action="remove-activity">Remove</button></div></div>
      <div class="dr-builder-grid">
        <label>Type<select data-activity-field="kind"><option value="activity" ${activity.activity_kind !== 'group' ? 'selected' : ''}>Activity</option><option value="group" ${activity.activity_kind === 'group' ? 'selected' : ''}>Time block / group</option></select></label>
        <label class="dr-parent-label" ${activity.activity_kind === 'group' ? 'hidden' : ''}>Group<select data-activity-field="parent"><option value="">Top level</option></select></label>
        <label class="wide">${activity.activity_kind === 'group' ? 'Time block name' : 'Activity name'}<input data-activity-field="title" maxlength="180" value="${escapeHtml(activity.title || '')}" required placeholder="Name this ${activity.activity_kind === 'group' ? 'time block' : 'activity'}"></label>
        <label>Start time<input data-activity-field="start" type="time" value="${escapeHtml(timeLabel(activity.start_time || ''))}"></label>
        <label>Duration in minutes<input data-activity-field="duration" type="number" min="0" max="1440" value="${escapeHtml(activity.duration_minutes ?? '')}" placeholder="Optional"></label>
        <label class="wide">Completion criteria<input data-activity-field="criteria" maxlength="500" value="${escapeHtml(activity.completion_criteria || '')}" placeholder="What would count as completing this activity?"></label>
        <label class="wide">Instructions or notes<textarea data-activity-field="instructions" rows="2" maxlength="700" placeholder="Optional directions or reminders">${escapeHtml(activity.instructions || '')}</textarea></label>
      </div>
    </article>`;
  }

  function refreshGroupOptions() {
    const rows = [...(field('#drActivityBuilder')?.querySelectorAll('[data-activity-row]') || [])];
    const groups = rows.filter(row => row.querySelector('[data-activity-field="kind"]')?.value === 'group');
    rows.forEach(row => {
      const kind = row.querySelector('[data-activity-field="kind"]')?.value;
      const parentLabel = row.querySelector('.dr-parent-label');
      const parent = row.querySelector('[data-activity-field="parent"]');
      const titleLabel = row.querySelector('[data-activity-field="title"]')?.closest('label');
      const title = row.querySelector('[data-activity-field="title"]');
      if (titleLabel) titleLabel.firstChild.textContent = kind === 'group' ? 'Time block name' : 'Activity name';
      if (title) title.placeholder = `Name this ${kind === 'group' ? 'time block' : 'activity'}`;
      if (parentLabel) parentLabel.hidden = kind === 'group';
      if (!parent) return;
      const selected = parent.value;
      const ownId = row.dataset.activityId;
      parent.innerHTML = '<option value="">Top level</option>' + groups
        .filter(group => group.dataset.activityId !== ownId)
        .map(group => `<option value="${escapeHtml(group.dataset.activityId)}">${escapeHtml(group.querySelector('[data-activity-field="title"]')?.value || 'Untitled group')}</option>`).join('');
      if ([...parent.options].some(option => option.value === selected)) parent.value = selected;
    });
  }

  function activityEditorRows(activities) {
    const host = field('#drActivityBuilder');
    if (!host) return;
    host.innerHTML = asArray(activities).map(activityRowHtml).join('') || activityRowHtml();
    refreshGroupOptions();
    asArray(activities).forEach((activity, index) => {
      const row = host.querySelectorAll('[data-activity-row]')[index];
      if (row && activity.parent_activity_id) row.querySelector('[data-activity-field="parent"]').value = activity.parent_activity_id;
    });
  }

  function resetRoutineForm() {
    field('#drRoutineForm')?.reset();
    field('#drRoutineId').value = '';
    field('#drRoutineStatus').value = 'active';
    field('#drScheduleInterval').value = '1';
    field('#drMonthDays').value = '1';
    field('#drCustomSchedule').value = '';
    $('#drWeekdaysField')?.querySelectorAll('input[type="checkbox"]').forEach(box => { box.checked = false; });
    activityEditorRows([]);
    setScheduleFields();
  }

  function openRoutineEditor(routineId = '') {
    if (!state.available) return notify(state.error || 'Routine storage is not available.', 'warning');
    resetRoutineForm();
    const routine = routineId ? routineById(routineId) : null;
    if (routine) {
      field('#drRoutineDialogTitle').textContent = 'Edit routine';
      field('#drRoutineId').value = routine.id;
      field('#drRoutineName').value = routine.name || '';
      field('#drRoutineStatus').value = routine.status || 'active';
      field('#drRoutineDescription').value = routine.description || '';
      field('#drRoutinePurpose').value = routine.purpose || '';
      field('#drRoutineOutcome').value = routine.desired_outcome || '';
      field('#drRoutineStart').value = timeLabel(routine.start_time || '');
      field('#drRoutineEnd').value = timeLabel(routine.end_time || '');
      field('#drRoutineDuration').value = routine.duration_minutes ?? '';
      field('#drScheduleKind').value = routine.schedule_kind || 'daily';
      const data = routine.schedule_data || {};
      field('#drScheduleInterval').value = String(data.interval || 1);
      field('#drMonthDays').value = asArray(data.monthDays).join(', ') || '1';
      field('#drCustomSchedule').value = data.description || '';
      const selectedDays = new Set(asArray(data.weekdays).map(String));
      $('#drWeekdaysField')?.querySelectorAll('input[type="checkbox"]').forEach(box => { box.checked = selectedDays.has(box.value); });
      activityEditorRows(routineActivityRows(routine.id));
    } else {
      field('#drRoutineDialogTitle').textContent = 'Create routine';
    }
    setScheduleFields();
    showDialog(field('#drRoutineDialog'));
  }

  function readSchedule() {
    const kind = field('#drScheduleKind').value;
    const interval = Math.max(1, Math.min(365, Number(field('#drScheduleInterval').value || 1)));
    const data = { interval };
    if (kind === 'weekly') {
      data.weekdays = [...($('#drWeekdaysField')?.querySelectorAll('input:checked') || [])].map(box => Number(box.value)).filter(day => day >= 1 && day <= 7);
      if (!data.weekdays.length) throw new Error('Choose at least one weekday for this routine.');
    }
    if (kind === 'monthly') {
      data.monthDays = (field('#drMonthDays').value || '').split(',').map(value => Number(value.trim())).filter(day => Number.isInteger(day) && day >= 1 && day <= 31);
      data.monthDays = [...new Set(data.monthDays)].sort((a, b) => a - b);
      if (!data.monthDays.length) throw new Error('Enter at least one valid day of the month, from 1 to 31.');
    }
    if (kind === 'custom') {
      data.description = field('#drCustomSchedule').value.trim();
      if (!data.description) throw new Error('Describe when this custom recurring routine should happen.');
    }
    return { schedule_kind: kind, schedule_data: data };
  }

  function readActivityRows(routineId, userId) {
    const host = field('#drActivityBuilder');
    const rows = [...(host?.querySelectorAll('[data-activity-row]') || [])];
    const parsed = rows.map((row, index) => {
      const value = selector => row.querySelector(selector)?.value?.trim() || '';
      const id = row.dataset.activityId || makeId();
      const kind = value('[data-activity-field="kind"]') === 'group' ? 'group' : 'activity';
      const durationText = value('[data-activity-field="duration"]');
      const duration = durationText === '' ? null : Number(durationText);
      if (!value('[data-activity-field="title"]')) throw new Error('Every activity and time block needs a name.');
      if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 1440)) throw new Error('Activity duration must be a whole number from 0 to 1440 minutes.');
      return {
        id,
        routine_id: routineId,
        user_id: userId,
        parent_activity_id: kind === 'group' ? null : (value('[data-activity-field="parent"]') || null),
        activity_kind: kind,
        title: value('[data-activity-field="title"]'),
        sort_order: index,
        start_time: value('[data-activity-field="start"]') || null,
        duration_minutes: duration,
        completion_criteria: value('[data-activity-field="criteria"]'),
        instructions: value('[data-activity-field="instructions"]'),
        notes: '',
        updated_at: new Date().toISOString()
      };
    });
    const groupIds = new Set(parsed.filter(row => row.activity_kind === 'group').map(row => row.id));
    if (parsed.some(row => row.parent_activity_id && !groupIds.has(row.parent_activity_id))) throw new Error('Choose a time block that still exists for each grouped activity.');
    return parsed;
  }

  async function saveRoutine(event) {
    event.preventDefault();
    if (!state.available || !state.user) return notify(state.error || 'Routine storage is not available.', 'warning');
    const button = field('#drRoutineSave');
    button.disabled = true;
    try {
      const existingId = field('#drRoutineId').value;
      const schedule = readSchedule();
      const start = field('#drRoutineStart').value || null;
      const end = field('#drRoutineEnd').value || null;
      const durationText = field('#drRoutineDuration').value.trim();
      const enteredDuration = durationText === '' ? null : Number(durationText);
      if (enteredDuration !== null && (!Number.isInteger(enteredDuration) || enteredDuration < 0 || enteredDuration > 1440)) {
        throw new Error('Routine duration must be a whole number from 0 to 1440 minutes.');
      }
      const routineId = existingId || makeId();
      const routineRow = {
        id: routineId,
        user_id: state.user.id,
        name: field('#drRoutineName').value.trim(),
        description: field('#drRoutineDescription').value.trim(),
        purpose: field('#drRoutinePurpose').value.trim(),
        desired_outcome: field('#drRoutineOutcome').value.trim(),
        start_time: start,
        end_time: end,
        duration_minutes: durationBetween(start, end) ?? enteredDuration,
        schedule_kind: schedule.schedule_kind,
        schedule_data: schedule.schedule_data,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        status: field('#drRoutineStatus').value,
        updated_at: new Date().toISOString()
      };
      const activityRows = readActivityRows(routineId, state.user.id);
      const save = existingId
        ? await state.db.from('deliberate_routines').update(routineRow).eq('user_id', state.user.id).eq('id', routineId)
        : await state.db.from('deliberate_routines').insert(routineRow);
      if (save.error) throw save.error;

      const groups = activityRows.filter(row => row.activity_kind === 'group').map(row => ({ ...row, parent_activity_id: null }));
      const activities = activityRows.filter(row => row.activity_kind === 'activity');
      if (groups.length) {
        const result = await state.db.from('deliberate_routine_activities').upsert(groups, { onConflict: 'id' });
        if (result.error) throw result.error;
      }
      if (activities.length) {
        const result = await state.db.from('deliberate_routine_activities').upsert(activities, { onConflict: 'id' });
        if (result.error) throw result.error;
      }
      const keepIds = activityRows.map(row => row.id);
      let deletion = state.db.from('deliberate_routine_activities').delete().eq('user_id', state.user.id).eq('routine_id', routineId);
      if (keepIds.length) deletion = deletion.not('id', 'in', `(${keepIds.join(',')})`);
      const deleted = await deletion;
      if (deleted.error) throw deleted.error;
      closeDialog(field('#drRoutineDialog'));
      await refresh();
      notify(existingId ? 'Routine updated. Previous session snapshots remain available.' : 'Routine created.', 'good');
      setView('routines');
    } catch (error) {
      console.error('Could not save deliberate routine:', error);
      notify(error.message || 'Could not save this routine. Check the fields and try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function exampleRoutines() {
    const morningId = makeId(), daytimeId = makeId(), eveningId = makeId();
    const rows = [];
    const addGroup = (routineId, title, start, duration, activities) => {
      const id = makeId();
      rows.push({ id, routine_id: routineId, user_id: state.user.id, parent_activity_id: null, activity_kind: 'group', title, sort_order: rows.filter(row => row.routine_id === routineId).length, start_time: start, duration_minutes: duration, completion_criteria: '', instructions: '', notes: '' });
      activities.forEach(activity => rows.push({ id: makeId(), routine_id: routineId, user_id: state.user.id, parent_activity_id: id, activity_kind: 'activity', title: activity, sort_order: rows.filter(row => row.routine_id === routineId).length, start_time: null, duration_minutes: null, completion_criteria: '', instructions: '', notes: '' }));
    };
    addGroup(morningId, 'Physical preparation', '06:00', 60, ['Wake up', 'Make bed', 'Brush teeth', 'Go to gym']);
    addGroup(morningId, 'Physical and environmental preparation', '07:00', 60, ['Shower', 'Clean room', 'Eat']);
    addGroup(morningId, 'Psychological foundation', '08:00', 60, ['Review long-term goals', 'Visualize desired future and identity', 'Visualize behaviours for the day', 'Establish clear intentions', 'Create the daily execution plan']);
    rows.push({ id: makeId(), routine_id: daytimeId, user_id: state.user.id, parent_activity_id: null, activity_kind: 'activity', title: 'Translate intentions into observable behaviour', sort_order: 0, start_time: '09:00', duration_minutes: 720, completion_criteria: 'Carry out planned activities and record significant deviations or distractions.', instructions: '', notes: '' });
    addGroup(eveningId, 'Progress evaluation', '21:00', 15, ['Compare planned outcomes with actual achievements']);
    addGroup(eveningId, 'Gap recognition', '21:15', 15, ['Identify differences between intended and actual behaviour']);
    addGroup(eveningId, 'Self-discovery', '21:30', 15, ['Investigate possible causes and recurring patterns']);
    addGroup(eveningId, 'Conscious development', '21:45', 15, ['Identify improvements and reinforce effective behaviours', 'Prepare an experiment for the following day']);
    const routines = [
      { id: morningId, user_id: state.user.id, name: 'Morning Routine', description: 'Prepare physically, organize the environment, and establish a clear intention for the day.', purpose: 'Build a deliberate foundation for the day.', desired_outcome: 'Begin the day prepared and with a clear execution plan.', start_time: '06:00', end_time: '09:00', duration_minutes: 180, schedule_kind: 'daily', schedule_data: { interval: 1 }, status: 'active' },
      { id: daytimeId, user_id: state.user.id, name: 'Daytime Execution', description: 'Translate intention into observable behaviour and record significant deviations or distractions.', purpose: 'Carry the morning intention into the day.', desired_outcome: 'Act on the daily plan and capture meaningful changes in behaviour.', start_time: '09:00', end_time: '21:00', duration_minutes: 720, schedule_kind: 'daily', schedule_data: { interval: 1 }, status: 'active' },
      { id: eveningId, user_id: state.user.id, name: 'Evening Routine', description: 'Review actual outcomes, understand execution gaps, and prepare a conscious development experiment.', purpose: 'Turn the day’s evidence into learning for tomorrow.', desired_outcome: 'Understand what happened and choose a practical next step.', start_time: '21:00', end_time: '22:00', duration_minutes: 60, schedule_kind: 'daily', schedule_data: { interval: 1 }, status: 'active' }
    ].map(row => ({ ...row, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    return { routines, activities: rows };
  }

  async function addExampleTemplate() {
    if (!state.available || !state.user) return notify(state.error || 'Routine storage is not available.', 'warning');
    if (!root.confirm('Add three independently editable example routines: Morning, Daytime Execution, and Evening?')) return;
    try {
      const example = exampleRoutines();
      const savedRoutines = await state.db.from('deliberate_routines').insert(example.routines);
      if (savedRoutines.error) throw savedRoutines.error;
      const groups = example.activities.filter(row => row.activity_kind === 'group');
      const activities = example.activities.filter(row => row.activity_kind === 'activity');
      if (groups.length) {
        const saved = await state.db.from('deliberate_routine_activities').insert(groups);
        if (saved.error) throw saved.error;
      }
      if (activities.length) {
        const saved = await state.db.from('deliberate_routine_activities').insert(activities);
        if (saved.error) throw saved.error;
      }
      await refresh();
      notify('The three example routines are ready to edit independently.', 'good');
    } catch (error) {
      console.error('Could not add the example routines:', error);
      notify('Could not add the example routines. Refresh to check whether any records were saved.', 'error');
    }
  }

  async function startRoutine(routineId) {
    const routine = routineById(routineId);
    if (!routine || routine.status !== 'active') return;
    if (inProgressSession(routineId)) return setView('execution');
    const existingInterrupted = interruptedSession(routineId);
    if (existingInterrupted) return resumeSession(existingInterrupted.id);
    const activities = routineActivityRows(routineId);
    if (!activities.some(row => row.activity_kind === 'activity')) return notify('Add at least one activity before starting this routine.', 'warning');
    const today = localDate();
    const plannedStart = timestampAt(today, routine.start_time);
    let plannedEnd = timestampAt(today, routine.end_time);
    if (plannedEnd && plannedStart && Date.parse(plannedEnd) < Date.parse(plannedStart)) plannedEnd = timestampAt(today, routine.end_time, 1);
    const now = new Date().toISOString();
    const sessionId = makeId();
    const session = {
      id: sessionId,
      user_id: state.user.id,
      routine_id: routine.id,
      scheduled_for: today,
      planned_start_at: plannedStart,
      planned_end_at: plannedEnd,
      actual_started_at: now,
      status: 'in_progress',
      updated_at: now
    };
    const created = await state.db.from('deliberate_routine_sessions').insert(session);
    if (created.error) throw created.error;
    const groupKeyById = new Map(activities.filter(row => row.activity_kind === 'group').map(row => [row.id, row.id]));
    const snapshot = activities.map((activity, index) => ({
      id: makeId(), session_id: sessionId, routine_id: routine.id, user_id: state.user.id,
      source_activity_id: activity.id, activity_key: activity.id,
      parent_activity_key: groupKeyById.get(activity.parent_activity_id) || null,
      activity_kind: activity.activity_kind, activity_title: activity.title,
      sort_order: index, planned_start_time: activity.start_time || null,
      planned_duration_minutes: activity.duration_minutes ?? null,
      completion_criteria: activity.completion_criteria || '', instructions: activity.instructions || '',
      activity_notes: activity.notes || '', status: 'pending', updated_at: now
    }));
    const saved = await state.db.from('deliberate_routine_session_activities').insert(snapshot);
    if (saved.error) {
      console.error('Session created but its activity snapshot could not be saved:', saved.error);
      await state.db.from('deliberate_routine_sessions').update({ status: 'interrupted', updated_at: new Date().toISOString() }).eq('user_id', state.user.id).eq('id', sessionId);
      throw saved.error;
    }
    await refresh();
    setView('execution');
    notify(`${routine.name} started. R-IOS will record each activity only when you update it.`, 'good');
  }

  async function resumeSession(sessionId) {
    const session = state.sessions.find(row => row.id === sessionId);
    if (!session) return;
    if (session.status === 'interrupted') {
      const { error } = await state.db.from('deliberate_routine_sessions').update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('user_id', state.user.id).eq('id', sessionId);
      if (error) throw error;
    }
    await refresh();
    setView('execution');
  }

  async function recordMissed(routineId) {
    const routine = routineById(routineId);
    if (!routine || routine.status !== 'active') return;
    if (!root.confirm('Record today’s planned session as missed? R-IOS does not create missed records automatically.')) return;
    const now = new Date().toISOString();
    let plannedStart = timestampAt(localDate(), routine.start_time);
    let plannedEnd = timestampAt(localDate(), routine.end_time);
    if (plannedEnd && plannedStart && Date.parse(plannedEnd) < Date.parse(plannedStart)) plannedEnd = timestampAt(localDate(), routine.end_time, 1);
    const { error } = await state.db.from('deliberate_routine_sessions').insert({
      user_id: state.user.id, routine_id: routine.id, scheduled_for: localDate(),
      planned_start_at: plannedStart, planned_end_at: plannedEnd,
      status: 'missed', missed_recorded_at: now, updated_at: now
    });
    if (error) throw error;
    await refresh();
    notify('Missed session recorded because you chose to record it.', 'good');
  }

  function readResistance(card) {
    const value = key => card.querySelector(`[data-resistance="${key}"]`)?.value ?? '';
    const occurred = value('occurred');
    const influenced = value('influenced');
    const intensityText = value('intensity');
    const intensity = intensityText === '' ? null : Number(intensityText);
    if (intensity !== null && (!Number.isInteger(intensity) || intensity < 0 || intensity > 10)) throw new Error('Resistance intensity must be a whole number from 0 to 10.');
    return {
      resistance_occurred: occurred === 'yes' ? true : occurred === 'no' ? false : null,
      resistance_nature: value('nature').trim(),
      resistance_intensity: intensity,
      resistance_influenced_execution: influenced === 'yes' ? true : influenced === 'no' ? false : null,
      resistance_response: value('response').trim()
    };
  }

  function executionFields(card) {
    return {
      execution_note: card.querySelector('[data-execution-note]')?.value?.trim() || '',
      ...readResistance(card)
    };
  }

  async function saveItemNotes(activityId) {
    const card = root.document.querySelector(`[data-session-activity-card][data-id="${CSS.escape(activityId)}"]`);
    if (!card) return;
    const fields = executionFields(card);
    const { error } = await state.db.from('deliberate_routine_session_activities').update({ ...fields, updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', activityId);
    if (error) throw error;
    await refresh();
    notify('Execution note and optional self-reported resistance saved.', 'good');
  }

  async function markActivity(activityId, status) {
    const card = root.document.querySelector(`[data-session-activity-card][data-id="${CSS.escape(activityId)}"]`);
    const activity = state.sessionActivities.find(row => row.id === activityId);
    if (!card || !activity) return;
    const now = new Date().toISOString();
    const fields = executionFields(card);
    const row = {
      ...fields,
      status,
      actual_started_at: activity.actual_started_at || (status === 'skipped' ? null : now),
      actual_completed_at: status === 'completed' ? now : null,
      status_recorded_at: now,
      updated_at: now
    };
    const { error } = await state.db.from('deliberate_routine_session_activities').update(row)
      .eq('user_id', state.user.id).eq('id', activityId);
    if (error) throw error;
    await refresh();
    if (typeof state.refreshEvidence === 'function') await state.refreshEvidence();
    else await refresh();
  }

  async function startActivity(activityId) {
    const activity = state.sessionActivities.find(row => row.id === activityId);
    if (!activity) return;
    const { error } = await state.db.from('deliberate_routine_session_activities').update({
      status: 'in_progress', actual_started_at: activity.actual_started_at || new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('user_id', state.user.id).eq('id', activityId);
    if (error) throw error;
    await refresh();
  }

  async function finishSession(sessionId) {
    const session = state.sessions.find(row => row.id === sessionId);
    if (!session) return;
    const summary = sessionSummary(session);
    if (!summary.total || summary.pending) return notify('Record every activity as completed, partially completed or skipped before finishing.', 'warning');
    const status = summary.partial || summary.skipped ? 'partially_completed' : 'completed';
    const { error } = await state.db.from('deliberate_routine_sessions').update({
      status, actual_completed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('user_id', state.user.id).eq('id', sessionId);
    if (error) throw error;
    await refresh();
    if (typeof state.refreshEvidence === 'function') await state.refreshEvidence();
    setView('development');
    notify('Routine session saved. R-IOS can now compare this execution with your other records.', 'good');
  }

  async function interruptSession(sessionId) {
    const { error } = await state.db.from('deliberate_routine_sessions').update({ status: 'interrupted', updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', sessionId);
    if (error) throw error;
    await refresh();
    notify('Session saved. You can resume it from the Execution view.', 'good');
  }

  async function toggleRoutineStatus(routineId) {
    const routine = routineById(routineId);
    if (!routine) return;
    const status = routine.status === 'active' ? 'paused' : 'active';
    const { error } = await state.db.from('deliberate_routines').update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', routineId);
    if (error) throw error;
    await refresh();
    notify(`Routine ${status === 'paused' ? 'paused' : 'activated'}. Existing history is retained.`, 'good');
  }

  function reviewPeriod(type) {
    const current = new Date();
    if (type === 'daily') return periodBounds('daily', current);
    if (type === 'weekly') return periodBounds('weekly', current);
    return periodBounds('monthly', current);
  }

  function openReview(routineId, type = 'daily', reviewId = '') {
    const routine = routineById(routineId);
    if (!routine) return;
    const existing = reviewId ? state.reviews.find(row => row.id === reviewId) : null;
    const bounds = existing ? { start: existing.period_start, end: existing.period_end } : reviewPeriod(type);
    const review = existing || state.reviews.find(row => row.routine_id === routineId && row.review_type === type && row.period_start === bounds.start && row.period_end === bounds.end);
    field('#drReviewRoutineId').value = routineId;
    field('#drReviewType').value = type;
    field('#drReviewStart').value = review?.period_start || bounds.start;
    field('#drReviewEnd').value = review?.period_end || bounds.end;
    field('#drReviewPlanned').value = review?.planned_outcomes || routine.desired_outcome || '';
    field('#drReviewActual').value = review?.actual_outcomes || '';
    field('#drReviewGaps').value = review?.execution_gaps || '';
    field('#drReviewDiscovery').value = review?.self_discovery || '';
    field('#drReviewDevelopment').value = review?.conscious_development || '';
    field('#drReviewExperiment').value = review?.next_experiment || '';
    field('#drReviewDialogTitle').textContent = `${routine.name} review`;
    showDialog(field('#drReviewDialog'));
  }

  async function saveReview(event) {
    event.preventDefault();
    const routineId = field('#drReviewRoutineId').value;
    const start = field('#drReviewStart').value;
    const end = field('#drReviewEnd').value;
    if (!start || !end || end < start) return notify('Choose a valid review period.', 'warning');
    const row = {
      user_id: state.user.id,
      routine_id: routineId,
      review_type: field('#drReviewType').value,
      period_start: start,
      period_end: end,
      planned_outcomes: field('#drReviewPlanned').value.trim(),
      actual_outcomes: field('#drReviewActual').value.trim(),
      execution_gaps: field('#drReviewGaps').value.trim(),
      self_discovery: field('#drReviewDiscovery').value.trim(),
      conscious_development: field('#drReviewDevelopment').value.trim(),
      next_experiment: field('#drReviewExperiment').value.trim(),
      updated_at: new Date().toISOString()
    };
    const { error } = await state.db.from('deliberate_routine_reviews').upsert(row, {
      onConflict: 'routine_id,user_id,review_type,period_start,period_end'
    });
    if (error) throw error;
    closeDialog(field('#drReviewDialog'));
    await refresh();
    notify('Development review saved.', 'good');
  }

  function moveActivity(button, direction) {
    const row = button.closest('[data-activity-row]');
    const host = field('#drActivityBuilder');
    if (!row || !host) return;
    if (direction < 0 && row.previousElementSibling) host.insertBefore(row, row.previousElementSibling);
    if (direction > 0 && row.nextElementSibling) host.insertBefore(row.nextElementSibling, row);
  }

  function bindEvents() {
    const page = $('#deliberateRoutinesRoot');
    if (!page || state.eventsBound) return;
    state.eventsBound = true;
    page.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-deliberate-view]');
      if (viewButton) return setView(viewButton.dataset.deliberateView);
      const periodButton = event.target.closest('[data-routine-period]');
      if (periodButton) {
        state.period = periodButton.dataset.routinePeriod;
        page.querySelectorAll('[data-routine-period]').forEach(button => button.classList.toggle('active', button === periodButton));
        return renderPerformance();
      }
      const button = event.target.closest('[data-routine-action]');
      if (!button) return;
      const action = button.dataset.routineAction;
      const id = button.dataset.id;
      const actions = {
        'new-routine': () => openRoutineEditor(),
        'edit-routine': () => openRoutineEditor(id),
        'add-example': addExampleTemplate,
        'add-activity': () => {
          const host = field('#drActivityBuilder');
          host.insertAdjacentHTML('beforeend', activityRowHtml());
          refreshGroupOptions();
          host.lastElementChild?.querySelector('[data-activity-field="title"]')?.focus();
        },
        'remove-activity': () => { button.closest('[data-activity-row]')?.remove(); refreshGroupOptions(); },
        'move-activity-up': () => moveActivity(button, -1),
        'move-activity-down': () => moveActivity(button, 1),
        'close-routine-dialog': () => closeDialog(field('#drRoutineDialog')),
        'close-review-dialog': () => closeDialog(field('#drReviewDialog')),
        'start-routine': () => startRoutine(id),
        'open-session': () => setView('execution'),
        'resume-session': () => resumeSession(id),
        'record-missed': () => recordMissed(id),
        'start-activity': () => startActivity(id),
        'complete-activity': () => markActivity(id, 'completed'),
        'partial-activity': () => markActivity(id, 'partial'),
        'skip-activity': () => markActivity(id, 'skipped'),
        'save-item-notes': () => saveItemNotes(id),
        'finish-session': () => finishSession(id),
        'interrupt-session': () => interruptSession(id),
        'toggle-routine-status': () => toggleRoutineStatus(id),
        'open-review': () => openReview(id, button.dataset.reviewType || 'daily', button.dataset.reviewId || '')
      };
      if (actions[action]) Promise.resolve().then(actions[action]).catch(error => {
        console.error(`Deliberate routine action ${action} failed:`, error);
        notify(error.message || 'Could not complete this routine action. Refresh and try again.', 'error');
      });
    });
    page.addEventListener('change', event => {
      if (event.target.matches('#drScheduleKind')) setScheduleFields();
      if (event.target.matches('[data-activity-field="kind"], [data-activity-field="title"]')) refreshGroupOptions();
    });
    page.addEventListener('submit', event => {
      if (event.target.id === 'drRoutineForm') saveRoutine(event).catch(error => notify(error.message || 'Could not save this routine.', 'error'));
      if (event.target.id === 'drReviewForm') saveReview(event).catch(error => notify(error.message || 'Could not save this review.', 'error'));
    });
  }

  const api = Object.freeze({
    init(options = {}) {
      state.db = options.db || state.db;
      state.user = options.user || null;
      state.showNotice = options.showNotice || state.showNotice;
      state.refreshEvidence = options.refreshEvidence || state.refreshEvidence;
      state.page = $('#deliberateRoutinesRoot');
      bindEvents();
      if (state.user) refresh();
    },
    refresh,
    reset,
    setView,
    buildObservations,
    durationBetween,
    periodBounds,
    scheduleLabel,
    summarizeRoutine,
    TERMINAL_ACTIVITY_STATES
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RIOSDeliberateRoutines = api;
})(typeof globalThis === 'object' ? globalThis : this);
