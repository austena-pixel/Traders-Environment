'use strict';
// One synthetic release check; disabled unless explicitly enabled in the deployment environment.
// No user data, prompts from storage, API keys, images or authorization headers enter the report.
const fs=require('node:fs'),path=require('node:path');
const service=require('../server/ai-builder-service.cjs');
async function run(){
  const report={checked:false,operational:null,imageOperational:null,checkedAt:new Date().toISOString()};
  if(process.env.TIOS_AI_VERIFY_ON_BUILD==='1'){
    try{
      // The 0.73% value exists only in the pixels, so a text-only request cannot pass this check.
      const fixture=fs.readFileSync(path.join(__dirname,'../tests/fixtures/edge-reference.png'));
      const input={message:'Create a Rules instrument named Risk Limit with one objective maximum-risk rule from the annotated image. Do not add or ask about entry or stop rules.',images:[{name:'edge-reference.png',dataUrl:'data:image/png;base64,'+fixture.toString('base64')}],history:[],context:{kind:'checklist',name:'',description:'',blocks:[]}};
      const result=await service.generate(service.validateRequest(input),service.configuration());
      if(!result.proposal||result.proposal.kind!=='checklist'||result.proposal.intent!=='create'||!result.proposal.operations.some(op=>op.node?.condition?.type==='risk_limit'&&op.node.condition.value===0.73&&op.node.condition.unit==='percent'))throw Error('Live provider did not preserve the risk percentage visible only in the image.');
      Object.assign(report,{checked:true,operational:true,imageOperational:true,model:result.service.model,message:'The live model read the synthetic reference image and returned the matching structured risk rule.'});
      console.log('T-IOS AI Gateway live image check passed: annotated risk rule generated.');
    }catch(error){Object.assign(report,{checked:true,operational:false,imageOperational:false,errorCode:error.code||'invalid_live_proposal',message:error.message});console.log('T-IOS AI release check: '+report.errorCode+'. '+report.message)}
  }
  fs.writeFileSync('ai-builder-provider-status.json',JSON.stringify(report));
}
run().catch(()=>{console.error('AI readiness report could not be written.');process.exitCode=1});
