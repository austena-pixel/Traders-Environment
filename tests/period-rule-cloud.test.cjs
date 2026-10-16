const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../technical-instruments/period-rules.js');
const {create}=require('../technical-instruments/period-rule-cloud.js');
function fixture(){
 const state=new Map();
 const storage={getItem:k=>state.has(k)?state.get(k):null,setItem:(k,v)=>state.set(k,v)};
 let user={id:'owner'},account={id:'account-a'},networkError=false;
 const remote=new Map();
 const client={from:table=>{
  assert.equal(table,'tios_period_rule_reviews');
  const conditions=[];
  return {
   select(){return this;},
   eq(field,value){conditions.push([field,value]);if(conditions.length===2)return Promise.resolve(networkError?{error:{message:'offline'}}:{data:[...remote.values()].filter(x=>x.user_id===user.id&&x.account_id===account.id)});return this;},
   upsert(payload){this.record=payload;return this;},
   single(){const p=this.record;if(networkError)return Promise.resolve({error:{message:'offline'}});remote.set(p.account_id+':'+p.review_key,p);return Promise.resolve({data:p});}
  };
 }};
 const cloud=create({getClient:()=>client,getUser:()=>user,getAccount:()=>account,storage,rules});
 const mk=(date,comment,savedAt='2026-10-16T09:00:00Z')=>{
  const period=rules.period('daily',{date});
  const record={schema:rules.schema,userId:user.id,accountId:account.id,ruleScope:'daily',documentId:'rules-1',documentName:'Trading Day Rules',period,definition:'[]',answers:[{key:'a',label:'Rule A',comment}],createdAt:savedAt,savedAt};
  record.key=rules.reviewKey(record);return record;
 };
 return {storage,cloud,mk,remote,goOffline:x=>networkError=x,switchAccount:x=>{account={id:x};}};
}
test('local save is verified, sent to cloud and restored in a new local cache',async()=>{
 const f=fixture();const row=f.mk('2026-10-16','Reviewed');
 assert.equal((await f.cloud.save(row)).state,'synced');
 assert.equal(f.remote.size,1);
 f.storage.setItem(rules.storageKey(row.userId,row.accountId),'[]');
 assert.equal((await f.cloud.sync()).state,'synced');
 assert.equal(rules.read(f.storage,row.userId,row.accountId)[0].answers[0].comment,'Reviewed');
});
test('network failure preserves local data and never reports synced',async()=>{
 const f=fixture();f.goOffline(true);
 const row=f.mk('2026-10-16','Offline review');
 assert.equal((await f.cloud.save(row)).state,'local-only');
 assert.equal(f.remote.size,0);
 assert.equal(rules.read(f.storage,row.userId,row.accountId).length,1);
 f.goOffline(false);
 assert.equal((await f.cloud.sync()).state,'synced');
 assert.equal(f.remote.size,1);
});
test('newer server version replaces older local review and invalid foreign records are rejected',async()=>{
 const f=fixture();const local=f.mk('2026-10-16','Old','2026-10-16T08:00:00Z');
 rules.save(f.storage,local);
 const newer={...local,savedAt:'2026-10-16T11:00:00Z',answers:[{key:'a',label:'Rule A',comment:'New'}]};
 f.remote.set('account-a:'+newer.key,{user_id:'owner',account_id:'account-a',review_key:newer.key,payload:newer});
 f.remote.set('account-a:invalid',{user_id:'owner',account_id:'account-a',review_key:'invalid',payload:{...newer,userId:'someone-else'}});
 assert.equal((await f.cloud.sync()).state,'synced');
 assert.equal(rules.read(f.storage,'owner','account-a')[0].answers[0].comment,'New');
});
test('account switch keeps account-scoped reviews isolated',async()=>{
 const f=fixture();const a=f.mk('2026-10-16','A');
 await f.cloud.save(a);f.switchAccount('account-b');const b=f.mk('2026-10-16','B');
 await f.cloud.save(b);
 assert.equal(rules.read(f.storage,'owner','account-a')[0].answers[0].comment,'A');
 assert.equal(rules.read(f.storage,'owner','account-b')[0].answers[0].comment,'B');
});
