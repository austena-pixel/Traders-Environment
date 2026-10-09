/* Read-only, record-based dashboard conversation. No remote AI or chat persistence. */
(function(){
  'use strict';
  const panel=document.getElementById('hiosConversation');
  if(!panel)return;
  const toggle=document.getElementById('hiosOpenChart');
  const development=document.querySelector('.home-sidebar .hios-development');
  const log=document.getElementById('hiosConversationMessages');
  const form=document.getElementById('hiosConversationForm');
  const input=document.getElementById('hiosConversationInput');
  const send=form.querySelector('button[type="submit"]');
  let userId=null,lastTopic=null;
  const text=id=>document.getElementById(id)?.innerText.trim()||'';
  function context(){
    const current=window.HIOSIntelligenceUI.sessionUser();
    if(current!==userId){userId=current;reset()}
    const ready=Boolean(current)&&!document.getElementById('appScreen').classList.contains('hidden');
    return {ready,priority:ready?text('hiosPriorityTasks'):'',progress:ready?text('hiosGoalProgressList'):'',commitments:ready?text('hiosIntelligenceSummary'):'',
      domains:ready?[...document.querySelectorAll('.hios-domain')].map(el=>({
        product:el.closest('.hios-product-intelligence').querySelector('h4').textContent.trim(),
        name:el.querySelector('.hios-domain-name').childNodes[0].textContent.trim(),
        level:el.querySelector('.hios-domain-level')?.textContent.trim()||'Level not yet established',
        status:el.querySelector('.hios-domain-status').textContent.trim()
      })):[]};
  }
  function append(role,value){
    const item=document.createElement('div');item.className='hios-conversation-message';item.dataset.role=role;
    const label=document.createElement('b');label.textContent=role==='user'?'YOU':'H·IOS';
    const copy=document.createElement('p');copy.textContent=value;item.append(label,copy);log.append(item);
    while(log.children.length>61)log.firstElementChild.remove();
    log.scrollTop=log.scrollHeight;
  }
  function reset(){
    log.replaceChildren();input.value='';send.disabled=true;lastTopic=null;
    append('assistant','What would you like to understand about your goals and intelligence development?\n\nI can discuss the records shown on your dashboard. These are record-based replies; general AI conversation is not available here yet.');
  }
  function open(value){
    context();development.hidden=value;panel.hidden=!value;
    toggle.textContent=value?'Close Chart':'Open Chart';toggle.setAttribute('aria-expanded',String(value));
    if(window.hiosAutoZoom?.reset)window.hiosAutoZoom.reset();
    if(value){input.focus({preventScroll:true});log.scrollTop=log.scrollHeight}
    else if(toggle.getClientRects().length)toggle.focus({preventScroll:true});
  }
  function answer(question,data){
    if(!data.ready)return 'Sign in to H·IOS to discuss the records on your dashboard.';
    const q=question.toLowerCase();
    let topic=/\b(intelligence|development|level|maturity|capabilit|unlock|evidence|understand)/.test(q)?'development':/\b(next|commitment|calendar|overdue|due|deadline)/.test(q)?'commitments':/\b(today|goal|progress|task|priorit|focus|doing|summary)/.test(q)?'goals':null;
    if(!topic&&/^(why|more|explain|tell me more|what about)/.test(q))topic=lastTopic;
    if(!topic){
      if(/^(hi|hello|hey|thanks|thank you)\b/.test(q))return 'Hello. Ask me about today’s progress, your next commitment or the intelligence status shown on your dashboard.';
      return 'I can currently discuss your dashboard’s goals, priorities, commitments and intelligence status. General AI conversation is not connected yet. Try “What is my progress today?” or “Explain my intelligence development.”';
    }
    lastTopic=topic;
    if(topic==='goals')return [data.priority,data.progress?'Recorded daily progress:\n'+data.progress:'No daily progress is currently shown.',data.commitments,'This summarizes dashboard records; completion alone does not establish a behavioural pattern or an intelligence maturity level.'].filter(Boolean).join('\n\n');
    if(topic==='commitments')return (data.commitments||'No dated commitments are currently shown on the dashboard.')+'\n\nYou can inspect the dates in Intelligence Calendar and manage linked tasks in Goals-IOS.';
    return data.domains.map(domain=>`${domain.product} · ${domain.name}\n${domain.level}\n${domain.status}`).join('\n\n')+'\n\nThese domains develop independently. New intelligence capabilities require relevant, reliable evidence and validation; accumulating records or completing tasks does not automatically establish a level.';
  }
  function submit(value){
    const data=context(),message=value.trim().slice(0,2000);if(!message)return;
    append('user',message);append('assistant',answer(message,data));input.value='';send.disabled=true;input.focus({preventScroll:true});
  }
  toggle.addEventListener('click',()=>open(panel.hidden));
  panel.querySelector('[data-hios-conversation-close]').addEventListener('click',()=>open(false));
  panel.querySelector('[data-hios-conversation-new]').addEventListener('click',()=>{reset();input.focus({preventScroll:true})});
  panel.querySelectorAll('[data-hios-conversation-prompt]').forEach(button=>button.addEventListener('click',()=>submit(button.dataset.hiosConversationPrompt)));
  input.addEventListener('input',()=>send.disabled=!input.value.trim());
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit()}});
  form.addEventListener('submit',event=>{event.preventDefault();submit(input.value)});
  window.addEventListener('hios:session-changed',()=>{context();open(false)});
  context();
})();
