(function(){
'use strict';
const API='https://tios-capture-api.austena401.workers.dev';
const categories={market_context:'Market Context',market_structure:'Market Structure',entry:'Entry',exit:'Exit',custom:'Custom'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.TIOSCaptureEvidence={
 create({getClient,getUser,getTrades,getNumber,getPlaybookDocuments}){
  const root=document.createElement('div');root.className='tios-capture-overlay';root.hidden=true;document.body.appendChild(root);
  let draft=null,scope=null,uploading=false,epoch=0,purposeEpoch=0,imageUrls=[];
  function clearImages(){imageUrls.forEach(u=>URL.revokeObjectURL(u));imageUrls=[]}
  function end(){if(uploading)return;epoch++;purposeEpoch++;clearImages();if(draft?.url)URL.revokeObjectURL(draft.url);draft=null;scope=null;root.hidden=true;root.replaceChildren()}
  function session(){const u=getUser(),s=getClient()?.auth?.getSession;if(!u?.id||!s)throw Error('Sign in to T-IOS first.');return u.id}
  async function request(path,{method='GET',body}={}){
   const {data,error}=await getClient().auth.getSession();const token=data?.session?.access_token;
   if(error||!token||data.session.user?.id!==getUser()?.id)throw Error('Your T-IOS session expired. Sign in again.');
   const r=await fetch(API+path,{method,headers:{authorization:'Bearer '+token},body});
   if(!r.ok){let response;try{response=await r.json()}catch(_){}throw Error(response?.error||'Cloudflare screenshot service is not ready.');}
   return r.headers.get('content-type')?.includes('application/json')?r.json():r.blob();
  }
  const REQUIREMENTS_KEY='tios_capture_requirements_v1';
  const standardSections=['market_context','market_structure','entry','exit'];
  function reqKey(){return REQUIREMENTS_KEY+':'+getUser()?.id}
  function storedRequirements(){
    try{const all=JSON.parse(localStorage.getItem(reqKey())||'{}');return all&&typeof all==='object'?all:{}}catch(_){return {}}
  }
  function requirementsForPlaybook(id){return storedRequirements()[id]||[]}
  function saveRequirements(id,sections){
    const data=storedRequirements();data[id]=sections;localStorage.setItem(reqKey(),JSON.stringify(data));
  }
  function getPlaybooks(){return (getPlaybookDocuments?.()||[]).filter(p=>p&&!p.templateDraft);}
  function normalizeSections(list){
    if(!Array.isArray(list))return [];
    return list.filter(s=>s&&typeof s==='object').map(s=>({category:String(s.category||''),label:String(s.label||'').trim().slice(0,90)})).filter(s=>Object.hasOwn(categories,s.category)&&(s.category!=='custom'||s.label)).slice(0,16);
  }
  function editor(playbook){
    if(!playbook)return;
    const sections=normalizeSections(requirementsForPlaybook(playbook.id));
    pane('Evidence requirements · '+playbook.name,'<p>Select the screenshots this Playbook expects. These requirements do not score execution and will not delete existing evidence.</p><div data-capture-requirements>'+standardSections.map(k=>'<label class="tios-capture-requirement"><input type="checkbox" data-requirement="'+k+'" '+(sections.some(x=>x.category===k)?'checked':'')+'>'+esc(categories[k])+'</label>').join('')+'<label>Additional screenshot labels (one per line)<textarea rows="3" maxlength="700" data-capture-extra placeholder="e.g. Confirmation, Risk management">'+esc(sections.filter(x=>x.category==='custom').map(x=>x.label).join('\n'))+'</textarea></label></div><footer><button class="btn primary" type="button" data-requirements-save="'+esc(playbook.id)+'">Save requirements</button><button class="btn" type="button" data-capture-close>Cancel</button></footer>');
  }
  async function assignment(tradeId){
    const user=getUser();if(!user?.id)return null;
    const {data,error}=await getClient().from('trade_capture_playbook_links').select('playbook_id,playbook_name,required_sections').eq('trade_id',tradeId).eq('user_id',user.id).maybeSingle();
    if(error)throw Error('Unable to read the trade Playbook requirements.');
    return data;
  }
  async function setAssignment(tradeId,playbook){
    const user=getUser();if(!user?.id)throw Error('Sign in again.');
    const data={trade_id:tradeId,user_id:user.id,playbook_id:playbook.id,playbook_name:playbook.name.slice(0,160),required_sections:normalizeSections(requirementsForPlaybook(playbook.id)),updated_at:new Date().toISOString()};
    const {error}=await getClient().from('trade_capture_playbook_links').upsert(data,{onConflict:'trade_id'});
    if(error)throw Error('Could not assign this Playbook. '+error.message);
  }
  function editRequirements(playbook){editor(playbook);}
  function requirementState(required,captures){
    return normalizeSections(required).map(r=>({label:r.category==='custom'?r.label:categories[r.category],found:captures.some(c=>c.category===r.category&&(r.category!=='custom'||c.custom_label?.toLowerCase()===r.label.toLowerCase()))}));
  }
  async function displayRequirements(tradeId,captures){
    const target=root.querySelector('[data-trade-requirements]');if(!target)return;
    try{
      const link=await assignment(tradeId);if(!target.isConnected)return;
      const available=getPlaybooks();
      const selected=available.find(p=>p.id===link?.playbook_id);
      const options='<option value="">Select Playbook…</option>'+available.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===link?.playbook_id?'selected':'')+'>'+esc(p.name)+'</option>').join('');
      const state=requirementState(link?.required_sections||[],captures);
      target.innerHTML='<label>Evidence Playbook<select data-capture-assign>'+options+'</select></label>'+(link?'<small>Requirements saved for this trade: '+esc(link.playbook_name)+'</small>':'<small>Assign a Playbook to track required screenshots.</small>')+(state.length?'<div class="tios-capture-requirement-results">'+state.map(r=>'<div>'+(r.found?'✓':'○')+' '+esc(r.label)+' · '+(r.found?'Captured':'Missing')+'</div>').join('')+'</div>':'');
    }catch(e){target.textContent=e.message;status(e.message,true)}
  }
  function status(message,bad=false){const node=root.querySelector('[data-capture-status]');if(node){node.textContent=message;node.classList.toggle('error',bad)}}
  function trades(){const user=getUser();return (getTrades()||[]).filter(t=>t.user_id===user?.id&&!t.is_deleted)}
  function pane(title,inner){root.innerHTML='<section class="tios-capture-dialog" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header><strong>'+esc(title)+'</strong><button type="button" data-capture-close aria-label="Close">×</button></header>'+inner+'<p class="tios-capture-status" data-capture-status role="status"></p></section>';root.hidden=false}
  function tradeOptions(selected){return '<option value="">Select trade…</option>'+trades().map(t=>'<option value="'+esc(t.id)+'" '+(selected===t.id?'selected':'')+'>Trade '+esc(getNumber(t.id)||'—')+' · '+esc(t.instrument||'')+' · '+esc(t.trade_date||'')+'</option>').join('')}
  function sectionLabel(section){
    return section.category==='custom'?section.label:categories[section.category];
  }
  function configuredPlaybooks(){
    return getPlaybooks().filter(pb=>normalizeSections(requirementsForPlaybook(pb.id)).length>0);
  }
  function captureSelection(){
    const input=root.querySelector('[data-capture-category]');
    const value=input?.value;
    return value!==undefined && /^\d+$/.test(value)?Number(value):null;
  }
  function updateSaveAvailability(){
    const button=root.querySelector('[data-capture-save]');
    if(button)button.disabled=Boolean(uploading)||!draft||!root.querySelector('[data-capture-trade]')?.value||captureSelection()===null;
  }
  async function renderCaptureRequirements(){
    const reqId=++purposeEpoch;
    const tradeId=root.querySelector('[data-capture-trade]')?.value||'';
    const holder=root.querySelector('[data-capture-config]');
    if(!holder)return;
    updateSaveAvailability();
    if(!tradeId){
      holder.innerHTML='<label>Capture purpose<select disabled><option>Choose a trade first</option></select></label>';
      updateSaveAvailability();
      return;
    }
    holder.innerHTML='<p class="tios-capture-status">Checking required screenshots for this trade…</p>';
    try{
      const linked=await assignment(tradeId);
      if(reqId!==purposeEpoch||!holder.isConnected||root.querySelector('[data-capture-trade]')?.value!==tradeId)return;
      const known=configuredPlaybooks();
      let html='';
      if(!linked)html+='<p class="tios-capture-status">Choose an Evidence Playbook for this trade before saving screenshots.</p>';
      else html+='<p class="tios-capture-status">Evidence Playbook: <strong>'+esc(linked.playbook_name)+'</strong></p>';
      const alternatives=known.filter(pb=>pb.id!==linked?.playbook_id);
      if(alternatives.length){
        html+='<label>'+(linked?'Change Evidence Playbook':'Assign Evidence Playbook')+'<select data-capture-playbook><option value="">Select Playbook…</option>'+alternatives.map(pb=>'<option value="'+esc(pb.id)+'">'+esc(pb.name)+'</option>').join('')+'</select></label>';
      }
      const sections=normalizeSections(linked?.required_sections);
      if(sections.length){
        html+='<label>Capture purpose<select data-capture-category><option value="">Select required screenshot…</option>'+sections.map((item,index)=>'<option value="'+index+'">'+esc(sectionLabel(item))+'</option>').join('')+'</select></label>';
      }else if(linked){
        html+='<p class="tios-capture-status">No screenshot requirements were selected when this Playbook was assigned. Configure them in Playbooks, then update this trade.</p>';
      }else if(!known.length){
        html+='<p class="tios-capture-status">No Playbooks have evidence requirements. Open Technical Instruments → Playbooks → Evidence requirements to select them first.</p>';
      }
      if(linked&&known.some(pb=>pb.id===linked.playbook_id)){
        html+='<button class="btn small" type="button" data-capture-refresh-requirements>Update from Playbook</button>';
      }
      holder.innerHTML=html;
      updateSaveAvailability();
    }catch(err){
      if(reqId!==purposeEpoch)return;
      holder.textContent='Unable to load evidence requirements.';
      status(err.message,true);
      updateSaveAvailability();
    }
  }
  async function updateCapturePlaybook(id){
    const tradeId=root.querySelector('[data-capture-trade]')?.value;
    const pb=configuredPlaybooks().find(p=>p.id===id);
    if(!tradeId||!pb){status('Select a configured Playbook and a trade.',true);return}
    const existing=await assignment(tradeId);
    if(existing&&existing.playbook_id!==pb.id&&!confirm('Change the evidence Playbook for this trade? Existing screenshots will remain saved.'))return;
    await setAssignment(tradeId,pb);
    await renderCaptureRequirements();
  }
  async function screenshot(){
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Tab capture is unavailable here. Choose Upload screenshot.');
    const chart=[...document.querySelectorAll('#chartsWorkspace [data-chart-id]')].find(card=>card.dataset.chartId===scope?.chartId);
    const widget=chart?.querySelector('.charts-widget');
    const r=widget?.getBoundingClientRect();
    if(!r||r.width<80||r.height<80)throw Error('Open a visible chart before taking its screenshot.');
    // Record the position before the browser picker, then remove this modal from
    // the shared tab BEFORE reading the frame; otherwise the modal hides the chart.
    const left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(window.innerWidth,r.right),bottom=Math.min(window.innerHeight,r.bottom);
    if(right-left<80||bottom-top<80)throw Error('Scroll the chart fully into view and try again.');
    const ticket=epoch;
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false,preferCurrentTab:true});
    try{
      const track=stream.getVideoTracks()[0];
      if(track.getSettings()?.displaySurface&&track.getSettings().displaySurface!=='browser')
        throw Error('Choose this T-IOS browser tab, not your entire screen or another window.');
      const video=document.createElement('video');video.srcObject=stream;video.muted=true;
      await video.play();
      root.hidden=true;
      // Browser tab capture updates asynchronously after the overlay disappears.
      await new Promise(resolve=>setTimeout(resolve,450));
      if(ticket!==epoch||!scope)throw Error('Capture was cancelled.');
      if(!video.videoWidth||!video.videoHeight)throw Error('The selected tab did not provide a video frame.');
      const sx=video.videoWidth/window.innerWidth,sy=video.videoHeight/window.innerHeight;
      const x=Math.max(0,Math.round(left*sx)),y=Math.max(0,Math.round(top*sy));
      const w=Math.min(video.videoWidth-x,Math.round((right-left)*sx));
      const h=Math.min(video.videoHeight-y,Math.round((bottom-top)*sy));
      if(w<80||h<80||w*h>60000000)throw Error('The captured chart dimensions are invalid.');
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(video,x,y,w,h,0,0,w,h);
      return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(new File([b],'tios-chart-capture.png',{type:'image/png'})):reject(Error('Screenshot capture failed.')),'image/png'));
    }finally{
      stream.getTracks().forEach(t=>t.stop());
      if(ticket===epoch)root.hidden=false;
    }
  }
  function present(file,method){
    if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12582912){status('Choose PNG, JPG or WebP under 12 MB.',true);return}
    const image=new Image(),url=URL.createObjectURL(file);
    image.onload=()=>{
      if(draft?.url)URL.revokeObjectURL(draft.url);
      draft={file,url,method,width:image.naturalWidth,height:image.naturalHeight,...scope};
      if(!draft.width||!draft.height||draft.width*draft.height>60000000){status('The image dimensions are unsupported.',true);return}
      pane('Save chart screenshot','<img class="tios-capture-preview" src="'+url+'" alt="Screenshot preview"><label>Attach to trade<select data-capture-trade>'+tradeOptions(draft.tradeId)+'</select></label><div data-capture-config></div><label>Notes<textarea data-capture-note maxlength="1000" rows="2"></textarea></label><footer><button type="button" data-capture-save class="btn primary" disabled>Save evidence</button><button type="button" data-capture-close class="btn">Cancel</button></footer>');
      renderCaptureRequirements();
    };
    image.onerror=()=>{URL.revokeObjectURL(url);status('Cannot read this screenshot.',true)};
    image.src=url;
  }
  function open(chart,tradeId){
    try{session()}catch(err){alert(err.message);return}
    epoch++;scope={chartId:chart.id,symbol:chart.symbol,timeframe:chart.interval,tradeId};
    pane('Capture · '+chart.symbol,'<p>Choose how to capture this chart. Tab sharing requires browser permission. Select this T-IOS tab, then confirm the preview before saving.</p><div class="tios-capture-buttons"><button class="btn primary" type="button" data-capture-tab>Capture visible tab</button><button class="btn" type="button" data-capture-upload>Upload screenshot</button></div><input type="file" accept="image/png,image/jpeg,image/webp" data-capture-file hidden>');
  }
  async function save(){
    if(uploading)return;
    const tradeId=root.querySelector('[data-capture-trade]')?.value;
    const index=captureSelection();
    if(!draft||!tradeId||!trades().some(t=>t.id===tradeId)){status('Select a saved trade first.',true);return}
    if(index===null){status('Select a screenshot requirement for this trade.',true);return}
    const note=root.querySelector('[data-capture-note]')?.value||'';
    uploading=true;root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=true);status('Verifying Playbook requirements…');
    try{
      // Revalidate from Supabase before upload: do not trust the browser's category list.
      const linked=await assignment(tradeId);
      const selected=normalizeSections(linked?.required_sections)[index];
      if(!selected)throw Error('That screenshot is not required by the assigned Playbook.');
      const form=new FormData();
      for(const [key,value] of Object.entries({
        trade_id:tradeId,category:selected.category,custom_label:selected.category==='custom'?selected.label:'',
        note,chart_id:draft.chartId,symbol:draft.symbol,timeframe:draft.timeframe,
        capture_method:draft.method,image_width:draft.width,image_height:draft.height
      }))form.append(key,String(value));
      form.append('image',draft.file);
      status('Saving private screenshot…');
      await request('/captures',{method:'POST',body:form});
      uploading=false;end();
      alert('Screenshot saved to Trade '+(getNumber(tradeId)||'—')+'.');
    }catch(err){
      uploading=false;
      root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=false);
      updateSaveAvailability();
      status(err.message,true);
    }
  }
  async function gallery(tradeId){
    if(!trades().some(t=>t.id===tradeId))return;
    const current=++epoch;scope={tradeId};pane('Trade '+(getNumber(tradeId)||'—')+' · Captures','<div data-trade-requirements>Loading requirements…</div><div data-capture-gallery>Loading…</div>');
    try{
      const result=await request('/captures?trade_id='+encodeURIComponent(tradeId));
      if(current!==epoch)return;
      const rows=result.captures||[],area=root.querySelector('[data-capture-gallery]');
      area.innerHTML=rows.length?rows.map(row=>'<article class="tios-capture-item" data-capture-id="'+esc(row.id)+'"><strong>'+esc(categories[row.category]||row.custom_label)+' · '+esc(row.symbol)+' '+esc(row.timeframe)+'</strong><small>'+esc(new Date(row.captured_at).toLocaleString())+'</small><img alt="Saved chart capture" data-capture-image="'+esc(row.id)+'"><p>'+esc(row.note)+'</p><button class="btn small danger" type="button" data-capture-remove="'+esc(row.id)+'">Remove</button></article>').join(''):'No captured screenshots for this trade yet.';
      await displayRequirements(tradeId,rows);
      for(const row of rows){try{const blob=await request('/captures/'+row.id+'/image');if(current!==epoch)return;const url=URL.createObjectURL(blob);imageUrls.push(url);const img=area.querySelector('[data-capture-image="'+row.id+'"]');if(img)img.src=url;}catch(e){status('Some thumbnails could not load.',true)}}
    }catch(e){if(current===epoch)status(e.message,true)}
  }
  root.addEventListener('click',async e=>{
    if(e.target===root||e.target.closest('[data-capture-close]')){end();return}
    if(e.target.closest('[data-capture-upload]')){root.querySelector('[data-capture-file]')?.click();return}
    if(e.target.closest('[data-capture-tab]')){status('Choose this T-IOS tab in the browser sharing dialog.');try{present(await screenshot(),'tab')}catch(err){status(err.message,true)}return}
    const saveReq=e.target.closest('[data-requirements-save]');
    if(saveReq){
      const fields=[...root.querySelectorAll('[data-requirement]:checked')].map(el=>({category:el.dataset.requirement,label:''}));
      const extras=(root.querySelector('[data-capture-extra]')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,12).map(label=>({category:'custom',label}));
      saveRequirements(saveReq.dataset.requirementsSave,normalizeSections([...fields,...extras]));end();return;
    }
    if(e.target.closest('[data-capture-save]')){await save();return}
    const remove=e.target.closest('[data-capture-remove]');if(remove&&confirm('Remove this screenshot permanently?')){try{await request('/captures/'+remove.dataset.captureRemove,{method:'DELETE'});await gallery(scope.tradeId)}catch(err){status(err.message,true)}}
  });
  root.addEventListener('change',async e=>{
    if(e.target.matches('[data-capture-trade]')){await renderCaptureRequirements();return}
    if(e.target.matches('[data-capture-category]')){updateSaveAvailability();return}
    if(e.target.matches('[data-capture-playbook]')&&e.target.value){
      try{await updateCapturePlaybook(e.target.value)}catch(err){status(err.message,true);await renderCaptureRequirements()}
      return;
    }
  });
  root.addEventListener('click',async e=>{
    if(!e.target.closest('[data-capture-refresh-requirements]'))return;
    const tradeId=root.querySelector('[data-capture-trade]')?.value;
    let linked;try{linked=await assignment(tradeId)}catch(err){status(err.message,true);return}
    const pb=getPlaybooks().find(p=>p.id===linked?.playbook_id);
    if(!pb){status('This Playbook is not available in the current browser.',true);return}
    if(!confirm('Update this trade’s screenshot requirements from the Playbook? Existing screenshots will not be deleted.'))return;
    try{await setAssignment(tradeId,pb);await renderCaptureRequirements()}catch(err){status(err.message,true)}
  });
  root.addEventListener('change',async e=>{
    const select=e.target.closest('[data-capture-assign]');if(!select||!scope?.tradeId||!select.value)return;
    const pb=getPlaybooks().find(p=>p.id===select.value);if(!pb)return;
    try{await setAssignment(scope.tradeId,pb);await gallery(scope.tradeId)}catch(err){status(err.message,true)}
  });
  root.addEventListener('change',e=>{if(e.target.matches('[data-capture-file]')){const file=e.target.files[0];if(file)present(file,'upload')}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden&&!uploading)end()});
  window.addEventListener('tios:conversation-scope-changing',()=>{uploading=false;end()});
  return Object.freeze({open,gallery,editRequirements,reset:()=>{uploading=false;end()}});
 }
};
})();