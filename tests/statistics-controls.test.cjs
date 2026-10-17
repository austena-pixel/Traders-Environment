// Regression coverage for Statistics sidebar zoom and selected-timeframe persistence.
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
const rangeContext=vm.createContext({
  localStorage:storage,
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
rangeContext.persistStatsRangePreference('6m');
assert.equal(storage.value,'6m','new timeframe selection is saved');
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

const stackClasses=createClassList(['stats-autozoom']);
const button={attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
const state={textContent:'ON'};
const cards=['profit','win','risk'].map(name=>({
  name,
  classes:createClassList(),
  matches(selector){return selector==='.stats-indicator-card';},
  classList:{
    add(className){this.owner.classes.add(className);},
    remove(className){this.owner.classes.remove(className);},
    contains(className){return this.owner.classes.contains(className);}
  }
}));
cards.forEach(card=>{card.classList.owner=card;});
const stack={
  classList:stackClasses,
  contains(node){return cards.includes(node);},
  querySelectorAll(selector){
    assert.equal(selector,'.stats-indicator-card.stats-card-zoomed');
    return cards.filter(card=>card.classes.contains('stats-card-zoomed'));
  }
};
const outsideCard={matches(){return true;},classList:createClassList()};
const elements=new Map([
  ['#statsIndicatorStack',stack],
  ['#statsAutoZoomBtn',button],
  ['#statsAutoZoomState',state]
]);
const zoomContext=vm.createContext({$:selector=>elements.get(selector)});
vm.runInContext(
  'let statsAutoZoom=true;\n'+extractFunction('setStatsAutoZoom')+'\n'+extractFunction('setZoomedStatsCard'),
  zoomContext
);
zoomContext.profitCard=cards[0];
zoomContext.winCard=cards[1];
zoomContext.riskCard=cards[2];
zoomContext.outsideCard=outsideCard;
vm.runInContext('setZoomedStatsCard(profitCard)',zoomContext);
assert.equal(cards[0].classes.contains('stats-card-zoomed'),true,'Profit Factor can zoom');
assert.equal(cards[1].classes.contains('stats-card-zoomed'),false);
vm.runInContext('setZoomedStatsCard(winCard)',zoomContext);
assert.equal(cards[0].classes.contains('stats-card-zoomed'),false);
assert.equal(cards[1].classes.contains('stats-card-zoomed'),true,'Win Rate can zoom');
vm.runInContext('setZoomedStatsCard(riskCard)',zoomContext);
assert.equal(cards[1].classes.contains('stats-card-zoomed'),false);
assert.equal(cards[2].classes.contains('stats-card-zoomed'),true,'Risk & Expectancy can zoom with its separate bottom anchor');
vm.runInContext('setZoomedStatsCard(outsideCard)',zoomContext);
assert.equal(cards[2].classes.contains('stats-card-zoomed'),false,'sections outside the analytics sidebar cannot zoom');
vm.runInContext('setZoomedStatsCard(riskCard);setStatsAutoZoom(false)',zoomContext);
assert.equal(stackClasses.contains('stats-autozoom'),false);
assert.equal(button.attributes['aria-pressed'],'false');
assert.equal(state.textContent,'OFF');
assert.equal(cards[2].classes.contains('stats-card-zoomed'),false,'turning Auto Zoom off clears the zoomed section');
vm.runInContext('setZoomedStatsCard(riskCard)',zoomContext);
assert.equal(cards[2].classes.contains('stats-card-zoomed'),false,'disabled Auto Zoom cannot zoom cards');
vm.runInContext('setStatsAutoZoom(true);setZoomedStatsCard(winCard)',zoomContext);
assert.equal(stackClasses.contains('stats-autozoom'),true);
assert.equal(button.attributes['aria-pressed'],'true');
assert.equal(state.textContent,'ON');
assert.equal(cards[1].classes.contains('stats-card-zoomed'),true);

assert.ok(!html.includes('class="chart-legend-note"'),'highlighted trade-number note was removed');
assert.ok(!html.includes('X-axis = trade number (T0, T1, T2, T3...).'),'highlighted X-axis explanation was removed');
assert.match(html,/id="statsAutoZoomBtn"[^>]*aria-pressed="true"[^>]*aria-controls="statsIndicatorStack"/,'Auto Zoom starts enabled and controls the sidebar');
assert.match(html,/<aside class="stats-indicator-stack stats-autozoom" id="statsIndicatorStack"/,'zoom scope is the right analytics sidebar');
assert.match(html,/\.stats-indicator-stack\.stats-autozoom \.stats-indicator-card\.stats-card-zoomed\{\s*transform:scale\(/,'sidebar analytics cards receive the zoom transform');
assert.equal((html.match(/class="stats-analysis-module stats-indicator-card stats-autozoom-bottom-anchor"/g)||[]).length,1,'The remaining Statistics analysis card keeps its bottom-up zoom anchor');
assert.match(html,/<section class="panel stats-research-panel stats-execution-profit-panel">[\s\S]*?id="statExecutionProfitChart"/,'Execution profitability comparison is preserved in Execution Quality');
assert.match(html,/id="statsPeriodToolbar"[\s\S]*?<div class="stats-view-panel" id="statsStatisticsView"/,'shared period controls sit outside the environment panels');
assert.match(html,/\.stats-indicator-stack\.stats-autozoom \.stats-indicator-card\.stats-autozoom-bottom-anchor\.stats-card-zoomed\{\s*transform-origin:right bottom;/,'Risk & Expectancy expands upward from its bottom-right edge');
assert.match(html,/transform-origin:right top;/,'top analytics cards keep their right edge inside the page while zooming');
assert.ok(html.includes('id="equityChart"'),'Equity Curve remains present');
assert.match(html,/\$\$\('\[data-stats-range\]'\)\.forEach\(btn=>\{/,'timeframe handlers are scoped to Statistics buttons');
assert.match(html,/persistStatsRangePreference\(statsRange\);/,'selected timeframe is persisted after selection');

console.log('PASS selected timeframe persists, restores, and falls back safely');
console.log('PASS Auto Zoom is accessible, toggleable, and restricted to sidebar analytics cards');
console.log('PASS highlighted labels are removed while the Equity Curve remains intact');
const zoomRange={min:'100',max:'150',value:'125',attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
const zoomOutput={textContent:'125%'};
const zoomPreferenceStorage=createStorage(null);
const zoomScaleStack={style:{values:{},setProperty(name,value){this.values[name]=value;}}};
const zoomElements=new Map([
  ['#statsAutoZoomRange',zoomRange],
  ['#statsAutoZoomValue',zoomOutput],
  ['#statsIndicatorStack',zoomScaleStack]
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
assert.equal(zoomScaleStack.style.values['--stats-autozoom-scale'],'1.37','manual zoom scales sidebar cards');
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
assert.match(html,/transform:scale\(var\(--stats-autozoom-scale\)\)/,'the selected zoom controls the enlarged sidebar section');
assert.match(html,/window.addEventListener\('resize',syncStatsAutoZoomViewportLimit\)/,'responsive limits update when viewport size changes');
console.log('PASS manual zoom controls stay within the responsive current zoom limit and expand upward');
assert.match(html,/const STATS_AUTOZOOM_PREFERENCE_KEY = 'tios_statistics_autozoom_percent_v1'/,'manual zoom uses a stable local preference key');
assert.match(html,/let statsAutoZoomPercent = loadStatsAutoZoomPreference\(\);/,'saved zoom setting loads on startup');
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
