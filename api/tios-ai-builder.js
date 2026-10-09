'use strict';
const service=require('../server/ai-builder-service.cjs');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  // Vercel supplies a current deployment token on each Function request.
  const config=service.configuration(process.env,req.headers['x-vercel-oidc-token']);
  try{
    if(req.method==='GET'){res.status(200).json({configured:Boolean(config.url&&config.key&&config.model&&config.token),provider:'Vercel AI Gateway',model:config.model||null});return}
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({error:{code:'method_not_allowed',message:'Use the AI Builder form to submit an instruction.'}});return}
    const origin=req.headers.origin;
    if(origin){let host;try{host=new URL(origin).host}catch{host=null}if(host!==req.headers.host)throw new service.ServiceError(403,'origin_not_allowed','Open the AI Builder from this T-IOS site.');}
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new service.ServiceError(415,'invalid_content_type','The request must contain JSON.');
    if(Number(req.headers['content-length']||0)>service.maxRequestBytes)throw new service.ServiceError(413,'request_too_large','The builder request is too large. Use smaller images.');
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(!raw||Buffer.byteLength(raw)>service.maxRequestBytes)throw new service.ServiceError(413,'request_too_large','The builder request is too large. Use smaller images.');
    let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{throw new service.ServiceError(400,'invalid_json','The request is not valid JSON.')}
    const input=service.validateRequest(body);
    if(!config.url||!config.key)throw new service.ServiceError(503,'auth_not_configured','AI Builder authentication is not configured yet.');
    const authorization=String(req.headers.authorization||'');
    const token=/^Bearer ([^\s]+)$/.exec(authorization)?.[1];
    await service.authenticate(token,config);
    if(!config.model||!config.token)throw new service.ServiceError(503,'ai_not_configured','AI Builder is not configured yet. Manual editing is available.');
    await service.reserve(token,config);
    res.status(200).json(await service.generate(input,config));
  }catch(error){
    if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
    const retry=error instanceof service.ServiceError&&error.code==='usage_limit'&&error.retryAfter?{retryAfter:error.retryAfter,resetAt:new Date(Date.now()+error.retryAfter*1000).toISOString()}:{};
    res.status(error instanceof service.ServiceError?error.status:500).json({error:{code:error instanceof service.ServiceError?error.code:'unexpected_failure',message:error instanceof service.ServiceError?error.message:'The AI request failed. No instrument changes were saved.',...retry}});
  }
};
