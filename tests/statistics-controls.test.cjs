// Regression coverage for Statistics sidebar zoom and selected-period persistence.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../t-ios.html'),'utf8');

const preferenceStart=html.indexOf('const STATS_RANGE_PREFERENCE_KEY =');
const preferenceEnd=html.indexOf('\nlet statsAnchorDate =',preferenceStart);
assert.ok(preferenceStart>=0&&preferenceEnd>preferenceStart,'Statistics timeframe preference helpers must exist');
const preferenceSource=html.slice(preferenceStart,preferenceEnd);

function createClassList(initial=[]){
  const values=new Set(initial);
  return {
    add(name){values.add(name);},
    remove(name){values.delete(name);},
    contains(name){return values.has(name);},
    toggle(name,force){
      const enabled=force===undefined?!values.has(name):Boolean(force);
      if(enabled)values.add(name);else values.delete(name);
      return enabled;
    }
  };
}

function createStorage(value,{blocked=false}={}){
  return {
    value,
    savedKey:null,
    getItem(key){if(blocked)throw new Error('Storage disabled');this.savedKey=key;return this.value;},
    setItem(key,next){if(blocked)throw new Error('Storage disabled');this.savedKey=key;this.value=next;}
  };
}

const timeframeButtons=['1d','1w','1m','6m','1y','all'].map(range=>({
  dataset:{statsRange:range},
  classList:createClassList(range==='1d'?['active']:[])
}));
const storage=createStorage('1m');
const currentRangeLabel={textContent:''};
const rangeContext=vm.createContext({
  localStorage:storage,
  $:selector=>selector==='#statsPeriodCurrent'?currentRangeLabel:null,
  $$:selector=>{
    assert.equal(selector,'[data-stats-range]','only Statistics timeframe buttons should be synchronized');
    return timeframeButtons;
  }
});
vm.runInContext(preferenceSource,rangeContext);
assert.equal(vm.runInContext('statsRange',rangeContext),'1m','saved Month timeframe loads as the default');
rangeContext.syncStatsRangeButtons();
assert.equal(timeframeButtons.find(button=>button.dataset.statsRange==='1m').classList.contains('active'),true);
assert.equal(timeframeButtons.find(button=>button.dataset.statsRange==='1d').classList.contains('active'),false);
assert.equal(currentRangeLabel.textContent,'Month','the single period control shows the saved reporting range');
rangeContext.persistStatsRangePreference('6m');
assert.equal(storage.value,'6m','new timeframe selection is saved');
vm.runInContext("statsRange='6m';syncStatsRangeButtons()",rangeContext);
assert.equal(currentRangeLabel.textContent,'6 Months','the selected reporting range updates the single control');
rangeContext.persistStatsRangePreference('invalid-range');
assert.equal(storage.value,'6m','invalid timeframe values are ignored');

const invalidContext=vm.createContext({localStorage:createStorage('quarter')});
vm.runInNewContext(preferenceSource,invalidContext);
assert.equal(vm.runInContext('statsRange',invalidContext),'1d','invalid saved values fall back to Day');
const blockedContext=vm.createContext({localStorage:createStorage(null,{blocked:true})});
vm.runInNewContext(preferenceSource,blockedContext);
assert.equal(vm.runInContext('statsRange',blockedContext),'1d','storage errors fall back to Day');
assert.doesNotThrow(()=>blockedContext.persistStatsRangePreference('1w'),'blocked storage must not break Statistics');

function extractFunction(name){
  const marker='function '+name+'(';
  const start=html.indexOf(marker);
  assert.ok(start>=0,'Missing '+name+' helper');
  const signatureEnd=html.indexOf('){',start);
  assert.ok(signatureEnd>=0,'Missing body for '+name);
  const open=signatureEnd+1;
  let depth=0;
  for(let i=open;i<html.length;i++){
    if(html[i]==='{')depth++;
    else if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error('Unclosed function '+name);
}

const summaryClasses=createClassList();
const stackClasses=createClassList();
const controlsClasses=createClassList();
const button={attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
button.closest=selector=>selector==='.stats-autozoom-controls'?{classList:controlsClasses}:null;
const state={textContent:'OFF'};
function makeCard(name,kind){
  const classes=createClassList();
  return {
    name,kind,classes,
    matches(selector){return selector.split(',').some(part=>part.trim()==='.'+kind);},
    contains(){return false;},
    classList:{
      add(className){classes.add(className);},
      remove(className){classes.remove(className);},
      contains(className){return classes.contains(className);}
    }
  };
}
const primaryCards=['balance','netPnl','winRate','profitFactor','averagePnl'].map(name=>makeCard(name,'stats-primary-metric'));
const indicatorCards=['expectancy','qualifying','coverage'].map(name=>makeCard(name,'stats-indicator-card'));
const cards=[...primaryCards,...indicatorCards];
function makeContainer(containerCards,classList){
  return {
    classList,
    style:{values:{},setProperty(name,value){this.values[name]=value;}},
    contains(node){return containerCards.includes(node);},
    querySelectorAll(selector){
      assert.equal(selector,'.stats-card-zoomed');
      return containerCards.filter(card=>card.classes.contains('stats-card-zoomed'));
    }
  };
}
const summary=makeContainer(primaryCards,summaryClasses);
const stack=makeContainer(indicatorCards,stackClasses);
const outsideCard=makeCard('outside','outside-card');
const elements=new Map([
  ['#statsPrimarySummary',summary],
  ['#statsIndicatorStack',stack],
  ['#statsAutoZoomBtn',button],
  ['#statsAutoZoomState',state]
]);
const zoomContext=vm.createContext({$:selector=>elements.get(selector)});
vm.runInContext(
  'let statsAutoZoom=false;\\n'+
  extractFunction('statsAutoZoomContainers')+'\\n'+
  extractFunction('setStatsAutoZoom')+'\\n'+
  extractFunction('setZoomedStatsCard')+'\\n'+
  extractFunction('bindStatsAutoZoomCards'),
  zoomContext
);
const cardByName=Object.fromEntries(cards.map(card=>[card.name,card]));
Object.entries(cardByName).forEach(([name,card])=>zoomContext[name+'Card']=card);
zoomContext.outsideCard=outsideCard;
vm.runInContext('setStatsAutoZoom(true)',zoomContext);
for(const name of ['balance','netPnl','winRate','profitFactor','averagePnl']){
  vm.runInContext('setZoomedStatsCard('+name+'Card)',zoomContext);
  assert.equal(cardByName[name].classes.contains('stats-card-zoomed'),true,name+' can zoom');
  assert.equal(cards.filter(card=>card.classes.contains('stats-card-zoomed')).length,1,'only one card is enlarged at a time');
}
vm.runInContext('setZoomedStatsCard(expectancyCard)',zoomContext);
assert.equal(cardByName.expectancy.classes.contains('stats-card-zoomed'),true,'optional indicators keep Auto Zoom');
vm.runInContext('setZoomedStatsCard(outsideCard)',zoomContext);
assert.equal(cards.some(card=>card.classes.contains('stats-card-zoomed')),false,'cards outside Statistics cannot zoom');

const eventHandlers={};
const summaryEvents={
  addEventListener(name,handler){eventHandlers[name]=handler;},
  contains(node){return primaryCards.includes(node);}
};
zoomContext.summaryEvents=summaryEvents;
vm.runInContext("bindStatsAutoZoomCards(summaryEvents,'.stats-primary-metric')",zoomContext);
eventHandlers.pointerover({target:{closest:selector=>cardByName.balance},relatedTarget:null});
assert.equal(cardByName.balance.classes.contains('stats-card-zoomed'),true,'hover zooms a highlighted summary card');
eventHandlers.pointerleave();
assert.equal(cardByName.balance.classes.contains('stats-card-zoomed'),false,'leaving a card clears its zoom');
eventHandlers.focusin({target:{closest:selector=>cardByName.averagePnl}});
assert.equal(cardByName.averagePnl.classes.contains('stats-card-zoomed'),true,'keyboard focus zooms a highlighted summary card');
eventHandlers.focusout({relatedTarget:null});
assert.equal(cardByName.averagePnl.classes.contains('stats-card-zoomed'),false,'leaving keyboard focus clears its zoom');

vm.runInContext('setZoomedStatsCard(expectancyCard);setStatsAutoZoom(false)',zoomContext);
assert.equal(summaryClasses.contains('stats-autozoom'),false);
assert.equal(stackClasses.contains('stats-autozoom'),false);
assert.equal(button.attributes['aria-pressed'],'false');
assert.equal(state.textContent,'OFF');
assert.equal(controlsClasses.contains('is-enabled'),false,'turning Auto Zoom off hides its magnification controls');
assert.equal(cards.some(card=>card.classes.contains('stats-card-zoomed')),false,'turning Auto Zoom off clears every zoomed card');
vm.runInContext('setZoomedStatsCard(winRateCard)',zoomContext);
assert.equal(cards.some(card=>card.classes.contains('stats-card-zoomed')),false,'disabled Auto Zoom cannot zoom cards');
vm.runInContext('setStatsAutoZoom(true);setZoomedStatsCard(winRateCard)',zoomContext);
assert.equal(summaryClasses.contains('stats-autozoom'),true);
assert.equal(stackClasses.contains('stats-autozoom'),true);
assert.equal(button.attributes['aria-pressed'],'true');
assert.equal(state.textContent,'ON');
assert.equal(controlsClasses.contains('is-enabled'),true,'turning Auto Zoom on reveals its magnification controls');
assert.equal(cardByName.winRate.classes.contains('stats-card-zoomed'),true);

assert.ok(!html.includes('class="chart-legend-note"'),'highlighted trade-number note was removed');
assert.ok(!html.includes('X-axis = trade number (T0, T1, T2, T3...).'),'highlighted X-axis explanation was removed');
assert.match(html,/id="statsAutoZoomBtn"[^>]*aria-pressed="false"[^>]*aria-controls="statsPrimarySummary statsIndicatorStack"/,'Auto Zoom controls highlighted summaries and optional indicators');
assert.match(html,/<div class="stats-indicator-stack stats-indicator-grid" id="statsIndicatorStack"/,'zoom scope is the customizable indicator grid');
assert.match(html,/\.stats-autozoom-controls:not\(\.is-enabled\) \.stats-autozoom-zoom\{display:none\}/,'percentage and slider stay hidden until Auto Zoom is enabled');
assert.match(html,/#statsPrimarySummary\.stats-autozoom \.stats-primary-metric\.stats-card-zoomed\{transform:scale\(/,'highlighted summary cards receive the zoom transform');
assert.match(html,/\.stats-indicator-stack\.stats-autozoom \.stats-indicator-card\.stats-card-zoomed\{\s*transform:scale\(/,'sidebar analytics cards keep the zoom transform');
assert.match(html,/<div class="stats-primary-summary" id="statsPrimarySummary"[^>]*>[\s\S]*?(?:<article class="[^"]*stats-primary-metric[^"]*" role="listitem" tabindex="0">){5}/,'all five highlighted financial summaries are keyboard-focusable');
assert.match(html,/\.stats-indicator-grid \.stats-indicator-card\{\s*min-width:0;min-height:112px/,'selected indicator cards use compact dashboard dimensions');
assert.match(html,/<section class="panel stats-research-panel stats-execution-profit-panel">[\s\S]*?id="statExecutionProfitChart"/,'Execution profitability comparison is preserved in Execution Quality');
assert.match(html,/id="statsPeriodToolbar"[\s\S]*?<div class="stats-view-panel" id="statsStatisticsView"/,'shared period controls sit outside the environment panels');
assert.match(html,/\.stats-indicator-grid \.stats-indicator-card\.stats-card-zoomed\{transform-origin:center top\}/,'zoomed cards expand from their center top within the grid');
assert.ok(html.includes('data-indicator-action="up"')&&html.includes('data-indicator-action="down"'),'cards expose reorder controls while arranging');
assert.ok(html.includes('id="equityChart"'),'Equity Curve remains present');
assert.match(html,/\$\$\('\[data-stats-range\]'\)\.forEach\(btn=>\{/,'timeframe handlers are scoped to Statistics buttons');
assert.match(html,/persistStatsRangePreference\(statsRange\);/,'selected timeframe is persisted after selection');
assert.match(html,/<details class="stats-period-dropdown" id="statsPeriodSelector">[\s\S]*?<summary class="stats-period-trigger" aria-label="Choose reporting period"><span>Period:<\/span><strong id="statsPeriodCurrent">Day<\/strong><\/summary>/,'six visible date pills collapse into one button that shows the current range');
assert.equal((html.match(/data-stats-range=/g)||[]).length,6,'all reporting ranges remain available in the menu');

console.log('PASS selected timeframe persists, restores, and falls back safely');
console.log('PASS Auto Zoom covers highlighted financial summaries and optional indicators on hover or focus');
console.log('PASS highlighted labels are removed while the Equity Curve remains intact');
const zoomRange={min:'100',max:'150',value:'125',attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
const zoomOutput={textContent:'125%'};
const zoomPreferenceStorage=createStorage(null);
const zoomScaleStack={style:{values:{},setProperty(name,value){this.values[name]=value;}}};
const zoomScaleSummary={style:{values:{},setProperty(name,value){this.values[name]=value;}}};
const zoomElements=new Map([
  ['#statsAutoZoomRange',zoomRange],
  ['#statsAutoZoomValue',zoomOutput],
  ['#statsIndicatorStack',zoomScaleStack],
  ['#statsPrimarySummary',zoomScaleSummary]
]);
const zoomViewport={innerWidth:1440};
const scaleContext=vm.createContext({
  $:selector=>zoomElements.get(selector),
  window:zoomViewport,
  document:{documentElement:{clientWidth:1440}},
  localStorage:zoomPreferenceStorage
});
vm.runInContext(
  "const STATS_AUTOZOOM_PREFERENCE_KEY='tios_statistics_autozoom_percent_v1'; let statsAutoZoomPercent=125;\n"+
  extractFunction('statsAutoZoomMaxPercent')+'\n'+
  extractFunction('persistStatsAutoZoomPreference')+'\n'+
  extractFunction('setStatsAutoZoomPercent')+'\n'+
  extractFunction('syncStatsAutoZoomViewportLimit'),
  scaleContext
);
scaleContext.setStatsAutoZoomPercent(137);
assert.equal(zoomRange.value,'137','manual zoom value updates');
assert.equal(zoomPreferenceStorage.value,'137','manual zoom adjustment becomes the saved default');
assert.equal(zoomOutput.textContent,'137%','manual zoom percentage is readable');
assert.equal(zoomScaleStack.style.values['--stats-autozoom-scale'],'1.37','manual zoom scales optional indicator cards');
assert.equal(zoomScaleSummary.style.values['--stats-autozoom-scale'],'1.37','the same manual zoom scales highlighted summary cards');
assert.equal(zoomRange.max,'150','desktop maximum stays at the current zoom');
zoomViewport.innerWidth=800;
scaleContext.syncStatsAutoZoomViewportLimit();
assert.equal(zoomRange.max,'122','tablet maximum follows its current zoom');
assert.equal(zoomRange.value,'122','existing zoom clamps to the tablet maximum');
zoomViewport.innerWidth=500;
scaleContext.syncStatsAutoZoomViewportLimit();
assert.equal(zoomRange.max,'106','mobile maximum follows its current zoom');
assert.equal(zoomRange.value,'106','maximum setting tracks the responsive zoom ceiling');
assert.equal(zoomPreferenceStorage.value,'137','viewport caps do not overwrite the saved desktop preference');
scaleContext.setStatsAutoZoomPercent(104);
assert.equal(zoomPreferenceStorage.value,'104','a new manual choice replaces the previous default');
zoomViewport.innerWidth=1400;
scaleContext.syncStatsAutoZoomViewportLimit();
assert.equal(zoomRange.value,'104','a manually chosen level below the maximum survives viewport changes');
assert.equal(zoomRange.max,'150','desktop zoom ceiling is restored');
assert.match(html,/<label class="stats-autozoom-zoom" for="statsAutoZoomRange">[\s\S]*?<input id="statsAutoZoomRange" type="range" min="100" max="150" step="1" value="125"/,'manual zoom range starts at 125%');
assert.match(html,/transform-origin:right bottom;/,'zoom remains anchored at its bottom-right edge');
assert.match(html,/transform:scale\(var\(--stats-autozoom-scale\)\)/,'the selected zoom controls enlarged Statistics cards');
assert.match(html,/window.addEventListener\('resize',syncStatsAutoZoomViewportLimit\)/,'responsive limits update when viewport size changes');
console.log('PASS manual zoom controls stay within the responsive current zoom limit and expand upward');
assert.match(html,/const STATS_AUTOZOOM_PREFERENCE_KEY = 'tios_statistics_autozoom_percent_v1'/,'manual zoom uses a stable local preference key');
assert.match(html,/let statsAutoZoomPercent = loadStatsAutoZoomPreference\(\);/,'saved zoom setting loads on startup');
assert.match(html,/let statsAutoZoom = loadStatsAutoZoomEnabled\(\);/,'Auto Zoom restores the saved on/off state');
const savedZoomContext=vm.createContext({localStorage:createStorage('138')});
vm.runInNewContext(
  "const STATS_AUTOZOOM_PREFERENCE_KEY='tios_statistics_autozoom_percent_v1';\n"+
  extractFunction('loadStatsAutoZoomPreference')+'\n'+extractFunction('persistStatsAutoZoomPreference')+'\n'+
  'let statsAutoZoomPercent=loadStatsAutoZoomPreference();',
  savedZoomContext
);
assert.equal(vm.runInContext('statsAutoZoomPercent',savedZoomContext),138,'saved adjustment restores on reload');
savedZoomContext.persistStatsAutoZoomPreference(128);
assert.equal(savedZoomContext.localStorage.value,'128','new adjustment replaces the saved default');
const invalidZoomContext=vm.createContext({localStorage:createStorage('99')});
vm.runInNewContext(
  "const STATS_AUTOZOOM_PREFERENCE_KEY='tios_statistics_autozoom_percent_v1';\n"+
  extractFunction('loadStatsAutoZoomPreference'),
  invalidZoomContext
);
assert.equal(invalidZoomContext.loadStatsAutoZoomPreference(),125,'invalid saved zoom falls back to 125%');
console.log('PASS 125% is the default and user-selected zoom persists across reloads');
const enabledStorage=createStorage(null);
const enabledContext=vm.createContext({localStorage:enabledStorage});
vm.runInNewContext(
  "const STATS_AUTOZOOM_ENABLED_KEY='tios_statistics_autozoom_enabled_v1';\n"+
  extractFunction('loadStatsAutoZoomEnabled')+'\n'+extractFunction('persistStatsAutoZoomEnabled'),
  enabledContext
);
assert.equal(enabledContext.loadStatsAutoZoomEnabled(),false,'Auto Zoom is off for users without a saved choice');
enabledContext.persistStatsAutoZoomEnabled(true);
assert.equal(enabledStorage.value,'true','enabling Auto Zoom is saved');
assert.equal(enabledContext.loadStatsAutoZoomEnabled(),true,'a saved Auto Zoom choice restores');
enabledContext.persistStatsAutoZoomEnabled(false);
assert.equal(enabledStorage.value,'false','disabling Auto Zoom is saved');
const blockedEnabledContext=vm.createContext({localStorage:createStorage(null,{blocked:true})});
vm.runInNewContext(
  "const STATS_AUTOZOOM_ENABLED_KEY='tios_statistics_autozoom_enabled_v1';\n"+
  extractFunction('loadStatsAutoZoomEnabled')+'\n'+extractFunction('persistStatsAutoZoomEnabled'),
  blockedEnabledContext
);
assert.equal(blockedEnabledContext.loadStatsAutoZoomEnabled(),false,'blocked storage safely defaults Auto Zoom off');
assert.doesNotThrow(()=>blockedEnabledContext.persistStatsAutoZoomEnabled(true));
console.log('PASS Auto Zoom stays hidden until enabled and its state persists safely');
