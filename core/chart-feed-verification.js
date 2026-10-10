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
  const sources=Object.freeze({manual_mt5_chart:'Manually read from MT5 chart',manual_deriv_chart:'Manually read from Deriv web chart'});
  function validBar(bar){
    if(!bar||!fields.every(f=>typeof bar[f]==='number'&&Number.isFinite(bar[f])))return false;
    if(bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))return false;
    return true;
  }
  function compare(tv,broker){
    if(!validBar(tv)||!validBar(broker))return {ok:false,message:'Enter valid OHLC prices for both sources.'};
    const deltas=Object.fromEntries(fields.map(f=>[f,+(broker[f]-tv[f]).toFixed(8)]));
    const v=Object.values(deltas);
    const range=Math.max(...v)-Math.min(...v);
    const sameCandleShape=range<=0.00001;
    const exactSame=v.every(n=>Math.abs(n)<=0.00001);
    return {ok:true,deltas,shape:sameCandleShape?'same_shape':'different_shape',
      interpretation:exactSame?'equal_prices':sameCandleShape?'consistent_offset':'different_candle_values',
      range:+range.toFixed(8)};
  }
  function closedCandle(time,interval,now=Date.now()){
    const d=new Date(time),minutes=intervals[interval];
    return Number.isFinite(d.getTime())&&!!minutes&&d.getTime()+minutes*60000<=now;
  }
  function format(n){return Number(n).toFixed(5)}
  return {fields,intervals,sources,validBar,compare,closedCandle,format};
});
