(function(){
  'use strict';
  const api=window.TIOSDerivPublicTicks,$=name=>document.querySelector('[data-feed-'+name+']');
  const activeStates=['connecting','catalogue','awaiting_ticks','streaming','stale'];
  const labels={idle:'Not connected',connecting:'Connecting',catalogue:'Checking catalogue',awaiting_ticks:'Awaiting actual tick',streaming:'Streaming public ticks',stale:'Stale · no recent tick',stopped:'Stopped',disconnected:'Disconnected',error:'Feed unavailable',rate_limit:'Rate limited'};
  const utc=value=>new Date(value).toISOString().replace('T',' ').replace('Z',' UTC');
  const interval=value=>value===null?'—':(value/1000).toFixed(3)+' s';
  let retryTimer=null,latest;
  function retryControls(){
    const remaining=Math.max(0,Math.ceil((latest.retryAt-Date.now())/1000));
    $('retry').textContent=remaining?'Reconnect available in '+remaining+' s':'';
    $('connect').disabled=activeStates.includes(latest.status)||remaining>0||document.hidden;
    if(retryTimer!==null)clearTimeout(retryTimer);retryTimer=null;
    if(remaining>0&&!document.hidden)retryTimer=setTimeout(retryControls,1000);
  }
  function render(state){
    latest=state;
    $('status').textContent=labels[state.status]||'Feed unavailable';$('status').dataset.status=state.status;
    $('message').textContent=(state.errorCode?state.errorCode+': ':'')+state.message;
    $('stop').disabled=!activeStates.includes(state.status);
    $('market').disabled=activeStates.includes(state.status);
    $('symbol').textContent=state.apiSymbol?state.market.label+' / '+state.apiSymbol:'Not checked against the current catalogue';
    $('price').textContent=state.lastTick?String(state.lastTick.quote):'—';
    $('live').textContent=state.status==='streaming'?'· receiving ticks':state.lastTick?'· retained observation, not live':'· no data';
    $('source-time').textContent=state.lastTick?utc(state.lastTick.epoch*1000):'—';
    $('received-time').textContent=state.lastTick?utc(state.lastTick.receivedAtMs):'—';
    $('count').textContent=state.totalTicks+' / '+state.priceChanges;
    $('gap').textContent=interval(state.lastGapMs)+' / '+interval(state.medianGapMs);
    const history=$('history');history.replaceChildren();
    for(const sample of state.samples){
      const row=document.createElement('tr');
      for(const value of [utc(sample.epoch*1000),utc(sample.receivedAtMs),String(sample.quote),interval(sample.gapMs)]){
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      }
      history.append(row);
    }
    if(!state.samples.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='empty';cell.textContent='No ticks observed yet.';row.append(cell);history.append(row);}
    retryControls();
  }
  const feed=api.create({onChange:render});render(feed.snapshot());
  $('connect').addEventListener('click',()=>{if(!document.hidden)feed.connect($('market').value);});
  $('stop').addEventListener('click',()=>feed.stop());
  $('market').addEventListener('change',()=>{
    feed.stop('Market selection changed. Connect to check this separate instrument.',true);
    $('tv').textContent=api.markets.find(item=>item.key===$('market').value).tradingViewSymbol;
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&activeStates.includes(latest.status))feed.stop('Paused while this page was in the background. Press Connect to start a new test.');
    retryControls();
  });
  window.addEventListener('pagehide',()=>{feed.stop('Page left. Press Connect to start a new test.');if(retryTimer!==null)clearTimeout(retryTimer);retryTimer=null;});
  window.addEventListener('pageshow',retryControls);
})();
