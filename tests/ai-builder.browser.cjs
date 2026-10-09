'use strict';
// Uses the real browser, API handler, schema validator, editor, store and mapping.
// Auth and external model responses are isolated fixtures; no live user data is touched.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const handler=require('../api/tios-ai-builder.js');
const root=path.resolve(__dirname,'..');
const output=process.env.TIOS_QA_OUTPUT||path.resolve(root,'../qa/ai-builder');
const userId='00000000-0000-4000-a000-000000000001';
const node=(id,label,type='rule',extra={})=>({id,label,type,level:type==='heading'?2:null,options:[],logic:'all',dependsOn:null,condition:null,maximum:type==='score'?10:null,...extra});
const op=(data,extra={})=>({action:'insert',targetId:null,beforeId:null,afterId:null,node:data,members:[],logic:null,dependsOn:null,...extra});
const proposal=(kind,name,operations,intent='create')=>({message:'Prepared a structured instrument for review.',questions:[],proposal:{kind,name,description:null,operations,intent}});
const choice=(id,label,logic,labels)=>node(id,label,'choice',{logic,options:labels.map((label,i)=>({id:id+'_option_'+i,label,condition:null}))});
const risk={type:'risk_limit',verification:'objective',field:'account_risk',operator:'lte',value:1,unit:'percent',timeframe:null,parameters:[]};
const playbook=()=>proposal('playbook','Imbalance Method',[
  op(node('market_heading','Market Context','heading')),op(choice('market','Market context','exclusive',['Balance','Imbalance'])),
  op(node('entry_heading','Entry Requirements','heading')),op(node('entry','Price reaches my area of interest.','rule',{dependsOn:'market',condition:{type:'observation',verification:'subjective',field:null,operator:null,value:null,unit:null,timeframe:null,parameters:[]}})),
  op(node('risk_heading','Risk Management','heading')),op(node('risk','Risk no more than 1% of equity.','rule',{condition:risk}))
]);
let queue=[],calls=[],checks=0,quota=true;
const pass=message=>{checks++;console.log('PASS '+message)};
const originalFetch=global.fetch;
const json=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
global.fetch=async(url,options)=>{
  if(String(url).endsWith('/auth/v1/user'))return json({id:userId,is_anonymous:false});
  if(String(url).includes('/rpc/tios_ai_reserve_request'))return json([{allowed:quota,retry_after:60}]);
  if(String(url)==='https://ai-gateway.vercel.sh/v1/chat/completions'){
    calls.push(JSON.parse(options.body));const next=queue.shift();if(!next)throw Error('No test model response queued.');
    if(next.delay)await new Promise(r=>setTimeout(r,next.delay));
    if(next.status)return json({error:{type:next.type,message:'Private provider diagnostic must not reach UI'}},next.status);
    return json({model:'openai/gpt-4.1-mini',choices:[{finish_reason:'stop',message:{content:JSON.stringify(next.answer)}}]});
  }
  throw Error('Unexpected external request: '+url);
};
process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='qa-public';process.env.AI_GATEWAY_MODEL='openai/gpt-4.1-mini';process.env.AI_GATEWAY_API_KEY='qa-server-secret';
let page,browser;
const config={playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',title:'#playbookDraftTitle',model:'#playbookExecutionPreviewBody'},checklist:{page:'#page-checklists',editor:'[data-ti-editor]',title:'[data-ti-title]',model:'[data-ti-preview-body]'},psych:{page:'#page-reflections',editor:'[data-ti-editor]',title:'[data-ti-title]',model:'[data-ti-preview-body]'}};
const active=kind=>page.locator(config[kind].page),panel=kind=>page.locator('#tiAiBuilder_'+kind),editor=kind=>active(kind).locator(config[kind].editor),model=kind=>active(kind).locator(config[kind].model);
async function send(kind,message,answer,extra={}){queue.push({answer,...extra});await panel(kind).locator('textarea').fill(message);await panel(kind).locator('[data-ai-send]').click();await page.waitForFunction(kind=>!document.querySelector('#tiAiBuilder_'+kind+' textarea').disabled,kind);}
async function switchTo(kind){await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind),kind);if(!await panel(kind).isVisible())await active(kind).locator('[data-ai-toggle]').click();}
async function snapshot(kind){return page.evaluate(kind=>{const w=window.TIOSAIWorkspace,s=w.capture(kind);return {html:s.doc.documentHtml,name:s.doc.name,id:s.id,store:localStorage.getItem(s.storageKey),key:s.storageKey}},kind)}
async function run(){
  fs.mkdirSync(output,{recursive:true});
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/api/tios-ai-builder')){
      let body='';for await(const chunk of req)body+=chunk;req.body=body;res.status=n=>{res.statusCode=n;return res};res.json=value=>res.end(JSON.stringify(value));await handler(req,res);return;
    }
    const filename=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html');
    const source=fs.readFileSync(filename,'utf8');res.end(filename.endsWith('t-ios.html')?source.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^\"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
    page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(12000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    const url='http://127.0.0.1:'+server.address().port+'/t-ios.html';await page.goto(url,{waitUntil:'load'});
    async function initialize(){await page.evaluate(userId=>{
      currentUser={id:userId};tradingAccount={id:'qa-account',account_name:'Test Account',initial_balance:10000,current_equity:10000,currency:'USD'};
      trades=[{id:'qa-trade',user_id:userId,account_id:'qa-account',instrument:'QA',direction:'Buy',trade_date:'2026-10-09',pnl:0}];
      db.auth.getSession=async()=>({data:{session:{access_token:'qa-user-token',user:{id:userId}}}});
      db.from=()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)};return q};
      setLoggedInUI(true);switchTechnicalInstrumentBuilder('playbook');
    },userId)}
    await initialize();await active('playbook').locator('[data-ai-toggle]').click();
    assert.equal(await panel('playbook').isVisible(),true);assert.equal(await active('playbook').locator('[data-ai-toggle]').getAttribute('aria-expanded'),'true');
    assert.equal(await editor('playbook').isVisible(),false);
    assert.equal(await active('playbook').locator('.playbook-word-ribbon').isVisible(),false);
    assert.equal(await active('playbook').locator('.playbook-word-statusbar').isVisible(),false);
    const fill=await panel('playbook').evaluate(el=>({chat:el.getBoundingClientRect().height,main:el.parentElement.getBoundingClientRect().height,log:el.querySelector('[data-ai-messages]').getBoundingClientRect().height}));
    assert.ok(Math.abs(fill.chat-fill.main)<4);assert.ok(fill.log>400);
    pass('AI Builder fills the manual workspace beside Live Model, with the ribbon, document and status bar hidden');
    await panel('playbook').locator('textarea').fill('Keep this conversation draft');
    await panel('playbook').locator('.ti-ai-types button').filter({hasText:'Rules'}).click();
    assert.equal(await panel('checklist').isVisible(),true);assert.equal(await editor('checklist').isVisible(),false);
    await panel('checklist').locator('.ti-ai-types button').filter({hasText:'Psychological Reflection'}).click();
    assert.equal(await panel('psych').isVisible(),true);assert.equal(await editor('psych').isVisible(),false);
    await panel('psych').locator('.ti-ai-types button').filter({hasText:'Playbook'}).click();
    assert.equal(await panel('playbook').locator('textarea').inputValue(),'Keep this conversation draft');
    pass('instrument buttons stay available in AI mode and restore each conversation draft');
    const baseline=await snapshot('playbook');
    await send('playbook','Create a breakout strategy with confirmation.',{message:'What exactly counts as confirmation?',questions:['Which candle or price condition confirms your entry?'],proposal:null});
    assert.match(await panel('playbook').textContent(),/Which candle/);assert.equal((await snapshot('playbook')).store,baseline.store);assert.equal(await panel('playbook').locator('[data-ai-proposal]').isVisible(),false);
    pass('unclear requirements produce a targeted question without changing saved data');
    await send('playbook','Use my imbalance context and maximum risk of 1%.',playbook());
    assert.equal(await panel('playbook').locator('[data-ai-proposal]').isVisible(),true);assert.match(await editor('playbook').textContent(),/Risk no more than 1%/);assert.match(await model('playbook').textContent(),/Exactly one option/);assert.equal(await editor('playbook').getAttribute('contenteditable'),'false');
    await page.waitForTimeout(800);assert.equal((await snapshot('playbook')).store,baseline.store);
    assert.equal(calls.at(-1).response_format.json_schema.strict,true);assert.equal(calls.at(-1).messages[1].role,'user');
    pass('structured creation previews in both existing views and stays unsaved despite autosave timers');
    const pending=await snapshot('playbook'),chatHistory=await panel('playbook').locator('[data-ai-messages]').textContent();
    await panel('playbook').locator('textarea').fill('A follow-up draft');
    await panel('playbook').locator('[data-ai-review]').click();
    assert.equal(await panel('playbook').isVisible(),false);assert.equal(await editor('playbook').isVisible(),true);
    assert.equal(await editor('playbook').getAttribute('contenteditable'),'false');assert.equal((await snapshot('playbook')).store,pending.store);
    await active('playbook').locator('[data-ai-review-back]').click();
    assert.equal(await editor('playbook').isVisible(),false);assert.equal(await panel('playbook').locator('textarea').inputValue(),'A follow-up draft');
    assert.equal(await panel('playbook').locator('[data-ai-messages]').textContent(),chatHistory);
    pass('document review is a separate read-only view and returning to chat preserves the unsaved proposal, draft and history');
    const followup=proposal('playbook',null,[op(node('exit_heading','Exit','heading')),op(node('exit','Exit when price reaches my named target.'))],'edit');
    await send('playbook','Add my named target as the exit condition.',followup);const context=JSON.parse(calls.at(-1).messages.at(-1).content).workingContext;
    assert.ok(context.blocks.some(b=>b.id==='risk'));assert.equal(context.unapprovedNewInstrument,true);assert.match(await editor('playbook').textContent(),/Exit when price/);
    await panel('playbook').locator('[data-ai-review]').click();await active('playbook').locator('[data-ai-review-discard]').click();assert.equal(await panel('playbook').isVisible(),true);assert.equal((await snapshot('playbook')).store,baseline.store);assert.equal((await snapshot('playbook')).html,baseline.html);assert.equal(await editor('playbook').getAttribute('contenteditable'),'true');
    pass('ongoing refinement carries unapproved context; Discard restores the original instrument and store');
    await send('playbook','Create the imbalance playbook.',playbook());await panel('playbook').locator('[data-ai-review]').click();await active('playbook').locator('[data-ai-review-apply]').click();assert.equal(await panel('playbook').isVisible(),true);
    let applied=await snapshot('playbook');assert.notEqual(applied.id,baseline.id);let saved=JSON.parse(applied.store).find(d=>d.id===applied.id);assert.equal(saved.strategyVersion,1);assert.ok(saved.strategyVersionId);assert.equal(saved.templateDraft,false);assert.equal(JSON.parse(applied.store).find(d=>d.id===baseline.id).documentHtml,baseline.html);
    assert.match(saved.documentHtml,/&quot;type&quot;:&quot;risk_limit&quot;/);assert.match(await model('playbook').textContent(),/Risk no more than 1%/);
    pass('Apply creates an approved version using the existing scoped store and preserves unrelated instruments');
    await send('playbook','Rename this playbook and add a discipline reflection.',proposal('playbook','Imbalance and Reflection',[op(node('reflection','How did I feel before entering?','prompt'))],'edit'));await panel('playbook').locator('[data-ai-apply]').click();
    assert.equal(await active('playbook').locator(config.playbook.title).inputValue(),'Imbalance and Reflection');assert.match(await model('playbook').textContent(),/How did I feel/);
    await panel('playbook').locator('[data-ai-undo]').click();if(await panel('playbook').locator('[data-ai-error]').isVisible())console.log('UNDO ERROR '+await panel('playbook').locator('[data-ai-error]').textContent());assert.equal(await active('playbook').locator(config.playbook.title).inputValue(),'Imbalance Method');assert.doesNotMatch(await model('playbook').textContent(),/How did I feel/);
    pass('conversational edits map to Live Model, and Undo reverses the saved application');
    await editor('playbook').evaluate(el=>{el.insertAdjacentHTML('beforeend','<p><b>Keep this manual note.</b></p>');el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(850);
    const manual=await snapshot('playbook');
    await send('playbook','Remove the risk requirement.',proposal('playbook',null,[{...op(null),action:'remove',targetId:'risk'}],'edit'));await panel('playbook').locator('[data-ai-apply]').click();
    assert.match(await editor('playbook').innerHTML(),/<b>Keep this manual note.<\/b>/);assert.doesNotMatch(await editor('playbook').textContent(),/Risk no more/);await panel('playbook').locator('[data-ai-undo]').click();assert.equal((await snapshot('playbook')).html,manual.html);
    pass('targeted deletion preserves manual content and formatting, then Undo restores the rule');
    queue.push({answer:proposal('playbook','Outdated Name',[],'edit'),delay:500});await panel('playbook').locator('textarea').fill('Rename this playbook.');await panel('playbook').locator('[data-ai-send]').click();
    await page.waitForFunction(()=>document.querySelector('#tiAiBuilder_playbook textarea').disabled);
    await editor('playbook').evaluate(el=>{el.insertAdjacentHTML('beforeend','<p>A newer manual edit.</p>');el.dispatchEvent(new Event('input',{bubbles:true}))});
    await page.waitForFunction(()=>!document.querySelector('#tiAiBuilder_playbook textarea').disabled);assert.match(await panel('playbook').locator('[data-ai-error]').textContent(),/changed while AI/);assert.match(await editor('playbook').textContent(),/newer manual edit/);assert.equal(await panel('playbook').locator('[data-ai-proposal]').isVisible(),false);
    pass('manual edits during generation reject the outdated AI response');
    await page.waitForTimeout(800);await send('playbook','Rename my strategy.',proposal('playbook','Proposed Name',[],'edit'));
    const stale=await snapshot('playbook');await page.evaluate(s=>{const records=JSON.parse(localStorage.getItem(s.key));records.find(d=>d.id===s.id).name='Newer Other Tab';localStorage.setItem(s.key,JSON.stringify(records));window.dispatchEvent(new StorageEvent('storage',{key:s.key}))},stale);
    const externalStore=(await snapshot('playbook')).store;await panel('playbook').locator('[data-ai-apply]').click();assert.match(await panel('playbook').locator('[data-ai-error]').textContent(),/newer edit/i);assert.equal((await snapshot('playbook')).store,externalStore);await panel('playbook').locator('[data-ai-discard]').click();assert.equal(await active('playbook').locator(config.playbook.title).inputValue(),'Newer Other Tab');assert.equal((await snapshot('playbook')).store,externalStore);
    pass('newer writes from another tab cannot be overwritten; Discard adopts the saved current version');
    await send('playbook','Add a plain text note.',proposal('playbook',null,[op(node('safe','<img src=x onerror=alert(1)>','note'))],'edit'));assert.equal(await editor('playbook').locator('img').count(),0);assert.match(await editor('playbook').textContent(),/<img src=x/);await panel('playbook').locator('[data-ai-discard]').click();
    pass('model-provided markup remains plain text and cannot execute in the Workspace');
    await send('playbook','Make the context options OR, then group entry and risk with AND below risk management.',proposal('playbook',null,[
      op(choice('market','Market context','any',['Balance','Imbalance']),{action:'update',targetId:'market'}),
      op(node('combined','Required entry and risk'),{action:'group',members:['entry','risk'],logic:'all'}),
      {...op(null),action:'move',targetId:'combined',afterId:'risk_heading'}
    ],'edit'));
    assert.match(await model('playbook').textContent(),/At least one requirement/);assert.match(await model('playbook').textContent(),/All requirements/);
    const order=await editor('playbook').evaluate(el=>[...el.children].map(x=>x.dataset.tiAiNodeId));assert.ok(order.indexOf('combined')>order.indexOf('risk_heading'));
    await panel('playbook').locator('[data-ai-discard]').click();
    pass('conversational logic changes, grouping and section movement preserve the existing document structure');
    const beforeInvalid=await snapshot('playbook');await send('playbook','Add an invalid dependency.',proposal('playbook',null,[op(node('invalid','Dependent condition','rule',{dependsOn:'missing_condition'}))],'edit'));
    assert.match(await panel('playbook').locator('[data-ai-error]').textContent(),/valid prerequisite/);assert.equal((await snapshot('playbook')).store,beforeInvalid.store);
    pass('missing or forward dependency references fail validation before preview or persistence');
    await switchTo('checklist');
    const logicProposal=proposal('checklist','Conditional Rules',[
      op(choice('all_group','All entry checks','all',['Condition A','Condition B'])),op(choice('or_group','Alternative triggers','any',['Trigger C','Trigger D'])),op(choice('exclusive_group','Market context','exclusive',['Balance','Imbalance'])),
      op(node('dependent','Check risk after a trigger.','rule',{dependsOn:'or_group',condition:risk}))
    ]);
    await send('checklist','Create AND, OR, exclusive and dependent rules.',logicProposal);await panel('checklist').locator('[data-ai-apply]').click();
    const logicSaved=await snapshot('checklist');await page.evaluate(()=>{navigate('execution');viewExecutionInstrumentSection('checklist')});
    const mapping=page.locator('#executionMapFormBody [data-execution-instrument-section="checklist"]');assert.equal(await mapping.locator('[data-ti-ai-group]').count(),4);
    const group=id=>mapping.locator('[data-ti-ai-group="'+id+'"]');
    assert.equal(await group('dependent').locator('input').isDisabled(),true);assert.match(await page.locator('#executionMapScoreMeta').textContent(),/0 of 3/);
    await group('all_group').locator('input').nth(0).check();assert.equal(await page.locator('#executionMapScore').textContent(),'0.0%');await group('all_group').locator('input').nth(1).check();assert.equal(await page.locator('#executionMapScore').textContent(),'33.3%');
    await group('or_group').locator('input').nth(0).check();assert.equal(await group('dependent').locator('input').isEnabled(),true);assert.equal(await page.locator('#executionMapScore').textContent(),'50.0%');await group('or_group').locator('input').nth(1).check();assert.equal(await page.locator('#executionMapScore').textContent(),'50.0%');
    await group('exclusive_group').locator('input').nth(0).check();await group('exclusive_group').locator('input').nth(1).check();assert.equal(await group('exclusive_group').locator('input:checked').count(),1);await group('dependent').locator('input').check();assert.equal(await page.locator('#executionMapScore').textContent(),'100.0%');
    pass('AND, OR, exclusive selection and prerequisite gating work in actual Execution Quality scoring');
    await switchTo('psych');await send('psych','Create Patience, Discipline and Emotional Control, each out of 10.',proposal('psych','Discipline Scores',['Patience','Discipline','Emotional Control'].map((label,i)=>op(node('score_'+i,label,'score')))));await panel('psych').locator('[data-ai-apply]').click();
    const scoring=await snapshot('psych');await page.evaluate(()=>{navigate('execution');viewExecutionInstrumentSection('psych')});
    // Earlier type switching saved an empty reflection; existing journal mappings retain their selected instrument.
    await page.locator('#executionMapPsychSelect').selectOption(scoring.id);
    const scores=page.locator('#executionMapFormBody [data-execution-response-type="score"]');assert.equal(await scores.count(),3);
    for(const [i,value]of ['8','9','7'].entries())await scores.nth(i).fill(value);assert.equal(await page.locator('#executionMapScore').textContent(),'80.0%');assert.match(await page.locator('#executionMapScoreMeta').textContent(),/24 \/ 30 points/);
    pass('AI scoring instruments reuse the existing fields and correctly calculate 24/30 = 80%');
    await page.goto(url,{waitUntil:'load'});await initialize();await switchTo('checklist');assert.equal((await snapshot('checklist')).id,logicSaved.id);assert.match(await model('checklist').textContent(),/At least one requirement/);await switchTo('psych');assert.equal((await snapshot('psych')).id,scoring.id);assert.equal(await editor('psych').locator('[data-ti-response-type="score"]').count(),3);
    pass('approved logic, score IDs and versions survive reload and instrument switching');
    await switchTo('playbook');quota=false;await send('playbook','Add a condition.',playbook());assert.match(await panel('playbook').locator('[data-ai-error]').textContent(),/usage limit/);quota=true;queue.length=0;
    for(const [status,type,expected]of [[402,null,/add AI Gateway Credits/],[403,'customer_verification_required',/valid payment method/],[402,'quota_for_entity_exceeded',/spend budget/]]){
      await send('playbook','Create a new method.',null,{status,type});const message=await panel('playbook').locator('[data-ai-error]').textContent();assert.match(message,expected);assert.doesNotMatch(message,/Private provider diagnostic/);assert.equal(await panel('playbook').locator('[data-ai-proposal]').isVisible(),false);
    }
    pass('quota and unavailable-provider states show actionable errors without fake AI answers');
    await panel('playbook').locator('[data-ai-new]').click();await send('playbook','Create the imbalance method.',playbook());
    for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:600},{width:768,height:900},{width:390,height:844},{width:320,height:568}]){
      await page.setViewportSize(viewport);await panel('playbook').scrollIntoViewIfNeeded();
      const bounds=await panel('playbook').evaluate(el=>{const p=el.getBoundingClientRect().toJSON(),input=el.querySelector('textarea').getBoundingClientRect().toJSON(),send=el.querySelector('[data-ai-send]').getBoundingClientRect().toJSON();return {width:document.documentElement.scrollWidth,inner:innerWidth,p,input,send}});
      assert.ok(bounds.width<=bounds.inner+1,'No page horizontal overflow at '+viewport.width);assert.ok(bounds.input.width>=70,'Composer remains usable at '+viewport.width);assert.ok(bounds.send.right<=bounds.p.right+1,'Send stays inside its panel');assert.equal(await panel('playbook').locator('[data-ai-apply]').isVisible(),true);
      if(viewport.width===1440)await page.screenshot({path:path.join(output,'ai-builder-preview.png')});if(viewport.width===390)await page.screenshot({path:path.join(output,'ai-builder-mobile.png')});
    }
    pass('desktop, short screens, tablet and narrow mobile retain usable chat and approval controls without horizontal overflow');
    await page.setViewportSize({width:1600,height:1000});await panel('playbook').locator('[data-ai-close]').click();assert.equal(await panel('playbook').isVisible(),false);assert.equal(await editor('playbook').getAttribute('contenteditable'),'true');assert.equal(await editor('playbook').isVisible(),true);assert.equal(await active('playbook').locator('.playbook-word-ribbon').isVisible(),true);assert.equal(await active('playbook').locator('.playbook-word-statusbar').isVisible(),true);assert.equal(await active('playbook').locator('[data-ai-toggle]').getAttribute('aria-expanded'),'false');
    await active('playbook').locator('[data-ai-toggle]').click();await panel('playbook').locator('textarea').fill('Private account draft');const accountStore=await snapshot('playbook');
    await page.evaluate(()=>{window.dispatchEvent(new Event('tios:conversation-scope-changing'));tradingAccount={...tradingAccount,id:'qa-account-2'};renderPlaybookWorkspace()});
    await active('playbook').locator('[data-ai-toggle]').click();assert.equal(await panel('playbook').locator('textarea').inputValue(),'');assert.doesNotMatch(await panel('playbook').locator('[data-ai-messages]').textContent(),/Private account draft|Imbalance Method/);assert.notEqual((await snapshot('playbook')).key,accountStore.key);assert.equal(await page.evaluate(key=>localStorage.getItem(key),accountStore.key),accountStore.store);
    pass('changing accounts clears AI context, loads an independent document library and preserves the earlier account store');
    await panel('playbook').locator('textarea').fill('Private draft');await page.evaluate(()=>{currentUser=null;setLoggedInUI(false)});assert.equal(await panel('playbook').locator('textarea').inputValue(),'');assert.equal(await panel('playbook').locator('[data-ai-messages]').textContent().then(t=>t.includes('Private draft')),false);
    pass('closing restores manual editing; signing out clears drafts, histories, proposals and undo context');
    assert.deepEqual(errors,[]);console.log('All '+checks+' AI Builder browser checks passed.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));global.fetch=originalFetch}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1});
