const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stats = require('../core/statistics-environments.js');

const noTrades = stats.summarizePnl([]);
assert.deepEqual(noTrades, {
  tradeCount: 0,
  validPnlCount: 0,
  missingPnlCount: 0,
  complete: false,
  netPnl: null,
  expectancy: null
});

const pnlTrades = [
  { id: 'a', pnl: 120, setup: 'Trend', trade_date: '2026-10-02' },
  { id: 'b', pnl: -40, setup: 'Trend', trade_date: '2026-10-07' },
  { id: 'c', pnl: 0, setup: 'Range', trade_date: '2026-11-01' }
];
assert.deepEqual(stats.summarizePnl(pnlTrades), {
  tradeCount: 3,
  validPnlCount: 3,
  missingPnlCount: 0,
  complete: true,
  netPnl: 80,
  expectancy: 80 / 3
});
assert.equal(stats.summarizePnl([{ pnl: 12 }, { pnl: null }]).netPnl, null,
  'a missing result must not be silently counted as zero');
assert.equal(stats.summarizePnl([{ pnl: '' }]).missingPnlCount, 1);

assert.equal(stats.profitFactor([{ pnl: 100 }, { pnl: -25 }]), 4);
assert.equal(stats.profitFactor([{ pnl: 50 }]), Infinity);
assert.equal(stats.profitFactor([{ pnl: 0 }]), null,
  'break-even-only data has no meaningful profit factor');
assert.equal(stats.profitFactor([{ pnl: 50 }, { pnl: null }]), null,
  'profit factor is unavailable when P&L coverage is incomplete');

const rTrades = [
  { pnl: 120, risk_amount: 100, r_multiple: 1.2, r_basis: 'planned_cash' },
  { pnl: -40, risk_amount: 80, r_multiple: -0.5, r_basis: 'stop_based' }
];
const rExpectancy = stats.summarizeExpectancy(rTrades);
assert.equal(rExpectancy.rComplete, true);
assert.equal(rExpectancy.rExpectancy, 0.35);
assert.equal(rExpectancy.preferredValue, 0.35);
assert.equal(rExpectancy.preferredUnit, 'R');
assert.equal(stats.reliableRMultiple({ risk_amount: 100, r_multiple: 1, r_basis: null }), null,
  'legacy R values without a declared basis are not treated as validated');
assert.equal(stats.reliableRMultiple({ risk_amount: 0, r_multiple: 1, r_basis: 'fixed_unit' }), null);
const partialR = stats.summarizeExpectancy([...rTrades, { pnl: 20, risk_amount: 10, r_multiple: 2 }]);
assert.equal(partialR.rComplete, false);
assert.equal(partialR.preferredUnit, 'money', 'partial R coverage falls back to complete monetary expectancy');
assert.ok(Math.abs(partialR.preferredValue - (100 / 3)) < 1e-12);

const setupGroups = stats.groupOutcomesByLabel(
  [...pnlTrades, { id: 'd', pnl: null, setup: 'Range' }, { id: 'e', pnl: 8, setup: ' ' }],
  trade => trade.setup,
  trade => trade.id === 'a' ? 80 : null
);
assert.equal(setupGroups.unclassified, 1);
assert.equal(setupGroups.groups.length, 2);
const trendGroup = setupGroups.groups.find(group => group.label === 'Trend');
assert.equal(trendGroup.count, 2);
assert.equal(trendGroup.averagePnl, 40);
assert.equal(trendGroup.profitFactor, 3);
assert.equal(trendGroup.averageQualityPct, 80);
const rangeGroup = setupGroups.groups.find(group => group.label === 'Range');
assert.equal(rangeGroup.complete, false);
assert.equal(rangeGroup.averagePnl, null);
assert.equal(rangeGroup.profitFactor, null);

const monthTimeline = stats.buildExpectancyTimeline(pnlTrades, 'all');
assert.deepEqual(monthTimeline.points.map(point => point.key), ['2026-10', '2026-11']);
assert.deepEqual(monthTimeline.points.map(point => point.tradeCount), [2, 1]);
assert.deepEqual(monthTimeline.points.map(point => point.expectancy), [40, 0]);
const weekTimeline = stats.buildExpectancyTimeline(pnlTrades, '6m');
assert.equal(weekTimeline.points[0].unit, 'week');
assert.equal(weekTimeline.points[0].label, 'Week of 2026-09-28');
assert.equal(weekTimeline.positivePeriods, 1);
assert.equal(stats.sampleReliability(0).label, 'Not measured');
assert.equal(stats.sampleReliability(29).label, 'Preliminary sample');
assert.equal(stats.sampleReliability(30).label, 'Larger descriptive sample');

const executionTrades = [
  { id: 'a', trade_date: '2026-10-02' },
  { id: 'b', trade_date: '2026-10-03' },
  { id: 'c', trade_date: '2026-11-01' }
];
const executionStats = stats.summarizeExecutionQuality(
  executionTrades,
  trade => ({ a: 80, b: null, c: 100 }[trade.id]),
  trade => ({
    psych: { values: trade.id === 'a' ? [1, 0.5] : trade.id === 'c' ? [0] : [] },
    playbook: { values: trade.id === 'a' ? [1] : [] },
    checklist: { values: trade.id === 'b' ? [1, 1] : [] }
  })
);
assert.equal(executionStats.selectedTradeCount, 3);
assert.equal(executionStats.reviewedTradeCount, 2);
assert.equal(executionStats.averageScorePct, 90);
assert.ok(Math.abs(executionStats.coveragePct - 200 / 3) < 1e-12);
assert.equal(executionStats.categories.psychology.tradeCount, 2);
assert.equal(executionStats.categories.psychology.averagePct, 37.5);
assert.equal(executionStats.categories.playbook.averagePct, 100);
assert.equal(executionStats.categories.rules.averagePct, 100);
assert.equal(stats.summarizeExecutionQuality([], () => null).averageScorePct, null);
const executionTimeline = stats.buildExecutionQualityTimeline(
  executionTrades,
  'all',
  trade => ({ a: 80, b: null, c: 100 }[trade.id])
);
assert.deepEqual(executionTimeline.points.map(point => [point.label, point.selectedTradeCount, point.reviewedTradeCount, point.averageScorePct]), [
  ['2026-10', 2, 1, 80],
  ['2026-11', 1, 1, 100]
]);

const evidenceGroups = stats.groupExecutionEvidenceByRole(
  [{ id: 'a', pnl: 20 }, { id: 'b', pnl: -10 }],
  [
    { trade_id: 'a', timeframe: 'H4', responsibility: 'Context' },
    { trade_id: 'a', timeframe: 'H4', responsibility: 'Context' },
    { trade_id: 'b', timeframe: 'M5', responsibility: 'Entry' },
    { trade_id: 'outside-period', timeframe: 'H1', responsibility: 'Setup' }
  ]
);
assert.deepEqual(evidenceGroups.map(group => [group.label, group.count, group.averagePnl]), [
  ['H4 · Context', 1, 20],
  ['M5 · Entry', 1, -10]
]);

const html = fs.readFileSync(path.join(__dirname, '../t-ios.html'), 'utf8');
const navigation = [...html.matchAll(/<button[^>]*data-stats-view="([^"]+)"[^>]*>/g)].map(match => {
  const panel = match[0].match(/aria-controls="([^"]+)"/);
  assert.match(match[0], /role="tab"/);
  return [match[1], panel?.[1]];
});
assert.deepEqual(navigation, [
  ['statistics', 'statsStatisticsView'],
  ['edge', 'statsEdgeView'],
  ['execution', 'statsExecutionView']
]);
const toolbarIndex = html.indexOf('id="statsPeriodToolbar"');
assert.ok(toolbarIndex < html.indexOf('id="statsStatisticsView"'));
assert.ok(toolbarIndex < html.indexOf('id="statsEdgeView"'));
assert.ok(toolbarIndex < html.indexOf('id="statsExecutionView"'));
assert.ok(html.indexOf('id="statsPsychologyView"') > html.indexOf('id="statsExecutionView"'),
  'existing illustrative psychology and behavior tools remain inside Execution Quality');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  assert.ok(start >= 0, 'missing function ' + name);
  const open = html.indexOf('{', html.indexOf(')', start));
  let depth = 0;
  for (let index = open; index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error('unclosed function ' + name);
}

function classList() {
  const values = new Set();
  return {
    values,
    toggle(name, force) {
      if (force) values.add(name); else values.delete(name);
    },
    contains(name) { return values.has(name); }
  };
}

const views = Object.fromEntries(['statistics', 'edge', 'execution'].map(name => [
  name,
  { hidden: name !== 'statistics' }
]));
const tabs = ['statistics', 'edge', 'execution'].map(name => ({
  dataset: { statsView: name },
  classList: classList(),
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; }
}));
const resizeCounts = { statistics: 0, edge: 0, execution: 0, fears: 0, behavior: 0 };
const tabContext = vm.createContext({
  $$: () => tabs,
  $: selector => ({
    '#statsStatisticsView': views.statistics,
    '#statsEdgeView': views.edge,
    '#statsExecutionView': views.execution
  }[selector]),
  setZoomedStatsCard() {},
  requestAnimationFrame(callback) { callback(); },
  renderStatisticsFearDemonstration() { resizeCounts.fears++; },
  renderStatsBehaviorExtras() { resizeCounts.behavior++; }
});
vm.runInContext(
  'let equityChartInstance={resize(){resizeCounts.statistics++}};\n' +
  'let statsEdgeTimelineInstance={resize(){resizeCounts.edge++}};\n' +
  'let statsExecutionTrendInstance={resize(){resizeCounts.execution++}};\n' +
  extractFunction('setStatisticsView') + '\n',
  Object.assign(tabContext, { resizeCounts })
);
tabContext.setStatisticsView('edge');
assert.deepEqual(Object.entries(views).map(([name, view]) => [name, view.hidden]), [
  ['statistics', true], ['edge', false], ['execution', true]
]);
assert.equal(tabs[1].attributes['aria-selected'], 'true');
assert.equal(tabs[0].tabIndex, -1);
assert.equal(resizeCounts.edge, 1);
tabContext.setStatisticsView('execution');
assert.deepEqual(Object.entries(views).map(([name, view]) => [name, view.hidden]), [
  ['statistics', true], ['edge', true], ['execution', false]
]);
assert.equal(resizeCounts.execution, 1);
assert.equal(resizeCounts.fears, 1);
assert.equal(resizeCounts.behavior, 1);
tabContext.setStatisticsView('invalid');
assert.equal(views.statistics.hidden, false, 'unknown navigation values safely return to Statistics');
assert.equal(views.edge.hidden, true);
assert.equal(views.execution.hidden, true);

const indicatorNodes = new Map(['statNavReturn', 'statNavExpectancy', 'statNavExecution'].map(id => [id, { textContent: '' }]));
const indicatorContext = vm.createContext({
  window: { TIOSStatisticsEnvironments: stats },
  document: { getElementById: id => indicatorNodes.get(id) },
  formatReturnPct: value => (value >= 0 ? '+' : '') + value.toFixed(2) + '%',
  signedMoney: value => (value >= 0 ? '+$' : '-$') + Math.abs(value).toFixed(2),
  statisticsRLabel: value => (value >= 0 ? '+' : '') + value.toFixed(2) + 'R'
});
vm.runInContext(
  extractFunction('statsAnalytics') + '\n' +
  extractFunction('setStatisticsText') + '\n' +
  extractFunction('renderStatisticsNavigationIndicators') + '\n',
  indicatorContext
);
const validatedR = stats.summarizeExpectancy(rTrades);
const measuredExecution = { averageScorePct: 84.4 };
indicatorContext.renderStatisticsNavigationIndicators(rTrades, 1.25, validatedR, measuredExecution);
assert.equal(indicatorNodes.get('statNavReturn').textContent, '+1.25%');
assert.equal(indicatorNodes.get('statNavExpectancy').textContent, 'Exp +0.35R');
assert.equal(indicatorNodes.get('statNavExecution').textContent, '84%');
indicatorContext.renderStatisticsNavigationIndicators([], null, stats.summarizeExpectancy([]), { averageScorePct: null });
assert.equal(indicatorNodes.get('statNavReturn').textContent, '—');
assert.equal(indicatorNodes.get('statNavExpectancy').textContent, '—');
assert.equal(indicatorNodes.get('statNavExecution').textContent, '—');

console.log('PASS real-P&L completeness, expectancy, validated R coverage, and sample reliability');
console.log('PASS exact setup/context grouping and chronological expectancy periods');
console.log('PASS execution coverage/category scoring and deduplicated timeframe evidence');
console.log('PASS three-panel navigation, shared period scope, and live indicators for measured and empty periods');
