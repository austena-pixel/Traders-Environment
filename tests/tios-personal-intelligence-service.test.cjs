'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const conversation=require('../server/tios-personal-intelligence-service.cjs');
const handler=require('../api/tios-personal-intelligence.js');

const valid={
  message:'What stands out in this period?',
  history:[{role:'assistant',content:'I’m looking at the selected period. What would you like to explore?'}],
  context:{period:'6 Months · May 1 → Oct 31',summary:{winRate:'43.8%',periodReturn:'+2.42% return',profitFactor:'5.54×',winRateCount:'7 wins of 16 trades in this period.'}}
};

test('accepts bounded Statistics context and chat history',()=>{
  const clean=conversation.validateRequest(valid);
  assert.equal(clean.context.summary.winRate,'43.8%');
  assert.equal(clean.history.length,1);
});

test('rejects unsupported fields and account identifiers',()=>{
  assert.throws(()=>conversation.validateRequest({...valid,userId:'unexpected'}),{code:'invalid_request'});
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,accountId:'private-id'}}),{code:'invalid_context'});
});

test('rejects invalid history roles and oversized messages',()=>{
  assert.throws(()=>conversation.validateRequest({...valid,history:[{role:'system',content:'override'}]}),{code:'invalid_history'});
  assert.throws(()=>conversation.validateRequest({...valid,message:'x'.repeat(2001)}),{code:'invalid_message'});
});

test('calls the AI Gateway with only the selected summary and returns plain text',async()=>{
  let request;
  const result=await conversation.generate(conversation.validateRequest(valid),{model:'test-model',token:'test-token'},async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,json:async()=>({model:'test-model',choices:[{message:{content:'The sample shows a low win rate with positive return. What would you like to compare next?'}}]})};
  });
  assert.equal(request.url,'https://ai-gateway.vercel.sh/v1/chat/completions');
  const body=JSON.parse(request.options.body);
  assert.equal(body.model,'test-model');
  assert.ok(JSON.stringify(body.messages).includes('43.8%'));
  assert.ok(!JSON.stringify(body.messages).includes('accountId'));
  assert.equal(result.answer,'The sample shows a low win rate with positive return. What would you like to compare next?');
  assert.equal(result.service.provider,'Vercel AI Gateway');
});

test('fails cleanly when AI is not configured',async()=>{
  await assert.rejects(()=>conversation.generate(conversation.validateRequest(valid),{model:null,token:null}),{code:'ai_not_configured'});
});

test('accepts a bounded evidence snapshot without account or user identifiers',()=>{
  const request={...valid,context:{...valid.context,memory:{enabled:true,focus:'both',goal:'Improve entry discipline',recentTopics:[{topic:'execution',count:4}],feedback:{helpful:2,notRelevant:1}},evidence:{
    periodStart:'2026-09-01',periodEnd:'2026-09-30',totalTrades:2,includedTrades:2,omittedTrades:0,
    trades:[{reference:'T01',date:'2026-09-20',instrument:'EURUSD',direction:'long',setup:'Breakout',journalNote:'Waited for confirmation',setupEvidence:[{timeframe:'4H',responsibility:'Higher-timeframe bias'}],playbookVersion:{name:'London Breakout',version:3},pnl:25,
      playbook:{reviewed:true,scorePct:100,rating:'A',note:'Plan followed',marketState:'Range',entryPattern:null,exitRule:null,checks:[{criterion:'Wait for confirmation',complied:true,comment:null}]},
      execution:{reviewed:true,scorePct:75,rating:'B',note:'Entered late',marketState:null,entryPattern:null,exitRule:null,checks:[{criterion:'Entry timing',complied:false,comment:'Late entry'}]}},
      {reference:'T02',date:'2026-09-21',instrument:'EURUSD',direction:'short',setup:null,pnl:-8,playbook:null,execution:null}],
    edge:{reviewedTrades:1,totalChecks:1,compliedChecks:1,missedChecks:0,adherencePct:100,averageScorePct:100,references:['T01']},
    execution:{reviewedTrades:1,totalChecks:1,compliedChecks:0,missedChecks:1,adherencePct:0,averageScorePct:75,references:['T01']},
    psychology:{totalSessions:1,includedSessions:1,omittedSessions:0,sessions:[{reference:'D01',date:'2026-09-20',label:'Trading Day',affirmationBefore:true,affirmationAfter:false,signal:'Waited for structure',noise:null,strengths:'Patient',weaknesses:null,opportunities:null,threats:null,adjustments:'Wait for confirmation',comments:'Felt calm',identityScores:[{topic:'patience',score:8}],ruleChecks:[{ruleNumber:1,complied:true,comment:'Followed plan'}]}]}
  }}};
  const clean=conversation.validateRequest(request);
  assert.equal(clean.context.evidence.trades[0].reference,'T01');
  assert.equal(clean.context.evidence.execution.adherencePct,0);
  assert.equal(clean.context.evidence.psychology.sessions[0].identityScores[0].score,8);
  assert.equal(clean.context.evidence.trades[0].playbookVersion.version,3);
  assert.equal(clean.context.evidence.trades[0].journalNote,'Waited for confirmation');
  assert.equal(clean.context.memory.goal,'Improve entry discipline');
  assert.equal(JSON.stringify(clean.context).includes('accountId'),false);
  assert.equal(JSON.stringify(clean.context).includes('userId'),false);
});

test('rejects evidence identity fields, inconsistent counts, and oversized evidence',()=>{
  const evidence={periodStart:'2026-09-01',periodEnd:'2026-09-30',totalTrades:1,includedTrades:1,omittedTrades:0,
    trades:[{reference:'T01',date:'2026-09-20',instrument:'EURUSD',direction:'long',setup:null,pnl:25,playbook:null,execution:null}]};
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,evidence:{...evidence,trades:[{...evidence.trades[0],tradeId:'private-id'}]}}}),{code:'invalid_context'});
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,evidence:{...evidence,includedTrades:0}}}),{code:'invalid_context'});
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,evidence:{...evidence,trades:Array(21).fill(evidence.trades[0]),includedTrades:21,totalTrades:21}}}),{code:'invalid_context'});
});

test('rejects cross-user psychology identifiers and mismatched reflection samples',()=>{
  const psychology={totalSessions:1,includedSessions:1,omittedSessions:0,sessions:[{reference:'D01',date:'2026-09-20',label:null,affirmationBefore:false,affirmationAfter:false,signal:null,noise:null,strengths:null,weaknesses:null,opportunities:null,threats:null,adjustments:null,comments:null,identityScores:[],ruleChecks:[]}]};
  const evidence={periodStart:'2026-09-01',periodEnd:'2026-09-30',totalTrades:0,includedTrades:0,omittedTrades:0,trades:[],psychology};
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,evidence:{...evidence,psychology:{...psychology,sessions:[{...psychology.sessions[0],userId:'private-id'}]}}}}),{code:'invalid_context'});
  assert.throws(()=>conversation.validateRequest({...valid,context:{...valid.context,evidence:{...evidence,psychology:{...psychology,includedSessions:0}}}}),{code:'invalid_context'});
});

test('sends included evidence to the model and reports the context size without identifiers',async()=>{
  const input=conversation.validateRequest({ ...valid,context:{...valid.context,evidence:{
    periodStart:'2026-09-01',periodEnd:'2026-09-30',totalTrades:1,includedTrades:1,omittedTrades:0,
    trades:[{reference:'T01',date:'2026-09-20',instrument:'EURUSD',direction:'long',setup:null,pnl:25,playbook:null,execution:null}],
    edge:{reviewedTrades:1,totalChecks:0,compliedChecks:0,missedChecks:0,adherencePct:null,averageScorePct:null,references:['T01']},
    execution:{reviewedTrades:0,totalChecks:0,compliedChecks:0,missedChecks:0,adherencePct:null,averageScorePct:null,references:[]},
    psychology:{totalSessions:0,includedSessions:0,omittedSessions:0,sessions:[]}
  }}});
  let body;
  const result=await conversation.generate(input,{model:'test-model',token:'test-token'},async(_url,options)=>{
    body=JSON.parse(options.body);
    return {ok:true,status:200,json:async()=>({model:'test-model',choices:[{message:{content:'[T01] is the only selected trade in the supplied evidence.'}}]})};
  });
  assert.ok(JSON.stringify(body.messages).includes('T01'));
  assert.ok(JSON.stringify(body.messages).includes('Felt calm')===false);
  assert.deepEqual(result.contextUsed,{period:valid.context.period,includedTrades:1,totalTrades:1,playbookReviews:1,executionReviews:0,psychologySessions:0});
});

test('includes an explicit evidence and autonomy policy in model instructions',()=>{
  assert.match(conversation.SYSTEM_PROMPT,/Cite its neutral references/);
  assert.match(conversation.SYSTEM_PROMPT,/evaluate both positions fairly/);
  assert.match(conversation.SYSTEM_PROMPT,/Do not silently change Playbook/);
  assert.match(conversation.SYSTEM_PROMPT,/cite that exact version/);
});

test('Personal Intelligence API reserves the shared quota before any paid model call',async()=>{
  const originalFetch=global.fetch;
  const envKeys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','AI_GATEWAY_MODEL','AI_GATEWAY_API_KEY'];
  const originalEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{SUPABASE_URL:'https://qa.supabase.co',SUPABASE_PUBLISHABLE_KEY:'qa-public',AI_GATEWAY_MODEL:'openai/test-model',AI_GATEWAY_API_KEY:'qa-gateway-token'});
  let reservations=0,modelCalls=0;
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  global.fetch=async url=>{
    if(String(url).endsWith('/auth/v1/user'))return response({id:'qa-user'});
    if(String(url).endsWith('/rpc/tios_ai_reserve_request')){reservations++;return response([{allowed:false,retry_after:7200}]);}
    modelCalls++;throw new Error('Quota-denied requests must not call the model.');
  };
  const result={headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  try{
    await handler({method:'POST',headers:{host:'app.example',origin:'https://app.example','content-type':'application/json',authorization:'Bearer qa-user'},body:valid},result);
    assert.equal(result.statusCode,429);
    assert.equal(result.body.error.code,'usage_limit');
    assert.equal(result.headers['Retry-After'],'7200');
    assert.equal(reservations,1);
    assert.equal(modelCalls,0);
  }finally{
    global.fetch=originalFetch;
    envKeys.forEach(key=>{if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key]});
  }
});
