/* Read-only public Options/spot ticks. These are not authenticated MT5 prices. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIOSDerivPublicTicks=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const endpoint='wss://api.derivws.com/trading/v1/options/ws/public';
  const markets=Object.freeze([
    Object.freeze({key:'v75_1s',label:'Volatility 75 (1s) Index',tradingViewSymbol:'DERIV:VOLATILITY_75_1S_INDEX'}),
    Object.freeze({key:'v75',label:'Volatility 75 Index',tradingViewSymbol:'DERIV:VOLATILITY_75_INDEX'})
  ]);
  const requestTimeoutMs=15000,staleAfterMs=15000,retryAfterMs=60000,pingAfterMs=30000;
  function median(values){
    if(!values.length)return null;
    const sorted=values.slice().sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
  }
  function resolveMarket(catalog,key){
    const market=markets.find(item=>item.key===key);
    if(!market)throw new Error('Unsupported market.');
    if(!Array.isArray(catalog))throw new Error('Deriv did not return an active-symbol catalogue.');
    // Resolve the current API identity by its exact documented display name.
    // Never substitute standard Volatility 75 for the separate 1s instrument.
    const matches=catalog.filter(item=>item&&item.underlying_symbol_name===market.label);
    if(matches.length!==1)throw new Error('The selected market is unavailable or ambiguous in the current Deriv catalogue.');
    const item=matches[0];
    if(typeof item.underlying_symbol!=='string'||!/^[-A-Za-z0-9_.]{1,80}$/.test(item.underlying_symbol))throw new Error('Deriv returned an unsupported symbol identifier.');
    if(item.is_trading_suspended===true||item.is_trading_suspended===1||item.exchange_is_open===false||item.exchange_is_open===0)throw new Error('The selected public market is currently unavailable.');
    return {key:market.key,label:market.label,symbol:item.underlying_symbol};
  }
  function create(options={}){
    const socketFactory=options.socketFactory||(url=>new WebSocket(url));
    const now=options.now||Date.now,schedule=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout;
    const onChange=options.onChange||(()=>{});
    let socket=null,listeners=null,generation=0,disposed=false,deadline=null,heartbeat=null,staleTimer=null;
    let state={status:'idle',message:'Choose a market and connect to the public feed.',errorCode:null,market:null,apiSymbol:null,retryAt:0,totalTicks:0,priceChanges:0,lastTick:null,samples:[],lastGapMs:null,medianGapMs:null};
    const snapshot=()=>({...state,market:state.market?{...state.market}:null,lastTick:state.lastTick?{...state.lastTick}:null,samples:state.samples.map(item=>({...item}))});
    const publish=()=>onChange(snapshot());
    function clearTimer(name){
      if(name==='deadline'){if(deadline!==null)cancel(deadline);deadline=null;}
      if(name==='heartbeat'){if(heartbeat!==null)cancel(heartbeat);heartbeat=null;}
      if(name==='stale'){if(staleTimer!==null)cancel(staleTimer);staleTimer=null;}
    }
    function shutdown(){
      generation++;
      for(const name of ['deadline','heartbeat','stale'])clearTimer(name);
      const previous=socket;socket=null;
      if(previous&&listeners)for(const [event,handler] of Object.entries(listeners))previous.removeEventListener(event,handler);
      listeners=null;
      if(previous&&(previous.readyState===0||previous.readyState===1))try{previous.close(1000,'Read-only check stopped');}catch(_){}
    }
    function fail(status,message,errorCode=null){
      shutdown();state={...state,status,message,errorCode};publish();
    }
    function armDeadline(token,message){
      clearTimer('deadline');deadline=schedule(()=>{if(token===generation)fail('error',message,'Timeout');},requestTimeoutMs);
    }
    function connect(key){
      if(disposed)return false;
      const market=markets.find(item=>item.key===key);
      if(!market)throw new Error('Unsupported market.');
      if(now()<state.retryAt){state={...state,status:'rate_limit',errorCode:'RateLimit',message:'Deriv rate-limited this connection. Wait before connecting again.'};publish();return false;}
      if(socket&&state.market&&state.market.key===key)return false;
      shutdown();
      state={...state,status:'connecting',message:'Connecting to the documented Deriv public endpoint…',errorCode:null,market:{...market},apiSymbol:null,retryAt:0,totalTicks:0,priceChanges:0,lastTick:null,samples:[],lastGapMs:null,medianGapMs:null};
      const token=generation;publish();
      let current;
      try{current=socketFactory(endpoint);socket=current;}catch(_){fail('error','The browser could not open the Deriv public connection.','ConnectionError');return false;}
      const valid=()=>token===generation&&socket===current&&!disposed;
      function send(payload){
        try{current.send(JSON.stringify(payload));return true;}catch(_){fail('error','The public connection could not send its read-only request.','ConnectionError');return false;}
      }
      function ping(){
        if(!valid())return;
        heartbeat=schedule(()=>{heartbeat=null;if(valid()&&current.readyState===1&&send({ping:1,req_id:3}))ping();},pingAfterMs);
      }
      function receive(event){
        if(!valid())return;
        let data;
        try{data=JSON.parse(event.data);}catch(_){fail('error','Deriv returned an unreadable response.','InvalidResponse');return;}
        if(!data||typeof data!=='object'||Array.isArray(data))return;
        if(data.error){
          const code=typeof data.error.code==='string'?data.error.code.slice(0,80):'ProviderError';
          const detail=typeof data.error.message==='string'?data.error.message.slice(0,240):'The provider rejected this public request.';
          if(code==='RateLimit'){
            state.retryAt=now()+retryAfterMs;
            fail('rate_limit',detail+' No automatic retries will be made.',code);
          }else fail('error',detail,code);
          return;
        }
        if(data.msg_type==='active_symbols'&&state.status==='catalogue'){
          let resolved;
          try{resolved=resolveMarket(data.active_symbols,key);}catch(error){fail('error',error.message,'UnverifiedSymbol');return;}
          state={...state,apiSymbol:resolved.symbol,status:'awaiting_ticks',message:'Public catalogue resolved. Waiting for an actual tick…'};publish();
          armDeadline(token,'No valid tick arrived within 15 seconds. The public feed remains unverified.');
          send({ticks:resolved.symbol,subscribe:1,req_id:2});return;
        }
        if(data.msg_type!=='tick'||!['awaiting_ticks','streaming','stale'].includes(state.status))return;
        const tick=data.tick;
        if(!tick||tick.symbol!==state.apiSymbol){fail('error','A tick did not match the selected public instrument. It was rejected.','SymbolMismatch');return;}
        if(typeof tick.quote!=='number'||!Number.isFinite(tick.quote)||tick.quote<=0||!Number.isSafeInteger(tick.epoch)||tick.epoch<=0||Number.isNaN(new Date(tick.epoch*1000).getTime())){fail('error','Deriv returned an invalid price or source timestamp. The tick was rejected.','InvalidTick');return;}
        const previous=state.lastTick;
        if(previous&&(tick.epoch<previous.epoch||(tick.epoch===previous.epoch&&tick.quote===previous.quote)))return;
        const receivedAtMs=now(),gapMs=previous?Math.max(0,receivedAtMs-previous.receivedAtMs):null;
        const sample={symbol:tick.symbol,quote:tick.quote,epoch:tick.epoch,receivedAtMs,receivedAt:new Date(receivedAtMs).toISOString(),gapMs};
        const samples=[sample,...state.samples].slice(0,20);
        state={...state,status:'streaming',message:'Receiving public Deriv ticks. MT5 and TradingView price parity is unverified.',totalTicks:state.totalTicks+1,priceChanges:state.priceChanges+(previous&&tick.quote!==previous.quote?1:0),lastTick:sample,samples,lastGapMs:gapMs,medianGapMs:median(samples.map(item=>item.gapMs).filter(value=>value!==null))};
        clearTimer('deadline');clearTimer('stale');
        staleTimer=schedule(()=>{
          staleTimer=null;if(valid()){state={...state,status:'stale',message:'No new valid tick for 15 seconds. The retained price is not confirmation of a live feed.'};publish();}
        },staleAfterMs);
        publish();
      }
      listeners={
        open:()=>{if(valid()){state={...state,status:'catalogue',message:'Checking the selected market against the current public catalogue…'};publish();armDeadline(token,'The public catalogue did not arrive within 15 seconds.');if(send({active_symbols:'brief',req_id:1}))ping();}},
        message:receive,
        error:()=>{if(valid())fail('error','The browser reported a public WebSocket connection error.','ConnectionError');},
        close:()=>{if(valid())fail('disconnected','The public connection closed. Any retained price is no longer live.','ConnectionClosed');}
      };
      for(const [event,handler] of Object.entries(listeners))current.addEventListener(event,handler);
      armDeadline(token,'The public connection did not open within 15 seconds.');
      return true;
    }
    function stop(message='Connection stopped. Any retained price is no longer live.',clearObservations=false){
      if(disposed)return;
      shutdown();state={...state,status:'stopped',message,errorCode:null,...(clearObservations?{market:null,apiSymbol:null,totalTicks:0,priceChanges:0,lastTick:null,samples:[],lastGapMs:null,medianGapMs:null}:{})};publish();
    }
    function dispose(){shutdown();disposed=true;}
    return {connect,stop,dispose,snapshot};
  }
  return {endpoint,markets,resolveMarket,create,requestTimeoutMs,staleAfterMs,retryAfterMs};
});
