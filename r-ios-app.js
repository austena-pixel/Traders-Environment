(function startRoutineApp() {
  'use strict';

  const SUPABASE_URL = 'https://tmxosoyqflmwqzjgnkez.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_meHq49fLyw8PVNPZxWacnw_SQMj5B-h';
  const PRODUCT_STORAGE_KEY = 'hios_added_products_v1';
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
      .eq('user_id', state.user.id)
      .eq('source_product_id', 'tios')
      .maybeSingle();
    if (error) throw error;

    state.sourceConnected = connectedProducts().includes('tios');
    if (!data && state.sourceConnected) {
      const { error: insertError } = await db.from('routine_source_settings').upsert({
        user_id: state.user.id,
        source_product_id: 'tios',
        enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,source_product_id' });
      if (insertError) throw insertError;
      state.sourceEnabled = true;
    } else {
      state.sourceEnabled = Boolean(data?.enabled);
    }

    if (!state.sourceConnected) state.sourceStatus = 'Traders-IOS is not connected in H-IOS.';
    else if (!state.sourceEnabled) state.sourceStatus = 'T-IOS evidence use is paused.';
    else state.sourceStatus = 'Traders-IOS connected; automatic evidence collection is on.';
  }

  async function loadTiosSource() {
    state.sourceErrors = [];
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

  async function upsertObservations(observations) {
    const rows = observations.map(row => ({
      ...row,
      user_id: state.user.id,
      source_product_id: 'tios',
      updated_at: new Date().toISOString()
    }));
    for (let offset = 0; offset < rows.length; offset += 200) {
      const chunk = rows.slice(offset, offset + 200);
      const { error } = await db.from('routine_observations').upsert(chunk, {
        onConflict: 'user_id,source_product_id,source_table,source_record_id,activity_key'
      });
      if (error) throw error;
    }
  }

  async function loadStoredObservations() {
    const rows = [];
    const pageSize = 500;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const { data, error } = await db.from('routine_observations')
        .select('source_table,source_record_id,activity_key,label,observed_at,observed_on,details,source_reference')
        .eq('user_id', state.user.id)
        .eq('source_product_id', 'tios')
        .order('observed_on', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  async function persistAnalysis(detected) {
    if (!detected.length) {
      state.patterns = [];
      state.evaluations = [];
      state.discoveries = [];
      return;
    }
    const now = new Date().toISOString();
    const patternRows = detected.map(pattern => ({
      user_id: state.user.id,
      source_product_id: 'tios',
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
      method: 'Compares mean recorded T-IOS execution scores by distinct trading day, grouped by whether the recorded activity sequence appeared.',
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
      .eq('user_id', state.user.id);
    if (oldDiscoveryError) throw oldDiscoveryError;
    const oldByKey = new Map((oldDiscoveries || []).map(row => [row.discovery_key, row]));
    const discoveryRows = detected.filter(pattern => patternIds.has(pattern.pattern_key)).map(pattern => {
      const patternId = patternIds.get(pattern.pattern_key);
      const evaluation = pattern.evaluation;
      const copy = engine.discoveryCopy(pattern);
      const existing = oldByKey.get(pattern.pattern_key);
      return {
        user_id: state.user.id,
        source_product_id: 'tios',
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
      .select('id,discovery_key,pattern_id,evaluation_id,discovery_type,title,summary,recommended_test,evidence_references,status,updated_at');
    if (discoveryError) throw discoveryError;

    const savedByKey = new Map((savedPatterns || []).map(row => [row.pattern_key, row]));
    state.patterns = detected.map(pattern => ({
      ...pattern,
      id: patternIds.get(pattern.pattern_key),
      ...savedByKey.get(pattern.pattern_key),
      evaluation: pattern.evaluation
    }));
    state.evaluations = evaluationRows.map(row => ({ ...row, ...evaluationsByPattern.get(row.pattern_id) }));
    state.discoveries = savedDiscoveries || [];
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
    try {
      await getSourceSetting();
      if (state.sourceConnected && state.sourceEnabled) {
        const sources = await loadTiosSource();
        const built = engine.buildObservations(sources);
        await upsertObservations(built.observations);
        state.observations = await loadStoredObservations();
        state.outcomes = built.outcomes;
        const detected = engine.detectPatterns(state.observations, state.outcomes);
        await persistAnalysis(detected);
        state.sourceStatus = state.sourceErrors.length
          ? `T-IOS is connected; some evidence tables could not be read (${state.sourceErrors.join(', ')}).`
          : built.observations.length
            ? `T-IOS is connected; ${built.observations.length} current source records were checked. Duplicate records are updated by their source reference.`
            : 'T-IOS is connected, but it has no routine-relevant records yet.';
      } else {
        state.observations = [];
        state.outcomes = [];
        state.patterns = [];
        state.evaluations = [];
        state.discoveries = [];
      }
      await loadOwnedRows();
      await loadRoutineRequests();
      renderAll();
      showNotice(state.sourceErrors.length ? 'Some T-IOS evidence sources are unavailable. Available sources are still shown.' : '', state.sourceErrors.length ? 'warning' : 'info');
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

  function renderSourceControls() {
    const sourceToggle = $('#sourceEnabled');
    const sourceText = $('#sourceStatusText');
    const productConnected = sourceWasConnected();
    sourceToggle.checked = Boolean(state.sourceEnabled);
    sourceToggle.disabled = !productConnected || state.loading;
    sourceText.textContent = productConnected
      ? (state.sourceEnabled ? 'T-IOS evidence is being used automatically.' : 'T-IOS evidence use is paused.')
      : 'Add Traders-IOS in H-IOS before connecting its evidence.';
    const badgeText = productConnected ? (state.sourceEnabled ? 'Connected' : 'Paused') : 'Unavailable';
    const badgeClass = `ri-badge ${productConnected && state.sourceEnabled ? 'good' : 'muted'}`;
    ['#sourceStatusBadge', '#overviewSourceStatusBadge'].forEach(selector => {
      const badge = $(selector);
      if (badge) { badge.textContent = badgeText; badge.className = badgeClass; }
    });
    ['#sourceDetail', '#overviewSourceDetail'].forEach(selector => {
      const detail = $(selector);
      if (detail) detail.textContent = state.sourceStatus;
    });
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
      ? state.patterns.slice(0, 4).map(pattern => `<article class="ri-mini-row"><div><b>${escapeHtml(pattern.title)}</b><small>${pattern.observation_count} distinct days · ${numberLabel(pattern.consistency_percent)}% consistency</small></div><span class="ri-badge">${escapeHtml(statusLabel(pattern.evaluation.status))}</span></article>`).join('')
      : `<div class="ri-empty">No repeated T-IOS activity patterns are available yet.</div>`;

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
          <div class="ri-card-head"><div><span class="ri-kicker">${escapeHtml(pattern.source_product_id === 'tios' ? 'T-IOS evidence' : pattern.source_product_id)}</span><h3>${escapeHtml(pattern.title)}</h3></div><span class="ri-badge">${escapeHtml(statusLabel(pattern.evaluation.status))}</span></div>
          <div class="ri-sequence">${pattern.sequence.map(key => `<span>${escapeHtml(engine.ACTIVITY_LABELS[key] || key)}</span>`).join('<b aria-hidden="true">→</b>')}</div>
          <div class="ri-facts"><div><small>Recorded days</small><b>${pattern.observation_count}</b></div><div><small>Consistency</small><b>${numberLabel(pattern.consistency_percent)}%</b></div><div><small>First detected</small><b>${escapeHtml(dateLabel(pattern.first_observed_on))}</b></div><div><small>Last occurrence</small><b>${escapeHtml(dateLabel(pattern.last_observed_on))}</b></div></div>
          <details class="ri-evidence"><summary>Inspect source evidence</summary><div>${pattern.evidence_references.slice(-8).map(ref => `<div class="ri-reference"><b>${escapeHtml(dateLabel(ref.observed_on))}</b><span>${ref.source_references.map(source => `${escapeHtml(source.table || source.source_table)} · ${escapeHtml(source.record_id || source.source_record_id)}`).join(' · ')}</span></div>`).join('')}</div></details>
        </article>`).join('')
      : `<div class="ri-empty ri-large-empty"><b>No routines detected yet</b><p>${state.sourceConnected && state.sourceEnabled ? 'R-IOS has not found repeated activity sequences in the connected T-IOS records. Keep using T-IOS; R-IOS will recheck recorded evidence when you refresh.' : 'Connect Traders-IOS and enable it as an evidence source to begin automatic detection.'}</p></div>`;
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
            <button class="ri-button primary" type="button" data-action="adopt" data-id="${escapeHtml(discovery.id)}">Adopt for observation</button>
            <button class="ri-button" type="button" data-action="investigate" data-id="${escapeHtml(discovery.id)}">Investigate evidence</button>
            <button class="ri-button quiet" type="button" data-action="dismiss" data-id="${escapeHtml(discovery.id)}">Dismiss</button>
          </div>
        </article>`).join('')
      : `<div class="ri-empty ri-large-empty"><b>No routine discoveries yet</b><p>R-IOS will show evidence-backed hypotheses after it observes repeated T-IOS behavior. It will not create sample findings.</p></div>`;
  }

  function renderResearch() {
    const host = $('#researchList');
    host.innerHTML = state.patterns.length
      ? state.patterns.map(pattern => {
        const evaluation = pattern.evaluation;
        const comparison = evaluation.with_pattern_mean === null
          ? 'Not enough comparable execution scores to evaluate this sequence.'
          : `${numberLabel(evaluation.with_pattern_mean, 2)} average score across ${evaluation.with_pattern_days} pattern days; ${numberLabel(evaluation.without_pattern_mean, 2)} across ${evaluation.without_pattern_days} comparison days.`;
        return `<article class="ri-card">
          <div class="ri-card-head"><div><span class="ri-kicker">Routine research</span><h3>${escapeHtml(pattern.title)}</h3></div><span class="ri-badge">${escapeHtml(statusLabel(evaluation.status))}</span></div>
          <div class="ri-research-metrics"><div><small>Pattern days with scores</small><b>${evaluation.with_pattern_days}</b></div><div><small>Comparison days</small><b>${evaluation.without_pattern_days}</b></div><div><small>Difference</small><b>${evaluation.difference === null ? '—' : numberLabel(evaluation.difference, 2)}</b></div></div>
          <p class="ri-body">${escapeHtml(comparison)}</p>
          <p class="ri-caveat">${escapeHtml(evaluation.caveat)}</p>
        </article>`;
      }).join('')
      : `<div class="ri-empty ri-large-empty"><b>Research is waiting for evidence</b><p>At least one repeated sequence and recorded execution scores are needed before R-IOS can compare outcomes.</p></div>`;
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
          <div class="ri-card-head"><div><span class="ri-kicker">${escapeHtml(routine.source_product_id.toUpperCase())} · ${escapeHtml(statusLabel(routine.status))}</span><h3>${escapeHtml(routine.name)}</h3></div><span class="ri-badge">${escapeHtml(consistency)}</span></div>
          <div class="ri-sequence">${sequence.map(key => `<span>${escapeHtml(engine.ACTIVITY_LABELS[key] || key)}</span>`).join('<b aria-hidden="true">→</b>')}</div>
          <p class="ri-body">${escapeHtml(routine.description || 'Adopted for ongoing observation.')}</p>
          <details class="ri-edit"><summary>Adjust routine details</summary><label>Routine name<input data-routine-field="name" value="${escapeHtml(routine.name)}" maxlength="120"></label><label>Observation note<textarea data-routine-field="description" rows="2" maxlength="600">${escapeHtml(routine.description || '')}</textarea></label><button class="ri-button" type="button" data-action="save-routine" data-id="${escapeHtml(routine.id)}">Save details</button></details>
          ${activeExperiment ? `<div class="ri-experiment"><b>Active test started ${escapeHtml(dateLabel(activeExperiment.started_at))}</b><small>R-IOS will compare new recorded behavior with the stored baseline as T-IOS evidence arrives.</small></div>` : ''}
          ${completedExperiment ? `<div class="ri-experiment"><b>Latest test completed ${escapeHtml(dateLabel(completedExperiment.ended_at))}</b><small>Routine consistency change: ${escapeHtml(signedLabel(completedExperiment.results?.routine_consistency_change_points, 1, ' points'))} · Execution-score mean change: ${escapeHtml(signedLabel(completedExperiment.results?.execution_score_mean_change, 2))}. These comparisons are observational.</small></div>` : ''}
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

  function sequenceBehaviorSnapshot(sequence, observations) {
    const observed = engine.sequenceOccurrences(observations);
    const sequenceKey = JSON.stringify(Array.isArray(sequence) ? sequence : []);
    const matched = observed.occurrences.get(sequenceKey);
    const sequenceDays = matched ? matched.days.size : 0;
    const activeDays = observed.activeDays.length;
    return {
      sequence_days: sequenceDays,
      active_days: activeDays,
      consistency_percent: activeDays ? Math.round(sequenceDays / activeDays * 1000) / 10 : null,
      evidence_window: 'timestamped T-IOS observations'
    };
  }

  async function startExperiment(routineId) {
    if (state.loading) return;
    await refreshData();
    const routine = state.routines.find(row => row.id === routineId);
    if (!routine || routine.status !== 'active') return;
    const now = new Date().toISOString();
    const baseline = {
      ...outcomeSnapshot(state.outcomes),
      routine_behavior: sequenceBehaviorSnapshot(routine.target_sequence, state.observations)
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
    const afterObservations = state.observations.filter(row => {
      const observedAt = Date.parse(row.observed_at || '');
      return Number.isFinite(startedAt) && Number.isFinite(observedAt) && observedAt >= startedAt;
    });
    const afterBehavior = sequenceBehaviorSnapshot(routine?.target_sequence, afterObservations);
    const afterOutcomes = state.outcomes.filter(row => {
      const observedAt = Date.parse(row.observed_at || '');
      return Number.isFinite(startedAt) && Number.isFinite(observedAt) && observedAt >= startedAt;
    });
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
      note: 'Only timestamped T-IOS records after the test started are included. Date-only evidence is not assigned to the test window. An association does not establish causation.'
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

  async function clearImportedEvidence() {
    if (!window.confirm('Delete R-IOS stored observations and detections imported from T-IOS? Adopted routines will remain, but their discovery links may be cleared.')) return;
    const patterns = await db.from('routine_patterns').delete().eq('user_id', state.user.id).eq('source_product_id', 'tios');
    if (patterns.error) throw patterns.error;
    const observations = await db.from('routine_observations').delete().eq('user_id', state.user.id).eq('source_product_id', 'tios');
    if (observations.error) throw observations.error;
    showNotice('Stored T-IOS observations and derived detections were deleted.', 'good');
    await refreshData();
  }

  function isTradingArea(area) {
    return /trad|market|investment|finance/i.test(String(area || ''));
  }

  function researchResponseFor(request) {
    const area = request?.area || '';
    if (!state.sourceConnected || !state.sourceEnabled) {
      return {
        status: 'insufficient_evidence',
        summary: 'R-IOS does not currently have permission to use connected T-IOS evidence. Connect T-IOS and enable it in R-IOS Sources before evaluating this progress gap.',
        evidence_references: [],
        recommended_next_step: 'Enable the T-IOS source and request research again.'
      };
    }
    if (!isTradingArea(area)) {
      return {
        status: 'insufficient_evidence',
        summary: `The requested focus area is ${area || 'not specified'}. R-IOS currently has T-IOS trading activity connected, so it has no matching evidence for this area.`,
        evidence_references: [],
        recommended_next_step: 'Connect a product that records behavior in this focus area when that source becomes available.'
      };
    }
    const candidates = state.patterns.slice(0, 3);
    if (!candidates.length) {
      return {
        status: 'insufficient_evidence',
        summary: 'No repeated T-IOS activity sequence is available for this focus area yet. R-IOS has not generated a discovery from the request.',
        evidence_references: [],
        recommended_next_step: 'Continue recording session journals, trade-plan reviews, checklists, and execution reviews in T-IOS, then request research again.'
      };
    }
    const supported = candidates.filter(pattern => pattern.evaluation.status !== 'insufficient_evidence');
    const summary = supported.length
      ? supported.map(pattern => engine.discoveryCopy(pattern).summary).join(' ')
      : candidates.map(pattern => `${pattern.title} appeared on ${pattern.observation_count} distinct days, but there are not enough comparable execution-score days to evaluate it.`).join(' ');
    return {
      status: supported.length ? 'evaluated' : 'insufficient_evidence',
      summary,
      evidence_references: candidates.flatMap(pattern => pattern.evidence_references).slice(0, 20),
      recommended_next_step: supported.length
        ? 'Treat this as a research lead. Test the candidate sequence over future comparable sessions and review new evidence.'
        : 'Keep collecting comparable T-IOS activity and outcome records. R-IOS will revise this evaluation as evidence grows.'
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
    $('#sourceEnabled').addEventListener('change', async event => {
      if (!state.sourceConnected) return;
      const enabled = Boolean(event.target.checked);
      const { error } = await db.from('routine_source_settings').upsert({
        user_id: state.user.id,
        source_product_id: 'tios',
        enabled,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,source_product_id' });
      if (error) {
        event.target.checked = state.sourceEnabled;
        showNotice('Could not update the T-IOS evidence setting.', 'error');
        return;
      }
      state.sourceEnabled = enabled;
      await refreshData();
    });
    $('#clearImportedEvidence').addEventListener('click', () => clearImportedEvidence().catch(error => {
      console.error(error); showNotice('Could not delete the stored T-IOS observations.', 'error');
    }));
    document.body.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action, id } = button.dataset;
      const actions = {
        adopt: () => adoptDiscovery(id),
        dismiss: () => dismissDiscovery(id),
        investigate: () => investigateDiscovery(id),
        'start-experiment': () => startExperiment(id),
        'complete-experiment': () => completeExperiment(id),
        'toggle-routine': () => toggleRoutine(id),
        'save-routine': () => updateRoutineDetails(id, button),
        'investigate-goal-request': () => investigateGoalRequest(state.requests.find(row => row.signalId === id))
      };
      const run = actions[action];
      if (run) run().catch(error => {
        console.error(`R-IOS action ${action} failed:`, error);
        showNotice('R-IOS could not complete that action. Refresh and try again.', 'error');
      });
    });
    window.addEventListener('storage', event => {
      if (event.key === PRODUCT_STORAGE_KEY || event.key === null) refreshData();
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
      showAuth();
    }
  });
  init();
})();
