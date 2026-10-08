const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../core/intelligence-development.js');
const contract=require('../core/evidence-contract.js');
const now=Date.parse('2026-10-08T12:00:00Z');
const assessed={assessmentId:'assessment-1',assessedAt:'2026-10-08T10:00:00Z',validUntil:'2026-10-09T10:00:00Z'};
const user='00000000-0000-4000-8000-000000000001';
test('unknown is distinct from Level 0 and unsupported scores are never maturity',()=>{
  assert.equal(model.assessedLevel(undefined,now),null);
  assert.equal(model.assessedLevel({level:5,count:10000},now),null);
  assert.equal(model.assessedLevel({...assessed,level:0},now),0);
  assert.equal(model.assessedLevel({...assessed,level:6},now),null);
  assert.equal(model.assessedLevel({...assessed,level:3.5},now),null);
  assert.equal(model.assessedLevel({...assessed,level:3},now),3);
  assert.deepEqual(model.emptyState(user).maturity,{});
});
test('expired, undated and future assessments return to pending',()=>{
  assert.equal(model.assessedLevel({...assessed,level:4,validUntil:'2026-10-08T12:00:00Z'},now),null);
  assert.equal(model.assessedLevel({...assessed,level:4,assessedAt:'2026-10-09T12:00:00Z'},now),null);
  assert.equal(model.assessedLevel({level:4,assessmentId:'a'},now),null);
});
test('readiness and subscription access remain separate, with permission and safety gates',()=>{
  const ready={...assessed,status:'available',permissionGranted:true,safetyValidated:true};
  assert.equal(model.capabilityPresentation(ready,null,now).label,'Available');
  assert.equal(model.capabilityPresentation({...ready,requiredPlan:'pro'},null,now).label,'Ready — Pro Required');
  assert.equal(model.capabilityPresentation({...ready,requiredPlan:'pro'},{...assessed,granted:true},now).label,'Available');
  assert.equal(model.capabilityPresentation({...ready,permissionGranted:false},{...assessed,granted:true},now).label,'Unavailable');
  assert.equal(model.capabilityPresentation({...ready,safetyValidated:false},null,now).available,false);
  for(const [status,label] of [['collecting','Collecting Evidence'],['preliminary','Preliminary'],['suspended','Suspended']])
    assert.equal(model.capabilityPresentation({...ready,status},null,now).label,label);
  assert.equal(model.capabilityPresentation(undefined,{...assessed,granted:true},now).label,'Awaiting assessment');
});
test('source records are scoped to authenticated ownership, known domain and valid structure',()=>{
  const row={id:'source-1',schema:'hios.evidence.v1',sourceProductId:'tios',domain:'trading',userId:user,evidenceType:'rule_compliance_assessment',observedAt:'2026-10-08T10:00:00Z',subject:{type:'trade',id:'trade-1'},observation:{reviewId:'review-1'},hiosVerified:true};
  const records={tios:[row,row,{...row,id:'other-user',userId:'00000000-0000-4000-8000-000000000002'},{...row,id:'unknown-domain',evidenceType:'unrelated'},{...row,id:'malformed',observation:null}]};
  const valid=row=>contract.validateEvidence(row).valid;
  assert.deepEqual(model.ownedExecutionEvidence(records,user,valid).map(r=>r.id),['source-1']);
  assert.deepEqual(model.ownedExecutionEvidence(records,null,valid),[]);
  assert.deepEqual(model.emptyState(user).evidenceQuality,{});
});
test('unread count includes actual scoped events, not evidence or duplicate records',()=>{
  const event={id:'event-1',userId:user,type:'capability-available',occurredAt:'2026-10-08T10:00:00Z'};
  const events=[event,event,{...event,id:'other',userId:'other-user'},{...event,id:'future',occurredAt:'2026-10-09T12:00:00Z'},{...event,id:'read',readAt:'2026-10-08T11:00:00Z'},{...event,id:'evidence',type:'evidence-received'}];
  assert.equal(model.unreadEvents(events,user,[],now).length,1);
  assert.equal(model.unreadEvents(events,user,['event-1'],now).length,0);
  assert.equal(model.unreadEvents(events,null,[],now).length,0);
});
