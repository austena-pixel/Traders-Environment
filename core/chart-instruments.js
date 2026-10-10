/* Charts > Instruments: one selected section at a time.
   Reuses the existing Execution Quality DOM and its only save path. */
(function(){
  'use strict';
  window.TIOSChartInstruments={create({getUser}){
    let workspace=null,home=null,marker=null,owner=null;
    let activeTab='trades',periodScope='session';
    const iconSvg={
      trades:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6M8 9h8M8 13h8M8 17h5"/>',
      playbook:'<path d="M12 6c-2.5-2-5-2-9-1.5v14c4-.5 6.5-.5 9 1.5 2.5-2 5-2 9-1.5v-14C17 4 14.5 4 12 6zM12 6v14"/>',
      rules:'<path d="m4 7 2 2 3-4M12 7h8M4 15l2 2 3-4M12 15h8"/>',
      psych:'<path d="M12 5a4 4 0 0 0-7 2 4 4 0 0 0-1 7 4 4 0 0 0 5 5c1 0 2-.5 3-2 1 1.5 2 2 3 2a4 4 0 0 0 5-5 4 4 0 0 0-1-7 4 4 0 0 0-7-2v13M8 10l-2 2m10-2 2 2"/>',
      period:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M7 17h3M13 14h4"/>'
    };
    const tabs=[
      {id:'trades',label:'Trades',help:'Trade list and details'},
      {id:'playbook',label:'Playbooks',help:'Playbook execution checklist'},
      {id:'rules',label:'Trade Rules',help:'Rules for the selected trade'},
      {id:'psych',label:'Psychology',help:'Psychological reflection'},
      {id:'period',label:'Period Rules',help:'Session, daily, weekly or monthly rules'}
    ];
    const scopes=['session','daily','weekly','monthly'];
    function unmount({capture=true}={}){
      if(!marker)return;
      if(capture&&owner===getUser()?.id)window.captureExecutionMappingReflectionDraft?.();
      if(marker.parentNode)marker.replaceWith(workspace);
      else if(home?.isConnected)home.appendChild(workspace);
      marker=null;
    }
    function reset(){
      unmount({capture:false});
      if(owner&&workspace){
        // A session reset clears UI only, not saved instrument records.
        workspace.querySelector('#executionMapFormBody')?.replaceChildren();
        workspace.querySelectorAll('select').forEach(field=>field.replaceChildren());
        workspace.querySelectorAll('input,textarea').forEach(field=>{field.value='';field.checked=false;});
      }
      owner=null;activeTab='trades';periodScope='session';
    }
    function activateExistingInstrument(tab){
      if(tab==='trades')return;
      const target=tab==='playbook'
        ? workspace.querySelector('[data-execution-map-instrument="playbook"]')
        : tab==='rules'
          ? workspace.querySelector('[data-execution-map-instrument="checklist"]:not([data-execution-map-rule-scope])')
          : tab==='psych'
            ? workspace.querySelector('[data-execution-map-instrument="psych"]')
            : workspace.querySelector('[data-execution-map-rule-scope="'+periodScope+'"]');
      // Dispatch to the original delegated click handler (works when View is disabled).
      if(target)target.click();
    }
    function setActive(host,tab,{activate=true}={}){
      const current=tabs.find(item=>item.id===tab);
      if(!current||owner!==getUser()?.id||!host.isConnected)return;
      activeTab=tab;
      if(activate)activateExistingInstrument(tab);
      host.dataset.instrumentTab=tab;
      host.dataset.instrumentScope=periodScope;
      const missing=tab==='period'&&!workspace.querySelector('[data-execution-map-rule-scope="'+periodScope+'"]');
      host.dataset.periodEmpty=String(missing);
      const heading=host.querySelector('[data-charts-instrument-heading]');
      const help=host.querySelector('[data-charts-instrument-help]');
      if(heading)heading.textContent=current.label;
      if(help)help.textContent=current.help;
      const empty=host.querySelector('[data-charts-instrument-empty]');
      if(empty)empty.textContent='No '+periodScope+' rules are saved. Create them under Technical Instruments.';
      host.querySelectorAll('[data-charts-instrument-tab]').forEach(button=>{
        const selected=button.dataset.chartsInstrumentTab===tab;
        button.classList.toggle('active',selected);
        button.setAttribute('aria-pressed',String(selected));
      });
      host.querySelectorAll('[data-charts-instrument-scope]').forEach(button=>{
        const selected=button.dataset.chartsInstrumentScope===periodScope;
        button.classList.toggle('active',selected);
        button.setAttribute('aria-pressed',String(selected));
      });
      const scroll=host.closest('.charts-panel-scroll');
      if(scroll)scroll.scrollTop=0;
    }
    function mount(host){
      const id=getUser()?.id;
      if(!id||!host?.isConnected)throw Error('The signed-in recording workspace is unavailable.');
      if(owner&&owner!==id)reset();
      unmount();
      workspace=document.querySelector('#page-execution .execution-map-layout');
      if(!workspace||typeof window.renderExecutionMappingWorkspace!=='function')throw Error('The existing instrument recording workspace is unavailable.');
      window.renderExecutionMappingWorkspace();
      owner=id;home=workspace.parentNode;
      marker=document.createComment('Instrument recording workspace home');
      home.insertBefore(marker,workspace);

      const rail=document.createElement('nav');
      rail.className='charts-instrument-icon-rail';
      rail.setAttribute('aria-label','Instrument categories');
      tabs.forEach((item,i)=>{
        if(i===1){
          const separator=document.createElement('span');
          separator.className='charts-instrument-icon-divider';separator.setAttribute('aria-hidden','true');
          rail.appendChild(separator);
        }
        const button=document.createElement('button');
        button.type='button';button.className='charts-instrument-icon-btn';
        button.dataset.chartsInstrumentTab=item.id;
        button.title=item.label;button.setAttribute('aria-label',item.label);
        button.setAttribute('aria-pressed','false');
        button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+iconSvg[item.id]+'</svg>';
        button.addEventListener('click',()=>setActive(host,item.id));
        rail.appendChild(button);
      });
      const stage=document.createElement('section');
      stage.className='charts-instrument-selected';
      stage.setAttribute('aria-label','Selected instrument category');
      const header=document.createElement('header');
      header.className='charts-instrument-selected-head';
      const titleBox=document.createElement('div');
      const title=document.createElement('strong');title.dataset.chartsInstrumentHeading='';
      const help=document.createElement('small');help.dataset.chartsInstrumentHelp='';
      titleBox.append(title,help);
      const refresh=document.createElement('button');
      refresh.className='charts-instrument-refresh-btn';refresh.type='button';refresh.title='Refresh instruments';
      refresh.setAttribute('aria-label','Refresh instruments');refresh.textContent='↻';
      refresh.addEventListener('click',()=>{
        if(owner!==getUser()?.id)return;
        document.querySelector('#executionMapRefreshBtn')?.click();
        setActive(host,activeTab);
      });
      header.append(titleBox,refresh);
      const scopeStrip=document.createElement('div');
      scopeStrip.className='charts-instrument-period-scopes';
      scopeStrip.setAttribute('role','group');scopeStrip.setAttribute('aria-label','Period rule type');
      scopes.forEach(scope=>{
        const button=document.createElement('button');button.type='button';
        button.dataset.chartsInstrumentScope=scope;
        button.textContent=scope[0].toUpperCase()+scope.slice(1);
        button.setAttribute('aria-pressed','false');
        button.addEventListener('click',()=>{periodScope=scope;setActive(host,'period');});
        scopeStrip.appendChild(button);
      });
      const empty=document.createElement('p');
      empty.className='charts-instrument-empty';
      empty.dataset.chartsInstrumentEmpty='';
      stage.append(header,scopeStrip,workspace,empty);
      host.replaceChildren(rail,stage);
      setActive(host,activeTab);
    }
    return {mount,unmount,reset};
  }};
})();