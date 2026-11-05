(function registerRoutineEngine(root) {
  'use strict';

  const ACTIVITY_LABELS = Object.freeze({
    trading_day_journal: 'Trading-day journal',
    playbook_linked_to_trade: 'Playbook linked to trade',
    trade_plan_review: 'Trade-plan review',
    plan_checklist_review: 'Plan checklist review',
    trade_execution_review: 'Trade-execution review',
    execution_checklist_review: 'Execution checklist review',
    session_rule_review: 'Session rule review'
  });
  const MAX_SEQUENCE_LENGTH = 3;
  const MIN_DAYS_FOR_EARLY_SIGNAL = 3;
  const MIN_DAYS_FOR_SUPPORTED_ASSOCIATION = 10;

  function asRows(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function dateOnly(value) {
    if (typeof value !== 'string') return '';
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (!match) return '';
    const date = new Date(match[1] + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1]
      ? match[1]
      : '';
  }

  function validTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }

  function observedDay(preferredDate, timestamp) {
    return dateOnly(preferredDate) || dateOnly(timestamp) || '';
  }

  function fieldPresence(record, keys) {
    return keys.filter(key => text(record?.[key])).length;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function makeObservation({ table, id, activityKey, label, observedAt, observedOn, details = {}, sourceReference = {} }) {
    const recordId = id === null || id === undefined ? '' : String(id);
    const day = observedDay(observedOn, observedAt);
    if (!recordId || !day || !ACTIVITY_LABELS[activityKey]) return null;
    return {
      source_product_id: 'tios',
      source_table: table,
      source_record_id: recordId,
      activity_key: activityKey,
      label: label || ACTIVITY_LABELS[activityKey],
      observed_at: validTimestamp(observedAt),
      observed_on: day,
      details,
      source_reference: {
        table,
        record_id: recordId,
        ...sourceReference
      }
    };
  }

  function groupChecks(rows, parentRows, options) {
    const parents = new Map(asRows(parentRows).map(row => [String(row.id), row]));
    const groups = new Map();
    asRows(rows).forEach(row => {
      const parentId = row?.[options.parentKey];
      if (parentId === null || parentId === undefined) return;
      const key = String(parentId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    return [...groups.entries()].map(([parentId, checks]) => {
      const parent = parents.get(parentId) || {};
      const parentTrade = options.tradeKey ? options.tradesById.get(String(parent[options.tradeKey])) : null;
      const timestamps = checks.map(row => validTimestamp(row.created_at)).filter(Boolean).sort();
      const observedAt = timestamps.at(-1) || validTimestamp(parent.created_at);
      const observedOn = observedAt || parentTrade?.trade_date || parent.session_date || parent.created_at;
      const complied = checks.filter(row => row.complied === true).length;
      const notComplied = checks.filter(row => row.complied === false).length;
      const activity = options.activityKey;
      const observation = makeObservation({
        table: options.sourceTable,
        id: parentId,
        activityKey: activity,
        observedAt,
        observedOn,
        details: {
          check_count: checks.length,
          complied_count: complied,
          not_complied_count: notComplied
        },
        sourceReference: {
          parent_table: options.parentTable,
          parent_record_id: parentId,
          check_ids: checks.map(row => String(row.id)).filter(Boolean).slice(0, 100)
        }
      });
      return observation;
    }).filter(Boolean);
  }

  /** Convert actual T-IOS records into minimal, source-referenced observations. */
  function buildObservations(sources = {}) {
    const sessions = asRows(sources.sessions);
    const planReviews = asRows(sources.planReviews);
    const executionReviews = asRows(sources.executionReviews);
    const playbookLinks = asRows(sources.playbookLinks);
    const trades = asRows(sources.trades);
    const tradesById = new Map(trades.map(row => [String(row.id), row]));
    const observations = [];

    sessions.forEach(row => {
      const observedAt = validTimestamp(row.created_at);
      const present = fieldPresence(row, ['affirmation_before', 'signal', 'noise', 'strengths', 'weaknesses', 'opportunities', 'threats', 'adjustments', 'comments']);
      const observation = makeObservation({
        table: 'trading_sessions',
        id: row.id,
        activityKey: 'trading_day_journal',
        observedAt,
        observedOn: row.session_date || observedAt,
        details: {
          session_label: text(row.session_label) || null,
          reflection_fields_present: present
        }
      });
      if (observation) observations.push(observation);
    });

    planReviews.forEach(row => {
      const observedAt = validTimestamp(row.created_at);
      const trade = tradesById.get(String(row.trade_id));
      const observation = makeObservation({
        table: 'trade_plan_reviews',
        id: row.id,
        activityKey: 'trade_plan_review',
        observedAt,
        observedOn: observedAt || trade?.trade_date,
        details: {
          trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id),
          review_fields_present: fieldPresence(row, ['market_state', 'entry_pattern', 'review_notes', 'exit_rule'])
        },
        sourceReference: { trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id) }
      });
      if (observation) observations.push(observation);
    });

    executionReviews.forEach(row => {
      const observedAt = validTimestamp(row.created_at);
      const trade = tradesById.get(String(row.trade_id));
      const observation = makeObservation({
        table: 'trade_execution_reviews',
        id: row.id,
        activityKey: 'trade_execution_review',
        observedAt,
        observedOn: observedAt || trade?.trade_date,
        details: {
          trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id),
          reflection_fields_present: fieldPresence(row, ['what_went_well', 'execution_errors', 'next_adjustment', 'notes'])
        },
        sourceReference: { trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id) }
      });
      if (observation) observations.push(observation);
    });

    playbookLinks.forEach(row => {
      const trade = tradesById.get(String(row.trade_id));
      const observedAt = validTimestamp(row.assigned_at || row.updated_at);
      const identity = [row.trade_id, row.playbook_id || row.playbook_name].filter(Boolean).map(String).join(':');
      const observation = makeObservation({
        table: 'trade_capture_playbook_links',
        id: identity,
        activityKey: 'playbook_linked_to_trade',
        observedAt,
        observedOn: observedAt || trade?.trade_date,
        details: {
          trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id),
          required_section_count: Array.isArray(row.required_sections) ? row.required_sections.length : 0
        },
        sourceReference: {
          trade_id: row.trade_id === null || row.trade_id === undefined ? null : String(row.trade_id),
          playbook_id: row.playbook_id === null || row.playbook_id === undefined ? null : String(row.playbook_id)
        }
      });
      if (observation) observations.push(observation);
    });

    const rulesBySession = groupChecks(sources.sessionRuleChecks, sessions, {
      parentKey: 'session_id',
      activityKey: 'session_rule_review',
      sourceTable: 'session_rule_checks',
      parentTable: 'trading_sessions',
      tradesById
    });
    const planChecks = groupChecks(sources.planChecks, planReviews, {
      parentKey: 'review_id',
      activityKey: 'plan_checklist_review',
      sourceTable: 'trade_plan_checks',
      parentTable: 'trade_plan_reviews',
      tradeKey: 'trade_id',
      tradesById
    });
    const executionChecks = groupChecks(sources.executionChecks, executionReviews, {
      parentKey: 'review_id',
      activityKey: 'execution_checklist_review',
      sourceTable: 'trade_execution_checks',
      parentTable: 'trade_execution_reviews',
      tradeKey: 'trade_id',
      tradesById
    });
    observations.push(...rulesBySession, ...planChecks, ...executionChecks);

    const unique = new Map();
    observations.forEach(row => {
      const key = [row.source_table, row.source_record_id, row.activity_key].join('|');
      unique.set(key, row);
    });

    const outcomes = trades.map(row => {
      const score = optionalNumber(row.execution_score);
      const day = observedDay(row.trade_date, row.closed_at || row.created_at);
      if (!row.id || !day || String(row.position_status || '').toLowerCase() === 'open' || score === null) return null;
      return {
        source_record_id: String(row.id),
        observed_on: day,
        observed_at: validTimestamp(row.closed_at || row.created_at),
        execution_score: score,
        pnl: optionalNumber(row.pnl),
        r_multiple: optionalNumber(row.r_multiple)
      };
    }).filter(Boolean);

    return { observations: [...unique.values()], outcomes };
  }

  function sequenceOccurrences(observations) {
    const days = new Map();
    asRows(observations).forEach(event => {
      const day = dateOnly(event.observed_on);
      const key = text(event.activity_key);
      if (!day || !ACTIVITY_LABELS[key]) return;
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(event);
    });

    const occurrences = new Map();
    const activeDays = [...days.keys()].sort();
    activeDays.forEach(day => {
      const events = days.get(day);
      const oncePerActivity = new Map();
      events.forEach(event => {
        if (!oncePerActivity.has(event.activity_key)) oncePerActivity.set(event.activity_key, event);
      });
      const byTime = events.filter(event => validTimestamp(event.observed_at)).slice().sort((a, b) => {
        const timeOrder = validTimestamp(a.observed_at).localeCompare(validTimestamp(b.observed_at));
        if (timeOrder) return timeOrder;
        return String(a.activity_key).localeCompare(String(b.activity_key));
      });
      const ordered = [];
      byTime.forEach(event => {
        if (ordered.at(-1)?.activity_key !== event.activity_key) ordered.push(event);
      });

      const add = (sequence, matchingEvents) => {
        if (!sequence.length) return;
        const key = JSON.stringify(sequence);
        if (!occurrences.has(key)) occurrences.set(key, { sequence, days: new Map() });
        if (!occurrences.get(key).days.has(day)) occurrences.get(key).days.set(day, matchingEvents);
      };

      oncePerActivity.forEach((event, activityKey) => add([activityKey], [event]));
      for (let length = 2; length <= MAX_SEQUENCE_LENGTH; length += 1) {
        for (let index = 0; index + length <= ordered.length; index += 1) {
          const matchingEvents = ordered.slice(index, index + length);
          const sequence = matchingEvents.map(event => event.activity_key);
          if (new Set(sequence).size > 1) add(sequence, matchingEvents);
        }
      }
    });
    return { occurrences, activeDays };
  }

  function mean(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  }

  function evaluatePattern(matchedDays, allActiveDays, outcomes = []) {
    const byDay = new Map();
    asRows(outcomes).forEach(row => {
      const day = dateOnly(row.observed_on);
      const score = Number(row.execution_score);
      if (!day || !Number.isFinite(score)) return;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(score);
    });
    const dayMeans = new Map([...byDay.entries()].map(([day, values]) => [day, mean(values)]));
    const matched = [...new Set(asRows(matchedDays).map(dateOnly).filter(day => day && dayMeans.has(day)))];
    const matchedSet = new Set(matched);
    const nonMatched = [...new Set(asRows(allActiveDays).map(dateOnly).filter(day => day && !matchedSet.has(day) && dayMeans.has(day)))];
    const withScores = matched.map(day => dayMeans.get(day));
    const withoutScores = nonMatched.map(day => dayMeans.get(day));
    const withMean = mean(withScores);
    const withoutMean = mean(withoutScores);
    const difference = withMean === null || withoutMean === null ? null : withMean - withoutMean;

    let status = 'insufficient_evidence';
    if (withScores.length >= MIN_DAYS_FOR_EARLY_SIGNAL && withoutScores.length >= MIN_DAYS_FOR_EARLY_SIGNAL) {
      status = withScores.length >= MIN_DAYS_FOR_SUPPORTED_ASSOCIATION && withoutScores.length >= MIN_DAYS_FOR_SUPPORTED_ASSOCIATION
        ? 'supported_association'
        : 'early_signal';
    }
    const direction = difference === null ? 'unavailable' : difference > 0.05 ? 'positive' : difference < -0.05 ? 'negative' : 'no_clear_difference';
    return {
      status,
      direction,
      outcome_metric: 'execution_score',
      with_pattern_days: withScores.length,
      without_pattern_days: withoutScores.length,
      with_pattern_mean: withMean,
      without_pattern_mean: withoutMean,
      difference,
      caveat: 'This is an association in recorded data. It does not show that the routine caused the outcome.'
    };
  }

  function detectPatterns(observations, outcomes = []) {
    const { occurrences, activeDays } = sequenceOccurrences(observations);
    const totalActiveDays = activeDays.length;
    return [...occurrences.entries()]
      .map(([patternKey, item]) => {
        const matchedDays = [...item.days.keys()].sort();
        const evidenceReferences = matchedDays.map(day => ({
          observed_on: day,
          source_references: item.days.get(day).map(event => event.source_reference || {
            table: event.source_table,
            record_id: event.source_record_id
          })
        }));
        const evaluation = evaluatePattern(matchedDays, activeDays, outcomes);
        const sequenceLabels = item.sequence.map(key => ACTIVITY_LABELS[key]);
        const title = sequenceLabels.join(' → ');
        return {
          pattern_key: patternKey,
          sequence: item.sequence,
          title,
          observation_count: matchedDays.length,
          consistency_percent: totalActiveDays ? Math.round(matchedDays.length / totalActiveDays * 1000) / 10 : 0,
          first_observed_on: matchedDays[0] || null,
          last_observed_on: matchedDays.at(-1) || null,
          evidence_references: evidenceReferences,
          evaluation
        };
      })
      .filter(pattern => pattern.observation_count >= 2)
      .sort((a, b) => b.observation_count - a.observation_count || a.title.localeCompare(b.title));
  }

  function discoveryCopy(pattern) {
    const evaluation = pattern?.evaluation || {};
    const count = Number(pattern?.observation_count) || 0;
    let summary;
    if (evaluation.status === 'insufficient_evidence') {
      summary = `This recorded sequence appeared on ${count} distinct days. There are ${evaluation.with_pattern_days} days with it and ${evaluation.without_pattern_days} comparable days without it that have an execution score, so its relationship to outcomes is not established yet.`;
    } else {
      const withMean = Number(evaluation.with_pattern_mean).toFixed(2);
      const withoutMean = Number(evaluation.without_pattern_mean).toFixed(2);
      const relationship = evaluation.direction === 'positive'
        ? 'higher'
        : evaluation.direction === 'negative'
          ? 'lower'
          : 'similar';
      summary = `Recorded execution scores were ${relationship} on days with this sequence (average ${withMean}) than on comparable days without it (average ${withoutMean}). This is an association in the recorded sample, not proof that the sequence caused the difference.`;
    }
    return {
      summary,
      recommended_test: 'Test this sequence across future comparable sessions, keep recording T-IOS evidence, and review the outcome again when more observations are available.'
    };
  }

  const api = Object.freeze({
    ACTIVITY_LABELS,
    dateOnly,
    buildObservations,
    sequenceOccurrences,
    evaluatePattern,
    detectPatterns,
    discoveryCopy
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RIOSRoutineEngine = api;
})(typeof globalThis === 'object' ? globalThis : this);
