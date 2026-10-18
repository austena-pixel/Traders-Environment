(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TIOSStatisticsEnvironments = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VALID_R_BASES = new Set(['planned_cash', 'account_percent', 'stop_based', 'fixed_unit']);
  const EXECUTION_CATEGORIES = Object.freeze({
    psychology: 'psych',
    playbook: 'playbook',
    rules: 'checklist'
  });
  const STATISTICS_INDICATOR_IDS = Object.freeze([
    'net-pnl', 'period-return', 'win-rate', 'profit-factor', 'avg-pnl-trade',
    'current-balance', 'avg-profit', 'avg-loss', 'max-drawdown', 'expectancy',
    'r-expectancy', 'qualifying-trades', 'setup-performance', 'edge-evidence-coverage',
    'execution-quality', 'rules-adherence', 'playbook-adherence', 'psychological-reflection'
  ]);
  const DEFAULT_STATISTICS_INDICATORS = Object.freeze([]);

  function list(value) {
    return Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : [];
  }

  function finiteRecordedNumber(value) {
    return (typeof value === 'number' || typeof value === 'string') &&
      String(value).trim() !== '' && Number.isFinite(Number(value));
  }

  function recordedPnl(trade) {
    return trade && finiteRecordedNumber(trade.pnl) ? Number(trade.pnl) : null;
  }

  function summarizePnl(source) {
    const trades = list(source);
    const values = trades.map(recordedPnl);
    const valid = values.filter(value => value !== null);
    const complete = trades.length > 0 && valid.length === trades.length;
    const total = valid.reduce((sum, value) => sum + value, 0);
    return {
      tradeCount: trades.length,
      validPnlCount: valid.length,
      missingPnlCount: trades.length - valid.length,
      complete,
      netPnl: complete ? total : null,
      expectancy: complete ? total / trades.length : null
    };
  }

  function normalizeStatisticsIndicatorIds(value, fallback = DEFAULT_STATISTICS_INDICATORS) {
    const allowed = new Set(STATISTICS_INDICATOR_IDS);
    const input = Array.isArray(value) ? value : fallback;
    const result = [];
    input.forEach(id => {
      if (typeof id !== 'string' || !allowed.has(id) || result.includes(id)) return;
      result.push(id);
    });
    return result;
  }

  function addStatisticsIndicatorIds(current, additions) {
    return normalizeStatisticsIndicatorIds([
      ...normalizeStatisticsIndicatorIds(current),
      ...(Array.isArray(additions) ? additions : [additions])
    ], []);
  }

  function removeStatisticsIndicatorId(current, id) {
    return normalizeStatisticsIndicatorIds(current).filter(item => item !== id);
  }

  function moveStatisticsIndicatorId(current, id, direction) {
    const result = normalizeStatisticsIndicatorIds(current);
    const index = result.indexOf(id);
    const offset = Number(direction);
    const nextIndex = index + (offset < 0 ? -1 : offset > 0 ? 1 : 0);
    if (index < 0 || nextIndex < 0 || nextIndex >= result.length) return result;
    [result[index], result[nextIndex]] = [result[nextIndex], result[index]];
    return result;
  }

  function buildCumulativePnlSeries(source) {
    const trades = list(source);
    const pnl = summarizePnl(trades);
    if (!pnl.complete) return {
      complete: false,
      tradeCount: trades.length,
      missingPnlCount: pnl.missingPnlCount,
      points: []
    };
    let total = 0;
    const points = [{ label: 'Start', date: null, cumulativePnl: 0, trade: null }];
    trades.forEach((trade, index) => {
      total += recordedPnl(trade);
      points.push({
        label: 'T' + (index + 1),
        date: String(trade.trade_date || ''),
        cumulativePnl: total,
        trade
      });
    });
    return { complete: true, tradeCount: trades.length, missingPnlCount: 0, netPnl: total, points };
  }

  function buildDrawdownSeries(points) {
    const source = list(points);
    if (!source.length || source.some(point => !finiteRecordedNumber(point?.equity))) {
      return { complete: false, points: [], maxDrawdown: null, maxDrawdownPct: null };
    }
    let peak = Number(source[0].equity);
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    const result = source.map(point => {
      const equity = Number(point.equity);
      if (equity > peak) peak = equity;
      const drawdown = Math.max(0, peak - equity);
      const pct = peak > 0 ? drawdown / peak * 100 : null;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPct = pct;
      }
      return { ...point, peakEquity: peak, drawdown, drawdownPct: pct };
    });
    return { complete: true, points: result, maxDrawdown, maxDrawdownPct };
  }

  function summarizeProfitLoss(source) {
    const trades = list(source);
    const summary = summarizePnl(trades);
    if (!summary.complete) return {
      complete: false,
      tradeCount: trades.length,
      missingPnlCount: summary.missingPnlCount,
      wins: 0,
      losses: 0,
      averageWin: null,
      averageLoss: null
    };
    const values = trades.map(recordedPnl);
    const winners = values.filter(value => value > 0);
    const losers = values.filter(value => value < 0);
    return {
      complete: true,
      tradeCount: trades.length,
      missingPnlCount: 0,
      wins: winners.length,
      losses: losers.length,
      averageWin: winners.length ? winners.reduce((sum, value) => sum + value, 0) / winners.length : null,
      averageLoss: losers.length ? losers.reduce((sum, value) => sum + value, 0) / losers.length : null,
      grossProfit: winners.reduce((sum, value) => sum + value, 0),
      grossLoss: Math.abs(losers.reduce((sum, value) => sum + value, 0))
    };
  }

  function buildTradeOutcomeDistribution(source, binCount = 8) {
    const trades = list(source);
    const summary = summarizePnl(trades);
    if (!summary.complete) return {
      complete: false,
      tradeCount: trades.length,
      missingPnlCount: summary.missingPnlCount,
      bins: []
    };
    const values = trades.map(recordedPnl);
    if (!values.length) return { complete: true, tradeCount: 0, missingPnlCount: 0, bins: [] };
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (minimum === maximum) return {
      complete: true,
      tradeCount: values.length,
      missingPnlCount: 0,
      bins: [{ min: minimum, max: maximum, count: values.length }]
    };
    const count = Math.max(2, Math.min(20, Math.floor(Number(binCount) || 8)));
    const width = (maximum - minimum) / count;
    const bins = Array.from({ length: count }, (_, index) => ({
      min: minimum + width * index,
      max: index === count - 1 ? maximum : minimum + width * (index + 1),
      count: 0
    }));
    values.forEach(value => {
      const index = Math.min(count - 1, Math.floor((value - minimum) / width));
      bins[index].count++;
    });
    return { complete: true, tradeCount: values.length, missingPnlCount: 0, bins };
  }

  function reliableRMultiple(trade) {
    if (!trade || !finiteRecordedNumber(trade.r_multiple) ||
        !finiteRecordedNumber(trade.risk_amount) || Number(trade.risk_amount) <= 0) return null;
    const basis = String(trade.r_basis || '').trim().toLowerCase();
    if (!VALID_R_BASES.has(basis)) return null;
    return Number(trade.r_multiple);
  }

  function summarizeExpectancy(source) {
    const trades = list(source);
    const pnl = summarizePnl(trades);
    const rValues = trades.map(reliableRMultiple).filter(value => value !== null);
    const rComplete = trades.length > 0 && rValues.length === trades.length;
    const rExpectancy = rValues.length
      ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
      : null;
    const useR = rComplete;
    return {
      ...pnl,
      rCount: rValues.length,
      rCoveragePct: trades.length ? rValues.length / trades.length * 100 : null,
      rExpectancy,
      rComplete,
      preferredValue: useR ? rExpectancy : pnl.expectancy,
      preferredUnit: useR ? 'R' : 'money'
    };
  }

  function profitFactorFromTotals(grossProfit, grossLoss) {
    if (grossLoss > 0) return grossProfit / grossLoss;
    if (grossProfit > 0) return Infinity;
    return null;
  }

  function profitFactor(source) {
    const trades = list(source);
    const pnl = summarizePnl(trades);
    if (!pnl.complete) return null;
    const values = trades.map(recordedPnl);
    const grossProfit = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
    return profitFactorFromTotals(grossProfit, grossLoss);
  }

  function groupOutcomesByLabel(source, labelForTrade, qualityForTrade) {
    const groups = new Map();
    let unclassified = 0;
    list(source).forEach(trade => {
      const rawLabel = typeof labelForTrade === 'function' ? labelForTrade(trade) : '';
      const label = rawLabel == null ? '' : String(rawLabel).trim();
      if (!label) {
        unclassified++;
        return;
      }
      if (!groups.has(label)) {
        groups.set(label, {
          label, count: 0, validPnlCount: 0, netPnl: 0,
          grossProfit: 0, grossLoss: 0, qualityCount: 0, qualityTotal: 0
        });
      }
      const group = groups.get(label);
      group.count++;
      const pnl = recordedPnl(trade);
      if (pnl !== null) {
        group.validPnlCount++;
        group.netPnl += pnl;
        if (pnl > 0) group.grossProfit += pnl;
        if (pnl < 0) group.grossLoss += Math.abs(pnl);
      }
      if (typeof qualityForTrade === 'function') {
        const rawQuality = qualityForTrade(trade);
        const quality = finiteRecordedNumber(rawQuality) ? Number(rawQuality) : NaN;
        if (Number.isFinite(quality) && quality >= 0 && quality <= 100) {
          group.qualityCount++;
          group.qualityTotal += quality;
        }
      }
    });

    const results = [...groups.values()].map(group => {
      const complete = group.count > 0 && group.validPnlCount === group.count;
      return {
        ...group,
        complete,
        averagePnl: complete ? group.netPnl / group.count : null,
        profitFactor: complete ? profitFactorFromTotals(group.grossProfit, group.grossLoss) : null,
        averageQualityPct: group.qualityCount ? group.qualityTotal / group.qualityCount : null
      };
    }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return { groups: results, unclassified };
  }

  function indexReviewsByTrade(reviews) {
    const index = new Map();
    list(reviews).forEach(review => {
      if (!review?.trade_id) return;
      const current = index.get(review.trade_id);
      const currentTime = String(current?.updated_at || current?.created_at || '');
      const nextTime = String(review.updated_at || review.created_at || '');
      if (!current || nextTime >= currentTime) index.set(review.trade_id, review);
    });
    return index;
  }

  function timelineBucket(dateValue, range) {
    const date = String(dateValue || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (range === '1d' || range === '1w' || range === '1m') return { key: date, label: date, unit: 'day' };
    if (range === '6m') {
      const parsed = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(parsed.getTime())) return null;
      const weekday = (parsed.getUTCDay() + 6) % 7;
      parsed.setUTCDate(parsed.getUTCDate() - weekday);
      const weekStart = parsed.toISOString().slice(0, 10);
      return { key: weekStart, label: 'Week of ' + weekStart, unit: 'week' };
    }
    return { key: date.slice(0, 7), label: date.slice(0, 7), unit: 'month' };
  }

  function buildExpectancyTimeline(source, range) {
    const buckets = new Map();
    list(source).forEach(trade => {
      const bucket = timelineBucket(trade.trade_date, range);
      if (!bucket) return;
      if (!buckets.has(bucket.key)) buckets.set(bucket.key, { ...bucket, trades: [] });
      buckets.get(bucket.key).trades.push(trade);
    });
    const points = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => {
      const summary = summarizePnl(bucket.trades);
      return {
        key: bucket.key,
        label: bucket.label,
        unit: bucket.unit,
        tradeCount: summary.tradeCount,
        validPnlCount: summary.validPnlCount,
        complete: summary.complete,
        expectancy: summary.expectancy
      };
    });
    const measured = points.filter(point => Number.isFinite(point.expectancy));
    return {
      points,
      measuredPeriods: measured.length,
      positivePeriods: measured.filter(point => point.expectancy > 0).length,
      flatPeriods: measured.filter(point => point.expectancy === 0).length,
      negativePeriods: measured.filter(point => point.expectancy < 0).length
    };
  }

  function buildExecutionQualityTimeline(source, range, scoreForTrade) {
    const buckets = new Map();
    list(source).forEach(trade => {
      const bucket = timelineBucket(trade.trade_date, range);
      if (!bucket) return;
      if (!buckets.has(bucket.key)) buckets.set(bucket.key, { ...bucket, selectedTradeCount: 0, scores: [] });
      const current = buckets.get(bucket.key);
      current.selectedTradeCount++;
      const rawScore = typeof scoreForTrade === 'function' ? scoreForTrade(trade) : NaN;
      const score = finiteRecordedNumber(rawScore) ? Number(rawScore) : NaN;
      if (Number.isFinite(score) && score >= 0 && score <= 100) current.scores.push(score);
    });
    const points = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => ({
      key: bucket.key,
      label: bucket.label,
      unit: bucket.unit,
      selectedTradeCount: bucket.selectedTradeCount,
      reviewedTradeCount: bucket.scores.length,
      averageScorePct: bucket.scores.length
        ? bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length
        : null
    }));
    return {
      points,
      measuredPeriods: points.filter(point => Number.isFinite(point.averageScorePct)).length
    };
  }

  function sampleReliability(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return { label: 'Not measured', largerSample: false };
    if (n < 30) return { label: 'Preliminary sample', largerSample: false };
    return { label: 'Larger descriptive sample', largerSample: true };
  }

  function summarizeExecutionQuality(source, scoreForTrade, categoriesForTrade) {
    const trades = list(source);
    const scores = [];
    const categories = Object.fromEntries(Object.keys(EXECUTION_CATEGORIES).map(name => [name, { tradeCount: 0, total: 0 }]));
    trades.forEach(trade => {
      const rawScore = typeof scoreForTrade === 'function' ? scoreForTrade(trade) : NaN;
      const score = finiteRecordedNumber(rawScore) ? Number(rawScore) : NaN;
      if (Number.isFinite(score) && score >= 0 && score <= 100) scores.push(score);
      const tradeCategories = typeof categoriesForTrade === 'function' ? categoriesForTrade(trade) : null;
      Object.entries(EXECUTION_CATEGORIES).forEach(([name, key]) => {
        const values = list(tradeCategories?.[key]?.values)
          .filter(finiteRecordedNumber).map(Number)
          .filter(value => value >= 0 && value <= 1);
        if (!values.length) return;
        const percent = values.reduce((sum, value) => sum + value, 0) / values.length * 100;
        categories[name].tradeCount++;
        categories[name].total += percent;
      });
    });
    return {
      selectedTradeCount: trades.length,
      reviewedTradeCount: scores.length,
      coveragePct: trades.length ? scores.length / trades.length * 100 : null,
      averageScorePct: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
      categories: Object.fromEntries(Object.entries(categories).map(([name, item]) => [name, {
        tradeCount: item.tradeCount,
        averagePct: item.tradeCount ? item.total / item.tradeCount : null
      }]))
    };
  }

  function summarizeExecutionAdherence(source, categoriesForTrade) {
    const trades = list(source);
    const categoryKeys = { rules: EXECUTION_CATEGORIES.rules, playbook: EXECUTION_CATEGORIES.playbook };
    const categoryTotals = Object.fromEntries(Object.keys(categoryKeys).map(name => [name, {
      assessedTradeCount: 0,
      itemCount: 0,
      total: 0
    }]));
    let fullyAssessedTradeCount = 0;
    let partiallyAssessedTradeCount = 0;
    let unassessedTradeCount = 0;
    let itemCount = 0;
    let total = 0;

    trades.forEach(trade => {
      const tradeCategories = typeof categoriesForTrade === 'function' ? categoriesForTrade(trade) : null;
      const valuesByCategory = {};
      Object.entries(categoryKeys).forEach(([name, key]) => {
        const values = list(tradeCategories?.[key]?.values)
          .filter(finiteRecordedNumber).map(Number)
          .filter(value => value >= 0 && value <= 1);
        valuesByCategory[name] = values;
        if (!values.length) return;
        categoryTotals[name].assessedTradeCount++;
        categoryTotals[name].itemCount += values.length;
        categoryTotals[name].total += values.reduce((sum, value) => sum + value, 0);
        itemCount += values.length;
        total += values.reduce((sum, value) => sum + value, 0);
      });
      const hasRules = valuesByCategory.rules.length > 0;
      const hasPlaybook = valuesByCategory.playbook.length > 0;
      if (hasRules && hasPlaybook) fullyAssessedTradeCount++;
      else if (hasRules || hasPlaybook) partiallyAssessedTradeCount++;
      else unassessedTradeCount++;
    });

    return {
      selectedTradeCount: trades.length,
      fullyAssessedTradeCount,
      partiallyAssessedTradeCount,
      unassessedTradeCount,
      measuredTradeCount: fullyAssessedTradeCount + partiallyAssessedTradeCount,
      itemCount,
      adherencePct: itemCount ? total / itemCount * 100 : null,
      categories: Object.fromEntries(Object.entries(categoryTotals).map(([name, item]) => [name, {
        assessedTradeCount: item.assessedTradeCount,
        itemCount: item.itemCount,
        adherencePct: item.itemCount ? item.total / item.itemCount * 100 : null
      }]))
    };
  }

  function groupExecutionEvidenceByRole(source, evidenceRows) {
    const selectedIds = new Set(list(source).map(trade => String(trade.id || '')).filter(Boolean));
    const evidenceByLabel = new Map();
    list(evidenceRows).forEach(row => {
      const tradeId = String(row?.trade_id || '');
      if (!selectedIds.has(tradeId)) return;
      const timeframe = String(row?.timeframe || '').trim();
      const responsibility = String(row?.responsibility || '').trim();
      if (!timeframe && !responsibility) return;
      const label = [timeframe, responsibility].filter(Boolean).join(' · ');
      if (!evidenceByLabel.has(label)) evidenceByLabel.set(label, new Set());
      evidenceByLabel.get(label).add(tradeId);
    });
    const tradesById = new Map(list(source).map(trade => [String(trade.id || ''), trade]));
    return [...evidenceByLabel.entries()].map(([label, ids]) => {
      const members = [...ids].map(id => tradesById.get(id)).filter(Boolean);
      const summary = summarizePnl(members);
      return {
        label,
        count: members.length,
        complete: summary.complete,
        averagePnl: summary.expectancy,
        profitFactor: profitFactor(members)
      };
    }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  return Object.freeze({
    STATISTICS_INDICATOR_IDS,
    DEFAULT_STATISTICS_INDICATORS,
    normalizeStatisticsIndicatorIds,
    addStatisticsIndicatorIds,
    removeStatisticsIndicatorId,
    moveStatisticsIndicatorId,
    finiteRecordedNumber,
    recordedPnl,
    summarizePnl,
    buildCumulativePnlSeries,
    buildDrawdownSeries,
    summarizeProfitLoss,
    buildTradeOutcomeDistribution,
    reliableRMultiple,
    summarizeExpectancy,
    profitFactor,
    groupOutcomesByLabel,
    indexReviewsByTrade,
    buildExpectancyTimeline,
    buildExecutionQualityTimeline,
    sampleReliability,
    summarizeExecutionQuality,
    summarizeExecutionAdherence,
    groupExecutionEvidenceByRole
  });
});
