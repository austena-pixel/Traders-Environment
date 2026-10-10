(function(root){
  'use strict';
  const bucket='trade-setup-evidence',table='trade_setup_evidence';
  const defaults=[{slot:1,timeframe:'H4',responsibility:'Context'},{slot:2,timeframe:'H1',responsibility:'Setup'},{slot:3,timeframe:'M5',responsibility:'Entry'}];
  const maxBytes=12*1024*1024;
  const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="17" height="17" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 19 6-6 4 4 3-3 3 3M19 2v6m-3-3h6"/></svg>';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths=row=>[row?.original_path,row?.thumbnail_path].filter(Boolean);
  function fail(message){throw new Error(message)}
  function checked(result){if(result.error)throw result.error;return result.data}
  function imageMime(bytes){
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    return null;
  }
  async function prepare(file){
    if(!file?.size||file.size>maxBytes)fail('Choose a PNG, JPG or WebP image up to 12 MB.');
    const mime=imageMime(new Uint8Array(await file.slice(0,16).arrayBuffer()));
    if(!mime||(file.type&&file.type!==mime))fail('Choose a valid PNG, JPG or WebP chart image.');
    let bitmap;
    try{bitmap=await createImageBitmap(file)}catch{fail('This image could not be opened. Choose another picture.')}
    try{
      const {width,height}=bitmap;
      if(width>16384||height>16384||width*height>60000000)fail('Use a chart image with fewer than 60 million pixels and sides up to 16,384 pixels.');
      const scale=Math.min(1,720/Math.max(width,height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)fail('Image previews are unavailable in this browser.');
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.86));
      if(!thumbnail)fail('The image preview could not be created. Try another picture.');
      return {original:new Blob([file],{type:mime}),thumbnail,mime,width,height,name:(file.name||'Chart').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)};
    }finally{bitmap.close()}
  }
  function create({getClient,getUser,getTrade,getNumber}){
    const sessions=new Map(),queues=new Map(),previews=new Map();
    let dialogSession=null,dialogTrigger=null,viewerScope=null,viewerEpoch=0,viewerUrl=null,viewerTrigger=null,previousOverflow='';
    let view={x:0,y:0,scale:1,fit:1,width:0,height:0},points=new Map();
    const dialog=document.createElement('div');
    dialog.className='modal trade-evidence-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Trade setup evidence');
    dialog.innerHTML='<div class="modal-card"><div class="modal-head"><h2>Setup pictures</h2><button class="close" type="button" data-evidence-dialog-close aria-label="Close setup pictures">×</button></div><div data-evidence-dialog-host></div></div>';
    document.body.appendChild(dialog);
    const viewer=document.createElement('div');
    viewer.className='trade-evidence-viewer';viewer.hidden=true;viewer.setAttribute('role','dialog');viewer.setAttribute('aria-modal','true');viewer.setAttribute('aria-labelledby','tradeEvidenceViewerTitle');
    viewer.innerHTML='<div class="trade-evidence-viewer-head"><strong id="tradeEvidenceViewerTitle">Chart</strong><div class="trade-evidence-viewer-controls"><button type="button" data-view="out" aria-label="Zoom out">−</button><output aria-live="polite">100%</output><button type="button" data-view="in" aria-label="Zoom in">+</button><button type="button" data-view="fit">Fit</button><button type="button" data-view="actual">100%</button><button type="button" data-view="close">Close</button></div></div><div class="trade-evidence-viewport" tabindex="0" aria-label="Chart inspection area. Use plus and minus to zoom, arrow keys to pan and Escape to close."><div class="trade-evidence-viewer-message" role="status"></div><img alt="" draggable="false" hidden></div><p class="trade-evidence-viewer-foot">Scroll or pinch to zoom · drag or use arrow keys to pan · double-click to zoom · Escape to close</p>';
    document.body.appendChild(viewer);
    const viewport=viewer.querySelector('.trade-evidence-viewport'),fullImage=viewport.querySelector('img'),message=viewport.querySelector('[role="status"]');
    function scopeFor(id){
      const user=getUser(),trade=getTrade(id);
      if(!user||!trade||trade.user_id!==user.id||trade.is_deleted)return null;
      return {userId:user.id,tradeId:trade.id,accountId:trade.account_id,client:getClient()};
    }
    function authorized(scope){if(getUser()?.id!==scope.userId)fail('Your session changed. Sign in again before saving.');}
    function active(session){return sessions.get(session.host)===session&&getUser()?.id===session.scope?.userId;}
    function label(scope){const trade=getTrade(scope.tradeId);return ['Trade '+(getNumber(scope.tradeId)??'—'),trade?.instrument,trade?.trade_date].filter(Boolean).join(' · ')}
    function status(card,text,error=false){card.querySelector('.trade-evidence-status').textContent=text;card.querySelector('.trade-evidence-status').classList.toggle('error',error);}
    function busy(card,value){card.setAttribute('aria-busy',String(value));card.querySelectorAll('input,button').forEach(el=>{el.disabled=value});}
    function forget(path){const key=[...previews.keys()].find(k=>k.endsWith('|'+path));if(key){URL.revokeObjectURL(previews.get(key));previews.delete(key)}}
    async function preview(session,card,row){
      const path=row.thumbnail_path,epoch=card.dataset.previewPath=path||'';
      const image=card.querySelector('.trade-evidence-upload img');
      image.hidden=true;image.removeAttribute('src');
      if(!path)return;
      try{
        const key=session.scope.userId+'|'+path;
        let url=previews.get(key);
        if(!url){
          const blob=checked(await session.scope.client.storage.from(bucket).download(path));
          if(!active(session)||card.dataset.previewPath!==epoch)return;
          url=URL.createObjectURL(blob);previews.set(key,url);
          if(previews.size>24){const oldest=previews.keys().next().value;URL.revokeObjectURL(previews.get(oldest));previews.delete(oldest)}
        }
        if(!active(session)||card.dataset.previewPath!==epoch)return;
        image.src=url;image.alt=row.timeframe+' · '+row.responsibility+' chart preview';image.hidden=false;
        card.querySelector('[data-evidence-placeholder]').hidden=true;
      }catch{if(active(session)&&card.dataset.previewPath===epoch)status(card,'Preview unavailable. Use View to open the original.',true)}
    }
    function applyRow(session,row){
      if(!active(session))return;
      const old=session.rows[row.slot-1],card=session.host.querySelector('[data-evidence-slot="'+row.slot+'"]');
      if(!card)return;
      session.rows[row.slot-1]=row;
      for(const name of ['timeframe','responsibility']){
        const input=card.querySelector('[data-evidence-label="'+name+'"]');
        if(input.value===old[name]||!session.loaded)input.value=row[name];
      }
      const hasImage=Boolean(row.original_path),upload=card.querySelector('.trade-evidence-upload');
      upload.dataset.evidenceAction=hasImage?'view':'upload';
      upload.setAttribute('aria-label',hasImage?'View Chart '+row.slot+' full image':'Upload Chart '+row.slot);
      card.querySelector('[data-evidence-placeholder]').hidden=false;
      card.querySelector('[data-evidence-placeholder] span').textContent=hasImage?'Chart '+row.slot+' · open image':'Chart '+row.slot;
      card.querySelector('.trade-evidence-actions [data-evidence-action="view"]').hidden=!hasImage;
      card.querySelector('[data-evidence-action="remove"]').hidden=!hasImage;
      const replace=card.querySelector('.trade-evidence-actions [data-evidence-action="upload"]');
      replace.textContent='Replace';replace.hidden=!hasImage;
      card.querySelector('[data-evidence-action="labels"]').hidden=['timeframe','responsibility'].every(name=>card.querySelector('[data-evidence-label="'+name+'"]').value===row[name]);
      if(old.thumbnail_path!==row.thumbnail_path||!session.loaded)void preview(session,card,row);
    }
    function broadcast(scope,row){
      for(const session of sessions.values())if(session.scope?.userId===scope.userId&&session.scope.tradeId===scope.tradeId){
        if(session.created)applyRow(session,row);else void load(session);
      }
    }
    async function load(session){
      if(!session.scope||!active(session))return;
      session.loaded=false;
      const cards=[...session.host.querySelectorAll('[data-evidence-slot]')];
      cards.forEach(card=>{busy(card,true);status(card,'Loading…')});
      if(!session.created)renderChoice(session,'Loading…');
      try{
        const rows=checked(await session.scope.client.from(table).select('*').eq('trade_id',session.scope.tradeId).eq('user_id',session.scope.userId).order('slot'))||[];
        if(!active(session))return;
        if(!rows.length){
          session.created=false;session.loaded=true;session.rows=defaults.map(row=>({...row}));renderChoice(session);return;
        }
        if(!session.created)renderCards(session);
        defaults.forEach(base=>applyRow(session,rows.find(r=>r.slot===base.slot)||{...base}));session.loaded=true;
        session.host.querySelectorAll('[data-evidence-slot]').forEach(card=>{busy(card,false);status(card,'');card.querySelector('[data-evidence-action="retry"]').hidden=true});
      }catch{
        if(!active(session))return;
        if(!session.created){renderChoice(session,'Could not load setup pictures. Retry to continue.',true);return}
        cards.forEach(card=>{status(card,'Could not load setup pictures. Retry to continue.',true);const retry=card.querySelector('[data-evidence-action="retry"]');retry.hidden=false;retry.disabled=false});
      }
    }
    async function createSetup(session){
      if(!active(session)||!session.loaded||session.created||session.creating)return;
      const scope=session.scope;session.creating=true;renderChoice(session,'Creating…');
      try{
        authorized(scope);
        // Explicit opt-in persists the empty slots. Ignore existing rows so a
        // concurrent creation or older saved evidence can never be overwritten.
        checked(await scope.client.from(table).upsert(defaults.map(row=>({user_id:scope.userId,trade_id:scope.tradeId,...row})),{onConflict:'trade_id,slot',ignoreDuplicates:true}));
        session.creating=false;
        for(const current of sessions.values())if(current.scope?.userId===scope.userId&&current.scope.tradeId===scope.tradeId&&!current.created){
          if(current===session)await load(current);else void load(current);
        }
      }catch(error){
        if(active(session)){session.creating=false;renderChoice(session,error?.message||'Could not create setup pictures. Try again.',true)}
      }finally{session.creating=false}
    }
    function renderCards(session){
      const {host,scope}=session;session.created=true;
      host.innerHTML='<h3>Multi-Timeframe Setup Evidence</h3><p class="trade-evidence-intro">'+escape(scope?label(scope)+' · Labels save automatically. PNG, JPG or WebP · up to 12 MB per chart.':'Save this trade first, then open its Setup pictures to upload charts.')+'</p><div class="trade-evidence-grid">'+defaults.map(row=>'<section class="trade-evidence-card" data-evidence-slot="'+row.slot+'" aria-label="Chart '+row.slot+'"><button type="button" class="trade-evidence-upload" data-evidence-action="upload" aria-label="Upload Chart '+row.slot+'"><img hidden alt=""><span data-evidence-placeholder>'+icon+'<span>Chart '+row.slot+'</span></span></button><label class="trade-evidence-label"><span>Timeframe</span><input data-evidence-label="timeframe" value="'+row.timeframe+'" maxlength="32" aria-label="Chart '+row.slot+' timeframe"></label><label class="trade-evidence-label responsibility"><span>Responsibility</span><input data-evidence-label="responsibility" value="'+row.responsibility+'" maxlength="120" aria-label="Chart '+row.slot+' responsibility"></label><input type="file" accept="image/png,image/jpeg,image/webp" data-evidence-file hidden aria-label="Choose Chart '+row.slot+' image"><div class="trade-evidence-actions"><button class="btn small" type="button" data-evidence-action="view" hidden>View</button><button class="btn small" type="button" data-evidence-action="upload">Upload</button><button class="btn small" type="button" data-evidence-action="remove" hidden>Remove</button><button class="btn small" type="button" data-evidence-action="labels" hidden>Save labels</button><button class="btn small" type="button" data-evidence-action="retry" hidden>Retry</button></div><p class="trade-evidence-status" role="status"></p></section>').join('')+'</div>';
    }
    function renderChoice(session,text='',error=false){
      const {host,scope}=session;
      host.innerHTML='<h3>Multi-Timeframe Setup Evidence</h3><p class="trade-evidence-intro">'+escape(scope?label(scope):'Optional chart screenshots for this trade.')+'</p><div class="trade-evidence-choice"><p>Choose whether to add chart evidence to this trade. You can upload one, two or all three pictures.</p><button class="btn small" type="button" data-evidence-action="create"'+(!scope||!session.loaded||session.creating?' disabled':'')+'>Create setup pictures</button><button class="btn small" type="button" data-evidence-action="retry"'+(error&&!session.loaded?'':' hidden')+'>Retry</button></div><p class="trade-evidence-status'+(error?' error':'')+'" role="status">'+escape(scope?text:'Save this trade first to create setup pictures.')+'</p>';
    }
    function mount(host,id){
      if(!host)return;
      const scope=scopeFor(id),session={host,scope,loaded:false,created:false,creating:false,rows:defaults.map(d=>({...d}))};
      sessions.set(host,session);host.classList.add('trade-evidence');renderChoice(session);
      if(!scope)return;
      if(!host.dataset.evidenceBound){
        host.dataset.evidenceBound='true';
        host.addEventListener('input',event=>{
          if(!event.target.matches('[data-evidence-label]'))return;
          event.target.closest('[data-evidence-slot]').querySelector('[data-evidence-action="labels"]').hidden=false;
        });
        host.addEventListener('change',event=>{
          const current=sessions.get(host),card=event.target.closest('[data-evidence-slot]');if(!current?.scope||!card)return;
          if(event.target.matches('[data-evidence-label]'))void mutate(current,card,'labels');
          if(event.target.matches('[data-evidence-file]')){const file=event.target.files[0];event.target.value='';if(file)void mutate(current,card,'upload',file)}
        });
        host.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-evidence-label]')){event.preventDefault();event.target.blur()}});
        host.addEventListener('click',event=>{
          const button=event.target.closest('[data-evidence-action]'),current=sessions.get(host),card=button?.closest('[data-evidence-slot]');
          if(!button||button.disabled||!current?.scope)return;
          const action=button.dataset.evidenceAction;
          if(action==='create'){void createSetup(current);return}
          if(action==='retry'){void load(current);return}
          if(!card)return;
          if(action==='upload')card.querySelector('[data-evidence-file]').click();
          else if(action==='view')void openViewer(current,current.rows[Number(card.dataset.evidenceSlot)-1],button);
          else void mutate(current,card,action);
        });
      }
      void load(session);
    }
    async function currentRow(scope,slot){
      authorized(scope);
      return checked(await scope.client.from(table).select('*').eq('user_id',scope.userId).eq('trade_id',scope.tradeId).eq('slot',slot).maybeSingle());
    }
    async function ensureRow(scope,slot){
      authorized(scope);
      const result=await scope.client.from(table).insert({user_id:scope.userId,trade_id:scope.tradeId,...defaults[slot-1]}).select('*').single();
      const row=result.error?.code==='23505'?await currentRow(scope,slot):checked(result);
      if(!row)fail('Could not prepare this chart slot. Try again.');return row;
    }
    async function updateRow(scope,previous,fields){
      authorized(scope);
      const result=await scope.client.from(table).update(fields).eq('user_id',scope.userId).eq('trade_id',scope.tradeId).eq('slot',previous.slot).eq('revision',previous.revision).select('*').maybeSingle();
      const row=checked(result);if(!row)fail('This chart changed in another window. Reopen Setup pictures and try again.');return row;
    }
    async function cleanup(scope,oldPaths){
      if(!oldPaths.length)return true;
      try{authorized(scope);checked(await scope.client.storage.from(bucket).remove(oldPaths));oldPaths.forEach(forget);return true}catch{return false}
    }
    async function mutate(session,card,action,file){
      if(!session.loaded||card.getAttribute('aria-busy')==='true')return;
      const scope=session.scope,slot=Number(card.dataset.evidenceSlot);
      const labels=Object.fromEntries(['timeframe','responsibility'].map(name=>[name,card.querySelector('[data-evidence-label="'+name+'"]').value.trim()]));
      if(action!=='remove'&&(!labels.timeframe||!labels.responsibility)){status(card,'Enter both a timeframe and a responsibility.',true);return}
      busy(card,true);status(card,action==='upload'?'Uploading…':action==='remove'?'Removing…':'Saving labels…');
      const key=scope.userId+'|'+scope.tradeId+'|'+slot,prior=queues.get(key)||Promise.resolve();
      const task=prior.catch(()=>{}).then(async()=>{
        let staged=[],committed=false;
        try{
          const displayed=session.rows[slot-1];
          const previous=displayed.id?displayed:await ensureRow(scope,slot);let fields=labels;
          if(!displayed.id&&previous.original_path)fail('This chart changed in another window. Reopen Setup pictures and try again.');
          if(action==='upload'){
            const prepared=await prepare(file);authorized(scope);
            const directory=scope.userId+'/'+scope.tradeId+'/'+slot+'/'+crypto.randomUUID()+'/';
            const extension=mime=>mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp';
            const original=directory+'original.'+extension(prepared.mime),thumbnail=directory+'preview.'+extension(prepared.thumbnail.type);
            checked(await scope.client.storage.from(bucket).upload(original,prepared.original,{contentType:prepared.mime,upsert:false,cacheControl:'3600'}));staged.push(original);authorized(scope);
            checked(await scope.client.storage.from(bucket).upload(thumbnail,prepared.thumbnail,{contentType:prepared.thumbnail.type,upsert:false,cacheControl:'3600'}));staged.push(thumbnail);
            fields={...labels,original_path:original,thumbnail_path:thumbnail,original_name:prepared.name,mime_type:prepared.mime,file_size:prepared.original.size,image_width:prepared.width,image_height:prepared.height,image_uploaded_at:new Date().toISOString()};
          }else if(action==='remove')fields={original_path:null,thumbnail_path:null,original_name:null,mime_type:null,file_size:null,image_width:null,image_height:null,image_uploaded_at:null};
          const row=await updateRow(scope,previous,fields);committed=true;broadcast(scope,row);
          const cleaned=action==='labels'||await cleanup(scope,paths(previous));
          if(active(session))status(card,action==='labels'?'Labels saved':action==='remove'?'Image removed':cleaned?'Image saved':'Image saved. Previous file cleanup can be retried later.');
        }catch(error){
          // A lost response may conceal a successful commit. Never delete a file
          // unless a fresh, authorized read confirms it is not the current image.
          if(staged.length&&!committed){
            try{const latest=await currentRow(scope,slot);if(!paths(latest).some(path=>staged.includes(path)))await cleanup(scope,staged);else broadcast(scope,latest)}catch{}
          }
          if(active(session))status(card,error?.message||'Could not save this chart. Try again.',true);
        }finally{if(active(session)){busy(card,false);const row=session.rows[slot-1];card.querySelector('[data-evidence-action="labels"]').hidden=['timeframe','responsibility'].every(name=>card.querySelector('[data-evidence-label="'+name+'"]').value.trim()===row[name])}}
      });
      queues.set(key,task);await task;if(queues.get(key)===task)queues.delete(key);
    }
    function unmount(host){sessions.delete(host);if(host)host.innerHTML=''}
    function open(id,trigger){
      if(!scopeFor(id))return;
      closeViewer();dialogTrigger=trigger||document.activeElement;dialog.classList.add('open');
      const host=dialog.querySelector('[data-evidence-dialog-host]');mount(host,id);dialogSession=sessions.get(host);
      dialog.querySelector('[data-evidence-dialog-close]').focus();
    }
    function closeDialog({restoreFocus=true}={}){
      closeViewer();dialog.classList.remove('open');unmount(dialog.querySelector('[data-evidence-dialog-host]'));dialogSession=null;
      if(restoreFocus&&dialogTrigger?.isConnected)dialogTrigger.focus();dialogTrigger=null;
    }
    function draw(){
      if(!view.width)return;
      const box=viewport.getBoundingClientRect(),w=view.width*view.scale,h=view.height*view.scale;
      view.x=w<=box.width?(box.width-w)/2:Math.min(0,Math.max(box.width-w,view.x));
      view.y=h<=box.height?(box.height-h)/2:Math.min(0,Math.max(box.height-h,view.y));
      fullImage.style.width=view.width+'px';fullImage.style.height=view.height+'px';
      fullImage.style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.scale+')';
      viewer.querySelector('output').value=Math.round(view.scale*100)+'%';
    }
    function fit(){
      if(!view.width)return;
      const box=viewport.getBoundingClientRect();view.fit=Math.min(1,box.width/view.width,box.height/view.height);view.scale=view.fit;view.x=0;view.y=0;draw();
    }
    function zoom(next,x,y){
      if(!view.width)return;
      const box=viewport.getBoundingClientRect();x=x??box.width/2;y=y??box.height/2;
      const scale=Math.max(view.fit*.5,Math.min(8,next)),ratio=scale/view.scale;
      view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.scale=scale;draw();
    }
    async function openViewer(session,row,trigger){
      if(!row?.original_path)return;
      closeViewer({restoreFocus:false});const epoch=++viewerEpoch;viewerScope=session.scope;viewerTrigger=trigger;
      previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';viewer.hidden=false;
      viewer.querySelector('strong').textContent=label(session.scope)+' · '+row.timeframe+' · '+row.responsibility;
      fullImage.hidden=true;message.textContent='Loading full image…';view={x:0,y:0,scale:1,fit:1,width:0,height:0};viewer.querySelector('output').value='—';
      viewer.querySelector('[data-view="close"]').focus();
      try{
        authorized(session.scope);const blob=checked(await session.scope.client.storage.from(bucket).download(row.original_path));
        if(epoch!==viewerEpoch||viewer.hidden||getUser()?.id!==session.scope.userId)return;
        viewerUrl=URL.createObjectURL(blob);fullImage.src=viewerUrl;fullImage.alt=row.timeframe+' · '+row.responsibility+' · '+(row.original_name||'Trade setup chart');
        await fullImage.decode();if(epoch!==viewerEpoch||viewer.hidden)return;
        view.width=fullImage.naturalWidth;view.height=fullImage.naturalHeight;fullImage.hidden=false;message.textContent='';fit();
      }catch{if(epoch===viewerEpoch&&!viewer.hidden)message.textContent='Could not open this image. Close the viewer and try again.'}
    }
    function closeViewer({restoreFocus=true}={}){
      ++viewerEpoch;points.clear();viewerScope=null;
      if(!viewer.hidden)document.body.style.overflow=previousOverflow;
      viewer.hidden=true;fullImage.hidden=true;fullImage.removeAttribute('src');if(viewerUrl){URL.revokeObjectURL(viewerUrl);viewerUrl=null}
      if(restoreFocus&&viewerTrigger?.isConnected)viewerTrigger.focus();viewerTrigger=null;
    }
    function trap(event,container){
      if(event.key!=='Tab')return;
      const items=[...container.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
    document.addEventListener('click',event=>{const button=event.target.closest('[data-trade-evidence-open]');if(button&&!button.disabled)open(button.dataset.tradeEvidenceOpen,button)});
    dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-evidence-dialog-close]'))closeDialog()});
    document.addEventListener('keydown',event=>{
      if(!viewer.hidden){
        trap(event,viewer);
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeViewer()}
      }else if(dialog.classList.contains('open')){
        trap(event,dialog);if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeDialog()}
      }
    },true);
    viewer.addEventListener('click',event=>{
      const action=event.target.closest('[data-view]')?.dataset.view;if(!action)return;
      if(action==='close')closeViewer();else if(action==='fit')fit();else zoom(action==='actual'?1:view.scale*(action==='in'?1.25:.8));
    });
    viewport.addEventListener('wheel',event=>{event.preventDefault();const box=viewport.getBoundingClientRect();zoom(view.scale*Math.exp(-event.deltaY*.002),event.clientX-box.left,event.clientY-box.top)},{passive:false});
    viewport.addEventListener('dblclick',event=>{const box=viewport.getBoundingClientRect();zoom(view.scale*2,event.clientX-box.left,event.clientY-box.top)});
    viewport.addEventListener('pointerdown',event=>{if(event.button!==0)return;viewport.setPointerCapture(event.pointerId);points.set(event.pointerId,{x:event.clientX,y:event.clientY})});
    viewport.addEventListener('pointermove',event=>{
      const old=points.get(event.pointerId);if(!old)return;
      const before=[...points.values()];points.set(event.pointerId,{x:event.clientX,y:event.clientY});const after=[...points.values()];
      if(after.length===2){
        const distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),center=p=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2});
        const a=center(before),b=center(after),box=viewport.getBoundingClientRect();zoom(view.scale*distance(after)/Math.max(1,distance(before)),a.x-box.left,a.y-box.top);view.x+=b.x-a.x;view.y+=b.y-a.y;
      }else{view.x+=event.clientX-old.x;view.y+=event.clientY-old.y}draw();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(name,event=>points.delete(event.pointerId));
    viewport.addEventListener('keydown',event=>{
      if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.preventDefault();
      if(event.key==='+'||event.key==='=')zoom(view.scale*1.25);else if(event.key==='-')zoom(view.scale*.8);
      else if(event.key.startsWith('Arrow')){view.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;view.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;draw()}
    });
    new ResizeObserver(()=>{if(!viewer.hidden){const box=viewport.getBoundingClientRect();view.fit=Math.min(1,box.width/view.width,box.height/view.height);draw()}}).observe(viewport);
    function reset(){closeDialog({restoreFocus:false});for(const host of sessions.keys())unmount(host);for(const url of previews.values())URL.revokeObjectURL(url);previews.clear()}
    window.addEventListener('tios:conversation-scope-changing',reset);
    return Object.freeze({mount,unmount,open,close:closeDialog,reset});
  }
  root.TIOSTradeEvidence=Object.freeze({create,prepare,bucket,table});
})(typeof window!=='undefined'?window:globalThis);
