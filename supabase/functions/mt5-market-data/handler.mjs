// No trade mutation or TradingView access. Only bridge-authenticated MT5 evidence.
export const markets = Object.freeze({v75_1s:'DERIV:VOLATILITY_75_1S_INDEX',v75:'DERIV:VOLATILITY_75_INDEX'});
export const durations = Object.freeze({H4:14400,H1:3600,M5:300});
export function marketKey(symbol) {
  if (/^Volatility 75 \(1s\) Index([._#-][a-z0-9._#-]{0,15})?$/i.test(symbol)) return 'v75_1s';
  if (/^Volatility 75 Index([._#-][a-z0-9._#-]{0,15})?$/i.test(symbol)) return 'v75';
  return null;
}
export function validateCandle(body, request, now) {
  if (body.symbol !== request.mt5_symbol || body.timeframe !== request.timeframe || marketKey(body.symbol)!==request.instrument_key) throw Error('Candle instrument/timeframe mismatch');
  const offset=body.utc_offset_seconds, raw=body.open_epoch, retrieved=body.retrieved_epoch;
  if(body.clock_confirmed!==true || !Number.isInteger(offset) || Math.abs(offset)>50400 || !Number.isSafeInteger(raw) || !Number.isSafeInteger(retrieved)) throw Error('Explicit broker clock confirmation is required');
  if(raw-offset!==Date.parse(request.candle_open_at)/1000) throw Error('Exact candle opening not returned');
  if(Math.abs(retrieved-now/1000)>120) throw Error('Stale terminal retrieval clock');
  if(raw-offset+durations[request.timeframe]>Math.min(now/1000,retrieved)) throw Error('Candle is not completed');
  const b=body.ohlc, fields=['open','high','low','close'];
  if(!b || !fields.every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])) || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high)) throw Error('Invalid OHLC');
  return {ohlc:Object.fromEntries(fields.map(k=>[k,b[k]])),broker_open_epoch:raw,broker_utc_offset_seconds:offset,clock_confirmed:true,completed:true,terminal_retrieved_at:new Date(retrieved*1000).toISOString()};
}
export function restDatabase(url,key) {
  const headers={apikey:key,'Content-Type':'application/json',...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{})};
  async function call(table,params,method='GET',body,extra={}) {
    const r=await fetch(url+'/rest/v1/'+table+'?'+new URLSearchParams(params),{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await r.json().catch(()=>null);
    if(!r.ok) { const error=Error('Database operation failed'); error.code=data?.code; throw error; }
    return data;
  }
  return {select:(t,p)=>call(t,p),insert:(t,b)=>call(t,{},'POST',b,{Prefer:'return=representation'}),
    update:(t,p,b)=>call(t,p,'PATCH',b,{Prefer:'return=representation'}),
    upsert:(t,b)=>call(t,{on_conflict:'account_id,mt5_symbol'},'POST',b,{Prefer:'resolution=merge-duplicates,return=minimal'})};
}
export function createHandler({database,now=()=>Date.now()}) {
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return async req=>{
    if(req.method!=='POST') return json({error:'POST required'},405);
    let authenticated=false;
    try {
      const raw=await req.text(); if(raw.length>65536)return json({error:'Payload too large'},413);
      const body=JSON.parse(raw), id=req.headers.get('x-te-connection-id'),key=req.headers.get('x-te-bridge-key');
      if(!id || !/^[0-9a-f-]{36}$/i.test(id) || !key || key.length<20 || key.length>256) return json({error:'Bridge authentication required'},401);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).map(n=>n.toString(16).padStart(2,'0')).join('');
      const accounts=await database.select('trading_accounts',{select:'id,user_id,mt5_login,mt5_server,account_type,platform,broker',id:'eq.'+id,bridge_enabled:'eq.true',bridge_token_hash:'eq.'+hash});
      const account=accounts?.[0],a=body.account;
      if(!account || account.platform!=='MT5' || account.broker!=='Deriv' || !a || !String(account.mt5_login||'') || String(a.login)!==String(account.mt5_login) || !account.mt5_server || a.server!==account.mt5_server || !['demo','real'].includes(a.account_type) || a.account_type!==account.account_type)return json({error:'Bridge account identity mismatch'},401);
      authenticated=true;
      const timestamp=new Date(now()).toISOString(),scope={account_id:'eq.'+account.id,user_id:'eq.'+account.user_id};
      if(body.action==='poll') {
        if(!Array.isArray(body.symbols)||body.symbols.length>50)throw Error('Invalid symbol catalogue');
        const symbols=body.symbols.filter(s=>typeof s.symbol==='string'&&marketKey(s.symbol)).map(s=>{
          if(!Number.isInteger(s.digits)||s.digits<0||s.digits>12||!Number.isFinite(s.point)||s.point<=0)throw Error('Invalid symbol precision');
          return {account_id:account.id,user_id:account.user_id,mt5_symbol:s.symbol,instrument_key:marketKey(s.symbol),digits:s.digits,point:s.point,description:String(s.description||'').slice(0,300),broker_server:a.server,retrieved_at:timestamp,source:'mt5_bridge'};
        });
        if(symbols.length)await database.upsert('mt5_market_symbols',symbols);
        await database.update('mt5_candle_requests',{...scope,status:'eq.queued',expires_at:'lt.'+timestamp},{status:'unavailable',message:'Request expired before the MT5 companion returned a candle',completed_at:timestamp});
        const pending=await database.select('mt5_candle_requests',{select:'id,mt5_symbol,timeframe,candle_open_at,instrument_key',...scope,status:'eq.queued',expires_at:'gt.'+timestamp,order:'created_at.asc',limit:'1'});
        const r=pending?.[0];
        return json(r?{ok:true,request_id:r.id,symbol:r.mt5_symbol,timeframe:r.timeframe,open_epoch:Math.floor(Date.parse(r.candle_open_at)/1000)}:{ok:true,request_id:''});
      }
      if(body.action!=='result'||typeof body.request_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.request_id))throw Error('Invalid result request');
      const requests=await database.select('mt5_candle_requests',{select:'*',...scope,id:'eq.'+body.request_id});
      const r=requests?.[0]; if(!r) return json({error:'Request not owned by this bridge'},404);
      if(r.status==='completed') return json({ok:true,duplicate:true});
      if(r.status!=='queued'||Date.parse(r.expires_at)<now())return json({error:'Request is no longer pending'},409);
      if(body.unavailable===true) {
        // Safe predefined messages; do not persist terminal errors or credentials.
        const reason=['symbol_unavailable','clock_unconfirmed','history_unavailable','timestamp_not_found'].includes(body.reason)?body.reason:'history_unavailable';
        await database.update('mt5_candle_requests',{...scope,id:'eq.'+r.id,status:'eq.queued'},{status:'unavailable',message:reason,completed_at:timestamp});
        return json({ok:true,status:'unavailable'});
      }
      const candle=validateCandle(body,r,now());
      const record={...candle,request_id:r.id,user_id:account.user_id,account_id:account.id,instrument_key:r.instrument_key,mt5_symbol:r.mt5_symbol,tv_symbol:markets[r.instrument_key],timeframe:r.timeframe,candle_open_at:r.candle_open_at,retrieved_at:timestamp,source:'mt5_bridge',raw_metadata:{tick_volume:body.tick_volume??null,spread_points:body.spread_points??null,utc_offset_basis:'explicit_terminal_configuration',bridge_version:'1.00'}};
      try {await database.insert('mt5_market_candles',record)} catch(e) {
        if(e.code!=='23505')throw e;
        // A retry never changes the first accepted broker candle.
        const previous=await database.select('mt5_market_candles',{select:'id',...scope,request_id:'eq.'+r.id});
        if(!previous?.length)throw e;
      }
      await database.update('mt5_candle_requests',{...scope,id:'eq.'+r.id,status:'eq.queued'},{status:'completed',message:null,completed_at:timestamp});
      return json({ok:true,status:'completed'});
    }catch(e){return json({error:authenticated?(e.message==='Database operation failed'?'Evidence could not be saved':e.message):'Bridge authentication failed'},authenticated?400:401)}
  };
}
