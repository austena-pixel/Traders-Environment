(function(){
  'use strict';
  const P=window.TIOSChartPreferences,TABLE='chart_workspace_preferences';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  window.TIOSCharts={create({host,getClient,getUser,getAccounts,getSelectedAccount,getNumber,loadPublicTicks=async()=>{
    if(!window.TIOSDerivPublicTicks)await import('./core/deriv-public-ticks.js');
    return window.TIOSDerivPublicTicks;
  }}){
    let visible=false,userId=null,prefs=null,loaded=false,loading=false,saving=false;
    let revision=null,saved=null,generation=0,expanded=null,focusBeforeExpand=null,previousOverflow='';
    let controlsCollapsed=window.matchMedia('(max-width: 860px)').matches;
    const instances=new Map();
    const verification=window.TIOSMarketVerification.create({getClient,getUser,getAccounts,getSelectedAccount,getNumber});
    let pendingEvidenceTrade=null;
    let quoteFeed=null,quoteState=null,quoteShown=false,quoteLoading=false,quoteMarket='v75_1s',quoteMarketChosen=false,quoteLoadEpoch=0,quoteRetryTimer=null;
    const quoteActive=()=>quoteLoading||['connecting','catalogue','awaiting_ticks','streaming','stale'].includes(quoteState?.status);
    const canQuote=()=>visible&&loaded&&getUser()?.id===userId&&!document.hidden&&!expanded;
    function renderPublicQuote(){
      if(quoteRetryTimer!==null){clearTimeout(quoteRetryTimer);quoteRetryTimer=null;}
      const panel=host.querySelector('[data-charts-public-quote]');if(!panel)return;
      panel.hidden=!quoteShown;
      const remaining=Math.max(0,Math.ceil(((quoteState?.retryAt||0)-Date.now())/1000));
      host.querySelectorAll('[data-charts-action="start-public-quote"]').forEach(button=>button.disabled=!canQuote()||quoteActive()||remaining>0);
      const select=panel.querySelector('[data-charts-public-market]');select.value=quoteMarket;select.disabled=quoteActive();
      panel.querySelector('[data-charts-action="stop-public-quote"]').disabled=!quoteActive();
      const last=quoteState?.lastTick;
      panel.querySelector('[data-charts-public-value]').textContent=last?String(last.quote):'—';
      panel.querySelector('[data-charts-public-identity]').textContent=quoteState?.market?quoteState.market.label+(quoteState.apiSymbol?' / '+quoteState.apiSymbol:''):'';
      const live=quoteState?.status==='streaming';
      panel.querySelector('[data-charts-public-price-state]').textContent=last?(live?'Receiving ticks':'Retained observation · not live'):'No tick observed';
      panel.querySelector('[data-charts-public-status]').textContent=quoteLoading?'Loading the read-only public feed…':(quoteState?.message||'Press Start to receive actual public Deriv ticks.')+(remaining?' Retry available in '+remaining+' s.':'');
      panel.querySelector('[data-charts-public-time]').textContent=last?'Source: '+new Date(last.epoch*1000).toISOString()+' · browser arrival: '+last.receivedAt+(quoteState.lastGapMs!==null?' · arrival interval: '+(quoteState.lastGapMs/1000).toFixed(3)+' s':''):'';
      if(remaining&&quoteShown&&canQuote())quoteRetryTimer=setTimeout(renderPublicQuote,1000);
    }
    function stopPublicQuote(message='Public quote stopped. Any retained price is no longer live.',clear=false){
      quoteLoadEpoch++;quoteLoading=false;
      quoteFeed?.stop(message,clear);
      quoteState=quoteFeed?quoteFeed.snapshot():{status:'stopped',message,retryAt:quoteState?.retryAt||0};
      renderPublicQuote();
    }
    async function startPublicQuote(){
      if(!canQuote()||quoteActive())return;
      if(!quoteMarketChosen){const configured=P.derivBySymbol(activeCharts()[0]?.symbol);if(configured)quoteMarket=configured.preferred?'v75_1s':'v75';quoteMarketChosen=true;}
      quoteShown=true;quoteLoading=true;
      const id=userId,epoch=generation,attempt=++quoteLoadEpoch;renderPublicQuote();
      try{
        const ticks=await loadPublicTicks();
        if(attempt!==quoteLoadEpoch)return;
        if(!alive(id,epoch)||!canQuote()||!quoteShown){stopPublicQuote('Session or visibility changed. Press Start to reconnect.',true);return;}
        if(typeof ticks?.create!=='function')throw Error('Unavailable public feed module');
        if(!quoteFeed)quoteFeed=ticks.create({onChange:state=>{
          if(!alive(id,epoch)){
            // Dispose without publishing another callback into this expired session.
            quoteFeed?.dispose();quoteFeed=null;quoteLoadEpoch++;quoteLoading=false;quoteShown=false;quoteState=null;renderPublicQuote();return;
          }
          quoteState=state;renderPublicQuote();
        }});
        quoteLoading=false;quoteFeed.connect(quoteMarket);quoteState=quoteFeed.snapshot();renderPublicQuote();
      }catch(_){
        if(attempt!==quoteLoadEpoch)return;
        if(!alive(id,epoch)){stopPublicQuote('Session changed. Start again after signing in.',true);return;}
        quoteLoading=false;quoteState={status:'error',message:'The public feed module could not be loaded. Retry when your connection is available.',retryAt:quoteState?.retryAt||0};renderPublicQuote();
      }
    }
    const alive=(id,epoch)=>userId===id&&generation===epoch&&getUser()?.id===id;
    const activeCharts=()=>prefs.charts[prefs.layout];
    const dirty=()=>prefs&&JSON.stringify(prefs)!==saved;
    function status(message,error=false){
      const node=host.querySelector('[data-charts-status]');
      if(node){node.textContent=message;node.classList.toggle('charts-status-error',error)}
    }
    function updateSave(){
      const button=host.querySelector('[data-charts-action="save"]');
      if(button){button.disabled=!loaded||saving||!dirty();button.textContent=saving?'Saving…':'Save preferences'}
    }
    function changed(){
      updateSave();status(dirty()?'Unsaved preferences':revision?'Preferences saved':'Default layout · save your preferences');
    }
    function capture(){
      if(!prefs)return;
      host.querySelectorAll('[data-charts-setup-id]').forEach(panel=>{
        const chart=activeCharts().find(item=>item.id===panel.dataset.chartsSetupId);
        if(!chart)return;
        chart.symbol=panel.querySelector('[data-chart-field="symbol"]').value.trim().toUpperCase();
        chart.interval=panel.querySelector('[data-chart-field="interval"]').value;
        chart.responsibility=panel.querySelector('[data-chart-field="responsibility"]').value;
      });
    }
    function syncDerivHint(panel){
      if(!panel)return;
      const input=panel.querySelector('[data-chart-field="symbol"]');
      const hint=panel.querySelector('[data-deriv-mapping]');
      const select=panel.querySelector('[data-deriv-preset]');
      if(!input||!hint||!select)return;
      const mapping=P.derivBySymbol(input.value);
      select.value=mapping?.symbol||'';
      hint.textContent=mapping?'MT5: '+mapping.mt5Symbol+' (name mapping only; price data not verified)':'Manual symbol — no automatic Deriv MT5 mapping';
    }
    function applyPreferredDeriv(){
      if(!loaded||saving)return;
      capture();
      for(const mode of ['single','multiple']){
        for(const chart of prefs.charts[mode])chart.symbol=P.preferredDerivSymbol;
      }
      host.querySelectorAll('[data-charts-setup-id]').forEach(panel=>{
        panel.querySelector('[data-chart-field="symbol"]').value=P.preferredDerivSymbol;syncDerivHint(panel);
      });
      changed();refreshWidgets();
      status('Volatility 75 (1s) selected for both layouts. Save preferences to make it your default.');
    }
    function cardForControl(target){
      const panel=target.closest('[data-charts-setup-id]');
      return [...host.querySelectorAll('.charts-grid [data-chart-id]')]
        .find(card=>card.dataset.chartId===panel?.dataset.chartsSetupId);
    }
    function relocateControls(card,index){
      const form=card.querySelector('.charts-controls');
      if(!form)return;
      const chart=activeCharts().find(item=>item.id===card.dataset.chartId);
      const panel=document.createElement('details');
      panel.className='charts-setup';
      panel.dataset.chartsSetupId=card.dataset.chartId;
      panel.open=prefs.layout==='single'||index===0;
      const title=document.createElement('summary');
      const label=document.createElement('strong');
      label.textContent='Chart '+(index+1);
      const description=document.createElement('span');
      description.className='charts-setup-caption';
      description.textContent=chart?.responsibility||'Configure chart';
      title.append(label,description);
      const instrument=form.querySelector('.charts-symbol');
      const preset=document.createElement('label');
      preset.className='charts-deriv-picker';
      preset.textContent='Deriv synthetic indices';
      const select=document.createElement('select');
      select.dataset.derivPreset='';
      select.setAttribute('aria-label','Chart '+(index+1)+' Deriv synthetic index');
      const manual=document.createElement('option');manual.value='';manual.textContent='Manual instrument';
      select.append(manual,...P.derivSymbols.map(item=>{
        const option=document.createElement('option');option.value=item.symbol;option.textContent=item.label;return option;
      }));
      preset.appendChild(select);
      instrument.before(preset);
      const hint=document.createElement('div');
      hint.className='charts-deriv-mapping';
      hint.dataset.derivMapping='';
      hint.setAttribute('aria-live','polite');
      form.appendChild(hint);
      panel.append(title,form);
      syncDerivHint(panel);
      host.querySelector('.charts-panel-settings').appendChild(panel);
    }
    function toggleControls(){
      controlsCollapsed=!controlsCollapsed;
      const workspace=host.querySelector('.charts-workbench');
      if(!workspace)return;
      workspace.classList.toggle('charts-panel-collapsed',controlsCollapsed);
      const panel=workspace.querySelector('.charts-panel');
      panel.inert=controlsCollapsed;
      panel.setAttribute('aria-hidden',String(controlsCollapsed));
      verification.setControlsVisible(!controlsCollapsed);
      workspace.querySelectorAll('[data-charts-action="toggle-panel"]').forEach(btn=>{
        btn.setAttribute('aria-expanded',String(!controlsCollapsed));
        if(btn.classList.contains('charts-reveal-controls')){
          btn.hidden=!controlsCollapsed;
          btn.textContent='Show controls';
        }else btn.textContent='Hide controls';
      });
    }
    function removeInstance(id){
      const instance=instances.get(id);
      if(instance){instance.frame.remove();instances.delete(id)}
    }
    function dispose(){for(const id of [...instances.keys()])removeInstance(id)}
    function closeExpanded(restoreFocus=true){
      if(!expanded)return;
      expanded.classList.remove('charts-card-expanded');expanded.removeAttribute('role');expanded.removeAttribute('aria-modal');
      expanded.querySelector('[data-charts-action="expand"]').textContent='Expand';
      expanded.querySelector('[data-charts-action="expand"]').setAttribute('aria-expanded','false');
      host.querySelector('.charts-backdrop')?.remove();
      host.querySelectorAll('.charts-grid [data-chart-id],.charts-panel,.charts-head,.charts-view-head').forEach(node=>node.inert=false);
      const panel=host.querySelector('.charts-panel');
      if(panel)panel.inert=controlsCollapsed;
      verification.setControlsVisible(!controlsCollapsed);
      document.body.style.overflow=previousOverflow;
      expanded=null;
      renderPublicQuote();
      if(restoreFocus&&focusBeforeExpand?.isConnected)focusBeforeExpand.focus();
      focusBeforeExpand=null;
    }
    function expand(card){
      if(expanded===card){closeExpanded();return}
      closeExpanded(false);focusBeforeExpand=document.activeElement;previousOverflow=document.body.style.overflow;
      const backdrop=document.createElement('div');backdrop.className='charts-backdrop';
      backdrop.addEventListener('click',()=>closeExpanded());host.appendChild(backdrop);
      expanded=card;card.classList.add('charts-card-expanded');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
      if(quoteActive())stopPublicQuote('Paused while the chart is expanded. Press Start after returning to the layout.');
      else renderPublicQuote();
      host.querySelectorAll('.charts-grid [data-chart-id],.charts-panel,.charts-head,.charts-view-head').forEach(node=>{if(node!==card)node.inert=true});
      verification.setControlsVisible(false);
      document.body.style.overflow='hidden';
      const button=card.querySelector('[data-charts-action="expand"]');button.textContent='Return to layout';button.setAttribute('aria-expanded','true');button.focus();
    }
    function cardMessage(card,message,retry=false){
      const node=card.querySelector('.charts-widget-status');node.hidden=!message;
      node.replaceChildren(document.createTextNode(message));
      if(retry){
        for(const [action,label] of [['retry-chart','Retry'],['dismiss-status','Dismiss']]){
          const button=document.createElement('button');button.type='button';button.className='btn small';button.dataset.chartsAction=action;button.textContent=label;node.appendChild(button);
        }
      }
    }
    function mountChart(card,force=false){
      const chart=activeCharts().find(item=>item.id===card.dataset.chartId);
      if(!chart)return;
      const check=P.defaults();check.charts.single=[chart];
      const error=P.validate(check);
      if(error){removeInstance(chart.id);cardMessage(card,error);return}
      const key=JSON.stringify([chart.symbol,chart.interval,prefs.theme,prefs.timezone]);
      if(!force&&instances.get(chart.id)?.key===key)return;
      removeInstance(chart.id);
      cardMessage(card,'Loading TradingView…');
      const frame=document.createElement('iframe'),instance=crypto.randomUUID();
      frame.title='Chart '+(activeCharts().indexOf(chart)+1)+' · '+chart.symbol;
      frame.className='charts-frame';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;
      const address=new URL('tradingview-chart.html',location.href);
      // Only widget settings enter the host URL. Private responsibility labels and
      // user identity stay in T-IOS/Supabase and are never sent to TradingView.
      address.hash=encodeURIComponent(JSON.stringify({chart:{id:'widget',symbol:chart.symbol,interval:chart.interval,responsibility:''},theme:prefs.theme,timezone:prefs.timezone,instance}));
      frame.src=address.href;
      instances.set(chart.id,{frame,instance,key,card});
      card.querySelector('.charts-widget').appendChild(frame);
    }
    function resetChart(card){
      const chart=activeCharts().find(item=>item.id===card?.dataset.chartId);
      if(!chart)return;
      const stored=saved?JSON.parse(saved).charts[prefs.layout].find(item=>item.id===chart.id):null;
      if(stored){chart.symbol=stored.symbol;chart.interval=stored.interval;}
      const panel=[...host.querySelectorAll('[data-charts-setup-id]')].find(p=>p.dataset.chartsSetupId===chart.id);
      if(panel){panel.querySelector('[data-chart-field="symbol"]').value=chart.symbol;panel.querySelector('[data-chart-field="interval"]').value=chart.interval;syncDerivHint(panel);}
      mountChart(card,true);changed();
    }
    function refreshWidgets(){host.querySelectorAll('[data-chart-id]').forEach(card=>mountChart(card))}
    function cardMarkup(chart,index){return `<section class="charts-card" data-chart-id="${escape(chart.id)}" aria-label="Chart ${index+1}">
            <div class="charts-card-top"><strong>Chart ${index+1}</strong><div class="charts-card-actions">
              ${index===0?`<button class="btn small charts-reveal-controls" type="button" data-charts-action="toggle-panel" aria-controls="chartsPanel" aria-expanded="${!controlsCollapsed}" ${controlsCollapsed?'':'hidden'}>Show controls</button><a class="btn small charts-tv-link" href="https://www.tradingview.com/chart/" target="_blank" rel="noopener">Open TradingView ↗</a>`:''}
              <button class="btn small" type="button" data-charts-action="reset-chart" title="Reload this chart to its saved instrument, or the configured instrument if no saved chart exists">Reset instrument</button><button class="btn small" type="button" data-charts-action="expand" aria-expanded="false">Expand</button></div></div>
            <form class="charts-controls">
              <label class="charts-symbol">Instrument<input data-chart-field="symbol" aria-label="Chart ${index+1} instrument" value="${escape(chart.symbol)}" maxlength="81" placeholder="FX:EURUSD" list="charts-symbols" required spellcheck="false" autocomplete="off"></label>
              <label>Timeframe<select data-chart-field="interval" aria-label="Chart ${index+1} timeframe">${P.intervals.map(([value,label])=>`<option value="${value}" ${chart.interval===value?'selected':''}>${label}</option>`).join('')}</select></label>
              <button class="btn small charts-apply" type="submit" title="Apply instrument and timeframe to this chart">Apply</button>
              <label class="charts-responsibility">Responsibility <input data-chart-field="responsibility" aria-label="Chart ${index+1} responsibility" value="${escape(chart.responsibility)}" maxlength="120" placeholder="What do you analyse here?"></label>
            </form>
            <div class="charts-widget-status" role="status" aria-live="polite" hidden></div>
            <div class="charts-widget"></div>
          </section>`}
    // Resize only affected cards, retaining existing TradingView frames and drawings.
    function resizeMultiple(count){
      if(!prefs||prefs.layout!=='multiple'||!Number.isInteger(count)||count<2||count>6)return;
      capture();
      const list=prefs.charts.multiple,old=list.length;
      if(count===old)return;
      if(count<old&&!window.confirm('Remove '+(old-count)+' chart(s) from this layout? Their individual settings will be removed when you save preferences.')){
        const control=host.querySelector('[data-charts-count]');if(control)control.value=String(old);
        return;
      }
      const grid=host.querySelector('.charts-grid');if(!grid)return;
      if(count<old){
        for(let i=old-1;i>=count;i--){
          const chart=list.pop();
          removeInstance(chart.id);
          [...grid.querySelectorAll('[data-chart-id]')].find(card=>card.dataset.chartId===chart.id)?.remove();
          [...host.querySelectorAll('[data-charts-setup-id]')].find(panel=>panel.dataset.chartsSetupId===chart.id)?.remove();
        }
      }else{
        for(let i=old;i<count;i++){
          const reference=list.at(-1);
          let id;
          do{id='extra-'+crypto.randomUUID().slice(0,12)}while(list.some(chart=>chart.id===id));
          const chart={id,symbol:reference?.symbol||'FX:EURUSD',interval:reference?.interval||'60',responsibility:''};
          list.push(chart);
          grid.insertAdjacentHTML('beforeend',cardMarkup(chart,i));
          relocateControls(grid.lastElementChild,i);
          mountChart(grid.lastElementChild);
        }
      }
      grid.dataset.chartCount=String(count);
      grid.style.setProperty('--chart-count',String(count));
      const badge=host.querySelector('[data-charts-layout="multiple"] span');if(badge)badge.textContent=String(count);
      changed();
    }
    function render(){
      if(!visible||!prefs)return;
      closeExpanded(false);dispose();
      host.innerHTML=`
        <div class="charts-workbench ${controlsCollapsed?'charts-panel-collapsed':''}">
          <aside class="charts-panel" id="chartsPanel" aria-label="Charts workspace controls" aria-hidden="${controlsCollapsed}">
            <div class="charts-panel-head"><strong>Charts</strong><button class="btn small charts-panel-dismiss" type="button" data-charts-action="toggle-panel" aria-controls="chartsPanel" aria-expanded="${!controlsCollapsed}">Hide controls</button></div>
            <div class="charts-panel-scroll">
              <div class="charts-toolbar">
          <div class="charts-section-title">Layout</div>
          <div class="charts-layout" role="group" aria-label="Chart layout">
            <button type="button" data-charts-layout="single" aria-pressed="${prefs.layout==='single'}">Single Chart</button>
            <button type="button" data-charts-layout="multiple" aria-pressed="${prefs.layout==='multiple'}">Multiple Charts <span>${prefs.charts.multiple.length}</span></button>
          </div>
          ${prefs.layout==='multiple'?`<label class="charts-setting charts-count-setting">Number of charts<select data-charts-count aria-label="Number of simultaneous charts">${[2,3,4,5,6].map(n=>`<option value="${n}" ${prefs.charts.multiple.length===n?'selected':''}>${n} charts</option>`).join('')}</select></label>`:''}
          <div class="charts-section-title">Appearance</div>
          <label class="charts-setting">Chart theme<select data-charts-setting="theme"><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option></select></label>
          <label class="charts-setting">Timezone<select data-charts-setting="timezone">${P.timezones.map(([value,label])=>`<option value="${value}" ${prefs.timezone===value?'selected':''}>${label}</option>`).join('')}</select></label>
          <div class="charts-section-title">Deriv preferences</div>
          <button class="btn small charts-deriv-default" type="button" data-charts-action="prefer-deriv">Use V75 (1s) as my default</button>
          <p class="charts-deriv-note">Sets the instrument for all charts in both layouts. Your timeframe and responsibility settings remain unchanged. Save preferences to persist.</p>
          <a class="btn small charts-deriv-default" href="deriv-feed-check.html" target="_blank" rel="noopener noreferrer" data-charts-feed-test aria-describedby="charts-feed-test-note">Open Deriv feed test ↗</a>
          <p id="charts-feed-test-note" class="charts-deriv-note">Read-only connection test. On the test page, press Connect public feed. Public prices remain unverified against MT5.</p>
          <button class="btn small charts-deriv-default" type="button" data-charts-action="start-public-quote">Start live Deriv quote</button>
          <p class="charts-deriv-note">Shows a separate public spot quote above your chart. TradingView controls its own candle updates. MT5 price parity remains unverified.</p>
          <div class="charts-section-title">Chart setup</div>
          <div class="charts-panel-settings"></div>
          <div class="charts-section-title">Preferences</div>
          <div class="charts-save"><button type="button" class="btn primary" data-charts-action="save">Save preferences</button><span data-charts-status role="status" aria-live="polite"></span><button type="button" class="btn small" data-charts-action="reload" hidden>Reload saved preferences</button></div>
          <p class="charts-help">Save defaults with these controls. Changes inside TradingView stay in this chart session. Market data availability and delays depend on the instrument.</p>
              </div>
            </div>
          </aside>
          <div class="charts-view">
            <section class="charts-view-head charts-public-quote" data-charts-public-quote aria-label="Separate Deriv public quote" hidden>
              <div class="charts-public-value"><strong>Deriv public quote</strong><output data-charts-public-value aria-label="Last observed public Deriv quote" aria-live="off">—</output><span data-charts-public-price-state>No tick observed</span><span data-charts-public-identity></span></div>
              <label class="charts-public-market">Public market<select data-charts-public-market><option value="v75_1s">Volatility 75 (1s) Index</option><option value="v75">Volatility 75 Index</option></select></label>
              <button class="btn small" type="button" data-charts-action="start-public-quote">Start</button><button class="btn small" type="button" data-charts-action="stop-public-quote" disabled>Stop</button><button class="btn small" type="button" data-charts-action="hide-public-quote" aria-label="Hide public quote">Hide</button>
              <p class="charts-public-note">Separate public spot price · MT5 / TradingView parity unverified. The TradingView toolbar may display another market. Arrival intervals are not network latency.</p>
              <p class="charts-public-note" data-charts-public-status role="status" aria-live="polite"></p><p class="charts-public-note" data-charts-public-time></p>
            </section>
            <div class="charts-grid" data-charts-mode="${prefs.layout}" data-chart-count="${activeCharts().length}" style="--chart-count:${activeCharts().length}">
          ${activeCharts().map(cardMarkup).join('')}
        </div>
          </div>
        </div>
        <datalist id="charts-symbols"><option value="FX:EURUSD"><option value="FX:GBPUSD"><option value="OANDA:XAUUSD"><option value="NASDAQ:AAPL"><option value="BINANCE:BTCUSDT"></datalist>`;
      host.querySelectorAll('.charts-grid [data-chart-id]').forEach((card,index)=>relocateControls(card,index));
      host.querySelector('.charts-panel').inert=controlsCollapsed;
      changed();refreshWidgets();
      renderPublicQuote();
      verification.setControlsVisible(!controlsCollapsed);
      verification.mount(host.querySelector('.charts-toolbar'));
      if(pendingEvidenceTrade){if(controlsCollapsed)toggleControls();verification.openTrade(pendingEvidenceTrade);pendingEvidenceTrade=null;}
    }
    async function load(){
      if(loading)return;
      const id=userId,epoch=generation;loading=true;loaded=false;
      if(visible)host.innerHTML='<div class="charts-empty" role="status">Loading your chart preferences…</div>';
      try{
        const {data,error}=await getClient().from(TABLE).select('configuration,revision,schema_version').eq('user_id',id).maybeSingle();
        if(!alive(id,epoch))return;
        if(error)throw Error('Your saved preferences could not be loaded. Retry before making changes.');
        if(data&&(data.schema_version!==1||P.validate(data.configuration)))throw Error('Your saved chart preferences use an unsupported format. They have been preserved.');
        prefs=data?P.clone(data.configuration):P.defaults();revision=data?.revision??null;saved=data?JSON.stringify(prefs):null;loaded=true;
        render();
      }catch(error){
        if(alive(id,epoch)&&visible){host.innerHTML='<div class="charts-empty"><p role="alert"></p><button type="button" class="btn" data-charts-action="reload">Retry loading preferences</button></div>';host.querySelector('p').textContent=error.message}
      }finally{if(alive(id,epoch))loading=false}
    }
    async function save(){
      if(!loaded||saving||!getClient()||getUser()?.id!==userId)return;
      capture();const validation=P.validate(prefs);
      if(validation){status(validation,true);updateSave();return}
      refreshWidgets();const snapshot=P.clone(prefs),serialized=JSON.stringify(snapshot),id=userId,epoch=generation;
      saving=true;updateSave();status('Saving preferences…');
      try{
        const query=revision===null
          ?getClient().from(TABLE).insert({user_id:id,configuration:snapshot})
          :getClient().from(TABLE).update({configuration:snapshot}).eq('user_id',id).eq('revision',revision);
        const {data,error}=await query.select('revision').maybeSingle();
        if(!alive(id,epoch))return;
        if(error?.code==='23505'||(!error&&!data)){
          status('Preferences changed on another device. Reload saved preferences before saving.',true);
          const reload=host.querySelector('[data-charts-action="reload"]');if(reload)reload.hidden=false;return;
        }
        if(error)throw Error('Preferences could not be saved. Your changes are still here; try again.');
        revision=data.revision;saved=serialized;changed();
        const reload=host.querySelector('[data-charts-action="reload"]');if(reload)reload.hidden=true;
      }catch(error){if(alive(id,epoch))status(error.message,true)}
      finally{if(alive(id,epoch)){saving=false;updateSave()}}
    }
    host.addEventListener('submit',event=>{
      if(!event.target.matches('.charts-controls'))return;
      event.preventDefault();capture();mountChart(cardForControl(event.target));changed();
    });
    host.addEventListener('input',event=>{
      if(!event.target.matches('[data-chart-field]'))return;
      capture();changed();
      if(event.target.dataset.chartField==='symbol')syncDerivHint(event.target.closest('[data-charts-setup-id]'));
      const card=cardForControl(event.target);
      if(event.target.dataset.chartField==='responsibility'){
        const summary=event.target.closest('[data-charts-setup-id]')?.querySelector('.charts-setup-caption');
        if(summary)summary.textContent=event.target.value||'Configure chart';
        if(expanded===card)card.setAttribute('aria-label','Chart · '+event.target.value);
      }
    });
    host.addEventListener('change',event=>{
      if(event.target.matches('[data-charts-public-market]')){
        if(quoteActive())return;
        quoteMarket=event.target.value;quoteMarketChosen=true;stopPublicQuote('Public market selection changed. Press Start to receive this separate instrument.',true);return;
      }
      if(event.target.matches('[data-deriv-preset]')){
        if(!event.target.value)return;
        const panel=event.target.closest('[data-charts-setup-id]');
        panel.querySelector('[data-chart-field="symbol"]').value=event.target.value;
        capture();syncDerivHint(panel);changed();
        mountChart(cardForControl(event.target));
        return;
      }
      if(event.target.matches('[data-charts-count]')){resizeMultiple(Number(event.target.value));return}
      if(event.target.matches('[data-charts-setting]')){
        prefs[event.target.dataset.chartsSetting]=event.target.value;changed();refreshWidgets();
      }else if(event.target.matches('[data-chart-field="interval"]')){
        capture();changed();mountChart(cardForControl(event.target));
      }
    });
    host.addEventListener('click',event=>{
      const layout=event.target.closest('[data-charts-layout]');
      if(layout){if(layout.dataset.chartsLayout!==prefs.layout){capture();prefs.layout=layout.dataset.chartsLayout;render()}return}
      const button=event.target.closest('[data-charts-action]');if(!button)return;
      const action=button.dataset.chartsAction;
      if(action==='toggle-panel')toggleControls();
      if(action==='prefer-deriv')applyPreferredDeriv();
      if(action==='start-public-quote')startPublicQuote();
      if(action==='stop-public-quote')stopPublicQuote();
      if(action==='hide-public-quote'){quoteShown=false;stopPublicQuote();}
      if(action==='save')save();
      if(action==='expand')expand(button.closest('[data-chart-id]'));
      if(action==='reset-chart')resetChart(button.closest('[data-chart-id]'));
      if(action==='retry-chart')mountChart(button.closest('[data-chart-id]'),true);
      if(action==='dismiss-status')cardMessage(button.closest('[data-chart-id]'),'');
      if(action==='reload'&&!saving){if(quoteActive())stopPublicQuote('Paused while chart preferences reload. Press Start when they are loaded.');closeExpanded(false);dispose();load()}
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden&&quoteActive())stopPublicQuote('Paused while T-IOS was in the background. Press Start to reconnect.');
      renderPublicQuote();
    });
    window.addEventListener('pagehide',()=>{
      stopPublicQuote('Page left. Press Start to reconnect.');
      if(quoteRetryTimer!==null){clearTimeout(quoteRetryTimer);quoteRetryTimer=null;}
    });
    window.addEventListener('pageshow',renderPublicQuote);
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin||event.data?.type!=='tios:chart-widget-state')return;
      const item=[...instances.values()].find(item=>item.instance===event.data.instance&&item.frame.contentWindow===event.source);
      if(!item)return;
      if(event.data.state==='loaded')cardMessage(item.card,'');
      else if(['slow','error'].includes(event.data.state))cardMessage(item.card,event.data.state==='slow'?'If the chart stays blank, check your connection or retry.':'TradingView could not be loaded. Check your connection.',true);
    });
    document.addEventListener('keydown',event=>{
      if(expanded&&event.key==='Escape'){event.preventDefault();closeExpanded()}
      if(expanded&&event.key==='Tab'){
        const nodes=[...expanded.querySelectorAll('button,input,select,iframe')].filter(node=>!node.disabled);
        const first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    });
    const api={
      show(){
        const id=getUser()?.id;if(!id)return;
        if(userId!==id){api.reset();userId=id}
        if(visible)return;visible=true;
        if(loaded)render();
        else if(loading)host.innerHTML='<div class="charts-empty" role="status">Loading your chart preferences…</div>';
        else load();
      },
      openTrade(trade){
        if(!loaded){pendingEvidenceTrade=trade;return;}
        if(controlsCollapsed)toggleControls();
        verification.openTrade(trade);
      },
      hide(){capture();verification.hide();visible=false;stopPublicQuote('Paused while Charts is closed. Press Start to reconnect.');closeExpanded(false);dispose();host.replaceChildren()},
      reset(){api.hide();quoteFeed?.dispose();quoteFeed=null;quoteState=null;quoteShown=false;quoteMarket='v75_1s';quoteMarketChosen=false;verification.reset();pendingEvidenceTrade=null;generation++;userId=null;prefs=null;loaded=false;loading=false;saving=false;revision=null;saved=null}
    };
    return api;
  }};
})();
