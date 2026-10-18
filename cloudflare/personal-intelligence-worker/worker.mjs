const maxBodyBytes=65536;
const topics=new Set(['statistics','edge','execution','psychology','general']);
const defaults={proactive_enabled:false,conversation_frequency:'balanced',investigation_focus:'both',personalization_enabled:true,include_trade_evidence:true,retention_days:365,development_goal:''};
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class StorageError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code}
}
function fail(status,code,message){throw new StorageError(status,code,message)}
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
function safeEqual(left,right){
  if(typeof left!=='string'||typeof right!=='string'||left.length!==right.length)return false;
  let mismatch=0;for(let i=0;i<left.length;i++)mismatch|=left.charCodeAt(i)^right.charCodeAt(i);
  return mismatch===0;
}
function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_request',label+' must be an object.');
  return value;
}
function text(value,label,max,{optional=false}={}){
  if(optional&&(value===undefined||value===null))return null;
  if(typeof value!=='string'||value.trim().length===0||value.length>max)fail(400,'invalid_request',label+' is invalid.');
  return value.trim();
}
function accountId(payload){return text(payload.accountId,'Account',128)}
function rowId(value,label){
  if(typeof value!=='string'||!idPattern.test(value))fail(400,'invalid_request',label+' is invalid.');
  return value;
}
function parseJson(value,fallback){try{return JSON.parse(value)}catch{return fallback}}
function validatePreferences(value){
  const p=object(value,'Preferences');
  const allowed=['proactive_enabled','conversation_frequency','investigation_focus','personalization_enabled','include_trade_evidence','retention_days','development_goal'];
  if(Object.keys(p).some(key=>!allowed.includes(key)))fail(400,'invalid_request','Preferences contain unsupported fields.');
  if(typeof p.proactive_enabled!=='boolean'||typeof p.personalization_enabled!=='boolean'||typeof p.include_trade_evidence!=='boolean')fail(400,'invalid_request','Preference switches must be boolean.');
  if(!['important','balanced','frequent'].includes(p.conversation_frequency)||!['edge','execution','both'].includes(p.investigation_focus))fail(400,'invalid_request','A Personal Intelligence preference is invalid.');
  if(![0,30,90,365].includes(p.retention_days))fail(400,'invalid_request','The retention period is invalid.');
  if(typeof p.development_goal!=='string'||p.development_goal.length>500)fail(400,'invalid_request','The development goal is too long.');
  return {...p,development_goal:p.development_goal.trim()};
}
function validateEvidenceContext(value){
  if(value===undefined||value===null)return '{}';
  const context=object(value,'Evidence context');
  if(Object.keys(context).some(key=>!['period','summary','evidence'].includes(key)))fail(400,'invalid_request','Evidence context contains unsupported fields.');
  if(context.period!==undefined&&(typeof context.period!=='string'||context.period.length>240))fail(400,'invalid_request','Evidence period is invalid.');
  if(context.summary!==undefined)object(context.summary,'Evidence summary');
  if(context.evidence!==undefined)object(context.evidence,'Trading evidence');
  let serialized;
  try{serialized=JSON.stringify(context)}catch{fail(400,'invalid_request','Evidence context is invalid.')}
  if(new TextEncoder().encode(serialized).byteLength>32768)fail(413,'evidence_too_large','Evidence context is too large to save.');
  return serialized;
}
function cooldownMs(frequency){
  if(frequency==='important')return 7*24*60*60*1000;
  if(frequency==='frequent')return 12*60*60*1000;
  return 48*60*60*1000;
}
function frequencyAllows(priority,frequency){
  if(frequency==='important')return priority>=3;
  if(frequency==='frequent')return priority>=1;
  return priority>=2;
}
async function run(db,sql,...args){return db.prepare(sql).bind(...args).run()}
async function all(db,sql,...args){const result=await db.prepare(sql).bind(...args).all();return result.results||[]}
async function first(db,sql,...args){return db.prepare(sql).bind(...args).first()}

async function handleAction(action,payload,userId,env,now=new Date()){
  const db=env.DB;
  const nowIso=now.toISOString();
  switch(action){
    case 'preferences.get':{
      let row=await first(db,'SELECT preferences_json FROM pi_preferences WHERE user_id=?',userId);
      if(!row){await run(db,'INSERT OR IGNORE INTO pi_preferences(user_id,preferences_json,updated_at) VALUES(?,?,?)',userId,JSON.stringify(defaults),nowIso);row=await first(db,'SELECT preferences_json FROM pi_preferences WHERE user_id=?',userId)}
      return {preferences:{...defaults,...parseJson(row?.preferences_json,'{}')}};
    }
    case 'preferences.set':{
      const preferences=validatePreferences(payload.preferences);
      await run(db,'INSERT INTO pi_preferences(user_id,preferences_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at',userId,JSON.stringify(preferences),nowIso);
      return {saved:true,updated_at:nowIso};
    }
    case 'conversations.prune':{
      const account=accountId(payload),days=payload.retentionDays;
      if(![0,30,90,365].includes(days))fail(400,'invalid_request','The retention period is invalid.');
      if(days===0)return {deleted:0};
      const cutoff=new Date(now.getTime()-days*86400000).toISOString();
      const result=await run(db,'DELETE FROM pi_conversations WHERE user_id=? AND account_id=? AND last_message_at<?',userId,account,cutoff);
      return {deleted:Number(result.meta?.changes)||0};
    }
    case 'conversations.list':{
      const account=accountId(payload);
      const conversations=await all(db,'SELECT id,title,topic,conversation_kind,observation_priority,last_message_at,created_at FROM pi_conversations WHERE user_id=? AND account_id=? ORDER BY last_message_at DESC LIMIT 30',userId,account);
      return {conversations};
    }
    case 'messages.feedback-summary':{
      const ids=payload.conversationIds;
      if(!Array.isArray(ids)||ids.length>30||ids.some(id=>!idPattern.test(id)))fail(400,'invalid_request','Conversation references are invalid.');
      if(!ids.length)return {feedback:{helpful:0,notRelevant:0}};
      const placeholders=ids.map(()=>'?').join(',');
      const rows=await all(db,'SELECT feedback,COUNT(*) AS count FROM pi_messages WHERE user_id=? AND feedback IS NOT NULL AND conversation_id IN ('+placeholders+') GROUP BY feedback',userId,...ids);
      const feedback={helpful:0,notRelevant:0};
      rows.forEach(row=>{if(row.feedback==='helpful')feedback.helpful=Number(row.count)||0;if(row.feedback==='not_relevant')feedback.notRelevant=Number(row.count)||0});
      return {feedback};
    }
    case 'conversations.get':{
      const id=rowId(payload.id,'Conversation'),account=accountId(payload);
      const conversation=await first(db,'SELECT id,title,topic,conversation_kind,observation_priority,last_message_at,created_at FROM pi_conversations WHERE id=? AND user_id=? AND account_id=?',id,userId,account);
      if(!conversation)return {conversation:null,messages:[]};
      const rows=await all(db,'SELECT id,role,source,content,evidence_context,feedback,created_at FROM pi_messages WHERE conversation_id=? AND user_id=? ORDER BY created_at ASC,id ASC',id,userId);
      const messages=rows.map(row=>({...row,evidence_context:parseJson(row.evidence_context,'{}')}));
      return {conversation,messages};
    }
    case 'conversations.delete':{
      const id=rowId(payload.id,'Conversation'),account=accountId(payload);
      const result=await run(db,'DELETE FROM pi_conversations WHERE id=? AND user_id=? AND account_id=?',id,userId,account);
      return {deleted:Number(result.meta?.changes)||0};
    }
    case 'conversations.clear':{
      const account=accountId(payload),result=await run(db,'DELETE FROM pi_conversations WHERE user_id=? AND account_id=?',userId,account);
      return {deleted:Number(result.meta?.changes)||0};
    }
    case 'messages.feedback':{
      const id=rowId(payload.messageId,'Message'),feedback=payload.feedback;
      if(!['helpful','not_relevant'].includes(feedback))fail(400,'invalid_request','Feedback value is invalid.');
      const result=await run(db,'UPDATE pi_messages SET feedback=? WHERE id=? AND user_id=?',feedback,id,userId);
      if(!Number(result.meta?.changes))fail(404,'message_not_found','That message is no longer available.');
      return {saved:true};
    }
    case 'messages.create':{
      const account=accountId(payload),conversationId=rowId(payload.conversationId,'Conversation');
      const role=payload.role,source=payload.source;
      if(!['user','assistant'].includes(role)||!['user','assistant','local_start','observation'].includes(source))fail(400,'invalid_request','Message type is invalid.');
      const content=text(payload.content,'Message',6000),evidence=validateEvidenceContext(payload.evidenceContext);
      const conversation=await first(db,'SELECT id FROM pi_conversations WHERE id=? AND user_id=? AND account_id=?',conversationId,userId,account);
      if(!conversation)fail(404,'conversation_not_found','That conversation is no longer available.');
      const id=crypto.randomUUID();
      await run(db,'INSERT INTO pi_messages(id,conversation_id,user_id,role,source,content,evidence_context,created_at) VALUES(?,?,?,?,?,?,?,?)',id,conversationId,userId,role,source,content,evidence,nowIso);
      await run(db,'UPDATE pi_conversations SET last_message_at=? WHERE id=? AND user_id=? AND account_id=?',nowIso,conversationId,userId,account);
      return {id,created_at:nowIso};
    }
    case 'conversations.create':{
      const account=accountId(payload),id=crypto.randomUUID(),kind=payload.kind||'user',topic=payload.topic||'general';
      if(kind!=='user'||!topics.has(topic))fail(400,'invalid_request','Conversation type is invalid.');
      const title=text(payload.title||'New investigation','Conversation title',80);
      await run(db,'INSERT INTO pi_conversations(id,user_id,account_id,title,topic,conversation_kind,created_at,last_message_at) VALUES(?,?,?,?,?,?,?,?)',id,userId,account,title,topic,kind,nowIso,nowIso);
      return {id,kind};
    }
    case 'conversations.update':{
      const id=rowId(payload.id,'Conversation'),account=accountId(payload),topic=text(payload.topic,'Topic',32);
      if(!topics.has(topic))fail(400,'invalid_request','Conversation topic is invalid.');
      const title=payload.title===undefined?null:text(payload.title,'Conversation title',80),values=[topic,nowIso];
      let sql='UPDATE pi_conversations SET topic=?,last_message_at=?';
      if(title!==null){sql+=',title=?';values.push(title)}
      sql+=' WHERE id=? AND user_id=? AND account_id=?';values.push(id,userId,account);
      const result=await run(db,sql,...values);
      if(!Number(result.meta?.changes))fail(404,'conversation_not_found','That conversation is no longer available.');
      return {updated:true,last_message_at:nowIso};
    }
    case 'observations.create':{
      const account=accountId(payload),title=text(payload.title,'Observation title',120),topic=text(payload.topic,'Topic',32),key=text(payload.observationKey,'Observation key',64),frequency=payload.frequency,priority=payload.priority;
      if(!topics.has(topic)||!['important','balanced','frequent'].includes(frequency)||!Number.isInteger(priority)||priority<1||priority>3||!frequencyAllows(priority,frequency)||!/^([a-z_]+):[0-9a-f]{16}$/.test(key))fail(400,'invalid_request','Observation details are invalid.');
      const cutoff=new Date(now.getTime()-cooldownMs(frequency)).toISOString();
      const id=crypto.randomUUID();
      const inserted=await all(db,"INSERT INTO pi_conversations(id,user_id,account_id,title,topic,conversation_kind,observation_key,observation_priority,created_at,last_message_at) SELECT ?,?,?,?,?, 'observation',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pi_conversations WHERE user_id=? AND account_id=? AND conversation_kind='observation' AND last_message_at>=?) ON CONFLICT(user_id,account_id,observation_key) DO NOTHING RETURNING id,conversation_kind",id,userId,account,title,topic,key,priority,nowIso,nowIso,userId,account,cutoff);
      if(!inserted[0])return {created:false,conversation:null};
      return {created:true,conversation:{id:inserted[0].id,conversation_kind:'observation'}};
    }
    default:fail(400,'unsupported_action','Storage operation is not supported.');
  }
}

export async function handleRequest(request,env){
  if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use the T-IOS application.'}},405);
  if(!env.DB)return json({error:{code:'storage_not_configured',message:'Cloudflare D1 storage is not configured.'}},503);
  const expectedSecret=env.PI_STORAGE_SHARED_SECRET;
  if(typeof expectedSecret!=='string'||expectedSecret.length<32)return json({error:{code:'storage_not_configured',message:'Cloudflare storage authentication is not configured.'}},503);
  const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization')||'')?.[1];
  if(!safeEqual(token,expectedSecret))return json({error:{code:'unauthorized',message:'Storage request is not authorized.'}},401);
  const length=Number(request.headers.get('content-length')||0);
  if(length>maxBodyBytes)return json({error:{code:'request_too_large',message:'Storage request is too large.'}},413);
  let body;
  try{
    const raw=await request.text();
    if(new TextEncoder().encode(raw).byteLength>maxBodyBytes)return json({error:{code:'request_too_large',message:'Storage request is too large.'}},413);
    body=JSON.parse(raw);
  }catch{return json({error:{code:'invalid_json',message:'Storage request must contain JSON.'}},400)}
  try{
    object(body,'Request');
    if(Object.keys(body).some(key=>!['action','payload','userId'].includes(key)))fail(400,'invalid_request','Storage request contains unsupported fields.');
    const action=text(body.action,'Storage action',48),userId=rowId(body.userId,'Authenticated user');
    const payload=object(body.payload||{},'Storage payload');
    return json(await handleAction(action,payload,userId,env));
  }catch(error){
    if(error instanceof StorageError)return json({error:{code:error.code,message:error.message}},error.status);
    return json({error:{code:'storage_failed',message:'Cloudflare could not complete the storage request.'}},500);
  }
}

export {handleAction};
export default {fetch:handleRequest};
