const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 't-ios.html'), 'utf8');

function sourceBlock(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error('Missing T-IOS source block: ' + start);
  return source.slice(from, to);
}

// Mock browser storage and account context only. Reflection matching, scoring,
// chronological ordering and intelligence calculations run the application code.
function executionContext(data = {}, activeReviews = data.executionReviews || []) {
  const storage = new Map();
  const context = vm.createContext({
    trades: [], executionChecks: [], ...data, executionReviews: activeReviews,
    currentUser: {id: '00000000-0000-4000-8000-000000000001'},
    tradingAccount: {id: 'acct-test'}, window: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    }
  });
  vm.runInContext([
    sourceBlock('function roundEvidence(', '\n'),
    sourceBlock('function averageFinite(', 'function intelligenceProcessAverage('),
    sourceBlock('function activeTradeIdSet(', 'function activePlanReviews('),
    sourceBlock('const EXECUTION_REFLECTION_TEMPLATE_SCHEMA', 'function journalExecutionBadge'),
    sourceBlock('function shortExecutionCriterionLabel', 'function marketStateStats')
  ].join('\n'), context);
  return context;
}

function recommendedCriteria() {
  return JSON.parse(vm.runInContext('JSON.stringify(EXECUTION_RECOMMENDED_TEMPLATE.criteria)', executionContext()));
}

module.exports = {executionContext, recommendedCriteria};
