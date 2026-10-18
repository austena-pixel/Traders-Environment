'use strict';
const auth=require('../server/ai-builder-service.cjs');
const conversation=require('../server/tios-personal-intelligence-service.cjs');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  res.setHeader('X-Content-Type-Options','nosniff');
  const config=auth.configuration(process.env,req.headers['x-vercel-oidc-token']);
  try{
    if(req.method==='GET'){
      res.status(200).json({configured:Boolean(config.url&&config.key&&config.model&&config.token),provider:'Vercel AI Gateway'});
      return;
    }
    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      res.status(405).json({error:{code:'method_not_allowed',message:'Use the Personal Intelligence chat to send a message.'}});
      return;
    }
    const origin=req.headers.origin;
    if(origin){
      let host;
      try{host=new URL(origin).host}catch{host=null}
      if(host!==req.headers.host)throw new auth.ServiceError(403,'origin_not_allowed','Open Personal Intelligence from this T-IOS site.');
    }
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new auth.ServiceError(415,'invalid_content_type','The request must contain JSON.');
    if(Number(req.headers['content-length']||0)>conversation.maxRequestBytes)throw new auth.ServiceError(413,'request_too_large','The conversation request is too large.');
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(!raw||Buffer.byteLength(raw)>conversation.maxRequestBytes)throw new auth.ServiceError(413,'request_too_large','The conversation request is too large.');
    let body;
    try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{throw new auth.ServiceError(400,'invalid_json','The request is not valid JSON.')}
    const input=conversation.validateRequest(body);
    if(!config.url||!config.key)throw new auth.ServiceError(503,'auth_not_configured','T-IOS AI authentication is not configured.');
    const authorization=String(req.headers.authorization||'');
    const token=/^Bearer ([^\s]+)$/.exec(authorization)?.[1];
    await auth.authenticate(token,config);
    if(!config.model||!config.token)throw new auth.ServiceError(503,'ai_not_configured','T-IOS AI is not configured yet.');
    await auth.reserve(token,config);
    res.status(200).json(await conversation.generate(input,config));
  }catch(error){
    if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
    const retry=error.code==='usage_limit'&&error.retryAfter
      ?{retryAfter:error.retryAfter,resetAt:new Date(Date.now()+error.retryAfter*1000).toISOString()}
      :{};
    const known=Number.isInteger(error.status)&&error.status>=400&&error.status<=599;
    res.status(known?error.status:500).json({
      error:{
        code:known?error.code||'request_failed':'unexpected_failure',
        message:known?error.message:'The conversation could not be completed. Try again later.',
        ...retry
      }
    });
  }
};