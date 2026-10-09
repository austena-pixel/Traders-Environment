(function(root){
  'use strict';
  const workspace=root.TIOSAIWorkspace,documents=root.TIOSAIDocument,contract=root.TIOSAIContract;
  const cache=new Map(),panels=new Map(),undoEntries=[];
  let preview=null,request=null,user=null;
  const label={playbook:'Playbook',checklist:'Rules',psych:'Psychological Reflection'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value};
  function session(kind){const id=workspace.identity(kind);if(!cache.has(id))cache.set(id,{history:[],draft:''});return cache.get(id)}
  function isPreview(kind){return Boolean(preview?.snapshot.kind===kind&&workspace.sameContext(preview.snapshot))}
  function restorePreview(){
    if(!preview)return;
    const previous=preview;preview=null;
    workspace.restore(previous.snapshot);
    update(previous.snapshot.kind);
  }
  function abort(){if(request){request.controller.abort();request=null}for(const kind of panels.keys())update(kind)}
  function beforeNavigate(page){
    const target=page==='playbook'?'playbook':page==='checklists'?'checklist':page==='reflections'?'psych':null;
    if(request&&request.kind!==target)abort();
    if(preview&&preview.snapshot.kind!==target)restorePreview();
  }
  function append(kind,role,message){const state=session(kind);state.history.push({role,content:String(message).slice(0,4000)});if(state.history.length>40)state.history.splice(0,state.history.length-40);renderHistory(kind)}
  function renderHistory(kind){
    const panel=panels.get(kind);if(!panel)return;const log=panel.querySelector('[data-ai-messages]'),state=session(kind);
    log.replaceChildren();
    if(!state.history.length){const welcome=document.createElement('p');welcome.className='ti-ai-welcome';welcome.textContent='Describe your method, rules, reflection or scoring structure. I will ask about unclear requirements and show proposed changes before saving.';log.append(welcome)}
    for(const message of state.history){const el=document.createElement('div');el.className='ti-ai-message '+message.role;const who=document.createElement('small');who.textContent=message.role==='user'?'You':'AI Builder';const content=document.createElement('p');content.textContent=message.content;el.append(who,content);log.append(el)}
    log.scrollTop=log.scrollHeight;
  }
  function update(kind){
    const panel=panels.get(kind);if(!panel)return;
    const busy=request?.kind===kind,proposed=isPreview(kind),entry=undoEntries.at(-1);
    panel.querySelector('[data-ai-send]').disabled=busy||!panel.querySelector('textarea').value.trim();
    panel.querySelector('textarea').disabled=Boolean(busy);
    panel.querySelector('[data-ai-cancel]').hidden=!busy;
    panel.querySelector('[data-ai-proposal]').hidden=!proposed;
    panel.querySelector('[data-ai-undo]').disabled=!entry||entry.scope!==workspace.scope()||entry.after.id!==workspace.current(kind)?.id||Boolean(preview)||Boolean(request);
    text(panel.querySelector('[data-ai-state]'),busy?'Preparing a structured proposal…':proposed?'Unsaved preview · review the Workspace and Live Model':'Changes need your approval');
    if(proposed)text(panel.querySelector('[data-ai-summary]'),(preview.isNew?'Create':'Edit')+' '+label[kind]+': '+preview.draft.name+' · '+preview.operations+' proposed change'+(preview.operations===1?'':'s'));
    text(panel.querySelector('[data-ai-context]'),label[kind]+' · '+(workspace.current(kind)?.name||'New instrument'));
  }
  function error(kind,message){const panel=panels.get(kind);if(panel){text(panel.querySelector('[data-ai-error]'),message);panel.querySelector('[data-ai-error]').hidden=false}}
  function clearError(kind){const panel=panels.get(kind);if(panel)panel.querySelector('[data-ai-error]').hidden=true}
  async function send(kind){
    if(request)return;const panel=panels.get(kind),input=panel.querySelector('textarea'),message=input.value.trim();if(!message)return;
    clearError(kind);
    let auth;try{auth=await workspace.token()}catch(failure){error(kind,failure.message);return}
    if(workspace.activeKind()!==kind)return;
    const state=session(kind),history=state.history.slice(-10);
    let snapshot;try{snapshot=isPreview(kind)?preview.snapshot:workspace.capture(kind,{save:true})}catch(failure){error(kind,failure.message);return}
    const working=isPreview(kind)?preview.draft:snapshot.doc;
    const inheritedCreate=isPreview(kind)&&preview.isNew;
    const identity=workspace.identity(kind),scope=workspace.scope(),controller=new AbortController(),run={kind,identity,controller};request=run;
    let errorKind=kind,moved=false;
    append(kind,'user',message);input.value='';state.draft='';update(kind);
    try{
      const response=await fetch('/api/tios-ai-builder',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify({message,history,context:{kind,name:working.name,description:working.description||'',blocks:documents.summarize(working.documentHtml),unapprovedNewInstrument:Boolean(inheritedCreate)}}),signal:controller.signal});
      let result;try{result=await response.json()}catch{throw Error('The AI service is unavailable. Try again later; your instrument was not changed.')}
      if(request!==run||identity!==workspace.identity(kind))return;
      if(!response.ok)throw Error(result.error?.message||'The AI service could not prepare the instrument.');
      const answer={message:result.message,questions:result.questions,proposal:result.proposal};
      if(contract.validateResponse(answer).length)throw Error('The AI response failed validation. No changes were saved.');
      if(!workspace.unchanged(snapshot,{preview:isPreview(kind)}))throw Error('Your instrument changed while AI was responding. Ask again using the current version.');
      append(kind,'assistant',answer.message+(answer.questions.length?'\n\n'+answer.questions.join('\n'):''));
      if(answer.proposal){
        const proposal=answer.proposal;
        if(proposal.intent==='edit'&&proposal.kind!==kind)throw Error('The AI attempted to edit a different instrument. No changes were saved.');
        let targetKind=kind,targetSnapshot=snapshot,targetWorking=working;
        if(proposal.kind!==kind){
          if(proposal.intent!=='create')throw Error('Only the active instrument can be edited.');
          const savedHistory=session(kind).history.slice();request=null;restorePreview();workspace.navigate(proposal.kind);targetKind=proposal.kind;errorKind=targetKind;moved=true;ensure(targetKind);open(targetKind);session(targetKind).history=savedHistory;
          targetSnapshot=workspace.capture(targetKind,{save:true});targetWorking=targetSnapshot.doc;
        }
        const draft=documents.compile(targetWorking,proposal);
        preview={snapshot:targetSnapshot,draft,isNew:proposal.intent==='create'||Boolean(inheritedCreate&&targetKind===kind),operations:proposal.operations.length};
        workspace.display(targetKind,draft,true);renderHistory(targetKind);update(targetKind);
      }
      const service=panel.querySelector('[data-ai-service]');text(service,'Live AI response · '+(result.service?.model||'AI Gateway'));
    }catch(failure){if(failure.name!=='AbortError'&&scope===workspace.scope()&&(request===run||moved)){error(errorKind,failure.message);const state=session(errorKind);state.draft=message;panels.get(errorKind).querySelector('textarea').value=message}}
    finally{if(request===run)request=null;update(kind)}
  }
  function apply(kind){
    if(!isPreview(kind)||request)return;clearError(kind);
    const proposed=preview;
    try{
      // Drop the preview guard only after the conflict check; writes follow explicit approval.
      if(!workspace.unchanged(proposed.snapshot,{preview:true}))throw Error('A newer edit was found. Discard this proposal and prepare it again.');
      preview=null;
      const history=session(kind).history.slice();
      const entry=workspace.apply(proposed.snapshot,proposed.draft,proposed.isNew);
      undoEntries.push(entry);if(undoEntries.length>10)undoEntries.shift();session(kind).history=history;
      append(kind,'assistant','Applied and saved. The Workspace, Live Model and Execution Quality use this instrument. You can continue editing manually or ask for another change.');
    }catch(failure){preview=proposed;error(kind,failure.message)}
    update(kind);
  }
  function undo(kind){clearError(kind);const entry=undoEntries.at(-1);if(!entry)return;
    try{workspace.undo(entry);undoEntries.pop();append(kind,'assistant','The previous applied AI change was undone and saved.')}catch(failure){error(kind,failure.message)}update(kind);
  }
  function open(kind){ensure(kind);const panel=panels.get(kind);panel.hidden=false;panel.querySelector('textarea').value=session(kind).draft;workspace.page(kind).querySelector('[data-ai-toggle]').setAttribute('aria-expanded','true');renderHistory(kind);update(kind);panel.querySelector('textarea').focus({preventScroll:true})}
  function close(kind){abort();if(isPreview(kind))restorePreview();const panel=panels.get(kind);if(!panel)return;panel.hidden=true;const button=workspace.page(kind).querySelector('[data-ai-toggle]');button?.setAttribute('aria-expanded','false');button?.focus({preventScroll:true})}
  function ensure(kind){
    const page=workspace.page(kind),main=page?.querySelector('.playbook-word-main');if(!main||page.querySelector('[data-ai-toggle]'))return;
    const button=document.createElement('button');button.type='button';button.className='btn ti-ai-toggle';button.dataset.aiToggle=kind;button.textContent='AI Builder Chat';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','tiAiBuilder_'+kind);
    page.querySelector('.top-actions').prepend(button);
    const panel=document.createElement('section');panel.className='ti-ai-builder';panel.id='tiAiBuilder_'+kind;panel.hidden=true;panel.setAttribute('aria-label','AI Trading Edge Builder');
    panel.innerHTML='<header class="ti-ai-head"><div><strong>AI Trading Edge Builder</strong><small data-ai-context></small></div><div><button type="button" data-ai-new title="Start a new conversation">New chat</button><button type="button" data-ai-undo disabled>Undo AI change</button><button type="button" data-ai-close aria-label="Close AI Builder">×</button></div></header><div class="ti-ai-status"><span data-ai-state></span><small data-ai-service>Server-side AI · approval required</small></div><div class="ti-ai-error" data-ai-error role="alert" hidden></div><div class="ti-ai-messages" data-ai-messages role="log" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><div class="ti-ai-proposal" data-ai-proposal hidden><span data-ai-summary></span><div><button type="button" class="primary" data-ai-apply>Apply Changes</button><button type="button" data-ai-discard>Discard Changes</button></div></div><form class="ti-ai-form"><label class="sr-only" for="tiAiInput_'+kind+'">Describe your instrument or changes</label><textarea id="tiAiInput_'+kind+'" rows="2" maxlength="4000" placeholder="Describe your strategy or a change to this instrument…"></textarea><button type="button" data-ai-cancel hidden>Stop</button><button type="submit" data-ai-send disabled>Send</button></form><small class="ti-ai-foot">Enter to send · Shift+Enter for a new line · Conversation stays in this session · Strategy profitability requires separate validation.</small>';
    main.insertBefore(panel,main.querySelector('.playbook-word-document-stage'));panels.set(kind,panel);
    button.addEventListener('click',()=>panel.hidden?open(kind):close(kind));
    panel.querySelector('[data-ai-close]').addEventListener('click',()=>close(kind));
    panel.querySelector('[data-ai-cancel]').addEventListener('click',abort);
    panel.querySelector('[data-ai-apply]').addEventListener('click',()=>apply(kind));
    panel.querySelector('[data-ai-discard]').addEventListener('click',()=>{restorePreview();append(kind,'assistant','Proposal discarded. Your saved instrument was not changed.')});
    panel.querySelector('[data-ai-undo]').addEventListener('click',()=>undo(kind));
    panel.querySelector('[data-ai-new]').addEventListener('click',()=>{abort();restorePreview();session(kind).history=[];session(kind).draft='';panel.querySelector('textarea').value='';clearError(kind);renderHistory(kind);update(kind)});
    panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();send(kind)});
    panel.querySelector('textarea').addEventListener('input',()=>{session(kind).draft=panel.querySelector('textarea').value;update(kind)});
    panel.querySelector('textarea').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send(kind)}});
    renderHistory(kind);update(kind);
  }
  function refresh(){
    const next=workspace.userId();if(next!==user){abort();preview=null;cache.clear();undoEntries.length=0;user=next;for(const [kind,panel]of panels){panel.hidden=true;panel.querySelector('textarea').value='';workspace.release(kind);workspace.page(kind)?.querySelector('[data-ai-toggle]')?.setAttribute('aria-expanded','false');clearError(kind);renderHistory(kind)}}
    if(request&&request.identity!==workspace.identity(request.kind))abort();
    if(preview&&!workspace.sameContext(preview.snapshot)){const kind=preview.snapshot.kind;preview=null;workspace.release(kind)}
    for(const kind of ['playbook','checklist','psych']){ensure(kind);update(kind)}
  }
  root.TIOSAIBuilderClient=Object.freeze({isPreview,beforeNavigate});
  for(const kind of ['playbook','checklist','psych']){const target=workspace.page(kind);if(target)new MutationObserver(refresh).observe(target,{attributes:true,attributeFilter:['class'],childList:true})}
  root.addEventListener('tios:auth-ui',refresh);root.addEventListener('storage',event=>{if(preview&&event.key===preview.snapshot.storageKey)error(preview.snapshot.kind,'This instrument changed in another tab. Discard this proposal before continuing.')});
  root.addEventListener('tios:conversation-scope-changing',()=>{abort();restorePreview();cache.clear();undoEntries.length=0;for(const [kind,panel]of panels){panel.hidden=true;panel.querySelector('textarea').value='';workspace.page(kind)?.querySelector('[data-ai-toggle]')?.setAttribute('aria-expanded','false');clearError(kind);renderHistory(kind);update(kind)}});
  refresh();
})(window);
