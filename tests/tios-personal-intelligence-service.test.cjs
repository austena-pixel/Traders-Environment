'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const conversation=require('../server/tios-personal-intelligence-service.cjs');

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
