// Real builder and Execution Quality flows with isolated execution-review storage.
// Run with Playwright installed and TIOS_TEST_BROWSER set to an existing Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const config={
  playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',functions:'#playbookBlockStyle',model:'#playbookExecutionPreviewBody',ribbon:'data-playbook',save:'#playbookDraftSaveBtn',open:'#playbookPreviewOpenExecutionBtn'},
  checklist:{page:'#page-checklists',editor:'[data-ti-editor]',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',ribbon:'data-ti',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]'},
  psych:{page:'#page-reflections',editor:'[data-ti-editor]',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',ribbon:'data-ti',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]'}
};
const owner='00000000-0000-4000-8000-000000000001';
const firstTrade='00000000-0000-4000-8000-000000000011',secondTrade='00000000-0000-4000-8000-000000000012';
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(config[kind].page),editor=kind=>active(kind).locator(config[kind].editor),model=kind=>active(kind).locator(config[kind].model);
const responses=()=>page.locator('#executionMapFormBody [data-execution-reflection-id]');
const saveResponses=()=>page.locator('#executionMapSaveReflectionsBtn');
async function open(kind){await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind),kind)}
async function ribbon(kind,tab){await active(kind).locator('['+config[kind].ribbon+'-ribbon="'+tab+'"]').click()}
async function put(kind,html){await editor(kind).evaluate((el,html)=>{el.innerHTML=html;el.dispatchEvent(new Event('input',{bubbles:true}))},html)}
async function select(kind,selector,whole=false){await editor(kind).locator(selector).evaluate((el,{kind,whole})=>{
  el.closest('[contenteditable="true"]').focus();const range=document.createRange();range.selectNodeContents(el);if(!whole)range.collapse(true);
  instrumentRestoreRange(kind,range);if(kind==='playbook')refreshPlaybookListStyleControls();else refreshSecondaryStyleControls(kind);
},{kind,whole})}
async function mapped(kind){await active(kind).locator(config[kind].save).click();await active(kind).locator(config[kind].open).click()}
async function state(){return page.evaluate(()=>JSON.parse(localStorage.getItem('reflection-browser-backend')))}
async function save(){await saveResponses().click();await page.waitForFunction(()=>!executionMappingReflectionSaving)}
async function snapshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')})}}
async function hydrate(){
 await page.evaluate(({owner,firstTrade,secondTrade})=>{
   setLoggedInUI(true);currentUser={id:owner};tradingAccount={id:'reflection-test-account'};
   trades=[{id:firstTrade,user_id:owner,trade_date:'2026-10-08',instrument:'Trade One',direction:'Buy',execution_score:7},
     {id:secondTrade,user_id:owner,trade_date:'2026-10-07',instrument:'Trade Two',direction:'Sell'}];
   executionReviews=window.__reflectionBackend.reviews.map(x=>({...x}));executionChecks=window.__reflectionBackend.checks.map(x=>({...x}));
 },{owner,firstTrade,secondTrade});
}
async function run(){
 const server=http.createServer((req,res)=>{
   const file=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
   const source=fs.readFileSync(file,'utf8');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');
   res.end(file.endsWith('t-ios.html')?source.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^"]+"><\/script>/g,''):source);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
  page=await browser.newPage({viewport:{width:1823,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.addInitScript(({owner,firstTrade})=>{
    const stored=localStorage.getItem('reflection-browser-backend');
    const backend=window.__reflectionBackend=stored?JSON.parse(stored):{reviews:[{id:'legacy-review',user_id:owner,trade_id:firstTrade,notes:'Keep historical notes'}],checks:[{id:'legacy-check',user_id:owner,review_id:'legacy-review',criterion_key:'check__old',criterion_label:'Original condition',complied:true,comment:'Keep historical comment',sort_order:1}],writes:[]};
    window.__reflectionFailSave=false;window.__reflectionHoldSave=false;
    const persist=()=>localStorage.setItem('reflection-browser-backend',JSON.stringify(backend));
    window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})},from:table=>{
      let op='read',payload=null,conflict=null,one=false;const filters=[];
      const query={
        select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query},order:()=>query,
        single:()=>{one=true;return query},insert:data=>{op='insert';payload=data;return query},
        upsert:(data,options)=>{op='upsert';payload=data;conflict=options.onConflict;return query},
        then:(resolve,reject)=>(async()=>{
          if(!['trade_execution_reviews','trade_execution_checks'].includes(table))throw new Error('Unexpected table: '+table);
          const rows=table==='trade_execution_reviews'?backend.reviews:backend.checks;
          if(op==='read'){const result=rows.filter(row=>filters.every(([key,value])=>row[key]===value));return {data:one?result[0]:result.map(row=>({...row})),error:null}}
          backend.writes.push({table,op,payload:JSON.parse(JSON.stringify(payload)),conflict});persist();
          if(op==='upsert'&&window.__reflectionHoldSave)await new Promise(resolve=>window.__reflectionReleaseSave=resolve);
          if(op==='upsert'&&window.__reflectionFailSave)return {data:null,error:{message:'Simulated save failure'}};
          if(op==='insert'){
            if(rows.some(row=>row.trade_id===payload.trade_id))return {data:null,error:{code:'23505'}};
            const row={...payload,id:'review-'+backend.writes.length};rows.push(row);persist();return {data:{...row},error:null};
          }
          if(conflict!=='review_id,criterion_key'||!payload.every(row=>row.criterion_key.startsWith('text__ti__')&&row.user_id===owner))throw new Error('Unexpected reflection payload');
          const result=payload.map(row=>{
            const existing=rows.find(saved=>saved.review_id===row.review_id&&saved.criterion_key===row.criterion_key);
            if(existing){Object.assign(existing,row);return {...existing}}
            const saved={...row,id:'response-'+rows.length};rows.push(saved);return {...saved};
          });persist();return {data:result,error:null};
        })().then(resolve,reject)
      };return query;
    }})};persist();
  },{owner,firstTrade});
  await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});await hydrate();
  for(const kind of Object.keys(config)){
    await open(kind);await put(kind,'<p id="question">What <b>happened?</b></p><p id="neighbor">Keep this paragraph.</p>');
    await select(kind,'#question',true);await ribbon(kind,'home');
    const neighbor=await editor(kind).locator('#neighbor').evaluate(el=>el.outerHTML);
    await active(kind).locator('[data-instrument-reflection-function]').click();
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),1);
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').textContent(),'What happened?');
    assert.equal(await editor(kind).locator('#neighbor').evaluate(el=>el.outerHTML),neighbor);
    assert.equal(await model(kind).locator('.ti-preview-prompt').count(),1);assert.equal(await model(kind).locator('textarea,input').count(),0);
    const id=await editor(kind).locator('[data-ti-reflection-id]').getAttribute('data-ti-reflection-id');
    await mapped(kind);assert.equal(await responses().count(),1);assert.equal(await responses().getAttribute('data-execution-reflection-id'),id);
    assert.equal(await page.locator('#executionMapScore').textContent(),'—');
    const text=kind+' reflection\nI waited for confirmation <without chasing>.';
    await responses().fill(text);await save();
    assert.ok((await state()).checks.some(row=>row.comment===text));assert.equal(await page.locator('#executionMapScore').textContent(),'—');
    await page.locator('#executionMapTradeSelect').selectOption(secondTrade);assert.equal(await responses().inputValue(),'');
    await page.locator('#executionMapTradeSelect').selectOption(firstTrade);assert.equal(await responses().inputValue(),text);
    pass(kind+' selected raw text becomes a prompt without new wording; Live Model is read-only; per-trade answers save separately without scoring');
    await page.locator('#executionBackToInstrumentsBtn').click();
    const remove=editor(kind).locator('[data-instrument-remove-reflection]');
    assert.equal(await remove.count(),1);assert.equal(await remove.getAttribute('aria-label'),'Remove reflection box');
    await snapshot(kind+'-remove-reflection');
    await remove.click();
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0,await editor(kind).innerHTML());
    assert.equal(await model(kind).locator('.ti-preview-prompt').count(),0);
    assert.equal(await editor(kind).locator('#neighbor').evaluate(el=>el.outerHTML),neighbor);
    const command=name=>active(kind).locator('['+config[kind].ribbon+'-command="'+name+'"]');
    await command('undo').click();assert.equal(await editor(kind).locator('[data-ti-reflection-id]').getAttribute('data-ti-reflection-id'),id);
    await command('redo').click();assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0);
    await command('undo').click();await remove.focus();await page.keyboard.press('Enter');
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0);
    await command('undo').click();assert.equal(await model(kind).locator('.ti-preview-prompt').count(),1);
    assert.equal(await model(kind).locator('[data-instrument-remove-reflection],button').count(),0);
    pass(kind+' reflection × removes only its own box, immediately updates the read-only model, supports keyboard removal and restores the original prompt with Undo / Redo');
    await select(kind,'[data-playbook-node="psych-prompt"]',true);await ribbon(kind,'home');await active(kind).locator('[data-instrument-back-to-text]').click();
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0);assert.ok((await editor(kind).textContent()).includes('What happened?'));
    pass(kind+' reflection prompts return to ordinary text without losing their wording');
  }
  const savedBefore=await state();assert.equal(savedBefore.checks.find(row=>row.id==='legacy-check').comment,'Keep historical comment');assert.equal(savedBefore.reviews[0].notes,'Keep historical notes');
  assert.equal(await page.evaluate(()=>trades[0].execution_score),7);
  assert.equal(savedBefore.checks.filter(row=>row.criterion_key.startsWith('text__ti__')).length,3);
  pass('Saving reflections preserves existing reviews, condition rows, historical notes and trade scores');

  const journalButton=id=>page.locator('[data-journal-reflection="'+id+'"]');
  const journalDialog=()=>page.locator('#journalReflectionModal');
  const journalBody=()=>page.locator('#journalReflectionBody');
  await page.evaluate(()=>navigate('journal'));
  assert.equal(await page.locator('#journalBody [data-journal-reflection]').count(),2);
  assert.ok((await journalButton(firstTrade).getAttribute('class')).includes('has-reflections'));
  assert.ok(!(await journalButton(secondTrade).getAttribute('class')).includes('has-reflections'));
  await snapshot('journal-reflection-buttons');await journalButton(firstTrade).click();
  assert.equal(await journalDialog().getAttribute('aria-hidden'),'false');
  assert.equal(await journalBody().locator('textarea,input,[contenteditable="true"]').count(),0);
  assert.ok((await page.locator('#journalReflectionTrade').textContent()).includes('Trade One'));
  assert.deepEqual(await journalBody().locator('dd').allTextContents(),['psych reflection\nI waited for confirmation <without chasing>.','Keep historical notes']);
  assert.equal(await journalBody().locator('without,script,img').count(),0);
  await snapshot('journal-saved-reflection');
  pass('Journal Psychology buttons open the selected trade’s saved psychological answers and historical notes, read-only, with no Playbook or Rules leakage');

  await page.evaluate(()=>renderJournal());assert.equal(await journalDialog().getAttribute('aria-hidden'),'false');
  assert.equal(await page.locator('#journalReflectionClose').evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await journalBody().evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#journalReflectionClose').evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Escape');assert.equal(await journalDialog().getAttribute('aria-hidden'),'true');
  assert.equal(await journalButton(firstTrade).evaluate(el=>document.activeElement===el),true);
  assert.deepEqual(await state(),savedBefore);assert.equal(await page.evaluate(()=>trades[0].execution_score),7);
  pass('Reflection viewing survives Journal refresh, traps keyboard focus, closes with Escape, restores the row button and never writes or changes a score');

  await journalButton(secondTrade).click();assert.ok((await journalBody().textContent()).includes('No reflection saved for this trade yet'));
  assert.equal(await journalBody().locator('dd').count(),0);
  await journalDialog().click({position:{x:2,y:2}});assert.equal(await journalDialog().getAttribute('aria-hidden'),'true');
  await page.locator('#journalSearch').fill('Trade Two');assert.equal(await page.locator('#journalBody [data-journal-reflection]').count(),1);
  await journalButton(secondTrade).click();assert.equal(await journalBody().locator('dd').count(),0);
  await page.locator('#journalReflectionClose').click();await page.locator('#resetFilters').click();
  pass('Trades without reflections show an honest empty state; row buttons still work after filtering and backdrop close');

  await page.evaluate(({owner,firstTrade})=>{
    const review=executionReviews.find(row=>row.trade_id===firstTrade);
    secondaryState('psych').docs.push(secondaryNormalizeDoc('psych',{id:'journal-second-document',name:'Second reflection <b>',documentHtml:'<p>Historical template.</p>'}));
    persistSecondaryDocuments('psych');
    executionChecks.push(
      {review_id:review.id,user_id:owner,criterion_key:'text__ti__psych__journal-second-document__question__with_underscores',criterion_label:'Second question',comment:'Second answer\nAnother line.',sort_order:50},
      {review_id:review.id,user_id:owner,criterion_key:'text__ti__psych__removed-document__prompt',criterion_label:'Old question',comment:'Keep this answer after deleting or changing its template.',sort_order:51},
      {review_id:review.id,user_id:owner,criterion_key:'text__legacy_question',criterion_label:'Legacy question',comment:'Older written reflection.',sort_order:52},
      {review_id:review.id,user_id:'another-user',criterion_key:'text__ti__psych__journal-second-document__private',criterion_label:'Private',comment:'Do not show another owner’s text.',sort_order:53},
      {review_id:review.id,user_id:owner,criterion_key:'text__ti__psych__%ZZ__broken',criterion_label:'Malformed',comment:'Do not crash.',sort_order:54},
      {review_id:review.id,user_id:owner,criterion_key:'text__ti__psych__journal-second-document__empty',criterion_label:'Empty',comment:'   ',sort_order:55}
    );renderJournal();
  },{owner,firstTrade});
  await journalButton(firstTrade).click();
  assert.ok((await journalBody().locator('h3').allTextContents()).includes('Second reflection <b>'));
  const viewed=await journalBody().locator('dd').allTextContents();
  for(const answer of ['Second answer\nAnother line.','Keep this answer after deleting or changing its template.','Older written reflection.'])assert.ok(viewed.includes(answer));
  assert.ok(!(await journalBody().textContent()).includes('another owner'));
  assert.ok(!(await journalBody().textContent()).includes('Do not crash.'));
  assert.equal(await journalBody().locator('h3 b').count(),0);
  pass('Multiple psychological documents, removed prompts and legacy answers retain their saved labels and multiline text; foreign-owner, blank and malformed rows stay out');

  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.journal-reflection-card').evaluate(el=>el.getBoundingClientRect().width<=innerWidth-30&&el.scrollWidth<=el.clientWidth));
  await snapshot('journal-reflection-mobile');
  await page.locator('#journalReflectionClose').click();await page.setViewportSize({width:1823,height:1000});
  await page.reload({waitUntil:'load'});await hydrate();await page.evaluate(()=>navigate('journal'));
  await journalButton(firstTrade).click();
  assert.deepEqual(await journalBody().locator('dd').allTextContents(),['psych reflection\nI waited for confirmation <without chasing>.','Keep historical notes']);
  await page.locator('#journalReflectionClose').click();await journalButton(secondTrade).click();assert.equal(await journalBody().locator('dd').count(),0);
  pass('The viewer fits mobile width and reload restores only persisted answers for the chosen trade');

  await page.evaluate(()=>navigate('execution'));assert.equal(await journalDialog().getAttribute('aria-hidden'),'true');
  await page.evaluate(()=>navigate('journal'));await journalButton(firstTrade).click();
  await page.evaluate(()=>{tradingAccount={id:'another-account'};trades=[];renderJournal()});
  assert.equal(await journalDialog().getAttribute('aria-hidden'),'true');assert.equal(await journalBody().textContent(),'');
  await hydrate();await page.evaluate(()=>navigate('journal'));await journalButton(firstTrade).click();
  await page.evaluate(()=>{currentUser={id:'another-user'};renderJournal()});await journalButton(firstTrade).click();
  assert.equal(await journalBody().locator('dd').count(),0);
  await page.evaluate(()=>setLoggedInUI(false));assert.equal(await journalDialog().getAttribute('aria-hidden'),'true');
  await hydrate();assert.deepEqual(await state(),savedBefore);
  pass('Navigation, account changes and sign-out close and clear the viewer; saved reflections remain restricted to the current owner');

  await open('psych');await put('psych','<p>Strengths</p><p>Weaknesses</p><p>Opportunities</p><p>Threats</p><p id="neighbor">Outside the group.</p>');
  await page.evaluate(()=>{
    const el=secondaryFind('psych','[data-ti-editor]'),range=document.createRange();range.setStart(el.children[0],0);range.setEnd(el.children[3],el.children[3].childNodes.length);
    instrumentRestoreRange('psych',range);refreshSecondaryStyleControls('psych');
  });
  await ribbon('psych','home');await active('psych').locator('[data-ti-block-style]').selectOption('psych-prompt');
  const group=editor('psych').locator('[data-playbook-node="reflection-group"]');
  assert.equal(await group.count(),1);assert.equal(await group.locator('[data-ti-reflection-id]').count(),4);
  await select('psych','[data-playbook-node="reflection-group"]',true);
  await ribbon('psych','styles');
  await active('psych').locator('[data-ti-list-layout="columns-2"]').click();
  for(const [category,value] of [['alignment','center'],['spacing','relaxed'],['borders','strong'],['presets','card']]){
    await active('psych').locator('[data-ti-style-category="'+category+'"]').click();
    const key={alignment:'align',spacing:'spacing',borders:'border',presets:'preset'}[category];
    await active('psych').locator('[data-ti-style-'+key+'="'+value+'"]').click();
  }
  await active('psych').locator('[data-ti-style-category="colors"]').click();
  await active('psych').locator('[data-ti-style-color="border"]').evaluate(el=>{el.value='#1265c9';el.dispatchEvent(new Event('input',{bubbles:true}))});
  assert.equal(await group.getAttribute('data-playbook-list-layout'),'columns-2');
  const live=model('psych').locator('.ti-reflection-layout');
  assert.equal(await live.locator('.ti-preview-prompt').count(),4);
  assert.equal(await live.locator('.ti-preview-prompt').first().evaluate(el=>getComputedStyle(el).borderTopWidth),'2px');
  assert.equal(await live.locator('.ti-preview-prompt').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(18, 101, 201)');
  assert.equal(await group.locator('[data-playbook-node="psych-prompt"]').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
  const customIds=await group.locator('[data-ti-reflection-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiReflectionId));
  await mapped('psych');
  assert.equal(await responses().count(),4);
  const mappedGroup=page.locator('#executionMapFormBody .ti-reflection-layout');
  assert.equal(await mappedGroup.getAttribute('data-playbook-align'),'center');assert.equal(await mappedGroup.getAttribute('data-playbook-border'),'strong');
  assert.equal(await mappedGroup.locator('.execution-psych-prompt').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(18, 101, 201)');
  await responses().nth(0).fill('Keep a draft on trade one');await page.locator('#executionMapTradeSelect').selectOption(secondTrade);
  assert.equal(await responses().nth(0).inputValue(),'');await responses().nth(0).fill('Different trade two response');await save();
  await page.locator('#executionMapTradeSelect').selectOption(firstTrade);assert.equal(await responses().nth(0).inputValue(),'Keep a draft on trade one');
  await save();const db=await state();assert.equal(db.reviews.filter(row=>row.trade_id===secondTrade).length,1);
  pass('Grouped prompts combine 2 Columns, Center, Relaxed, Strong, Card and custom blue borders across builder, Live Model and Execution Quality');
  pass('Unsaved drafts and saved answers remain isolated by trade; a new trade review is created only when saving');

  // A failed save preserves the answer and a retry writes it once under the same stable key.
  await responses().nth(0).fill('Retry this answer');await page.evaluate(()=>window.__reflectionFailSave=true);await save();
  assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('not saved'));
  assert.equal(await responses().nth(0).inputValue(),'Retry this answer');
  await page.evaluate(()=>window.__reflectionFailSave=false);await save();assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('saved for this trade'));
  pass('Save failures retain the reflection and allow a successful retry');

  await responses().nth(0).fill('Snapshot before save');await page.evaluate(()=>window.__reflectionHoldSave=true);await saveResponses().click();
  await page.waitForFunction(()=>typeof window.__reflectionReleaseSave==='function');await responses().nth(0).fill('Typed while saving');
  await page.evaluate(()=>{window.__reflectionHoldSave=false;window.__reflectionReleaseSave()});await page.waitForFunction(()=>!executionMappingReflectionSaving);
  assert.equal(await responses().nth(0).inputValue(),'Typed while saving');assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('Unsaved'));await save();
  pass('Text typed during a pending save remains visible and unsaved until its next Save');

  await page.reload({waitUntil:'load'});await hydrate();await page.evaluate(()=>{executionMappingActiveInstrument='psych';navigate('execution')});
  assert.equal(await responses().nth(0).inputValue(),'Typed while saving');
  assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.dataset.executionReflectionId)),customIds);
  assert.equal(await page.locator('#executionMapFormBody .ti-reflection-layout').getAttribute('data-playbook-border'),'strong');
  pass('Reload restores saved written answers, prompt IDs and document presentation');
  await page.locator('#executionMapResetBtn').click();assert.equal(await responses().nth(0).inputValue(),'');
  assert.ok((await state()).checks.some(row=>row.comment==='Typed while saving'));await save();
  assert.equal((await state()).checks.find(row=>row.criterion_key.endsWith(customIds[0])&&row.review_id==='legacy-review').comment,null);
  pass('Reset clears only the displayed inputs; clearing saved reflections requires Save');

  await open('psych');await ribbon('psych','templates');await active('psych').locator('[data-instrument-template="psych-swot"]').click();
  const swotId=await page.evaluate(()=>secondaryState('psych').selectedId);
  assert.equal(await editor('psych').locator('[data-ti-reflection-id]').count(),4);
  assert.deepEqual(await editor('psych').locator('[data-playbook-node="psych-prompt"]').evaluateAll(nodes=>nodes.map(node=>{const copy=node.cloneNode(true);copy.querySelectorAll('button').forEach(button=>button.remove());return copy.textContent})),['Strengths','Weaknesses','Opportunities','Threats']);
  await page.evaluate(()=>renderExecutionMappingControls());
  assert.equal(await page.locator('#executionMapPsychSelect option[value="'+swotId+'"]').count(),0);
  for(const location of [editor('psych').locator('.ti-reflection-layout'),model('psych').locator('.ti-reflection-layout')]){
    assert.equal(await location.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    assert.ok(await location.locator('div[data-ti-text-block]').first().evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.getBoundingClientRect().height)<2));
  }
  await snapshot('swot-builder');await mapped('psych');assert.equal(await responses().count(),4);
  await responses().nth(0).fill('My strength is patience.');await responses().nth(1).fill('I rushed the exit.');await save();await snapshot('swot-execution');
  assert.equal(await page.locator('#executionMapScore').textContent(),'—');
  pass('SWOT stays a template draft until Save, then maps four square labelled response boxes and records the trade reflection without a score');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('#executionMapFormBody .ti-reflection-layout').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  await snapshot('swot-mobile');await page.setViewportSize({width:1823,height:1000});
  pass('SWOT response boxes adapt to mobile width without horizontal overflow');

  await page.locator('#executionBackToInstrumentsBtn').click();await ribbon('psych','templates');await active('psych').locator('[data-instrument-template="psych-rows"]').click();
  assert.equal(await model('psych').locator('.ti-reflection-layout').getAttribute('data-playbook-list-layout'),'row');
  assert.equal(await model('psych').locator('.ti-preview-prompt').count(),3);
  await mapped('psych');assert.equal(await responses().count(),3);assert.equal(await page.locator('#executionMapFormBody .ti-reflection-layout').evaluate(el=>getComputedStyle(el).display),'flex');
  pass('Reflection Rows maps three row headings with independent written response areas');

  await page.locator('#executionBackToInstrumentsBtn').click();
  await select('psych','[data-playbook-node="reflection-group"]',true);await ribbon('psych','styles');
  await active('psych').locator('[data-ti-style-category="reset"]').click();await active('psych').locator('[data-ti-action="reset-style"]').click();
  assert.equal(await editor('psych').locator('.ti-reflection-layout').getAttribute('data-playbook-preset'),null);
  assert.equal(await editor('psych').locator('[data-playbook-node="psych-prompt"]').first().getAttribute('data-playbook-preset'),null);
  await ribbon('psych','home');await active('psych').locator('[data-instrument-back-to-text]').click();assert.equal(await editor('psych').locator('[data-playbook-node="reflection-group"]').count(),0);
  assert.ok((await editor('psych').textContent()).includes('What happened?'));assert.ok((await editor('psych').textContent()).includes('What did I learn?'));
  pass('Reset Selected and Back to text operate on the reflection group without retaining its old box styling');

  const removalSnapshots={};
  for(const kind of Object.keys(config)){
    await open(kind);await put(kind,'<p id="removal-before"><b>Keep this text.</b></p><p id="removal-rule" data-playbook-node="rule">Keep this rule.</p><div class="ti-reflection-layout" data-playbook-node="reflection-group" data-playbook-list-layout="columns-2" data-playbook-align="center" data-playbook-preset="card"><div data-playbook-node="psych-prompt">First question</div><div data-playbook-node="psych-prompt">Second question</div></div><p id="empty-reflection" data-playbook-node="psych-prompt"><br></p><p id="removal-after">Keep this paragraph.</p>');
    const neighbors=await editor(kind).locator('#removal-before,#removal-rule,#removal-after').evaluateAll(nodes=>nodes.map(node=>node.outerHTML));
    const boxes=editor(kind).locator('[data-playbook-node="reflection-group"] [data-instrument-remove-reflection]');
    await boxes.last().click();assert.equal(await boxes.count(),1);
    assert.equal(await model(kind).locator('.ti-preview-prompt').count(),1);
    const remainingGroup=editor(kind).locator('[data-playbook-node="reflection-group"]');
    assert.equal(await remainingGroup.getAttribute('data-playbook-list-layout'),'columns-2');
    assert.equal(await remainingGroup.getAttribute('data-playbook-preset'),'card');
    assert.equal(await remainingGroup.locator(':scope > p:not([data-playbook-node])').count(),0);
    await ribbon(kind,'home');await active(kind).locator('['+config[kind].ribbon+'-command="undo"]').click();assert.equal(await boxes.count(),2,await editor(kind).innerHTML());
    await active(kind).locator('['+config[kind].ribbon+'-command="redo"]').click();assert.equal(await boxes.count(),1);
    await boxes.first().click();assert.equal(await remainingGroup.count(),0);
    await editor(kind).locator('#empty-reflection [data-instrument-remove-reflection]').click();
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0);
    assert.equal(await model(kind).locator('.ti-preview-prompt,.ti-reflection-layout').count(),0);
    assert.equal(await model(kind).locator('.playbook-preview-check').count(),1);
    assert.deepEqual(await editor(kind).locator('#removal-before,#removal-rule,#removal-after').evaluateAll(nodes=>nodes.map(node=>node.outerHTML)),neighbors);
    await mapped(kind);assert.equal(await responses().count(),0);assert.equal(await page.locator('#executionMapFormBody input[type="checkbox"]').count(),1);
    await page.locator('#executionBackToInstrumentsBtn').click();removalSnapshots[kind]=await editor(kind).innerHTML();
    pass(kind+' removes individual grouped and blank reflection boxes, clears an empty group, preserves nearby rules and saves the updated Execution Quality mapping');
  }
  await page.reload({waitUntil:'load'});await hydrate();
  for(const kind of Object.keys(config)){
    await open(kind);assert.equal(await editor(kind).innerHTML(),removalSnapshots[kind]);
    assert.equal(await editor(kind).locator('[data-playbook-node="psych-prompt"]').count(),0);
  }
  pass('Reflection removals persist across builder switching and page reload, with separate document storage');

  const scoreIds={},scoreDocuments={};
  for(const kind of Object.keys(config)){
    await open(kind);await put(kind,'<h2>Characteristics</h2><ul id="traits"><li><b>Discipline</b></li><li>Patience</li><li>Objectivity</li></ul><p id="score-rule" data-playbook-node="rule">Followed the plan.</p><p id="score-neighbor">Keep my wording.</p>');
    const neighbor=await editor(kind).locator('#score-neighbor').evaluate(el=>el.outerHTML);
    await select(kind,'#traits',true);await ribbon(kind,'home');await active(kind).locator(config[kind].functions).selectOption('score');
    const scoreGroup=editor(kind).locator('[data-playbook-node="reflection-group"]');
    const boxes=scoreGroup.locator('[data-ti-response-type="score"]');
    assert.equal(await boxes.count(),3);
    assert.deepEqual(await boxes.evaluateAll(nodes=>nodes.map(node=>{const clone=node.cloneNode(true);clone.querySelectorAll('button').forEach(b=>b.remove());return clone.textContent})),['Discipline','Patience','Objectivity']);
    assert.equal(await boxes.first().locator('b').textContent(),'Discipline');
    assert.equal(await editor(kind).locator('#score-neighbor').evaluate(el=>el.outerHTML),neighbor);
    scoreIds[kind]=await boxes.evaluateAll(nodes=>nodes.map(node=>node.dataset.tiReflectionId));assert.ok(scoreIds[kind].every(id=>id.startsWith('score_')));
    assert.equal(await model(kind).locator('.ti-score-placeholder').count(),3);
    assert.equal(await model(kind).locator('input,textarea').count(),0);
    pass(kind+' converts an existing personality list into separately labelled Score fields without adding content; Live Model remains read-only');

    await select(kind,'[data-playbook-node="reflection-group"]',true);await ribbon(kind,'styles');
    await active(kind).locator('['+config[kind].ribbon+'-list-layout="columns-2"]').click();
    for(const [category,value] of [['alignment','center'],['spacing','relaxed'],['borders','strong'],['presets','card']]){
      await active(kind).locator('['+config[kind].ribbon+'-style-category="'+category+'"]').click();
      const key={alignment:'align',spacing:'spacing',borders:'border',presets:'preset'}[category];
      await active(kind).locator('['+config[kind].ribbon+'-style-'+key+'="'+value+'"]').click();
    }
    await active(kind).locator('['+config[kind].ribbon+'-style-category="colors"]').click();
    for(const [slot,color] of [['background','#e7efff'],['border','#1265c9'],['text','#14253f'],['accent','#805ac2']]){
      await active(kind).locator('['+config[kind].ribbon+'-style-color="'+slot+'"]').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},color);
    }
    const liveBoxes=model(kind).locator('[data-ti-response-type="score"]');
    assert.equal(await liveBoxes.first().evaluate(el=>getComputedStyle(el).borderTopWidth),'2px');
    assert.equal(await liveBoxes.first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(18, 101, 201)');
    assert.equal(await liveBoxes.first().evaluate(el=>getComputedStyle(el).textAlign),'center');
    await snapshot(kind+'-score-builder');await mapped(kind);
    scoreDocuments[kind]=await page.evaluate(()=>executionMappingReflectionContext.documentId);
    assert.equal(await responses().count(),3);assert.equal(await responses().first().getAttribute('type'),'number');
    assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['','','']);
    assert.equal(await saveResponses().textContent(),'Save scores');
    for(const field of await responses().all()){assert.equal(await field.getAttribute('min'),'0');assert.equal(await field.getAttribute('max'),'10');assert.equal(await field.getAttribute('step'),'any')}
    const mappedBoxes=page.locator('#executionMapFormBody [data-ti-response-type="score"]');
    assert.equal(await page.locator('#executionMapFormBody .ti-reflection-layout').getAttribute('data-playbook-list-layout'),'columns-2');
    assert.equal(await mappedBoxes.first().evaluate(el=>getComputedStyle(el).borderTopWidth),'2px');
    assert.equal(await mappedBoxes.first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(18, 101, 201)');
    assert.equal(await mappedBoxes.first().locator('.ti-score-entry').evaluate(el=>getComputedStyle(el).justifyContent),'center');
    assert.equal(await page.locator('#executionMapScore').textContent(),'—');
    assert.equal(await page.locator('#executionMapScoreLabel').textContent(),'Live score total');
    assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'0 / 30 points · 0 of 3 scored.');
    await page.locator('#executionMapFormBody input[type="checkbox"]').check();assert.equal(await page.locator('#executionMapScore').textContent(),'—');
    assert.equal(await page.locator('#executionMapConditionScore').textContent(),'Conditions: 100.0% · 1 of 1 met.');
    const beforeScoring=await state();
    await responses().first().fill('10');assert.equal(await page.locator('#executionMapScore').textContent(),'33.3%');
    assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'10 / 30 points · 1 of 3 scored.');
    await responses().nth(1).fill('10');await responses().nth(2).fill('8');
    assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');
    assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'28 / 30 points · 3 of 3 scored.');
    await snapshot(kind+'-score-28-of-30');
    await responses().nth(2).fill('10');assert.equal(await page.locator('#executionMapScore').textContent(),'100.0%');
    assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'30 / 30 points · 3 of 3 scored.');
    for(const field of await responses().all())await field.fill('0');
    assert.equal(await page.locator('#executionMapScore').textContent(),'0.0%');
    assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'0 / 30 points · 3 of 3 scored.');
    assert.deepEqual(await state(),beforeScoring);
    pass(kind+' ratings update the marked total immediately: 28/30 → 93.3%, 30/30 → 100%, zeros → 0%; blanks still contribute to the full maximum and no typing is written before Save');
    for(const [index,value] of ['10','7.5','0'].entries())await responses().nth(index).fill(value);
    await save();
    const savedRows=(await state()).checks.filter(row=>row.review_id==='legacy-review'&&scoreIds[kind].some(id=>row.criterion_key.endsWith(id)));
    assert.deepEqual(savedRows.map(row=>JSON.parse(row.comment)),[{type:'score',value:10,max:10},{type:'score',value:7.5,max:10},{type:'score',value:0,max:10}]);
    assert.ok(savedRows.every(row=>row.criterion_key.startsWith('text__ti__'+kind+'__')));
    assert.equal(await page.locator('#executionMapScore').textContent(),'58.3%');assert.equal(await page.evaluate(()=>trades[0].execution_score),7);
    assert.equal(await page.locator('#executionMapConditionScore').textContent(),'Conditions: 100.0% · 1 of 1 met.');
    await page.locator('#executionMapFormBody input[type="checkbox"]').uncheck();assert.equal(await page.locator('#executionMapScore').textContent(),'58.3%');
    assert.equal(await page.locator('#executionMapConditionScore').textContent(),'Conditions: 0.0% · 0 of 1 met.');
    assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('Scores saved for this trade'));
    pass(kind+' Score layouts, alignment, spacing, borders, presets and custom colors map immediately; 10, fractional and zero ratings save independently of condition percentages');

    await page.locator('#executionMapTradeSelect').selectOption(secondTrade);assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['','','']);assert.equal(await page.locator('#executionMapScore').textContent(),'—');
    await responses().first().fill('6.25');assert.equal(await page.locator('#executionMapScore').textContent(),'20.8%');await save();
    await page.locator('#executionMapTradeSelect').selectOption(firstTrade);assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['10','7.5','0']);
    assert.equal(await page.locator('#executionMapScore').textContent(),'58.3%');
    await snapshot(kind+'-score-execution');
    pass(kind+' scores remain isolated between trades and between Technical Instruments');
    await page.locator('#executionBackToInstrumentsBtn').click();
  }
  await page.reload({waitUntil:'load'});await hydrate();
  for(const kind of Object.keys(config)){
    await open(kind);assert.deepEqual(await editor(kind).locator('[data-ti-response-type="score"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiReflectionId)),scoreIds[kind]);
    await mapped(kind);assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['10','7.5','0']);
    assert.equal(await page.locator('#executionMapScore').textContent(),'58.3%');assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'17.5 / 30 points · 3 of 3 scored.');
    assert.equal(await page.evaluate(()=>executionMappingReflectionContext.documentId),scoreDocuments[kind]);
    await page.locator('#executionBackToInstrumentsBtn').click();
  }
  pass('Saved Score functions, stable IDs, styling and per-trade values survive builder switching and a full page reload');

  await open('psych');await mapped('psych');
  for(const invalid of ['-1','11']){
    const before=await state();await responses().first().fill(invalid);await save();
    assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('Discipline: Enter a score from 0 to 10'));
    assert.equal(await page.locator('#executionMapScore').textContent(),'—');assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'Enter scores from 0 to 10.');
    assert.deepEqual(await state(),before);assert.equal(await responses().first().inputValue(),invalid);
  }
  await responses().first().fill('');await responses().first().press('e');
  assert.equal(await responses().first().evaluate(el=>el.validity.badInput),true);
  assert.equal(await page.locator('#executionMapScore').textContent(),'—');
  const invalidBefore=await state();await save();assert.deepEqual(await state(),invalidBefore);
  await responses().first().fill('10');await responses().nth(1).fill('');await save();
  assert.equal((await state()).checks.find(row=>row.review_id==='legacy-review'&&row.criterion_key.endsWith(scoreIds.psych[1])).comment,null);
  assert.equal(await responses().nth(2).inputValue(),'0');
  assert.equal(await page.locator('#executionMapScore').textContent(),'33.3%');assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'10 / 30 points · 2 of 3 scored.');
  pass('Scores reject negative, over-10 and non-numeric input before any write; blank clears a response and remains distinct from a saved zero');

  await responses().first().fill('9');await page.evaluate(()=>window.__reflectionFailSave=true);await save();
  assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('Scores were not saved'));
  assert.equal(await responses().first().inputValue(),'9');await page.evaluate(()=>window.__reflectionFailSave=false);await save();
  await responses().first().fill('8');await page.evaluate(()=>window.__reflectionHoldSave=true);await saveResponses().click();
  await page.waitForFunction(()=>typeof window.__reflectionReleaseSave==='function');await responses().first().fill('10');
  await page.evaluate(()=>{window.__reflectionHoldSave=false;window.__reflectionReleaseSave()});await page.waitForFunction(()=>!executionMappingReflectionSaving);
  assert.equal(await responses().first().inputValue(),'10');assert.ok((await page.locator('#executionMapReflectionSaveState').textContent()).includes('Unsaved scores'));await save();
  pass('A failed Score save retains the value for retry, and edits made during a pending save remain unsaved until the next Save');

  await page.evaluate(()=>navigate('journal'));await journalButton(firstTrade).click();
  const ratings=await journalBody().locator('dd').allTextContents();assert.ok(ratings.includes('10 / 10'));assert.ok(ratings.includes('0 / 10'));
  assert.ok(!(await journalBody().textContent()).includes('"type":"score"'));
  assert.equal((await journalBody().locator('dt').allTextContents()).filter(label=>label==='Discipline').length,1);
  await snapshot('journal-saved-scores');await page.locator('#journalReflectionClose').click();
  await page.evaluate(firstTrade=>{
    // Exercise the compatibility renderer without reintroducing its retired UI.
    const fixture=document.createElement('section');fixture.id='score-history-fixture';fixture.hidden=true;
    for(const id of ['executionReflectionFields','executionStructureEmpty','executionStructureSelect','executionStructureActions','executionEditStructureBtn','executionDeleteStructureBtn','executionUseRecommendedBtn','executionNewStructureBtn','executionSaveHistoricalStructureBtn','executionStructureName','executionStructureMeta','executionLiveScore','executionLiveRating','executionHeaderGrade']){
      const el=document.createElement(id==='executionStructureSelect'?'select':'div');el.id=id;fixture.appendChild(el);
    }
    document.body.appendChild(fixture);
    selectedExecutionTradeId=firstTrade;
    const review=executionReviews.find(row=>row.trade_id===firstTrade);renderExecutionReflectionFields(review);
  },firstTrade);
  const historical=page.locator('#executionReflectionFields [data-execution-response-type="score"]');
  assert.equal(await historical.count(),9);assert.ok((await historical.evaluateAll(nodes=>nodes.map(node=>node.value))).includes('0'));
  assert.equal(await page.locator('#executionReflectionFields textarea').evaluateAll(nodes=>nodes.some(node=>node.value.includes('"type":"score"'))),false);
  assert.equal(await page.evaluate(()=>executionChecklistRowsForReview('legacy-review').length),1);
  assert.deepEqual(await page.evaluate(()=>['not json','null','{"type":"score","value":11,"max":10}','{"type":"score","value":"0","max":10}'].map(executionScoreResponseFromComment)),[null,null,null,null]);
  await page.evaluate(()=>document.getElementById('score-history-fixture').remove());
  pass('Journal shows psychological ratings as readable values; historical reviews use numeric fields, malformed data is ignored and all ratings stay outside compliance scoring');

  await open('psych');await mapped('psych');const beforeReset=await state();await page.locator('#executionMapResetBtn').click();
  assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['','','']);assert.deepEqual(await state(),beforeReset);
  assert.equal(await page.locator('#executionMapScore').textContent(),'—');assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'0 / 30 points · 0 of 3 scored.');
  await page.reload({waitUntil:'load'});await hydrate();await page.evaluate(()=>{executionMappingActiveInstrument='psych';navigate('execution')});
  assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['10','','0']);
  assert.equal(await page.locator('#executionMapScore').textContent(),'33.3%');
  pass('Reset Inputs clears the visible score fields without deleting saved ratings before Save');

  await page.locator('#executionBackToInstrumentsBtn').click();await open('psych');await ribbon('psych','home');
  const remainingIds=scoreIds.psych.slice(1);await editor('psych').locator('[data-instrument-remove-reflection]').first().click();
  assert.deepEqual(await editor('psych').locator('[data-ti-response-type="score"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiReflectionId)),remainingIds);
  await active('psych').locator('[data-ti-command="undo"]').click();assert.equal(await editor('psych').locator('[data-ti-response-type="score"]').count(),3);
  await select('psych','[data-playbook-node="reflection-group"]',true);await active('psych').locator('[data-instrument-back-to-text]').click();
  assert.equal(await editor('psych').locator('[data-ti-response-type="score"],[data-playbook-node="reflection-group"]').count(),0);
  assert.ok((await editor('psych').textContent()).includes('Discipline'));assert.ok((await editor('psych').textContent()).includes('Keep my wording.'));
  assert.equal(await model('psych').locator('.ti-score-placeholder').count(),0);
  pass('Score boxes can be removed individually, restored with Undo and returned to ordinary text without changing their labels or nearby content');

  await put('psych','<p id="single-score"><i>Discipline</i></p><p id="mixed-reflection">What happened?</p><p id="mixed-neighbor">Keep this paragraph.</p>');
  await select('psych','#single-score',true);await active('psych').locator(config.psych.functions).selectOption('score');
  assert.equal(await editor('psych').locator('[data-playbook-node="reflection-group"]').count(),0);
  assert.equal(await editor('psych').locator('[data-ti-response-type="score"]').textContent(),'Discipline');
  const singleScoreId=await editor('psych').locator('[data-ti-response-type="score"]').getAttribute('data-ti-reflection-id');
  await select('psych','#mixed-reflection',true);await active('psych').locator('[data-instrument-reflection-function]').click();
  await select('psych','[data-ti-response-type="score"]',true);await ribbon('psych','styles');
  await active('psych').locator('[data-ti-style-category="presets"]').click();await active('psych').locator('[data-ti-style-preset="card"]').click();
  const reflectionBefore=await editor('psych').locator('[data-playbook-node="psych-prompt"]:not([data-ti-response-type="score"])').evaluate(el=>el.outerHTML);
  await active('psych').locator('[data-ti-style-category="reset"]').click();await active('psych').locator('[data-ti-action="reset-style"]').click();
  assert.equal(await editor('psych').locator('[data-ti-response-type="score"]').getAttribute('data-ti-reflection-id'),singleScoreId);
  assert.equal(await editor('psych').locator('[data-ti-response-type="score"]').getAttribute('data-playbook-preset'),null);
  assert.equal(await editor('psych').locator('[data-playbook-node="psych-prompt"]:not([data-ti-response-type="score"])').evaluate(el=>el.outerHTML),reflectionBefore);
  await mapped('psych');assert.equal(await responses().count(),2);assert.equal(await saveResponses().textContent(),'Save responses');
  await responses().nth(0).fill('10');await responses().nth(1).fill('I waited for confirmation.');await save();
  assert.ok((await state()).checks.some(row=>row.criterion_key.endsWith(singleScoreId)&&JSON.parse(row.comment).value===10));
  assert.ok((await state()).checks.some(row=>row.comment==='I waited for confirmation.'));
  assert.equal(await page.locator('#executionMapScore').textContent(),'100.0%');
  assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'10 / 10 points · 1 of 1 scored.');
  assert.equal(await page.locator('#executionMapConditionScore').isVisible(),false);
  await snapshot('mixed-score-reflection');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await responses().first().evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await snapshot('scores-mobile');
  await page.setViewportSize({width:1823,height:1000});
  pass('A single characteristic becomes a Score, coexists with a written reflection, survives Reset Selected and fits mobile width without changing compliance scoring');

  await page.locator('#executionBackToInstrumentsBtn').click();await open('psych');
  await put('psych','<p>Discipline</p><p>Patience</p><p>Accountability</p>');
  await editor('psych').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);instrumentRestoreRange('psych',range);refreshSecondaryStyleControls('psych')});
  await ribbon('psych','home');await active('psych').locator(config.psych.functions).selectOption('score');await mapped('psych');
  for(const [index,value] of ['10','10','8'].entries())await responses().nth(index).fill(value);
  assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');await save();
  await page.reload({waitUntil:'load'});await hydrate();await page.evaluate(()=>{executionMappingActiveInstrument='psych';navigate('execution')});
  assert.deepEqual(await responses().evaluateAll(nodes=>nodes.map(node=>node.value)),['10','10','8']);
  assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');assert.equal(await page.locator('#executionMapScoreMeta').textContent(),'28 / 30 points · 3 of 3 scored.');
  assert.equal(await page.locator('#executionMapConditionScore').isVisible(),false);await snapshot('saved-28-of-30');
  pass('The requested 10 + 10 + 8 example saves per trade and restores 28/30 = 93.3% after a full reload');

  await page.locator('#executionBackToInstrumentsBtn').click();await open('psych');
  await editor('psych').evaluate(el=>{el.insertAdjacentHTML('beforeend','<div data-playbook-node="choice" class="pb-doc-choice"><div class="pb-doc-choice-options"><div class="pb-doc-choice-option"><span data-choice-option>Balance</span></div><div class="pb-doc-choice-option"><span data-choice-option>Imbalance</span></div></div></div>');el.dispatchEvent(new Event('input',{bubbles:true}))});
  await mapped('psych');const choices=page.locator('#executionMapFormBody input[type="radio"]');
  assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');assert.equal(await page.locator('#executionMapConditionScore').textContent(),'Conditions: 0.0% · 0 of 1 met.');
  await choices.first().check();assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');assert.equal(await page.locator('#executionMapConditionScore').textContent(),'Conditions: 100.0% · 1 of 1 met.');
  await choices.last().check();assert.deepEqual(await choices.evaluateAll(nodes=>nodes.map(node=>node.checked)),[false,true]);assert.equal(await page.locator('#executionMapScore').textContent(),'93.3%');
  await snapshot('scores-with-exclusive-choice');
  pass('Either / Or remains exclusive and keeps its compliance percentage separate from the 28/30 Score total');
  assert.deepEqual(errors,[]);pass('No browser console or JavaScript runtime errors');
  console.log(checks+' reflection browser scenarios passed');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
