(function(){
  'use strict';
  const P=window.TIOSChartPreferences,TABLE='chart_workspace_preferences',PROFILE_TABLE='chart_workspace_profiles';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  window.TIOSCharts={create({host,getClient,getUser,getAccounts,getSelectedAccount,getNumber,loadPublicTicks=async()=>{
    if(!window.TIOSDerivPublicTicks)await import('./core/deriv-public-ticks.js');
    return window.TIOSDerivPublicTicks;
  },loadInstruments=async()=>{
    if(!window.TIOSChartInstruments)await import('./core/chart-instruments.js');
    return window.TIOSChartInstruments;
  }}){
    let visible=false,userId=null,prefs=null,loaded=false,loading=false,saving=false;
    let revision=null,saved=null,generation=0,expanded=null,focusBeforeExpand=null,previousOverflow='';
    let markets=P.defaultMarkets();
    let layoutSaveQueued=false;
    let controlsCollapsed=window.matchMedia('(max-width: 860px)').matches;
    const instances=new Map();
    const verification=window.TIOSMarketVerification.create({getClient,getUser,getAccounts,getSelectedAccount,getNumber});
    let pendingEvidenceTrade=null;
    let sidebarMode='settings',instrumentWorkspace=null,instrumentLoadEpoch=0,marketTargetChartId='';
    let chartProfile=null,accountStep='entry',accountBusy=false,accountError='';
    let firstRunLayout='single',firstRunSaving=false;
    function renderSidebar(){
      const settings=host.querySelector('.charts-toolbar'),instruments=host.querySelector('[data-charts-instruments]');
      if(!settings||!instruments)return;
      const recording=sidebarMode==='instruments';settings.hidden=recording;instruments.hidden=!recording;
      host.querySelector('[data-charts-sidebar-title]').textContent=recording?'Instruments':'Charts';
      const button=host.querySelector('[data-charts-action="instruments"]');
      button.textContent=recording?'Chart settings':'Instruments';button.setAttribute('aria-pressed',String(recording));
      verification.setControlsVisible(!controlsCollapsed&&!expanded&&!recording);
    }
    async function mountInstruments(){
      const panel=host.querySelector('[data-charts-instruments]');if(!panel)return;
      const id=userId,epoch=generation,attempt=++instrumentLoadEpoch;
      panel.textContent='Loading your instrument recording forms…';
      try{
        if(!instrumentWorkspace){
          const module=await loadInstruments();
          if(attempt!==instrumentLoadEpoch||!alive(id,epoch)||!visible||sidebarMode!=='instruments')return;
          if(typeof module?.create!=='function')throw Error('Unavailable instrument workspace');
          instrumentWorkspace=module.create({getUser});
        }
        if(attempt!==instrumentLoadEpoch||!alive(id,epoch)||!visible||sidebarMode!=='instruments')return;
        instrumentWorkspace.mount(panel);
      }catch(_){
        if(attempt!==instrumentLoadEpoch||!alive(id,epoch)||!visible||sidebarMode!=='instruments')return;
        instrumentWorkspace?.unmount();
        panel.textContent='Instrument forms could not be opened. Your saved records are preserved.';
        const retry=document.createElement('button');retry.type='button';retry.className='btn small';retry.dataset.chartsAction='retry-instruments';retry.textContent='Retry';panel.appendChild(retry);
      }
    }
    function setSidebarMode(mode){
      if(!visible||!loaded||accountStep!=='ready')return;
      instrumentLoadEpoch++;instrumentWorkspace?.unmount();sidebarMode=mode;
      renderSidebar();
      const scroll=host.querySelector('.charts-panel-scroll');if(scroll)scroll.scrollTop=0;
      if(mode==='instruments')mountInstruments();
    }
    let quoteFeed=null,quoteState=null,quoteShown=false,quoteLoading=false,quoteMarket='v75_1s',quoteMarketChosen=false,quoteLoadEpoch=0,quoteRetryTimer=null;
    const quoteActive=()=>quoteLoading||['connecting','catalogue','awaiting_ticks','streaming','stale'].includes(quoteState?.status);
    const canQuote=()=>visible&&loaded&&accountStep==='ready'&&getUser()?.id===userId&&!document.hidden&&!expanded;
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
    function marketStorage(){try{return window.localStorage}catch(_){return null}}
    function loadMarketList(id){markets=P.loadMarkets(marketStorage(),id)}
    function persistMarketList(next){
      try{markets=P.saveMarkets(marketStorage(),userId,next);return true}catch(_){return false}
    }
    function populateMarketSelect(select,symbol=''){
      if(!select)return;
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a saved market';
      select.replaceChildren(placeholder);
      markets.forEach(market=>{const option=document.createElement('option');option.value=market.symbol;option.textContent=market.name;option.title=market.symbol;select.appendChild(option)});
      select.value=markets.some(market=>market.symbol===symbol)?symbol:'';
    }
    function updateMarketSelects(){
      host.querySelectorAll('[data-saved-market]').forEach(select=>{
        const panel=select.closest('[data-charts-setup-id]');
        const symbol=panel?.querySelector('[data-chart-field="symbol"]')?.value.trim().toUpperCase()||'';
        populateMarketSelect(select,symbol);
      });
      host.querySelectorAll('[data-charts-action="remove-saved-market"]').forEach(button=>{
        const panel=button.closest('[data-charts-setup-id]');
        button.disabled=!panel?.querySelector('[data-saved-market]')?.value;
      });
      renderMarketList();
      updateMarketActionButtons();
    }
    function updateMarketActionButtons(){
      host.querySelectorAll('.charts-card[data-chart-id]').forEach(card=>{
        const chart=activeCharts().find(item=>item.id===card.dataset.chartId);
        const symbol=chart?.symbol?.trim().toUpperCase()||'';
        const button=card.querySelector('[data-charts-action="add-market"]');
        if(!button)return;
        const market=P.marketFromSymbol(symbol);
        const exists=Boolean(market&&markets.some(item=>item.symbol===market.symbol));
        button.disabled=!market||exists;
        button.title=exists?'Already saved in your market list':'Add this chart market to your list';
      });
    }
    function renderMarketList(){
      const list=host.querySelector('[data-charts-market-list]');
      if(!list)return;
      const charts=activeCharts();
      if(!charts.some(chart=>chart.id===marketTargetChartId))marketTargetChartId=charts[0]?.id||'';
      const target=charts.find(chart=>chart.id===marketTargetChartId)||charts[0]||null;
      const currentLabel=host.querySelector('[data-market-current]');
      const currentMarket=markets.find(item=>item.symbol===target?.symbol?.trim().toUpperCase());
      if(currentLabel)currentLabel.textContent=currentMarket?.name||'Select a saved market';
      const targetWrap=host.querySelector('[data-market-target-wrap]');
      const targetSelect=host.querySelector('[data-market-target]');
      if(targetWrap)targetWrap.hidden=charts.length<2;
      if(targetSelect){
        targetSelect.replaceChildren();
        charts.forEach((chart,index)=>{
          const option=document.createElement('option');
          option.value=chart.id;
          option.textContent='Chart '+(index+1)+' · '+chart.symbol;
          targetSelect.appendChild(option);
        });
        targetSelect.value=marketTargetChartId;
      }
      list.replaceChildren();
      if(!markets.length){
        const empty=document.createElement('p');
        empty.className='charts-market-list-empty';
        empty.textContent='No saved markets yet. Use Add market at the top of a chart to add one.';
        list.appendChild(empty);
        return;
      }
      markets.forEach(market=>{
        const row=document.createElement('div');
        row.className='charts-market-row';
        row.setAttribute('role','listitem');
        const use=document.createElement('button');
        use.type='button';
        use.className='btn small charts-market-use';
        use.dataset.chartsAction='select-listed-market';
        use.dataset.marketSymbol=market.symbol;
        use.setAttribute('aria-pressed',String(target?.symbol?.trim().toUpperCase()===market.symbol));
        use.title='Use '+market.name+' in '+(target?'Chart '+(charts.indexOf(target)+1):'the selected chart');
        const name=document.createElement('strong');
        name.textContent=market.name;
        const symbol=document.createElement('span');
        symbol.className='charts-market-list-symbol';
        symbol.textContent=market.symbol;
        use.append(name,symbol);
        const remove=document.createElement('button');
        remove.type='button';
        remove.className='btn small charts-market-remove-list';
        remove.dataset.chartsAction='remove-listed-market';
        remove.dataset.marketSymbol=market.symbol;
        remove.textContent='Remove';
        remove.title='Remove '+market.name+' from your saved markets';
        remove.setAttribute('aria-label','Remove '+market.name+' from your saved markets');
        row.append(use,remove);
        list.appendChild(row);
      });
    }
    function applyListedMarket(symbol){
      if(!prefs||!symbol)return;
      const charts=activeCharts();
      const chart=charts.find(item=>item.id===marketTargetChartId)||charts[0];
      if(!chart)return;
      const panel=[...host.querySelectorAll('[data-charts-setup-id]')].find(item=>item.dataset.chartsSetupId===chart.id);
      const field=panel?.querySelector('[data-chart-field="symbol"]');
      if(!field)return;
      marketTargetChartId=chart.id;
      if(field.value.trim().toUpperCase()===symbol){
        const marketDisclosure=host.querySelector('[data-charts-market-disclosure]');
        if(marketDisclosure)marketDisclosure.open=false;
        renderMarketList();
        const market=markets.find(item=>item.symbol===symbol);
        status((market?.name||symbol)+' is already selected for Chart '+(charts.indexOf(chart)+1)+'.');
        return;
      }
      field.value=symbol;
      capture();syncDerivHint(panel);changed();updateMarketSelects();
      mountChart(cardForControl(field));
      const market=markets.find(item=>item.symbol===symbol);
      const marketDisclosure=host.querySelector('[data-charts-market-disclosure]');
      if(marketDisclosure)marketDisclosure.open=false;
      status((market?.name||symbol)+' selected for Chart '+(charts.indexOf(chart)+1)+'.');
    }
    function addCurrentMarket(card){
      if(!loaded||!prefs||!card)return;
      capture();
      const chart=activeCharts().find(item=>item.id===card.dataset.chartId);
      const market=P.marketFromSymbol(chart?.symbol);
      if(!market){status('Enter a valid EXCHANGE:SYMBOL instrument first.',true);return;}
      if(markets.some(item=>item.symbol===market.symbol)){status(market.name+' is already in your market list.');return;}
      const next=[...markets,market],invalid=P.validateMarkets(next);
      if(invalid){status(invalid,true);return;}
      if(!persistMarketList(next)){status('Your market list could not be saved in this browser.',true);return;}
      marketTargetChartId=chart.id;
      const marketDisclosure=host.querySelector('[data-charts-market-disclosure]');
      if(marketDisclosure)marketDisclosure.open=true;
      updateMarketSelects();
      status(market.name+' added to your market list.');
    }
    function removeMarket(symbol){
      if(!symbol)return;
      const market=markets.find(item=>item.symbol===symbol);
      if(!market)return;
      if(!persistMarketList(markets.filter(item=>item.symbol!==symbol))){status('Your market list could not be saved in this browser.',true);return;}
      updateMarketSelects();
      status(market.name+' removed from your market list.');
    }
    function removeSelectedMarket(button){
      const panel=button.closest('[data-charts-setup-id]');
      const symbol=panel?.querySelector('[data-saved-market]')?.value;
      removeMarket(symbol);
    }
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
        chart.responsibility=panel.querySelector('[data-chart-field="responsibility"]').value;
      });
    }
    function syncDerivHint(panel){
      if(!panel)return;
      const input=panel.querySelector('[data-chart-field="symbol"]');
      const hint=panel.querySelector('[data-deriv-mapping]');
      const select=panel.querySelector('[data-saved-market]');
      if(!input||!hint||!select)return;
      const symbol=input.value.trim().toUpperCase();
      const mapping=P.derivBySymbol(symbol);
      select.value=markets.some(market=>market.symbol===symbol)?symbol:'';
      hint.textContent=mapping?'MT5: '+mapping.mt5Symbol+' (name mapping only; price data not verified)':'Manual symbol — no automatic Deriv MT5 mapping';
    }
    function applyMarketToBothLayouts(market){
      if(!loaded||saving||!market)return;
      capture();
      for(const mode of ['single','multiple'])for(const chart of prefs.charts[mode])chart.symbol=market.symbol;
      host.querySelectorAll('[data-charts-setup-id]').forEach(panel=>{
        panel.querySelector('[data-chart-field="symbol"]').value=market.symbol;syncDerivHint(panel);
      });
      updateMarketSelects();changed();refreshWidgets();closeMarketDialog();
      status(market.name+' selected for both layouts. Save preferences to make it your default.');
    }
    function cardForControl(target){
      const card=target.closest('.charts-grid [data-chart-id]');
      if(card)return card;
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
      const marketField=document.createElement('div');marketField.className='charts-market-field';
      const preset=document.createElement('label');
      preset.className='charts-market-picker';
      preset.textContent='Market';
      const select=document.createElement('select');
      select.dataset.savedMarket='';
      select.setAttribute('aria-label','Chart '+(index+1)+' market');
      preset.appendChild(select);
      populateMarketSelect(select,chart?.symbol||'');
      const remove=document.createElement('button');remove.type='button';remove.className='btn small charts-market-remove';remove.dataset.chartsAction='remove-saved-market';remove.textContent='Remove';remove.title='Remove the selected market from your saved list';remove.setAttribute('aria-label','Remove selected market from your saved list');remove.disabled=true;
      marketField.append(preset,remove);
      instrument.before(marketField);
      const hint=document.createElement('div');
      hint.className='charts-deriv-mapping';
      hint.dataset.derivMapping='';
      hint.setAttribute('aria-live','polite');
      form.appendChild(hint);
      panel.append(title,form);
      syncDerivHint(panel);
      host.querySelector('.charts-panel-settings').appendChild(panel);
    }

    /* User-adjustable Charts/Instruments panel width. The original chart iframe
       remains mounted; resizing only changes the grid layout. */
    const CHARTS_PANEL_WIDTH_KEY='tios_charts_panel_width_v1';
    function chartsPanelWidthKey(){
      return CHARTS_PANEL_WIDTH_KEY+':'+(userId||getUser()?.id||'');
    }
    function readChartsPanelWidth(){
      try{
        const width=Number(localStorage.getItem(chartsPanelWidthKey()));
        return Number.isFinite(width)&&width>=230?width:null;
      }catch(_){return null;}
    }
    function saveChartsPanelWidth(width){
      try{
        if(width===null)localStorage.removeItem(chartsPanelWidthKey());
        else localStorage.setItem(chartsPanelWidthKey(),String(Math.round(width)));
      }catch(_){}
    }
    function initializeChartsPanelResize(){
      const bench=host.querySelector('.charts-workbench');
      const handle=bench?.querySelector('.charts-panel-resizer');
      const panel=bench?.querySelector('.charts-panel');
      if(!bench||!handle||!panel)return;
      const desktop=()=>window.matchMedia('(min-width:861px)').matches;
      const bounds=()=>{
        const total=bench.getBoundingClientRect().width;
        return {min:230,max:Math.max(230,Math.min(850,Math.round(total*.70),Math.round(total-340)))};
      };
      const panelWidth=()=>panel.getBoundingClientRect().width||286;
      const apply=(width,persist=false)=>{
        if(!desktop())return;
        const {min,max}=bounds();
        const value=Math.min(max,Math.max(min,Math.round(width)));
        bench.style.setProperty('--charts-panel-width',value+'px');
        handle.setAttribute('aria-valuemin',String(min));
        handle.setAttribute('aria-valuemax',String(max));
        handle.setAttribute('aria-valuenow',String(value));
        handle.setAttribute('aria-valuetext',value+' pixels wide');
        if(persist)saveChartsPanelWidth(value);
      };
      const savedWidth=readChartsPanelWidth();
      if(savedWidth!==null)apply(savedWidth);
      else {
        handle.setAttribute('aria-valuenow',String(Math.round(panelWidth())));
        handle.setAttribute('aria-valuemin','230');
        handle.setAttribute('aria-valuemax',String(bounds().max));
      }
      let drag=null;
      let priorCursor='',priorSelection='';
      const finish=(event,commit=true)=>{
        if(!drag||event.pointerId!==drag.id)return;
        if(commit)saveChartsPanelWidth(panelWidth());
        drag=null;
        bench.classList.remove('charts-panel-resizing');
        document.body.style.cursor=priorCursor;
        document.body.style.userSelect=priorSelection;
        if(handle.hasPointerCapture?.(event.pointerId))handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener('pointerdown',event=>{
        if(!desktop()||controlsCollapsed||expanded||(event.pointerType==='mouse'&&event.button!==0))return;
        drag={id:event.pointerId,x:event.clientX,width:panelWidth()};
        priorCursor=document.body.style.cursor;
        priorSelection=document.body.style.userSelect;
        document.body.style.cursor='col-resize';
        document.body.style.userSelect='none';
        bench.classList.add('charts-panel-resizing');
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      handle.addEventListener('pointermove',event=>{
        if(!drag||drag.id!==event.pointerId)return;
        apply(drag.width+event.clientX-drag.x);
      });
      handle.addEventListener('pointerup',event=>finish(event,true));
      handle.addEventListener('pointercancel',event=>finish(event,false));
      handle.addEventListener('lostpointercapture',event=>finish(event,false));
      handle.addEventListener('keydown',event=>{
        if(!desktop()||controlsCollapsed||expanded)return;
        const step=event.shiftKey?60:24;
        let next;
        if(event.key==='ArrowLeft')next=panelWidth()-step;
        else if(event.key==='ArrowRight')next=panelWidth()+step;
        else if(event.key==='Home')next=bounds().min;
        else if(event.key==='End')next=bounds().max;
        else return;
        event.preventDefault();
        apply(next,true);
      });
      handle.addEventListener('dblclick',()=>{
        if(!desktop()||controlsCollapsed||expanded)return;
        saveChartsPanelWidth(null);
        bench.style.removeProperty('--charts-panel-width');
        const defaultWidth=Math.round(panelWidth());
        handle.setAttribute('aria-valuenow',String(defaultWidth));
        handle.setAttribute('aria-valuetext',defaultWidth+' pixels wide');
      });
    }

    function toggleControls(){
      controlsCollapsed=!controlsCollapsed;
      const workspace=host.querySelector('.charts-workbench');
      if(!workspace)return;
      workspace.classList.toggle('charts-panel-collapsed',controlsCollapsed);
      const panel=workspace.querySelector('.charts-panel');
      panel.inert=controlsCollapsed;
      panel.setAttribute('aria-hidden',String(controlsCollapsed));
      verification.setControlsVisible(!controlsCollapsed&&sidebarMode==='settings');
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
      verification.setControlsVisible(!controlsCollapsed&&sidebarMode==='settings');
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
      const externalChart=card.querySelector('[data-charts-tv-chart]');
      if(externalChart)externalChart.href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(chart.symbol);
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
      if(panel){panel.querySelector('[data-chart-field="symbol"]').value=chart.symbol;syncDerivHint(panel);}
      syncIntervalControl(card,chart);
      updateMarketSelects();mountChart(card,true);changed();
    }
    function refreshWidgets(){host.querySelectorAll('[data-chart-id]').forEach(card=>mountChart(card))}
    function intervalLabel(value){
      return ({'1':'1min','3':'3min','5':'5min','15':'15min','30':'30min','60':'1H','120':'2H','240':'4H','D':'1D','W':'1W','M':'1M'})[value]||String(value);
    }
    function syncIntervalControl(card,chart){
      const control=card?.querySelector('.charts-timeframes-control');
      if(!control||!chart)return;
      const trigger=control.querySelector('.charts-timeframes-trigger');
      const current=control.querySelector('.charts-timeframes-current');
      const label=intervalLabel(chart.interval);
      if(trigger)trigger.dataset.chartIntervalCurrent=chart.interval;
      if(current)current.textContent=label;
      control.querySelectorAll('[data-chart-interval]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chartInterval===chart.interval)));
    }
    function cardMarkup(chart,index){return `<section class="charts-card" data-chart-id="${escape(chart.id)}" aria-label="Chart ${index+1}">
            <div class="charts-card-top"><strong>Chart ${index+1}</strong><details class="charts-timeframes-control"><summary class="charts-timeframes-trigger" data-chart-interval-current="${escape(chart.interval)}"><span>Timeframes: </span><strong class="charts-timeframes-current">${intervalLabel(chart.interval)}</strong></summary><div class="charts-timeframes-options" role="group" aria-label="Chart ${index+1} timeframes">${P.intervals.map(([value])=>`<button type="button" class="charts-timeframes-option" data-chart-interval="${escape(value)}" aria-pressed="${chart.interval===value}">${intervalLabel(value)}</button>`).join('')}</div></details><div class="charts-card-actions">
              ${index===0?`<button class="btn small charts-reveal-controls" type="button" data-charts-action="toggle-panel" aria-controls="chartsPanel" aria-expanded="${!controlsCollapsed}" ${controlsCollapsed?'':'hidden'}>Show controls</button><button class="btn small charts-account-link" type="button" data-charts-action="manage-deriv-account" title="Manage the selected Deriv MT5 account inside T-IOS">Deriv account</button><a class="btn small charts-tv-link" href="https://www.tradingview.com/chart/?symbol=${escape(encodeURIComponent(chart.symbol))}" target="_blank" rel="noopener noreferrer" data-charts-tv-chart title="Open this symbol on TradingView with its full toolbar; changes are not tracked in T-IOS">Open TradingView ↗</a>`:''}
              <button class="btn small" type="button" data-charts-action="capture" title="Capture this chart as evidence for a trade">Capture</button><button class="btn small" type="button" data-charts-action="add-market" title="Add this chart market to your saved list">Add market</button><button class="btn small" type="button" data-charts-action="reset-chart" title="Reload this chart to its saved instrument, or the configured instrument if no saved chart exists">Reset instrument</button><button class="btn small" type="button" data-charts-action="expand" aria-expanded="false">Expand</button></div></div>
            <form class="charts-controls">
              <label class="charts-symbol">Instrument<input data-chart-field="symbol" aria-label="Chart ${index+1} instrument" value="${escape(chart.symbol)}" maxlength="81" placeholder="FX:EURUSD" list="charts-symbols" required spellcheck="false" autocomplete="off"></label>
              <button class="btn small charts-apply" type="submit" title="Apply the instrument to this chart">Apply</button>
              <label class="charts-responsibility">Responsibility <input data-chart-field="responsibility" aria-label="Chart ${index+1} responsibility" value="${escape(chart.responsibility)}" maxlength="120" placeholder="What do you analyse here?"></label>
            </form>
            <div class="charts-widget-status" role="status" aria-live="polite" hidden></div>
            <div class="charts-widget"></div>
          </section>`}
    // Resize only affected cards, retaining existing TradingView frames and drawings.
    function resizeMultiple(count,confirmed=false){
      if(!prefs||prefs.layout!=='multiple'||!Number.isInteger(count)||count<2||count>6)return;
      capture();
      const list=prefs.charts.multiple,old=list.length;
      if(count===old)return;
      if(count<old&&!confirmed&&!window.confirm('Remove '+(old-count)+' chart(s) from this layout? Their individual settings will be removed when you save preferences.')){
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
      saveLayoutChoice();
    }
    // The number chosen (including one chart) is a per-user preference.
    // One chart uses the existing single layout; the other counts use
    // the existing multiple layout without changing the saved schema.
    function selectChartCount(count){
      if(!loaded||accountStep!=='ready'||!Number.isInteger(count)||count<1||count>6)return;
      const selected=prefs.layout==='single'?1:prefs.charts.multiple.length;
      if(count===selected)return;
      if(count===1){
        capture();prefs.layout='single';render();saveLayoutChoice();return;
      }
      if(prefs.layout==='single'){
        const previous=prefs.charts.multiple.length;
        if(count<previous&&!window.confirm('Remove '+(previous-count)+' chart(s) from the saved multiple layout? Their individual settings will be removed when you save preferences.')){
          const select=host.querySelector('[data-charts-count]');if(select)select.value='1';
          return;
        }
        capture();prefs.layout='multiple';render();
        if(count!==previous)resizeMultiple(count,true);
        else saveLayoutChoice();
      }else resizeMultiple(count);
    }
    function saveLayoutChoice(){
      layoutSaveQueued=true;
      if(!saving)void save();
    }

    // Profile membership is independent of chart preferences. Supabase verifies
    // the existing T-IOS session; Charts never collects another password.
    async function verifiedUser(id){
      const client=getClient();
      if(!client?.auth)throw Error('Your T-IOS session is unavailable. Sign in through H-IOS, then return to Charts.');
      const {data,error}=await client.auth.getUser();
      if(error||!data?.user||data.user.id!==id||data.user.is_anonymous)
        throw Error('Your T-IOS session could not be verified. Sign in through H-IOS, then return to Charts.');
      return data.user;
    }
    async function readWorkspace(id){
      const [profile,preferences]=await Promise.all([
        getClient().from(PROFILE_TABLE).select('user_id,created_at').eq('user_id',id).maybeSingle(),
        getClient().from(TABLE).select('configuration,revision,schema_version').eq('user_id',id).maybeSingle()
      ]);
      if(profile.error)throw Error('Your Charts account could not be verified. Please retry.');
      if(profile.data&&profile.data.user_id!==id)throw Error('Your Charts account could not be verified. Please retry.');
      if(preferences.error)throw Error('Your saved preferences could not be loaded. Retry before making changes.');
      const row=preferences.data;
      if(row&&(row.schema_version!==1||P.validate(row.configuration)))
        throw Error('Your saved chart preferences use an unsupported format. They have been preserved.');
      return {profile:profile.data,preferences:row};
    }
    function acceptWorkspace(result){
      chartProfile=result.profile;
      const row=result.preferences;
      prefs=row?P.clone(row.configuration):P.defaults();
      loadMarketList(userId);
      revision=row?.revision??null;saved=row?JSON.stringify(prefs):null;loaded=true;
      accountStep=!chartProfile?'entry':row?'ready':'layout';
      firstRunLayout=prefs.layout;accountError='';
    }
    function renderAccountEntry(){
      if(!visible||!loaded||accountStep==='ready')return;
      const email=escape(getUser()?.email||'your T-IOS account');
      const layout=accountStep==='layout',count=prefs.charts.multiple.length;
      host.innerHTML=`
        <div class="charts-welcome-setup" aria-label="T-IOS chart account setup">
          <div class="charts-welcome-preview" aria-hidden="true">
            <div class="charts-welcome-preview-head"><span>Chart 1</span><span>T-IOS workspace</span></div>
            <div class="charts-welcome-preview-grid"></div>
          </div>
          <section class="charts-welcome-card" role="dialog" aria-modal="false" aria-labelledby="chartsWelcomeTitle" aria-describedby="chartsWelcomeDescription" aria-busy="${accountBusy||firstRunSaving}">
            <span class="charts-welcome-kicker">T·IOS · Your private Charts workspace</span>
            <h2 id="chartsWelcomeTitle">${layout?'Choose your chart layout':'Welcome to T-IOS Charts'}</h2>
            <p id="chartsWelcomeDescription">${layout
              ?`Your Charts account is registered to <strong>${email}</strong>. Choose how you want to analyse the market. You can change this later.${revision!==null?' Your saved instruments, timeframes and chart settings will be kept.':''}`
              :`Continue with your T-IOS account, <strong>${email}</strong>. Sign in to an existing Charts profile or create your private Charts account. Your current T-IOS session is used securely.`}</p>
            ${layout?`<div class="charts-welcome-layouts" role="group" aria-label="Initial chart layout">
              <button type="button" class="charts-welcome-choice ${firstRunLayout==='single'?'selected':''}" data-charts-onboarding-layout="single" aria-pressed="${firstRunLayout==='single'}">
                <span class="charts-welcome-layout-icon single" aria-hidden="true"><i></i></span>
                <strong>Single chart</strong>
                <small>One large chart with timeframe switching</small>
              </button>
              <button type="button" class="charts-welcome-choice ${firstRunLayout==='multiple'?'selected':''}" data-charts-onboarding-layout="multiple" aria-pressed="${firstRunLayout==='multiple'}">
                <span class="charts-welcome-layout-icon multiple" aria-hidden="true"><i></i><i></i><i></i></span>
                <strong>${count===3?'Three charts':count+' charts'}</strong>
                <small>${count===3?'Context · Setup · Entry':'Your saved multiple-chart layout'}</small>
              </button>
            </div>
            <button class="btn primary charts-welcome-start" type="button" data-charts-action="start-tios-charts">Save layout &amp; open charts</button>`
            :`<div class="charts-welcome-actions">
              <button class="btn charts-welcome-start" type="button" data-charts-action="sign-in-charts">Sign in to Charts</button>
              <button class="btn primary charts-welcome-start" type="button" data-charts-action="create-charts-account">Create Charts account</button>
            </div>`}
            <p class="charts-welcome-disclosure">This is your T-IOS Charts account. TradingView widgets use public charts and do not sign you in to your personal TradingView account. Indicator and drawing persistence is planned for the native workspace.</p>
            <p class="charts-welcome-error" data-charts-onboarding-error role="alert" ${accountError?'':'hidden'}>${escape(accountError)}</p>
          </section>
        </div>`;
      updateAccountBusy();
      host.querySelector('[data-charts-action="'+(layout?'start-tios-charts':'sign-in-charts')+'"]')?.focus({preventScroll:true});
    }
    function updateAccountBusy(){
      const busy=accountBusy||firstRunSaving;
      host.querySelector('.charts-welcome-card')?.setAttribute('aria-busy',String(busy));
      host.querySelectorAll('.charts-welcome-card button').forEach(button=>button.disabled=busy);
    }
    function showAccountError(message){
      accountError=message;
      const node=host.querySelector('[data-charts-onboarding-error]');
      if(node){node.hidden=!message;node.textContent=message;}
    }
    async function enterCharts(create=false){
      if(!visible||!loaded||accountStep!=='entry'||accountBusy||getUser()?.id!==userId)return;
      const id=userId,epoch=generation;
      accountBusy=true;showAccountError('');updateAccountBusy();
      try{
        await verifiedUser(id);
        if(!alive(id,epoch))return;
        let result=await readWorkspace(id);
        if(!alive(id,epoch))return;
        let created=false;
        if(!result.profile){
          if(!create){showAccountError('No Charts account exists for this T-IOS account yet. Choose Create Charts account to get started.');return;}
          const {data,error}=await getClient().from(PROFILE_TABLE).insert({user_id:id}).select('user_id,created_at').maybeSingle();
          if(!alive(id,epoch))return;
          if(error?.code==='23505'){
            // Another tab may have registered this same user. Load, never overwrite.
            result=await readWorkspace(id);
            if(!alive(id,epoch))return;
            if(!result.profile)throw Error('Your Charts account could not be loaded. Please retry.');
          }else{
            if(error||!data||data.user_id!==id)throw Error('Your Charts account could not be created. Please retry.');
            result.profile=data;created=true;
          }
        }
        acceptWorkspace(result);
        if(created)accountStep='layout';
        render();
      }catch(error){if(alive(id,epoch))showAccountError(error.message||'Your Charts account could not be verified. Please retry.');}
      finally{if(alive(id,epoch)){accountBusy=false;updateAccountBusy();}}
    }
    async function completeFirstTimeChartSetup(){
      if(!visible||!loaded||!chartProfile||accountStep!=='layout'||firstRunSaving||getUser()?.id!==userId)return;
      const snapshot=P.clone(prefs);
      snapshot.layout=firstRunLayout;
      const validation=P.validate(snapshot);
      const errorEl=host.querySelector('[data-charts-onboarding-error]');
      if(validation){
        if(errorEl){errorEl.hidden=false;errorEl.textContent=validation;}
        return;
      }
      const id=userId,epoch=generation;
      firstRunSaving=true;showAccountError('');updateAccountBusy();
      const start=host.querySelector('[data-charts-action="start-tios-charts"]');
      if(start){start.disabled=true;start.textContent='Saving your workspace…';}
      try{
        await verifiedUser(id);
        if(!alive(id,epoch))return;
        const profile=await getClient().from(PROFILE_TABLE).select('user_id').eq('user_id',id).maybeSingle();
        if(!alive(id,epoch))return;
        if(profile.error||profile.data?.user_id!==id)throw Error('Your Charts account could not be verified. Please retry.');
        const query=revision===null
          ?getClient().from(TABLE).insert({user_id:id,configuration:snapshot})
          :getClient().from(TABLE).update({configuration:snapshot}).eq('user_id',id).eq('revision',revision);
        const {data,error}=await query.select('revision').maybeSingle();
        if(!alive(id,epoch))return;
        if(error?.code==='23505'||(!error&&!data)){
          const existing=await readWorkspace(id);
          if(!alive(id,epoch))return;
          acceptWorkspace(existing);
          // Keep the latest saved data and ask before applying another layout.
          if(chartProfile)accountStep='layout';
          accountError='Your preferences changed on another device. The latest settings are loaded; confirm your layout to continue.';
          render();return;
        }
        if(error||!data)throw Error('Could not save your chart layout. Your existing settings are preserved. Please retry.');
        prefs=snapshot;revision=data.revision;saved=JSON.stringify(snapshot);
        accountStep='ready';
        render();
      }catch(error){
        if(!alive(id,epoch)||!visible)return;
        const message=host.querySelector('[data-charts-onboarding-error]');
        if(message){message.hidden=false;message.textContent=error.message||'Could not save your chart setup. Please retry.';}
      }finally{
        if(alive(id,epoch)){
          firstRunSaving=false;updateAccountBusy();
          const button=host.querySelector('[data-charts-action="start-tios-charts"]');
          if(button)button.textContent='Save layout & open charts';
        }
      }
    }

    function render(){
      if(!visible||!loaded||!prefs||getUser()?.id!==userId)return;
      if(accountStep!=='ready'||!chartProfile){renderAccountEntry();return;}
      instrumentLoadEpoch++;instrumentWorkspace?.unmount();closeExpanded(false);dispose();
      host.innerHTML=`
        <div class="charts-workbench ${controlsCollapsed?'charts-panel-collapsed':''}">
          <aside class="charts-panel" id="chartsPanel" aria-label="Charts workspace controls" aria-hidden="${controlsCollapsed}">
            <div class="charts-panel-head"><strong data-charts-sidebar-title>Charts</strong><button class="btn small" type="button" data-charts-action="instruments" aria-controls="chartsInstruments" aria-pressed="false">Instruments</button><button class="btn small charts-panel-dismiss" type="button" data-charts-action="toggle-panel" aria-controls="chartsPanel" aria-expanded="${!controlsCollapsed}">Hide controls</button></div>
            <div class="charts-panel-scroll">
              <div class="charts-toolbar">
          <div class="charts-setting charts-market-control">
            <span class="charts-market-label">My markets</span>
            <details class="charts-market-section" data-charts-market-disclosure>
              <summary class="charts-market-summary"><span data-market-current>Select a saved market</span></summary>
              <div class="charts-market-menu">
                <label class="charts-market-target" data-market-target-wrap hidden>Apply to chart<select data-market-target aria-label="Select chart for saved market"></select></label>
                <div class="charts-market-list" data-charts-market-list role="list" aria-label="Saved markets"></div>
              </div>
            </details>
          </div>
          <div class="charts-section-title">Layout</div>
          <div class="charts-layout" role="group" aria-label="Chart layout">
            <button type="button" data-charts-layout="single" aria-pressed="${prefs.layout==='single'}">Single Chart</button>
            <button type="button" data-charts-layout="multiple" aria-pressed="${prefs.layout==='multiple'}">Multiple Charts <span>${prefs.charts.multiple.length}</span></button>
          </div>
          <label class="charts-setting charts-count-setting">Number of charts<select data-charts-count aria-label="Number of simultaneous charts">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${(prefs.layout==='single'?1:prefs.charts.multiple.length)===n?'selected':''}>${n} chart${n===1?'':'s'}</option>`).join('')}</select></label>
          <div class="charts-section-title">Appearance</div>
          <label class="charts-setting">Chart theme<select data-charts-setting="theme"><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option></select></label>
          <label class="charts-setting">Timezone<select data-charts-setting="timezone">${P.timezones.map(([value,label])=>`<option value="${value}" ${prefs.timezone===value?'selected':''}>${label}</option>`).join('')}</select></label>
          <div class="charts-section-title">Deriv data tools</div>
          <a class="btn small charts-deriv-default" href="deriv-feed-check.html" target="_blank" rel="noopener noreferrer" data-charts-feed-test aria-describedby="charts-feed-test-note">Open Deriv feed test ↗</a>
          <p id="charts-feed-test-note" class="charts-deriv-note">Read-only connection test. On the test page, press Connect public feed. Public prices remain unverified against MT5.</p>
          <button class="btn small charts-deriv-default" type="button" data-charts-action="start-public-quote">Start live Deriv quote</button>
          <p class="charts-deriv-note">Shows a separate public spot quote above your chart. TradingView controls its own candle updates. MT5 price parity remains unverified.</p>
          <div class="charts-section-title">MT5 desktop</div>
          <div class="charts-mt5-launcher">
            <label class="charts-mt5-minimized"><input type="checkbox" data-mt5-minimized checked> Start minimized so Charts stays visible</label>
            <a class="btn small charts-deriv-default charts-mt5-open" href="tios-mt5://launch?minimized=1" data-charts-action="launch-mt5" aria-describedby="charts-mt5-launch-status">Open MT5 on this computer</a>
            <a class="btn small charts-deriv-default" href="https://deriv.com/trading-platforms/mt5/download" target="_blank" rel="noopener noreferrer">Install Deriv MT5 ↗</a>
            <a class="btn small charts-deriv-default charts-mt5-installer" href="mt5/Install-TIOS-MT5-Launcher.ps1" download>Set up local launcher (one time)</a>
            <p class="charts-deriv-note charts-mt5-copy">MT5 opens in its own desktop window. T-IOS stays open, and you can switch to MT5 during a session. Sign in to MT5 inside the terminal; T-IOS never asks for your MT5 password.</p>
            <p class="charts-deriv-note" data-charts-mt5-launch-status id="charts-mt5-launch-status" role="status" aria-live="polite">One-time Windows launcher setup is required before this button can open the desktop terminal.</p>
            <p class="charts-deriv-note charts-mt5-sync-status">Trade sync: this launcher only opens MT5. The current repository has a read-only candle companion, not a verified trade-sync bridge.</p>
          </div>
          <div class="charts-section-title">Chart setup</div>
          <div class="charts-panel-settings"></div>
          <div class="charts-section-title">Preferences</div>
          <div class="charts-save"><button type="button" class="btn primary" data-charts-action="save">Save preferences</button><span data-charts-status role="status" aria-live="polite"></span><button type="button" class="btn small" data-charts-action="reload" hidden>Reload saved preferences</button></div>
          <p class="charts-help">Save defaults with these controls. Changes inside TradingView stay in this chart session. Market data availability and delays depend on the instrument.</p>
              </div>
              <div class="charts-instruments" id="chartsInstruments" data-charts-instruments aria-label="Record instrument responses" hidden></div>
            </div>
          </aside>
          <div class="charts-panel-resizer" role="separator" tabindex="0" aria-label="Resize the Charts Instruments panel" title="Drag to resize panel. Double-click to reset." aria-orientation="vertical" aria-controls="chartsPanel" aria-valuemin="230" aria-valuenow="286" aria-valuemax="850"><span aria-hidden="true"></span></div>
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
      initializeChartsPanelResize();
      host.querySelectorAll('.charts-grid [data-chart-id]').forEach((card,index)=>relocateControls(card,index));
      const launcherSupported=/Windows/i.test(navigator.userAgent);
      const launcherLink=host.querySelector('[data-charts-action="launch-mt5"]');
      const launcherInstaller=host.querySelector('.charts-mt5-installer');
      const launcherStatus=host.querySelector('[data-charts-mt5-launch-status]');
      if(!launcherSupported){
        launcherLink?.setAttribute('aria-disabled','true');
        launcherInstaller.hidden=true;
        if(launcherStatus)launcherStatus.textContent='The local launcher currently supports Windows only. On macOS or Linux, install Deriv MT5 from the official download page and open it manually; T-IOS stays open.';
      }
      updateMarketSelects();
      host.querySelector('.charts-panel').inert=controlsCollapsed;
      changed();refreshWidgets();
      renderPublicQuote();
      verification.setControlsVisible(!controlsCollapsed&&sidebarMode==='settings');
      verification.mount(host.querySelector('.charts-toolbar'));
      renderSidebar();
      if(sidebarMode==='instruments')mountInstruments();
      if(pendingEvidenceTrade){setSidebarMode('settings');if(controlsCollapsed)toggleControls();verification.openTrade(pendingEvidenceTrade);pendingEvidenceTrade=null;}
    }
    async function load(){
      if(loading)return;
      const id=userId,epoch=generation;loading=true;loaded=false;
      if(visible)host.innerHTML='<div class="charts-empty" role="status">Verifying your Charts account…</div>';
      try{
        await verifiedUser(id);
        if(!alive(id,epoch))return;
        const result=await readWorkspace(id);
        if(!alive(id,epoch))return;
        acceptWorkspace(result);
        render();
      }catch(error){
        if(alive(id,epoch)&&visible){host.innerHTML='<div class="charts-empty"><p role="alert"></p><button type="button" class="btn" data-charts-action="reload">Retry verifying Charts account</button></div>';host.querySelector('p').textContent=error.message}
      }finally{if(alive(id,epoch))loading=false}
    }
    async function save(){
      if(!loaded||!chartProfile||accountStep!=='ready'||saving||!getClient()||getUser()?.id!==userId)return;
      layoutSaveQueued=false;
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
      finally{
        if(alive(id,epoch)){
          saving=false;updateSave();
          // If another layout/count was chosen during the request, save the
          // newest selection after the first revision is acknowledged.
          if(layoutSaveQueued){
            layoutSaveQueued=false;
            if(dirty())void save();
          }
        }
      }
    }
    host.addEventListener('submit',event=>{
      if(!event.target.matches('.charts-controls'))return;
      event.preventDefault();capture();updateMarketSelects();mountChart(cardForControl(event.target));changed();
    });
    host.addEventListener('input',event=>{
      if(!event.target.matches('[data-chart-field]'))return;
      capture();changed();
      if(event.target.dataset.chartField==='symbol'){const panel=event.target.closest('[data-charts-setup-id]');syncDerivHint(panel);updateMarketSelects();}
      const card=cardForControl(event.target);
      if(event.target.dataset.chartField==='responsibility'){
        const summary=event.target.closest('[data-charts-setup-id]')?.querySelector('.charts-setup-caption');
        if(summary)summary.textContent=event.target.value||'Configure chart';
        if(expanded===card)card.setAttribute('aria-label','Chart · '+event.target.value);
      }
    });
    host.addEventListener('change',event=>{
      if(event.target.matches('[data-mt5-minimized]')){
        const link=host.querySelector('[data-charts-action="launch-mt5"]');
        if(link)link.href='tios-mt5://launch?minimized='+(event.target.checked?'1':'0');
        return;
      }
      if(event.target.matches('[data-charts-public-market]')){
        if(quoteActive())return;
        quoteMarket=event.target.value;quoteMarketChosen=true;stopPublicQuote('Public market selection changed. Press Start to receive this separate instrument.',true);return;
      }
      if(event.target.matches('[data-market-target]')){
        marketTargetChartId=event.target.value;renderMarketList();return;
      }
      if(event.target.matches('[data-saved-market]')){
        if(!event.target.value)return;
        const panel=event.target.closest('[data-charts-setup-id]');
        panel.querySelector('[data-chart-field="symbol"]').value=event.target.value;
        capture();syncDerivHint(panel);changed();updateMarketSelects();
        mountChart(cardForControl(event.target));
        return;
      }
      if(event.target.matches('[data-charts-count]')){selectChartCount(Number(event.target.value));return}
      if(event.target.matches('[data-charts-setting]')){
        prefs[event.target.dataset.chartsSetting]=event.target.value;changed();refreshWidgets();
      }
    });
    host.addEventListener('click',event=>{
      const intervalOption=event.target.closest('[data-chart-interval]');
      if(intervalOption){
        const card=intervalOption.closest('[data-chart-id]');
        const chart=activeCharts().find(item=>item.id===card?.dataset.chartId);
        const nextInterval=intervalOption.dataset.chartInterval;
        if(!chart||!P.intervals.some(([value])=>value===nextInterval))return;
        chart.interval=nextInterval;
        card.querySelector('.charts-timeframes-control')?.removeAttribute('open');
        syncIntervalControl(card,chart);
        capture();changed();mountChart(card);
        return;
      }
      const firstLayout=event.target.closest('[data-charts-onboarding-layout]');
      if(firstLayout&&accountStep==='layout'&&!firstRunSaving){
        firstRunLayout=firstLayout.dataset.chartsOnboardingLayout;
        host.querySelectorAll('[data-charts-onboarding-layout]').forEach(button=>{
          const selected=button.dataset.chartsOnboardingLayout===firstRunLayout;
          button.classList.toggle('selected',selected);
          button.setAttribute('aria-pressed',String(selected));
        });
        return;
      }
      const layout=event.target.closest('[data-charts-layout]');
      if(layout&&accountStep==='ready'&&loaded){selectChartCount(layout.dataset.chartsLayout==='single'?1:prefs.charts.multiple.length);return}
      const button=event.target.closest('[data-charts-action]');if(!button)return;
      const action=button.dataset.chartsAction;
      if(action==='launch-mt5'){
        if(!/Windows/i.test(navigator.userAgent)){
          event.preventDefault();
          const note=host.querySelector('[data-charts-mt5-launch-status]');
          if(note)note.textContent='The local launcher currently supports Windows only. On macOS or Linux, install Deriv MT5 from the official download page and open it manually.';
          return;
        }
        const note=host.querySelector('[data-charts-mt5-launch-status]');
        if(note)note.textContent='Launch requested. If your browser asks, allow it to open the T-IOS MT5 launcher. If MT5 does not start, complete the one-time launcher setup below.';
        return;
      }
      if(action==='sign-in-charts'){enterCharts();return;}
      if(action==='create-charts-account'){enterCharts(true);return;}
      if(action==='start-tios-charts'){completeFirstTimeChartSetup();return;}
      if(action==='toggle-panel')toggleControls();
      if(action==='instruments')setSidebarMode(sidebarMode==='settings'?'instruments':'settings');
      if(action==='manage-deriv-account')document.querySelector('.nav-btn[data-page="settings"]')?.click();
      if(action==='retry-instruments')mountInstruments();
      if(action==='add-market'){addCurrentMarket(button.closest('[data-chart-id]'));return;}
      if(action==='select-listed-market'){applyListedMarket(button.dataset.marketSymbol);return;}
      if(action==='remove-listed-market'){removeMarket(button.dataset.marketSymbol);return;}
      if(action==='remove-saved-market'){removeSelectedMarket(button);return;}
      if(action==='start-public-quote')startPublicQuote();
      if(action==='stop-public-quote')stopPublicQuote();
      if(action==='hide-public-quote'){quoteShown=false;stopPublicQuote();}
      if(action==='save')save();
      if(action==='capture'){
        const card=button.closest('[data-chart-id]');
        const chart=activeCharts().find(item=>item.id===card?.dataset.chartId);
        if(chart&&window.TIOSChartCaptureController)window.TIOSChartCaptureController.open(chart,null);
        return;
      }
      if(action==='expand')expand(button.closest('[data-chart-id]'));
      if(action==='reset-chart')resetChart(button.closest('[data-chart-id]'));
      if(action==='retry-chart')mountChart(button.closest('[data-chart-id]'),true);
      if(action==='dismiss-status')cardMessage(button.closest('[data-chart-id]'),'');
      if(action==='reload'&&!saving){instrumentLoadEpoch++;instrumentWorkspace?.unmount();if(quoteActive())stopPublicQuote('Paused while chart preferences reload. Press Start when they are loaded.');closeExpanded(false);dispose();load()}
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
        else if(loading)host.innerHTML='<div class="charts-empty" role="status">Verifying your Charts account…</div>';
        else load();
      },
      openTrade(trade){
        if(!loaded||accountStep!=='ready'){pendingEvidenceTrade=trade;return;}
        if(sidebarMode==='instruments')setSidebarMode('settings');
        if(controlsCollapsed)toggleControls();
        verification.openTrade(trade);
      },
      hide(){capture();instrumentLoadEpoch++;instrumentWorkspace?.unmount();verification.hide();visible=false;stopPublicQuote('Paused while Charts is closed. Press Start to reconnect.');closeExpanded(false);dispose();host.replaceChildren()},
      reset(){api.hide();instrumentWorkspace?.reset();instrumentWorkspace=null;sidebarMode='settings';markets=P.defaultMarkets();chartProfile=null;accountStep='entry';accountBusy=false;accountError='';firstRunLayout='single';firstRunSaving=false;quoteFeed?.dispose();quoteFeed=null;quoteState=null;quoteShown=false;quoteMarket='v75_1s';quoteMarketChosen=false;verification.reset();pendingEvidenceTrade=null;generation++;userId=null;prefs=null;loaded=false;loading=false;saving=false;layoutSaveQueued=false;revision=null;saved=null}
    };
    return api;
  }};
})();

