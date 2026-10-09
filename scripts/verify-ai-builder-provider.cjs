'use strict';
// One synthetic release check; disabled unless explicitly enabled in the deployment environment.
// No user data, prompts from storage, API keys or authorization headers are written to the report.
const fs=require('node:fs');
const service=require('../server/ai-builder-service.cjs');
async function run(){
  const report={checked:false,operational:null,checkedAt:new Date().toISOString()};
  if(process.env.TIOS_AI_VERIFY_ON_BUILD==='1'){
    try{
      const input={message:'Create a Rules instrument named Risk Limit with one objective rule: risk per trade must not exceed 1% of account equity.',history:[],context:{kind:'checklist',name:'',description:'',blocks:[]}};
      const result=await service.generate(service.validateRequest(input),service.configuration());
      if(!result.proposal||result.proposal.kind!=='checklist'||result.proposal.intent!=='create'||!result.proposal.operations.some(op=>op.node?.condition?.type==='risk_limit'&&op.node.condition.value===1&&op.node.condition.unit==='percent'))throw Error('Live provider did not preserve the explicit risk rule.');
      Object.assign(report,{checked:true,operational:true,model:result.service.model,message:result.message});
      console.log('T-IOS AI Gateway live release check passed: structured risk rule generated.');
    }catch(error){Object.assign(report,{checked:true,operational:false,errorCode:error.code||'invalid_live_proposal',message:error.message});console.log('T-IOS AI release check: '+report.errorCode+'. '+report.message)}
  }
  fs.writeFileSync('ai-builder-provider-status.json',JSON.stringify(report));
}
run().catch(()=>{console.error('AI readiness report could not be written.');process.exitCode=1});
