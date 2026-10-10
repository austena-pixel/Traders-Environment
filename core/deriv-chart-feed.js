/* Public Deriv candles only. Shared by native panes, never treated as MT5 data. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIOSDerivChartFeed=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const endpoint='wss://api.derivws.com/trading/v1/options/ws/public';
  const marketLabels={v75_1s:'Volatility 75 (1s) Index',v75:'Volatility 75 Index'};
  const seconds={'1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'120':7200,'240':14400,D:86400};
  function candle(value){
    const item={time:Number(value?.epoch??value?.open_time),open:Number(value?.open),high:Number(value?.high),low:Number(value?.low),close:Number(value?.close)};
    if(!Number.isSafeInteger(item.time)||item.time<=0||[item.open,item.high,item.low,item.close].some(p=>!Number.isFinite(p)||p<=0)||item.low>Math.min(item.open,item.close)||item.high<Math.max(item.open,item.close)||item.low>item.high)throw Error('Deriv returned an invalid candle.');
    return item;
  }
  function history(values){
    if(!Array.isArray(values)||!values.length)throw Error('Deriv returned no historical candles.');
    const result=values.map(candle).sort((a,b)=>a.time-b.time);
    if(new Set(result.map(v=>v.time)).size!==result.length)throw Error('Deriv returned duplicate candle times.');
    return result;
  }
  const CACHE_KEY='tios_deriv_chart_catalogue_v1';
  function create({socketFactory=url=>new WebSocket(url),schedule=setTimeout,cancel=clearTimeout,now=Date.now,storage=null}={}){
    const streams=new Map();let catalogue=null,cataloguePromise=null,retryAt=0;
    try{
      const cached=JSON.parse(storage?.getItem(CACHE_KEY)||'null');
      if(cached?.endpoint===endpoint&&Number.isSafeInteger(cached.verifiedAt)&&now()>=cached.verifiedAt&&now()-cached.verifiedAt<1800000&&cached.symbols&&Object.keys(cached.symbols).length===2&&Object.keys(marketLabels).every(k=>typeof cached.symbols[k]==='string'&&/^[-a-zA-Z0-9_.]{1,80}$/.test(cached.symbols[k])))catalogue=cached.symbols;
    }catch(_){}
    function resolveCatalogue(){
      if(catalogue)return Promise.resolve(catalogue);
      if(cataloguePromise)return cataloguePromise;
      if(now()<retryAt)return Promise.reject(Error('Deriv is rate limiting public data. Retry after '+new Date(retryAt).toLocaleTimeString()+'.'));
      cataloguePromise=new Promise((resolve,reject)=>{
        let socket,timeout,done=false;
        const finish=(error,data)=>{if(done)return;done=true;cancel(timeout);try{socket?.close();}catch(_){};error?reject(error):resolve(data);};
        try{socket=socketFactory(endpoint);}catch(_){finish(Error('The public Deriv connection could not open.'));return;}
        timeout=schedule(()=>finish(Error('The Deriv symbol catalogue timed out.')),15000);
        socket.addEventListener('open',()=>socket.send(JSON.stringify({active_symbols:'brief',req_id:1})));
        socket.addEventListener('error',()=>finish(Error('The public Deriv connection failed.')));
        socket.addEventListener('close',()=>finish(Error('The public Deriv connection closed.')));
        socket.addEventListener('message',e=>{
          let d;try{d=JSON.parse(e.data);}catch(_){finish(Error('Deriv returned unreadable catalogue data.'));return;}
          if(d.error){if(d.error.code==='RateLimit')retryAt=now()+60000;finish(Error(String(d.error.message||'Deriv rejected the public request.').slice(0,240)));return;}
          if(d.msg_type!=='active_symbols')return;
          try{
            if(!Array.isArray(d.active_symbols))throw Error('Invalid catalogue.');
            const result={};
            for(const [key,label] of Object.entries(marketLabels)){
              const matches=d.active_symbols.filter(s=>s.underlying_symbol_name===label);
              if(matches.length!==1||typeof matches[0].underlying_symbol!=='string'||!/^[-a-zA-Z0-9_.]{1,80}$/.test(matches[0].underlying_symbol))throw Error('A native chart market could not be verified in the Deriv catalogue.');
              result[key]=matches[0].underlying_symbol;
            }
            catalogue=result;
            try{storage?.setItem(CACHE_KEY,JSON.stringify({endpoint,verifiedAt:now(),symbols:result}));}catch(_){}
            finish(null,result);
          }catch(error){finish(error);}
        });
      }).finally(()=>{cataloguePromise=null;});
      return cataloguePromise;
    }
    function subscribe(market,interval,listener,requiredFrom=null){
      if(!Object.hasOwn(marketLabels,market)||!Object.hasOwn(seconds,interval))throw Error('Unsupported native chart market or timeframe.');
      const key=market+':'+interval;
      let stream=streams.get(key);
      if(!stream){
        stream={listeners:new Set(),socket:null,bars:[],status:'loading',message:'Loading real Deriv candles…',closed:false,timer:null,ping:null,stale:null,symbol:null,interval,requiredFrom:null,earlierBusy:false,earlierLoads:0};
        streams.set(key,stream);connect(stream,market,interval);
      }
      if(Number.isSafeInteger(requiredFrom)&&requiredFrom>0)stream.requiredFrom=Math.min(stream.requiredFrom||requiredFrom,requiredFrom);
      stream.listeners.add(listener);listener({bars:stream.bars.map(b=>({...b})),status:stream.status,message:stream.message});
      requestEarlier(stream,false);
      return ()=>{stream.listeners.delete(listener);if(!stream.listeners.size){stop(stream);streams.delete(key);}};
    }
    function publish(s){for(const fn of s.listeners)fn({bars:s.bars.map(b=>({...b})),status:s.status,message:s.message});}
    function stop(s){s.closed=true;for(const k of ['timer','ping','stale','earlierTimer']){cancel(s[k]);s[k]=null;}try{s.socket?.close();}catch(_){}s.socket=null;}
    function requestEarlier(s,manual){
      if(s.closed||s.earlierBusy||!s.bars.length||s.socket?.readyState!==1||s.bars.length>=50000||now()<retryAt)return;
      if(!manual&&(!s.requiredFrom||s.requiredFrom>=s.bars[0].time||s.earlierLoads>=10))return;
      s.earlierBusy=true;s.earlierLoads++;
      s.earlierTimer=schedule(()=>{s.earlierBusy=false;s.message='Earlier candles could not load. Saved drawings are retained; use Load earlier candles to retry.';publish(s);},15000);
      s.socket.send(JSON.stringify({ticks_history:s.symbol,style:'candles',granularity:seconds[s.interval],end:s.bars[0].time-1,count:1000,subscribe:0,req_id:4}));
    }
    async function connect(s,market,interval){
      try{
        const symbols=await resolveCatalogue();if(s.closed)return;
        if(now()<retryAt)throw Error('Deriv is rate limiting public data. Wait one minute before retrying.');
        s.symbol=symbols[market];const socket=socketFactory(endpoint);s.socket=socket;
        const valid=()=>!s.closed&&s.socket===socket;
        const fail=message=>{if(!valid())return;stop(s);s.status='error';s.message=message;publish(s);};
        s.timer=schedule(()=>fail('No candles arrived within 15 seconds. Your saved analysis is retained.'),15000);
        const heartbeat=()=>{s.ping=schedule(()=>{if(valid()){socket.send(JSON.stringify({ping:1}));heartbeat();}},30000);};
        socket.addEventListener('open',()=>{if(valid()){socket.send(JSON.stringify({ticks_history:s.symbol,style:'candles',granularity:seconds[interval],end:'latest',count:1000,subscribe:1,req_id:2}));heartbeat();}});
        socket.addEventListener('error',()=>fail('The public Deriv candle connection failed. Retry data when connected.'));
        socket.addEventListener('close',()=>fail('The public candle feed stopped. Your analysis is retained; retry data.'));
        socket.addEventListener('message',event=>{
          if(!valid())return;let d;
          try{d=JSON.parse(event.data);}catch(_){fail('Deriv returned unreadable candle data.');return;}
          if(d.error){if(d.error.code==='RateLimit')retryAt=now()+60000;fail(String(d.error.message||'Deriv rejected the candle request.').slice(0,240));return;}
          try{
            if(d.msg_type==='candles'){
              const incoming=history(d.candles);
              if(d.req_id===4){
                cancel(s.earlierTimer);s.earlierTimer=null;s.earlierBusy=false;
                const earliest=s.bars[0]?.time;
                s.bars=[...new Map([...incoming,...s.bars].map(b=>[b.time,b])).values()].sort((a,b)=>a.time-b.time);
                if(s.bars[0].time===earliest)s.requiredFrom=null;
              }else s.bars=incoming;
            }
            else if(d.msg_type==='ohlc'){
              if(d.ohlc?.symbol!==s.symbol||Number(d.ohlc?.granularity)!==seconds[interval])throw Error('An update did not match this chart market or timeframe.');
              // Live ohlc.epoch is the current tick; open_time is the bar anchor.
              const b=candle({...d.ohlc,epoch:d.ohlc.open_time}),last=s.bars.at(-1);
              if(!last)return;
              if(b.time<last.time)return;
              if(b.time===last.time)s.bars[s.bars.length-1]=b;else s.bars.push(b);
            }else return;
            cancel(s.timer);s.timer=null;cancel(s.stale);
            s.status='live';s.message='Deriv public candles · UTC · MT5 / TradingView price parity unverified';
            s.stale=schedule(()=>{if(valid()){s.status='stale';s.message='No candle update for 30 seconds. Retained candles are not live.';publish(s);}},30000);
            publish(s);
            requestEarlier(s,false);
          }catch(error){fail(error.message);}
        });
      }catch(error){if(!s.closed){s.status='error';s.message=error.message;publish(s);}}
    }
    return {subscribe,loadEarlier(market,interval){const s=streams.get(market+':'+interval);if(s)requestEarlier(s,true);},dispose(){for(const s of streams.values())stop(s);streams.clear();},resolveCatalogue};
  }
  return {endpoint,marketLabels,seconds,candle,history,CACHE_KEY,create};
});
