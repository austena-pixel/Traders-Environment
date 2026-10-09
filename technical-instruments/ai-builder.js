(function(root){
  'use strict';
  const workspace=root.TIOSAIWorkspace,documents=root.TIOSAIDocument,contract=root.TIOSAIContract,images=root.TIOSAIImages;
  const cache=new Map(),panels=new Map(),undoEntries=[];
  let preview=null,request=null,user=null,quota=null,retryTimer=null;
  const label={playbook:'Playbook',checklist:'Rules',psych:'Psychological Reflection'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value};
  function session(kind){const id=workspace.identity(kind);if(!cache.has(id))cache.set(id,{history:[],draft:'',attachments:[],references:[],preparing:0,epoch:0});return cache.get(id)}
  function isPreview(kind){return Boolean(preview?.snapshot.kind===kind&&workspace.sameContext(preview.snapshot))}
  function setMode(kind,mode){
    const page=workspace.page(kind),main=page?.querySelector('.playbook-word-main'),panel=panels.get(kind),button=page?.querySelector('[data-ai-toggle]');
    if(!main||!panel)return;
    main.classList.toggle('ti-ai-active',mode==='chat');
    main.classList.toggle('ti-ai-document-review',mode==='review');
    panel.hidden=mode!=='chat';
    button?.setAttribute('aria-expanded',String(mode==='chat'));
    text(button,mode==='chat'?'Manual editor':mode==='review'?'Back to AI chat':'AI Builder Chat');
  }
  function resizeInput(panel){
    const input=panel.querySelector('textarea');
    input.style.height='auto';input.style.height=Math.min(160,Math.max(72,input.scrollHeight))+'px';
  }
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
  function append(kind,role,message,attachments=[]){const state=session(kind);state.history.push({role,content:String(message).slice(0,4000),...(attachments.length?{images:attachments.slice()}:{})});if(state.history.length>40)state.history.splice(0,state.history.length-40);renderHistory(kind)}
  function imageCard(attachment){
    const card=document.createElement('figure');card.className='ti-ai-image';const img=document.createElement('img');img.src=attachment.dataUrl;img.alt='Reference image: '+attachment.name;const caption=document.createElement('figcaption');caption.textContent=attachment.name;card.append(img,caption);return card;
  }
  function renderAttachments(kind){
    const panel=panels.get(kind);if(!panel)return;const state=session(kind),strip=panel.querySelector('[data-ai-attachments]'),key=[workspace.identity(kind),state.preparing,state.references.length,Boolean(request?.kind===kind),...state.attachments.map(a=>a.id)].join('|');if(strip.dataset.renderKey===key)return;strip.dataset.renderKey=key;strip.replaceChildren();strip.hidden=!state.attachments.length&&!state.preparing;
    for(const attachment of state.attachments){const card=imageCard(attachment),remove=document.createElement('button');remove.type='button';remove.dataset.aiRemoveImage=attachment.id;remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+attachment.name);remove.disabled=Boolean(request?.kind===kind||state.preparing);remove.addEventListener('click',()=>{state.attachments=state.attachments.filter(a=>a.id!==attachment.id);clearError(kind);update(kind)});card.append(remove);strip.append(card)}
    if(state.preparing){const status=document.createElement('span');status.className='ti-ai-image-loading';status.textContent='Preparing pictures…';status.setAttribute('role','status');strip.append(status)}
    const count=state.references.length;text(panel.querySelector('[data-ai-image-hint]'),count?count+' reference image'+(count===1?'':'s')+' in this chat · '+(images.limits.count-count)+' more available':'PNG, JPG or WebP · up to 3 per chat · 12 MB each');
  }
  async function attach(kind,files){
    const state=session(kind),identity=workspace.identity(kind),epoch=state.epoch;if(request||state.preparing||!files.length)return;
    clearError(kind);if(state.references.length+state.attachments.length+files.length>images.limits.count){error(kind,'Use up to 3 reference images per conversation. Remove an attachment or start New chat.');return}
    state.preparing=files.length;update(kind);
    try{for(const file of files){const attachment=await images.prepare(file);if(cache.get(identity)!==state||state.epoch!==epoch||workspace.identity(kind)!==identity)return;state.attachments.push({...attachment,id:crypto.randomUUID()});state.preparing--;update(kind)}}
    catch(failure){if(cache.get(identity)===state&&state.epoch===epoch&&workspace.identity(kind)===identity)error(kind,failure.message)}
    finally{if(cache.get(identity)===state&&state.epoch===epoch){state.preparing=0;update(kind)}}
  }
  function renderHistory(kind){
    const panel=panels.get(kind);if(!panel)return;const log=panel.querySelector('[data-ai-messages]'),state=session(kind);
    log.replaceChildren();
    if(!state.history.length){const welcome=document.createElement('p');welcome.className='ti-ai-welcome';welcome.textContent='Describe your edge or attach a chart, diagram or handwritten notes. I will ask about unclear details and turn your method into proposed changes for you to review.';log.append(welcome)}
    for(const message of state.history){const el=document.createElement('div');el.className='ti-ai-message '+message.role;const who=document.createElement('small');who.textContent=message.role==='user'?'You':'AI Builder';const content=document.createElement('p');content.textContent=message.content;el.append(who,content);if(message.images?.length){const gallery=document.createElement('div');gallery.className='ti-ai-message-images';message.images.forEach(attachment=>gallery.append(imageCard(attachment)));el.append(gallery)}log.append(el)}
    log.scrollTop=log.scrollHeight;
  }
  function update(kind){
    const panel=panels.get(kind);if(!panel)return;
    const busy=request?.kind===kind,proposed=isPreview(kind),entry=undoEntries.at(-1),state=session(kind),identity=workspace.identity(kind);
    if(panel.dataset.aiIdentity!==identity){panel.dataset.aiIdentity=identity;panel.querySelector('textarea').value=state.draft;renderHistory(kind)}
    renderAttachments(kind);
    const main=panel.closest('.playbook-word-main');
    if(!proposed&&main.classList.contains('ti-ai-document-review'))setMode(kind,'chat');
    main.querySelector('[data-ai-review-apply]').disabled=!proposed||Boolean(busy);
    panel.querySelector('[data-ai-review]').disabled=Boolean(busy);
    panel.querySelector('[data-ai-messages]').setAttribute('aria-busy',String(Boolean(busy)));
    if(!panel.hidden)resizeInput(panel);
    const remaining=quotaRemaining();
    panel.querySelector('[data-ai-send]').disabled=Boolean(busy||state.preparing||remaining||(!panel.querySelector('textarea').value.trim()&&!state.attachments.length));
    text(panel.querySelector('[data-ai-send]'),remaining?'Retry in '+retryLabel(remaining):'Send');
    panel.querySelector('[data-ai-attach]').disabled=Boolean(busy||state.preparing||state.references.length+state.attachments.length>=images.limits.count);
    panel.querySelector('[data-ai-file]').disabled=Boolean(busy||state.preparing);
    panel.querySelector('textarea').disabled=Boolean(busy);
    panel.querySelector('[data-ai-cancel]').hidden=!busy;
    panel.querySelector('[data-ai-proposal]').hidden=!proposed;
    panel.querySelector('[data-ai-undo]').disabled=!entry||entry.scope!==workspace.scope()||entry.after.id!==workspace.current(kind)?.id||Boolean(preview)||Boolean(request);
    text(panel.querySelector('[data-ai-state]'),busy?'Reading your request and preparing a proposal…':state.preparing?'Preparing pictures…':remaining?'Request limit · you can retry in '+retryLabel(remaining):proposed?'Unsaved proposal · review the Live Model or document':'Changes need your approval');
    if(proposed)text(panel.querySelector('[data-ai-summary]'),(preview.isNew?'Create':'Edit')+' '+label[kind]+': '+preview.draft.name+' · '+preview.operations+' proposed change'+(preview.operations===1?'':'s'));
    text(panel.querySelector('[data-ai-context]'),label[kind]+' · '+(workspace.current(kind)?.name||'New instrument'));
  }
  function quotaRemaining(){return quota?.user===workspace.userId()?Math.max(0,Math.ceil((quota.until-Date.now())/1000)):0}
  function retryLabel(seconds){return seconds>=3600?Math.ceil(seconds/3600)+'h':seconds>=60?Math.ceil(seconds/60)+'m':seconds+'s'}
  function clearQuota(){quota=null;if(retryTimer){clearInterval(retryTimer);retryTimer=null}}
  function holdQuota(seconds){
    clearQuota();quota={user:workspace.userId(),until:Date.now()+Math.min(86400,Math.ceil(seconds))*1000};
    retryTimer=setInterval(()=>{if(!quotaRemaining()){clearQuota();for(const [kind,panel]of panels)if(panel.querySelector('[data-ai-error]').dataset.errorCode==='usage_limit')clearError(kind)}for(const kind of panels.keys())update(kind)},1000);
    return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:seconds>60?'short':'medium'}).format(new Date(quota.until));
  }
  function error(kind,message,code=''){const panel=panels.get(kind);if(panel){const target=panel.querySelector('[data-ai-error]');text(target,message);target.dataset.errorCode=code;target.hidden=false}}
  function clearError(kind){const panel=panels.get(kind);if(panel){const target=panel.querySelector('[data-ai-error]');target.hidden=true;delete target.dataset.errorCode}}
  async function send(kind){
    if(request||quotaRemaining())return;const panel=panels.get(kind),input=panel.querySelector('textarea'),message=input.value.trim(),state=session(kind),added=state.attachments.slice();if(state.preparing||(!message&&!added.length))return;
    clearError(kind);
    const identity=workspace.identity(kind),scope=workspace.scope(),epoch=state.epoch,controller=new AbortController(),run={kind,identity,controller};request=run;update(kind);
    let errorKind=kind,moved=false;
    try{
      const auth=await workspace.token();if(request!==run||identity!==workspace.identity(kind)||workspace.activeKind()!==kind||state.epoch!==epoch)return;
      const history=state.history.slice(-10).map(({role,content})=>({role,content})),snapshot=isPreview(kind)?preview.snapshot:workspace.capture(kind,{save:true});
      const working=isPreview(kind)?preview.draft:snapshot.doc,inheritedCreate=isPreview(kind)&&preview.isNew;
      const references=images.validate([...state.references,...added].map(({name,dataUrl})=>({name,dataUrl})));
      state.references=[...state.references,...added];state.attachments=[];
      append(kind,'user',message||'Build my instrument from these reference images.',added);input.value='';state.draft='';update(kind);
      const response=await fetch('/api/tios-ai-builder',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify({message,history,...(references.length?{images:references}:{}),context:{kind,name:working.name,description:working.description||'',blocks:documents.summarize(working.documentHtml),unapprovedNewInstrument:Boolean(inheritedCreate)}}),signal:controller.signal});
      let result;try{result=await response.json()}catch{throw Error('The AI service is unavailable. Try again later; your instrument was not changed.')}
      if(request!==run||identity!==workspace.identity(kind))return;
      if(!response.ok){const failure=Error(result.error?.message||'The AI service could not prepare the instrument.');failure.code=result.error?.code;const retryAfter=Number(result.error?.retryAfter||response.headers.get('Retry-After'));if(failure.code==='usage_limit'&&Number.isFinite(retryAfter)&&retryAfter>0)failure.message+=' Try again at '+holdQuota(retryAfter)+'. Your pictures and draft are kept.';throw failure}
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
          const savedHistory=state.history.slice(),savedReferences=state.references.slice();request=null;restorePreview();cache.delete(identity);workspace.navigate(proposal.kind);targetKind=proposal.kind;errorKind=targetKind;moved=true;ensure(targetKind);open(targetKind);Object.assign(session(targetKind),{history:savedHistory,references:savedReferences});
          targetSnapshot=workspace.capture(targetKind,{save:true});targetWorking=targetSnapshot.doc;
        }
        const draft=documents.compile(targetWorking,proposal);
        preview={snapshot:targetSnapshot,draft,isNew:proposal.intent==='create'||Boolean(inheritedCreate&&targetKind===kind),operations:proposal.operations.length};
        workspace.display(targetKind,draft,true);renderHistory(targetKind);update(targetKind);
      }
      text(panel.querySelector('[data-ai-service]'),'AI connected');
    }catch(failure){if(failure.name!=='AbortError'&&scope===workspace.scope()&&(request===run||moved)){error(errorKind,failure.message,failure.code);const current=session(errorKind);current.draft=message||(current.references.length?'Build from these reference images.':'');panels.get(errorKind).querySelector('textarea').value=current.draft}}
    finally{if(request===run)request=null;update(kind)}
  }
  function apply(kind){
    if(!isPreview(kind)||request)return;clearError(kind);
    const proposed=preview;
    try{
      // Drop the preview guard only after the conflict check; writes follow explicit approval.
      if(!workspace.unchanged(proposed.snapshot,{preview:true}))throw Error('A newer edit was found. Discard this proposal and prepare it again.');
      preview=null;
      const state=session(kind),identity=workspace.identity(kind),history=state.history.slice(),references=state.references.slice();
      const entry=workspace.apply(proposed.snapshot,proposed.draft,proposed.isNew);
      if(proposed.isNew&&identity!==workspace.identity(kind))cache.delete(identity);
      undoEntries.push(entry);if(undoEntries.length>10)undoEntries.shift();Object.assign(session(kind),{history,references});
      append(kind,'assistant','Applied and saved. The Workspace, Live Model and Execution Quality use this instrument. You can continue editing manually or ask for another change.');
    }catch(failure){preview=proposed;error(kind,failure.message)}
    update(kind);
  }
  function undo(kind){clearError(kind);const entry=undoEntries.at(-1);if(!entry)return;
    try{workspace.undo(entry);undoEntries.pop();append(kind,'assistant','The previous applied AI change was undone and saved.')}catch(failure){error(kind,failure.message)}update(kind);
  }
  function open(kind){ensure(kind);const panel=panels.get(kind);setMode(kind,'chat');panel.querySelector('textarea').value=session(kind).draft;resizeInput(panel);renderHistory(kind);update(kind);panel.querySelector('textarea').focus({preventScroll:true})}
  function close(kind){abort();if(isPreview(kind))restorePreview();setMode(kind,'manual');workspace.page(kind)?.querySelector('[data-ai-toggle]')?.focus({preventScroll:true})}
  function ensure(kind){
    const page=workspace.page(kind),main=page?.querySelector('.playbook-word-main');if(!main||page.querySelector('[data-ai-toggle]'))return;
    const button=document.createElement('button');button.type='button';button.className='btn ti-ai-toggle';button.dataset.aiToggle=kind;button.textContent='AI Builder Chat';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','tiAiBuilder_'+kind);
    page.querySelector('.top-actions').prepend(button);
    const panel=document.createElement('section');panel.className='ti-ai-builder';panel.id='tiAiBuilder_'+kind;panel.hidden=true;panel.setAttribute('aria-label','AI Trading Edge Builder');
    panel.innerHTML='<header class="ti-ai-head"><div><strong>AI Trading Edge Builder</strong><small data-ai-context></small></div><div><button type="button" data-ai-new title="Start a new conversation">New chat</button><button type="button" data-ai-undo disabled>Undo AI change</button><button type="button" data-ai-close aria-label="Close AI Builder">×</button></div></header><div class="ti-ai-status"><span data-ai-state></span><small data-ai-service>Server-side AI · approval required</small></div><div class="ti-ai-error" data-ai-error role="alert" hidden></div><div class="ti-ai-messages" data-ai-messages role="log" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><div class="ti-ai-proposal" data-ai-proposal hidden><span data-ai-summary></span><div><button type="button" class="primary" data-ai-apply>Apply Changes</button><button type="button" data-ai-discard>Discard Changes</button></div></div><div class="ti-ai-attachments" data-ai-attachments aria-label="Images ready to send" hidden></div><form class="ti-ai-form"><label class="sr-only" for="tiAiInput_'+kind+'">Describe your instrument or changes</label><textarea id="tiAiInput_'+kind+'" rows="2" maxlength="4000" placeholder="Describe your edge, ask a question, or attach a picture…"></textarea><input type="file" data-ai-file accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Choose reference images"><div class="ti-ai-composer-actions"><button type="button" data-ai-attach>Attach images</button><small data-ai-image-hint></small><button type="button" data-ai-cancel hidden>Stop</button><button type="submit" data-ai-send disabled>Send</button></div></form><small class="ti-ai-foot">Enter to send · Shift+Enter for a new line · Conversation stays in this session · Strategy profitability requires separate validation.</small>';
    main.insertBefore(panel,main.querySelector('.playbook-word-document-stage'));panels.set(kind,panel);
    // Document selection replaces the editor contents without changing the page's active class.
    // Observe that boundary so requests and image previews immediately follow the selected document.
    const body=workspace.editor(kind);if(body)new MutationObserver(refresh).observe(body,{childList:true});
    const manual=panel.querySelector('[data-ai-close]');manual.textContent='Manual editor';manual.setAttribute('aria-label','Return to manual editor');
    text(panel.querySelector('[data-ai-service]'),'Ready to build with you');
    const types=document.createElement('nav');types.className='ti-ai-types';types.setAttribute('aria-label','Instrument type');
    for(const type of Object.keys(label)){const choice=document.createElement('button');choice.type='button';choice.textContent=label[type];choice.setAttribute('aria-pressed',String(type===kind));choice.addEventListener('click',()=>{if(type!==kind){workspace.navigate(type);open(type)}});types.append(choice)}
    panel.querySelector('.ti-ai-head').after(types);
    const reviewButton=document.createElement('button');reviewButton.type='button';reviewButton.dataset.aiReview='';reviewButton.textContent='Review document';
    panel.querySelector('[data-ai-proposal]>div').prepend(reviewButton);
    const reviewHead=document.createElement('div');reviewHead.className='ti-ai-review-head';
    reviewHead.innerHTML='<span>AI proposal · not saved</span><div><button type="button" data-ai-review-back>Back to AI chat</button><button type="button" data-ai-review-apply>Apply Changes</button><button type="button" data-ai-review-discard>Discard Changes</button></div>';
    main.insertBefore(reviewHead,panel);
    reviewButton.addEventListener('click',()=>{if(isPreview(kind)){setMode(kind,'review');reviewHead.querySelector('[data-ai-review-back]').focus({preventScroll:true})}});
    reviewHead.querySelector('[data-ai-review-back]').addEventListener('click',()=>open(kind));
    reviewHead.querySelector('[data-ai-review-apply]').addEventListener('click',()=>apply(kind));
    const discard=()=>{restorePreview();append(kind,'assistant','Proposal discarded. Your saved instrument was not changed.')};
    reviewHead.querySelector('[data-ai-review-discard]').addEventListener('click',discard);
    button.addEventListener('click',()=>panel.hidden?open(kind):close(kind));
    panel.querySelector('[data-ai-close]').addEventListener('click',()=>close(kind));
    panel.querySelector('[data-ai-cancel]').addEventListener('click',abort);
    panel.querySelector('[data-ai-apply]').addEventListener('click',()=>apply(kind));
    panel.querySelector('[data-ai-discard]').addEventListener('click',discard);
    panel.querySelector('[data-ai-undo]').addEventListener('click',()=>undo(kind));
    panel.querySelector('[data-ai-new]').addEventListener('click',()=>{abort();restorePreview();const state=session(kind);state.epoch++;Object.assign(state,{history:[],draft:'',attachments:[],references:[],preparing:0});panel.querySelector('textarea').value='';clearError(kind);renderHistory(kind);update(kind)});
    panel.querySelector('[data-ai-attach]').addEventListener('click',()=>panel.querySelector('[data-ai-file]').click());
    panel.querySelector('[data-ai-file]').addEventListener('change',event=>{const files=Array.from(event.target.files||[]);event.target.value='';attach(kind,files)});
    panel.querySelector('textarea').addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.files||[]);if(files.length){event.preventDefault();attach(kind,files)}});
    panel.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault()});
    panel.addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files||[]);if(files.length){event.preventDefault();attach(kind,files)}});
    panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();send(kind)});
    panel.querySelector('textarea').addEventListener('input',()=>{resizeInput(panel);session(kind).draft=panel.querySelector('textarea').value;update(kind)});
    panel.querySelector('textarea').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send(kind)}});
    renderHistory(kind);update(kind);
  }
  function refresh(){
    const next=workspace.userId();if(next!==user){clearQuota();abort();preview=null;cache.clear();undoEntries.length=0;user=next;for(const [kind,panel]of panels){setMode(kind,'manual');panel.querySelector('textarea').value='';workspace.release(kind);clearError(kind);renderHistory(kind)}}
    if(request&&request.identity!==workspace.identity(request.kind))abort();
    if(preview&&!workspace.sameContext(preview.snapshot)){const kind=preview.snapshot.kind;preview=null;workspace.release(kind)}
    for(const kind of ['playbook','checklist','psych']){ensure(kind);update(kind)}
  }
  root.TIOSAIBuilderClient=Object.freeze({isPreview,beforeNavigate});
  for(const kind of ['playbook','checklist','psych']){const target=workspace.page(kind);if(target)new MutationObserver(refresh).observe(target,{attributes:true,attributeFilter:['class'],childList:true})}
  root.addEventListener('tios:auth-ui',refresh);root.addEventListener('storage',event=>{if(preview&&event.key===preview.snapshot.storageKey)error(preview.snapshot.kind,'This instrument changed in another tab. Discard this proposal before continuing.')});
  root.addEventListener('tios:conversation-scope-changing',()=>{abort();restorePreview();cache.clear();undoEntries.length=0;for(const [kind,panel]of panels){setMode(kind,'manual');panel.querySelector('textarea').value='';clearError(kind);renderHistory(kind);update(kind)}});
  refresh();
})(window);
