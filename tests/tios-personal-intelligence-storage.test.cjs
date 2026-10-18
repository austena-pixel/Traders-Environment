'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('../server/tios-personal-intelligence-storage.cjs');

const userId='11111111-1111-4111-8111-111111111111';
const env={
  SUPABASE_URL:'https://auth.example.test',SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',
  CLOUDFLARE_PI_STORAGE_URL:'https://tios-storage.example.workers.dev',
  CLOUDFLARE_PI_STORAGE_SECRET:'a'.repeat(64)
};
function response(status=200,data={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
function makeReq(body,headers={}){
  return {method:'POST',headers:{host:'traders-environment-j.vercel.app',origin:'https://traders-environment-j.vercel.app','content-type':'application/json',authorization:'Bearer signed-session-token',...headers},body:JSON.stringify(body)};
}
function makeRes(){return {headers:{},setHeader(key,value){this.headers[key]=value},status(code){this.statusCode=code;return this},json(data){this.data=data;return this}}}
async function invoke(handler,request){const res=makeRes();await handler(request,res);return res}
function dependencies(fetcher,overrideEnv=env){return {fetcher,env:overrideEnv}}

test('storage proxy authenticates the Supabase session and sends the verified user to Cloudflare',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url==='https://auth.example.test/auth/v1/user')return response(200,{id:userId,is_anonymous:false});
    return response(200,{conversations:[]});
  };
  const handler=createHandler(dependencies(fetcher));
  const result=await invoke(handler,makeReq({action:'conversations.list',payload:{accountId:'acct-1'}}));
  assert.equal(result.statusCode,200);
  assert.equal(calls.length,2);
  const forwarded=JSON.parse(calls[1].options.body);
  assert.equal(forwarded.userId,userId);
  assert.equal(forwarded.action,'conversations.list');
  assert.equal(forwarded.payload.accountId,'acct-1');
  assert.equal(calls[1].options.headers.Authorization,'Bearer '+env.CLOUDFLARE_PI_STORAGE_SECRET);
  assert.equal(result.headers['Cache-Control'],'no-store');
});

test('storage proxy rejects client supplied identity and unsupported actions',async()=>{
  let called=false;
  const handler=createHandler(dependencies(async()=>{called=true;return response()}));
  const identity=await invoke(handler,makeReq({action:'conversations.list',payload:{accountId:'acct-1'},userId:'22222222-2222-4222-8222-222222222222'}));
  assert.equal(identity.statusCode,400);
  const action=await invoke(handler,makeReq({action:'arbitrary.query',payload:{}}));
  assert.equal(action.statusCode,400);
  assert.equal(called,false);
});

test('storage proxy reports missing Cloudflare configuration without contacting either backend',async()=>{
  let called=false;
  const handler=createHandler(dependencies(async()=>{called=true;return response()}, {...env,CLOUDFLARE_PI_STORAGE_URL:''}));
  const result=await invoke(handler,makeReq({action:'preferences.get',payload:{accountId:'acct-1'}}));
  assert.equal(result.statusCode,503);
  assert.equal(result.data.error.code,'storage_not_configured');
  assert.equal(called,false);
});

test('storage proxy requires the same site origin and a signed in non-anonymous user',async()=>{
  let cloudflareCalled=false;
  const handler=createHandler(dependencies(async(url)=>{
    if(url==='https://auth.example.test/auth/v1/user')return response(200,{id:userId,is_anonymous:true});
    cloudflareCalled=true;return response();
  }));
  const badOrigin=await invoke(handler,makeReq({action:'preferences.get',payload:{}},{origin:'https://attacker.example'}));
  assert.equal(badOrigin.statusCode,403);
  const anonymous=await invoke(handler,makeReq({action:'preferences.get',payload:{}}));
  assert.equal(anonymous.statusCode,401);
  assert.equal(cloudflareCalled,false);
});

test('storage proxy preserves safe Cloudflare validation errors',async()=>{
  const fetcher=async(url)=>url==='https://auth.example.test/auth/v1/user'
    ?response(200,{id:userId,is_anonymous:false})
    :response(404,{error:{code:'conversation_not_found',message:'That conversation is no longer available.'}});
  const handler=createHandler(dependencies(fetcher));
  const result=await invoke(handler,makeReq({action:'conversations.get',payload:{id:'11111111-1111-4111-8111-111111111112',accountId:'acct-1'}}));
  assert.equal(result.statusCode,404);
  assert.equal(result.data.error.code,'conversation_not_found');
});
