(function startRoutineApp() {
  'use strict';

  const SUPABASE_URL = 'https://tmxosoyqflmwqzjgnkez.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_meHq49fLyw8PVNPZxWacnw_SQMj5B-h';
  const PRODUCT_STORAGE_KEY = 'hios_added_products_v1';
  const SOURCE_CATALOG = Object.freeze({
    gios: { id: 'gios', name: 'Goals-IOS', mark: 'G', description: 'Repeated goal progress updates. Goal titles and notes are not imported.' },
    tios: { id: 'tios', name: 'Traders-IOS', mark: 'T', description: 'Trading journals, playbook links, checklists, execution reviews and recorded execution scores.' },
    healthios: { id: 'healthios', name: 'Health-IOS', mark: 'H', description: 'Hydration, sleep, movement, wellbeing check-ins and completed habit indicators. Notes are not imported.' },
    sios: { id: 'sios', name: 'Students-IOS', mark: 'S', description: 'Study session dates and durations. Module names, topic text and notes are not imported.' },
    rios: { id: 'rios', name: 'Deliberate Routines', mark: 'R', description: 'User-recorded execution of routines they deliberately designed.' }
  });
  const SOURCE_ORDER = Object.freeze(['tios', 'gios', 'healthios', 'sios']);
  const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const engine = window.RIOSRoutineEngine;
  const $ = selector => document.querySelector(selector);
  const state = {
    user: null,
    bridge: null,
    sourceEnabled: false,
    sourceConnected: false,
    sourceStatus: 'Loading source settings…',
    sourceSettings: {},
    sourceErrors: [],
    observations: [],
    outcomes: [],
    patterns: [],
    evaluations: [],
    discoveries: [],
    routines: [],
    experiments: [],
    requests: [],
    loading: false,
    eventsBound: false,
    lastRefreshAt: 0,
    activePage: 'overview'
  };

  function parseObject(raw, fallback) {
    try {
      const value = raw ? JSON.parse(raw) : fallback;
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function connectedProducts() {
    try {
      const value = JSON.parse(localStorage.getItem(PRODUCT_STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function showNotice(message, tone = 'info') {
    const box = $('#runtimeNotice');
    if (!box) return;
    box.textContent = message;
    box.className = `notice ${tone}`;
    box.hidden = !message;
  }

  function showAuth(message = '') {
    $('#authScreen').hidden = false;
    $('#rApp').hidden = true;
    if (message) $('#authNotice').textContent = message;
  }

  function showApp() {
    $('#authScreen').hidden = true;
    $('#rApp').hidden = false;
    const email = state.user?.email || state.user?.phone || 'Signed in';
    $('#userLabel').textContent = email;
    const deliberateRoutines = window.RIOSDeliberateRoutines;
    if (typeof deliberateRoutines?.init === 'function') {
      deliberateRoutines.init({
        db,
        user: state.user,
        showNotice,
        refreshEvidence: refreshData
      });
    } else {
      const notice = $('#drStorageNotice');
      if (notice) {
        notice.textContent = 'Deliberate Routines could not start because its script did not load. Refresh the page and try again.';
        notice.hidden = false;
        notice.classList.add('warning');
      }
      console.error('R-IOS deliberate routines module did not load before the authenticated app.');
    }
    window.RIOSRoutineReminders?.init({ db, user: state.user, mode: 'rios', showNotice });
  }

  function setPage(page) {
    state.activePage = page;
    document.querySelectorAll('[data-page]').forEach(section => {
      section.hidden = section.dataset.page !== page;
    });
    document.querySelectorAll('[data-nav-page]').forEach(button => {
      const active = button.dataset.navPage === page;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const current = document.querySelector(`[data-page="${page}"] h2`);
    $('#pageTitle').textContent = current?.textContent || 'R-IOS';
  }

  function dateLabel(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: USER_TIMEZONE }).format(date);
  }

  function numberLabel(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : '—';
  }

  function signedLabel(value, digits = 1, suffix = '') {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number > 0 ? '+' : ''}${number.toFixed(digits)}${suffix}`;
  }

  function statusLabel(status) {
    return ({
      insufficient_evidence: 'Insufficient evidence',
      early_signal: 'Early signal',
      supported_association: 'Supported association',
      positive: 'Positive direction',
      negative: 'Negative direction',
      no_clear_difference: 'No clear difference',
      active: 'Active',
      paused: 'Paused',
      archived: 'Archived',
      planned: 'Planned',
      completed: 'Completed',
      cancelled: 'Cancelled',
      new: 'New discovery',
      adopted: 'Adopted',
      dismissed: 'Dismissed',
      investigating: 'Investigating'
    })[status] || String(status || '—').replaceAll('_', ' ');
  }

  function patternStatusLabel(pattern) {
    return pattern?.evaluation?.outcome_metric === 'none'
      ? 'Repeated activity'
      : statusLabel(pattern?.evaluation?.status);
  }

  function activityLabel(activityKey) {
    return engine.ACTIVITY_LABELS[activityKey] ||
      state.observations.find(row => row.activity_key === activityKey)?.label ||
      activityKey;
  }

  async function readAll(table, columns, orderBy = 'created_at', filters = []) {
    const pageSize = 500;
    const result = [];
    for (let offset = 0; offset < 10000; offset += pageSize) {
      let query = db.from(table).select(columns).eq('user_id', state.user.id);
      filters.forEach(([column, value]) => { query = query.eq(column, value); });
      if (orderBy) query = query.order(orderBy, { ascending: true, nullsFirst: false });
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      result.push(...page);
      if (page.length < pageSize) break;
    }
    return result;
  }

  async function readSource(table, columns, orderBy, errorList, filters = []) {
    try {
      return await readAll(table, columns, orderBy, filters);
    } catch (error) {
      errorList.push(table);
      console.warn(`R-IOS could not read ${table}:`, error);
      return [];
    }
  }

  async function getSourceSetting() {
    const { data, error } = await db.from('routine_source_settings')
      .select('source_product_id,enabled')
      .eq('user_id', state.user.id);
    if (error) throw error;

    state.sourceSettings = Object.fromEntries((data || []).map(row => [
      row.source_product_id,
      { enabled: Boolean(row.enabled) }
    ]));
    state.sourceConnected = connectedProducts().includes('tios');

    // Preserve the original T-IOS connection for existing R-IOS users.
    if (!state.sourceSettings.tios && state.sourceConnected) {
      const { error: insertError } = await db.from('routine_source_settings').upsert({
        user_id: state.user.id,
        source_product_id: 'tios',
        enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,source_product_id' });
      if (insertError) throw insertError;
      state.sourceSettings.tios = { enabled: true };
    }

    state.sourceEnabled = Boolean(state.sourceSettings.tios?.enabled);
    const connected = new Set(connectedProducts());
    const active = SOURCE_ORDER.filter(id => state.sourceSettings[id]?.enabled && connected.has(id));
    state.sourceStatus = active.length
      ? active.length + ' product source' + (active.length === 1 ? ' is' : 's are') + ' actively contributing routine evidence.'
      : 'No product evidence sources are active. Add a product below to begin routine detection.';
  }

  function normalizedTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const time = typeof value === 'number' ? value : Date.parse(String(value));
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function makeProductObservation(productId, table, recordId, activityKey, observedOn, observedAt, details = {}) {
    const id = recordId === null || recordId === undefined ? '' : String(recordId);
    const timestamp = normalizedTimestamp(observedAt);
    const day = engine.dateOnly(String(observedOn || timestamp || ''));
    if (!id || !day || !SOURCE_CATALOG[productId] || !engine.ACTIVITY_LABELS[activityKey]) return null;
    return {
      source_product_id: productId,
      source_table: table,
      source_record_id: id,
      activity_key: activityKey,
      label: engine.ACTIVITY_LABELS[activityKey],
      observed_at: timestamp,
      observed_on: day,
      details,
      source_reference: { product_id: productId, table, record_id: id }
    };
  }

  function loadLocalProductSource(productId) {
    const observations = [];
    const add = (...args) => {
      const row = makeProductObservation(...args);
      if (row) observations.push(row);
    };

    if (productId === 'gios') {
      const goals = JSON.parse(localStorage.getItem('hios_gios_goals_v2') || '[]');
      (Array.isArray(goals) ? goals : []).forEach(goal => {
        if (!goal || goal.level === 'daily') return;
        (Array.isArray(goal.history) ? goal.history : []).forEach((entry, index) => {
          if (!entry || !entry.at) return;
          const recordId = [goal.id || 'goal', entry.at, entry.progress ?? index].join(':');
          add('gios', 'hios_gios_goals_v2', recordId, 'gios_progress_update', entry.at, entry.at, {
            progress_recorded: Number.isFinite(Number(entry.progress))
          });
        });
      });
    }

    if (productId === 'healthios') {
      const health = parseObject(localStorage.getItem('health-ios-v1'), null);
      const days = health?.days && typeof health.days === 'object' ? health.days : {};
      Object.entries(days).forEach(([day, record]) => {
        if (!record || !engine.dateOnly(day)) return;
        if (Number(record.water) > 0) add('healthios', 'health-ios-v1', day + ':hydration', 'health_hydration_logged', day, null);
        if (record.sleep !== null && record.sleep !== undefined && Number.isFinite(Number(record.sleep)) && Number(record.sleep) > 0) {
          add('healthios', 'health-ios-v1', day + ':sleep', 'health_sleep_logged', day, null);
        }
        if (record.movement !== null && record.movement !== undefined && Number.isFinite(Number(record.movement)) && Number(record.movement) >= 0) {
          add('healthios', 'health-ios-v1', day + ':movement', 'health_movement_logged', day, null);
        }
        if (record.checkinSaved === true) add('healthios', 'health-ios-v1', day + ':checkin', 'health_checkin_saved', day, null);
        if (Array.isArray(record.completed) && record.completed.length) {
          add('healthios', 'health-ios-v1', day + ':habits', 'health_habit_completed', day, null, {
            completed_habit_count: record.completed.length
          });
        }
      });
    }

    if (productId === 'sios') {
      const data = parseObject(localStorage.getItem('hios_sios_academic_v1:' + state.user.id), null);
      (Array.isArray(data?.sessions) ? data.sessions : []).forEach((session, index) => {
        if (!session) return;
        const id = session.id || 'session-' + index;
        const observedAt = normalizedTimestamp(session.createdAt);
        add('sios', 'hios_sios_academic_v1', id, 'sios_study_session', session.date || observedAt, observedAt, {
          duration_minutes: Number.isFinite(Number(session.minutes)) ? Number(session.minutes) : null
        });
      });
    }

    return observations;
  }

  async function loadTiosSource() {
    const errors = state.sourceErrors;
    const specs = [
      ['sessions', 'trading_sessions', 'id,session_date,session_label,affirmation_before,signal,noise,strengths,weaknesses,opportunities,threats,adjustments,comments,created_at', 'created_at'],
      ['trades', 'trades', 'id,trade_date,instrument,direction,setup,execution_score,pnl,r_multiple,created_at,opened_at,closed_at,position_status', 'created_at', [['is_deleted', false]]],
      ['planReviews', 'trade_plan_reviews', 'id,trade_id,market_state,entry_pattern,review_notes,exit_rule,created_at', 'created_at'],
      ['planChecks', 'trade_plan_checks', 'id,review_id,section,criterion_key,criterion_label,complied,created_at', 'created_at'],
      ['executionReviews', 'trade_execution_reviews', 'id,trade_id,what_went_well,execution_errors,next_adjustment,notes,created_at', 'created_at'],
      ['executionChecks', 'trade_execution_checks', 'id,review_id,criterion_key,criterion_label,complied,created_at', 'created_at'],
      ['sessionRuleChecks', 'session_rule_checks', 'id,session_id,rule_number,complied,created_at', 'created_at'],
      ['playbookLinks', 'trade_capture_playbook_links', 'trade_id,playbook_id,playbook_name,required_sections,assigned_at,updated_at', 'assigned_at']
    ];
    const pairs = await Promise.all(specs.map(async ([key, table, columns, orderBy, filters]) => [
      key,
      await readSource(table, columns, orderBy, errors, filters || [])
    ]));
    return Object.fromEntries(pairs);
  }

  async function upsertObservations(observations, sourceProductId) {
    if (sourceProductId === 'rios') {
      const { error } = await db.from('routine_observations').delete()
        .eq('user_id', state.user.id)
        .eq('source_product_id', 'rios')
        .in('source_table', ['deliberate_routine_session_activities', 'deliberate_routine_sessions']);
      if (error) throw error;
    }
    const rows = observations.map(row => ({
      ...row,
      user_id: state.user.id,
      source_product_id: sourceProductId,
      updated_at: new Date().toISOString()
    }));
    if (!rows.length) return;
    for (let offset = 0; offset < rows.length; offset += 200) {
      const chunk = rows.slice(offset, offset + 200);
      const { error } = await db.from('routine_observations').upsert(chunk, {
        onConflict: 'user_id,source_product_id,source_table,source_record_id,activity_key'
      });
      if (error) throw error;
    }
  }

  async function loadStoredObservations(sourceProductId) {
    const rows = [];
    const pageSize = 500;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const { data, error } = await db.from('routine_observations')
        .select('source_product_id,source_table,source_record_id,activity_key,label,observed_at,observed_on,details,source_reference')
        .eq('user_id', state.user.id)
        .eq('source_product_id', sourceProductId)
        .order('observed_on', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  async function persistAnalysis(detected, sourceProductId) {
    if (!detected.length) {
      state.patterns = state.patterns.filter(row => row.source_product_id !== sourceProductId);
      state.evaluations = state.evaluations.filter(row => row.source_product_id !== sourceProductId);
      state.discoveries = state.discoveries.filter(row => row.source_product_id !== sourceProductId);
      return;
    }
    const now = new Date().toISOString();
    const sourceName = SOURCE_CATALOG[sourceProductId]?.name || sourceProductId;
    const method = sourceProductId === 'rios'
      ? 'Counts completed, partially completed, and skipped user-recorded routine activities on distinct calendar days. It does not infer psychological resistance or prove that an activity caused an outcome.'
      : sourceProductId === 'tios'
      ? 'Compares mean recorded T-IOS execution scores by distinct trading day, grouped by whether the recorded activity sequence appeared.'
      : 'Counts source-referenced ' + sourceName + ' activity across distinct calendar days. It does not infer a cause or compare unrelated outcomes.';
    const patternRows = detected.map(pattern => ({
      user_id: state.user.id,
      source_product_id: sourceProductId,
      pattern_key: pattern.pattern_key,
      title: pattern.title,
      sequence: pattern.sequence,
      observation_count: pattern.observation_count,
      consistency_percent: pattern.consistency_percent,
      first_observed_on: pattern.first_observed_on,
      last_observed_on: pattern.last_observed_on,
      evaluation_status: pattern.evaluation.status,
      evidence_references: pattern.evidence_references,
      updated_at: now
    }));
    const { data: savedPatterns, error: patternError } = await db.from('routine_patterns')
      .upsert(patternRows, { onConflict: 'user_id,source_product_id,pattern_key' })
      .select('id,pattern_key,title,sequence,observation_count,consistency_percent,first_observed_on,last_observed_on,evaluation_status,evidence_references');
    if (patternError) throw patternError;
    const patternIds = new Map((savedPatterns || []).map(row => [row.pattern_key, row.id]));
    const evaluationRows = detected.filter(pattern => patternIds.has(pattern.pattern_key)).map(pattern => ({
      user_id: state.user.id,
      pattern_id: patternIds.get(pattern.pattern_key),
      status: pattern.evaluation.status,
      direction: pattern.evaluation.direction,
      outcome_metric: pattern.evaluation.outcome_metric,
      with_pattern_days: pattern.evaluation.with_pattern_days,
      without_pattern_days: pattern.evaluation.without_pattern_days,
      with_pattern_mean: pattern.evaluation.with_pattern_mean,
      without_pattern_mean: pattern.evaluation.without_pattern_mean,
      difference: pattern.evaluation.difference,
      evidence_references: pattern.evidence_references,
      method,
      caveat: pattern.evaluation.caveat,
      evaluated_at: now,
      updated_at: now
    }));
    const { data: savedEvaluations, error: evaluationError } = await db.from('routine_evaluations')
      .upsert(evaluationRows, { onConflict: 'user_id,pattern_id' })
      .select('id,pattern_id,status,direction,with_pattern_days,without_pattern_days,with_pattern_mean,without_pattern_mean,difference,evidence_references,caveat,evaluated_at');
    if (evaluationError) throw evaluationError;
    const evaluationsByPattern = new Map((savedEvaluations || []).map(row => [row.pattern_id, row]));

    const { data: oldDiscoveries, error: oldDiscoveryError } = await db.from('routine_discoveries')
      .select('id,discovery_key,status')
      .eq('user_id', state.user.id)
      .eq('source_product_id', sourceProductId);
    if (oldDiscoveryError) throw oldDiscoveryError;
    const oldByKey = new Map((oldDiscoveries || []).map(row => [row.discovery_key, row]));
    const discoveryRows = detected.filter(pattern => patternIds.has(pattern.pattern_key)).map(pattern => {
      const patternId = patternIds.get(pattern.pattern_key);
      const evaluation = pattern.evaluation;
      const copy = engine.discoveryCopy({ ...pattern, source_product_id: sourceProductId });
      const existing = oldByKey.get(pattern.pattern_key);
      return {
        user_id: state.user.id,
        source_product_id: sourceProductId,
        discovery_key: pattern.pattern_key,
        pattern_id: patternId,
        evaluation_id: evaluationsByPattern.get(patternId)?.id || null,
        discovery_type: evaluation.status === 'insufficient_evidence'
          ? 'test_candidate'
          : evaluation.direction === 'positive'
            ? 'positive_association'
            : evaluation.direction === 'negative'
              ? 'negative_association'
              : 'test_candidate',
        title: pattern.title,
        summary: copy.summary,
        recommended_test: copy.recommended_test,
        evidence_references: pattern.evidence_references,
        status: existing?.status || 'new',
        updated_at: now
      };
    });
    const { data: savedDiscoveries, error: discoveryError } = await db.from('routine_discoveries')
      .upsert(discoveryRows, { onConflict: 'user_id,discovery_key' })
      .select('id,source_product_id,discovery_key,pattern_id,evaluation_id,discovery_type,title,summary,recommended_test,evidence_references,status,updated_at');
    if (discoveryError) throw discoveryError;

    const savedByKey = new Map((savedPatterns || []).map(row => [row.pattern_key, row]));
    const nextPatterns = detected.map(pattern => ({
      ...pattern,
      source_product_id: sourceProductId,
      id: patternIds.get(pattern.pattern_key),
      ...savedByKey.get(pattern.pattern_key),
      source_product_id: sourceProductId,
      evaluation: pattern.evaluation
    }));
    const nextEvaluations = evaluationRows.map(row => ({
      ...row,
      source_product_id: sourceProductId,
      ...evaluationsByPattern.get(row.pattern_id)
    }));
    state.patterns = [...state.patterns.filter(row => row.source_product_id !== sourceProductId), ...nextPatterns];
    state.evaluations = [...state.evaluations.filter(row => row.source_product_id !== sourceProductId), ...nextEvaluations];
    state.discoveries = [...state.discoveries.filter(row => row.source_product_id !== sourceProductId), ...(savedDiscoveries || [])];
  }


  async function loadOwnedRows() {
    const [routines, experiments] = await Promise.all([
      db.from('routines').select('*').eq('user_id', state.user.id).order('adopted_at', { ascending: false }),
      db.from('routine_experiments').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false })
    ]);
    if (routines.error) throw routines.error;
    if (experiments.error) throw experiments.error;
    state.routines = routines.data || [];
    state.experiments = experiments.data || [];
  }

  async function loadRoutineRequests() {
    if (!state.bridge) return;
    state.requests = state.bridge.getPendingRequests().filter(signal =>
      signal?.source === 'goals-ios' && signal?.type === 'routine.research.requested'
    );
  }

  function sourceWasConnected() {
    state.sourceConnected = connectedProducts().includes('tios');
    return state.sourceConnected;
  }

  async function refreshData() {
    if (!state.user || state.loading) return;
    state.loading = true;
    $('#refreshData').disabled = true;
    showNotice('Checking connected evidence and updating routine observations…', 'info');
    state.sourceErrors = [];
    state.observations = [];
    state.outcomes = [];
    state.patterns = [];
    state.evaluations = [];
    state.discoveries = [];
    try {
      await getSourceSetting();
      const connected = new Set(connectedProducts());
      state.sourceConnected = connected.has('tios');
      state.sourceEnabled = Boolean(state.sourceSettings.tios?.enabled);
      const activeSources = [...SOURCE_ORDER.filter(id =>
        state.sourceSettings[id]?.enabled && connected.has(id)
      ), 'rios'];

      for (const sourceProductId of activeSources) {
        try {
          let built;
          if (sourceProductId === 'tios') {
            const sources = await loadTiosSource();
            built = engine.buildObservations(sources);
          } else if (sourceProductId === 'rios') {
            built = {
              observations: await window.RIOSDeliberateRoutines?.buildObservations(db, state.user.id, engine) || [],
              outcomes: []
            };
          } else {
            built = { observations: loadLocalProductSource(sourceProductId), outcomes: [] };
          }
          await upsertObservations(built.observations, sourceProductId);
          const stored = await loadStoredObservations(sourceProductId);
          state.observations.push(...stored);
          state.outcomes.push(...built.outcomes);
          const detected = engine.detectPatterns(stored, built.outcomes);
          await persistAnalysis(detected, sourceProductId);
        } catch (error) {
          const name = SOURCE_CATALOG[sourceProductId]?.name || sourceProductId;
          state.sourceErrors.push(name);
          console.warn('R-IOS could not refresh ' + name + ' evidence:', error);
        }
      }

      const checkedCount = state.observations.length;
      const connectedSourceCount = activeSources.length - 1;
      state.sourceStatus = connectedSourceCount
        ? 'Deliberate execution is observed with ' + connectedSourceCount + ' connected product source' + (connectedSourceCount === 1 ? '' : 's') + '; ' + checkedCount + ' current activity records were checked.'
        : 'Deliberate routine execution is observed automatically; no external product evidence sources are connected.';
      await loadOwnedRows();
      await loadRoutineRequests();
      await window.RIOSDeliberateRoutines?.refresh?.();
      renderAll();
      showNotice(state.sourceErrors.length
        ? 'Some product evidence sources are unavailable. Available source activity is still shown.'
        : '', state.sourceErrors.length ? 'warning' : 'info');
    } catch (error) {
      console.error('R-IOS refresh failed:', error);
      const message = /relation .* does not exist|schema cache/i.test(error.message || '')
        ? 'R-IOS database setup is not available yet. Apply the R-IOS schema migration, then refresh.'
        : 'R-IOS could not refresh its data. Check your connection and try again.';
      showNotice(message, 'error');
    } finally {
      state.loading = false;
      state.lastRefreshAt = Date.now();
      $('#refreshData').disabled = false;
      renderSourceControls();
    }
  }


  function evaluationFor(patternId) {
    return state.evaluations.find(row => row.pattern_id === patternId) || null;
  }

  function patternFor(key) {
    return state.patterns.find(row => row.pattern_key === key) || null;
  }

  function renderSourcePicker() {
    const host = $('#sourcePickerList');
    if (!host) return;
    const available = SOURCE_ORDER.filter(id => !state.sourceSettings[id]);
    host.innerHTML = available.length
      ? available.map(id => {
        const product = SOURCE_CATALOG[id];
        const alreadyAdded = connectedProducts().includes(id);
        const actionLabel = alreadyAdded ? 'Connect source' : 'Add and connect';
        return '<div class="source-picker-option">' +
          '<div class="source-icon">' + escapeHtml(product.mark) + '</div>' +
          '<div><b>' + escapeHtml(product.name) + '</b><small>' + escapeHtml(product.description) + '</small></div>' +
          '<button class="button primary" type="button" data-action="add-source" data-id="' + id + '">' + actionLabel + '</button>' +
          '</div>';
      }).join('')
      : '<div class="source-picker-empty">All currently available H-IOS products are already listed as R-IOS sources.</div>';
  }

  function renderSourceControls() {
    const host = $('#sourceCards');
    const connectedProductsList = new Set(connectedProducts());
    const selected = SOURCE_ORDER.filter(id => state.sourceSettings[id]);
    if (host) {
      host.innerHTML = selected.length
        ? selected.map(id => {
          const product = SOURCE_CATALOG[id];
          const connected = connectedProductsList.has(id);
          const enabled = Boolean(state.sourceSettings[id]?.enabled);
          const badge = connected ? (enabled ? 'Connected' : 'Paused') : 'Not added to H-IOS';
          const badgeClass = connected && enabled ? 'pill accent' : 'pill';
          const statusCopy = !connected
            ? 'Add this product to your H-IOS environment to enable its evidence.'
            : enabled
              ? product.name + ' activity is being checked automatically.'
              : product.name + ' evidence use is paused.';
          const sourceRecordCount = state.observations.filter(row => row.source_product_id === id).length;
          const sourceDetailText = connected && enabled
            ? product.name + ' is connected; ' + sourceRecordCount + ' current activity records were checked. Duplicate records are updated by their source reference.'
            : '';
          const connectButton = connected ? '' :
            '<button class="button" type="button" data-action="connect-hios-product" data-id="' + id + '">Add to H-IOS</button>';
          return '<article class="panel source-setting-card" data-source-card="' + id + '">' +
            '<div class="source-setting-heading">' +
              '<div class="source-icon">' + escapeHtml(product.mark) + '</div>' +
              '<div class="source-heading-copy"><p class="eyebrow">H-IOS PRODUCT SOURCE</p><h3>' + escapeHtml(product.name) + '</h3><p class="muted">' + escapeHtml(product.description) + '</p></div>' +
              '<span class="' + badgeClass + ' source-status-pill">' + badge + '</span>' +
            '</div>' +
            '<div class="source-setting-row"><div><b>Use ' + escapeHtml(product.name) + ' evidence in R-IOS</b><small>' + escapeHtml(statusCopy) + '</small></div>' +
              '<label class="switch"><input type="checkbox" data-source-toggle="' + id + '"' + (enabled ? ' checked' : '') + (connected && !state.loading ? '' : ' disabled') + '><span class="switch-slider"></span><span class="sr-only">Use ' + escapeHtml(product.name) + ' evidence</span></label>' +
            '</div>' +
            '<p class="source-detail">' + escapeHtml(sourceDetailText) + '</p>' +
            '<div class="source-setting-footer"><span class="muted source-footer-copy">Routine-relevant activity only. Imported evidence stays private to your account.</span>' +
              '<div class="source-actions">' + connectButton +
                '<button class="button danger-quiet" type="button" data-action="clear-source-evidence" data-id="' + id + '">Delete imported evidence</button>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('')
        : '<article class="panel source-setting-card"><div class="source-picker-empty">No products are connected as evidence sources yet. Use <b>Add another product</b> to choose a product from your H-IOS environment.</div></article>';
    }

    const active = selected.filter(id => state.sourceSettings[id]?.enabled && connectedProductsList.has(id));
    const badge = $('#overviewSourceStatusBadge');
    if (badge) {
      badge.textContent = active.length ? 'Connected' : 'No sources';
      badge.className = 'ri-badge ' + (active.length ? 'good' : 'muted');
    }
    const detail = $('#overviewSourceDetail');
    if (detail) detail.textContent = state.sourceStatus;
    renderSourcePicker();
  }

  async function addSource(productId) {
    if (!SOURCE_CATALOG[productId] || state.sourceSettings[productId]) return;
    const { error } = await db.from('routine_source_settings').upsert({
      user_id: state.user.id,
      source_product_id: productId,
      enabled: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,source_product_id' });
    if (error) throw error;

    const products = new Set(connectedProducts());
    products.add(productId);
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify([...products]));
    state.sourceSettings[productId] = { enabled: true };
    const picker = $('#sourcePicker');
    if (picker) picker.open = false;
    await refreshData();
    showNotice(SOURCE_CATALOG[productId].name + ' is now connected to R-IOS. Repeated activity will appear as enough records accumulate.', 'good');
  }

  async function connectHiosProduct(productId) {
    if (!SOURCE_CATALOG[productId]) return;
    const products = new Set(connectedProducts());
    products.add(productId);
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify([...products]));
    if (!state.sourceSettings[productId]) {
      const { error } = await db.from('routine_source_settings').upsert({
        user_id: state.user.id,
        source_product_id: productId,
        enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,source_product_id' });
      if (error) throw error;
      state.sourceSettings[productId] = { enabled: true };
    }
    await refreshData();
    showNotice(SOURCE_CATALOG[productId].name + ' has been added to your H-IOS environment and connected to R-IOS.', 'good');
  }

  async function updateSourceSetting(productId, enabled) {
    if (!SOURCE_CATALOG[productId] || !connectedProducts().includes(productId)) return;
    const { error } = await db.from('routine_source_settings').upsert({
      user_id: state.user.id,
      source_product_id: productId,
      enabled,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,source_product_id' });
    if (error) throw error;
    state.sourceSettings[productId] = { enabled };
    if (productId === 'tios') state.sourceEnabled = enabled;
    await refreshData();
  }


  function renderOverview() {
    const activeRoutines = state.routines.filter(row => row.status === 'active');
    const meanConsistency = activeRoutines.length
      ? activeRoutines.reduce((total, routine) => total + (Number(patternFor(JSON.stringify(routine.target_sequence))?.consistency_percent) || 0), 0) / activeRoutines.length
      : null;
    $('#metricPatterns').textContent = String(state.patterns.length);
    $('#metricDiscoveries').textContent = String(state.discoveries.filter(row => row.status === 'new' || row.status === 'investigating').length);
    $('#metricConsistency').textContent = meanConsistency === null ? '—' : `${numberLabel(meanConsistency)}%`;
    $('#metricRoutines').textContent = String(activeRoutines.length);
    $('#metricObservations').textContent = String(state.observations.length);
    $('#sourceStatusCard').textContent = state.sourceStatus;

    const patternsHost = $('#overviewPatterns');
    patternsHost.innerHTML = state.patterns.length
      ? state.patterns.slice(0, 4).map(pattern => `<article class="ri-mini-row"><div><b>${escapeHtml(pattern.title)}</b><small>${pattern.observation_count} distinct days · ${numberLabel(pattern.consistency_percent)}% consistency</small></div><span class="ri-badge">${escapeHtml(patternStatusLabel(pattern))}</span></article>`).join('')
      : `<div class="ri-empty">No repeated activity patterns are available yet.</div>`;

    const evaluationsHost = $('#overviewEvaluations');
    const recentEvaluations = state.patterns.slice(0, 4);
    evaluationsHost.innerHTML = recentEvaluations.length
      ? recentEvaluations.map(pattern => {
        const evaluation = pattern.evaluation;
        const comparison = evaluation.with_pattern_mean === null
          ? 'Outcome comparison unavailable.'
          : `Execution score average: ${numberLabel(evaluation.with_pattern_mean, 2)} on pattern days; ${numberLabel(evaluation.without_pattern_mean, 2)} on comparison days.`;
        return `<article class="ri-mini-row"><div><b>${escapeHtml(pattern.title)}</b><small>${escapeHtml(comparison)}</small></div><span class="ri-badge">${escapeHtml(statusLabel(evaluation.status))}</span></article>`;
      }).join('')
      : `<div class="ri-empty">Routine evaluations will appear after repeated behavior and outcome records are available.</div>`;

    const discoveriesHost = $('#overviewDiscoveries');
    const recentDiscoveries = state.discoveries.filter(row => row.status !== 'dismissed').slice(0, 4);
    discoveriesHost.innerHTML = recentDiscoveries.length
      ? recentDiscoveries.map(discovery => `<article class="ri-mini-row"><div><b>${escapeHtml(discovery.title)}</b><small>${escapeHtml(discovery.discovery_type.replaceAll('_', ' '))} · ${escapeHtml(statusLabel(discovery.status))}</small></div><span class="ri-badge ${discovery.discovery_type.includes('positive') ? 'good' : discovery.discovery_type.includes('negative') ? 'warning' : 'muted'}">${escapeHtml(discovery.discovery_type.replace('_association', ''))}</span></article>`).join('')
      : `<div class="ri-empty">No evidence-backed discoveries are available yet.</div>`;

    renderGoalResearchRequests();
  }

  function renderPatternCards() {
    const host = $('#detectedRoutinesList');
    host.innerHTML = state.patterns.length
      ? state.patterns.map(pattern => `
        <article class="ri-card">
          <div class="ri-card-head"><div><span class="ri-kicker">${escapeHtml(SOURCE_CATALOG[pattern.source_product_id]?.name || pattern.source_product_id)}</span><h3>${escapeHtml(pattern.title)}</h3></div><span class="ri-badge">${escapeHtml(patternStatusLabel(pattern))}</span></div>
          <div class="ri-sequence">${pattern.sequence.map(key => `<span>${escapeHtml(activityLabel(key))}</span>`).join('<b aria-hidden="true">→</b>')}</div>
          <div class="ri-facts"><div><small>Recorded days</small><b>${pattern.observation_count}</b></div><div><small>Consistency</small><b>${numberLabel(pattern.consistency_percent)}%</b></div><div><small>First detected</small><b>${escapeHtml(dateLabel(pattern.first_observed_on))}</b></div><div><small>Last occurrence</small><b>${escapeHtml(dateLabel(pattern.last_observed_on))}</b></div></div>
          <details class="ri-evidence"><summary>Inspect source evidence</summary><div>${pattern.evidence_references.slice(-8).map(ref => `<div class="ri-reference"><b>${escapeHtml(dateLabel(ref.observed_on))}</b><span>${ref.source_references.map(source => `${escapeHtml(source.table || source.source_table)} · ${escapeHtml(source.record_id || source.source_record_id)}`).join(' · ')}</span></div>`).join('')}</div></details>
        </article>`).join('')
      : `<div class="ri-empty ri-large-empty"><b>No routines detected yet</b><p>${SOURCE_ORDER.some(id => state.sourceSettings[id]?.enabled && connectedProducts().includes(id)) ? 'R-IOS has not found repeated activity in connected H-IOS products yet. Keep recording activity and refresh evidence as new records are added.' : 'Add a product source below to begin evidence-based routine detection.'}</p></div>`;
  }

  function renderDiscoveries() {
    const host = $('#discoveriesList');
    const active = state.discoveries.filter(row => row.status !== 'dismissed');
    host.innerHTML = active.length
      ? active.map(discovery => `
        <article class="ri-card">
          <div class="ri-card-head"><div><span class="ri-kicker">${escapeHtml(discovery.discovery_type.replaceAll('_', ' '))}</span><h3>${escapeHtml(discovery.title)}</h3></div><span class="ri-badge">${escapeHtml(statusLabel(discovery.status))}</span></div>
          <p class="ri-body">${escapeHtml(discovery.summary)}</p>
          <div class="ri-hypothesis"><b>Test suggestion</b><p>${escapeHtml(discovery.recommended_test)}</p></div>
          <div class="ri-card-actions">
            ${discovery.source_product_id === 'rios'
              ? `<button class="ri-button primary" type="button" data-action="open-deliberate" data-id="${escapeHtml(discovery.id)}">View deliberate performance</button>`
              : `<button class="ri-button primary" type="button" data-action="adopt" data-id="${escapeHtml(discovery.id)}">Adopt for observation</button>`}
            <button class="ri-button" type="button" data-action="investigate" data-id="${escapeHtml(discovery.id)}">Investigate evidence</button>
            <button class="ri-button quiet" type="button" data-action="dismiss" data-id="${escapeHtml(discovery.id)}">Dismiss</button>
          </div>
        </article>`).join('')
      : `<div class="ri-empty ri-large-empty"><b>No routine discoveries yet</b><p>R-IOS will show evidence-backed hypotheses after it observes repeated activity in your connected product sources. It will not create sample findings.</p></div>`;
  }

  function renderResearch() {
    const host = $('#researchList');
    host.innerHTML = state.patterns.length
      ? state.patterns.map(pattern => {
        const evaluation = pattern.evaluation;
        const comparison = evaluation.with_pattern_mean === null
          ? 'Repeated activity was detected; this source may not provide comparable outcome data, so no relationship is inferred.'
          : `${numberLabel(evaluation.with_pattern_mean, 2)} average score across ${evaluation.with_pattern_days} pattern days; ${numberLabel(evaluation.without_pattern_mean, 2)} across ${evaluation.without_pattern_days} comparison days.`;
        return `<article class="ri-card">
          <div class="ri-card-head"><div><span class="ri-kicker">Routine research</span><h3>${escapeHtml(pattern.title)}</h3></div><span class="ri-badge">${escapeHtml(statusLabel(evaluation.status))}</span></div>
          <div class="ri-research-metrics"><div><small>Pattern days with recorded outcomes</small><b>${evaluation.with_pattern_days}</b></div><div><small>Comparison days</small><b>${evaluation.without_pattern_days}</b></div><div><small>Difference</small><b>${evaluation.difference === null ? '—' : numberLabel(evaluation.difference, 2)}</b></div></div>
          <p class="ri-body">${escapeHtml(comparison)}</p>
          <p class="ri-caveat">${escapeHtml(evaluation.caveat)}</p>
        </article>`;
      }).join('')
      : `<div class="ri-empty ri-large-empty"><b>Research is waiting for evidence</b><p>Repeated activity is detected from connected products. Outcome comparisons appear only when a source provides enough comparable outcome records.</p></div>`;
  }

  function experimentFor(routineId) {
    return state.experiments.find(row => row.routine_id === routineId && row.status === 'active') || null;
  }

  function routinePattern(routine) {
    return routine.pattern_id ? state.patterns.find(pattern => pattern.id === routine.pattern_id) : null;
  }

  function renderRoutines() {
    const host = $('#myRoutinesList');
    host.innerHTML = state.routines.length
      ? state.routines.map(routine => {
        const pattern = routinePattern(routine);
        const activeExperiment = experimentFor(routine.id);
        const completedExperiment = state.experiments.find(row => row.routine_id === routine.id && row.status === 'completed') || null;
        const sequence = Array.isArray(routine.target_sequence) ? routine.target_sequence : [];
        const consistency = pattern ? `${numberLabel(pattern.consistency_percent)}%` : 'Collecting evidence';
        return `<article class="ri-card">
          <div class="ri-card-head"><div><span class="ri-kicker">${escapeHtml(SOURCE_CATALOG[routine.source_product_id]?.name || routine.source_product_id.toUpperCase())} · ${escapeHtml(statusLabel(routine.status))}</span><h3>${escapeHtml(routine.name)}</h3></div><span class="ri-badge">${escapeHtml(consistency)}</span></div>
          <div class="ri-sequence">${sequence.map(key => `<span>${escapeHtml(engine.ACTIVITY_LABELS[key] || key)}</span>`).join('<b aria-hidden="true">→</b>')}</div>
          <p class="ri-body">${escapeHtml(routine.description || 'Adopted for ongoing observation.')}</p>
          <details class="ri-edit"><summary>Adjust routine details</summary><label>Routine name<input data-routine-field="name" value="${escapeHtml(routine.name)}" maxlength="120"></label><label>Observation note<textarea data-routine-field="description" rows="2" maxlength="600">${escapeHtml(routine.description || '')}</textarea></label><button class="ri-button" type="button" data-action="save-routine" data-id="${escapeHtml(routine.id)}">Save details</button></details>
          ${activeExperiment ? `<div class="ri-experiment"><b>Active test started ${escapeHtml(dateLabel(activeExperiment.started_at))}</b><small>R-IOS will compare new activity from this routine's source with the stored baseline.</small></div>` : ''}
          ${completedExperiment ? `<div class="ri-experiment"><b>Latest test completed ${escapeHtml(dateLabel(completedExperiment.ended_at))}</b><small>Routine consistency change: ${escapeHtml(signedLabel(completedExperiment.results?.routine_consistency_change_points, 1, ' points'))} · ${routine.source_product_id === 'tios' ? 'Execution-score mean change: ' + escapeHtml(signedLabel(completedExperiment.results?.execution_score_mean_change, 2)) : 'Outcome comparison unavailable for this product source.'} These comparisons are observational.</small></div>` : ''}
          <div class="ri-card-actions">
            <button class="ri-button" type="button" data-action="toggle-routine" data-id="${escapeHtml(routine.id)}">${routine.status === 'active' ? 'Pause' : 'Resume'}</button>
            ${activeExperiment ? `<button class="ri-button primary" type="button" data-action="complete-experiment" data-id="${escapeHtml(activeExperiment.id)}">Complete test</button>` : `<button class="ri-button primary" type="button" data-action="start-experiment" data-id="${escapeHtml(routine.id)}" ${routine.status !== 'active' ? 'disabled' : ''}>Start a test</button>`}
          </div>
        </article>`;
      }).join('')
      : `<div class="ri-empty ri-large-empty"><b>No routines adopted</b><p>Adopt a routine discovery to monitor it here. R-IOS does not require you to build task lists by hand.</p></div>`;
  }

  function renderGoalResearchRequests() {
    const host = $('#goalResearchRequests');
    if (!host) return;
    const requests = state.requests.filter(signal => signal.status === 'pending');
    host.innerHTML = requests.length
      ? requests.map(signal => {
        const request = signal.payload?.request || {};
        return `<article class="ri-mini-row"><div><b>${escapeHtml(request.area || 'G-IOS progress gap')}</b><small>${escapeHtml(request.gapSummary || request.gap_summary || 'G-IOS requested routine research.')}</small></div><button class="ri-button small" type="button" data-action="investigate-goal-request" data-id="${escapeHtml(signal.signalId)}">Review</button></article>`;
      }).join('')
      : `<div class="ri-empty">G-IOS routine research requests will appear here when sent.</div>`;
  }

  function renderAll() {
    renderSourceControls();
    renderOverview();
    renderPatternCards();
    renderDiscoveries();
    renderResearch();
    renderRoutines();
    renderGoalResearchRequests();
  }

  async function recordFeedback(action, fields = {}) {
    const { error } = await db.from('routine_feedback').insert({
      user_id: state.user.id,
      action,
      feedback: fields.feedback || '',
      discovery_id: fields.discovery_id || null,
      routine_id: fields.routine_id || null,
      experiment_id: fields.experiment_id || null,
      metadata: fields.metadata || {}
    });
    if (error) throw error;
  }

  async function adoptDiscovery(discoveryId) {
    const discovery = state.discoveries.find(row => row.id === discoveryId);
    const pattern = discovery ? patternFor(discovery.discovery_key) : null;
    if (!discovery || !pattern) return;
    const row = {
      user_id: state.user.id,
      discovery_id: discovery.id,
      pattern_id: pattern.id,
      source_product_id: discovery.source_product_id,
      name: discovery.title,
      description: discovery.summary,
      target_sequence: pattern.sequence,
      status: 'active',
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('routines').upsert(row, {
      onConflict: 'user_id,discovery_id',
      ignoreDuplicates: true
    });
    if (error) throw error;
    await db.from('routine_discoveries').update({ status: 'adopted', updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', discoveryId);
    await recordFeedback('adopted', { discovery_id: discoveryId, metadata: { pattern_key: discovery.discovery_key } });
    await loadOwnedRows();
    await loadRoutineRequests();
    renderAll();
  }

  async function dismissDiscovery(discoveryId) {
    const { error } = await db.from('routine_discoveries').update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', discoveryId);
    if (error) throw error;
    await recordFeedback('dismissed', { discovery_id: discoveryId });
    await refreshData();
  }

  async function investigateDiscovery(discoveryId) {
    const { error } = await db.from('routine_discoveries').update({ status: 'investigating', updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', discoveryId);
    if (error) throw error;
    await recordFeedback('investigated', { discovery_id: discoveryId });
    setPage('research');
    await refreshData();
  }

  function outcomeSnapshot(outcomes) {
    const scores = outcomes.map(row => Number(row.execution_score)).filter(Number.isFinite);
    return {
      scored_trade_count: scores.length,
      mean_execution_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      observed_days: [...new Set(outcomes.map(row => row.observed_on).filter(Boolean))].length
    };
  }

  function sequenceBehaviorSnapshot(sequence, observations, sourceProductId) {
    const sourceObservations = observations.filter(row => !sourceProductId || row.source_product_id === sourceProductId);
    const observed = engine.sequenceOccurrences(sourceObservations);
    const sequenceKey = JSON.stringify(Array.isArray(sequence) ? sequence : []);
    const matched = observed.occurrences.get(sequenceKey);
    const sequenceDays = matched ? matched.days.size : 0;
    const activeDays = observed.activeDays.length;
    const sourceName = SOURCE_CATALOG[sourceProductId]?.name || 'connected product';
    return {
      sequence_days: sequenceDays,
      active_days: activeDays,
      consistency_percent: activeDays ? Math.round(sequenceDays / activeDays * 1000) / 10 : null,
      evidence_window: 'Recorded dates from ' + sourceName
    };
  }

  async function startExperiment(routineId) {
    if (state.loading) return;
    await refreshData();
    const routine = state.routines.find(row => row.id === routineId);
    if (!routine || routine.status !== 'active') return;
    const now = new Date().toISOString();
    const routineOutcomes = routine.source_product_id === 'tios' ? state.outcomes : [];
    const baseline = {
      ...outcomeSnapshot(routineOutcomes),
      routine_behavior: sequenceBehaviorSnapshot(routine.target_sequence, state.observations, routine.source_product_id)
    };
    const { data, error } = await db.from('routine_experiments').insert({
      user_id: state.user.id,
      routine_id: routine.id,
      status: 'active',
      baseline,
      results: {},
      started_at: now,
      updated_at: now
    }).select('*').single();
    if (error) throw error;
    await recordFeedback('experiment_started', { routine_id: routine.id, experiment_id: data.id, metadata: { baseline } });
    await loadOwnedRows();
    renderAll();
  }

  async function completeExperiment(experimentId) {
    if (state.loading) return;
    await refreshData();
    const experiment = state.experiments.find(row => row.id === experimentId);
    if (!experiment) return;
    const startedAt = Date.parse(experiment.started_at || '');
    const routine = state.routines.find(row => row.id === experiment.routine_id);
    const startedDay = engine.dateOnly(experiment.started_at || '');
    const afterObservations = state.observations.filter(row => {
      if (row.source_product_id !== routine?.source_product_id) return false;
      const observedAt = Date.parse(row.observed_at || '');
      if (Number.isFinite(startedAt) && Number.isFinite(observedAt)) return observedAt >= startedAt;
      return Boolean(startedDay && row.observed_on > startedDay);
    });
    const afterBehavior = sequenceBehaviorSnapshot(routine?.target_sequence, afterObservations, routine?.source_product_id);
    const afterOutcomes = routine?.source_product_id === 'tios' ? state.outcomes.filter(row => {
      const observedAt = Date.parse(row.observed_at || '');
      return Number.isFinite(startedAt) && Number.isFinite(observedAt) && observedAt >= startedAt;
    }) : [];
    const rawBeforeMean = experiment.baseline?.mean_execution_score;
    const beforeMean = rawBeforeMean === null || rawBeforeMean === undefined ? null : Number(rawBeforeMean);
    const afterMean = outcomeSnapshot(afterOutcomes).mean_execution_score;
    const rawBeforeConsistency = experiment.baseline?.routine_behavior?.consistency_percent;
    const beforeConsistency = rawBeforeConsistency === null || rawBeforeConsistency === undefined ? null : Number(rawBeforeConsistency);
    const result = {
      recorded_observation_count: afterObservations.length,
      routine_behavior_before: experiment.baseline?.routine_behavior || null,
      routine_behavior_after: afterBehavior,
      routine_consistency_change_points: Number.isFinite(beforeConsistency) && afterBehavior.consistency_percent !== null
        ? afterBehavior.consistency_percent - beforeConsistency
        : null,
      post_start_outcomes: outcomeSnapshot(afterOutcomes),
      execution_score_mean_change: Number.isFinite(beforeMean) && afterMean !== null ? afterMean - beforeMean : null,
      note: 'Only recorded activity from the routine source after the test started is included. Date-only activity is counted on days after the start date; it is not assigned to the start day. Outcome comparisons are available only when the source records a relevant metric.'
    };
    const { error } = await db.from('routine_experiments').update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      results: result,
      updated_at: new Date().toISOString()
    }).eq('user_id', state.user.id).eq('id', experimentId);
    if (error) throw error;
    await recordFeedback('experiment_completed', { routine_id: experiment.routine_id, experiment_id: experimentId, metadata: result });
    await loadOwnedRows();
    renderAll();
  }

  async function toggleRoutine(routineId) {
    const routine = state.routines.find(row => row.id === routineId);
    if (!routine) return;
    const status = routine.status === 'active' ? 'paused' : 'active';
    const { error } = await db.from('routines').update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', routineId);
    if (error) throw error;
    await recordFeedback('edited', { routine_id: routineId, metadata: { status } });
    await loadOwnedRows();
    renderAll();
  }

  async function updateRoutineDetails(routineId, button) {
    const card = button.closest('.ri-card');
    const name = card?.querySelector('[data-routine-field="name"]')?.value.trim();
    const description = card?.querySelector('[data-routine-field="description"]')?.value.trim() || '';
    if (!name) {
      showNotice('A routine name is required.', 'warning');
      return;
    }
    const { error } = await db.from('routines').update({ name, description, updated_at: new Date().toISOString() })
      .eq('user_id', state.user.id).eq('id', routineId);
    if (error) throw error;
    await recordFeedback('edited', { routine_id: routineId, metadata: { name_changed: true, description_changed: true } });
    await loadOwnedRows();
    renderAll();
    showNotice('Routine details saved.', 'good');
  }

  async function clearImportedEvidence(sourceProductId) {
    const product = SOURCE_CATALOG[sourceProductId];
    if (!product) return;
    if (!window.confirm('Delete R-IOS stored observations and detections imported from ' + product.name + '? Adopted routines will remain, but their discovery links may be cleared.')) return;
    const patterns = await db.from('routine_patterns').delete().eq('user_id', state.user.id).eq('source_product_id', sourceProductId);
    if (patterns.error) throw patterns.error;
    const observations = await db.from('routine_observations').delete().eq('user_id', state.user.id).eq('source_product_id', sourceProductId);
    if (observations.error) throw observations.error;
    showNotice('Stored ' + product.name + ' observations and derived detections were deleted.', 'good');
    await refreshData();
  }


  function isTradingArea(area) {
    return /trad|market|investment|finance/i.test(String(area || ''));
  }

  function researchSourcesForArea(area, activeSourceIds) {
    const label = String(area || '');
    if (isTradingArea(label)) return activeSourceIds.filter(id => id === 'tios');
    if (/health|wellbeing|fitness|sleep|movement/i.test(label)) return activeSourceIds.filter(id => id === 'healthios' || id === 'gios');
    if (/study|student|education|school|university|engineering|learning|academic/i.test(label)) {
      return activeSourceIds.filter(id => id === 'sios' || id === 'gios');
    }
    return activeSourceIds;
  }

  function researchResponseFor(request) {
    const area = request?.area || '';
    const connected = new Set(connectedProducts());
    const activeSourceIds = SOURCE_ORDER.filter(id => state.sourceSettings[id]?.enabled && connected.has(id));
    if (!activeSourceIds.length) {
      return {
        status: 'insufficient_evidence',
        summary: 'R-IOS does not currently have permission to use any product evidence. Add a source and enable it in R-IOS Sources before evaluating this progress gap.',
        evidence_references: [],
        recommended_next_step: 'Add and enable a product source in R-IOS Sources, then request research again.'
      };
    }

    const matchingSourceIds = researchSourcesForArea(area, activeSourceIds);
    if (!matchingSourceIds.length) {
      const requested = isTradingArea(area) ? 'Trading' : 'this focus area';
      return {
        status: 'insufficient_evidence',
        summary: 'The requested focus area is ' + (area || 'not specified') + '. No connected evidence source currently matches ' + requested + '.',
        evidence_references: [],
        recommended_next_step: 'Add the relevant H-IOS product as an R-IOS source, then request research again.'
      };
    }

    const candidates = state.patterns.filter(pattern => matchingSourceIds.includes(pattern.source_product_id)).slice(0, 3);
    if (!candidates.length) {
      const sourceNames = matchingSourceIds.map(id => SOURCE_CATALOG[id]?.name || id).join(', ');
      return {
        status: 'insufficient_evidence',
        summary: 'No repeated activity sequence is available for ' + (area || 'this focus area') + ' yet. R-IOS checked ' + sourceNames + ' and has not generated a discovery from this request.',
        evidence_references: [],
        recommended_next_step: 'Continue recording relevant activity in ' + sourceNames + ', then request research again.'
      };
    }

    const supported = candidates.filter(pattern => pattern.evaluation.status !== 'insufficient_evidence');
    const summary = candidates.map(pattern => {
      if (pattern.evaluation.status !== 'insufficient_evidence') return engine.discoveryCopy(pattern).summary;
      const sourceName = SOURCE_CATALOG[pattern.source_product_id]?.name || pattern.source_product_id;
      return pattern.title + ' repeated on ' + pattern.observation_count + ' distinct days in ' + sourceName +
        '. R-IOS has not received enough comparable outcome records to evaluate a relationship with this goal.';
    }).join(' ');
    return {
      status: supported.length ? 'evaluated' : 'insufficient_evidence',
      summary,
      evidence_references: candidates.flatMap(pattern => pattern.evidence_references).slice(0, 20),
      recommended_next_step: supported.length
        ? 'Treat this as a research lead. Test the candidate sequence across future comparable days and review new evidence.'
        : 'Keep collecting relevant activity and comparable progress outcomes. R-IOS will revise the research summary as evidence grows.'
    };
  }


  async function respondToGoalRequest(signal) {
    if (!signal) return;
    const request = signal?.payload?.request || {};
    const button = document.querySelector(`[data-action="investigate-goal-request"][data-id="${CSS.escape(signal.signalId)}"]`);
    if (button) button.disabled = true;
    await refreshData();
    const result = researchResponseFor(request);
    const response = {
      schema: 'hios.routine-research-response.v1',
      requestId: request.requestId,
      source: 'r-ios',
      target: 'goals-ios',
      area: request.area || null,
      status: result.status,
      summary: result.summary,
      evidence_references: result.evidence_references,
      recommended_next_step: result.recommended_next_step,
      respondedAt: new Date().toISOString()
    };
    const emitted = state.bridge?.emit('routine.research.responded', { response }, { requestId: request.requestId });
    if (!emitted?.ok) {
      showNotice('R-IOS could not return the research result to G-IOS. Open G-IOS and try again.', 'error');
      if (button) button.disabled = false;
      return;
    }
    state.bridge.acknowledgeRequest(signal.signalId, { requestId: request.requestId, status: response.status }, signal);
    await recordFeedback('investigated', { metadata: { request_id: request.requestId, area: request.area || null, response_status: response.status } });
    await loadRoutineRequests();
    renderAll();
    showNotice('Research response sent to G-IOS. The result is an evidence summary, not a guarantee.', 'good');
  }

  async function investigateGoalRequest(signal) {
    if (state.loading || !signal) return;
    await refreshData();
    await respondToGoalRequest(signal);
  }

  async function processPendingGoalRequests() {
    await loadRoutineRequests();
    const pending = state.requests.filter(signal => signal.status === 'pending');
    for (const signal of pending) {
      try {
        await respondToGoalRequest(signal);
      } catch (error) {
        console.error('R-IOS could not return a G-IOS research response:', error);
        showNotice('A G-IOS research request is still waiting. R-IOS could not return its response yet.', 'error');
      }
    }
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;
    document.querySelectorAll('[data-nav-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.navPage)));
    $('#refreshData').addEventListener('click', refreshData);
    $('#signOut').addEventListener('click', async () => {
      await db.auth.signOut();
      window.location.href = 'index.html';
    });
    $('#sourceCards').addEventListener('change', event => {
      const toggle = event.target.closest('[data-source-toggle]');
      if (!toggle) return;
      const productId = toggle.dataset.sourceToggle;
      updateSourceSetting(productId, Boolean(toggle.checked)).catch(error => {
        console.error('Could not update the ' + productId + ' source setting:', error);
        toggle.checked = Boolean(state.sourceSettings[productId]?.enabled);
        showNotice('Could not update this product evidence setting.', 'error');
      });
    });
    document.body.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action, id } = button.dataset;
      const actions = {
        adopt: () => adoptDiscovery(id),
        'open-deliberate': () => { setPage('deliberate'); window.RIOSDeliberateRoutines?.setView('development'); },
        dismiss: () => dismissDiscovery(id),
        investigate: () => investigateDiscovery(id),
        'start-experiment': () => startExperiment(id),
        'complete-experiment': () => completeExperiment(id),
        'toggle-routine': () => toggleRoutine(id),
        'save-routine': () => updateRoutineDetails(id, button),
        'add-source': () => addSource(id),
        'connect-hios-product': () => connectHiosProduct(id),
        'clear-source-evidence': () => clearImportedEvidence(id),
        'investigate-goal-request': () => investigateGoalRequest(state.requests.find(row => row.signalId === id))
      };
      const run = actions[action];
      if (run) run().catch(error => {
        console.error(`R-IOS action ${action} failed:`, error);
        showNotice('R-IOS could not complete that action. Refresh and try again.', 'error');
      });
    });
    window.addEventListener('storage', event => {
      const sourceKeys = [PRODUCT_STORAGE_KEY, 'hios_gios_goals_v2', 'health-ios-v1'];
      if (event.key === null || sourceKeys.includes(event.key) ||
          String(event.key || '').startsWith('hios_sios_academic_v1:')) refreshData();
    });
    const refreshWhenVisible = () => {
      if (state.user && document.visibilityState === 'visible' && Date.now() - state.lastRefreshAt > 60_000) refreshData();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.setInterval(() => {
      if (state.user && document.visibilityState === 'visible' && Date.now() - state.lastRefreshAt > 4 * 60_000) refreshData();
    }, 60_000);
  }

  async function handleResearchResponse(signal) {
    if (signal?.source !== 'goals-ios' || signal?.type !== 'routine.research.requested') return;
    await loadRoutineRequests();
    renderGoalResearchRequests();
    if (state.loading) {
      window.setTimeout(() => {
        if (!state.loading) processPendingGoalRequests().catch(error => console.error('R-IOS could not process a queued G-IOS request:', error));
      }, 1500);
      return;
    }
    await refreshData();
    await processPendingGoalRequests();
  }

  async function init() {
    if (!engine) {
      showAuth('Routine analysis could not start because its evidence engine did not load. Refresh this page.');
      return;
    }
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      if (!data?.session?.user) {
        showAuth();
        return;
      }
      state.user = data.session.user;
      try { state.bridge = window.HIOSConnectionLayer.connect('r-ios'); }
      catch (error) { console.warn('R-IOS communication centre is unavailable:', error); }
      showApp();
      bindEvents();
      setPage('overview');
      if (state.bridge) {
        state.bridge.subscribe(handleResearchResponse, { source: 'goals-ios', types: ['routine.research.requested'] });
        await loadRoutineRequests();
      }
      await refreshData();
      await processPendingGoalRequests();
    } catch (error) {
      console.error('R-IOS startup failed:', error);
      showAuth('R-IOS could not verify the current H-IOS session. Sign in again from H-IOS.');
    }
  }

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    $('#loginSubmit').disabled = true;
    $('#authNotice').textContent = 'Signing in to H-IOS…';
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    $('#loginSubmit').disabled = false;
    if (error) {
      $('#authNotice').textContent = error.message || 'Could not sign in. Check your details and try again.';
      return;
    }
    state.user = data?.user || data?.session?.user || null;
    if (!state.user) {
      $('#authNotice').textContent = 'A valid H-IOS session was not returned.';
      return;
    }
    init();
  });

  db.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      state.user = null;
      window.RIOSDeliberateRoutines?.reset();
      window.RIOSRoutineReminders?.reset();
      showAuth();
    }
  });
  init();
})();

