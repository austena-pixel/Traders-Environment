const test=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../technical-instruments/period-rules.js');

function storage(){
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
function review(scope,date,extra={}){
  const record={schema:rules.schema,userId:'user-a',accountId:'account-a',documentId:'rules-a',ruleScope:scope,
    period:rules.period(scope,{date,...extra}),definition:'form-v1',answers:[{key:'discipline',comment:'Followed the plan'}]};
  record.key=rules.reviewKey(record);return record;
}

test('a week crossing New Year has one Monday–Sunday identity, independent of its selected day',()=>{
  const monday=rules.period('weekly',{date:'2025-12-29'}),sunday=rules.period('weekly',{date:'2026-01-04'});
  assert.equal(monday.startDate,'2025-12-29');assert.equal(monday.endDate,'2026-01-04');assert.equal(monday.key,sunday.key);
  assert.notEqual(monday.key,rules.period('weekly',{date:'2026-01-05'}).key);
});

test('calendar months include leap days and exclude trades from adjacent months',()=>{
  const selected=rules.period('monthly',{date:'2024-02-18'});
  assert.equal(selected.startDate,'2024-02-01');assert.equal(selected.endDate,'2024-02-29');
  assert.equal(rules.includesTrade({trade_date:'2024-02-29'},selected),true);
  assert.equal(rules.includesTrade({trade_date:'2024-03-01'},selected),false);
  assert.equal(rules.period('daily',{date:'2026-02-29'}),null);
});

test('named overnight sessions include only their actual trading hours and never use MT5 import time',()=>{
  const selected=rules.period('session',{date:'2026-10-09',sessionLabel:'Night',startTime:'22:00',endTime:'02:00'});
  assert.equal(selected.endDate,'2026-10-10');
  assert.equal(rules.includesTrade({closed_at:new Date(2026,9,10,1,0).toISOString()},selected),true);
  assert.equal(rules.includesTrade({closed_at:new Date(2026,9,10,3,0).toISOString()},selected),false);
  assert.equal(rules.includesTrade({source:'mt5',created_at:new Date(2026,9,10,1,0).toISOString()},selected),false);
  assert.equal(rules.period('session',{date:'2026-10-09',sessionLabel:'Night',startTime:'22:00',endTime:'22:00'}),null);
});

test('multiple periods, Rules documents, accounts and users keep separate saved answers',()=>{
  const store=storage();
  const first=review('daily','2026-10-09');rules.save(store,first);
  const second=review('daily','2026-10-10');rules.save(store,second);
  const weekly=review('weekly','2026-10-09');rules.save(store,weekly);
  const otherDoc={...first,documentId:'rules-b',answers:[{key:'discipline',comment:'Another form'}]};otherDoc.key=rules.reviewKey(otherDoc);rules.save(store,otherDoc);
  const otherAccount={...first,accountId:'account-b'};otherAccount.key=rules.reviewKey(otherAccount);rules.save(store,otherAccount);
  const otherUser={...first,userId:'user-b'};otherUser.key=rules.reviewKey(otherUser);rules.save(store,otherUser);
  assert.equal(rules.read(store,'user-a','account-a').length,4);
  assert.equal(rules.read(store,'user-a','account-b').length,1);
  assert.equal(rules.read(store,'user-b','account-a').length,1);
});

test('updating a review keeps reviews saved in another tab and supports clearing an answer',()=>{
  const store=storage(),first=review('daily','2026-10-09'),second=review('daily','2026-10-10');
  rules.save(store,first);rules.save(store,second);rules.save(store,{...first,answers:[{key:'discipline',comment:''}]});
  const rows=rules.read(store,'user-a','account-a');assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.key===first.key).answers[0].comment,'');
  assert.equal(rows.find(row=>row.key===second.key).answers[0].comment,'Followed the plan');
});

test('corrupt saved storage is preserved and cannot be overwritten by a successful-looking save',()=>{
  const store=storage(),key=rules.storageKey('user-a','account-a');store.setItem(key,'broken data');
  assert.throws(()=>rules.save(store,review('daily','2026-10-09')),/could not be read/);
  assert.equal(store.getItem(key),'broken data');
});

test('unavailable storage and dropped writes report failure instead of claiming success',()=>{
  assert.throws(()=>rules.save({getItem:()=>null,setItem:()=>{throw new Error('quota')}},review('daily','2026-10-09')),/could not save/);
  assert.throws(()=>rules.save({getItem:()=>null,setItem:()=>{}},review('daily','2026-10-09')),/could not be verified/);
});

test('record validation rejects trade reviews and records with mismatched ownership or identity',()=>{
  const store=storage(),record=review('daily','2026-10-09');
  assert.throws(()=>rules.save(store,{...record,ruleScope:'trade'}),/valid period/);
  assert.throws(()=>rules.save(store,{...record,documentId:'other'}),/valid period/);
  store.setItem(rules.storageKey('user-a','account-a'),JSON.stringify([{...record,userId:'other-user'}]));
  assert.equal(rules.read(store,'user-a','account-a').length,0);
});
