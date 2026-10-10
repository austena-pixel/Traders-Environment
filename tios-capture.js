(function(){
'use strict';
const API='https://tios-capture-api.austena401.workers.dev';
const categories={market_context:'Market Context',market_structure:'Market Structure',entry:'Entry',exit:'Exit',custom:'Custom'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.TIOSCaptureEvidence={
 create({getClient,getUser,getTrades,getNumber}){
  const root=document.createElement('div');root.className='tios-capture-overlay';root.hidden=true;document.body.appendChild(root);
  let draft=null,scope=null,uploading=false,epoch=0,imageUrls=[];
  function clearImages(){imageUrls.forEach(u=>URL.revokeObjectURL(u));imageUrls=[]}
  function end(){if(uploading)return;epoch++;clearImages();if(draft?.url)URL.revokeObjectURL(draft.url);draft=null;scope=null;root.hidden=true;root.replaceChildren()}
  function session(){const u=getUser(),s=getClient()?.auth?.getSession;if(!u?.id||!s)throw Error('Sign in to T-IOS first.');return u.id}
  async function request(path,{method='GET',body}={}){
   const {data,error}=await getClient().auth.getSession();const token=data?.session?.access_token;
   if(error||!token||data.session.user?.id!==getUser()?.id)throw Error('Your T-IOS session expired. Sign in again.');
   const r=await fetch(API+path,{method,headers:{authorization:'Bearer '+token},body});
   if(!r.ok){let response;try{response=await r.json()}catch(_){}throw Error(response?.error||'Cloudflare screenshot service is not ready.');}
   return r.headers.get('content-type')?.includes('application/json')?r.json():r.blob();
  }
  function status(message,bad=false){const node=root.querySelector('[data-capture-status]');if(node){node.textContent=message;node.classList.toggle('error',bad)}}
  function trades(){const user=getUser();return (getTrades()||[]).filter(t=>t.user_id===user?.id&&!t.is_deleted)}
  function pane(title,inner){root.innerHTML='<section class="tios-capture-dialog" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header><strong>'+esc(title)+'</strong><button type="button" data-capture-close aria-label="Close">×</button></header>'+inner+'<p class="tios-capture-status" data-capture-status role="status"></p></section>';root.hidden=false}
  function tradeOptions(selected){return '<option value="">Select trade…</option>'+trades().map(t=>'<option value="'+esc(t.id)+'" '+(selected===t.id?'selected':'')+'>Trade '+esc(getNumber(t.id)||'—')+' · '+esc(t.instrument||'')+' · '+esc(t.trade_date||'')+'</option>').join('')}
  async function screenshot(){
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Tab capture is unavailable here. Choose Upload screenshot.');
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false,preferCurrentTab:true});
    try{
      const track=stream.getVideoTracks()[0],video=document.createElement('video');video.srcObject=stream;video.muted=true;
      await video.play();if(!video.videoWidth)await new Promise(resolve=>setTimeout(resolve,350));
      if(!video.videoWidth)throw Error('The selected tab did not supply a video frame.');
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext('2d').drawImage(video,0,0);
      return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(new File([b],'tios-capture.png',{type:'image/png'})):reject(Error('Screenshot capture failed.')),'image/png'));
    }finally{stream.getTracks().forEach(t=>t.stop())}
  }
  function present(file,method){
    if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12582912){status('Choose PNG, JPG or WebP under 12 MB.',true);return}
    const image=new Image(),url=URL.createObjectURL(file);
    image.onload=()=>{
      if(draft?.url)URL.revokeObjectURL(draft.url);
      draft={file,url,method,width:image.naturalWidth,height:image.naturalHeight,...scope};
      if(!draft.width||!draft.height||draft.width*draft.height>60000000){status('The image dimensions are unsupported.',true);return}
      pane('Save chart screenshot','<img class="tios-capture-preview" src="'+url+'" alt="Screenshot preview"><label>Attach to trade<select data-capture-trade>'+tradeOptions(draft.tradeId)+'</select></label><label>Capture purpose<select data-capture-category>'+Object.entries(categories).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><label>Custom label<input data-capture-custom maxlength="90" placeholder="Optional"></label><label>Notes<textarea data-capture-note maxlength="1000" rows="2"></textarea></label><footer><button type="button" data-capture-save class="btn primary">Save evidence</button><button type="button" data-capture-close class="btn">Cancel</button></footer>');
    };
    image.onerror=()=>{URL.revokeObjectURL(url);status('Cannot read this screenshot.',true)};
    image.src=url;
  }
  function open(chart,tradeId){
    try{session()}catch(err){alert(err.message);return}
    scope={chartId:chart.id,symbol:chart.symbol,timeframe:chart.interval,tradeId};
    pane('Capture · '+chart.symbol,'<p>Choose how to capture this chart. Tab sharing requires browser permission. Select this T-IOS tab, then confirm the preview before saving.</p><div class="tios-capture-buttons"><button class="btn primary" type="button" data-capture-tab>Capture visible tab</button><button class="btn" type="button" data-capture-upload>Upload screenshot</button></div><input type="file" accept="image/png,image/jpeg,image/webp" data-capture-file hidden>');
  }
  async function save(){
    const id=root.querySelector('[data-capture-trade]')?.value,category=root.querySelector('[data-capture-category]')?.value;
    if(!draft||!id||!trades().some(t=>t.id===id)){status('Select a saved trade first.',true);return}
    const form=new FormData();for(const [k,v] of Object.entries({trade_id:id,category,custom_label:root.querySelector('[data-capture-custom]').value,note:root.querySelector('[data-capture-note]').value,chart_id:draft.chartId,symbol:draft.symbol,timeframe:draft.timeframe,capture_method:draft.method,image_width:draft.width,image_height:draft.height}))form.append(k,String(v));
    form.append('image',draft.file);uploading=true;root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=true);status('Saving private screenshot…');
    try{await request('/captures',{method:'POST',body:form});uploading=false;end();alert('Screenshot saved to Trade '+(getNumber(id)||'—')+'.');}
    catch(e){uploading=false;root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=false);status(e.message,true)}
  }
  async function gallery(tradeId){
    if(!trades().some(t=>t.id===tradeId))return;
    const current=++epoch;scope={tradeId};pane('Trade '+(getNumber(tradeId)||'—')+' · Captures','<div data-capture-gallery>Loading…</div>');
    try{
      const result=await request('/captures?trade_id='+encodeURIComponent(tradeId));
      if(current!==epoch)return;
      const rows=result.captures||[],area=root.querySelector('[data-capture-gallery]');
      area.innerHTML=rows.length?rows.map(row=>'<article class="tios-capture-item" data-capture-id="'+esc(row.id)+'"><strong>'+esc(categories[row.category]||row.custom_label)+' · '+esc(row.symbol)+' '+esc(row.timeframe)+'</strong><small>'+esc(new Date(row.captured_at).toLocaleString())+'</small><img alt="Saved chart capture" data-capture-image="'+esc(row.id)+'"><p>'+esc(row.note)+'</p><button class="btn small danger" type="button" data-capture-remove="'+esc(row.id)+'">Remove</button></article>').join(''):'No captured screenshots for this trade yet.';
      for(const row of rows){try{const blob=await request('/captures/'+row.id+'/image');if(current!==epoch)return;const url=URL.createObjectURL(blob);imageUrls.push(url);const img=area.querySelector('[data-capture-image="'+row.id+'"]');if(img)img.src=url;}catch(e){status('Some thumbnails could not load.',true)}}
    }catch(e){if(current===epoch)status(e.message,true)}
  }
  root.addEventListener('click',async e=>{
    if(e.target===root||e.target.closest('[data-capture-close]')){end();return}
    if(e.target.closest('[data-capture-upload]')){root.querySelector('[data-capture-file]')?.click();return}
    if(e.target.closest('[data-capture-tab]')){status('Choose this T-IOS tab in the browser sharing dialog.');try{present(await screenshot(),'tab')}catch(err){status(err.message,true)}return}
    if(e.target.closest('[data-capture-save]')){await save();return}
    const remove=e.target.closest('[data-capture-remove]');if(remove&&confirm('Remove this screenshot permanently?')){try{await request('/captures/'+remove.dataset.captureRemove,{method:'DELETE'});await gallery(scope.tradeId)}catch(err){status(err.message,true)}}
  });
  root.addEventListener('change',e=>{if(e.target.matches('[data-capture-file]')){const file=e.target.files[0];if(file)present(file,'upload')}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden&&!uploading)end()});
  window.addEventListener('tios:conversation-scope-changing',()=>{uploading=false;end()});
  return Object.freeze({open,gallery,reset:()=>{uploading=false;end()}});
 }
};
})();