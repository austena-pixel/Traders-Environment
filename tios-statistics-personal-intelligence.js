(function(){
'use strict';
const endpoint='/api/tios-personal-intelligence';
const panel=document.getElementById('statsPersonalIntelligence');
if(!panel)return;
const log=document.getElementById('statsPIMessages'),form=document.getElementById('statsPIForm'),input=document.getElementById('statsPIInput'),send=document.getElementById('statsPISend'),status=document.getElementById('statsPIStatus'),connection=document.getElementById('statsPIConnection');
const prompts=[...panel.querySelectorAll('[data-pi-prompt]')];
if(!log||!form||!input||!send||!status||!connection)return;
let history=[],busy=false,configured=null,openingRow=null,refreshTimer=0,scopePending=false,scopeEpoch=0;
const text=id=>document.getElementById(id)?.textContent?.trim().replace(/\s+/g,' ').slice(0,180)||'—';
function readContext(){
  const range=text('statsPeriodCurrent'),dates=text('statsDateRange');
  return {period:[range!=='—'?range:'',dates!=='—'?dates:''].filter(Boolean).join(' · ')||'selected period',summary:{
    currentBalance:text('statEquityHeaderEnding'),netPnl:text('statEquityHeaderNetPnl'),winRate:text('statWinRateGaugeValue'),
    periodReturn:text('statWinRateReturnLabel'),winRateCount:text('statWinRateGaugeCount'),profitFactor:text('statProfitFactorDiagramValue'),
    grossProfit:text('statProfitFactorGrossProfit'),grossLoss:text('statProfitFactorGrossLoss'),averagePnl:text('statsPrimaryAvgPnlValue'),
    tradeCount:text('statsPrimaryAvgPnlCount'),averageLoss:text('statsPrimaryAvgLoss'),averageProfit:text('statsPrimaryAvgProfit'),
    executionQuality:text('statNavExecution')
  }};
}
function accountScope(){
  try{const d=typeof window.getTiosConversationContext==='function'?window.getTiosConversationContext():null;return {key:JSON.stringify([d?.userId||null,d?.accountId||null]),ready:Boolean(d?.ready)}}
  catch{return {key:'unknown',ready:false}}
}
function openingText(c){
  const s=c.summary,count=(s.winRateCount.match(/\b(\d+)\s+trades?\b/i)||[])[1],facts=[];
  if(count)facts.push(count+' recorded trades');
  if(s.winRate!=='—')facts.push('a '+s.winRate+' win rate');
  if(s.periodReturn!=='—'&&!/—/.test(s.periodReturn))facts.push(s.periodReturn);
  if(s.profitFactor!=='—')facts.push('a '+s.profitFactor+' profit factor');
  let intro='I’m looking at '+c.period+'.';
  if(facts.length)intro+=' The visible summary shows '+facts.join(', ')+'.';
  else if(/no trades/i.test(s.winRateCount))intro+=' There are no closed trades recorded in this period yet.';
  else intro+=' Some of the statistics are still loading.';
  return facts.length
    ?intro+' These figures describe outcomes, but not what caused them. What would you like to explore first: the win/loss mix, execution quality, or a specific trade?'
    :intro+' What would be most useful to explore first: recorded outcomes, execution quality, or what evidence to collect next?';
}
function appendMessage(role,content){
  const row=document.createElement('article');row.className='stats-personal-intelligence-message';row.dataset.role=role;
  const avatar=document.createElement('span');avatar.className='stats-personal-intelligence-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=role==='user'?'YOU':'T';
  const body=document.createElement('div');body.className='stats-personal-intelligence-message-body';
  const sender=document.createElement('span');sender.className='stats-personal-intelligence-sender';sender.textContent=role==='user'?'You':'T·IOS';
  const bubble=document.createElement('div');bubble.className='stats-personal-intelligence-bubble';bubble.textContent=content;
  body.append(sender,bubble);row.append(avatar,body);log.append(row);log.scrollTop=log.scrollHeight;return row;
}
function keep(role,content){history.push({role,content});while(history.length>12)history.shift()}
function resizeInput(){input.style.height='auto';input.style.height=Math.min(112,Math.max(42,input.scrollHeight))+'px'}
function setStatus(message,error){status.textContent=message||'';if(error)status.dataset.error='true';else delete status.dataset.error}
function updateControls(){const account=accountScope();send.disabled=busy||!input.value.trim()||configured===false||!account.ready||scopePending;prompts.forEach(b=>b.disabled=busy||configured===false||!account.ready||scopePending)}
function resetConversation(c){
  history=[];log.replaceChildren();const opening=openingText(c);openingRow=appendMessage('assistant',opening);openingRow.dataset.opening='true';keep('assistant',opening);
  setStatus('',false);input.value='';resizeInput();updateControls();
}
let currentContext=readContext(),currentSignature=JSON.stringify(currentContext),currentScope=accountScope().key;
resetConversation(currentContext);
function refreshContext(){
  const scope=accountScope(),next=readContext(),signature=JSON.stringify(next);
  if(scope.key!==currentScope||scopePending){currentScope=scope.key;scopePending=false;currentContext=next;currentSignature=signature;resetConversation(next);return}
  if(signature===currentSignature)return;
  const previous=currentContext;currentContext=next;currentSignature=signature;
  if(!history.some(item=>item.role==='user')){
    const opening=openingText(next);
    if(openingRow?.isConnected){openingRow.querySelector('.stats-personal-intelligence-bubble').textContent=opening;history=[{role:'assistant',content:opening}]}
    else resetConversation(next);
    return;
  }
  const message=previous.period!==next.period
    ?'I see the Statistics view has changed to '+next.period+'. Would you like me to compare it with the period we were just discussing, or focus on this one?'
    :'The selected-period statistics have updated. Would you like me to review what changed?';
  appendMessage('assistant',message);keep('assistant',message);
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshContext,280)}
const observed=['statsPrimarySummary','statsPeriodCurrent','statsDateRange'].map(id=>document.getElementById(id)).filter(Boolean);
if(window.MutationObserver){const observer=new MutationObserver(scheduleRefresh);observed.forEach(node=>observer.observe(node,{subtree:true,childList:true,characterData:true}))}
window.addEventListener('tios:dashboard-updated',scheduleRefresh);window.addEventListener('tios:auth-ui',scheduleRefresh);
window.addEventListener('tios:conversation-scope-changing',()=>{
  scopeEpoch++;scopePending=true;history=[];log.replaceChildren();openingRow=null;
  appendMessage('assistant','Your selected account is changing. I’ll start a fresh conversation when its Statistics finish loading.');
  input.value='';setStatus('',false);updateControls();
});
async function checkConnection(){
  try{
    const response=await fetch(endpoint,{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin'}),data=await response.json();
    configured=Boolean(response.ok&&data.configured);connection.textContent=configured?'AI ready':'AI offline';connection.dataset.ready=String(configured);
    if(!configured)setStatus('The opening question works locally, but AI chat is not configured yet.',true);
  }catch{configured=null;connection.textContent='Connection unavailable';delete connection.dataset.ready;setStatus('Could not check the AI connection. Try again when the service is online.',true)}
  updateControls();
}
async function sendMessage(value){
  const message=String(value||'').trim().slice(0,2000);if(!message||busy)return;
  const account=accountScope();if(!account.ready){setStatus('Sign in and wait for your selected account to load before chatting.',true);return}
  if(configured===false){setStatus('T·IOS AI is not connected yet. The opening question is still available.',true);return}
  const epoch=scopeEpoch,snapshot=readContext(),row=appendMessage('user',message),requestHistory=history.slice(-10);
  busy=true;setStatus('T·IOS is thinking…',false);updateControls();input.disabled=true;
  try{
    if(typeof db==='undefined'||!db?.auth)throw new Error('Sign in to T·IOS before using Personal Intelligence.');
    const session=await db.auth.getSession(),token=session?.data?.session?.access_token;
    if(session?.error||!token)throw new Error('Your session has expired. Sign in again before chatting.');
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'same-origin',body:JSON.stringify({message,history:requestHistory,context:snapshot})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error?.message||'T·IOS could not reply right now. Try again shortly.');
    const answer=String(result.answer||'').trim();if(!answer)throw new Error('T·IOS returned an empty reply. Please try again.');
    if(epoch!==scopeEpoch||accountScope().key!==currentScope){setStatus('The selected account changed while T·IOS was responding. That reply was discarded.',true);return}
    keep('user',message);keep('assistant',answer);appendMessage('assistant',answer);input.value='';resizeInput();setStatus('',false);
  }catch(error){row.remove();setStatus(error.message||'T·IOS could not reply right now. Try again shortly.',true)}
  finally{busy=false;input.disabled=false;updateControls();input.focus({preventScroll:true})}
}
form.addEventListener('submit',event=>{event.preventDefault();sendMessage(input.value)});
input.addEventListener('input',()=>{resizeInput();updateControls()});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit()}});
prompts.forEach(button=>button.addEventListener('click',()=>sendMessage(button.dataset.piPrompt||'')));
checkConnection();
})();