// Run with Playwright installed: node tests/instrument-images.browser.cjs
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
const fixture='<h2>Image QA</h2><p id="image-anchor">Reference context</p><ul id="image-rules"><li>Wait for confirmation</li><li>Respect planned risk</li></ul>'+ 
  '<div class="pb-doc-choice" data-playbook-node="choice"><b data-choice-title>Market context</b><div class="pb-doc-choice-options"><div><span data-choice-option>Balance</span></div><div><span data-choice-option>Imbalance</span></div></div></div><p id="image-last">End</p>';
let page,checks=0;
const pass=s=>{checks++;console.log('PASS '+s)};
const active=kind=>page.locator(configs[kind].page);
const editor=kind=>active(kind).locator(configs[kind].editor);
const figures=kind=>editor(kind).locator('[data-playbook-node="image"]');
async function select(kind,selector){
  await editor(kind).locator(selector).click();
  await editor(kind).locator(selector).evaluate(el=>{
    el.closest('[contenteditable="true"]').focus();
    const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
    const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  });
}
async function upload(kind,file){
  await active(kind).locator('['+configs[kind].prefix+'-ribbon="insert"]').click();
  const choose=page.waitForEvent('filechooser');
  await active(kind).locator('['+configs[kind].prefix+'-insert="image"]').click();
  await (await choose).setFiles(file);
}
async function loaded(locator){
  await locator.first().waitFor();
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].every(img=>img.complete&&img.naturalWidth>0),await locator.evaluateAll(els=>els.map(el=>{
    const figure=el.closest('figure');return '[data-playbook-image-key="'+figure.dataset.playbookImageKey+'"] [data-ti-reference-image]';
  })).then(selectors=>selectors.join(',')));
}
async function saveHtml(kind){
  await active(kind).locator(configs[kind].save).click();
  return page.evaluate(kind=>{
    const key=kind==='playbook'?playbookDocumentKey():secondaryStoreKey(kind),id=kind==='playbook'?selectedPlaybookDocumentId:secondaryState(kind).selectedId;
    return JSON.parse(localStorage.getItem(key)).find(doc=>doc.id===id).documentHtml;
  },kind);
}
async function run(){
  const server=http.createServer((req,res)=>{
    const filename=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'text/html');
    const source=fs.readFileSync(filename);
    res.end(filename.endsWith('t-ios.html')?source.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^\"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const errors=[];
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
    const context=await browser.newContext({viewport:{width:1700,height:1150}});page=await context.newPage();page.setDefaultTimeout(10000);
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    const base64=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=640;c.height=320;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,640,320);ctx.fillStyle='#16354e';ctx.font='24px Arial';ctx.fillText('Reference setup',24,45);ctx.strokeStyle='#169878';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(30,250);ctx.lineTo(210,160);ctx.lineTo(350,210);ctx.lineTo(580,75);ctx.stroke();return c.toDataURL('image/png').split(',')[1];
    });
    const image={name:'reference.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')};
    for(const kind of ['playbook','checklist','psych']){
      await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      await editor(kind).evaluate((el,html)=>{el.innerHTML=html;el.dispatchEvent(new Event('input',{bubbles:true}))},fixture);
      await select(kind,'#image-anchor');await upload(kind,image);
      await loaded(figures(kind).locator('img'));assert.equal(await figures(kind).count(),1);
      assert.equal(await figures(kind).evaluate(el=>el.previousElementSibling.id),'image-anchor','Ribbon/file chooser preserves insertion point');
      await loaded(active(kind).locator(configs[kind].preview).locator('[data-ti-reference-image]'));
      pass(kind+' upload at selected context and immediate Live Model');
      await select(kind,'#image-rules li:first-child');
      await active(kind).locator('['+configs[kind].prefix+'-ribbon="styles"]').click();
      await active(kind).locator('['+configs[kind].prefix+'-list-layout="columns-2"]').click();
      for(const [property,value,category] of [['align','center','alignment'],['spacing','relaxed','spacing'],['border','strong','borders'],['preset','card','presets']]){
        await active(kind).locator('['+configs[kind].prefix+'-style-category="'+category+'"]').click();
        await active(kind).locator('['+configs[kind].prefix+'-style-'+property+'="'+value+'"]').click();
      }
      await active(kind).locator('['+configs[kind].prefix+'-style-category="colors"]').click();
      await active(kind).locator('['+configs[kind].prefix+'-style-color="border"]').evaluate(el=>{el.value='#0066ff';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      assert.equal(await editor(kind).locator('#image-rules').getAttribute('data-playbook-preset'),'card');
      pass(kind+' images coexist with layout, alignment, spacing, borders, presets and custom colors');
      const caption='Valid example <setup> & "confirmation"';
      await figures(kind).locator('figcaption').fill(caption);
      await figures(kind).locator('[data-ti-reference-size="10"]').click();
      assert.equal(await figures(kind).getAttribute('data-playbook-image-width'),'85');
      await figures(kind).locator('[data-ti-reference-size="-10"]').click();
      const handle=figures(kind).locator('[data-ti-reference-resize]'),box=await handle.boundingBox();
      await page.mouse.move(box.x+8,box.y+8);await page.mouse.down();await page.mouse.move(box.x+65,box.y+8,{steps:5});await page.mouse.up();
      const width=Number(await figures(kind).getAttribute('data-playbook-image-width'));assert.ok(width>75&&width<=100);
      await handle.focus();await page.keyboard.press('ArrowLeft');assert.equal(Number(await figures(kind).getAttribute('data-playbook-image-width')),width-5);
      const savedWidth=String(width-5);
      const model=active(kind).locator(configs[kind].preview).locator('figure');
      assert.equal(await model.getAttribute('data-playbook-image-width'),savedWidth);assert.equal(await model.locator('figcaption').textContent(),caption);
      pass(kind+' caption, width buttons, dragging, keyboard resize and Live Model');
      await page.waitForFunction(kind=>{
        const saved=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return saved?.textContent==='Saved';
      },kind);
      const autosaved=await page.evaluate(kind=>{
        const key=kind==='playbook'?playbookDocumentKey():secondaryStoreKey(kind),id=instrumentImageDocumentId(kind);
        return JSON.parse(localStorage.getItem(key)).find(doc=>doc.id===id).documentHtml;
      },kind);
      assert.match(autosaved,new RegExp('data-playbook-image-width="'+savedWidth+'"'));assert.ok(autosaved.includes('Valid example &lt;setup&gt;'));
      pass(kind+' autosave persists image references, caption and width');
      if(kind==='playbook'&&process.env.TIOS_TEST_SCREENSHOT){
        await active(kind).locator('[data-playbook-ribbon="insert"]').click();await figures(kind).first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TIOS_TEST_SCREENSHOT});
      }
      const html=await saveHtml(kind);assert.match(html,/data-playbook-image-key=/);assert.match(html,/data-playbook-image-width=/);assert.ok(!html.includes('data:image/'),'Document stores media references, not hydrated binary copies');assert.ok(!html.includes('data-playbook-image-hydrated'));
      const originalId=await page.evaluate(kind=>instrumentImageDocumentId(kind),kind);
      await active(kind).locator(configs[kind].create).click();assert.equal(await figures(kind).count(),0);
      await active(kind).locator(configs[kind].picker).selectOption(originalId);await loaded(figures(kind).locator('img'));
      await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind==='playbook'?'checklist':'playbook'),kind);
      await page.evaluate(kind=>switchTechnicalInstrumentBuilder(kind),kind);await loaded(figures(kind).locator('img'));
      await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);await loaded(figures(kind).locator('img'));
      assert.equal(await figures(kind).getAttribute('data-playbook-image-width'),savedWidth);assert.equal(await figures(kind).locator('figcaption').textContent(),caption);
      pass(kind+' manual save, document/builder switching and reload persistence');
      await active(kind).locator(kind==='playbook'?'#playbookPreviewOpenExecutionBtn':'[data-ti-action="preview"]').click();
      const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
      await loaded(mapped.locator('[data-ti-reference-image]'));assert.equal(await mapped.locator('figcaption').textContent(),caption);assert.equal(await mapped.locator('figure').getAttribute('data-playbook-image-width'),savedWidth);
      assert.equal(await mapped.locator('input[type="checkbox"]').count(),2,'Reference image does not create conditions');
      const styled=mapped.locator('.execution-map-rule-layout');assert.equal(await styled.getAttribute('data-playbook-list-layout'),'columns-2');assert.equal(await styled.getAttribute('data-playbook-align'),'center');assert.equal(await styled.getAttribute('data-playbook-spacing'),'relaxed');assert.equal(await styled.getAttribute('data-playbook-border'),'strong');assert.equal(await styled.getAttribute('data-playbook-preset'),'card');
      assert.equal(await styled.locator('.execution-map-rule').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(0, 102, 255)');
      const radios=mapped.locator('input[type="radio"]');await radios.nth(0).check();await radios.nth(1).check();assert.equal(await radios.nth(0).isChecked(),false);
      assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);
      await mapped.locator('img').click();assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'false');assert.equal(await page.locator('#playbookImageViewerImg').getAttribute('alt'),caption);await page.keyboard.press('Escape');
      await page.locator('#executionBackToInstrumentsBtn').click();
      pass(kind+' separate Execution Quality mapping, unchanged conditions, Either / Or and image viewer');
      await select(kind,'#image-last');
      await editor(kind).evaluate((el,base64)=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))},base64);
      await page.waitForFunction(selector=>document.querySelectorAll(selector).length===2,configs[kind].page+' '+configs[kind].editor+' figure');await loaded(figures(kind).nth(1).locator('img'));
      await figures(kind).nth(1).locator('[aria-label="Remove reference image"]').click();assert.equal(await figures(kind).count(),1);assert.equal(await figures(kind).locator('figcaption').textContent(),caption);
      pass(kind+' clipboard image paste and removal affects only the selected image');
      await select(kind,'#image-last');await upload(kind,[{...image,name:'first.png'},{...image,name:'second.png'}]);
      await page.waitForFunction(selector=>document.querySelectorAll(selector).length===3,configs[kind].page+' '+configs[kind].editor+' figure');await loaded(figures(kind).locator('img'));
      const names=await figures(kind).evaluateAll(async els=>Promise.all(els.map(el=>getPlaybookMediaRecord(el.dataset.playbookImageKey).then(record=>record.name))));
      assert.deepEqual(names,['reference.png','first.png','second.png']);
      await figures(kind).nth(2).locator('[aria-label="Remove reference image"]').click();await figures(kind).nth(1).locator('[aria-label="Remove reference image"]').click();assert.equal(await figures(kind).count(),1);
      pass(kind+' multiple uploads preserve order and independent image controls');
      await select(kind,'#image-anchor');await upload(kind,{name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
      await page.waitForFunction(()=>!document.querySelector('#instrumentReferenceImageInput'));await page.waitForFunction(()=>document.body.textContent.includes('Could not decode image.'));
      assert.equal(await figures(kind).count(),1);pass(kind+' invalid image handled without changing the document');
      await page.evaluate(()=>{const original=storePlaybookDemoImage;window.originalImageStore=original;storePlaybookDemoImage=async(...args)=>{await new Promise(resolve=>window.releaseImageUpload=resolve);const key=await original(...args);window.imageUploadFinished=true;return key}});
      await select(kind,'#image-anchor');await upload(kind,image);await page.waitForFunction(()=>typeof window.releaseImageUpload==='function');
      await active(kind).locator(configs[kind].create).click();await page.evaluate(()=>window.releaseImageUpload());await page.waitForFunction(()=>window.imageUploadFinished===true);
      await page.waitForFunction(()=>document.body.textContent.includes('The document or insertion point changed.'));
      assert.equal(await figures(kind).count(),0);await page.evaluate(()=>{storePlaybookDemoImage=window.originalImageStore;delete window.releaseImageUpload;delete window.imageUploadFinished});
      await active(kind).locator(configs[kind].picker).selectOption(originalId);await loaded(figures(kind).locator('img'));assert.equal(await figures(kind).count(),1);
      pass(kind+' asynchronous upload cannot modify a different document');
      await saveHtml(kind);
      const record=await figures(kind).evaluate(el=>getPlaybookMediaRecord(el.dataset.playbookImageKey));
      await page.evaluate(key=>deletePlaybookMediaRecord(key),record.key);
      await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      await page.waitForFunction(selector=>document.querySelector(selector)?.textContent==='Image unavailable on this device',configs[kind].page+' '+configs[kind].editor+' .ti-reference-image-status');
      assert.equal(await figures(kind).locator('figcaption').textContent(),caption);assert.equal(await figures(kind).getAttribute('data-playbook-image-width'),savedWidth);
      await page.evaluate(record=>savePlaybookMediaRecord(record),record);await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);await loaded(figures(kind).locator('img'));
      pass(kind+' unavailable media preserves caption and layout; restoring media rehydrates it');
    }
    assert.deepEqual(errors,[]);pass('no JavaScript console/runtime errors');console.log(checks+' browser checks passed');
  }finally{await browser?.close();server.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
