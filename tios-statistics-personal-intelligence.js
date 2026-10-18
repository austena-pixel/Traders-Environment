(function(){
'use strict';
const endpoint='/api/tios-personal-intelligence';
const panel=document.getElementById('statsPersonalIntelligence');
if(!panel)return;
const log=document.getElementById('statsPIMessages'),form=document.getElementById('statsPIForm'),input=document.getElementById('statsPIInput'),send=document.getElementById('statsPISend'),status=document.getElementById('statsPIStatus'),connection=document.getElementById('statsPIConnection');
const prompts=[...panel.querySelectorAll('[data-pi-prompt]')];
const historyPanel=document.getElementById('statsPIHistory'),historyList=document.getElementById('statsPIHistoryList'),settingsPanel=document.getElementById('statsPISettings'),settingsNote=document.getElementById('statsPISettingsNote');
const actions=[...panel.querySelectorAll('[data-pi-action]')];
const table={conversations:'tios_personal_intelligence_conversations',messages:'tios_personal_intelligence_messages',preferences:'tios_personal_intelligence_preferences'};
const defaults={proactive_enabled:false,conversation_frequency:'balanced',investigation_focus:'both',personalization_enabled:true,include_trade_evidence:true,retention_days:365,development_goal:''};
const engine=window.TIOSPersonalIntelligenceEngine||null;
let history=[],busy=false,configured=null,openingRow=null,refreshTimer=0,scopePending=false,scopeEpoch=0,currentConversationId=null,currentConversationKind='user';
let currentContext=readContext(),currentSignature=JSON.stringify(currentContext),currentScope=accountScope().key,lastScopeReady=false;
let preferences={...defaults},persistenceAvailable=false,preferencesLoaded=false,topicCounts=[],feedbackCounts={helpful:0,notRelevant:0};
let persistenceMessageShown=false,savePreferencesTimer=0,quotaAvailableAt=0,quotaTimer=0,observationBusy=false;

function text(id){return document.getElementById(id)?.textContent?.trim().replace(/\s+/g,' ').slice(0,180)||'—'}
function accountScope(){
  try{
    const data=typeof window.getTiosConversationScope==='function'?window.getTiosConversationScope():typeof window.getTiosConversationContext==='function'?window.getTiosConversationContext():null;
    return {key:JSON.stringify([data?.userId||null,data?.accountId||null]),userId:data?.userId||null,accountId:data?.accountId||null,ready:Boolean(data?.ready)};
  }catch{return {key:'unknown',userId:null,accountId:null,ready:false}}
}
function isCurrentScope(scope,epoch=scopeEpoch){
  return Boolean(scope?.ready&&!scopePending&&epoch===scopeEpoch&&scope.key===currentScope&&scope.key===accountScope().key);
}
function readContext(){
  const range=text('statsPeriodCurrent'),dates=text('statsDateRange');
  const source=typeof window.getTiosConversationContext==='function'?window.getTiosConversationContext():null;
  return {
    period:[range!=='—'?range:'',dates!=='—'?dates:''].filter(Boolean).join(' · ')||'selected period',
    summary:{
      currentBalance:text('statEquityHeaderEnding'),netPnl:text('statEquityHeaderNetPnl'),winRate:text('statWinRateGaugeValue'),
      periodReturn:text('statWinRateReturnLabel'),winRateCount:text('statWinRateGaugeCount'),profitFactor:text('statProfitFactorDiagramValue'),
      grossProfit:text('statProfitFactorGrossProfit'),grossLoss:text('statProfitFactorGrossLoss'),averagePnl:text('statsPrimaryAvgPnlValue'),
      tradeCount:text('statsPrimaryAvgPnlCount'),averageLoss:text('statsPrimaryAvgLoss'),averageProfit:text('statsPrimaryAvgProfit'),
      executionQuality:text('statNavExecution')
    },
    ...(source?.evidence?{evidence:source.evidence}:{})
  };
}
function requestContext(){
  const snapshot=readContext();
  if(!preferences.include_trade_evidence)delete snapshot.evidence;
  if(preferences.personalization_enabled){
    snapshot.memory={enabled:true,focus:preferences.investigation_focus,goal:preferences.development_goal||'',recentTopics:topicCounts,feedback:feedbackCounts};
  }
  return snapshot;
}
function setStatus(message,error){status.textContent=message||'';if(error)status.dataset.error='true';else delete status.dataset.error}
function localTime(value){
  const parsed=value?new Date(value):new Date();
  if(Number.isNaN(parsed.getTime()))return '';
  return parsed.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function evidenceSummary(context){
  const evidence=context?.evidence;
  if(!evidence)return null;
  const summary=document.createElement('details');summary.className='stats-personal-intelligence-evidence';
  const title=document.createElement('summary');
  const count=Number(evidence.includedTrades)||0,total=Number(evidence.totalTrades)||0;
  title.textContent=count?`Evidence context · ${count} of ${total} selected-period trades`:'Evidence context · selected period';
  summary.append(title);
  const list=document.createElement('ul');
  const add=line=>{const item=document.createElement('li');item.textContent=line;list.append(item)};
  if(context.period)add('Statistics period: '+context.period);
  if(evidence.edge)add(`Edge: ${evidence.edge.reviewedTrades||0} reviewed trades, ${evidence.edge.totalChecks||0} checks`);
  if(evidence.execution)add(`Execution: ${evidence.execution.reviewedTrades||0} reviewed trades, ${evidence.execution.totalChecks||0} checks`);
  if(evidence.psychology)add(`Trading Day reflections: ${evidence.psychology.includedSessions||0} of ${evidence.psychology.totalSessions||0} in this period`);
  (evidence.trades||[]).slice(0,20).forEach(trade=>{
    const details=[trade.reference,trade.date,trade.instrument,trade.pnl===null||trade.pnl===undefined?null:'P&L '+trade.pnl].filter(Boolean).join(' · ');
    if(details)add(details);
    if(trade.playbookVersion)add(`${trade.reference||'Trade'} · Playbook ${trade.playbookVersion.name} v${trade.playbookVersion.version}`);
    if(trade.journalNote)add(`${trade.reference||'Trade'} · Journal note: ${trade.journalNote}`);
    (trade.setupEvidence||[]).forEach(item=>add(`${trade.reference||'Trade'} · Setup evidence: ${[item.timeframe,item.responsibility].filter(Boolean).join(' · ')}`));
  });
  if(evidence.omittedTrades)add(`${evidence.omittedTrades} older trade records were omitted from this request.`);
  summary.append(list);return summary;
}
function addFeedback(row,messageId,feedback){
  if(!messageId)return;
  const bar=document.createElement('div');bar.className='stats-personal-intelligence-feedback';
  for(const [value,label] of [['helpful','Helpful'],['not_relevant','Needs work']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.piFeedback=value;
    button.setAttribute('aria-pressed',String(feedback===value));
    button.addEventListener('click',()=>saveFeedback(messageId,value,bar));bar.append(button);
  }
  row.querySelector('.stats-personal-intelligence-message-body')?.append(bar);
}
function appendMessage(role,content,options={}){
  const row=document.createElement('article');row.className='stats-personal-intelligence-message';row.dataset.role=role;
  row.dataset.source=options.source|| (role==='user'?'user':'assistant');
  if(options.messageId)row.dataset.messageId=options.messageId;
  const avatar=document.createElement('span');avatar.className='stats-personal-intelligence-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=role==='user'?'YOU':'T';
  const body=document.createElement('div');body.className='stats-personal-intelligence-message-body';
  const sender=document.createElement('span');sender.className='stats-personal-intelligence-sender';sender.textContent=role==='user'?'You':options.source==='observation'?'T·IOS observation':'T·IOS';
  const time=document.createElement('time');time.className='stats-personal-intelligence-time';time.dateTime=options.createdAt||new Date().toISOString();time.textContent=localTime(time.dateTime);sender.append(time);
  const bubble=document.createElement('div');bubble.className='stats-personal-intelligence-bubble';bubble.textContent=content;
  body.append(sender,bubble);
  if(options.context){const evidence=evidenceSummary(options.context);if(evidence)body.append(evidence)}
  row.append(avatar,body);log.append(row);log.scrollTop=log.scrollHeight;
  if(role==='assistant'&&options.messageId)addFeedback(row,options.messageId,options.feedback||null);
  return row;
}
function keep(role,content){history.push({role,content});while(history.length>12)history.shift()}
function resizeInput(){input.style.height='auto';input.style.height=Math.min(112,Math.max(42,input.scrollHeight))+'px'}
function updateControls(){
  const account=accountScope(),cooling=Date.now()<quotaAvailableAt;
  send.disabled=busy||!input.value.trim()||configured===false||!account.ready||scopePending||cooling;
  prompts.forEach(button=>button.disabled=busy||configured===false||!account.ready||scopePending||cooling);
}
function updateActionPanels(which){
  const showHistory=which==='history'&&historyPanel.hidden,showSettings=which==='settings'&&settingsPanel.hidden;
  historyPanel.hidden=!showHistory;settingsPanel.hidden=!showSettings;
  actions.forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.piAction==='history'?showHistory:button.dataset.piAction==='settings'?showSettings:false)));
  if(showHistory)refreshHistoryList();
}
function resetConversation(context){
  currentConversationId=null;currentConversationKind='user';history=[];log.replaceChildren();
  const opening=openingText(context);openingRow=appendMessage('assistant',opening,{source:'local_start'});openingRow.dataset.opening='true';keep('assistant',opening);
  setStatus('',false);input.value='';resizeInput();updateControls();
}
function openingText(context){
  const summary=context.summary,count=(summary.winRateCount.match(/\b(\d+)\s+trades?\b/i)||[])[1],facts=[];
  if(count)facts.push(count+' recorded trades');
  if(summary.winRate!=='—')facts.push('a '+summary.winRate+' win rate');
  if(summary.periodReturn!=='—'&&!/—/.test(summary.periodReturn))facts.push(summary.periodReturn);
  if(summary.profitFactor!=='—')facts.push('a '+summary.profitFactor+' profit factor');
  let intro='I’m looking at '+context.period+'.';
  if(facts.length)intro+=' The visible summary shows '+facts.join(', ')+'.';
  else if(/no trades/i.test(summary.winRateCount))intro+=' There are no closed trades recorded in this period yet.';
  else intro+=' Some of the statistics are still loading.';
  return facts.length?intro+' These figures describe outcomes, but not what caused them. What would you like to explore first: the win/loss mix, execution quality, or a specific trade?':intro+' What would be most useful to explore first: recorded outcomes, execution quality, or what evidence to collect next?';
}
function unavailableMessage(){
  persistenceAvailable=false;
  if(settingsNote)settingsNote.textContent='Conversation storage and preferences need the Personal Intelligence Supabase migration. The chat remains available for this session.';
  if(!persistenceMessageShown){setStatus('Chat history is not connected yet. The Personal Intelligence database migration has not been applied.',true);persistenceMessageShown=true}
}
function supabaseReady(){return typeof db!=='undefined'&&db?.from&&db?.auth}
function updatePreferencesFromUI(){
  preferences={
    proactive_enabled:Boolean(document.getElementById('statsPIProactive').checked),
    conversation_frequency:document.getElementById('statsPIFrequency').value,
    investigation_focus:document.getElementById('statsPIFocus').value,
    personalization_enabled:Boolean(document.getElementById('statsPIPersonalization').checked),
    include_trade_evidence:Boolean(document.getElementById('statsPIIncludeEvidence').checked),
    retention_days:Number(document.getElementById('statsPIRetention').value),
    development_goal:document.getElementById('statsPIGoal').value.trim().slice(0,500)
  };
}
function renderPreferences(){
  document.getElementById('statsPIProactive').checked=preferences.proactive_enabled;
  document.getElementById('statsPIFrequency').value=preferences.conversation_frequency;
  document.getElementById('statsPIFocus').value=preferences.investigation_focus;
  document.getElementById('statsPIPersonalization').checked=preferences.personalization_enabled;
  document.getElementById('statsPIIncludeEvidence').checked=preferences.include_trade_evidence;
  document.getElementById('statsPIRetention').value=String(preferences.retention_days);
  document.getElementById('statsPIGoal').value=preferences.development_goal||'';
}
async function savePreferences(){
  if(!preferencesLoaded)return;
  const scope=accountScope();if(!scope.ready||!persistenceAvailable)return;
  updatePreferencesFromUI();
  const {error}=await db.from(table.preferences).upsert({...preferences,user_id:scope.userId,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error){unavailableMessage();return}
  if(settingsNote)settingsNote.textContent='Settings saved. Proactive observations and retention cleanup run only while T-IOS is open.';
  if(preferences.proactive_enabled)processObservations();
}
function scheduleSavePreferences(){clearTimeout(savePreferencesTimer);savePreferencesTimer=setTimeout(savePreferences,220)}
async function pruneHistory(scope){
  if(!preferences.retention_days)return;
  const cutoff=new Date(Date.now()-preferences.retention_days*86400000).toISOString();
  const {error}=await db.from(table.conversations).delete().eq('user_id',scope.userId).eq('account_id',scope.accountId).lt('last_message_at',cutoff);
  if(error)throw error;
}
async function loadPreferences(scope,epoch=scopeEpoch){
  const result=await db.from(table.preferences).select('*').eq('user_id',scope.userId).maybeSingle();
  if(result.error)throw result.error;
  if(!isCurrentScope(scope,epoch))return false;
  if(result.data){preferences={...defaults,...result.data};}
  else{
    preferences={...defaults};
    const inserted=await db.from(table.preferences).insert({...preferences,user_id:scope.userId}).select().single();
    if(inserted.error)throw inserted.error;
    if(!isCurrentScope(scope,epoch))return false;
    preferences={...defaults,...inserted.data};
  }
  preferencesLoaded=true;renderPreferences();
  return true;
}
async function loadTopicsAndFeedback(conversations,scope,epoch=scopeEpoch){
  const counts=new Map();
  conversations.slice(0,30).forEach(conversation=>{
    const topic=conversation.topic||'general';counts.set(topic,(counts.get(topic)||0)+1);
  });
  const nextTopics=[...counts.entries()].map(([topic,count])=>({topic,count})).sort((a,b)=>b.count-a.count).slice(0,5);
  const nextFeedback={helpful:0,notRelevant:0};
  const ids=conversations.slice(0,30).map(item=>item.id);
  if(ids.length){
    const {data,error}=await db.from(table.messages).select('feedback').eq('user_id',scope.userId).in('conversation_id',ids).not('feedback','is',null);
    if(error)return;
    (data||[]).forEach(item=>{if(item.feedback==='helpful')nextFeedback.helpful++;if(item.feedback==='not_relevant')nextFeedback.notRelevant++});
  }
  if(!isCurrentScope(scope,epoch))return;
  topicCounts=nextTopics;feedbackCounts=nextFeedback;
}
async function refreshHistoryList(scopeOverride=null,epoch=scopeEpoch){
  const scope=scopeOverride||accountScope();
  if(!scope.ready||!persistenceAvailable){historyList.replaceChildren();const empty=document.createElement('p');empty.className='stats-pi-history-empty';empty.textContent='Saved conversations will appear here after the database migration is applied.';historyList.append(empty);return []}
  const {data,error}=await db.from(table.conversations).select('id,title,topic,conversation_kind,observation_priority,last_message_at,created_at').eq('user_id',scope.userId).eq('account_id',scope.accountId).order('last_message_at',{ascending:false}).limit(30);
  if(error){if(isCurrentScope(scope,epoch))unavailableMessage();return []}
  if(!isCurrentScope(scope,epoch))return [];
  const conversations=data||[];historyList.replaceChildren();
  if(!conversations.length){topicCounts=[];feedbackCounts={helpful:0,notRelevant:0};const empty=document.createElement('p');empty.className='stats-pi-history-empty';empty.textContent='No saved conversations for this account yet.';historyList.append(empty);return conversations}
  conversations.forEach(conversation=>{
    const row=document.createElement('div');row.className='stats-pi-history-row';
    const open=document.createElement('button');open.type='button';open.className='stats-pi-history-open';open.dataset.piOpenConversation=conversation.id;
    const title=document.createElement('span');title.textContent=conversation.title||'Personal Intelligence chat';
    const meta=document.createElement('span');meta.className='stats-pi-history-meta';meta.textContent=(conversation.conversation_kind==='observation'?'T·IOS observation · ':'')+localTime(conversation.last_message_at);
    open.append(title,meta);open.addEventListener('click',()=>openConversation(conversation.id));
    const remove=document.createElement('button');remove.type='button';remove.className='stats-pi-history-delete';remove.textContent='×';remove.setAttribute('aria-label','Delete '+(conversation.title||'conversation'));remove.addEventListener('click',()=>deleteConversation(conversation.id));
    row.append(open,remove);historyList.append(row);
  });
  await loadTopicsAndFeedback(conversations,scope,epoch);
  return conversations;
}
async function loadConversation(id){
  const scope=accountScope();
  const {data:conversation,error:conversationError}=await db.from(table.conversations).select('id,conversation_kind,title,topic').eq('id',id).eq('user_id',scope.userId).eq('account_id',scope.accountId).maybeSingle();
  if(conversationError)throw conversationError;
  if(!conversation)throw new Error('That conversation is no longer available for the selected account.');
  const {data,error}=await db.from(table.messages).select('id,role,source,content,evidence_context,feedback,created_at').eq('conversation_id',id).eq('user_id',scope.userId).order('created_at',{ascending:true}).order('id',{ascending:true});
  if(error)throw error;
  if(!isCurrentScope(scope))return;
  currentConversationId=id;currentConversationKind=conversation.conversation_kind||'user';history=[];log.replaceChildren();openingRow=null;
  (data||[]).forEach(message=>{
    const messageContext=message.evidence_context&&Object.keys(message.evidence_context).length?message.evidence_context:null;
    appendMessage(message.role,message.content,{source:message.source,messageId:message.id,feedback:message.feedback,createdAt:message.created_at,context:messageContext});
    history.push({role:message.role,content:message.content});
  });
  while(history.length>12)history.shift();
  if(!(data||[]).length)resetConversation(currentContext);
  setStatus('',false);input.value='';resizeInput();updateControls();
}
async function openConversation(id){
  try{await loadConversation(id);historyPanel.hidden=true;actions.find(button=>button.dataset.piAction==='history')?.setAttribute('aria-expanded','false')}
  catch(error){setStatus('Could not open that conversation. '+(error.message||''),true)}
}
async function refreshHistory(){
  const scope=accountScope();if(!scope.ready||!persistenceAvailable)return [];
  return refreshHistoryList();
}
async function deleteConversation(id){
  if(!confirm('Delete this saved Personal Intelligence conversation? This also removes its messages.'))return;
  const scope=accountScope();
  const {error}=await db.from(table.conversations).delete().eq('id',id).eq('user_id',scope.userId).eq('account_id',scope.accountId);
  if(error){setStatus('The conversation could not be deleted.',true);return}
  if(currentConversationId===id)resetConversation(readContext());
  await refreshHistory();setStatus('Conversation deleted.',false);
}
async function clearConversationHistory(){
  if(!confirm('Delete every saved Personal Intelligence conversation for this account? This cannot be undone.'))return;
  const scope=accountScope();if(!scope.ready||!persistenceAvailable)return;
  const {error}=await db.from(table.conversations).delete().eq('user_id',scope.userId).eq('account_id',scope.accountId);
  if(error){setStatus('Saved conversations could not be deleted.',true);return}
  currentConversationId=null;resetConversation(readContext());await refreshHistory();
  if(settingsNote)settingsNote.textContent='Saved conversations for this account were deleted.';
}
async function saveFeedback(messageId,value,bar){
  const scope=accountScope();if(!persistenceAvailable||!scope.ready)return;
  const previous=bar.querySelector('button[aria-pressed="true"]')?.dataset.piFeedback||null;
  if(previous===value)return;
  const {error}=await db.from(table.messages).update({feedback:value}).eq('id',messageId).eq('user_id',scope.userId);
  if(error){setStatus('Feedback could not be saved.',true);return}
  bar.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.piFeedback===value)));
  if(previous==='helpful')feedbackCounts.helpful=Math.max(0,feedbackCounts.helpful-1);
  if(previous==='not_relevant')feedbackCounts.notRelevant=Math.max(0,feedbackCounts.notRelevant-1);
  feedbackCounts[value==='helpful'?'helpful':'notRelevant']++;
  setStatus('Feedback saved for future Personal Intelligence suggestions.',false);
}
async function persistMessage(conversationId,role,source,content,context){
  const scope=accountScope();
  const safeContext=context?{period:context.period||'',summary:context.summary||{},...(context.evidence?{evidence:context.evidence}:{})}:{};
  const {data,error}=await db.from(table.messages).insert({conversation_id:conversationId,user_id:scope.userId,role,source,content:String(content).slice(0,6000),evidence_context:safeContext}).select('id,created_at').single();
  if(error)throw error;
  return data;
}
async function ensureConversation(context){
  if(!persistenceAvailable)return null;
  const scope=accountScope();if(!scope.ready)return null;
  if(currentConversationId)return currentConversationId;
  const {data,error}=await db.from(table.conversations).insert({user_id:scope.userId,account_id:scope.accountId,title:'New investigation',topic:'general',conversation_kind:'user'}).select('id,conversation_kind').single();
  if(error)throw error;
  currentConversationId=data.id;currentConversationKind=data.conversation_kind||'user';
  if(openingRow?.isConnected&&openingRow.dataset.persisted!=='true'){
    const bubble=openingRow.querySelector('.stats-personal-intelligence-bubble');
    const saved=await persistMessage(data.id,'assistant','local_start',bubble?.textContent||'What would you like to investigate?',context);
    openingRow.dataset.persisted='true';openingRow.dataset.messageId=saved.id;
    const time=openingRow.querySelector('time');if(time&&saved.created_at){time.dateTime=saved.created_at;time.textContent=localTime(saved.created_at)}
  }
  return data.id;
}
async function updateConversationAfterMessage(conversationId,message,topic){
  const scope=accountScope(),update={last_message_at:new Date().toISOString(),topic};
  if(currentConversationKind==='user')update.title=String(message||'New investigation').trim().replace(/\s+/g,' ').slice(0,80)||'New investigation';
  const {error}=await db.from(table.conversations).update(update).eq('id',conversationId).eq('user_id',scope.userId).eq('account_id',scope.accountId);
  if(error)throw error;
}
function handleDatabaseUnavailable(){
  unavailableMessage();preferencesLoaded=false;
  if(!persistenceAvailable){preferences={...defaults};renderPreferences()}
}
async function loadScopeData(epoch){
  const scope=accountScope();if(!scope.ready||!supabaseReady())return;
  if(!isCurrentScope(scope,epoch))return;
  persistenceAvailable=false;preferencesLoaded=false;
  try{
    const session=await db.auth.getSession(),user=session?.data?.session?.user;
    if(session?.error||!user||user.is_anonymous||user.id!==scope.userId)throw new Error('The authenticated T-IOS account is not ready.');
    if(!isCurrentScope(scope,epoch))return;
    if(!await loadPreferences(scope,epoch))return;
    persistenceAvailable=true;persistenceMessageShown=false;
    await pruneHistory(scope);
    if(!isCurrentScope(scope,epoch))return;
    const conversations=await refreshHistoryList(scope,epoch);
    if(!isCurrentScope(scope,epoch))return;
    if(conversations.length)await loadConversation(conversations[0].id);
    else resetConversation(readContext());
    if(settingsNote)settingsNote.textContent='Settings saved. Proactive observations and retention cleanup run only while T-IOS is open.';
    if(preferences.proactive_enabled)await processObservations();
  }catch(error){
    console.warn('Personal Intelligence persistence is unavailable:',error);
    if(epoch===scopeEpoch)handleDatabaseUnavailable();
  }
}
function formatCooldown(retryAfter){
  const seconds=Math.max(1,Number(retryAfter)||60),minutes=Math.ceil(seconds/60);
  quotaAvailableAt=Date.now()+seconds*1000;
  const wait=minutes>=60?`${Math.ceil(minutes/60)}h`:`${minutes}m`;
  connection.textContent='Quota cooldown';connection.dataset.ready='false';
  setStatus(`The AI request limit is reached. Try again in ${wait}. Your message was not sent.`,true);
  clearTimeout(quotaTimer);quotaTimer=setTimeout(()=>{quotaAvailableAt=0;connection.textContent=configured?'AI configured':'AI offline';connection.dataset.ready=String(Boolean(configured));setStatus('You can try another AI message now.',false);updateControls()},seconds*1000);
}
async function checkConnection(){
  try{
    const response=await fetch(endpoint,{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin'}),data=await response.json();
    configured=Boolean(response.ok&&data.configured);connection.textContent=configured?'AI configured':'AI offline';connection.dataset.ready=String(configured);connection.title=configured?'Configuration is present. Per-user request limits are checked when you send.':'AI service configuration is unavailable.';
    if(!configured)setStatus('The local opening question works, but AI chat is not configured yet.',true);
  }catch{configured=null;connection.textContent='Connection unavailable';delete connection.dataset.ready;setStatus('Could not check the AI connection. Try again when the service is online.',true)}
  updateControls();
}
function currentEvidenceContext(snapshot){return snapshot?.evidence?{period:snapshot.period,summary:snapshot.summary,evidence:snapshot.evidence}:null}
async function sendMessage(value){
  const message=String(value||'').trim().slice(0,2000);if(!message||busy)return;
  const account=accountScope();if(!account.ready){setStatus('Sign in and wait for your selected account to load before chatting.',true);return}
  if(configured===false){setStatus('T·IOS AI is not connected yet. The opening question is still available.',true);return}
  if(Date.now()<quotaAvailableAt){updateControls();return}
  const epoch=scopeEpoch,snapshot=requestContext(),row=appendMessage('user',message),requestHistory=history.slice(-3).map(item=>({role:item.role,content:item.content.slice(0,500)}));
  busy=true;setStatus('T·IOS is reviewing the selected evidence…',false);updateControls();input.disabled=true;
  try{
    if(!supabaseReady())throw new Error('Sign in to T·IOS before using Personal Intelligence.');
    const session=await db.auth.getSession(),token=session?.data?.session?.access_token;
    if(session?.error||!token)throw new Error('Your session has expired. Sign in again before chatting.');
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'same-origin',body:JSON.stringify({message,history:requestHistory,context:snapshot})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      if(result.error?.code==='usage_limit'){row.remove();formatCooldown(result.error.retryAfter);return}
      if(['gateway_budget_limit','gateway_credit_balance','gateway_authentication','ai_not_configured','provider_busy','service_timeout','generation_failed'].includes(result.error?.code)){connection.textContent=result.error?.code==='provider_busy'?'AI busy':'AI unavailable';connection.dataset.ready='false'}
      throw new Error(result.error?.message||'T·IOS could not reply right now. Try again shortly.');
    }
    const answer=String(result.answer||'').trim();if(!answer)throw new Error('T·IOS returned an empty reply. Please try again.');
    connection.textContent='AI configured';connection.dataset.ready='true';
    if(epoch!==scopeEpoch||accountScope().key!==currentScope){setStatus('The selected account changed while T·IOS was responding. That reply was discarded.',true);return}
    let conversationId=null,userRow=null,assistantRow=null;
    if(persistenceAvailable){
      try{
        conversationId=await ensureConversation(snapshot);
        if(conversationId){
          const userSaved=await persistMessage(conversationId,'user','user',message,currentEvidenceContext(snapshot));
          await updateConversationAfterMessage(conversationId,message,engine?.classifyTopic(message)||'general');
          const answerSaved=await persistMessage(conversationId,'assistant','assistant',answer,currentEvidenceContext(snapshot));
          userRow=appendMessage('user',message,{messageId:userSaved.id,createdAt:userSaved.created_at,context:currentEvidenceContext(snapshot)});
          assistantRow=appendMessage('assistant',answer,{messageId:answerSaved.id,createdAt:answerSaved.created_at,context:currentEvidenceContext(snapshot)});
        }
      }catch(error){console.warn('Personal Intelligence conversation could not be saved:',error);setStatus('T·IOS replied, but this conversation could not be saved. Check the database setup.',true)}
    }
    if(!userRow)userRow=appendMessage('user',message,{context:currentEvidenceContext(snapshot)});
    if(!assistantRow)assistantRow=appendMessage('assistant',answer,{context:currentEvidenceContext(snapshot)});
    row.remove();keep('user',message);keep('assistant',answer);input.value='';resizeInput();
    if(!status.dataset.error)setStatus('',false);
    if(conversationId)refreshHistory();
  }catch(error){row.remove();setStatus(error.message||'T·IOS could not reply right now. Try again shortly.',true)}
  finally{busy=false;input.disabled=false;updateControls();input.focus({preventScroll:true})}
}
async function processObservations(){
  if(observationBusy||!engine||!persistenceAvailable||!preferences.proactive_enabled||scopePending)return;
  const scope=accountScope();if(!scope.ready||!currentContext.evidence)return;
  const candidate=engine.detectObservations(currentContext,preferences)[0];
  if(!engine.frequencyAllows(candidate,preferences.conversation_frequency))return;
  observationBusy=true;
  try{
    const {data:recent,error:recentError}=await db.from(table.conversations).select('last_message_at').eq('user_id',scope.userId).eq('account_id',scope.accountId).eq('conversation_kind','observation').order('last_message_at',{ascending:false}).limit(1);
    if(recentError)throw recentError;
    const cooldown=engine.cooldownMs(preferences.conversation_frequency),last=recent?.[0]?.last_message_at;
    if(last&&Date.now()-new Date(last).getTime()<cooldown)return;
    const topic=candidate.type.includes('execution')?'execution':candidate.type.includes('edge')||candidate.type.includes('playbook')?'edge':'statistics';
    const inserted=await db.from(table.conversations).upsert({
      user_id:scope.userId,account_id:scope.accountId,title:candidate.title,topic,conversation_kind:'observation',observation_key:candidate.observationKey,observation_priority:candidate.priority
    },{onConflict:'user_id,account_id,observation_key',ignoreDuplicates:true}).select('id,conversation_kind').maybeSingle();
    if(inserted.error)throw inserted.error;
    if(!inserted.data)return;
    const snapshot=requestContext(),messageContext=currentEvidenceContext(snapshot);
    const saved=await persistMessage(inserted.data.id,'assistant','observation',candidate.text,messageContext);
    const {error:updateError}=await db.from(table.conversations).update({last_message_at:saved.created_at}).eq('id',inserted.data.id).eq('user_id',scope.userId).eq('account_id',scope.accountId);
    if(updateError)throw updateError;
    if(!currentConversationId||!history.some(item=>item.role==='user'))await loadConversation(inserted.data.id);
    else setStatus('T·IOS started a new evidence-based observation. Open History to view it.',false);
    await refreshHistory();
  }catch(error){console.warn('Proactive observation could not be saved:',error)}
  finally{observationBusy=false}
}
function refreshContext(){
  const scope=accountScope(),next=readContext(),signature=JSON.stringify(next);
  if(scope.key!==currentScope||scope.ready!==lastScopeReady||scopePending){
    currentScope=scope.key;lastScopeReady=scope.ready;scopePending=false;scopeEpoch++;currentContext=next;currentSignature=signature;
    currentConversationId=null;resetConversation(next);persistenceAvailable=false;preferencesLoaded=false;
    if(scope.ready)loadScopeData(scopeEpoch);else updateControls();
    return;
  }
  if(signature===currentSignature)return;
  currentContext=next;currentSignature=signature;
  if(!history.some(item=>item.role==='user')&&!currentConversationId){
    const opening=openingText(next);
    if(openingRow?.isConnected){openingRow.querySelector('.stats-personal-intelligence-bubble').textContent=opening;history=[{role:'assistant',content:opening}]}
    else resetConversation(next);
  }
  if(preferences.proactive_enabled)processObservations();
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshContext,280)}
function setupSettings(){
  ['statsPIProactive','statsPIFrequency','statsPIFocus','statsPIPersonalization','statsPIIncludeEvidence','statsPIRetention','statsPIGoal'].forEach(id=>document.getElementById(id)?.addEventListener('change',scheduleSavePreferences));
  document.getElementById('statsPIClearHistory')?.addEventListener('click',clearConversationHistory);
}
function setupActions(){
  actions.forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.piAction;
    if(action==='new'){historyPanel.hidden=true;settingsPanel.hidden=true;currentConversationId=null;resetConversation(readContext());setStatus('New conversation ready.',false);return}
    updateActionPanels(action);
  }));
  log.addEventListener('keydown',event=>{if(event.key==='Escape'){historyPanel.hidden=true;settingsPanel.hidden=true;actions.forEach(button=>button.setAttribute('aria-expanded','false'))}});
}
window.addEventListener('tios:dashboard-updated',scheduleRefresh);
window.addEventListener('tios:personal-intelligence-evidence-updated',scheduleRefresh);
window.addEventListener('tios:auth-ui',scheduleRefresh);
window.addEventListener('tios:conversation-scope-changing',()=>{
  scopeEpoch++;scopePending=true;history=[];log.replaceChildren();openingRow=null;currentConversationId=null;
  historyPanel.hidden=true;settingsPanel.hidden=true;historyList.replaceChildren();
  preferences={...defaults};preferencesLoaded=false;persistenceAvailable=false;renderPreferences();
  appendMessage('assistant','Your selected account is changing. I’ll load only its conversations when the Statistics finish loading.',{source:'local_start'});
  input.value='';setStatus('',false);updateControls();
});
form.addEventListener('submit',event=>{event.preventDefault();sendMessage(input.value)});
input.addEventListener('input',()=>{resizeInput();updateControls()});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit()}});
prompts.forEach(button=>button.addEventListener('click',()=>sendMessage(button.dataset.piPrompt||'')));
setupSettings();setupActions();resetConversation(currentContext);checkConnection();
const initialScope=accountScope();
if(initialScope.ready){lastScopeReady=true;loadScopeData(++scopeEpoch)}
})();
