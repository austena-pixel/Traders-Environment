/* Record-based conversation. No remote AI, account writes or persistent chat storage. */
(function(){
  'use strict';
  const panel=document.getElementById('tiosConversation');
  if(!panel)return;
  const toggle=document.getElementById('openAccountChart');
  const list=document.getElementById('tiosConversationMessages');
  const form=document.getElementById('tiosConversationForm');
  const input=document.getElementById('tiosConversationInput');
  const send=form.querySelector('button[type="submit"]');
  const status=document.getElementById('tiosConversationStatus');
  const scopeLabel=document.getElementById('tiosConversationScope');
  let scope=null,lastTopic=null;

  function context(){return window.getTiosConversationContext()}
  function append(role,text){
    const message=document.createElement('div');message.className='tios-conversation-message';message.dataset.role=role;
    const label=document.createElement('b');label.textContent=role==='user'?'YOU':'T·IOS';
    const copy=document.createElement('p');copy.textContent=text;
    message.append(label,copy);list.append(message);
    while(list.children.length>61)list.firstElementChild.remove();
    list.scrollTop=list.scrollHeight;
  }
  function reset(){
    list.replaceChildren();input.value='';lastTopic=null;send.disabled=true;status.textContent='';
    append('assistant','What would you like to understand about your trading?\n\nI can summarize recorded results, execution reviews and evidence gaps for the selected account. These are record-based replies; general AI conversation is not available here yet.');
  }
  function sync(){
    const data=context(),next=JSON.stringify([data.userId,data.accountId]);
    if(next!==scope){scope=next;reset()}
    scopeLabel.textContent=data.ready?'Record-based · '+data.accountName:'Record-based · Waiting for account';
    return data;
  }
  function open(value){
    sync();panel.hidden=!value;toggle.setAttribute('aria-expanded',String(value));toggle.textContent=value?'Close Chart':'Open Chart';
    toggle.closest('.right-side').classList.toggle('conversation-open',value);
    if(value){input.focus({preventScroll:true});list.scrollTop=list.scrollHeight}else if(toggle.getClientRects().length)toggle.focus({preventScroll:true});
  }
  const amount=(value,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency:/^[A-Z]{3}$/.test(currency)?currency:'USD',maximumFractionDigits:2}).format(value);
  function answer(question,data){
    if(!data.ready)return 'Your selected account is still loading. Once its records are available, I can answer about results and execution reviews.';
    const q=question.toLowerCase(),follow=/^(and |what about |how about |why\??$|more\??$|explain\??$|tell me more)/.test(q);
    let topic=/\b(execution|discipline|psycholog|review|rule|mistake|error|adherence)/.test(q)?'execution':/\b(edge|strategy|strategies|playbook|setup)/.test(q)?'edge':/\b(evidence|recommend|maturity|understand|reliable|trust|confidence)/.test(q)?'evidence':/\b(performance|profit|loss|pnl|p&l|result|return|balance|equity|win|trade|month|today|week|summary|summarize|doing|how am i)/.test(q)?'performance':null;
    if(follow&&lastTopic)topic=topic||lastTopic;
    if(!topic){
      if(/^(hi|hello|hey|good morning|thanks|thank you)\b/.test(q))return 'Hello. I can help you read the trading records for '+data.accountName+'. Ask about this month’s results, execution reviews or what evidence is still missing.';
      return 'I can currently discuss recorded trading results, execution reviews and evidence gaps. I can’t interpret arbitrary questions or have a general AI conversation yet. Try “How did I perform this month?” or “What do my execution reviews show?”';
    }
    lastTopic=topic;
    if(topic==='execution'){
      const e=data.execution;
      if(!e.reviewed)return 'There are no comparable execution reviews for this account yet. P&L alone cannot show whether you followed your rules. Review trades in Execution Quality to record what you actually did.';
      let text=`Your current reflection structure has ${e.reviewed} comparable reviewed trade${e.reviewed===1?'':'s'}.`;
      if(e.adherence!==null)text+=`\nRecorded rule adherence: ${e.adherence.toFixed(1)}% across ${e.checks} checks.`;
      if(e.averageScore!==null)text+=`\nAverage recorded execution score: ${e.averageScore.toFixed(1)}%.`;
      if(e.weakest.length)text+='\nMost recorded misses: '+e.weakest.map(item=>`${item.label} (${item.misses} of ${item.checks} checks)`).join('; ')+'.';
      return text+'\n\nThese summarize entered reviews; they are not independent verification of your behaviour or a psychological diagnosis.';
    }
    if(topic==='edge')return 'Trading edge and execution quality need separate evidence. Recorded profits alone do not establish a profitable edge. Compare consistently labeled setups, their outcomes and whether the trades matched the playbook; then validate the pattern on later trades. You can inspect recorded setup results in Statistics.';
    if(topic==='evidence')return `This account has ${data.trades.length} loaded closed trades and ${data.execution.reviewed} comparable execution reviews.\n\nA recommendation needs relevant, reliable and sufficiently varied supporting evidence. Repeating the same event does not add independent observations. Record missing trade outcomes, review rule adherence and test tentative patterns on later outcomes. This conversation does not unlock maturity levels or validate a trading edge.`;

    let selected=data.trades,period='all loaded closed trades';
    if(/\b(today|today's)\b/.test(q)){selected=selected.filter(t=>t.date===data.today);period='today'}
    else if(/\b(this week|weekly)\b/.test(q)){selected=selected.filter(t=>t.date>=data.weekStart&&t.date<=data.today);period='this week (Monday to today)'}
    else if(!/\b(all time|all-time|overall|balance|equity)\b/.test(q)){selected=selected.filter(t=>t.date.slice(0,7)===data.month);period=data.monthLabel+' (calendar selection)'}
    if(!selected.length)return `There are no loaded closed trades for ${period}. I can summarize results once trades are recorded or imported into the selected account.`;
    const known=selected.filter(t=>t.pnl!==null),pnl=known.reduce((sum,t)=>sum+t.pnl,0),wins=known.filter(t=>t.pnl>0).length;
    if(!known.length)return `There are ${selected.length} recorded trades for ${period}, but their Net P&L values are missing. Complete those outcomes before evaluating performance.`;
    let text=`For ${period}:\n${selected.length} recorded closed trade${selected.length===1?'':'s'}\nNet P&L: ${amount(pnl,data.currency)}\nWin rate: ${(wins/known.length*100).toFixed(1)}% (${wins} of ${known.length} trades with P&L)`;
    if(data.initialBalance>0)text+=`\nReturn on initial balance: ${(pnl/data.initialBalance*100).toFixed(2)}%`;
    else text+='\nPercentage return needs an initial account balance.';
    if(known.length!==selected.length){const missing=selected.length-known.length;text+=`\n${missing} trade${missing===1?' is':'s are'} missing P&L and ${missing===1?'is':'are'} excluded from these outcome calculations.`}
    if(/\b(balance|equity)\b/.test(q))text+='\nInitial balance: '+amount(data.initialBalance,data.currency)+(data.equity===null?'':'\nCurrent equity: '+amount(data.equity,data.currency));
    return text+'\n\nThese are recorded outcomes. They do not establish a profitable edge or explain execution quality by themselves.';
  }
  function submit(text){
    const data=sync(),message=text.trim().slice(0,2000);if(!message)return;
    append('user',message);input.value='';send.disabled=true;
    try{append('assistant',answer(message,data));status.textContent=''}
    catch{status.textContent='Could not read the current records. Try again after the account finishes loading.'}
    input.focus({preventScroll:true});
  }
  toggle.addEventListener('click',()=>open(panel.hidden));
  panel.querySelector('[data-conversation-close]').addEventListener('click',()=>open(false));
  panel.querySelector('[data-conversation-new]').addEventListener('click',()=>{reset();input.focus({preventScroll:true})});
  panel.querySelectorAll('[data-conversation-prompt]').forEach(button=>button.addEventListener('click',()=>submit(button.dataset.conversationPrompt)));
  input.addEventListener('input',()=>send.disabled=!input.value.trim());
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit()}});
  form.addEventListener('submit',event=>{event.preventDefault();submit(input.value)});
  window.addEventListener('tios:conversation-scope-changing',()=>{scope=null;reset();scopeLabel.textContent='Record-based · Loading account'});
  window.addEventListener('tios:dashboard-updated',sync);
  window.addEventListener('tios:auth-ui',()=>{sync();if(document.getElementById('appShell').classList.contains('hidden')){scope=null;reset();open(false)}});
  sync();
})();
