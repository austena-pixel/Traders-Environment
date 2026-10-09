(function(root){
  'use strict';
  const kinds=['playbook','checklist','psych'];
  const page=kind=>document.querySelector(kind==='playbook'?'#page-playbook':'#page-'+secondaryConfig(kind).page);
  const editor=kind=>kind==='playbook'?document.querySelector('#playbookDocumentEditor'):secondaryFind(kind,'[data-ti-editor]');
  const current=kind=>kind==='playbook'?currentPlaybookDocument():currentSecondaryDocument(kind);
  const fields=kind=>kind==='playbook'?{name:document.querySelector('#playbookDraftTitle'),description:document.querySelector('#playbookDraftDescription'),tags:document.querySelector('#playbookDraftTags'),state:document.querySelector('#playbookDraftState')}:{name:secondaryFind(kind,'[data-ti-title]'),description:secondaryFind(kind,'[data-ti-description]'),tags:secondaryFind(kind,'[data-ti-tags]'),state:secondaryFind(kind,'[data-ti-state]')};
  const key=kind=>kind==='playbook'?playbookDocumentKey():secondaryStoreKey(kind);
  const loadedKey=kind=>kind==='playbook'?playbookDocumentStoreKey:secondaryState(kind).storeKey;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function scope(){return String(currentUser?.id||'')+':'+String(tradingAccount?.id||'default')}
  function activeKind(){return kinds.find(kind=>page(kind)?.classList.contains('active'))||null}
  function semantic(doc){if(!doc)return 'null';const host=document.createElement('div');host.innerHTML=doc.documentHtml||'';host.querySelectorAll('.pb-doc-remove-btn,[data-instrument-remove-reflection]').forEach(x=>x.remove());return JSON.stringify({id:doc.id,name:doc.name,description:doc.description||'',documentHtml:host.innerHTML,tags:doc.tags||[],instrumentState:doc.instrumentState||'draft',strategyVersion:doc.strategyVersion||0,strategyVersionId:doc.strategyVersionId||'',templateDraft:Boolean(doc.templateDraft)})}
  function stored(kind,id){try{return JSON.parse(localStorage.getItem(key(kind))||'[]').find(x=>x.id===id)||null}catch{throw Error('The instrument store could not be read. Keep your current draft and try again.')}}
  function collect(kind){return kind==='playbook'?collectPlaybookDocumentFromEditor():collectSecondaryDocument(kind)}
  function flush(kind){
    if(kind==='playbook')clearTimeout(playbookDocumentSaveTimer);else clearTimeout(secondaryState(kind).saveTimer);
    if(root.TIOSAIBuilderClient?.isPreview(kind))return;
    const item=current(kind),saved=stored(kind,item?.id),draft=collect(kind);
    if(semantic(draft)===semantic(saved))return;
    if(saved&&semantic(saved)!==semantic(item)&&Date.parse(saved.updatedAt)>Date.parse(item?.updatedAt||''))throw Error('A newer saved edit was found. Reload this instrument before asking AI to edit it.');
    if(kind==='playbook')savePlaybookDocument({quiet:true});else saveSecondaryDocument(kind,{quiet:true});
  }
  function capture(kind,{save=false}={}){
    if(current(kind)&&loadedKey(kind)!==key(kind))throw Error('This account context is still loading. Reopen the instrument before using AI.');
    if(save)flush(kind);
    const item=collect(kind)||{id:null,name:'',description:'',documentHtml:'',tags:[],instrumentState:'draft',strategyVersion:0,strategyVersionId:''};
    return {kind,scope:scope(),id:item.id,doc:clone(item),semantic:semantic(item),stored:semantic(stored(kind,item.id)),storageKey:key(kind)};
  }
  function sameContext(snapshot){return snapshot.scope===scope()&&snapshot.id===(current(snapshot.kind)?.id||null)&&snapshot.storageKey===key(snapshot.kind)&&(!current(snapshot.kind)||loadedKey(snapshot.kind)===snapshot.storageKey)}
  function unchanged(snapshot,{preview=false}={}){return sameContext(snapshot)&&semantic(stored(snapshot.kind,snapshot.id))===snapshot.stored&&(preview||semantic(collect(snapshot.kind))===snapshot.semantic)}
  function display(kind,doc,readonly=false){
    const controls=fields(kind),body=editor(kind);if(!body)return;
    controls.name.value=doc.name||'';controls.description.value=doc.description||'';controls.tags.value=(doc.tags||[]).join(', ');controls.state.value=doc.instrumentState||'draft';
    body.innerHTML=doc.documentHtml||'';body.contentEditable=readonly?'false':'true';
    page(kind).classList.toggle('ti-ai-preview',readonly);
    for(const control of Object.values(controls)){if(control){if(readonly){if(!control.hasAttribute('data-ti-ai-disabled-before'))control.dataset.tiAiDisabledBefore=String(control.disabled);control.disabled=true}else if(control.hasAttribute('data-ti-ai-disabled-before')){control.disabled=control.dataset.tiAiDisabledBefore==='true';delete control.dataset.tiAiDisabledBefore}}}
    const saveButton=page(kind).querySelector(kind==='playbook'?'#playbookDraftSaveBtn':'[data-ti-action="save"]');if(saveButton)saveButton.disabled=readonly||!current(kind);
    if(kind==='playbook'){if(!readonly)ensurePlaybookBlockControls();updatePlaybookWordCount();renderPlaybookExecutionPreview()}
    else {if(!readonly)ensureSecondaryBlockControls(kind);renderSecondaryPreview(kind)}
    const status=page(kind).querySelector(kind==='playbook'?'#playbookDraftSaveState':'[data-ti-save-state]');
    if(status)status.textContent=readonly?'AI proposal · not saved':current(kind)?.templateDraft?'Template draft · click Save to use in Execution Quality':'Saved';
    hydratePlaybookImages(body);
  }
  function release(kind){
    page(kind)?.classList.remove('ti-ai-preview');
    for(const control of Object.values(fields(kind)))if(control?.hasAttribute('data-ti-ai-disabled-before')){control.disabled=control.dataset.tiAiDisabledBefore==='true';delete control.dataset.tiAiDisabledBefore}
    if(editor(kind))editor(kind).contentEditable=current(kind)?'true':'false';
    const saveButton=page(kind)?.querySelector(kind==='playbook'?'#playbookDraftSaveBtn':'[data-ti-action="save"]');if(saveButton)saveButton.disabled=!current(kind);
  }
  function restore(snapshot){
    release(snapshot.kind);if(!sameContext(snapshot))return;
    const latest=stored(snapshot.kind,snapshot.id);
    const doc=semantic(latest)!==snapshot.stored&&latest?latest:snapshot.doc;
    if(latest&&semantic(latest)!==snapshot.stored){
      if(snapshot.kind==='playbook')playbookDocuments=playbookDocuments.map(d=>d.id===latest.id?normalizePlaybookDocument(latest):d);
      else secondaryState(snapshot.kind).docs=secondaryState(snapshot.kind).docs.map(d=>d.id===latest.id?secondaryNormalizeDoc(snapshot.kind,latest):d);
    }
    display(snapshot.kind,doc,false);
  }
  function replace(kind,doc){
    if(kind==='playbook'){playbookDocuments=playbookDocuments.map(item=>item.id===doc.id?clone(doc):item);persistPlaybookDocuments();renderPlaybookDocumentEditor();renderPlaybookExecutionPreview()}
    else {const state=secondaryState(kind);state.docs=state.docs.map(item=>item.id===doc.id?clone(doc):item);persistSecondaryDocuments(kind);renderSecondaryDocument(kind)}
  }
  function apply(snapshot,draft,isNew){
    if(!unchanged(snapshot,{preview:true}))throw Error('A newer edit or instrument selection was found. Discard this proposal and prepare it again.');
    const before=clone(snapshot.doc);
    if(isNew){
      if(snapshot.kind==='playbook')createPlaybookDocument({silent:true,template:{name:draft.name,documentHtml:draft.documentHtml}});
      else createSecondaryDocument(snapshot.kind,{silent:true,template:{name:draft.name,documentHtml:draft.documentHtml}});
    }
    const selected=current(snapshot.kind);if(!selected)throw Error('Create or select an instrument before applying changes.');
    const next={...selected,...draft,id:selected.id,createdAt:selected.createdAt,updatedAt:new Date().toISOString(),templateDraft:false,templateSaveConfirmed:true,strategyVersion:(isNew?0:Number(before.strategyVersion)||0)+1,strategyVersionId:crypto.randomUUID()};
    replace(snapshot.kind,next);
    display(snapshot.kind,next,false);
    const finalized=collect(snapshot.kind);
    replace(snapshot.kind,finalized);
    return {kind:snapshot.kind,scope:scope(),before,after:clone(finalized),isNew,previousSelectedId:snapshot.id,storageKey:key(snapshot.kind)};
  }
  function undo(entry){
    if(entry.scope!==scope()||entry.storageKey!==key(entry.kind)||(current(entry.kind)?.id||null)!==entry.after.id||semantic(collect(entry.kind))!==semantic(entry.after)||semantic(stored(entry.kind,entry.after.id))!==semantic(entry.after))throw Error('This instrument has newer edits. Undo was stopped to protect them.');
    if(entry.isNew){
      if(entry.kind==='playbook'){playbookDocuments=playbookDocuments.filter(d=>d.id!==entry.after.id);selectedPlaybookDocumentId=entry.previousSelectedId||playbookDocuments[0]?.id||null;persistPlaybookDocuments();renderPlaybookDocumentEditor();renderPlaybookExecutionPreview()}
      else {const state=secondaryState(entry.kind);state.docs=state.docs.filter(d=>d.id!==entry.after.id);state.selectedId=entry.previousSelectedId||state.docs[0]?.id||null;persistSecondaryDocuments(entry.kind);renderSecondaryDocument(entry.kind)}
    }else replace(entry.kind,entry.before);
  }
  async function token(){
    if(!currentUser?.id||document.querySelector('#appShell')?.classList.contains('hidden'))throw Error('Sign in to T-IOS before using the AI Builder.');
    const identity=scope();const {data,error}=await db.auth.getSession();
    if(error||!data?.session?.access_token||data.session.user?.id!==currentUser.id||identity!==scope())throw Error('Your session expired. Sign in again before using the AI Builder.');
    return data.session.access_token;
  }
  root.TIOSAIWorkspace=Object.freeze({page,editor,current,activeKind,scope,capture,unchanged,sameContext,display,release,restore,apply,undo,token,semantic,flush,
    userId:()=>currentUser?.id||null,identity:kind=>scope()+':'+kind+':'+(current(kind)?.id||'new'),navigate:kind=>switchTechnicalInstrumentBuilder(kind)});
})(window);
