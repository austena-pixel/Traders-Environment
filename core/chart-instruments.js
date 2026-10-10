/* Charts borrows the existing recording workspace; there is only one form/save path. */
(function(){
  'use strict';
  window.TIOSChartInstruments={create({getUser}){
    let workspace=null,home=null,marker=null,owner=null;
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
        // Session cleanup affects only the UI. Saved records and instrument definitions stay intact.
        workspace.querySelector('#executionMapFormBody')?.replaceChildren();
        workspace.querySelectorAll('select').forEach(field=>field.replaceChildren());
        workspace.querySelectorAll('input,textarea').forEach(field=>{field.value='';field.checked=false;});
      }
      owner=null;
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
      marker=document.createComment('Instrument recording workspace home');home.insertBefore(marker,workspace);
      host.replaceChildren();
      const note=document.createElement('p');note.className='charts-instruments-note';
      note.textContent='Select a trade and a saved instrument, complete the form, then Save. Period rules use their selected period.';
      const refresh=document.createElement('button');refresh.type='button';refresh.className='btn small';refresh.textContent='Refresh instruments';
      refresh.addEventListener('click',()=>{if(owner===getUser()?.id)document.querySelector('#executionMapRefreshBtn')?.click();});
      host.append(note,refresh,workspace);
    }
    return {mount,unmount,reset};
  }};
})();
