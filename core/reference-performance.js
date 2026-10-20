(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TIOSReferencePerformance = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  const COMPONENTS = Object.freeze([
    Object.freeze({id:'referencePlan', name:'Reference Plan', input:'Approved Trading Rules and Playbook', output:'Immutable methodology snapshot and version'}),
    Object.freeze({id:'marketData', name:'Market Data', input:'Instrument, timeframe and data source', output:'Completeness-checked market-data reference'}),
    Object.freeze({id:'opportunityDetection', name:'Opportunity Detection', input:'Approved version and market conditions', output:'Candidate opportunity with supporting evidence'}),
    Object.freeze({id:'referenceExecution', name:'Reference Execution', input:'Eligible opportunity and approved rules', output:'Simulation-only execution attempt'}),
    Object.freeze({id:'executionVerification', name:'Execution Verification', input:'Simulated attempt and approved rules', output:'Rule checks, errors and independent accuracy'}),
    Object.freeze({id:'performanceMeasurement', name:'Performance Measurement', input:'Closed, verified simulated outcomes', output:'Version-linked reference metrics and series'})
  ]);

  const TABLES = Object.freeze({
    referencePlan:'reference_methodology_versions',
    marketData:'reference_market_data_refs',
    opportunityDetection:'reference_opportunities',
    referenceExecution:'reference_execution_attempts',
    executionVerification:'reference_execution_verifications',
    performanceMeasurement:'reference_performance_records'
  });
  const TABLE_NAMES = Object.freeze([
    'reference_methodology_versions',
    'reference_market_data_refs',
    'reference_opportunities',
    'reference_execution_attempts',
    'reference_execution_verifications',
    'reference_performance_records'
  ]);

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isApproved(document) {
    return Boolean(document && (document.approval_status === 'approved' || document.approved === true));
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      throw new TypeError('Reference plan sources must be JSON-serializable snapshots.');
    }
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function snapshotFingerprint(value) {
    const input = stableStringify(value);
    let hash = 14695981039346656037n;
    const mask = (1n << 64n) - 1n;
    for (let i = 0; i < input.length; i++) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = (hash * 1099511628211n) & mask;
    }
    return 'fnv1a64:' + hash.toString(16).padStart(16, '0');
  }

  function createPlanVersionPayload(input) {
    if (!input || input.approval_status !== 'approved') {
      throw new Error('A reference version requires explicit approval.');
    }
    const playbook = input.playbook;
    const tradingRules = Array.isArray(input.trading_rules) ? input.trading_rules : [];
    if (!isApproved(playbook)) throw new Error('The Playbook must be explicitly approved before it can be versioned.');
    if (!tradingRules.length || tradingRules.some(rule => !isApproved(rule))) {
      throw new Error('Every Trading Rules source must be explicitly approved before it can be versioned.');
    }
    const versionNumber = Number(input.version_number);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new Error('version_number must be a positive integer.');

    const planSnapshot = cloneJson({
      schema_version:'tios.reference-plan.v1',
      approval_status:'approved',
      approved_at:text(input.approved_at) || new Date().toISOString(),
      name:text(input.name) || 'Approved Reference Methodology',
      playbook:playbook,
      trading_rules:tradingRules
    });
    return {
      name:planSnapshot.name,
      version_number:versionNumber,
      approval_status:'approved',
      approved_at:planSnapshot.approved_at,
      source_playbook_ids:[text(playbook.id)].filter(Boolean),
      source_rule_ids:tradingRules.map(rule => text(rule.id)).filter(Boolean),
      plan_snapshot:planSnapshot,
      snapshot_fingerprint:snapshotFingerprint(planSnapshot)
    };
  }

  function summarizeExecutionVerification(checks) {
    const rows = Array.isArray(checks) ? checks : [];
    const valid = rows.filter(row => row && typeof row.complied === 'boolean');
    const passed = valid.filter(row => row.complied).length;
    return {
      check_count:valid.length,
      passed_count:passed,
      failed_count:valid.length - passed,
      execution_accuracy_pct:valid.length ? passed / valid.length * 100 : null,
      proposed_status:rows.length > 0 && valid.length === rows.length
        ? (passed === valid.length ? 'passed' : 'failed')
        : 'insufficient_evidence'
    };
  }

  function measureVerifiedReferenceOutcomes(attempts) {
    const completed = (Array.isArray(attempts) ? attempts : []).filter(attempt =>
      attempt && attempt.execution_mode === 'simulation' &&
      attempt.execution_status === 'completed'
    );
    const verified = completed.filter(attempt =>
      attempt.opportunity_status === 'eligible' &&
      attempt.opportunity_validation_status === 'validated' &&
      attempt.market_data_validation_status === 'validated' &&
      attempt.verification &&
      attempt.verification.verification_status === 'verified' &&
      Number(attempt.verification.execution_accuracy_pct) === 100 &&
      text(attempt.methodology_version_id) &&
      text(attempt.methodology_version_id) === text(attempt.verification.methodology_version_id) &&
      text(attempt.id) === text(attempt.verification.execution_attempt_id) &&
      numberOrNull(attempt.realized_r) !== null
    );
    const allCompletedVerified = completed.length > 0 && verified.length === completed.length;
    const values = verified.map(attempt => Number(attempt.realized_r));
    const wins = values.filter(value => value > 0).length;
    const losses = values.filter(value => value < 0);
    const grossWins = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const equityCurve = [];
    const expectancySeries = [];
    const drawdownSeries = [];
    const edgeStabilitySeries = [];
    const windowSize = Math.min(10, Math.max(1, values.length));

    values.forEach((value, index) => {
      equity += value;
      peak = Math.max(peak, equity);
      const drawdown = Math.max(0, peak - equity);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      equityCurve.push({trade_index:index + 1, value:Number(equity.toFixed(8))});
      expectancySeries.push({trade_index:index + 1, value:Number((equity / (index + 1)).toFixed(8))});
      drawdownSeries.push({trade_index:index + 1, value:Number(drawdown.toFixed(8))});
      const start = Math.max(0, index - windowSize + 1);
      const window = values.slice(start, index + 1);
      edgeStabilitySeries.push({trade_index:index + 1, value:Number((window.reduce((sum, n) => sum + n, 0) / window.length).toFixed(8))});
    });

    // Browser-side arithmetic is a preview only; a trusted server must persist validated measurements.
    const measurementStatus = allCompletedVerified ? 'preview_only' : 'insufficient_evidence';
    const evidenceReliability = !values.length ? 'not_measured'
      : values.length >= 30 ? 'descriptive_sample' : 'preliminary_sample';
    const metricValuesAvailable = measurementStatus === 'preview_only';
    const distribution = [];
    if (metricValuesAvailable && values.length) {
      const binCount = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(values.length))));
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const width = maxValue === minValue ? 1 : (maxValue - minValue) / binCount;
      const bins = Array.from({length:binCount}, (_, index) => ({
        index,
        count:0,
        midpoint:minValue + (index + 0.5) * width
      }));
      values.forEach(value => {
        const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - minValue) / width)));
        bins[index].count++;
      });
      bins.forEach((bin, index) => distribution.push({
        trade_index:index + 1,
        midpoint:Number(bin.midpoint.toFixed(8)),
        count:bin.count
      }));
    }
    return {
      measurement_status:measurementStatus,
      attempt_count:completed.length,
      verified_attempt_count:verified.length,
      evidence_reliability:evidenceReliability,
      expectancy_r:metricValuesAvailable && values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      profit_factor:metricValuesAvailable && grossLoss > 0 ? grossWins / grossLoss : null,
      win_rate_pct:metricValuesAvailable && values.length ? wins / values.length * 100 : null,
      max_drawdown_r:metricValuesAvailable && values.length ? maxDrawdown : null,
      equity_curve:metricValuesAvailable ? equityCurve : [],
      expectancy_series:metricValuesAvailable ? expectancySeries : [],
      drawdown_series:metricValuesAvailable ? drawdownSeries : [],
      profit_loss_distribution:distribution,
      edge_stability_series:metricValuesAvailable ? edgeStabilitySeries : []
    };
  }

  function isMissingTable(error) {
    const code = text(error && error.code).toUpperCase();
    const message = text(error && error.message).toLowerCase();
    return code === '42P01' || code === 'PGRST205' || message.includes('does not exist') ||
      message.includes('could not find the table') || message.includes('schema cache');
  }

  function createRepository(db, userId) {
    if (!db || typeof db.from !== 'function') throw new TypeError('A Supabase client is required.');
    const ownerId = text(userId);
    if (!ownerId) throw new TypeError('An authenticated user ID is required.');

    async function countOwned(tableName, filter) {
      let query = db.from(tableName).select('id', {count:'exact', head:true}).eq('user_id', ownerId);
      if (Array.isArray(filter)) filter.forEach(item=>{query=query.eq(item.column,item.value);});
      else if (filter) query = query.eq(filter.column, filter.value);
      const result = await query;
      return {count:Number(result && result.count || 0), error:result && result.error || null};
    }

    async function insertOwned(tableName, row) {
      if (row && row.user_id && String(row.user_id) !== ownerId) throw new Error('Cannot write reference data for another user.');
      const result = await db.from(tableName).insert({...row, user_id:ownerId}).select('*').single();
      if (result && result.error) throw result.error;
      return result && result.data;
    }

    async function loadFoundationStatus() {
      const [tableResults, marketResult, latestResult] = await Promise.all([
        Promise.all(TABLE_NAMES.map(async tableName => [tableName, await countOwned(
          tableName,
          tableName === 'reference_methodology_versions' ? {column:'approval_status', value:'approved'} : null
        )])),
        db.from('mt5_market_candles')
          .select('id,timeframe', {count:'exact'})
          .eq('user_id', ownerId)
          .eq('completed', true)
          .eq('clock_confirmed', true)
          .limit(1000),
        db.from('reference_performance_records')
          .select('*')
          .eq('user_id', ownerId)
          .eq('measurement_status', 'validated')
          .order('generated_at', {ascending:false})
          .limit(1)
          .maybeSingle()
      ]);
      const counts = Object.fromEntries(tableResults);
      const validatedOpportunityCountResult = counts.reference_opportunities.error
        ? counts.reference_opportunities
        : await countOwned('reference_opportunities', {column:'detector_validation_status', value:'validated'});
      const validatedOpportunityCount = validatedOpportunityCountResult.error ? 0 : validatedOpportunityCountResult.count;
      const validatedMarketReferenceResult = counts.reference_market_data_refs.error
        ? counts.reference_market_data_refs
        : await countOwned('reference_market_data_refs', [
          {column:'data_validation_status',value:'validated'},
          {column:'availability_status',value:'available'}
        ]);
      const validatedMarketReferenceCount = validatedMarketReferenceResult.error ? 0 : validatedMarketReferenceResult.count;
      const referenceSchemaReady = TABLE_NAMES.every(name => !counts[name].error);
      const marketRows = marketResult && Array.isArray(marketResult.data) ? marketResult.data : [];
      const marketError = marketResult && marketResult.error || null;
      const confirmedCandleCount = Number(marketResult && marketResult.count != null ? marketResult.count : marketRows.length);
      const latestRecord = latestResult && !latestResult.error ? latestResult.data || null : null;
      const status = (key, label, detail, source) => ({label, detail, count:source && !source.error ? source.count : null});
      return {
        schema_ready:referenceSchemaReady,
        statuses:{
          referencePlan:status('referencePlan',
            counts.reference_methodology_versions.error ? (isMissingTable(counts.reference_methodology_versions.error) ? 'Migration pending' : 'Access unavailable')
              : counts.reference_methodology_versions.count ? 'Versioned plan available' : 'No approved version stored',
            counts.reference_methodology_versions.error ? 'The versioned plan table is not available to this user yet.'
              : counts.reference_methodology_versions.count ? 'Stored versions are immutable snapshots; new approvals create new versions.'
              : 'Existing Rules and Playbook remain in their current workspaces until an explicitly approved snapshot is saved.',
            counts.reference_methodology_versions),
          marketData:status('marketData',
            marketError ? (isMissingTable(marketError) ? 'Source unavailable' : 'Access unavailable')
              : validatedMarketReferenceCount ? 'Validated market-data range available'
              : confirmedCandleCount ? 'Source candles found; range validation pending' : 'Source ready; no confirmed candles',
            marketError ? 'The existing user-scoped MT5 candle source could not be read.'
              : validatedMarketReferenceCount ? validatedMarketReferenceCount + ' source ranges passed trusted data validation.'
              : confirmedCandleCount ? confirmedCandleCount + ' confirmed H4, H1 or M5 records found. Missing-interval completeness is not validated yet.'
              : 'Existing MT5 candle source supports H4, H1 and M5; no completed confirmed candle is recorded for this user.',
            null),
          opportunityDetection:status('opportunityDetection',
            counts.reference_opportunities.error ? (isMissingTable(counts.reference_opportunities.error) ? 'Migration pending' : 'Access unavailable')
              : validatedOpportunityCount ? 'Validated detector output available'
              : counts.reference_opportunities.count ? 'Candidate records only' : 'Detector not connected',
            counts.reference_opportunities.error ? 'Opportunity storage is not available to this user yet.'
              : validatedOpportunityCount ? validatedOpportunityCount + ' opportunities are marked validated by the detector service.'
              : counts.reference_opportunities.count ? counts.reference_opportunities.count + ' stored candidates remain unvalidated; they cannot enter reference measurement.'
              : 'The interface stores candidate evidence; no validated opportunity detector is connected.',
            counts.reference_opportunities),
          referenceExecution:status('referenceExecution',
            counts.reference_execution_attempts.error ? (isMissingTable(counts.reference_execution_attempts.error) ? 'Migration pending' : 'Access unavailable')
              : counts.reference_execution_attempts.count ? 'Simulation requests recorded' : 'Simulator not connected',
            counts.reference_execution_attempts.error ? 'Simulation attempt storage is not available to this user yet.'
              : counts.reference_execution_attempts.count ? counts.reference_execution_attempts.count + ' simulation requests or attempts are stored; no reference simulator is connected yet. Live order execution is not supported.'
              : 'The interface accepts simulation-only attempts; no reference simulator is connected.',
            counts.reference_execution_attempts),
          executionVerification:status('executionVerification',
            counts.reference_execution_verifications.error ? (isMissingTable(counts.reference_execution_verifications.error) ? 'Migration pending' : 'Access unavailable')
              : counts.reference_execution_verifications.count ? 'Verification requests recorded' : 'Verifier not connected',
            counts.reference_execution_verifications.error ? 'Verification storage is not available to this user yet.'
              : counts.reference_execution_verifications.count ? counts.reference_execution_verifications.count + ' request(s) remain pending; verified accuracy is independent from profitability.'
              : 'The interface records rule checks and errors; no verifier is connected.',
            counts.reference_execution_verifications),
          performanceMeasurement:status('performanceMeasurement',
            latestRecord ? 'Validated reference result available'
              : counts.reference_performance_records.error ? (isMissingTable(counts.reference_performance_records.error) ? 'Migration pending' : 'Access unavailable')
              : counts.reference_performance_records.count ? 'Measurement request pending trusted processing' : 'Awaiting verified outcomes',
            latestRecord ? 'The latest result uses closed, simulated outcomes linked to verified rule checks.'
              : counts.reference_performance_records.error ? 'Reference results are unavailable until the additive schema is deployed.'
              : 'No independently verified simulated outcomes are available for measurement.',
            counts.reference_performance_records)
        },
        market_coverage:{confirmed_candle_count:confirmedCandleCount, timeframes:[...new Set(marketRows.map(row => text(row.timeframe)).filter(Boolean))]},
        latest_validated_record:latestRecord
      };
    }

    async function nextPlanVersionNumber() {
      const result = await db.from('reference_methodology_versions')
        .select('version_number')
        .eq('user_id', ownerId)
        .order('version_number', {ascending:false})
        .limit(1)
        .maybeSingle();
      if (result && result.error) throw result.error;
      return Math.max(0, Number(result && result.data && result.data.version_number || 0)) + 1;
    }

    async function latestValidatedPerformance() {
      const result = await db.from('reference_performance_records')
        .select('*')
        .eq('user_id', ownerId)
        .eq('measurement_status', 'validated')
        .order('generated_at', {ascending:false})
        .limit(1)
        .maybeSingle();
      if (result && result.error) throw result.error;
      return result && result.data || null;
    }

    async function preparePerformanceMeasurement(input) {
      const versionId = text(input && input.methodology_version_id);
      const start = text(input && input.period_start);
      const end = text(input && input.period_end);
      if (!versionId || !start || !end || !Number.isFinite(Date.parse(start)) ||
          !Number.isFinite(Date.parse(end)) || Date.parse(start) > Date.parse(end)) {
        throw new Error('A methodology version and valid measurement period are required.');
      }
      const planResult = await db.from('reference_methodology_versions')
        .select('id,approval_status')
        .eq('user_id', ownerId)
        .eq('id', versionId)
        .maybeSingle();
      if (planResult && planResult.error) throw planResult.error;
      if (!planResult || !planResult.data || planResult.data.approval_status !== 'approved') {
        throw new Error('Reference measurement requires this user’s approved methodology version.');
      }
      const [attemptResult, verificationResult] = await Promise.all([
        db.from('reference_execution_attempts')
          .select('id,methodology_version_id,opportunity_id,execution_mode,execution_status,realized_r,closed_at')
          .eq('user_id', ownerId)
          .eq('methodology_version_id', versionId)
          .eq('execution_mode', 'simulation')
          .eq('execution_status', 'completed')
          .gte('closed_at', start)
          .lte('closed_at', end)
          .order('closed_at', {ascending:true}),
        db.from('reference_execution_verifications')
          .select('execution_attempt_id,methodology_version_id,verification_status,execution_accuracy_pct,verified_at,rule_checks,detected_errors')
          .eq('user_id', ownerId)
          .eq('methodology_version_id', versionId)
          .eq('verification_status', 'verified')
          .eq('execution_accuracy_pct', 100)
          .order('verified_at', {ascending:false})
      ]);
      if (attemptResult && attemptResult.error) throw attemptResult.error;
      if (verificationResult && verificationResult.error) throw verificationResult.error;
      const opportunityIds = [...new Set((attemptResult.data || []).map(row=>text(row.opportunity_id)).filter(Boolean))];
      let opportunityResult = {data:[],error:null};
      if (opportunityIds.length) {
        opportunityResult = await db.from('reference_opportunities')
          .select('id,methodology_version_id,market_data_ref_id,opportunity_status,detector_validation_status')
          .eq('user_id', ownerId)
          .eq('methodology_version_id', versionId)
          .eq('opportunity_status', 'eligible')
          .eq('detector_validation_status', 'validated')
          .in('id', opportunityIds);
      }
      if (opportunityResult && opportunityResult.error) throw opportunityResult.error;
      const marketReferenceIds = [...new Set((opportunityResult.data || []).map(row=>text(row.market_data_ref_id)).filter(Boolean))];
      let marketReferenceResult = {data:[],error:null};
      if (marketReferenceIds.length) {
        marketReferenceResult = await db.from('reference_market_data_refs')
          .select('id,availability_status,data_validation_status')
          .eq('user_id', ownerId)
          .eq('availability_status', 'available')
          .eq('data_validation_status', 'validated')
          .in('id', marketReferenceIds);
      }
      if (marketReferenceResult && marketReferenceResult.error) throw marketReferenceResult.error;
      const validatedMarketIds = new Set((marketReferenceResult.data || []).map(row=>String(row.id)));
      const validatedOpportunityIds = new Set((opportunityResult.data || [])
        .filter(row=>validatedMarketIds.has(String(row.market_data_ref_id)))
        .map(row=>String(row.id)));
      const latestVerification = new Map();
      (verificationResult.data || []).forEach(row => {
        if (!latestVerification.has(String(row.execution_attempt_id))) latestVerification.set(String(row.execution_attempt_id), row);
      });
      const attempts = (attemptResult.data || []).map(attempt => {
        const eligible = validatedOpportunityIds.has(String(attempt.opportunity_id));
        const opportunity = (opportunityResult.data || []).find(row=>String(row.id)===String(attempt.opportunity_id));
        const verification = latestVerification.get(String(attempt.id)) || null;
        return {
          ...attempt,
          opportunity_status:eligible ? 'eligible' : 'unvalidated',
          opportunity_validation_status:eligible ? 'validated' : 'unvalidated',
          market_data_validation_status:eligible && opportunity && validatedMarketIds.has(String(opportunity.market_data_ref_id)) ? 'validated' : 'unvalidated',
          verification
        };
      });
      const summary = measureVerifiedReferenceOutcomes(attempts);
      return {
        ...summary,
        preview_only:true,
        requires_trusted_persistence:true,
        source_metadata:{actual_trade_source:false, methodology_version_id:versionId, period_start:start, period_end:end}
      };
    }

    async function requestPerformanceMeasurement(input) {
      const versionId = text(input && input.methodology_version_id);
      const start = text(input && input.period_start);
      const end = text(input && input.period_end);
      if (!versionId || !start || !end || !Number.isFinite(Date.parse(start)) ||
          !Number.isFinite(Date.parse(end)) || Date.parse(start) > Date.parse(end)) {
        throw new Error('A methodology version and valid measurement period are required.');
      }
      const planResult = await db.from('reference_methodology_versions')
        .select('id,approval_status')
        .eq('user_id', ownerId)
        .eq('id', versionId)
        .maybeSingle();
      if (planResult && planResult.error) throw planResult.error;
      if (!planResult || !planResult.data || planResult.data.approval_status !== 'approved') {
        throw new Error('A performance request requires this user’s approved methodology version.');
      }
      return insertOwned('reference_performance_records', {
        methodology_version_id:versionId,
        period_start:start,
        period_end:end,
        source_metadata:{origin:'reference_measurement_request', actual_trade_source:false}
      });
    }

    async function captureExistingMarketData(input) {
      const versionId = text(input && input.methodology_version_id);
      const instrumentKey = text(input && input.instrument_key);
      const timeframe = text(input && input.timeframe);
      const symbol = text(input && input.symbol);
      const start = text(input && input.available_from);
      const end = text(input && input.available_to);
      if (!versionId || !instrumentKey || !symbol || !['H4','H1','M5'].includes(timeframe) ||
          !start || !end || Date.parse(start) > Date.parse(end)) {
        throw new Error('An approved methodology version, symbol, H4/H1/M5 timeframe and valid market-data range are required.');
      }
      const planResult = await db.from('reference_methodology_versions')
        .select('id,approval_status')
        .eq('user_id', ownerId)
        .eq('id', versionId)
        .maybeSingle();
      if (planResult && planResult.error) throw planResult.error;
      if (!planResult || !planResult.data || planResult.data.approval_status !== 'approved') {
        throw new Error('Market data can only be linked to this user’s approved reference methodology version.');
      }
      const candleResult = await db.from('mt5_market_candles')
        .select('id,instrument_key,mt5_symbol,timeframe,candle_open_at,completed,clock_confirmed,source', {count:'exact'})
        .eq('user_id', ownerId)
        .eq('instrument_key', instrumentKey)
        .eq('timeframe', timeframe)
        .gte('candle_open_at', start)
        .lte('candle_open_at', end)
        .order('candle_open_at', {ascending:true})
        .limit(5000);
      if (candleResult && candleResult.error) throw candleResult.error;
      const rows = Array.isArray(candleResult && candleResult.data) ? candleResult.data : [];
      const accepted = rows.filter(row => row.completed === true && row.clock_confirmed === true);
      const sourceCount = Number(candleResult && candleResult.count != null ? candleResult.count : rows.length);
      const acceptedCount = accepted.length;
      const availabilityStatus = acceptedCount === 0 ? 'unavailable'
        : acceptedCount === sourceCount && sourceCount <= 5000 ? 'available' : 'partial';
      const metadata = {
        source:'supabase.mt5_market_candles',
        source_record_count:sourceCount,
        confirmed_record_count:acceptedCount,
        unconfirmed_or_unavailable_record_count:Math.max(0, sourceCount - acceptedCount),
        query_limit:5000,
        interval_completeness:'unknown',
        completeness_ratio_definition:'confirmed completed records divided by records returned for this query; it does not estimate missing market intervals'
      };
      const rowsWithTime = accepted.filter(row => text(row.candle_open_at)).sort((a,b)=>String(a.candle_open_at).localeCompare(String(b.candle_open_at)));
      return insertOwned('reference_market_data_refs', {
        methodology_version_id:versionId,
        source_table:'mt5_market_candles',
        source_record_ids:accepted.map(row=>text(row.id)).filter(Boolean),
        source_query:{instrument_key:instrumentKey,timeframe,available_from:start,available_to:end},
        instrument_key:instrumentKey,
        symbol:symbol,
        timeframe,
        available_from:rowsWithTime[0]?.candle_open_at||null,
        available_to:rowsWithTime[rowsWithTime.length-1]?.candle_open_at||null,
        candle_count:acceptedCount,
        expected_candle_count:null,
        completeness_ratio:sourceCount ? Math.min(1,acceptedCount/sourceCount) : null,
        availability_status:availabilityStatus,
        source_metadata:metadata
      });
    }

    async function loadReferenceMarketCandles(referenceId) {
      const referenceResult = await db.from('reference_market_data_refs')
        .select('id,source_table,source_record_ids')
        .eq('user_id', ownerId)
        .eq('id', text(referenceId))
        .maybeSingle();
      if (referenceResult && referenceResult.error) throw referenceResult.error;
      const reference = referenceResult && referenceResult.data;
      if (!reference || reference.source_table !== 'mt5_market_candles') {
        throw new Error('The user-scoped MT5 market-data reference was not found.');
      }
      const ids = Array.isArray(reference.source_record_ids) ? reference.source_record_ids.filter(Boolean) : [];
      if (!ids.length) return [];
      const candleResult = await db.from('mt5_market_candles')
        .select('id,instrument_key,mt5_symbol,timeframe,candle_open_at,ohlc,source,completed,clock_confirmed')
        .eq('user_id', ownerId)
        .in('id', ids)
        .eq('completed', true)
        .eq('clock_confirmed', true)
        .order('candle_open_at', {ascending:true});
      if (candleResult && candleResult.error) throw candleResult.error;
      return Array.isArray(candleResult && candleResult.data) ? candleResult.data : [];
    }

    async function recordExecutionAttempt(row) {
      if (!row || (row.execution_mode != null && row.execution_mode !== 'simulation')) {
        throw new Error('Reference execution attempts must be simulation-only.');
      }
      const opportunityId = text(row.opportunity_id);
      const versionId = text(row.methodology_version_id);
      if (!opportunityId || !versionId) throw new Error('A linked opportunity and methodology version are required.');
      const [planResult, opportunityResult] = await Promise.all([
        db.from('reference_methodology_versions')
          .select('id,approval_status')
          .eq('user_id', ownerId)
          .eq('id', versionId)
          .maybeSingle(),
        db.from('reference_opportunities')
          .select('id,methodology_version_id')
          .eq('user_id', ownerId)
          .eq('id', opportunityId)
          .eq('methodology_version_id', versionId)
          .maybeSingle()
      ]);
      if (planResult && planResult.error) throw planResult.error;
      if (opportunityResult && opportunityResult.error) throw opportunityResult.error;
      if (!planResult?.data || planResult.data.approval_status !== 'approved') {
        throw new Error('A simulation request requires this user’s approved methodology version.');
      }
      if (!opportunityResult?.data) {
        throw new Error('A simulation request must link to an opportunity from the same user and plan.');
      }
      const request = {
        methodology_version_id:versionId,
        opportunity_id:opportunityId,
        execution_mode:'simulation',
        direction:row.direction === 'short' ? 'short' : row.direction === 'long' ? 'long' : null,
        entry_price:numberOrNull(row.entry_price),
        stop_loss_price:numberOrNull(row.stop_loss_price),
        take_profit_price:numberOrNull(row.take_profit_price),
        risk_plan:row.risk_plan && typeof row.risk_plan === 'object' ? row.risk_plan : {},
        execution_metadata:{request_source:'reference_execution_interface'}
      };
      return insertOwned('reference_execution_attempts', request);
    }

    async function recordExecutionVerification(row) {
      if (!row || !text(row.execution_attempt_id) || !text(row.methodology_version_id)) {
        throw new Error('A verification request must link to a reference execution attempt and methodology version.');
      }
      const attemptResult = await db.from('reference_execution_attempts')
        .select('id,methodology_version_id,execution_mode')
        .eq('user_id', ownerId)
        .eq('id', text(row.execution_attempt_id))
        .eq('methodology_version_id', text(row.methodology_version_id))
        .eq('execution_mode', 'simulation')
        .maybeSingle();
      if (attemptResult && attemptResult.error) throw attemptResult.error;
      if (!attemptResult || !attemptResult.data) throw new Error('Verification requests can only target this user’s simulation attempts.');
      return insertOwned('reference_execution_verifications', {
        methodology_version_id:text(row.methodology_version_id),
        execution_attempt_id:text(row.execution_attempt_id)
      });
    }

    return Object.freeze({
      userId:ownerId,
      loadFoundationStatus,
      latestValidatedPerformance,
      nextPlanVersionNumber,
      createPlanVersion:input => insertOwned('reference_methodology_versions', createPlanVersionPayload(input)),
      recordMarketDataReference:async row => {
        if (!row || (row.user_id && String(row.user_id) !== ownerId)) throw new Error('Cannot write reference data for another user.');
        const versionId = text(row.methodology_version_id);
        if (!versionId) throw new Error('A market-data reference requires a methodology version.');
        const planResult = await db.from('reference_methodology_versions')
          .select('id,approval_status')
          .eq('user_id', ownerId)
          .eq('id', versionId)
          .maybeSingle();
        if (planResult && planResult.error) throw planResult.error;
        if (!planResult?.data || planResult.data.approval_status !== 'approved') {
          throw new Error('Market data can only be linked to this user’s approved reference methodology version.');
        }
        const reference = {
          methodology_version_id:versionId,
          source_table:row.source_table,
          source_record_ids:Array.isArray(row.source_record_ids)?row.source_record_ids:[],
          source_query:row.source_query||{},
          instrument_key:row.instrument_key,
          symbol:row.symbol,
          timeframe:row.timeframe,
          available_from:row.available_from||null,
          available_to:row.available_to||null,
          candle_count:Number(row.candle_count||0),
          expected_candle_count:numberOrNull(row.expected_candle_count),
          completeness_ratio:numberOrNull(row.completeness_ratio),
          availability_status:row.availability_status||'unknown',
          source_metadata:row.source_metadata||{}
        };
        return insertOwned('reference_market_data_refs', reference);
      },
      captureExistingMarketData,
      loadReferenceMarketCandles,
      recordOpportunity:async row => {
        if (!row || (row.user_id && String(row.user_id) !== ownerId)) throw new Error('Cannot write reference data for another user.');
        const versionId = text(row.methodology_version_id);
        const marketReferenceId = text(row.market_data_ref_id);
        if (!versionId || !marketReferenceId) throw new Error('A candidate requires a methodology version and market-data reference.');
        const [planResult, marketResult] = await Promise.all([
          db.from('reference_methodology_versions')
            .select('id,approval_status')
            .eq('user_id', ownerId)
            .eq('id', versionId)
            .maybeSingle(),
          db.from('reference_market_data_refs')
            .select('id,methodology_version_id')
            .eq('user_id', ownerId)
            .eq('id', marketReferenceId)
            .eq('methodology_version_id', versionId)
            .maybeSingle()
        ]);
        if (planResult && planResult.error) throw planResult.error;
        if (marketResult && marketResult.error) throw marketResult.error;
        if (!planResult?.data || planResult.data.approval_status !== 'approved' || !marketResult?.data) {
          throw new Error('A candidate must link to this user’s approved plan and its market-data reference.');
        }
        const candidate = {
          methodology_version_id:versionId,
          market_data_ref_id:marketReferenceId,
          observed_at:row.observed_at,
          instrument_key:row.instrument_key,
          symbol:row.symbol,
          timeframe:row.timeframe,
          market_conditions:row.market_conditions||{},
          supporting_evidence:row.supporting_evidence||{},
          detector_version:row.detector_version||null
        };
        return insertOwned('reference_opportunities', candidate);
      },
      recordExecutionAttempt,
      recordExecutionVerification,
      preparePerformanceMeasurement,
      requestPerformanceMeasurement
    });
  }

  return Object.freeze({
    COMPONENTS,
    TABLES,
    createPlanVersionPayload,
    summarizeExecutionVerification,
    measureVerifiedReferenceOutcomes,
    createRepository
  });
});
