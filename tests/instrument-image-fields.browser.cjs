// Run with Playwright installed: node tests/instrument-image-fields.browser.cjs
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
const examples=[
  {label:'4H balance / imbalance',timeframe:'4H',stage:'context',prompt:'Show the active 4H imbalance or balance range.'},
  {label:'30min market structure',timeframe:'30min',stage:'structure',prompt:'Show the structure within the 4H context.',related:0},
  {label:'5min "entry" <signal> & confirmation',timeframe:'5min',stage:'entry',prompt:'Mark entry <confirmation> & risk.',related:1},
  {label:'Exit condition / rule',timeframe:'5min',stage:'exit',prompt:'Show why this trade should close.',related:2}
];
const fixture=examples.map((_,i)=>'<h2>Stage '+(i+1)+'</h2><p id="field-anchor-'+i+'">Define the analysis here.</p>').join('')+'<ul id="field-rules"><li>Wait for confirmation</li><li>Respect planned risk</li></ul><div class="pb-doc-choice" data-playbook-node="choice"><b data-choice-title>Market context</b><div class="pb-doc-choice-options"><div><span data-choice-option>Balance</span></div><div><span data-choice-option>Imbalance</span></div></div></div>';
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(configs[kind].page);
const editor=kind=>active(kind).locator(configs[kind].editor);
const fields=kind=>editor(kind).locator('[data-playbook-node="image-field"]');
const form=()=>page.locator('#instrumentImageFieldForm');
async function select(kind,selector){
  await editor(kind).locator(selector).click();
  await editor(kind).locator(selector).evaluate(el=>{
    el.closest('[contenteditable="true"]').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  });
}
async function openField(kind,index){
  await select(kind,'#field-anchor-'+index);
  await active(kind).locator('['+configs[kind].prefix+'-ribbon="insert"]').click();
  await active(kind).locator('['+configs[kind].prefix+'-insert="image-field"]').click();
  await page.locator('#instrumentImageFieldModal.open').waitFor();
}
async function fillField(value,relatedId=''){
  await form().locator('[name="label"]').fill(value.label);await form().locator('[name="timeframe"]').fill(value.timeframe);
  await form().locator('[name="stage"]').selectOption(value.stage);await form().locator('[name="prompt"]').fill(value.prompt);
  await form().locator('[name="related"]').selectOption(relatedId);await form().locator('[type="submit"]').click();
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
    page=await browser.newPage({viewport:{width:1700,height:1150}});page.setDefaultTimeout(10000);
    const errors=[];let chooserCount=0;
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('filechooser',()=>chooserCount++);
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    for(const kind of ['playbook','checklist','psych']){
      await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      await editor(kind).evaluate((el,html)=>{el.innerHTML=html;el.dispatchEvent(new Event('input',{bubbles:true}))},fixture);
      const ids=[];
      for(let i=0;i<examples.length;i++){
        await openField(kind,i);await fillField(examples[i],i?ids[i-1]:'');
        const block=fields(kind).nth(i);assert.equal(await block.evaluate(el=>el.previousElementSibling.id),'field-anchor-'+i,'Modal preserves selected insertion point');
        ids.push(await block.getAttribute('data-ti-image-field-id'));
        assert.equal(await block.getAttribute('data-ti-image-field-timeframe'),examples[i].timeframe);assert.equal(await block.getAttribute('data-ti-image-field-stage'),examples[i].stage);
        assert.equal(await block.getAttribute('data-ti-image-field-related'),i?ids[i-1]:'');
        const model=active(kind).locator(configs[kind].preview).locator('[data-playbook-node="image-field"]').nth(i);
        assert.equal(await model.getAttribute('data-ti-image-field-id'),ids[i]);assert.equal(await model.locator('.ti-image-field-name').textContent(),examples[i].label);
        assert.equal(await model.locator('.ti-image-field-prompt').textContent(),examples[i].prompt);
        if(i)assert.equal(await model.locator('[data-ti-image-field-related-label]').textContent(),'Related to: '+examples[i-1].label);
        assert.equal(await model.locator('input[type="file"],img,button').count(),0,'Preview is a design field, not a trade upload');
      }
      assert.equal(new Set(ids).size,4);assert.equal(chooserCount,0);
      pass(kind+' 4H → 30min → 5min → exit design fields, selection preservation and immediate Live Model');
      const renamed='4H context <range> & bias';
      await fields(kind).first().locator('[data-ti-image-field-edit]').click();await form().locator('[name="label"]').fill(renamed);await form().locator('[type="submit"]').click();
      assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-id'),ids[0]);
      assert.equal(await fields(kind).nth(1).locator('[data-ti-image-field-related-label]').textContent(),'Related to: '+renamed);
      assert.equal(await active(kind).locator(configs[kind].preview).locator('[data-ti-image-field-related-label]').nth(1).textContent(),'Related to: '+renamed);
      pass(kind+' editing keeps stable identity, updates relationships, and safely renders special characters');
      await fields(kind).first().locator('[data-ti-image-field-edit]').click();await form().locator('[name="related"]').selectOption(ids[1]);await form().locator('[type="submit"]').click();
      assert.match(await form().locator('[data-image-field-error]').textContent(),/loop/);assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-related'),'');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#instrumentImageFieldModal').getAttribute('aria-hidden'),'true');
      await openField(kind,0);
      await form().locator('[data-image-field-close]').click();assert.equal(await fields(kind).count(),4);
      pass(kind+' relationship cycle guard, Escape and cancel create no extra fields');
      await page.waitForFunction(kind=>{const state=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return state?.textContent==='Saved'},kind);
      const stored=await page.evaluate(kind=>{const key=kind==='playbook'?playbookDocumentKey():secondaryStoreKey(kind),id=instrumentImageDocumentId(kind);return JSON.parse(localStorage.getItem(key)).find(doc=>doc.id===id).documentHtml},kind);
      for(const id of ids)assert.ok(stored.includes(id));assert.ok(stored.includes('data-ti-image-field-timeframe="4H"'));assert.ok(stored.includes('data-ti-image-field-related="'+ids[2]+'"'));
      pass(kind+' autosave stores field identity, definitions and relationships inside document HTML');
      await active(kind).locator(configs[kind].save).click();const originalId=await page.evaluate(kind=>instrumentImageDocumentId(kind),kind);
      await active(kind).locator(configs[kind].create).click();assert.equal(await fields(kind).count(),0);
      await editor(kind).locator('p').first().click();await active(kind).locator('['+configs[kind].prefix+'-ribbon="insert"]').click();await active(kind).locator('['+configs[kind].prefix+'-insert="image-field"]').click();
      assert.equal(await form().locator('[name="related"] option').count(),1,'Relationships are confined to this document');
      assert.equal(await form().locator('[required]').count(),0);
      await form().locator('[type="submit"]').click();assert.equal(await fields(kind).count(),1);
      const unnamedId=await fields(kind).first().getAttribute('data-ti-image-field-id');
      assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-label'),'');
      assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-timeframe'),'');assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-prompt'),'');
      const blankModel=active(kind).locator(configs[kind].preview).locator('[data-ti-image-field-id="'+unnamedId+'"]');
      assert.equal(await blankModel.locator('.ti-image-field-name').textContent(),'');assert.equal(await blankModel.locator('.ti-image-field-meta,.ti-image-field-prompt').count(),0);
      pass(kind+' inserts a picture field with untouched defaults and no required name, timeframe, stage or description');
      await fields(kind).first().locator('[data-ti-image-field-edit]').click();
      assert.equal(await form().locator('[name="label"]').inputValue(),'');assert.equal(await form().locator('[name="timeframe"]').inputValue(),'');
      await form().locator('[name="label"]').fill('   ');await form().locator('[type="submit"]').click();
      assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-id'),unnamedId);assert.equal(await fields(kind).first().getAttribute('data-ti-image-field-label'),'');
      await select(kind,'p:last-child');await active(kind).locator('['+configs[kind].prefix+'-insert="image-field"]').click();
      assert.equal(await form().locator('[name="related"] option').last().textContent(),'Picture field 1');
      await form().locator('[name="related"]').selectOption(unnamedId);await form().locator('[type="submit"]').click();
      const anonymousIds=await fields(kind).evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldId));
      assert.equal(new Set(anonymousIds).size,2);assert.equal(await fields(kind).last().locator('[data-ti-image-field-related-label]').textContent(),'Related to: Picture field 1');
      assert.deepEqual(await fields(kind).evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldLabel)),['','']);
      await page.waitForFunction(kind=>{const state=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return state?.textContent==='Saved'},kind);
      const anonymousHtml=await page.evaluate(kind=>{const key=instrumentImageScope(kind),id=instrumentImageDocumentId(kind);return JSON.parse(localStorage.getItem(key)).find(doc=>doc.id===id).documentHtml},kind);
      assert.equal((anonymousHtml.match(/data-ti-image-field-label=""/g)||[]).length,2);
      await active(kind).locator(configs[kind].save).click();await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      assert.deepEqual(await fields(kind).evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldId)),anonymousIds);
      assert.deepEqual(await fields(kind).evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldLabel)),['','']);
      assert.equal(await fields(kind).last().getAttribute('data-ti-image-field-related'),unnamedId);
      pass(kind+' editing, relationships, autosave, manual Save and reload preserve unnamed fields without adding titles');
      await active(kind).locator(kind==='playbook'?'#playbookPreviewOpenExecutionBtn':'[data-ti-action="preview"]').click();
      const anonymousMapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
      assert.deepEqual(await anonymousMapped.locator('[data-playbook-node="image-field"]').evaluateAll(nodes=>nodes.map(node=>[node.dataset.tiImageFieldId,node.dataset.tiImageFieldLabel])),anonymousIds.map(id=>[id,'']));
      assert.deepEqual(await anonymousMapped.locator('.ti-image-field-name').allTextContents(),['','']);assert.equal(await anonymousMapped.locator('.ti-image-field-meta,.ti-image-field-prompt').count(),0);
      await page.locator('#executionBackToInstrumentsBtn').click();
      pass(kind+' unnamed picture fields map into Execution Quality without invented titles or context');
      await active(kind).locator(configs[kind].picker).selectOption(originalId);
      await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind==='playbook'?'checklist':'playbook'),kind);await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind),kind);
      await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      assert.deepEqual(await fields(kind).evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldId)),ids);
      assert.equal(await fields(kind).nth(3).getAttribute('data-ti-image-field-related'),ids[2]);
      pass(kind+' manual Save, separate documents/builders and reload preserve all field definitions');
      if(kind==='playbook'&&process.env.TIOS_TEST_SCREENSHOT){await active(kind).locator('[data-playbook-ribbon="insert"]').click();await editor(kind).locator('#field-anchor-0').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TIOS_TEST_SCREENSHOT})}
      await active(kind).locator(kind==='playbook'?'#playbookPreviewOpenExecutionBtn':'[data-ti-action="preview"]').click();
      const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
      assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);assert.deepEqual(await mapped.locator('[data-playbook-node="image-field"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiImageFieldId)),ids);
      assert.equal(await mapped.locator('input[type="checkbox"]').count(),2,'Image fields do not become conditions');assert.equal(await mapped.locator('input[type="file"]').count(),0);
      const radios=mapped.locator('input[type="radio"]');await radios.nth(0).check();await radios.nth(1).check();assert.equal(await radios.nth(0).isChecked(),false);
      assert.equal(await mapped.locator('[data-ti-image-field-related-label]').nth(3).textContent(),'Related to: '+examples[2].label);
      await page.locator('#executionBackToInstrumentsBtn').click();
      pass(kind+' separate Execution Quality design mapping, unchanged conditions and Either / Or');
      await fields(kind).nth(2).locator('[aria-label="Remove image field"]').click();assert.equal(await fields(kind).count(),3);
      assert.equal(await fields(kind).nth(2).getAttribute('data-ti-image-field-id'),ids[3]);assert.equal(await fields(kind).nth(2).locator('[data-ti-image-field-related-label]').textContent(),'Related to: Unavailable image field');
      pass(kind+' removal affects only the chosen field and exposes an unavailable relationship');
    }
    await page.evaluate(()=>switchTechnicalInstrumentBuilder('playbook'));
    await fields('playbook').first().locator('[data-ti-image-field-edit]').click();await form().locator('[name="label"]').fill('Wrong document edit');
    await page.evaluate(()=>createPlaybookDocument());await form().locator('[type="submit"]').click();assert.equal(await fields('playbook').count(),0);
    pass('Switching document while a field modal is open cannot write into another document');
    await page.setViewportSize({width:390,height:844});await editor('playbook').click();await active('playbook').locator('[data-playbook-ribbon="insert"]').click();await active('playbook').locator('[data-playbook-insert="image-field"]').click();
    const modal=page.locator('#instrumentImageFieldModal .modal-card'),box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
    await form().locator('[type="submit"]').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('[data-image-field-close]').first().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');
    pass('Phone-sized design modal fits and supports keyboard focus and cancellation');
    assert.equal(chooserCount,0);assert.deepEqual(errors,[]);pass('Design fields open no file chooser and produce no JavaScript errors');
    console.log(checks+' image-field browser checks passed');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
