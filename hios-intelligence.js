/* Homepage presentation adapter. No maturity scoring, generated conclusions,
   automated adaptations, payments or new database/storage migrations. */
(function(){
  'use strict';
  const model=window.HIOSIntelligenceDevelopment;
  const grid=document.getElementById('hiosDomainGrid');
  const dialog=document.getElementById('hiosIntelligenceDialog');
  if(!model||!grid||!dialog)return;
  const body=document.getElementById('hiosIntelligenceBody');
  const title=document.getElementById('hiosIntelligenceTitle');
  const product=document.getElementById('hiosIntelligenceProduct');
  const bell=document.getElementById('hiosIntelligenceNotifications');
  const badge=document.getElementById('hiosIntelligenceUnread');
  let state=model.emptyState(),readIds=[],view=null,opener=null,adapter=null,unsubscribe=null,epoch=0,lastDialogHtml='',lastGridHtml='',previousOverflow='';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const connected=domain=>domain.productId==='hios'||(typeof window.isProductAdded==='function'&&window.isProductAdded(domain.productId));
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
  function readKey(){return state.userId?'hios_intelligence_read_v1:'+encodeURIComponent(state.userId):null}
  function segments(level){
    return `<div class="hios-level-segments" role="img" aria-label="${level===null?'No maturity level established':`Level ${level} of 5 established`}">${model.LEVELS.map((_,i)=>`<i class="${level!==null&&i<=level?'established':''}" aria-hidden="true"></i>`).join('')}</div>`;
  }
  function assessment(domain){return state.maturity[domain.id]}
  function levelLabel(level){return level===null?'Not yet assessed':`Level ${level} · ${model.LEVELS[level].name}`}
  function sourceRecords(domain){
    if(domain.id!=='execution'||!connected(domain))return null;
    const contract=window.HIOSEvidenceContract;
    return model.ownedExecutionEvidence(readJson('hios_verified_evidence_v1',{}),state.userId,
      row=>!!contract&&contract.validateEvidence(row).valid);
  }
  function capabilityRows(domain){
    const foundation=connected(domain)?{label:'Available',tone:'available'}:{label:'Product not connected',tone:'pending'};
    const row=(name,status)=>`<div class="hios-capability-row"><b>${esc(name)}</b><span class="hios-intel-label ${status.tone}">${esc(status.label)}</span></div>`;
    return row(domain.foundation,foundation)+domain.future.map((name,index)=>{
      const id=`${domain.id}.future.${index}`;
      const result=connected(domain)?model.capabilityPresentation(state.readiness[id],state.entitlements[id]):{label:'Product not connected',tone:'pending'};
      return row(name,result);
    }).join('');
  }
  function overview(domain){
    const value=assessment(domain),level=model.assessedLevel(value);
    const quality=state.evidenceQuality[domain.id];
    const qualityCurrent=model.currentAssessment(quality);
    const records=sourceRecords(domain);
    const assessed=level!==null;
    const existing=value&&!assessed?'An earlier assessment is no longer current. Reassessment is required.':'No personal maturity level has been established for this domain.';
    const texts=(items,fallback)=>Array.isArray(items)&&items.length?items.filter(x=>typeof x==='string').map(x=>esc(x)).join('<br>'):fallback;
    const stages=model.LEVELS.map((item,i)=>`<li class="${level===i?'current':''}" ${level===i?'aria-current="step"':''}><span class="stage-index">${i}</span><div><b>${esc(item.name)}${level===i?' · Current':''}</b><p>${esc(item.description)}</p></div></li>`).join('');
    const count=(key)=>qualityCurrent&&Number.isInteger(quality[key])&&quality[key]>=0?String(quality[key]):'Not yet assessed';
    const recordText=records===null?'Domain coverage not yet assessed':`${records.length} matching source record${records.length===1?'':'s'} in this browser`;
    const evidenceList=records?.length?`<details><summary>Inspect received source records</summary><ul class="hios-source-records">${records.slice().sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)).slice(0,5).map(row=>`<li>Execution rule assessment · ${esc(row.subject.type)} ${esc(row.subject.id)}<small>Evidence ${esc(row.id)} · ${esc(new Date(row.observedAt).toLocaleString())}</small></li>`).join('')}</ul>${records.length>5?'<p>Showing the five most recently received records.</p>':''}</details>`:'';
    return `<section style="--intel-accent:${domain.accent}">
      <h3>Intelligence overview</h3><p>${esc(domain.purpose)}</p>
      <span class="hios-intel-label">${esc(levelLabel(level))}</span>${segments(level)}
      <p>${assessed?esc(model.LEVELS[level].description):existing}</p>
      <p>${assessed?`Assessment recorded ${esc(new Date(value.assessedAt).toLocaleDateString())}.`:'Awaiting evidence assessment.'} ${connected(domain)?'':'Connect the product through Add Product to use its existing tools.'}</p>
      <details><summary>Maturity development · Six proposed stages</summary><ol class="hios-maturity-stages">${stages}</ol><p>This framework requires validation. Stages represent stronger evidence-based understanding; adding records alone does not establish a level.</p>
      <h3>Next stage requirements</h3><p>${assessed?texts(value.nextRequirements,'Domain-specific promotion requirements have not yet been defined.'):'Requirements await a domain-specific assessment. Evidence quality, reliability, relevance, consistency and validation must be considered.'}</p></details>
    </section>
    <section><h3>Evidence overview</h3><p>${esc(domain.sources)}</p>
      <dl class="hios-evidence-facts"><dt>Relevant evidence</dt><dd>${esc(recordText)}</dd><dt>Reliability verified</dt><dd>${count('reliabilityVerified')}</dd><dt>Unverified or incomplete</dt><dd>${count('unverified')}</dd><dt>Quality assessment</dt><dd>${qualityCurrent?'Assessment received':'Pending'}</dd></dl>
      <p>${qualityCurrent&&typeof quality.summary==='string'?esc(quality.summary):'Receipt checks establish record format, not the truth or reliability of an observation. Evidence quality has not yet been assessed.'}</p>${evidenceList}
    </section>
    <section><h3>Capability development</h3>${capabilityRows(domain)}
      <p>Existing product tools remain available independently of maturity. Advanced capabilities await validated evidence and permission checks. Evidence readiness is separate from future subscription access.</p>
    </section>
    <section><h3>Intelligence transparency</h3>
      <details open><summary>What is currently understood?</summary><p>${assessed?texts(value.understanding,'No assessed personal conclusions have been supplied.'): 'No assessed personal conclusions have been established in this domain.'}</p></details>
      <details><summary>What evidence supports the understanding?</summary><p>${assessed?texts(value.supportingEvidence,'Evidence links await the assessment engine.'):'Source records can support future assessment, but no personal conclusion is being inferred from them here.'}</p></details>
      <details><summary>What remains uncertain?</summary><p>${assessed?texts(value.uncertainty,'Uncertainty has not yet been reported by the assessment engine.'):'Evidence reliability, recurring patterns, contextual relevance and predictive validity have not yet been established.'}</p></details>
      <details><summary>What could improve future understanding?</summary><p>${assessed?texts(value.additionalEvidence,esc(domain.sources)):esc(domain.sources)} Suitable source records, relevant context and measured outcomes can support future validation.</p></details>
      <p>Review and correct inaccurate records in the source product. Challenging an assessed conclusion will require the future assessment engine.</p>
    </section>`;
  }
  function renderNotifications(){
    const events=model.unreadEvents(state.notifications,state.userId,[]);
    if(!events.length)return '<div class="hios-intel-empty"><h3>No intelligence updates yet</h3><p>New assessments, capability availability and revised conclusions will appear here when validated intelligence events are connected.</p></div>';
    return `<ul class="hios-intel-events">${events.slice().sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)).map(event=>`<li><b>${esc(event.title||'Intelligence update')}</b><p>${esc(event.description||'')}</p><time datetime="${esc(event.occurredAt)}">${esc(new Date(event.occurredAt).toLocaleString())}</time></li>`).join('')}</ul>`;
  }
  function renderDialog(){
    if(!view)return;
    let markup='';
    if(view==='notifications'){
      product.textContent='H-IOS · Intelligence updates';title.textContent='Intelligence notifications';markup=renderNotifications();
    }else{
      const domain=model.DOMAINS.find(item=>item.id===view);
      if(!domain)return;
      product.textContent=`${domain.product} · Intelligence Development`;title.textContent=domain.name;markup=overview(domain);
    }
    if(markup!==lastDialogHtml){body.innerHTML=markup;lastDialogHtml=markup}
  }
  function render(){
    const markup=model.DOMAINS.map(domain=>{
      const level=model.assessedLevel(assessment(domain));
      const status=connected(domain)?(level===null?'Awaiting evidence assessment':'Validated assessment received'):'Product not connected';
      return `<button class="hios-domain" type="button" data-intelligence-domain="${domain.id}" style="--intel-accent:${domain.accent}" aria-haspopup="dialog" aria-label="${domain.product} ${esc(domain.name)}: ${esc(levelLabel(level))}"><span class="hios-domain-product"><span>${domain.product}</span><span aria-hidden="true">↗</span></span><span class="hios-domain-name">${esc(domain.name)}</span><span class="hios-domain-level">${level===null?'Not yet assessed':`Level ${level} · ${esc(model.LEVELS[level].name)}`}</span>${segments(level)}<span class="hios-domain-status">${esc(status)}</span></button>`;
    }).join('');
    if(lastGridHtml!==markup){
      const focused=document.activeElement?.dataset.intelligenceDomain;
      grid.innerHTML=markup;lastGridHtml=markup;
      if(focused&&!dialog.open)grid.querySelector(`[data-intelligence-domain="${focused}"]`)?.focus();
    }
    const unread=model.unreadEvents(state.notifications,state.userId,readIds).length;
    badge.textContent=String(unread);badge.hidden=unread===0;
    bell.setAttribute('aria-label',unread?`Intelligence notifications, ${unread} unread`:'Intelligence notifications, no unread updates');
    if(dialog.open)renderDialog();
  }
  function open(next,button){
    view=next;opener=button;renderDialog();
    previousOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow='hidden';
    dialog.showModal();body.scrollTop=0;
    if(next==='notifications'){
      readIds=[...new Set([...readIds,...model.unreadEvents(state.notifications,state.userId,readIds).map(event=>event.id)])];
      try{const key=readKey();if(key)localStorage.setItem(key,JSON.stringify(readIds))}catch{}
      render();
    }
  }
  function close(){if(dialog.open)dialog.close()}
  grid.addEventListener('click',event=>{const button=event.target.closest('[data-intelligence-domain]');if(button)open(button.dataset.intelligenceDomain,button)});
  bell.addEventListener('click',()=>open('notifications',bell));
  document.getElementById('hiosIntelligenceClose').addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close()});
  dialog.addEventListener('close',()=>{
    document.documentElement.style.overflow=previousOverflow;
    const domain=view;view=null;
    const button=domain==='notifications'?bell:grid.querySelector(`[data-intelligence-domain="${domain}"]`);
    if(button&&document.getElementById('appScreen')?.classList.contains('hidden')===false)button.focus();
    else if(opener?.isConnected)opener.focus();opener=null;
  });
  function applySnapshot(snapshot,userId,revision){
    // Future adapters must authenticate and validate assessments upstream.
    // Identity matching here prevents stale callbacks from another session.
    if(revision!==epoch||!userId||state.userId!==userId||snapshot?.schema!=='hios.intelligence-development.v1'||snapshot.userId!==userId)return;
    const next=model.emptyState(userId);
    ['maturity','evidenceQuality','readiness','entitlements','adaptation'].forEach(key=>{if(plainObject(snapshot[key]))next[key]=snapshot[key]});
    if(Array.isArray(snapshot.notifications))next.notifications=snapshot.notifications;
    state=next;render();
  }
  async function loadAdapter(){
    const userId=state.userId,revision=epoch;
    if(!adapter||!userId)return;
    try{
      if(typeof adapter.subscribe==='function')unsubscribe=adapter.subscribe({userId},snapshot=>applySnapshot(snapshot,userId,revision));
      if(typeof adapter.load==='function')applySnapshot(await adapter.load({userId}),userId,revision);
    }catch{if(revision===epoch){state=model.emptyState(userId);render()}}
  }
  function reset(){epoch++;try{if(typeof unsubscribe==='function')unsubscribe()}catch{}unsubscribe=null}
  window.HIOSIntelligenceUI=Object.freeze({
    setSessionUser(userId){
      const next=typeof userId==='string'&&userId?userId:null;
      if(state.userId===next)return;
      close();reset();state=model.emptyState(next);
      const stored=readKey()?readJson(readKey(),[]):[];readIds=Array.isArray(stored)?stored.filter(id=>typeof id==='string'):[];
      render();loadAdapter();
    },
    connect(provider){reset();adapter=provider||null;state=model.emptyState(state.userId);render();loadAdapter()},
    refresh:render
  });
  window.addEventListener('hios:structured-evidence-verified',render);
  window.addEventListener('storage',event=>{
    if(event.key===readKey()||event.key===null){const stored=readKey()?readJson(readKey(),[]):[];readIds=Array.isArray(stored)?stored.filter(id=>typeof id==='string'):[]}
    if(['hios_verified_evidence_v1','hios_added_products_v1',readKey(),null].includes(event.key))render();
  });
  // Expired assessments return to a pending state without invented notifications.
  window.setInterval(()=>{if(!document.hidden)render()},60000);
  render();
})();
