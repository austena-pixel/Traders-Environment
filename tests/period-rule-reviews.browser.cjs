// Real Rules-builder and whole-period review flows, with isolated browser storage.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
let page,checks=0;
const owner='period-browser-user',account='period-browser-account';
const active=()=>page.locator('#page-checklists');
const form=()=>page.locator('#executionMapFormBody');
const response=()=>form().locator('textarea[data-execution-reflection-id]');
const score=()=>form().locator('[data-execution-response-type="score"]');
const condition=()=>form().locator('input[type="checkbox"]');
const comment=()=>form().locator('.execution-map-rule-comment');
const pass=text=>{checks++;console.log('PASS '+text);};

async function hydrate(){
  await page.evaluate(({owner,account})=>{
    currentUser={id:owner};tradingAccount={id:account,account_name:'Period review account'};
    tradingAccounts=[tradingAccount];setLoggedInUI(true);renderAccountSelector();
    trades=[
      {id:'trade-a',user_id:owner,account_id:account,trade_date:'2026-10-08',closed_at:'2026-10-08T09:10:00Z',instrument:'Volatility 10',direction:'Buy',pnl:15},
      {id:'trade-b',user_id:owner,account_id:account,trade_date:'2026-10-08',closed_at:'2026-10-08T14:00:00Z',instrument:'Volatility 10',direction:'Sell',pnl:-5},
      {id:'trade-c',user_id:owner,account_id:account,trade_date:'2026-10-07',closed_at:'2026-10-07T09:00:00Z',instrument:'Volatility 10',direction:'Buy',pnl:10},
      {id:'trade-d',user_id:owner,account_id:account,trade_date:'2026-10-01',closed_at:'2026-10-01T09:00:00Z',instrument:'Volatility 10',direction:'Buy',pnl:-10}
    ];
    executionReviews=[{id:'original-trade-review',user_id:owner,trade_id:'trade-a'}];
    executionChecks=[{id:'original-trade-check',review_id:'original-trade-review',user_id:owner,criterion_key:'check__existing',criterion_label:'Original rule',complied:true,comment:'Preserve'}];
  },{owner,account});
}
async function create(scope,name){
  await page.evaluate(()=>switchTechnicalInstrumentBuilder('checklist'));
  await active().locator('[data-ti-action="new"]').click();
  await active().locator('[data-ti-title]').fill(name);
  await active().locator('[data-ti-rule-scope]').selectOption(scope);
  await active().locator('[data-ti-editor]').evaluate(el=>{
    el.innerHTML='<p id="rule">Follow the risk limit.</p><p id="score">Discipline</p><p id="question">What did I learn?</p>';
    el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  for(const [id,operation] of [['rule','rule'],['score','score'],['question','psych-prompt']]){
    await active().locator('#'+id).evaluate(el=>{
      const range=document.createRange();range.selectNodeContents(el);instrumentRestoreRange('checklist',range);refreshSecondaryStyleControls('checklist');
    });
    await active().locator('[data-ti-block-style]').selectOption(operation);
  }
  await active().locator('[data-ti-action="save"]').click();
  const doc=await page.evaluate(()=>currentSecondaryDocument('checklist'));
  assert.equal(doc.ruleScope,scope);assert.equal(doc.name,name);return doc.id;
}
async function view(scope,id){
  if(id)await page.locator('[data-execution-period-document="'+scope+'"]').selectOption(id);
  else await page.locator('[data-execution-period-view="'+scope+'"]').click();
  assert.equal(await page.evaluate(()=>executionMappingRuleScope),scope);
}
async function date(value){await page.locator('#executionMapPeriodDate').fill(value);await page.locator('#executionMapPeriodDate').blur();}
async function answer(text,value=8){
  await condition().check();await comment().fill('Whole-period comment');await score().fill(String(value));await response().fill(text);
}
async function save(){
  await page.locator('#executionMapSaveReflectionsBtn').click();
  await page.waitForFunction(()=>!executionMappingReflectionSaving);
  assert.match(await page.locator('#executionMapReflectionSaveState').textContent(),/saved for this (session|day|week|month).*Saved on this device/);
}
async function blank(){assert.equal(await condition().isChecked(),false);assert.equal(await score().inputValue(),'');assert.equal(await response().inputValue(),'');}
async function restored(text,value=8){assert.equal(await condition().isChecked(),true);assert.equal(await score().inputValue(),String(value));assert.equal(await response().inputValue(),text);}
async function snapshot(name){
  await page.evaluate(()=>document.querySelector('#statusBar')?.classList.remove('show'));
  if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png'),fullPage:true});}
}

(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    const source=fs.readFileSync(file,'utf8');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(file.endsWith('t-ios.html')?source.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
    page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Africa/Johannesburg'});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.__periodDatabaseCalls=0;window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})},from:()=>{window.__periodDatabaseCalls++;throw new Error('A period review must not write to trade storage.');}})};});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html');await hydrate();
    await page.evaluate(()=>localStorage.setItem(secondaryStoreKey('checklist'),JSON.stringify([{id:'legacy-rules',name:'Legacy trade Rules',documentHtml:'<p>Existing rules.</p>'}])));
    await page.evaluate(()=>switchTechnicalInstrumentBuilder('checklist'));
    assert.equal(await active().locator('[data-ti-rule-scope]').inputValue(),'trade');
    pass('legacy Rules retain individual-trade scope');
    const docs={};for(const scope of ['session','daily','weekly','monthly'])docs[scope]=await create(scope,scope[0].toUpperCase()+scope.slice(1)+' behaviour Rules');
    await page.evaluate(()=>{window.__periodAISnapshot=TIOSAIWorkspace.capture('checklist');TIOSAIWorkspace.display('checklist',window.__periodAISnapshot.doc,true);});
    assert.equal(await active().locator('[data-ti-rule-scope]').isDisabled(),true);
    await page.evaluate(()=>TIOSAIWorkspace.restore(window.__periodAISnapshot));
    assert.equal(await active().locator('[data-ti-rule-scope]').isDisabled(),false);
    await active().locator('[data-ti-rule-scope]').selectOption('weekly');
    assert.equal(await page.evaluate(()=>TIOSAIWorkspace.unchanged(window.__periodAISnapshot)),false);
    await active().locator('[data-ti-rule-scope]').selectOption('monthly');
    pass('AI proposal previews preserve and lock the scope; a changed scope is detected as an edit');
    await snapshot('rules-builder-scope');
    await active().locator('[data-ti-action="preview"]').click();
    assert.equal(await page.locator('[data-execution-period-view]').count(),4);
    assert.deepEqual(await page.locator('#executionMapChecklistSelect option').evaluateAll(options=>options.map(o=>o.value)),['legacy-rules']);
    assert.equal(await page.locator('#executionMapTradeControl').isVisible(),false);
    pass('saved period Rules add their own selectors to the same instrument row and stay out of trade Rules');

    await view('monthly',docs.monthly);await date('2026-10');
    await condition().check();await score().fill('8');await save();
    await date('2026-11');await blank();await date('2026-10');
    assert.equal(await condition().isChecked(),true);assert.equal(await score().inputValue(),'8');assert.equal(await response().inputValue(),'');
    await score().fill('');await response().fill('Reflection with an unanswered score');await save();
    await date('2026-11');await blank();await date('2026-10');
    assert.equal(await condition().isChecked(),true);assert.equal(await score().inputValue(),'');assert.equal(await response().inputValue(),'Reflection with an unanswered score');
    pass('partially completed period reviews save and restore with blank optional scores or reflections');
    await answer('Whole October');await save();
    assert.equal(await page.locator('#executionMapPeriodTradeCount').textContent(),'4');
    await date('2026-11');await blank();await date('2026-10');await restored('Whole October');
    pass('monthly answers persist for the calendar month and a new month starts separately');
    await page.locator('#executionMapPeriodDate').evaluate(el=>el.type='text');await date('2026-11');
    assert.equal(await score().isDisabled(),false);assert.equal(await page.evaluate(()=>executionMappingReflectionContext.period.startDate),'2026-11-01');
    await date('2026-10');await restored('Whole October');
    pass('monthly reviews also work when a browser falls back to a text month control');
    await view('weekly',docs.weekly);await date('2026-10-08');await blank();await answer('Whole week');await save();
    assert.equal(await page.locator('#executionMapPeriodTradeCount').textContent(),'3');
    await date('2026-10-09');await restored('Whole week');await date('2026-10-12');await blank();await date('2026-10-08');await restored('Whole week');
    pass('any day in the same week restores one whole-week review; the next week is separate');
    await view('daily',docs.daily);await date('2026-10-08');await blank();await answer('Whole day');await save();
    assert.equal(await page.locator('#executionMapPeriodTradeCount').textContent(),'2');
    await page.evaluate(()=>{executionMappingTradeId='trade-b';renderExecutionMappingWorkspace();});await restored('Whole day');
    await date('2026-10-09');await blank();await answer('Next day',9);await save();await date('2026-10-08');await restored('Whole day');
    pass('daily reviews apply to all trades in the day and never follow the selected individual trade');
    await view('session',docs.session);await date('2026-10-08');
    for(const [id,value] of [['Name','Morning'],['Start','08:00'],['End','12:00']]){await page.locator('#executionMapSession'+id).fill(value);await page.locator('#executionMapSession'+id).blur();}
    await blank();await answer('Morning session');await save();assert.equal(await page.locator('#executionMapPeriodTradeCount').textContent(),'1');
    for(const [id,value] of [['Name','Afternoon'],['Start','13:00'],['End','17:00']]){await page.locator('#executionMapSession'+id).fill(value);await page.locator('#executionMapSession'+id).blur();}
    await blank();await answer('Afternoon session',7);await save();assert.equal(await page.locator('#executionMapPeriodTradeCount').textContent(),'1');
    for(const [id,value] of [['Name','Morning'],['Start','08:00'],['End','12:00']]){await page.locator('#executionMapSession'+id).fill(value);await page.locator('#executionMapSession'+id).blur();}
    await restored('Morning session');
    const afternoonKey=await page.locator('#executionMapSavedSession option').evaluateAll(options=>options.find(option=>option.textContent.startsWith('Afternoon')).value);
    await page.locator('#executionMapSavedSession').selectOption(afternoonKey);await restored('Afternoon session',7);
    const morningKey=await page.locator('#executionMapSavedSession option').evaluateAll(options=>options.find(option=>option.textContent.startsWith('Morning')).value);
    await page.locator('#executionMapSavedSession').selectOption(morningKey);await restored('Morning session');
    await page.setViewportSize({width:1366,height:768});await snapshot('session-period-review');await page.setViewportSize({width:1440,height:900});
    pass('saved named sessions can be reopened from their picker without retyping their hours');
    pass('two named sessions on one day retain independent reviews and only count trades in their hours');
    await page.locator('#executionMapSessionName').fill('');await page.locator('#executionMapSessionName').blur();
    assert.equal(await page.locator('#executionMapSaveReflectionsBtn').isDisabled(),true);assert.equal(await score().isDisabled(),true);
    await page.locator('#executionMapSessionName').fill('Morning');await page.locator('#executionMapSessionName').blur();await restored('Morning session');
    pass('invalid session boundaries cannot be scored or saved');

    const preserved=await page.evaluate(()=>({calls:window.__periodDatabaseCalls,reviews:executionReviews,checks:executionChecks,rows:window.TIOSPeriodRules.read(localStorage,currentUser.id,tradingAccount.id)}));
    assert.equal(preserved.calls,0);assert.equal(preserved.reviews.length,1);assert.equal(preserved.checks.length,1);assert.equal(preserved.checks[0].comment,'Preserve');assert.equal(preserved.rows.length,6);
    pass('period reviews never touch trade reviews, trade checks or their quantitative evidence');
    await page.reload();await hydrate();await page.evaluate(()=>navigate('execution'));await view('daily',docs.daily);await date('2026-10-08');await restored('Whole day');
    pass('saved period answers restore after a full reload');
    await page.locator('#executionBackToInstrumentsBtn').click();
    const secondDaily=await create('daily','Second daily Rules');
    await active().locator('[data-ti-action="preview"]').click();await blank();await answer('Another daily document',6);await save();
    await view('daily',docs.daily);await restored('Whole day');
    await view('daily',secondDaily);await restored('Another daily document',6);await view('daily',docs.daily);
    pass('two Rules documents for one period save and restore independently');

    await page.evaluate(()=>{window.__originalPeriodSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('tios_period_rule_reviews_v1:'))throw new DOMException('Storage unavailable','QuotaExceededError');return window.__originalPeriodSetItem.call(this,key,value);};});
    await response().fill('Retry this answer');await page.locator('#executionMapSaveReflectionsBtn').click();
    assert.match(await page.locator('#executionMapReflectionSaveState').textContent(),/were not saved/);assert.equal(await response().inputValue(),'Retry this answer');
    await page.evaluate(()=>{Storage.prototype.setItem=window.__originalPeriodSetItem;});await save();await restored('Retry this answer');
    pass('storage failure retains the draft, reports failure and can be retried');

    await page.evaluate(()=>{
      const docs=secondaryState('checklist').docs.map(doc=>({...doc}));tradingAccount={id:'second-account',account_name:'Second account'};
      loadSecondaryDocuments('checklist',{refresh:true});secondaryState('checklist').docs=docs;persistSecondaryDocuments('checklist');renderExecutionMappingWorkspace();
    });await blank();
    await page.evaluate(account=>{tradingAccount={id:account,account_name:'Period review account'};renderExecutionMappingWorkspace();},account);await restored('Retry this answer');
    pass('account switching never exposes another account’s answers');
    await snapshot('daily-period-review');
    await page.setViewportSize({width:390,height:844});await snapshot('daily-period-review-mobile');
    assert.equal(await page.evaluate(()=>{
      const row=document.querySelector('.execution-map-controls'),bounds=row.getBoundingClientRect();
      return row.scrollWidth<=row.clientWidth+1&&[...row.querySelectorAll('.execution-map-control')].every(card=>{
        const box=card.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1&&box.bottom<=bounds.bottom+1;
      });
    }),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('#executionMapSaveReflectionsBtn').isVisible(),true);
    pass('all instrument selectors wrap without horizontal scrolling and the period review remains usable on mobile');
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#executionMapChecklistViewBtn').click();assert.equal(await page.locator('#executionMapTradeControl').isVisible(),true);
    assert.equal(await page.locator('#executionMapPeriodContext').isVisible(),false);assert.equal(await page.locator('#executionMapTradeSelect').getAttribute('size'),'4');
    assert.equal(await page.evaluate(()=>journalTradeNumbers().get('trade-a')),3);
    pass('switching back restores individual-trade context, the four-row list and continuous numbering');
    await view('daily',docs.daily);await page.locator('#executionBackToInstrumentsBtn').click();
    await active().locator('[data-ti-editor] [data-playbook-node="rule"]').first().evaluate(el=>{el.textContent='Use the revised risk limit.';el.closest('[contenteditable]').dispatchEvent(new Event('input',{bubbles:true}));});
    await active().locator('[data-ti-action="save"]').click();await active().locator('[data-ti-action="preview"]').click();await blank();
    assert.equal(await page.evaluate(()=>TIOSPeriodRules.read(localStorage,currentUser.id,tradingAccount.id).find(record=>record.documentId===executionMappingReflectionContext.documentId&&record.period.startDate==='2026-10-08').answers.some(answer=>answer.comment==='Retry this answer')),true);
    pass('changing a Rules form does not assign historical answers to its revised conditions');
    assert.deepEqual(errors,[]);console.log('PASS '+checks+' period-review browser checks');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
