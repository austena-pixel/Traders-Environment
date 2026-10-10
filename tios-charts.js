(function(){
  'use strict';
  const P=window.TIOSChartPreferences,TABLE='chart_workspace_preferences';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  window.TIOSCharts={create({host,getClient,getUser}){
    let visible=false,userId=null,prefs=null,loaded=false,loading=false,saving=false;
    let revision=null,saved=null,generation=0,expanded=null,focusBeforeExpand=null,previousOverflow='';
    const instances=new Map();
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
      host.querySelectorAll('[data-chart-id]').forEach(card=>{
        const chart=activeCharts().find(item=>item.id===card.dataset.chartId);
        if(!chart)return;
        chart.symbol=card.querySelector('[data-chart-field="symbol"]').value.trim().toUpperCase();
        chart.interval=card.querySelector('[data-chart-field="interval"]').value;
        chart.responsibility=card.querySelector('[data-chart-field="responsibility"]').value;
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
      host.querySelectorAll('[data-chart-id],.charts-toolbar,.charts-head').forEach(node=>node.inert=false);
      document.body.style.overflow=previousOverflow;
      expanded=null;
      if(restoreFocus&&focusBeforeExpand?.isConnected)focusBeforeExpand.focus();
      focusBeforeExpand=null;
    }
    function expand(card){
      if(expanded===card){closeExpanded();return}
      closeExpanded(false);focusBeforeExpand=document.activeElement;previousOverflow=document.body.style.overflow;
      const backdrop=document.createElement('div');backdrop.className='charts-backdrop';
      backdrop.addEventListener('click',()=>closeExpanded());host.appendChild(backdrop);
      expanded=card;card.classList.add('charts-card-expanded');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
      host.querySelectorAll('[data-chart-id],.charts-toolbar,.charts-head').forEach(node=>{if(node!==card)node.inert=true});
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
    function refreshWidgets(){host.querySelectorAll('[data-chart-id]').forEach(card=>mountChart(card))}
    function cardMarkup(chart,index){return `<section class="charts-card" data-chart-id="${escape(chart.id)}" aria-label="Chart ${index+1}">
            <div class="charts-card-top"><strong>Chart ${index+1}</strong><button class="btn small" type="button" data-charts-action="expand" aria-expanded="false">Expand</button></div>
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
        }
      }else{
        for(let i=old;i<count;i++){
          const reference=list.at(-1);
          let id;
          do{id='extra-'+crypto.randomUUID().slice(0,12)}while(list.some(chart=>chart.id===id));
          const chart={id,symbol:reference?.symbol||'FX:EURUSD',interval:reference?.interval||'60',responsibility:''};
          list.push(chart);
          grid.insertAdjacentHTML('beforeend',cardMarkup(chart,i));
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
        <div class="charts-head"><div><h1>Charts</h1><p class="muted">Your market analysis workspace</p></div><a class="btn small" href="https://www.tradingview.com/chart/" target="_blank" rel="noopener">Open TradingView ↗</a></div>
        <div class="charts-toolbar">
          <div class="charts-layout" role="group" aria-label="Chart layout">
            <button type="button" data-charts-layout="single" aria-pressed="${prefs.layout==='single'}">Single Chart</button>
            <button type="button" data-charts-layout="multiple" aria-pressed="${prefs.layout==='multiple'}">Multiple Charts <span>${prefs.charts.multiple.length}</span></button>
          </div>
          ${prefs.layout==='multiple'?`<label class="charts-setting charts-count-setting">Number of charts<select data-charts-count aria-label="Number of simultaneous charts">${[2,3,4,5,6].map(n=>`<option value="${n}" ${prefs.charts.multiple.length===n?'selected':''}>${n} charts</option>`).join('')}</select></label>`:''}
          <label class="charts-setting">Chart theme<select data-charts-setting="theme"><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option></select></label>
          <label class="charts-setting">Timezone<select data-charts-setting="timezone">${P.timezones.map(([value,label])=>`<option value="${value}" ${prefs.timezone===value?'selected':''}>${label}</option>`).join('')}</select></label>
          <div class="charts-save"><button type="button" class="btn primary" data-charts-action="save">Save preferences</button><span data-charts-status role="status" aria-live="polite"></span><button type="button" class="btn small" data-charts-action="reload" hidden>Reload saved preferences</button></div>
          <p class="charts-help">Save defaults with these controls. Changes inside TradingView stay in this chart session. Market data availability and delays depend on the instrument.</p>
        </div>
        <div class="charts-grid" data-charts-mode="${prefs.layout}" data-chart-count="${activeCharts().length}" style="--chart-count:${activeCharts().length}">
          ${activeCharts().map(cardMarkup).join('')}
        </div>
        <datalist id="charts-symbols"><option value="FX:EURUSD"><option value="FX:GBPUSD"><option value="OANDA:XAUUSD"><option value="NASDAQ:AAPL"><option value="BINANCE:BTCUSDT"></datalist>`;
      changed();refreshWidgets();
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
      event.preventDefault();capture();mountChart(event.target.closest('[data-chart-id]'));changed();
    });
    host.addEventListener('input',event=>{
      if(!event.target.matches('[data-chart-field]'))return;
      capture();changed();
      const card=event.target.closest('[data-chart-id]');
      if(event.target.dataset.chartField==='responsibility'&&expanded===card)card.setAttribute('aria-label','Chart · '+event.target.value);
    });
    host.addEventListener('change',event=>{
      if(event.target.matches('[data-charts-count]')){resizeMultiple(Number(event.target.value));return}
      if(event.target.matches('[data-charts-setting]')){
        prefs[event.target.dataset.chartsSetting]=event.target.value;changed();refreshWidgets();
      }else if(event.target.matches('[data-chart-field="interval"]')){
        capture();changed();mountChart(event.target.closest('[data-chart-id]'));
      }
    });
    host.addEventListener('click',event=>{
      const layout=event.target.closest('[data-charts-layout]');
      if(layout){if(layout.dataset.chartsLayout!==prefs.layout){capture();prefs.layout=layout.dataset.chartsLayout;render()}return}
      const button=event.target.closest('[data-charts-action]');if(!button)return;
      const action=button.dataset.chartsAction;
      if(action==='save')save();
      if(action==='expand')expand(button.closest('[data-chart-id]'));
      if(action==='retry-chart')mountChart(button.closest('[data-chart-id]'),true);
      if(action==='dismiss-status')cardMessage(button.closest('[data-chart-id]'),'');
      if(action==='reload'&&!saving){closeExpanded(false);dispose();load()}
    });
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
      hide(){capture();visible=false;closeExpanded(false);dispose();host.replaceChildren()},
      reset(){api.hide();generation++;userId=null;prefs=null;loaded=false;loading=false;saving=false;revision=null;saved=null}
    };
    return api;
  }};
})();
