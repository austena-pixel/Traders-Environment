'use strict';
const auth=require('./ai-builder-service.cjs');
const maxRequestBytes=65536;
const allowedActions=new Set([
  'preferences.get','preferences.set','conversations.prune','conversations.list','conversations.get',
  'conversations.delete','conversations.clear','conversations.create','conversations.update',
  'messages.feedback-summary','messages.feedback','messages.create','observations.create'
]);

function createHandler({authService=auth,fetcher=fetch,env=process.env}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(req.method!=='POST'){
        res.setHeader('Allow','POST');
        throw new authService.ServiceError(405,'method_not_allowed','Use the T-IOS application to access Personal Intelligence storage.');
      }
      const origin=req.headers.origin;
      if(origin){
        let host;try{host=new URL(origin).host}catch{host=null}
        if(host!==req.headers.host)throw new authService.ServiceError(403,'origin_not_allowed','Open Personal Intelligence from this T-IOS site.');
      }
      if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new authService.ServiceError(415,'invalid_content_type','Storage requests must contain JSON.');
      const declaredLength=Number(req.headers['content-length']||0);
      if(declaredLength>maxRequestBytes)throw new authService.ServiceError(413,'request_too_large','Storage request is too large.');
      const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      if(!raw||Buffer.byteLength(raw)>maxRequestBytes)throw new authService.ServiceError(413,'request_too_large','Storage request is too large.');
      let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{throw new authService.ServiceError(400,'invalid_json','Storage request must contain valid JSON.')}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','payload'].includes(key)))throw new authService.ServiceError(400,'invalid_request','Storage request contains unsupported fields.');
      if(typeof body.action!=='string'||!allowedActions.has(body.action))throw new authService.ServiceError(400,'unsupported_action','Storage operation is not supported.');
      if(!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))throw new authService.ServiceError(400,'invalid_request','Storage request payload is invalid.');
      const url=String(env.CLOUDFLARE_PI_STORAGE_URL||'').trim(),secret=String(env.CLOUDFLARE_PI_STORAGE_SECRET||'');
      if(!url||secret.length<32)throw new authService.ServiceError(503,'storage_not_configured','Cloudflare D1 storage is not configured yet.');
      let target;try{target=new URL(url)}catch{throw new authService.ServiceError(503,'storage_not_configured','Cloudflare D1 storage endpoint is invalid.')}
      if(target.protocol!=='https:')throw new authService.ServiceError(503,'storage_not_configured','Cloudflare D1 storage endpoint must use HTTPS.');
      const config=authService.configuration(env,req.headers['x-vercel-oidc-token']);
      if(!config.url||!config.key)throw new authService.ServiceError(503,'auth_not_configured','T-IOS authentication is not configured.');
      const token=/^Bearer ([^\s]+)$/.exec(String(req.headers.authorization||''))?.[1];
      const userId=await authService.authenticate(token,config,fetcher);
      let response;
      try{
        response=await fetcher(target.toString(),{
          method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
          body:JSON.stringify({action:body.action,payload:body.payload,userId}),signal:AbortSignal.timeout(20000)
        });
      }catch{throw new authService.ServiceError(502,'storage_unavailable','Cloudflare D1 could not be reached. Try again shortly.')}
      let result;try{result=await response.json()}catch{throw new authService.ServiceError(502,'invalid_storage_response','Cloudflare returned an unreadable storage response.')}
      if(!response.ok){
        const error=result?.error||{};
        throw new authService.ServiceError(response.status>=400&&response.status<=599?response.status:502,error.code||'storage_failed',typeof error.message==='string'?error.message:'Cloudflare could not complete the storage request.');
      }
      res.status(200).json(result);
    }catch(error){
      const known=Number.isInteger(error.status)&&error.status>=400&&error.status<=599;
      res.status(known?error.status:500).json({error:{code:known?error.code||'storage_failed':'unexpected_failure',message:known?error.message:'Personal Intelligence storage could not complete this request.'}});
    }
  };
}

module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.maxRequestBytes=maxRequestBytes;
