/* Pure, browser-and-Node-safe calculations for manually recorded feed comparisons.
 * "Aligned" means observed OHLC differences are consistent, NOT verified parity.
 * Never correct or replace MT5 execution data with TradingView values. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIOSFeedVerification=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const fields=['open','high','low','close'];
  const intervals=Object.freeze({1:1,3:3,5:5,15:15,30:30,60:60,120:120,240:240,D:1440,W:10080});
  const sources=Object.freeze({mt5_bridge:'Authenticated read-only MT5 bridge',manual_mt5_chart:'User observation from MT5 chart',manual_tradingview:'User observation from TradingView',manual_deriv_chart:'User observation from Deriv web chart'});
  const markets=Object.freeze([
    Object.freeze({key:'v75_1s',label:'Volatility 75 (1s) Index',stem:'Volatility 75 (1s) Index',tv:'DERIV:VOLATILITY_75_1S_INDEX'}),
    Object.freeze({key:'v75',label:'Volatility 75 Index',stem:'Volatility 75 Index',tv:'DERIV:VOLATILITY_75_INDEX'})
  ]);
  const timeframes=Object.freeze({M5:300,H1:3600,H4:14400});
  function marketForSymbol(value){
    const symbol=String(value||'').trim().toLowerCase();
    return markets.find(m=>{
      const stem=m.stem.toLowerCase();
      return symbol===stem||(symbol.startsWith(stem)&&/^[._#-][a-z0-9._#-]{0,15}$/.test(symbol.slice(stem.length)));
    })||null;
  }
  function lastClosedOpening(timeframe,at=Date.now()){
    const seconds=timeframes[timeframe];
    return seconds?new Date((Math.floor(at/1000/seconds)-1)*seconds*1000).toISOString():null;
  }
  function connection(account,at=Date.now()){
    if(!account?.bridge_enabled)return 'Disabled';
    const time=Date.parse(account.last_sync_at);
    return account.connection_status==='connected'&&Number.isFinite(time)&&at-time<=120000&&time<=at+30000?'Connected':'Stale / offline';
  }
  function validBar(bar){
    if(!bar||!fields.every(f=>typeof bar[f]==='number'&&Number.isFinite(bar[f])))return false;
    if(bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))return false;
    return true;
  }
  function compare(tv,broker){
    if(!validBar(tv)||!validBar(broker))return {ok:false,message:'Enter valid OHLC prices for both sources.'};
    const deltas=Object.fromEntries(fields.map(f=>[f,broker[f]-tv[f]]));
    const v=Object.values(deltas);
    const range=Math.max(...v)-Math.min(...v);
    const sameCandleShape=range<=0.00001;
    const exactSame=v.every(n=>n===0);
    return {ok:true,deltas,shape:sameCandleShape?'same_shape':'different_shape',
      interpretation:exactSame?'equal_prices':sameCandleShape?'consistent_offset':'different_candle_values',
      range};
  }
  function closedCandle(time,interval,now=Date.now()){
    const d=new Date(time),minutes=intervals[interval];
    return Number.isFinite(d.getTime())&&!!minutes&&d.getTime()+minutes*60000<=now;
  }
  function format(n){return n!==0&&Math.abs(n)<0.00001?Number(n).toExponential(5):Number(n).toFixed(5)}
  function assess({broker,tv,market,timeframe,opening,now=Date.now()}){
    const result=compare(tv?.ohlc,broker?.ohlc);
    const wanted=markets.find(m=>m.key===market),duration=timeframes[timeframe];
    if(!wanted||!duration||!result.ok)return {status:'Insufficient Data',...result,authoritative:false};
    const identity=marketForSymbol(broker.symbol)?.key===market&&tv.symbol===wanted.tv&&
      broker.timeframe===timeframe&&tv.timeframe===timeframe&&
      Number.isFinite(Date.parse(opening))&&Date.parse(broker.opening)===Date.parse(opening)&&Date.parse(tv.opening)===Date.parse(opening);
    const completed=identity&&Date.parse(opening)+duration*1000<=now;
    const retrieved=Date.parse(broker.retrievedAt),observed=Date.parse(tv.observedAt);
    const stale=!Number.isFinite(retrieved)||!Number.isFinite(observed)||retrieved>now+30000||observed>now+30000||now-retrieved>86400000||now-observed>86400000;
    const status=!identity?'Mismatch':!completed||stale?'Insufficient Data':result.interpretation!=='equal_prices'?'Mismatch':'Unverified Market Data';
    return {...result,status,identity,completed,stale,authoritative:false,
      explanation:result.interpretation==='consistent_offset'?'OHLC differences are consistent; the cause is unknown. This does not establish Bid/Ask spread.':
        result.interpretation==='equal_prices'?'Observed prices match. User-supplied TradingView data remains unverified.':'The sources contain different candle values.'};
  }
  // Historical OHLC is not an execution price. A full entry candle's H/L/C can
  // never establish conditions at an entry earlier than that candle's close.
  function strategyEvidence({candle,trade,conditions=[]}){
    const duration=timeframes[candle?.timeframe],opened=Date.parse(candle?.candle_open_at);
    const entry=Date.parse(trade?.opened_at),close=opened+(duration||0)*1000;
    const sameMarket=marketForSymbol(trade?.instrument)?.key===candle?.instrument_key;
    const eligible=!!(trade?.source==='mt5'&&trade?.mt5_position_id&&duration&&candle?.source==='mt5_bridge'&&candle?.clock_confirmed&&candle?.completed&&
      candle.user_id===trade?.user_id&&candle.account_id===trade?.account_id&&sameMarket&&
      Number.isFinite(entry)&&close<=entry&&trade?.entry_clock_verified===true);
    const verifiable=new Set(['candle_open','candle_high','candle_low','candle_close']);
    return {authoritativeAtEntry:eligible,executionPriceSource:trade?.source==='mt5'?'mt5':'unverified',analysisPriceSource:candle?.source==='mt5_bridge'?'mt5_historical_candle':'user_observed',
      priceComparisonAuthoritative:false,lookahead:!!(Number.isFinite(entry)&&close>entry),
      entryClockVerified:trade?.entry_clock_verified===true,
      conditions:conditions.map(condition=>({condition,status:eligible&&verifiable.has(condition)?'verifiable':'unverified'})),
      executionScoreAdjustment:0};
  }
  return {fields,intervals,sources,markets,timeframes,marketForSymbol,lastClosedOpening,connection,validBar,compare,closedCandle,format,assess,strategyEvidence};
});
