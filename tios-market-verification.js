(function(){
  'use strict';
  const F=window.TIOSFeedVerification;
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const utcInput=iso=>String(iso||'').replace(/Z$/,'').slice(0,19);
  const iso=value=>value?new Date(value+'Z').toISOString():null;
  window.TIOSMarketVerification={create({getClient,getUser,getAccounts=()=>[],getSelectedAccount=()=>null,getNumber=()=>null}){
    const panel=document.createElement('details');panel.className='market-verification charts-setup';
    let userId=null,epoch=0,shown=false,timer=null,busy=false,loading=false,refreshQueued=false;
    let accountId='',instrument='v75_1s',timeframe='H1',opening=F.lastClosedOpening('H1'),tradeId='',mode='mt5_bridge';
    let symbols=[],trades=[],candles=[],requests=[],history=[],draft={},selected=null,historyPage=0;
    const $=s=>panel.querySelector(s),live=(id,e)=>getUser()?.id===id&&userId===id&&epoch===e;
    const account=()=>getAccounts().find(a=>a.id===accountId);
    const symbol=()=> $('[data-market-field="symbol"]')?.value || draft.symbol || F.markets.find(m=>m.key===instrument)?.stem+'.0';
    const tell=(message,error=false)=>{const n=$('[data-market-message]');if(n){n.textContent=message;n.classList.toggle('charts-status-error',error)}};
    function capture(){
      panel.querySelectorAll('[data-market-field]').forEach(n=>{draft[n.dataset.marketField]=n.type==='checkbox'?n.checked:n.value});
    }
    function render(){
      const market=F.markets.find(m=>m.key===instrument),accounts=getAccounts().filter(a=>a.platform==='MT5');
      const choices=[...new Set([...symbols.filter(s=>s.instrument_key===instrument).map(s=>s.mt5_symbol),...trades.filter(t=>F.marketForSymbol(t.instrument)?.key===instrument).map(t=>t.instrument)])];
      if(!choices.length)choices.push(market.stem+'.0');
      if(!choices.includes(draft.symbol))draft.symbol=choices[0];
      const linked=trades.filter(t=>t.instrument===draft.symbol);
      panel.innerHTML=`<summary><strong>Market Data Verification</strong><span class="charts-setup-caption">MT5 evidence · manual TradingView comparison</span></summary>
        <div class="market-body">
          <p class="market-note">MT5 execution records remain authoritative for trades. TradingView values below are user observations.</p>
          <label>Trading account<select data-market-field="account"><option value="">Select MT5 account</option>${accounts.map(a=>`<option value="${escape(a.id)}" ${a.id===accountId?'selected':''}>${escape(a.account_name)}</option>`).join('')}</select></label>
          <div data-market-connection class="market-note" aria-live="polite"></div>
          <label>Selected instrument<select data-market-field="instrument">${F.markets.map(m=>`<option value="${m.key}" ${instrument===m.key?'selected':''}>${m.label}</option>`).join('')}</select></label>
          <label>Corresponding MT5 symbol<select data-market-field="symbol">${choices.map(s=>`<option ${s===draft.symbol?'selected':''}>${escape(s)}</option>`).join('')}</select></label>
          <div data-market-mapping class="market-note"></div>
          <label>Timeframe<select data-market-field="timeframe">${Object.keys(F.timeframes).map(tf=>`<option ${tf===timeframe?'selected':''}>${tf}</option>`).join('')}</select></label>
          <label>Candle opening · UTC<input type="datetime-local" step="1" data-market-field="opening" value="${escape(utcInput(opening))}"></label>
          <button class="btn small" type="button" data-market-action="latest">Use latest completed candle</button>
          <label>Link to existing trade (optional)<select data-market-field="trade"><option value="">No linked trade</option>${linked.map(t=>`<option value="${escape(t.id)}" ${t.id===tradeId?'selected':''}>Trade ${escape(getNumber(t.id)||'·')} · ${escape(t.opened_at||t.trade_date)} · ${escape(t.mt5_position_id||'')}</option>`).join('')}</select></label>
          <div class="market-note" data-market-trade></div>
          <button class="btn small" type="button" data-market-action="at-entry" ${tradeId?'':'disabled'}>Use last candle closed before recorded entry</button>
          <label>MT5 evidence source<select data-market-field="mode"><option value="mt5_bridge" ${mode==='mt5_bridge'?'selected':''}>Authenticated MT5 candle</option><option value="manual_mt5_chart" ${mode==='manual_mt5_chart'?'selected':''}>Manual MT5 observation (unverified)</option></select></label>
          <button class="btn small" type="button" data-market-action="request">Request completed MT5 candle</button>
          <div class="market-note" data-market-request></div>
          <details class="market-install"><summary>Set up the read-only candle companion</summary><p>Keep the current trade bridge running. Compile this companion in MetaEditor and attach it to a second chart on the same MT5 account. Use your existing Connection ID and Bridge Key. Allow WebRequest to your Supabase project. Confirm the broker candle UTC offset for the requested date; the default is unconfirmed.</p><a href="mt5/TradersEnvironmentMarketData.mq5" download>Download candle companion</a><p class="market-note">Endpoint: mt5-market-data. No trading commands. Terminal compilation and live candle delivery must be checked in MT5.</p></details>
          <div class="market-ohlc"><table><caption>Original prices · difference = MT5 − TradingView</caption><thead><tr><th>Price</th><th>MT5</th><th>TradingView</th><th>Δ</th></tr></thead><tbody>${F.fields.map(f=>`<tr><th>${f[0].toUpperCase()+f.slice(1)}</th><td><input type="number" step="any" data-market-field="mt5_${f}" aria-label="MT5 ${f}" ${mode==='mt5_bridge'?'readonly':''} value="${escape(draft['mt5_'+f]||'')}"></td><td><input type="number" step="any" data-market-field="tv_${f}" aria-label="TradingView ${f}" value="${escape(draft['tv_'+f]||'')}"></td><td data-market-delta="${f}">—</td></tr>`).join('')}</tbody></table></div>
          <div class="market-note" data-market-provenance></div>
          ${mode==='manual_mt5_chart'?`<label>MT5 observation time · UTC<input type="datetime-local" step="1" data-market-field="mt5_observed" value="${escape(draft.mt5_observed||utcInput(new Date().toISOString()))}"></label>`:''}
          <label>TradingView observation time · UTC<input type="datetime-local" step="1" data-market-field="tv_observed" value="${escape(draft.tv_observed||utcInput(new Date().toISOString()))}"></label>
          <label>TradingView observed symbol<select data-market-field="tv_symbol">${F.markets.map(m=>`<option value="${m.tv}" ${(draft.tv_symbol||market.tv)===m.tv?'selected':''}>${m.label}</option>`).join('')}</select></label>
          <label>TradingView observed timeframe<select data-market-field="tv_timeframe">${Object.keys(F.timeframes).map(tf=>`<option ${(draft.tv_timeframe||timeframe)===tf?'selected':''}>${tf}</option>`).join('')}</select></label>
          <label>TradingView candle opening · UTC<input type="datetime-local" step="1" data-market-field="tv_opening" value="${escape(draft.tv_opening||utcInput(opening))}"></label>
          <label class="market-confirm"><input type="checkbox" data-market-field="confirmed" ${draft.confirmed?'checked':''}> I checked the symbol, timeframe and UTC opening displayed in TradingView.</label>
          <label>Observation notes<textarea data-market-field="notes" maxlength="1000" rows="2">${escape(draft.notes||'')}</textarea></label>
          <strong data-market-result role="status">Insufficient Data</strong><p class="market-note" data-market-explanation></p>
          <button class="btn small primary" type="button" data-market-action="save">Save comparison</button>
          <p data-market-message role="status" aria-live="polite" class="market-note"></p>
          <details class="market-history" open><summary>Previous comparisons</summary><div data-market-history></div><div class="market-history-nav"><button class="btn small" type="button" data-market-action="history-prev">Newer</button><button class="btn small" type="button" data-market-action="history-next">Older</button></div></details>
          <p class="market-note">Name mapping does not verify prices. The widget provides no authorised OHLC export or reliable symbol-change event. Equal manual observations stay unverified. A constant offset does not prove spread. Full entry-candle OHLC must not be used before its close; legacy trade entry clocks remain unverified.</p>
        </div>`;
      capture();update();
    }
    function bar(prefix){
      const values=Object.fromEntries(F.fields.map(f=>{const value=draft[prefix+'_'+f];return [f,value===''||value===undefined?null:Number(value)]}));
      return F.validBar(values)?values:null;
    }
    function update(){
      if(!$('[data-market-connection]'))return;
      const a=account(),s=symbol(),catalog=symbols.find(x=>x.mt5_symbol===s),past=trades.some(t=>t.instrument===s);
      $('[data-market-connection]').textContent='MT5 trade bridge: '+F.connection(a)+(a?.last_sync_at?' · last received '+a.last_sync_at:'');
      const fresh=catalog&&Date.now()-Date.parse(catalog.retrieved_at)<=120000;
      $('[data-market-mapping]').textContent=fresh?'Verified Mapping · observed in connected MT5 symbol catalogue':past?'Verified Mapping · historical MT5 deals; current catalogue unverified':'Mapping unverified · awaiting connected MT5 symbol catalogue';
      selected=mode==='mt5_bridge'?candles.find(c=>c.mt5_symbol===s&&c.timeframe===timeframe&&Date.parse(c.candle_open_at)===Date.parse(opening)):null;
      if(mode==='mt5_bridge')for(const f of F.fields){draft['mt5_'+f]=selected?.ohlc?.[f]??'';$('[data-market-field="mt5_'+f+'"]').value=draft['mt5_'+f]}
      const request=requests.find(r=>r.mt5_symbol===s&&r.timeframe===timeframe&&Date.parse(r.candle_open_at)===Date.parse(opening));
      $('[data-market-request]').textContent=request?(request.status==='queued'&&Date.parse(request.expires_at)<Date.now()?'Request expired · request again':request.status+' · '+(request.message||request.created_at)):'No candle request for this selection';
      $('[data-market-provenance]').textContent=selected?'MT5 bridge · retrieved '+selected.retrieved_at+' · terminal '+selected.terminal_retrieved_at+' · broker UTC offset '+selected.broker_utc_offset_seconds+'s':mode==='manual_mt5_chart'?'MT5 values are user observations. Retrieval time will be recorded when saved.':'MT5 candle unavailable. Start the companion or select manual MT5 observation.';
      const linked=trades.find(t=>t.id===tradeId);
      $('[data-market-trade]').textContent=linked?'Position '+linked.mt5_position_id+' · recorded entry '+linked.opened_at+' · entry clock unverified':'';
      const now=Date.now(),result=F.assess({broker:{ohlc:selected?.ohlc||bar('mt5'),symbol:s,timeframe,opening,retrievedAt:selected?.retrieved_at||(draft.mt5_observed?iso(draft.mt5_observed):new Date(now).toISOString())},tv:{ohlc:bar('tv'),symbol:draft.tv_symbol,timeframe:draft.tv_timeframe,opening:draft.tv_opening?iso(draft.tv_opening):null,observedAt:draft.tv_observed?iso(draft.tv_observed):new Date(now).toISOString()},market:instrument,timeframe,opening,now});
      if(!draft.confirmed&&result.status!=='Mismatch')result.status='Insufficient Data';
      $('[data-market-result]').textContent=result.status;
      $('[data-market-explanation]').textContent=result.ok?(result.identity?result.explanation:'Instrument, timeframe or candle opening does not match.'):'Enter all four original prices from both sources.';
      for(const f of F.fields)$('[data-market-delta="'+f+'"]').textContent=result.deltas?.[f]===undefined?'—':F.format(result.deltas[f]);
      $('[data-market-action="request"]').disabled=busy||!accountId;
      $('[data-market-action="save"]').disabled=busy||!accountId||(!bar('mt5')&&!bar('tv'));
      const rows=tradeId?history.filter(h=>h.trade_id===tradeId):history;
      $('[data-market-history]').innerHTML=rows.length?rows.map(h=>`<article><strong>${escape(h.status)}</strong><span>${escape(h.instrument_key==='v75_1s'?'V75 (1s)':'V75')} · ${escape(h.timeframe)} · ${escape(h.candle_open_at)}</span><span>Saved ${escape(h.created_at)} · ${escape(h.broker_source)} / user TradingView</span><span>O/H/L/C Δ: ${escape(h.differences?F.fields.map(f=>h.differences[f]).join(' / '):'unavailable')}</span>${h.trade_id?'<span>Linked position '+escape(h.mt5_position_id)+' · '+h.mt5_deal_ids.length+' deal(s)</span>':''}${h.closed_before_recorded_entry===false?'<span>Closes after recorded entry: lookahead risk</span>':''}<span>${escape(h.interpretation==='consistent_offset'?'Consistent offset; cause unknown':h.interpretation||'Insufficient observations')}</span><details><summary>Original values and evidence</summary><span>MT5 O/H/L/C: ${escape(h.mt5_ohlc?F.fields.map(f=>h.mt5_ohlc[f]).join(' / '):'unavailable')}</span><span>TradingView O/H/L/C: ${escape(h.tv_ohlc?F.fields.map(f=>h.tv_ohlc[f]).join(' / '):'unavailable')}</span><span>MT5: ${escape(h.mt5_symbol)} · retrieved ${escape(h.mt5_retrieved_at)}</span><span>TradingView: ${escape(h.tv_symbol)} · ${escape(h.tv_timeframe)} · opening ${escape(h.tv_candle_open_at)} · observed ${escape(h.tv_observed_at)}</span><span>${escape(h.notes||'')}</span></details></article>`).join(''):'No saved comparisons'+(tradeId?' for this trade':'')+'.';
      $('[data-market-action="history-prev"]').disabled=historyPage===0;
      $('[data-market-action="history-next"]').disabled=history.length<20;
    }
    async function load(){
      if(!accountId||!getClient())return;
      if(loading){refreshQueued=true;return}
      const id=userId,e=epoch,aid=accountId;loading=true;
      try{
        const scoped=table=>getClient().from(table).select('*').eq('user_id',id).eq('account_id',aid);
        let historyQuery=scoped('market_feed_comparisons');
        if(tradeId)historyQuery=historyQuery.eq('trade_id',tradeId);
        const results=await Promise.all([
          scoped('mt5_market_symbols').order('mt5_symbol'),
          scoped('trades').eq('source','mt5').eq('is_deleted',false).order('opened_at',{ascending:false}).limit(500),
          scoped('mt5_market_candles').eq('mt5_symbol',symbol()).eq('timeframe',timeframe).eq('candle_open_at',opening).order('retrieved_at',{ascending:false}).limit(10),
          scoped('mt5_candle_requests').order('created_at',{ascending:false}).limit(10),
          historyQuery.order('created_at',{ascending:false}).range(historyPage*20,historyPage*20+19)
        ]);
        if(!live(id,e)||accountId!==aid)return;
        if(results.some(r=>r.error))throw Error('Saved market evidence could not be loaded. Retry; existing records are preserved.');
        const choicesChanged=JSON.stringify([symbols.map(s=>s.mt5_symbol),trades.map(t=>t.id)])!==JSON.stringify([results[0].data.map(s=>s.mt5_symbol),results[1].data.map(t=>t.id)]);
        [symbols,trades,candles,requests,history]=results.map(r=>r.data||[]);
        if(choicesChanged){capture();render()}else update();
      }catch(error){if(live(id,e))tell(error.message,true)}
      finally {if(live(id,e)){loading=false;if(refreshQueued){refreshQueued=false;load()}}}
    }
    function schedule(){
      clearTimeout(timer);if(shown)timer=setTimeout(async()=>{if(!shown)return;await load();schedule()},10000);
    }
    async function request(){
      if(busy||!accountId)return;
      const id=userId,e=epoch;capture();busy=true;update();tell('Requesting the exact completed MT5 candle…');
      try{
        if(!F.closedCandle(opening,{H4:'240',H1:'60',M5:'5'}[timeframe]))throw Error('Choose a completed candle in UTC.');
        const {error}=await getClient().from('mt5_candle_requests').insert({user_id:id,account_id:accountId,instrument_key:instrument,mt5_symbol:symbol(),timeframe,candle_open_at:opening});
        if(error)throw Error('Request could not be queued. Check the account bridge is enabled and fewer than ten requests are pending.');
        if(!live(id,e))return;tell('Queued. The MT5 companion must be running on this account.');await load();
      }catch(error){if(live(id,e))tell(error.message,true)}finally{if(live(id,e)){busy=false;update()}}
    }
    async function save(){
      if(busy||!accountId)return;
      capture();const id=userId,e=epoch;busy=true;update();tell('Saving original observations…');
      try{
        for(const prefix of ['mt5','tv'])if(F.fields.some(f=>draft[prefix+'_'+f]!==''&&!bar(prefix)))throw Error('Check the OHLC values: High must be highest and Low must be lowest; all four prices are required.');
        const timestamp=new Date().toISOString();
        const {data,error}=await getClient().from('market_feed_comparisons').insert({user_id:id,account_id:accountId,trade_id:tradeId||null,instrument_key:instrument,mt5_symbol:symbol(),tv_symbol:draft.tv_symbol,timeframe,candle_open_at:opening,broker_candle_id:selected?.id||null,mt5_ohlc:selected?.ohlc||bar('mt5'),mt5_retrieved_at:selected?.retrieved_at||(draft.mt5_observed?iso(draft.mt5_observed):timestamp),tv_ohlc:bar('tv'),tv_timeframe:draft.tv_timeframe,tv_candle_open_at:draft.tv_opening?iso(draft.tv_opening):null,tv_observed_at:draft.tv_observed?iso(draft.tv_observed):timestamp,tv_identity_confirmed:!!draft.confirmed,notes:draft.notes||''}).select('status').single();
        if(error)throw Error('Comparison could not be saved. Check the linked trade, prices and timestamps; your observations are still here.');
        if(!live(id,e))return;historyPage=0;tell('Saved · '+data.status+'. Execution prices and scores are preserved.');await load();
      }catch(error){if(live(id,e))tell(error.message,true)}finally{if(live(id,e)){busy=false;update()}}
    }
    function clearObserved(){
      for(const f of F.fields){draft['mt5_'+f]='';draft['tv_'+f]=''}
      draft.mt5_observed='';draft.tv_observed='';draft.confirmed=false;draft.tv_symbol=F.markets.find(m=>m.key===instrument).tv;draft.tv_timeframe=timeframe;draft.tv_opening=utcInput(opening);selected=null;
    }
    panel.addEventListener('input',event=>{if(event.target.matches('[data-market-field]')){capture();update()}});
    panel.addEventListener('change',event=>{
      const field=event.target.dataset.marketField;if(!field)return;capture();
      if(['account','instrument','symbol','timeframe','opening','trade','mode'].includes(field)){
        epoch++;loading=false;refreshQueued=false;busy=false;
        if(field==='account'){accountId=draft.account;symbols=[];trades=[];candles=[];requests=[];history=[];tradeId='';draft.symbol='';historyPage=0;}
        if(field==='instrument'){instrument=draft.instrument;draft.symbol='';tradeId='';}
        if(field==='symbol')tradeId='';
        if(field==='timeframe')timeframe=draft.timeframe;
        if(field==='opening'){try{opening=iso(draft.opening)}catch{tell('Enter a valid UTC candle opening.',true);return}}
        if(field==='trade'){tradeId=draft.trade;historyPage=0;}
        if(field==='mode')mode=draft.mode;
        if(field!=='trade')clearObserved();
        render();load();
      }else update();
    });
    panel.addEventListener('click',event=>{
      const action=event.target.closest('[data-market-action]')?.dataset.marketAction;if(!action)return;
      if(action==='request')request();if(action==='save')save();
      if(action==='history-prev'||action==='history-next'){historyPage+=action==='history-next'?1:-1;load();}
      if(action==='latest'||action==='at-entry'){
        capture();const entry=trades.find(t=>t.id===tradeId)?.opened_at;
        const value=action==='at-entry'?Date.parse(entry):Date.now();if(!Number.isFinite(value))return;
        opening=F.lastClosedOpening(timeframe,value);epoch++;loading=false;clearObserved();render();load();
      }
    });
    const api={
      mount(parent){
        const id=getUser()?.id;if(!id)return;
        if(userId!==id){api.reset();userId=id;accountId=getSelectedAccount()?.platform==='MT5'?getSelectedAccount().id:getAccounts().find(a=>a.platform==='MT5')?.id||'';render();}
        shown=true;parent.appendChild(panel);load();schedule();
      },
      hide(){capture();shown=false;clearTimeout(timer);panel.remove();epoch++;loading=false;refreshQueued=false;busy=false;},
      reset(){api.hide();userId=null;accountId='';instrument='v75_1s';timeframe='H1';opening=F.lastClosedOpening(timeframe);tradeId='';mode='mt5_bridge';symbols=[];trades=[];candles=[];requests=[];history=[];draft={};selected=null;historyPage=0;panel.replaceChildren();},
      openTrade(trade){
        if(!trade||trade.user_id!==getUser()?.id||trade.source!=='mt5'||!F.marketForSymbol(trade.instrument))return false;
        accountId=trade.account_id;instrument=F.marketForSymbol(trade.instrument).key;tradeId=trade.id;draft.symbol=trade.instrument;
        epoch++;loading=false;historyPage=0;symbols=[];trades=[trade];candles=[];history=[];
        if(Number.isFinite(Date.parse(trade.opened_at)))opening=F.lastClosedOpening(timeframe,Date.parse(trade.opened_at));
        clearObserved();render();panel.open=true;load();panel.scrollIntoView({block:'start'});return true;
      }
    };
    return api;
  }};
})();
