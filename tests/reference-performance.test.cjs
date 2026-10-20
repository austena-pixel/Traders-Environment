const assert = require('node:assert/strict');
const ref = require('../core/reference-performance.js');

assert.equal(ref.COMPONENTS.length, 6);
assert.deepEqual(ref.COMPONENTS.map(item => item.name), [
  'Reference Plan',
  'Market Data',
  'Opportunity Detection',
  'Reference Execution',
  'Execution Verification',
  'Performance Measurement'
]);

const playbook = {id:'playbook-1', version:3, approval_status:'approved', sections:[{name:'Entry', rules:['wait for close']}]};
const rules = [{id:'rule-1', version:2, approval_status:'approved', text:'Risk 1R maximum'}];
const original = JSON.stringify({playbook, rules});
const payload = ref.createPlanVersionPayload({
  name:'Approved V75',
  version_number:1,
  approval_status:'approved',
  approved_at:'2026-10-20T15:00:00.000Z',
  playbook,
  trading_rules:rules
});
assert.equal(payload.approval_status,'approved');
assert.equal(payload.plan_snapshot.playbook.version,3);
assert.deepEqual(payload.source_rule_ids,['rule-1']);
assert.match(payload.snapshot_fingerprint,/^fnv1a64:[0-9a-f]{16}$/);
assert.equal(JSON.stringify({playbook, rules}),original,'snapshot creation must not mutate approved sources');
assert.throws(()=>ref.createPlanVersionPayload({
  version_number:1, approval_status:'draft', playbook, trading_rules:rules
}),/explicit approval/);
assert.throws(()=>ref.createPlanVersionPayload({
  version_number:1, approval_status:'approved',
  playbook:{id:'draft', approval_status:'draft'}, trading_rules:rules
}),/Playbook must be explicitly approved/);
assert.throws(()=>ref.createPlanVersionPayload({
  version_number:1, approval_status:'approved', playbook,
  trading_rules:[{id:'draft-rule', approval_status:'draft'}]
}),/Every Trading Rules source/);

const verification = ref.summarizeExecutionVerification([
  {complied:true},{complied:false},{complied:true}
]);
assert.equal(verification.check_count,3);
assert.ok(Math.abs(verification.execution_accuracy_pct-200/3)<1e-12);
assert.equal(verification.proposed_status,'failed');
assert.equal(ref.summarizeExecutionVerification([{complied:true}]).proposed_status,'passed');
assert.equal(ref.summarizeExecutionVerification([{complied:'yes'}]).proposed_status,'insufficient_evidence');

const verifiedOutcomes = ref.measureVerifiedReferenceOutcomes([
  {id:'a',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:2,
    verification:{execution_attempt_id:'a',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}},
  {id:'b',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:-1,
    verification:{execution_attempt_id:'b',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}},
  {id:'c',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:0,
    verification:{execution_attempt_id:'c',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}},
  {id:'d',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:99,
    verification:{execution_attempt_id:'d',methodology_version_id:'v1',verification_status:'failed',execution_accuracy_pct:50}},
  {id:'live',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'live',execution_status:'completed',realized_r:500,
    verification:{execution_attempt_id:'live',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}}
]);
assert.equal(verifiedOutcomes.measurement_status,'insufficient_evidence',
  'incomplete verification cannot produce a performance preview');
assert.equal(verifiedOutcomes.verified_attempt_count,3);
assert.equal(verifiedOutcomes.expectancy_r,null);
assert.deepEqual(verifiedOutcomes.equity_curve,[]);

const unvalidatedOpportunity=ref.measureVerifiedReferenceOutcomes([
  {id:'pending',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'unvalidated',market_data_validation_status:'validated',
    execution_mode:'simulation',execution_status:'completed',realized_r:8,
    verification:{execution_attempt_id:'pending',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}}
]);
assert.equal(unvalidatedOpportunity.measurement_status,'insufficient_evidence');
assert.equal(unvalidatedOpportunity.verified_attempt_count,0,
  'unvalidated opportunity detection cannot enter Reference Performance');
assert.equal(unvalidatedOpportunity.expectancy_r,null);

const unvalidatedMarket=ref.measureVerifiedReferenceOutcomes([
  {id:'pending-market',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'unvalidated',
    execution_mode:'simulation',execution_status:'completed',realized_r:8,
    verification:{execution_attempt_id:'pending-market',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}}
]);
assert.equal(unvalidatedMarket.verified_attempt_count,0,'unvalidated market ranges cannot enter Reference Performance');

const cleanOutcomes = ref.measureVerifiedReferenceOutcomes([
  {id:'a',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:2,
    verification:{execution_attempt_id:'a',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}},
  {id:'b',methodology_version_id:'v1',opportunity_status:'eligible',opportunity_validation_status:'validated',market_data_validation_status:'validated',execution_mode:'simulation',execution_status:'completed',realized_r:-1,
    verification:{execution_attempt_id:'b',methodology_version_id:'v1',verification_status:'verified',execution_accuracy_pct:100}}
]);
assert.equal(cleanOutcomes.measurement_status,'preview_only','browser arithmetic never marks a persisted result validated');
assert.equal(cleanOutcomes.expectancy_r,0.5);
assert.equal(cleanOutcomes.profit_factor,2);
assert.equal(cleanOutcomes.win_rate_pct,50);
assert.equal(cleanOutcomes.max_drawdown_r,1);
assert.equal(cleanOutcomes.evidence_reliability,'preliminary_sample');
assert.deepEqual(cleanOutcomes.equity_curve.map(point=>point.value),[2,1]);
assert.ok(cleanOutcomes.profit_loss_distribution.every(bin => Number.isFinite(bin.midpoint) && bin.count >= 0));
assert.equal(cleanOutcomes.profit_loss_distribution.reduce((sum, bin) => sum + bin.count, 0),2);

const migration = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
  '../supabase/migrations/20261020183416_reference_performance_foundation.sql'),'utf8');
const referenceSource = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
  '../core/reference-performance.js'),'utf8');
assert.doesNotMatch(referenceSource,/\.from\(['"]trades['"]\)/,
  'Reference Performance never reads the actual trader trade table');
for (const table of [
  'reference_methodology_versions','reference_market_data_refs','reference_opportunities',
  'reference_execution_attempts','reference_execution_verifications','reference_performance_records'
]) {
  assert.match(migration,new RegExp('create table public\\.'+table+'\\b'));
  assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security'));
  assert.match(migration,new RegExp(table+'_select_own'));
  assert.match(migration,new RegExp(table+'_insert_own'));
}
assert.match(migration,/grant insert on public\.reference_methodology_versions/);
assert.match(migration,/data_validation_status text not null default 'unvalidated'/);
assert.match(migration,/detector_validation_status text not null default 'unvalidated'/);
assert.match(migration,/measurement_status text not null default 'pending'/);
assert.match(migration,/grant insert \(user_id, methodology_version_id, market_data_ref_id/);
assert.match(migration,/grant insert \(user_id, methodology_version_id, execution_attempt_id/);
assert.match(migration,/grant insert \(user_id, methodology_version_id, period_start, period_end, source_metadata/);
assert.doesNotMatch(migration,/grant insert on public\.reference_(market_data_refs|opportunities|execution_attempts|execution_verifications|performance_records)/,
  'clients do not get table-level insert privilege on trusted-result tables');
assert.doesNotMatch(migration,/grant[^;]*(update|delete)[^;]*to authenticated/i,
  'the foundation remains append-only for authenticated users');

const page = require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../t-ios.html'),'utf8');
const mainLabels=[...page.matchAll(/<button[^>]*data-edge-performance-tab[^>]*>([^<]+)<\/button>/g)].map(match=>match[1].trim());
assert.deepEqual(mainLabels,['Edge Overview','Methodology Research','Experimental Trading','Edge Diagnostics']);
const overviewLabels=[...page.matchAll(/<button[^>]*data-edge-overview-tab[^>]*>([^<]+)<\/button>/g)].map(match=>match[1].trim());
assert.deepEqual(overviewLabels,['Reference Performance','Observed Trading Evidence']);
for (const value of ['reference-equity','expectancy-time','drawdown','profit-loss','edge-stability']) {
  assert.match(page,new RegExp('<option value="'+value+'"'));
}
for (const value of ['1d','1w','1m','6m','1y','all']) {
  assert.match(page,new RegExp('data-stats-range="'+value+'"'));
}
for (const name of ['Reference Plan','Market Data','Opportunity Detection','Reference Execution','Execution Verification','Performance Measurement']) {
  assert.ok(page.includes(name),'six foundation components are visible');
}
for (const id of ['statsReferenceExpectancyValue','statsReferenceProfitFactorValue','statsReferenceWinRateValue','statsReferenceReliabilityValue']) {
  assert.ok(page.includes('id="'+id+'"'));
}
for (const id of ['statsEdgeExpectancyValue','statsEdgeProfitFactorValue','statsEdgeSampleCount','statsEdgeTimelineChart']) {
  assert.ok(page.includes('id="'+id+'"'));
}
assert.match(page,/<script src="core\/reference-performance\.js"><\/script>/);
assert.match(page,/async function saveApprovedReferencePlanVersion\(\)/);
assert.ok(page.includes("label.dataset.state=/^(Validated|Versioned plan available)/i.test"),
  'empty plan and request states remain pending in the component status treatment');
assert.match(page,/latestReferencePerformanceRecord=record\?\.measurement_status==='validated'\?record:null/,
  'only trusted, validated DB rows feed the Reference Performance interface');
const referenceSourceStart=page.indexOf('id="statsEdgeReferenceView"');
const observedSourceStart=page.indexOf('id="statsEdgeObservedView"');
assert.ok(referenceSourceStart>=0&&observedSourceStart>referenceSourceStart);
for (const name of ['Reference Plan','Market Data','Opportunity Detection','Reference Execution','Execution Verification','Performance Measurement']) {
  const pos=page.indexOf(name);
  assert.ok(pos>referenceSourceStart&&pos<observedSourceStart,'component list stays within Reference Performance');
}
const inlineScriptBlocks=[...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match=>!/\bsrc\s*=/.test(match[1]||"")&&(match[2]||"").trim())
  .filter(match=>!/type\s*=\s*["']module["']/i.test(match[1]||""));
inlineScriptBlocks.forEach(match=>new Function(match[2]));

const nestedStart=page.indexOf('function activateEdgeOverviewTab(selectedTab){');
const nestedEnd=page.indexOf('const edgeOverviewTabs=',nestedStart);
assert.ok(nestedStart>=0&&nestedEnd>nestedStart,'nested Edge Overview tab handlers exist');
const nestedSource=page.slice(nestedStart,nestedEnd)+'\nglobalThis.activateNested=activateEdgeOverviewTab;globalThis.keyNested=handleEdgeOverviewTabKeydown;';
const nestedPanels={statsEdgeReferenceView:{hidden:false},statsEdgeObservedView:{hidden:true}};
const nestedTabs=[
  {id:'statsEdgeReferencePerformanceTab',controls:'statsEdgeReferenceView',attrs:{},tabIndex:0,focused:false,
    getAttribute(name){return this.controls;},setAttribute(name,value){this.attrs[name]=value;},focus(){this.focused=true;}},
  {id:'statsEdgeObservedEvidenceTab',controls:'statsEdgeObservedView',attrs:{},tabIndex:-1,focused:false,
    getAttribute(name){return this.controls;},setAttribute(name,value){this.attrs[name]=value;},focus(){this.focused=true;}}
];
const nestedScope={
  document:{
    querySelectorAll(selector){assert.equal(selector,'[data-edge-overview-tab]');return nestedTabs;},
    getElementById(id){return nestedPanels[id]||null;}
  },
  loadReferenceFoundationStatus(){},
  requestAnimationFrame(callback){callback();},
  statsEdgeTimelineInstance:null
};
new Function('globalThis','scope','with(scope){'+nestedSource+'}')(nestedScope,nestedScope);
nestedScope.activateNested(nestedTabs[1]);
assert.equal(nestedPanels.statsEdgeReferenceView.hidden,true);
assert.equal(nestedPanels.statsEdgeObservedView.hidden,false);
assert.equal(nestedTabs[1].attrs['aria-selected'],'true');
let nestedPrevented=false;
nestedScope.keyNested(nestedTabs[1],{key:'ArrowLeft',preventDefault(){nestedPrevented=true;}});
assert.equal(nestedPrevented,true);
assert.equal(nestedPanels.statsEdgeReferenceView.hidden,false);
assert.equal(nestedPanels.statsEdgeObservedView.hidden,true);
assert.equal(nestedTabs[0].focused,true);

const mainStart=page.indexOf('function activateEdgePerformanceTab(selectedTab){');
const mainEnd=page.indexOf('const edgePerformanceTabs=',mainStart);
assert.ok(mainStart>=0&&mainEnd>mainStart,'main Edge Performance tab handlers exist');
const mainSource=page.slice(mainStart,mainEnd)+'\nglobalThis.activateMain=activateEdgePerformanceTab;globalThis.keyMain=handleEdgePerformanceTabKeydown;';
const mainNames=['statsEdgeOverview','statsEdgeMethodology','statsEdgeExperimental','statsEdgeDiagnostics'];
const mainPanels=Object.fromEntries(mainNames.map((id,index)=>[id,{hidden:index!==0}]));
const mainTabs=mainNames.map((id,index)=>({
  id:id+'Tab',controls:id,attrs:{},tabIndex:index===0?0:-1,focused:false,
  getAttribute(name){return this.controls;},setAttribute(name,value){this.attrs[name]=value;},focus(){this.focused=true;}
}));
const mainScope={
  document:{
    querySelectorAll(selector){assert.equal(selector,'[data-edge-performance-tab]');return mainTabs;},
    getElementById(id){return mainPanels[id]||null;}
  },
  loadReferenceFoundationStatus(){},
  requestAnimationFrame(callback){callback();},
  statsEdgeTimelineInstance:null
};
new Function('globalThis','scope','with(scope){'+mainSource+'}')(mainScope,mainScope);
mainScope.activateMain(mainTabs[1]);
assert.equal(mainPanels.statsEdgeOverview.hidden,true);
assert.equal(mainPanels.statsEdgeMethodology.hidden,false);
let mainPrevented=false;
mainScope.keyMain(mainTabs[1],{key:'Home',preventDefault(){mainPrevented=true;}});
assert.equal(mainPrevented,true);
assert.equal(mainPanels.statsEdgeOverview.hidden,false);
assert.equal(mainTabs[0].focused,true);

function makeMockDb(){
  const calls=[];
  const inserts=[];
  const storedRows=[];
  let insertNumber=0;
  const candles=[
    {id:'candle-good',user_id:'owner',instrument_key:'v75_1s',mt5_symbol:'Volatility 75 (1s) Index',timeframe:'H4',
      candle_open_at:'2026-10-02T00:00:00Z',completed:true,clock_confirmed:true,source:'mt5_bridge'},
    {id:'candle-unconfirmed',user_id:'owner',instrument_key:'v75_1s',mt5_symbol:'Volatility 75 (1s) Index',timeframe:'H4',
      candle_open_at:'2026-10-02T04:00:00Z',completed:true,clock_confirmed:false,source:'mt5_bridge'}
  ];
  const datasets={
    reference_methodology_versions:[{id:'v1',user_id:'owner',version_number:1,approval_status:'approved'}],
    reference_market_data_refs:[{id:'m1',user_id:'owner',methodology_version_id:'v1',availability_status:'available',
      data_validation_status:'validated',completeness_ratio:1,source_table:'mt5_market_candles',source_record_ids:[]}],
    reference_opportunities:[
      {id:'op1',user_id:'owner',methodology_version_id:'v1',market_data_ref_id:'m1',opportunity_status:'eligible',
        detector_validation_status:'validated'},
      {id:'op2',user_id:'owner',methodology_version_id:'v1',market_data_ref_id:'m1',opportunity_status:'eligible',
        detector_validation_status:'validated'}
    ],
    reference_execution_attempts:[
      {id:'a',user_id:'owner',methodology_version_id:'v1',opportunity_id:'op1',execution_mode:'simulation',
        execution_status:'completed',realized_r:2,closed_at:'2026-10-05T10:00:00Z'},
      {id:'b',user_id:'owner',methodology_version_id:'v1',opportunity_id:'op2',execution_mode:'simulation',
        execution_status:'completed',realized_r:-1,closed_at:'2026-10-06T10:00:00Z'}
    ],
    reference_execution_verifications:[
      {execution_attempt_id:'a',user_id:'owner',methodology_version_id:'v1',verification_status:'verified',
        execution_accuracy_pct:100,verified_at:'2026-10-05T10:01:00Z',rule_checks:[{complied:true}],detected_errors:[]},
      {execution_attempt_id:'b',user_id:'owner',methodology_version_id:'v1',verification_status:'verified',
        execution_accuracy_pct:100,verified_at:'2026-10-06T10:01:00Z',rule_checks:[{complied:true}],detected_errors:[]}
    ],
    mt5_market_candles:candles
  };
  function rowsFor(table){
    const base=table==='mt5_market_candles'?candles:(datasets[table]||[]);
    return base.concat(storedRows.filter(row=>row.__table===table));
  }
  function applyFilters(rows,filters){
    return rows.filter(row=>filters.every(([kind,column,value])=>{
      if(kind==='eq')return row[column]===value;
      if(kind==='in')return value.includes(row[column]);
      if(kind==='gte')return String(row[column]||'')>=String(value);
      if(kind==='lte')return String(row[column]||'')<=String(value);
      return true;
    }));
  }
  function defaults(table){
    if(table==='reference_market_data_refs')return {data_validation_status:'unvalidated'};
    if(table==='reference_opportunities')return {opportunity_status:'candidate',detector_validation_status:'unvalidated'};
    if(table==='reference_execution_attempts')return {execution_mode:'simulation',execution_status:'queued',realized_r:null};
    if(table==='reference_execution_verifications')return {verification_status:'pending',execution_accuracy_pct:null,rule_checks:[],detected_errors:[]};
    if(table==='reference_performance_records')return {measurement_status:'pending',attempt_count:0,verified_attempt_count:0,expectancy_r:null,profit_factor:null,win_rate_pct:null};
    return {};
  }
  return {
    calls,inserts,storedRows,
    from(table){
      const query={table,filters:[],inserted:null};
      calls.push({table,action:'from'});
      const builder={
        select(){return builder;},
        eq(column,value){query.filters.push(['eq',column,value]);return builder;},
        gte(column,value){query.filters.push(['gte',column,value]);return builder;},
        lte(column,value){query.filters.push(['lte',column,value]);return builder;},
        in(column,value){query.filters.push(['in',column,value]);return builder;},
        order(){return builder;},
        limit(){return builder;},
        maybeSingle(){
          const data=applyFilters(rowsFor(table),query.filters)[0]||null;
          return Promise.resolve({data,error:null});
        },
        insert(row){
          insertNumber++;
          query.inserted={...defaults(table),id:table+'-'+insertNumber,...row,__table:table};
          inserts.push({table,row:{...row}});
          return builder;
        },
        single(){
          storedRows.push(query.inserted);
          const {__table,...data}=query.inserted||{};
          return Promise.resolve({data,error:null});
        },
        then(resolve,reject){
          const data=applyFilters(rowsFor(table),query.filters);
          return Promise.resolve({data,count:table==='mt5_market_candles'?candles.length:data.length,error:null}).then(resolve,reject);
        }
      };
      return builder;
    }
  };
}

async function verifyRepositoryDataIsolation(){
  const db=makeMockDb();
  const repository=ref.createRepository(db,'owner');
  const candidate=await repository.recordOpportunity({
    user_id:'owner',methodology_version_id:'v1',market_data_ref_id:'m1',
    observed_at:'2026-10-05T09:00:00Z',instrument_key:'v75_1s',
    symbol:'Volatility 75 (1s) Index',timeframe:'M5',
    opportunity_status:'eligible',detector_validation_status:'validated',
    market_conditions:{context:'test'},supporting_evidence:{source:'test'}
  });
  const candidateInsert=db.inserts.find(item=>item.table==='reference_opportunities')?.row;
  assert.ok(candidate);
  assert.equal(candidateInsert.opportunity_status,undefined,'candidate writes cannot set detection status');
  assert.equal(candidateInsert.detector_validation_status,undefined,'detector validation remains trusted-service owned');
  assert.equal(candidateInsert.user_id,'owner');

  const attempt=await repository.recordExecutionAttempt({
    user_id:'owner',methodology_version_id:'v1',opportunity_id:'op1',execution_mode:'simulation',
    execution_status:'completed',realized_r:999,exit_price:999,entry_price:100,stop_loss_price:95,
    take_profit_price:110,direction:'long',risk_plan:{risk_pct:1}
  });
  const attemptInsert=db.inserts.find(item=>item.table==='reference_execution_attempts')?.row;
  assert.equal(attempt.execution_status,'queued');
  assert.equal(attempt.execution_mode,'simulation');
  assert.equal(attemptInsert.execution_status,undefined,'browser may queue but cannot complete simulation attempts');
  assert.equal(attemptInsert.realized_r,undefined,'browser cannot write simulated profitability');
  assert.equal(attemptInsert.exit_price,undefined);
  assert.equal(attemptInsert.user_id,'owner');

  await repository.recordExecutionVerification({
    user_id:'owner',methodology_version_id:'v1',execution_attempt_id:'a',
    verification_status:'verified',execution_accuracy_pct:100,rule_checks:[{complied:true}]
  });
  const verificationInsert=db.inserts.find(item=>item.table==='reference_execution_verifications')?.row;
  assert.equal(verificationInsert.verification_status,undefined,'browser writes only pending verification requests');
  assert.equal(verificationInsert.execution_accuracy_pct,undefined);

  const preview=await repository.preparePerformanceMeasurement({
    methodology_version_id:'v1',period_start:'2026-10-01T00:00:00Z',period_end:'2026-10-31T23:59:59Z'
  });
  assert.equal(preview.measurement_status,'preview_only');
  assert.equal(preview.preview_only,true);
  assert.equal(preview.requires_trusted_persistence,true);
  assert.equal(preview.expectancy_r,0.5);
  assert.equal(preview.source_metadata.actual_trade_source,false);
  assert.equal(db.inserts.filter(item=>item.table==='reference_performance_records').length,0,
    'preview calculation does not persist result records');

  const request=await repository.requestPerformanceMeasurement({
    methodology_version_id:'v1',period_start:'2026-10-01T00:00:00Z',period_end:'2026-10-31T23:59:59Z'
  });
  const performanceInsert=db.inserts.find(item=>item.table==='reference_performance_records')?.row;
  assert.equal(request.measurement_status,'pending');
  assert.equal(performanceInsert.measurement_status,undefined,'browser cannot assert trusted measurement status');
  assert.equal(performanceInsert.expectancy_r,undefined,'browser cannot persist performance metrics');
  assert.equal(performanceInsert.source_metadata.actual_trade_source,false);
  assert.ok(db.calls.every(call=>call.table!=='trades'),'reference foundation never queries actual trader trades');
  assert.ok(db.inserts.every(item=>item.row.user_id==='owner'),'every reference insert is explicitly owner-scoped');
}

async function verifyMarketDataLinkIsolation(){
  const db=makeMockDb();
  const repository=ref.createRepository(db,'owner');
  const refRow=await repository.captureExistingMarketData({
    methodology_version_id:'v1',instrument_key:'v75_1s',symbol:'Volatility 75 (1s) Index',
    timeframe:'H4',available_from:'2026-10-01T00:00:00Z',available_to:'2026-10-03T00:00:00Z'
  });
  assert.equal(refRow.availability_status,'partial');
  assert.equal(refRow.candle_count,1);
  assert.equal(refRow.completeness_ratio,0.5);
  assert.deepEqual(refRow.source_record_ids,['candle-good']);
  const marketInsert=db.inserts.find(item=>item.table==='reference_market_data_refs')?.row;
  assert.equal(marketInsert.data_validation_status,undefined,'browser cannot claim market data is validated');
  assert.ok(db.calls.every(call=>call.table!=='trades'));
  assert.ok(db.inserts.every(item=>item.row.user_id==='owner'));
  const rows=await repository.loadReferenceMarketCandles(refRow.id);
  assert.deepEqual(rows.map(row=>row.id),['candle-good']);
  assert.ok(db.calls.filter(call=>call.table==='mt5_market_candles').length>=2);
}
globalThis.__tiosPendingTests=Promise.all([verifyRepositoryDataIsolation(),verifyMarketDataLinkIsolation()]);
globalThis.__tiosPendingTests.catch(error=>{console.error(error);process.exitCode=1;});
