// Regression coverage for the Section A financial-outcome layout and summary metrics.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stats=require('../core/statistics-environments.js');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');
const personalIntelligenceScript=fs.readFileSync(path.resolve(__dirname,'../tios-statistics-personal-intelligence.js'),'utf8');

function extractFunction(name){
  const start=html.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const signatureEnd=html.indexOf('){',start);
  assert.ok(signatureEnd>=0,'Missing body for '+name);
  let depth=0;
  for(let index=signatureEnd+1;index<html.length;index++){
    if(html[index]==='{')depth++;
    else if(html[index]==='}'&&--depth===0)return html.slice(start,index+1);
  }
  throw new Error('Unclosed '+name);
}

const sectionStart=html.indexOf('<section class="panel stats-section-a"');
const layoutStart=html.indexOf('<div class="stats-section-a-workspace"',sectionStart);
const chartStart=html.indexOf('<section class="stats-combined-outcomes"',layoutStart);
const summaryStart=html.indexOf('<div class="stats-primary-summary"',sectionStart);
const personalIntelligenceStart=html.indexOf('<aside class="stats-dashboard-section stats-personal-intelligence"',layoutStart);
const personalIntelligenceHistoryStart=html.indexOf('id="statsPIHistory"',personalIntelligenceStart);
const personalIntelligenceHistoryActions=html.indexOf('class="stats-personal-intelligence-history-actions"',personalIntelligenceHistoryStart);
const optionalStart=html.indexOf('<aside class="stats-dashboard-section" aria-labelledby="statsIndicatorsHeading"',layoutStart);
assert.ok(sectionStart>=0&&layoutStart>sectionStart,'Section A groups the metrics, chart and optional indicator space.');
assert.ok(summaryStart>sectionStart&&summaryStart<layoutStart,'the financial summary spans above the horizontal workspace.');
assert.ok(chartStart>layoutStart&&personalIntelligenceStart>chartStart&&personalIntelligenceHistoryStart>personalIntelligenceStart,'Graphs, Personal Intelligence chat, and chat history follow horizontally from the main sidebar side.');
assert.ok(optionalStart>chartStart,'The optional indicator space remains after History Charts inside Section A.');
assert.ok(html.includes('role="group" aria-label="Graphs on the left, Personal Intelligence chat in the middle, and chat history on the right"'),'the workspace describes the intended horizontal order accessibly');
assert.match(html,/\.stats-section-a-workspace\{[^}]*grid-template-columns:minmax\(0,3\.3fr\) minmax\(220px,1\.7fr\) minmax\(170px,1fr\)/,'the graph, Personal Intelligence, and chat-history columns fit side by side');
assert.match(html,/\.stats-combined-outcomes\{grid-column:1;grid-row:1\}/,'Graphs occupy the column nearest the main sidebar');
assert.match(html,/\.stats-personal-intelligence\{grid-column:2;grid-row:1/,'Personal Intelligence occupies the middle column');
assert.match(html,/\.stats-personal-intelligence-history-section\{grid-column:3;grid-row:1/,'saved chat history occupies the right-hand column');
assert.match(html,/\.stats-personal-intelligence-history-section\{display:flex;flex-direction:column;min-height:0;max-height:none/,'the saved chat history remains visible in its own column');
assert.ok(personalIntelligenceHistoryActions>personalIntelligenceHistoryStart&&!html.includes('class="stats-personal-intelligence-toolbar"'),'the Personal Intelligence controls sit at the bottom of the chat-history section');
const piActions=html.slice(personalIntelligenceHistoryActions,optionalStart);
assert.ok(piActions.indexOf('data-pi-action="history"')<piActions.indexOf('data-pi-action="new"')&&piActions.indexOf('data-pi-action="new"')<piActions.indexOf('data-pi-action="settings"'),'History, New chat, and Settings appear in the requested order');
assert.ok(personalIntelligenceScript.includes("historyPanel.querySelectorAll('[data-pi-action]')"),'the moved action buttons remain connected to their handlers');
assert.match(html,/\.stats-pi-history-delete\{[^}]*border:0;[^}]*background:transparent;[^}]*font-size:13px/,'saved-conversation X controls remain small and have no border or button fill');
assert.match(html,/\.stats-pi-history-delete:hover,\.stats-pi-history-delete:focus-visible\{color:#eef4fc;opacity:1;transform:scale\(1\.18\)\}/,'the X controls brighten and enlarge slightly on hover or keyboard focus');
assert.match(html,/\.stats-pi-history-row\{position:relative;display:block\}/,'each saved conversation row anchors its delete control inside the history card');
assert.match(html,/\.stats-pi-history-delete\{position:absolute;top:5px;right:16px;[^}]*border:0;[^}]*background:transparent/,'the delete X sits in the upper-right corner inside each history card without a border or fill');
assert.match(html,/\.stats-pi-history-open\{display:block;width:100%;min-width:0;padding:7px 44px 7px 8px/,'history-card text leaves room for the X in its upper-right corner');
const personalIntelligenceComposerStart=html.indexOf('<form class="stats-personal-intelligence-composer" id="statsPIForm">');
const personalIntelligenceComposerEnd=html.indexOf('</form>',personalIntelligenceComposerStart);
const personalIntelligenceComposer=html.slice(personalIntelligenceComposerStart,personalIntelligenceComposerEnd);
assert.ok(personalIntelligenceComposer.includes('placeholder="Type here…"')&&personalIntelligenceComposer.indexOf('id="statsPIInput"')<personalIntelligenceComposer.indexOf('id="statsPISend"'),'the user types in the expandable area above the horizontal line, beside the send control');
assert.ok(personalIntelligenceComposer.includes('Ask anything about your trading')&&personalIntelligenceComposer.includes('<svg viewBox="0 0 24 24"'),'the composer shows the draft hint below the line and uses an icon-only send button');
assert.match(html,/\.stats-personal-intelligence-composer\{[^}]*border:0\}/,'the composer has no enclosing border');
assert.match(html,/\.stats-personal-intelligence-composer textarea\{[^}]*border:0;border-bottom:1px solid/,'the typing area has only the requested horizontal line, with no box border');
assert.match(html,/\.stats-personal-intelligence-composer textarea\{[^}]*scrollbar-color:#34445a transparent;scrollbar-width:thin/,'the composer scrollbar uses the same thin dark thumb as the conversation area');
assert.match(html,/\.stats-personal-intelligence-messages::-webkit-scrollbar-thumb,\.stats-personal-intelligence-composer textarea::-webkit-scrollbar-thumb\{background:#34445a;border-radius:999px\}/,'the conversation and composer use the same borderless scrollbar thumb');
assert.match(html,/\.stats-personal-intelligence-messages::-webkit-scrollbar-button,\.stats-personal-intelligence-composer textarea::-webkit-scrollbar-button\{display:none/,'native scrollbar arrows are removed from both chat areas');
assert.match(html,/\.stats-personal-intelligence-send\{[^}]*border:0;[^}]*background:transparent/,'the icon-only send control has no border or button fill');
assert.match(personalIntelligenceScript,/row\.append\(open,remove\);historyList\.append\(row\)/,'each history X stays immediately beside its corresponding conversation');
assert.ok(!html.includes('stats-personal-intelligence-prompts')&&!html.includes('data-pi-prompt=')&&!html.includes('stats-personal-intelligence-footnote'),'the fixed question buttons and highlighted explanatory paragraph are removed for more chat space');
assert.ok(!personalIntelligenceScript.includes('data-pi-prompt'),'the removed suggested questions have no remaining chat handlers');
assert.ok(!/<section class="stats-personal-intelligence-panel stats-personal-intelligence-history-section"[^>]*hidden/.test(html),'the saved chat history is visible without opening the chat history menu');
assert.ok(html.includes('<h3 class="stats-graphs-heading">Graphs</h3>'),'the chart panel is clearly labeled Graphs');
assert.ok(html.indexOf('</aside>',optionalStart)<html.indexOf('<dialog',optionalStart),'The optional indicator area remains inside Section A, before the indicator picker dialog.');
assert.match(html,/\.stats-dashboard-section\{min-width:0;min-height:0;/,'the optional indicator panel can shrink to fit short screens');
assert.ok(!html.includes('Measure financial outcomes, methodology evidence and execution quality for one shared reporting period.'),'the Statistics intro subtitle row is removed so Section A can begin higher');
assert.ok(html.includes('<h1 class="stats-visually-hidden">Statistics</h1>')&&html.includes('<span class="stats-view-tab-label">Statistics</span>')&&html.includes('aria-label="Performance environments"'),'the accessible Statistics title and visible environment tabs remain available');
const pageStatistics=html.indexOf('id="page-statistics"');
const sectionControls=html.indexOf('<div class="stats-section-a-header" role="group" aria-label="Statistics section controls">',pageStatistics);
const pagePeriodControls=html.indexOf('id="statsPeriodToolbar"',sectionControls);
const statisticsPanel=html.indexOf('<div class="stats-view-panel" id="statsStatisticsView"',sectionControls);
assert.ok(sectionControls>pageStatistics&&pagePeriodControls>sectionControls,'date navigation is compacted inside the Statistics control row');
assert.ok(statisticsPanel>pagePeriodControls,'Section A content follows its shared controls');
assert.ok(!html.slice(sectionControls,statisticsPanel).includes('class="stats-toolbar"'),'the separate toolbar row is removed');
assert.ok(!html.includes('id="statsCombinedOutcomesHeading"'),'the old Section A heading and description are removed');
const periodDropdown=html.indexOf('<details class="stats-period-dropdown" id="statsPeriodSelector">',sectionControls);
const performanceTabs=html.indexOf('class="stats-view-tabs" role="tablist" aria-label="Performance environments"',sectionControls);
assert.ok(periodDropdown>performanceTabs&&html.indexOf('class="stats-autozoom-controls"',periodDropdown)>periodDropdown,'the single period dropdown and performance tabs share the compact control row');
assert.match(html,/<summary class="stats-period-trigger" aria-label="Choose reporting period"><span>Period:<\/span><strong id="statsPeriodCurrent">Day<\/strong><\/summary>/,'the Statistics control shows its selected reporting range');
assert.equal((html.match(/data-stats-range=/g)||[]).length,6,'all six reporting ranges stay available inside the menu');
assert.ok(!html.includes('id="statsOutcomeTitle"')&&!html.includes('id="equityChartDescription"')&&!html.includes('class="stats-outcome-heading"'),'the chart title and description are removed');
const outcomeWorkspace=html.indexOf('<div class="stats-outcome-workspace" id="statsOutcomeWorkspace"');
const outcomePeriod=html.indexOf('<span class="stats-outcome-period" id="statsOutcomePeriod"',outcomeWorkspace);
const equityCanvas=html.indexOf('<div class="equity-canvas-wrap" id="equityCanvasWrap"',outcomeWorkspace);
assert.ok(outcomeWorkspace>=0&&outcomePeriod>outcomeWorkspace&&equityCanvas>outcomePeriod,'the selected-period date is inside the graph section above the chart');
assert.match(html,/\.page\.active#page-statistics:has\(#statsStatisticsView:not\(\[hidden\]\)\)\{[^}]*height:calc\(100dvh - 36px\)/,'the active Statistics page fills the available viewport');
assert.match(html,/\.page\.active#page-statistics:has\(#statsStatisticsView:not\(\[hidden\]\)\)>\.stats-section-a-header\{flex:0 0 auto\}/,'the merged control row stays fixed above the expanding statistics view');
assert.match(html,/#statsStatisticsView:not\(\[hidden\]\)>\.stats-section-a\{[^}]*grid-template-rows:auto minmax\(0,1fr\)/,'the summary spans above the columns, which fill the remaining statistics section height');
assert.match(html,/\.stats-combined-outcomes\{display:flex;flex-direction:column;min-height:0\}/,'the combined chart panel can stretch vertically');
assert.match(html,/\.stats-outcome-workspace\{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;padding:30px 12px 12px\}/,'the graph workspace fills the available chart panel');
assert.match(html,/\.stats-combined-outcomes \.equity-canvas-wrap,\.stats-outcome-canvas-wrap\{flex:1 1 auto;min-height:0;height:auto\}/,'each outcome chart canvas expands to fill its workspace');
assert.ok(!html.includes('class="stats-lower"'),'the retired lower Statistics panels are removed');
assert.ok(!html.includes('Performance Details')&&!html.includes('Performance by Instrument'),'the circled legacy panels are no longer rendered');
assert.ok(!html.includes('id="instrumentStatsBody"')&&!html.includes('function renderInstrumentStats'),'legacy instrument breakdown rendering is removed');
for(const id of [
  'statEquityHeaderEnding','statEquityHeaderNetPnl','statWinRateGauge','statWinRateGaugeValue',
  'statWinRateReturnLabel','statProfitFactorDiagramValue','statsPrimaryAvgPnlValue',
  'statsPrimaryAvgProfit','statsPrimaryAvgLoss','statsPrimaryAvgPnlDiagram',
  'statsPrimaryAvgProfitBar','statsPrimaryAvgLossBar','statsOutcomeTabEquity','statsIndicatorStack'
])assert.ok(html.includes('id="'+id+'"'),'Missing Section A measurement '+id);
assert.match(html,/class="stats-average-pnl-track"/,'the average-profit/loss comparison diagram is present');
assert.match(html,/class="stats-average-pnl-zero"/,'the comparison diagram marks its zero baseline');
assert.match(html,/class="stats-primary-unit">PER TRADE/,'the average P&L card labels its per-trade unit');
assert.match(html,/const groups=\['Edge Performance','Execution Quality'\]/,'optional indicators come from the specialist environments');
assert.match(html,/Latest balance reported by the selected account/,'current balance prefers the selected account value');

function node(){return{textContent:'',className:'',style:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}}
const ids=[
  'statProfitFactorDiagramValue','statProfitFactorExplanation','statProfitFactorBar',
  'statProfitFactorProfitFill','statProfitFactorLossFill','statProfitFactorGrossProfit',
  'statProfitFactorGrossLoss','statWinRateGauge','statWinRateGaugeProgress',
  'statWinRateGaugeValue','statWinRateGaugeCount','statWinRateReturnLabel',
  'statsPrimaryAvgPnlValue','statsPrimaryAvgPnlCount','statsPrimaryAvgProfit','statsPrimaryAvgLoss',
  'statsPrimaryAvgPnlDiagram','statsPrimaryAvgProfitBar','statsPrimaryAvgLossBar'
];
const nodes=new Map(ids.map(id=>[id,node()]));
const context=vm.createContext({
  $:selector=>nodes.get(selector.replace(/^#/,'') )||null,
  setStatisticsText(id,value,className){const item=nodes.get(id);if(item){item.textContent=String(value);if(className)item.className=className;}},
  statsAnalytics:()=>stats,
  formatProfitFactorCurrency:value=>'$'+Number(value).toFixed(2),
  formatReturnPct:value=>(value>=0?'+':'')+Number(value).toFixed(2)+'%',
  pnlClass:value=>value>0?'pos':value<0?'neg':'neutral',
  signedMoney:value=>(value>0?'+':value<0?'-':'')+'$'+Math.abs(Number(value)).toFixed(2),
  Number,Math,String
});
vm.runInContext(extractFunction('renderProfitFactorIndicator')+'\n'+extractFunction('renderStatisticsIndicators'),context);

const winnersAndLosers=[{pnl:80},{pnl:-20},{pnl:40}];
const complete=stats.summarizePnl(winnersAndLosers);
const factor={state:'finite',value:6,grossProfit:120,grossLoss:20,recordedTradeCount:3,missingPnlCount:0};
context.renderStatisticsIndicators(2.5,200/3,winnersAndLosers,factor,complete);
assert.equal(nodes.get('statWinRateGaugeValue').textContent,'66.7%');
assert.equal(nodes.get('statWinRateReturnLabel').textContent,'+2.50% return');
assert.equal(nodes.get('statProfitFactorDiagramValue').textContent,'6.00×');
assert.equal(nodes.get('statsPrimaryAvgPnlValue').textContent,'+$33.33');
assert.equal(nodes.get('statsPrimaryAvgProfit').textContent,'+$60.00');
assert.equal(nodes.get('statsPrimaryAvgLoss').textContent,'-$20.00');
assert.equal(nodes.get('statsPrimaryAvgProfitBar').style.width,'50%','the average-profit bar extends right from the zero baseline');
assert.ok(Math.abs(parseFloat(nodes.get('statsPrimaryAvgLossBar').style.width)-16.6667)<0.01,'the average-loss bar extends left on the same scale');
assert.match(nodes.get('statsPrimaryAvgPnlDiagram').attributes['aria-label'],/\+\$60\.00 compared with average loss -\$20\.00/,'the comparison exposes an accessible summary');

const incompleteTrades=[{pnl:80},{pnl:null}];
context.renderStatisticsIndicators(null,null,incompleteTrades,{state:'incomplete',value:null,grossProfit:80,grossLoss:0,recordedTradeCount:1,missingPnlCount:1},stats.summarizePnl(incompleteTrades));
assert.equal(nodes.get('statWinRateGaugeValue').textContent,'—','missing P&L keeps the win rate unavailable');
assert.equal(nodes.get('statWinRateReturnLabel').textContent,'— return','unverified opening equity keeps return unavailable');
assert.equal(nodes.get('statsPrimaryAvgPnlValue').textContent,'—','missing P&L keeps average trade P&L unavailable');
assert.equal(nodes.get('statsPrimaryAvgProfit').textContent,'—','incomplete samples do not imply average profit');
assert.equal(nodes.get('statsPrimaryAvgLoss').textContent,'—','incomplete samples do not imply average loss');
assert.equal(nodes.get('statsPrimaryAvgProfitBar').style.width,'0%','incomplete samples do not display estimated average-profit bars');
assert.equal(nodes.get('statsPrimaryAvgLossBar').style.width,'0%','incomplete samples do not display estimated average-loss bars');

const balanceContext=vm.createContext({
  tradingAccount:{current_balance:250,starting_balance:100},
  trades:[{pnl:5}],
  statsAnalytics:()=>stats,
  Number,String
});
vm.runInContext(extractFunction('verifiedCurrentAccountBalance'),balanceContext);
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,250,'current account data takes precedence over a calculated historical balance');
balanceContext.tradingAccount={starting_balance:100};
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,105,'a complete journal history can calculate a verified balance');
balanceContext.trades=[{pnl:5},{pnl:null}];
assert.equal(balanceContext.verifiedCurrentAccountBalance().value,null,'incomplete P&L does not create a guessed current balance');

console.log('PASS Graphs, Personal Intelligence chat, and chat history are arranged horizontally after the full-width financial summary');
console.log('PASS the legacy Performance Details and Performance by Instrument panels are removed');
console.log('PASS current balance, net P&L, win rate, period return, profit factor, and average P&L render from complete data');
console.log('PASS missing recorded P&L stays unavailable instead of becoming a zero');
