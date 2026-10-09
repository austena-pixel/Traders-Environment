// Run with Playwright installed: node tests/instrument-image-patterns.browser.cjs
// TIOS_TEST_BROWSER can point to an existing Chromium executable.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const configs={
  playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',prefix:'data-playbook',preview:'#playbookExecutionPreviewBody',save:'#playbookDraftSaveBtn',create:'#playbookDraftNewBtn',picker:'#playbookPreviewDocumentSelect'},
  checklist:{page:'#page-checklists',editor:'[data-ti-editor]',prefix:'data-ti',preview:'[data-ti-preview-body]',save:'[data-ti-action="save"]',create:'[data-ti-action="new"]',picker:'[data-ti-preview-select]'},
  psych:{page:'#page-reflections',editor:'[data-ti-editor]',prefix:'data-ti',preview:'[data-ti-preview-body]',save:'[data-ti-action="save"]',create:'[data-ti-action="new"]',picker:'[data-ti-preview-select]'}
};
const expectedDefaults={
  playbook:['Playbook','Define the market context, setup, entry and exit conditions that form your trading edge.'],
  checklist:['Rules','Define the conditions, boundaries and actions that should be checked for each trade.'],
  psych:['Psychological Reflection','Define how behaviour, decisions and state of mind should be reviewed after execution.']
};
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(configs[kind].page);
const editor=kind=>active(kind).locator(configs[kind].editor);
const field=(kind,id)=>editor(kind).locator('[data-ti-image-field-id="'+id+'"]');
const model=(kind,id)=>active(kind).locator(configs[kind].preview).locator('[data-ti-image-field-id="'+id+'"]');
const form=()=>page.locator('#instrumentImageFieldForm');
const rows=()=>form().locator('[data-image-pattern-row]');
async function switchBuilder(kind){await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind)}
async function openDesign(kind,selection,label){
  await editor(kind).locator('#pattern-anchor').click();
  await editor(kind).locator('#pattern-anchor').evaluate(el=>{
    el.closest('[contenteditable="true"]').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  });
  await active(kind).locator('['+configs[kind].prefix+'-ribbon="insert"]').click();
  await active(kind).locator('['+configs[kind].prefix+'-insert="image-field"]').click();
  assert.equal(await page.locator('#instrumentImageFieldModal.open').count(),0);
  const id=await editor(kind).locator('#pattern-anchor').evaluate(el=>el.nextElementSibling.dataset.tiImageFieldId);
  assert.equal(await field(kind,id).getAttribute('data-ti-image-field-label'),'');assert.equal(await field(kind,id).getAttribute('data-ti-image-field-selection'),'capture');
  await field(kind,id).locator('[data-ti-image-field-edit]').click();
  await form().locator('[name="label"]').fill(label);await form().locator('[name="selection"]').selectOption(selection);
  return id;
}
async function upload(index,picture){
  await rows().nth(index).locator('[data-image-pattern-file]').setInputFiles(picture);
  await rows().nth(index).locator('img[src]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#instrumentImageFieldForm [type="submit"]').disabled);
}
async function waitSaved(kind){
  await page.waitForFunction(kind=>{const el=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return el?.textContent==='Saved'},kind);
}
async function savedHtml(kind){return page.evaluate(kind=>{const key=instrumentImageScope(kind),id=instrumentImageDocumentId(kind);return JSON.parse(localStorage.getItem(key)).find(item=>item.id===id).documentHtml},kind)}
async function assertScore(followed,total){
  assert.equal(await page.locator('#executionMapScore').textContent(),(followed/total*100).toFixed(1)+'%');
  assert.match(await page.locator('#executionMapScoreMeta').textContent(),new RegExp('^'+followed+' of '+total+' planned conditions? met'));
}
async function screenshot(name){
  if(!process.env.TIOS_TEST_SCREENSHOT_DIR)return;
  fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});
  await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')});
}
async function run(){
  const server=http.createServer((req,res)=>{
    const filename=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'text/html');
    const source=fs.readFileSync(filename,'utf8');res.end(filename.endsWith('t-ios.html')?source.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^\"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
    page=await browser.newPage({viewport:{width:1700,height:1150},hasTouch:true});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);
      assert.deepEqual(await editor(kind).locator('h2').allTextContents(),[]);
      assert.deepEqual(await editor(kind).locator('p').allTextContents(),['']);
      await screenshot(kind+'-default');
      pass(kind+' starts with a blank ordinary writing paragraph');
    }
    for(const kind of ['playbook','checklist']){
      await page.evaluate(kind=>{
        const key=instrumentImageScope(kind),starter=INSTRUMENT_STARTER_DOCUMENTS[kind];
        const docs=[
          {id:'untouched_'+kind,name:'Untouched',documentHtml:starter.previous},
          {id:'edited_'+kind,name:'Edited',documentHtml:starter.previous+'<p>My custom instruction.</p>'},
          {id:'formatted_'+kind,name:'Formatted',documentHtml:starter.previous.replace('<h2>','<h2 style="text-align:center">')}
        ];
        localStorage.setItem(key,JSON.stringify(docs));localStorage.setItem(key+':selected',docs[0].id);
        if(kind==='playbook')playbookDocumentStoreKey=null;else secondaryState(kind).storeKey=null;
      },kind);
      await switchBuilder(kind);
      const migrated=await page.evaluate(kind=>JSON.parse(localStorage.getItem(instrumentImageScope(kind))),kind);
      assert.equal(migrated[0].documentHtml,'<h2>'+expectedDefaults[kind][0]+'</h2><p>'+expectedDefaults[kind][1]+'</p>');
      assert.match(migrated[1].documentHtml,/My custom instruction/);assert.match(migrated[1].documentHtml,/Trading Method|reusable trading rules/);
      assert.match(migrated[2].documentHtml,/style="text-align:center"/);assert.match(migrated[2].documentHtml,/Trading Method|reusable trading rules/);
      pass(kind+' migrates and persists only exact untouched starter content');
    }
    const pictureData=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=170;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#142c42';ctx.fillRect(0,0,320,170);ctx.strokeStyle='#62c7ad';ctx.lineWidth=4;
      ctx.beginPath();ctx.moveTo(15,140);ctx.lineTo(70,110);ctx.lineTo(120,130);ctx.lineTo(170,65);ctx.lineTo(220,85);ctx.lineTo(300,20);ctx.stroke();
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const picture={name:'representative-pattern.png',mimeType:'image/png',buffer:Buffer.from(pictureData,'base64')};
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);await active(kind).locator(configs[kind].create).click();
      await editor(kind).evaluate(el=>{el.innerHTML='<h2>Pattern design</h2><p id="pattern-anchor">Select a representative setup.</p><ul><li>Respect planned risk</li></ul><div class="pb-doc-note" data-playbook-node="psych-prompt"><p>Reflect on the decision.</p></div>';el.dispatchEvent(new Event('input',{bubbles:true}))});
      await openDesign(kind,'choice','Entry pattern');assert.equal(await rows().count(),2);
      await rows().nth(0).locator('[data-image-pattern-label]').fill('Pattern 1: <reversal> & "break"');
      await rows().nth(1).locator('[data-image-pattern-label]').fill('Pattern 2: continuation');
      await upload(0,picture);await upload(1,picture);
      if(kind==='playbook')await screenshot('image-pattern-designer');
      await form().locator('[type="submit"]').click();
      const choiceId=await editor(kind).locator('[data-playbook-node="image-field"]').getAttribute('data-ti-image-field-id');
      const patterns=JSON.parse(await field(kind,choiceId).getAttribute('data-ti-image-field-patterns'));
      assert.equal(new Set(patterns.map(item=>item.id)).size,2);assert.ok(patterns.every(item=>item.imageKey));
      assert.equal(await field(kind,choiceId).locator('input').count(),0,'The design stores definitions, not trade responses');
      await model(kind,choiceId).locator('img[src]').nth(1).waitFor();
      assert.deepEqual(await model(kind,choiceId).locator('.ti-image-pattern-label').allTextContents(),patterns.map(item=>item.label));
      const liveRadios=model(kind,choiceId).locator('input[type="radio"]');assert.deepEqual(await liveRadios.evaluateAll(inputs=>inputs.map(input=>input.disabled)),[true,true]);
      await model(kind,choiceId).locator('img').nth(0).click();await model(kind,choiceId).locator('img').nth(1).click();assert.deepEqual(await liveRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);
      assert.equal(await liveRadios.first().evaluate(el=>{el.focus();return el===document.activeElement}),false);
      pass(kind+' named representative pictures appear immediately, while Live Model cannot select or focus picture choices');
      await openDesign(kind,'check','Independent confirmations');await form().locator('[type="submit"]').click();
      const checkId=await editor(kind).locator('[data-ti-image-field-label="Independent confirmations"]').getAttribute('data-ti-image-field-id');
      const liveChecks=model(kind,checkId).locator('input[type="checkbox"]');assert.deepEqual(await liveChecks.evaluateAll(inputs=>inputs.map(input=>input.disabled)),[true,true]);
      await model(kind,checkId).locator('.ti-image-pattern').first().click();assert.deepEqual(await liveChecks.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);
      await waitSaved(kind);await page.evaluate(kind=>kind==='playbook'?renderPlaybookExecutionPreview():renderSecondaryPreview(kind),kind);
      assert.deepEqual(await liveChecks.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);
      await openDesign(kind,'choice','Another pattern group');await form().locator('[type="submit"]').click();
      const secondId=await editor(kind).locator('[data-ti-image-field-label="Another pattern group"]').getAttribute('data-ti-image-field-id');
      assert.equal(await model(kind,secondId).locator('input[type="radio"]').last().isDisabled(),true);
      pass(kind+' Live Model Check and separate Choice groups remain read-only through refreshes');
      await field(kind,choiceId).locator('[data-ti-image-field-edit]').click();await rows().last().locator('[data-image-pattern-remove]').click();
      await form().locator('[type="submit"]').click();assert.match(await form().locator('[data-image-field-error]').textContent(),/at least 2/);
      await form().locator('[data-image-pattern-add]').click();await rows().last().locator('[data-image-pattern-label]').fill('   ');
      await page.keyboard.press('Escape');assert.deepEqual(JSON.parse(await field(kind,choiceId).getAttribute('data-ti-image-field-patterns')),patterns);
      await field(kind,choiceId).locator('[data-ti-image-field-edit]').click();await form().locator('[name="selection"]').selectOption('capture');await form().locator('[type="submit"]').click();
      assert.equal(await model(kind,choiceId).locator('input').count(),0);assert.equal(await model(kind,choiceId).locator('.ti-image-field-placeholder').count(),1);
      await field(kind,choiceId).locator('[data-ti-image-field-edit]').click();await form().locator('[name="selection"]').selectOption('choice');await form().locator('[type="submit"]').click();
      assert.deepEqual(JSON.parse(await field(kind,choiceId).getAttribute('data-ti-image-field-patterns')),patterns);
      pass(kind+' validation, cancellation and mode changes preserve saved pattern definitions and images');
      const anonymous=[];
      for(const selection of ['choice','check']){
        await openDesign(kind,selection,'');
        assert.deepEqual(await rows().locator('[data-image-pattern-label]').evaluateAll(inputs=>inputs.map(input=>input.value)),['','']);
        assert.equal(await form().locator('[required]').count(),0);
        await upload(0,picture);await upload(1,picture);
        const id=await page.evaluate(()=>instrumentImageFieldModalContext.fieldId);
        await form().locator('[type="submit"]').click();
        const savedPatterns=JSON.parse(await field(kind,id).getAttribute('data-ti-image-field-patterns'));
        assert.equal(await field(kind,id).getAttribute('data-ti-image-field-label'),'');assert.deepEqual(savedPatterns.map(pattern=>pattern.label),['','']);
        assert.ok(savedPatterns.every(pattern=>pattern.imageKey));assert.equal(new Set(savedPatterns.map(pattern=>pattern.id)).size,2);
        await model(kind,id).locator('img[src]').nth(1).waitFor();
        const controls=model(kind,id).locator('input');assert.deepEqual(await controls.evaluateAll(inputs=>inputs.map(input=>input.getAttribute('aria-label'))),['Pattern 1','Pattern 2']);
        await model(kind,id).locator('img').nth(0).click();await model(kind,id).locator('img').nth(1).click();
        assert.deepEqual(await controls.evaluateAll(inputs=>inputs.map(input=>[input.disabled,input.checked])),[[true,false],[true,false]]);
        assert.equal(await model(kind,choiceId).locator('input[type="radio"]').first().isChecked(),false);
        anonymous.push({id,selection,patterns:savedPatterns});
      }
      pass(kind+' representative pictures need no names, and unnamed Choice and Check are also read-only in Live Model');
      await waitSaved(kind);const html=await savedHtml(kind);
      for(const pattern of patterns){assert.ok(html.includes(pattern.id));assert.ok(html.includes(pattern.imageKey))}
      for(const item of anonymous)for(const pattern of item.patterns){assert.ok(html.includes(pattern.id));assert.ok(html.includes(pattern.imageKey))}
      assert.ok(html.includes('data-ti-image-field-selection="choice"'));assert.equal(html.includes('data:image/'),false);
      assert.equal(html.includes('data-ti-image-pattern-response'),false,'Saved designs contain no execution responses');
      await active(kind).locator(configs[kind].save).click();const docId=await page.evaluate(kind=>instrumentImageDocumentId(kind),kind);
      await active(kind).locator(configs[kind].create).click();assert.equal(await editor(kind).locator('[data-playbook-node="image-field"]').count(),0);
      await active(kind).locator(configs[kind].picker).selectOption(docId);await switchBuilder(kind==='playbook'?'checklist':'playbook');await switchBuilder(kind);
      await page.reload({waitUntil:'load'});await switchBuilder(kind);
      assert.deepEqual(JSON.parse(await field(kind,choiceId).getAttribute('data-ti-image-field-patterns')),patterns);
      assert.equal(await field(kind,checkId).getAttribute('data-ti-image-field-selection'),'check');
      await field(kind,choiceId).locator('img[src]').nth(1).waitFor();await model(kind,choiceId).locator('img[src]').nth(1).waitFor();
      for(const item of anonymous){
        assert.equal(await field(kind,item.id).getAttribute('data-ti-image-field-label'),'');assert.equal(await field(kind,item.id).getAttribute('data-ti-image-field-selection'),item.selection);
        assert.deepEqual(JSON.parse(await field(kind,item.id).getAttribute('data-ti-image-field-patterns')),item.patterns);
        assert.equal(await model(kind,item.id).locator('.ti-image-field-name').textContent(),'');await model(kind,item.id).locator('img[src]').nth(1).waitFor();
        await field(kind,item.id).locator('[data-ti-image-field-edit]').click();assert.equal(await form().locator('[name="label"]').inputValue(),'');
        assert.deepEqual(await rows().locator('[data-image-pattern-label]').evaluateAll(inputs=>inputs.map(input=>input.value)),['','']);await page.keyboard.press('Escape');
      }
      pass(kind+' unnamed representative pictures retain empty labels, stable IDs and images through save, reload and editing');
      pass(kind+' autosave, manual Save, document/builder switching and reload keep modes, identities and picture keys');
      // Current reflection controls correctly require a selected trade.
      // Seed an isolated trade; this test never invokes database persistence.
      await page.evaluate(()=>{trades=[{id:'pattern-qa-trade',instrument:'QA market',direction:'Buy',trade_date:'2026-10-09',pnl:0}];executionMappingTradeId='pattern-qa-trade'});
      await active(kind).locator(kind==='playbook'?'#playbookPreviewOpenExecutionBtn':'[data-ti-action="preview"]').click();
      const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
      assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);
      const mappedChoice=mapped.locator('[data-ti-image-field-id="'+choiceId+'"]');await mappedChoice.locator('img[src]').nth(1).waitFor();
      assert.ok(await mappedChoice.locator('input[type="radio"]').first().evaluate(el=>el.getBoundingClientRect().width<=20),'Pattern controls retain their compact size inside the generated form');
      await assertScore(0,8);
      await mapped.locator('.execution-psych-prompt textarea').fill('Review response.');await assertScore(0,8);
      await mappedChoice.locator('img').first().click();await assertScore(1,8);await mappedChoice.locator('img').last().click();await assertScore(1,8);
      assert.equal(await mappedChoice.locator('input[type="radio"]').first().isChecked(),false);assert.equal(await mappedChoice.locator('input[type="radio"]').last().isChecked(),true);
      const choiceRadios=mappedChoice.locator('input[type="radio"]');
      await choiceRadios.last().click();assert.equal(await mappedChoice.locator('input[type="radio"]:checked').count(),0);await assertScore(0,8);
      await mappedChoice.locator('img').first().click();await mappedChoice.locator('img').first().click();
      assert.deepEqual(await choiceRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);await assertScore(0,8);
      await choiceRadios.first().focus();await page.keyboard.press('Space');await assertScore(1,8);
      await page.keyboard.press('Space');assert.equal(await choiceRadios.first().isChecked(),false);await assertScore(0,8);
      await choiceRadios.first().focus();await page.keyboard.press('ArrowRight');await assertScore(1,8);
      assert.deepEqual(await choiceRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,true]);
      await page.keyboard.press('Space');await assertScore(0,8);
      pass(kind+' picture Either / Or clears by radio, picture card and keyboard, keeps arrow navigation and updates scoring');
      const views=mappedChoice.locator('[data-ti-picture-view]');await views.first().waitFor();
      await views.first().click();assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'false');
      assert.equal(await page.locator('#playbookImageViewerImg').getAttribute('src'),await mappedChoice.locator('img').first().getAttribute('src'));
      assert.deepEqual(await choiceRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);await assertScore(0,8);
      await page.keyboard.press('Tab');assert.equal(await page.locator('[data-playbook-image-viewer-close]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape');assert.equal(await views.first().evaluate(el=>el===document.activeElement),true);
      await choiceRadios.last().click();await views.first().focus();await page.keyboard.press('Enter');await assertScore(1,8);
      assert.deepEqual(await choiceRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,true]);
      assert.equal(await page.locator('#playbookImageViewerImg').getAttribute('alt'),patterns[0].label);
      if(kind==='playbook')await screenshot('image-pattern-viewer');
      await page.locator('[data-playbook-image-viewer-close]').click();
      pass(kind+' View picture opens the matching image by mouse and keyboard, preserves empty or selected answers and restores focus');
      if(kind==='playbook'){
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(()=>{window.choicePointerTypes=[];document.querySelector('#executionMapFormBody').addEventListener('pointerdown',event=>window.choicePointerTypes.push(event.pointerType))});
        await choiceRadios.last().tap();await assertScore(0,8);
        await choiceRadios.last().tap();await assertScore(1,8);
        await views.first().tap();assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'false');await assertScore(1,8);
        assert.deepEqual(await choiceRadios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,true]);
        assert.equal(await page.evaluate(()=>window.choicePointerTypes.includes('touch')),true);
        const bounds=await page.locator('#playbookImageViewerImg').boundingBox();assert.ok(bounds.width<=390&&bounds.height<=844);
        const closeBounds=await page.locator('[data-playbook-image-viewer-close]').boundingBox();
        assert.ok(closeBounds.x>=0&&closeBounds.y>=0&&closeBounds.x+closeBounds.width<=390&&closeBounds.y+closeBounds.height<=844,'The whole Close control stays inside the phone viewport');
        await screenshot('image-pattern-viewer-mobile');await page.locator('[data-playbook-image-viewer-close]').tap();
        await page.setViewportSize({width:1700,height:1150});
        pass('Touch can clear and reselect an Either / Or picture, then open it without changing the answer on a narrow screen');
      }
      const mappedChecks=mapped.locator('[data-ti-image-field-id="'+checkId+'"] input[type="checkbox"]');
      await mappedChecks.first().check();await assertScore(2,8);await mappedChecks.last().check();await assertScore(3,8);
      await mappedChecks.first().uncheck();await assertScore(2,8);await mappedChecks.first().check();await assertScore(3,8);
      await mapped.locator('[data-ti-image-field-id="'+secondId+'"] input[type="radio"]').first().check();await assertScore(4,8);
      let followed=4;
      for(const item of anonymous){
        const mappedAnonymous=mapped.locator('[data-ti-image-field-id="'+item.id+'"]');
        assert.equal(await mappedAnonymous.getAttribute('data-ti-image-field-label'),'');await mappedAnonymous.locator('img[src]').nth(1).waitFor();
        assert.deepEqual(await mappedAnonymous.locator('.ti-image-pattern-label').allTextContents(),['','']);
        await mappedAnonymous.locator('img').nth(0).click();await assertScore(++followed,8);
        await mappedAnonymous.locator('img').nth(1).click();if(item.selection==='check')followed++;await assertScore(followed,8);
        assert.equal(await mappedAnonymous.locator('input').first().isChecked(),item.selection==='check');assert.equal(await mappedAnonymous.locator('input').last().isChecked(),true);
      }
      assert.equal(followed,7);await mapped.locator('.execution-map-rule-main > input[type="checkbox"]').check();await assertScore(8,8);
      assert.equal(await mappedChoice.locator('input[type="radio"]').last().isChecked(),true);
      const hiddenPreview=model(kind,choiceId).locator('input[type="radio"]');
      assert.equal(await hiddenPreview.first().isDisabled(),true);await hiddenPreview.first().evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))});
      await page.evaluate(()=>updateExecutionMappingScore());await assertScore(8,8);
      await page.evaluate(kind=>kind==='playbook'?renderPlaybookExecutionPreview():renderSecondaryPreview(kind),kind);assert.equal(await hiddenPreview.first().isChecked(),false);await assertScore(8,8);
      if(kind==='playbook')await screenshot('image-pattern-execution');
      await page.locator('#executionMapResetBtn').click();assert.equal(await mapped.locator('[data-ti-image-pattern-response]:checked').count(),0);await assertScore(0,8);
      await page.locator('#executionBackToInstrumentsBtn').click();
      pass(kind+' Execution Quality scores Choice once, each Check independently and normal rules, reaches 100%, ignores Live Model and resets to 0%');
    }
    await switchBuilder('playbook');await editor('playbook').locator('#pattern-anchor').waitFor();
    const cancelledId=await openDesign('playbook','choice','Cancelled uploads');
    const countBefore=await editor('playbook').locator('[data-playbook-node="image-field"]').count();
    await page.evaluate(()=>{
      window.originalPatternStore=storePlaybookDemoImage;
      storePlaybookDemoImage=async (...args)=>{const key=await window.originalPatternStore(...args);window.pendingPatternKey=key;await new Promise(resolve=>window.releasePatternUpload=resolve);return key};
    });
    await rows().first().locator('[data-image-pattern-file]').setInputFiles(picture);await page.waitForFunction(()=>window.pendingPatternKey);
    assert.equal(await form().locator('[type="submit"]').isDisabled(),true);await page.keyboard.press('Escape');
    await page.evaluate(()=>window.releasePatternUpload());
    await page.waitForFunction(async()=>!(await getPlaybookMediaRecord(window.pendingPatternKey)));
    await page.evaluate(()=>storePlaybookDemoImage=window.originalPatternStore);
    assert.equal(await editor('playbook').locator('[data-playbook-node="image-field"]').count(),countBefore);
    assert.equal(await field('playbook',cancelledId).getAttribute('data-ti-image-field-label'),'');assert.equal(await field('playbook',cancelledId).getAttribute('data-ti-image-field-selection'),'capture');
    pass('Cancelling settings during an asynchronous picture upload leaves the inserted field unchanged and removes the unused new image');
    const existing=editor('playbook').locator('[data-ti-image-field-label="Entry pattern"]');
    await existing.locator('[data-ti-image-field-edit]').click();const imageKey=JSON.parse(await existing.getAttribute('data-ti-image-field-patterns'))[0].imageKey;
    await rows().first().locator('[data-image-pattern-file]').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});
    await page.waitForFunction(()=>!document.querySelector('#instrumentImageFieldForm [type="submit"]').disabled);
    assert.ok(await form().locator('[data-image-field-error]').textContent());await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(key=>getPlaybookMediaRecord(key),imageKey));
    pass('A failed replacement leaves the existing representative picture intact');
    await page.setViewportSize({width:390,height:844});await existing.locator('[data-ti-image-field-edit]').click();
    const modal=page.locator('#instrumentImageFieldModal .modal-card'),box=await modal.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=390);assert.ok(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await screenshot('image-pattern-mobile');await page.keyboard.press('Escape');
    pass('Picture pattern designer fits a phone-sized viewport without horizontal overflow');
    assert.deepEqual(errors,[]);pass('No JavaScript or browser console errors');
    console.log(checks+' starter and image-pattern browser checks passed');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
