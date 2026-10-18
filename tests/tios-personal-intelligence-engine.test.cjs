'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../tios-personal-intelligence-engine.js');

const context={
  period:'1 Month · Sep 1 → Sep 30',
  summary:{netPnl:'+$250.00',winRate:'43.8%',averageProfit:'$140.00',averageLoss:'-$60.00'},
  evidence:{
    periodStart:'2026-09-01',periodEnd:'2026-09-30',totalTrades:16,includedTrades:16,omittedTrades:0,
    trades:[{reference:'T01',date:'2026-09-30',pnl:80}],
    edge:{reviewedTrades:0,adherencePct:null,references:[]},
    execution:{reviewedTrades:0,adherencePct:null,references:[]}
  }
};

test('creates a local, evidence-based observation for a positive return with a lower win rate',()=>{
  const found=engine.detectObservations(context,{proactive_enabled:true,investigation_focus:'both'});
  assert.equal(found.length,1);
  assert.equal(found[0].type,'positive_return_low_win_rate');
  assert.match(found[0].text,/43\.8% win rate/);
  assert.match(found[0].text,/not proof of a durable edge/);
  assert.equal(found[0].evidenceRefs[0],'T01');
  assert.match(found[0].observationKey,/^positive_return_low_win_rate:/);
});

test('does not create observations when proactive mode is off or evidence is insufficient',()=>{
  assert.deepEqual(engine.detectObservations(context,{proactive_enabled:false,investigation_focus:'both'}),[]);
  const incomplete={...context,evidence:{...context.evidence,totalTrades:4}};
  assert.deepEqual(engine.detectObservations(incomplete,{proactive_enabled:true,investigation_focus:'both'}),[]);
  const noPnl={...context,summary:{...context.summary,netPnl:'—'},evidence:{...context.evidence,edge:{reviewedTrades:4,adherencePct:90,references:[]},execution:{reviewedTrades:4,adherencePct:90,references:[]}}};
  assert.deepEqual(engine.detectObservations(noPnl,{proactive_enabled:true,investigation_focus:'both'}),[]);
});

test('missing review denominators do not become false zero-adherence alerts',()=>{
  const reviewedButUnscored={...context,summary:{...context.summary,netPnl:'—'},evidence:{...context.evidence,totalTrades:12,
    edge:{reviewedTrades:4,adherencePct:null,references:['T01']},
    execution:{reviewedTrades:5,adherencePct:null,references:['T01']}}};
  assert.deepEqual(engine.detectObservations(reviewedButUnscored,{proactive_enabled:true,investigation_focus:'both'}),[]);
});

test('applies frequency and investigation focus locally',()=>{
  const executionOnly={...context,evidence:{...context.evidence,execution:{reviewedTrades:6,adherencePct:45,references:['T01']}}};
  const candidate=engine.detectObservations(executionOnly,{proactive_enabled:true,investigation_focus:'execution'})[0];
  assert.equal(candidate.type,'execution_review_weakness');
  assert.equal(candidate.priority,3);
  assert.equal(engine.frequencyAllows(candidate,'important'),true);
  assert.equal(engine.frequencyAllows({priority:1},'important'),false);
  assert.equal(engine.frequencyAllows({priority:1},'frequent'),true);
  assert.equal(engine.cooldownMs('important'),7*24*60*60*1000);
  assert.equal(engine.cooldownMs('balanced'),48*60*60*1000);
  assert.equal(engine.cooldownMs('frequent'),12*60*60*1000);
});

test('deduplication fingerprints change when evidence changes and topic labels stay bounded',()=>{
  const original=engine.detectObservations(context,{proactive_enabled:true,investigation_focus:'both'})[0];
  const updated=engine.detectObservations({...context,evidence:{...context.evidence,totalTrades:17}},{proactive_enabled:true,investigation_focus:'both'})[0];
  assert.notEqual(original.observationKey,updated.observationKey);
  assert.equal(engine.classifyTopic('Compare my execution mistakes with my strategy.'),'execution');
  assert.equal(engine.classifyTopic('What is the profit factor?'),'edge');
  assert.equal(engine.classifyTopic('Help me with revenge trading anxiety.'),'psychology');
});
