/* T-IOS capture service: Cloudflare Worker / private R2.
Bindings: TIOS_EVIDENCE_BUCKET; vars: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
Only authenticated, non-anonymous T-IOS owners can access trade captures.
*/
const ORIGIN='https://traders-environment-j.vercel.app';
const SIZE=12582912;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const CATEGORIES=['market_context','market_structure','entry','exit','custom'];
const COLUMNS='id,trade_id,category,custom_label,note,chart_id,symbol,timeframe,capture_method,mime_type,file_size,image_width,image_height,captured_at';
function deny(message,status=400){throw {message,status};}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});}
function cors(origin){return origin===ORIGIN?{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'3600','vary':'Origin'}:{};}
function clean(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))deny('Invalid capture details.');return value.trim();}
function validId(id){return typeof id==='string'&&UUID.test(id);}
async function database(env,token,path,options={}){
  const result=await fetch(new URL(path,env.SUPABASE_URL),{
    ...options,redirect:'error',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:'Bearer '+token,accept:'application/json',...(options.headers||{})}
  });
  if(!result.ok)deny('The trade database rejected the operation.',result.status===401||result.status===403?401:502);
  const value=await result.text();
  return value?JSON.parse(value):null;
}
async function authenticate(req,env){
  const auth=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(auth))deny('Please sign in to T-IOS.',401);
  const token=auth.slice(7).trim(),user=await database(env,token,'/auth/v1/user');
  if(!validId(user?.id)||user?.is_anonymous)deny('Please sign in to a registered account.',401);
  return {id:user.id,token};
}
async function requireTrade(env,auth,tradeId){
  if(!validId(tradeId))deny('Choose a valid trade.');
  const query=new URLSearchParams({select:'id',id:'eq.'+tradeId,user_id:'eq.'+auth.id,is_deleted:'eq.false',limit:'1'});
  const rows=await database(env,auth.token,'/rest/v1/trades?'+query);
  if(!Array.isArray(rows)||rows.length!==1)deny('This trade is unavailable to your account.',403);
}
async function captureRow(env,auth,id){
  if(!validId(id))deny('Invalid capture ID.');
  const query=new URLSearchParams({select:COLUMNS+',image_path',id:'eq.'+id,user_id:'eq.'+auth.id,limit:'1'});
  const rows=await database(env,auth.token,'/rest/v1/trade_chart_captures?'+query);
  if(!Array.isArray(rows)||rows.length!==1)deny('Screenshot not found.',404);
  await requireTrade(env,auth,rows[0].trade_id);
  return rows[0];
}
function realImage(bytes,type){
  if(type==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if(type==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/webp')return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  return false;
}
async function upload(req,env,auth){
  if(!req.headers.get('content-type')?.startsWith('multipart/form-data'))deny('Expected a screenshot image.',415);
  if(Number(req.headers.get('content-length')||0)>SIZE+20000)deny('Screenshot exceeds 12 MB.',413);
  const form=await req.formData(),file=form.get('image'),tradeId=clean(form.get('trade_id'),40,true);
  if(!file||typeof file.arrayBuffer!=='function'||!TYPES[file.type]||file.size<1||file.size>SIZE)deny('Choose PNG, JPG or WebP under 12 MB.',413);
  await requireTrade(env,auth,tradeId);
  const category=clean(form.get('category'),32,true),custom=clean(form.get('custom_label')||'',90);
  if(!CATEGORIES.includes(category)||(category==='custom'&&!custom))deny('Choose a valid capture category.');
  const note=clean(form.get('note')||'',1000);
  const chartId=clean(form.get('chart_id'),80,true),symbol=clean(form.get('symbol'),90,true),timeframe=clean(form.get('timeframe'),20,true);
  const method=clean(form.get('capture_method'),16,true),width=Number(form.get('image_width')),height=Number(form.get('image_height'));
  if(!['tab','upload'].includes(method))deny('Invalid screenshot method.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>60000000)
    deny('Invalid image dimensions.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!realImage(bytes,file.type))deny('Invalid image data.',415);
  const id=crypto.randomUUID(),key=auth.id+'/'+tradeId+'/'+id+'/capture.'+TYPES[file.type];
  await env.TIOS_EVIDENCE_BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
  try{
    const payload={id,user_id:auth.id,trade_id:tradeId,category,custom_label:custom,note,chart_id:chartId,
      symbol,timeframe,capture_method:method,image_path:key,mime_type:file.type,file_size:bytes.byteLength,
      image_width:width,image_height:height};
    const saved=await database(env,auth.token,'/rest/v1/trade_chart_captures',{
      method:'POST',headers:{'content-type':'application/json','prefer':'return=representation'},body:JSON.stringify(payload)
    });
    if(!Array.isArray(saved)||saved[0]?.id!==id)deny('Screenshot save could not be confirmed.',502);
    return json({capture:saved[0]},201);
  }catch(err){try{await env.TIOS_EVIDENCE_BUCKET.delete(key);}catch(_){}throw err;}
}
async function list(env,auth,tradeId){
  await requireTrade(env,auth,tradeId);
  const query=new URLSearchParams({select:COLUMNS,user_id:'eq.'+auth.id,trade_id:'eq.'+tradeId,order:'captured_at.desc',limit:'100'});
  return json({captures:await database(env,auth.token,'/rest/v1/trade_chart_captures?'+query)||[]});
}
async function getImage(env,auth,id){
  const row=await captureRow(env,auth,id);
  const obj=await env.TIOS_EVIDENCE_BUCKET.get(row.image_path);
  if(!obj)deny('Screenshot file missing.',404);
  return new Response(obj.body,{headers:{'content-type':row.mime_type,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
async function remove(env,auth,id){
  const row=await captureRow(env,auth,id);
  const query=new URLSearchParams({id:'eq.'+row.id,user_id:'eq.'+auth.id,trade_id:'eq.'+row.trade_id});
  await database(env,auth.token,'/rest/v1/trade_chart_captures?'+query,{method:'DELETE'});
  try{await env.TIOS_EVIDENCE_BUCKET.delete(row.image_path);}catch(e){console.error('R2 cleanup pending for capture',row.id);}
  return json({deleted:true});
}
export default {
  async fetch(req,env){
    const origin=req.headers.get('origin'),corsHeaders=cors(origin),url=new URL(req.url);
    if(req.method==='OPTIONS')return new Response(null,{status:origin===ORIGIN?204:403,headers:corsHeaders});
    if(origin&&origin!==ORIGIN)return json({error:'Origin is not allowed.'},403);
    if(req.method==='GET'&&url.pathname==='/health')
      return json({ok:true,configured:Boolean(env.TIOS_EVIDENCE_BUCKET&&env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY)},200,corsHeaders);
    try{
      if(!env.TIOS_EVIDENCE_BUCKET||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)deny('Screenshot service not configured.',503);
      if(new URL(env.SUPABASE_URL).protocol!=='https:')deny('Invalid storage configuration.',503);
      const auth=await authenticate(req,env);let result;
      if(url.pathname==='/captures'&&req.method==='GET')result=await list(env,auth,url.searchParams.get('trade_id')||'');
      else if(url.pathname==='/captures'&&req.method==='POST'){
        if(origin!==ORIGIN)deny('Uploads must originate in T-IOS.',403);
        result=await upload(req,env,auth);
      }else{
        const match=/^\/captures\/([0-9a-f-]{36})(\/image)?$/i.exec(url.pathname);
        if(!match)deny('Capture endpoint not found.',404);
        if(req.method==='GET'&&match[2])result=await getImage(env,auth,match[1]);
        else if(req.method==='DELETE'&&!match[2]){
          if(origin!==ORIGIN)deny('Removals must originate in T-IOS.',403);
          result=await remove(env,auth,match[1]);
        }else deny('Unsupported request.',405);
      }
      const headers=new Headers(result.headers);
      Object.entries(corsHeaders).forEach(([k,v])=>headers.set(k,v));
      return new Response(result.body,{status:result.status,headers});
    }catch(e){return json({error:Number.isInteger(e?.status)?e.message:'Screenshot service unavailable.'},Number.isInteger(e?.status)?e.status:500,corsHeaders);}
  }
};
