'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {handleAction,handleRequest}=require('../cloudflare/personal-intelligence-worker/worker.mjs');

const userA='11111111-1111-4111-8111-111111111111';
const userB='22222222-2222-4222-8222-222222222222';
const accountA='trading-account-a';
const secret='z'.repeat(64);
class D1Statement{
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}
  bind(...args){this.args=args;return this}
  async first(){return this.db.prepare(this.sql).get(...this.args)||null}
  async all(){return {success:true,results:this.db.prepare(this.sql).all(...this.args)}}
  async run(){const result=this.db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(result.changes)||0}}}
}
class TestD1{
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON;'+fs.readFileSync(path.join(__dirname,'../cloudflare/personal-intelligence-worker/migrations/0001_personal_intelligence.sql'),'utf8'))}
  prepare(sql){return new D1Statement(this.sqlite,sql)}
}
function context(now='2026-10-18T12:00:00.000Z'){
  const DB=new TestD1();return {DB,env:{DB,PI_STORAGE_SHARED_SECRET:secret},now:new Date(now)};
}
function doAction(ctx,action,payload={},userId=userA,now=ctx.now){return handleAction(action,payload,userId,ctx.env,now)}
function request(body,auth='Bearer '+secret){return new Request('https://storage.example.workers.dev/',{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(body)})}

test('Worker requires its private shared secret and a configured D1 binding',async()=>{
  const ctx=context();
  const unauthorized=await handleRequest(request({action:'preferences.get',payload:{},userId:userA},'Bearer wrong-secret'),ctx.env);
  assert.equal(unauthorized.status,401);
  const missing=await handleRequest(request({action:'preferences.get',payload:{},userId:userA}),{PI_STORAGE_SHARED_SECRET:secret});
  assert.equal(missing.status,503);
});

test('preferences are created with safe defaults, validated and isolated by authenticated user',async()=>{
  const ctx=context();
  const initial=await doAction(ctx,'preferences.get');
  assert.equal(initial.preferences.proactive_enabled,false);
  assert.equal(initial.preferences.retention_days,365);
  await doAction(ctx,'preferences.set',{preferences:{...initial.preferences,proactive_enabled:true,development_goal:'Improve rule adherence'}});
  const own=await doAction(ctx,'preferences.get',{},userA);
  const other=await doAction(ctx,'preferences.get',{},userB);
  assert.equal(own.preferences.proactive_enabled,true);
  assert.equal(own.preferences.development_goal,'Improve rule adherence');
  assert.equal(other.preferences.proactive_enabled,false);
  await assert.rejects(()=>doAction(ctx,'preferences.set',{preferences:{...initial.preferences,conversation_frequency:'unlimited'}}),/preference is invalid/);
});

test('conversations and messages are scoped to the verified user and delete cascades',async()=>{
  const ctx=context();
  const conversation=await doAction(ctx,'conversations.create',{accountId:accountA,title:'Review results',topic:'statistics',kind:'user'});
  const message=await doAction(ctx,'messages.create',{accountId:accountA,conversationId:conversation.id,role:'user',source:'user',content:'Why did results change?',evidenceContext:{period:'October',summary:{}}});
  assert.ok(message.id);
  const hidden=await doAction(ctx,'conversations.get',{accountId:accountA,id:conversation.id},userB);
  assert.equal(hidden.conversation,null);
  assert.equal((await doAction(ctx,'conversations.list',{accountId:accountA},userB)).conversations.length,0);
  assert.equal((await doAction(ctx,'conversations.delete',{accountId:accountA,id:conversation.id},userB)).deleted,0);
  await assert.rejects(()=>doAction(ctx,'messages.feedback',{messageId:message.id,feedback:'helpful'},userB),/no longer available/);
  await doAction(ctx,'messages.feedback',{messageId:message.id,feedback:'helpful'});
  assert.deepEqual((await doAction(ctx,'messages.feedback-summary',{conversationIds:[conversation.id]})).feedback,{helpful:1,notRelevant:0});
  assert.equal((await doAction(ctx,'conversations.delete',{accountId:accountA,id:conversation.id})).deleted,1);
  const remaining=await ctx.DB.prepare('SELECT COUNT(*) AS count FROM pi_messages').first();
  assert.equal(Number(remaining.count),0);
});

test('observation cooldown and per-evidence deduplication are enforced in D1',async()=>{
  const ctx=context();
  const first=await doAction(ctx,'observations.create',{accountId:accountA,title:'Positive result mix',topic:'statistics',observationKey:'positive_return_low_win_rate:1111111111111111',priority:2,frequency:'balanced'});
  assert.equal(first.created,true);
  const cooldown=await doAction(ctx,'observations.create',{accountId:accountA,title:'Another pattern',topic:'edge',observationKey:'edge_review_weakness:2222222222222222',priority:2,frequency:'balanced'},userA,new Date('2026-10-18T13:00:00.000Z'));
  assert.equal(cooldown.created,false);
  const afterCooldown=await doAction(ctx,'observations.create',{accountId:accountA,title:'Positive result mix',topic:'statistics',observationKey:'positive_return_low_win_rate:1111111111111111',priority:2,frequency:'balanced'},userA,new Date('2026-10-21T12:00:01.000Z'));
  assert.equal(afterCooldown.created,false);
  const newEvidence=await doAction(ctx,'observations.create',{accountId:accountA,title:'Another pattern',topic:'edge',observationKey:'edge_review_weakness:2222222222222222',priority:2,frequency:'balanced'},userA,new Date('2026-10-21T12:00:01.000Z'));
  assert.equal(newEvidence.created,true);
});

test('retention pruning deletes only expired conversations for the selected user and account',async()=>{
  const ctx=context();
  const expired=await doAction(ctx,'conversations.create',{accountId:accountA,title:'Old chat',topic:'general',kind:'user'});
  await doAction(ctx,'messages.create',{accountId:accountA,conversationId:expired.id,role:'assistant',source:'local_start',content:'Opening question'});
  const retained=await doAction(ctx,'conversations.create',{accountId:'other-account',title:'Keep this chat',topic:'general',kind:'user'});
  await ctx.DB.prepare('UPDATE pi_conversations SET last_message_at=? WHERE id=?').bind('2026-08-01T00:00:00.000Z',expired.id).run();
  const result=await doAction(ctx,'conversations.prune',{accountId:accountA,retentionDays:30});
  assert.equal(result.deleted,1);
  assert.equal((await doAction(ctx,'conversations.get',{accountId:accountA,id:expired.id})).conversation,null);
  assert.ok((await doAction(ctx,'conversations.get',{accountId:'other-account',id:retained.id})).conversation);
  assert.equal(Number((await ctx.DB.prepare('SELECT COUNT(*) AS count FROM pi_messages').first()).count),0);
});

test('Worker request validates input size and rejects unknown action fields',async()=>{
  const ctx=context();
  const unknown=await handleRequest(request({action:'preferences.get',payload:{},userId:userA,extra:true}),ctx.env);
  assert.equal(unknown.status,400);
  const oversized=await handleRequest(request({action:'preferences.get',payload:{accountId:accountA,large:'x'.repeat(70000)},userId:userA}),ctx.env);
  assert.equal(oversized.status,413);
});
