// Real picture uploads, selection, Functions, Live Model and Execution Quality.
// Run with Playwright installed; TIOS_TEST_BROWSER may select an existing Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const configs={
  playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',prefix:'data-playbook',functions:'#playbookBlockStyle',model:'#playbookExecutionPreviewBody',save:'#playbookDraftSaveBtn',open:'#playbookPreviewOpenExecutionBtn'},
  checklist:{page:'#page-checklists',editor:'[data-ti-editor]',prefix:'data-ti',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]'},
  psych:{page:'#page-reflections',editor:'[data-ti-editor]',prefix:'data-ti',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]'}
};
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(configs[kind].page),editor=kind=>active(kind).locator(configs[kind].editor),model=kind=>active(kind).locator(configs[kind].model);
const picture=(kind,key)=>editor(kind).locator('[data-playbook-node="image"][data-playbook-image-key="'+key+'"]');
const field=(kind,id)=>editor(kind).locator('[data-playbook-node="image-field"][data-ti-image-field-id="'+id+'"]');
const form=()=>page.locator('#instrumentImageFieldForm');
async function switchBuilder(kind){await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind)}
async function ribbon(kind,tab){await active(kind).locator('['+configs[kind].prefix+'-ribbon="'+tab+'"]').click()}
async function apply(kind,type){await ribbon(kind,'home');const select=active(kind).locator(configs[kind].functions);assert.equal(await select.isEnabled(),true);await select.focus();await select.selectOption(type)}
async function back(kind){await ribbon(kind,'home');const button=active(kind).locator('[data-instrument-back-to-text]');assert.equal(await button.isEnabled(),true);await button.click();assert.equal(await button.isDisabled(),true)}
async function selectPicture(kind,key,shift=false){await picture(kind,key).locator('img[src]').click({modifiers:shift?['Shift']:[]})}
async function waitImages(locator){await locator.locator('img[src]').last().waitFor();assert.ok(await locator.locator('img[src]').evaluateAll(nodes=>nodes.every(img=>img.complete&&img.naturalWidth>0)))}
async function saved(kind){await page.waitForFunction(kind=>{const state=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return state?.textContent==='Saved'},kind)}
async function fieldDesign(kind,index,selection='capture',pictureFile=null){
  await editor(kind).evaluate((el,index)=>{el.insertAdjacentHTML('beforeend','<p id="picture-field-anchor-'+index+'"><br></p>');el.dispatchEvent(new Event('input',{bubbles:true}))},index);
  await editor(kind).locator('#picture-field-anchor-'+index).click();await ribbon(kind,'insert');await active(kind).locator('['+configs[kind].prefix+'-insert="image-field"]').click();
  assert.equal(await page.locator('#instrumentImageFieldModal.open').count(),0);
  const id=await editor(kind).locator('#picture-field-anchor-'+index).evaluate(el=>el.nextElementSibling.dataset.tiImageFieldId);
  assert.equal(await field(kind,id).getAttribute('data-ti-image-field-label'),'');assert.equal(await field(kind,id).evaluate(el=>el.classList.contains('ti-picture-selected')),true);
  if(selection==='capture'&&!pictureFile)return id;
  await field(kind,id).locator('[data-ti-image-field-edit]').click();
  if(selection!=='capture')await form().locator('[name="selection"]').selectOption(selection);
  if(pictureFile)for(let i=0;i<2;i++){
    await form().locator('[data-image-pattern-file]').nth(i).setInputFiles(pictureFile);
    await form().locator('[data-image-pattern-row]').nth(i).locator('img[src]').waitFor();
    await page.waitForFunction(()=>!document.querySelector('#instrumentImageFieldForm [type="submit"]').disabled);
  }
  assert.equal(await page.evaluate(()=>instrumentImageFieldModalContext.fieldId),id);await form().locator('[type="submit"]').click();return id;
}
async function snapshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')})}}
async function run(){
  const server=http.createServer((req,res)=>{
    const filename=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'text/html');
    const source=fs.readFileSync(filename,'utf8');res.end(filename.endsWith('t-ios.html')?source.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^\"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
    page=await browser.newPage({viewport:{width:1700,height:1150}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=150;const x=c.getContext('2d');x.fillStyle='#16354e';x.fillRect(0,0,320,150);x.strokeStyle='#62c7ad';x.lineWidth=4;x.beginPath();x.moveTo(20,130);x.lineTo(80,60);x.lineTo(150,100);x.lineTo(220,30);x.lineTo(300,50);x.stroke();return c.toDataURL('image/png').split(',')[1]});
    const file={name:'raw-picture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);
      await editor(kind).evaluate(el=>{el.innerHTML='<p id="picture-anchor">My existing plan.</p><p id="picture-neighbor">Keep <b>this neighboring paragraph</b>.</p>';el.dispatchEvent(new Event('input',{bubbles:true}))});
      const neighbor=await editor(kind).locator('#picture-neighbor').evaluate(el=>el.outerHTML);
      await editor(kind).locator('#picture-anchor').click();await ribbon(kind,'insert');const chooser=page.waitForEvent('filechooser');await active(kind).locator('['+configs[kind].prefix+'-insert="image"]').click();await (await chooser).setFiles([file,{...file,name:'second-picture.png'}]);
      await page.waitForFunction(selector=>document.querySelectorAll(selector).length===2,configs[kind].page+' '+configs[kind].editor+' [data-playbook-node="image"]');
      await waitImages(editor(kind));const keys=await editor(kind).locator('[data-playbook-node="image"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.playbookImageKey));
      await selectPicture(kind,keys[0]);assert.equal(await editor(kind).locator('.ti-picture-selected').count(),1);assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'true');
      await ribbon(kind,'home');assert.equal(await active(kind).locator('[data-instrument-back-to-text]').isDisabled(),true);
      await apply(kind,'rule');assert.equal(await editor(kind).locator('[data-playbook-node="rule"] [data-playbook-image-key="'+keys[0]+'"]').count(),1);
      await waitImages(model(kind));assert.equal(await model(kind).locator('.playbook-preview-check [data-playbook-image-key="'+keys[0]+'"]').count(),1);
      assert.equal(await model(kind).locator('.ti-reference-image-tools,button').count(),0);
      assert.equal(await editor(kind).locator('#picture-neighbor').evaluate(el=>el.outerHTML),neighbor);
      assert.equal(await page.evaluate(kind=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML).find(item=>item.type==='check').label,kind),'');
      pass(kind+' a clicked raw picture becomes a Rule without text, metadata, image loss or neighboring changes');
      await active(kind).locator('['+configs[kind].prefix+'-command="undo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),0);
      assert.equal(await picture(kind,keys[0]).count(),1);await active(kind).locator('['+configs[kind].prefix+'-command="redo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),1);
      await selectPicture(kind,keys[0]);await back(kind);
      const expected={h1:'section',h2:'section',h3:'section',note:'note','psych-prompt':'psych-prompt',blockquote:'note',ul:'check',ol:'check'};
      for(const [type,itemType] of Object.entries(expected)){
        await selectPicture(kind,keys[0]);await apply(kind,type);await waitImages(model(kind));
        assert.ok(await page.evaluate(({kind,key,itemType})=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML).some(item=>item.type===itemType&&item.html?.includes(key)),{kind,key:keys[0],itemType}));
        assert.equal(await picture(kind,keys[0]).count(),1);await back(kind);assert.equal(await picture(kind,keys[0]).count(),1);
      }
      assert.equal(await editor(kind).locator('#picture-neighbor').evaluate(el=>el.outerHTML),neighbor);
      pass(kind+' Heading, Note, Reflection prompt, Quote and list functions preserve pictures; Back to text and Undo / Redo work');
      const caption='4H <balance> & "analysis"';await picture(kind,keys[0]).locator('figcaption').fill(caption);
      await selectPicture(kind,keys[0]);await apply(kind,'choice');assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0,'One picture cannot create an Either / Or group');
      await selectPicture(kind,keys[0]);await selectPicture(kind,keys[1],true);assert.equal(await editor(kind).locator('.ti-picture-selected').count(),2);
      await apply(kind,'choice');const choice=editor(kind).locator('[data-playbook-node="choice"]');assert.equal(await choice.locator('[data-choice-option]').count(),2);assert.equal(await choice.locator('[data-choice-title]').count(),0);
      const values=await choice.locator('[data-choice-option]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiChoiceOptionId));assert.equal(new Set(values).size,2);assert.ok(values.every(Boolean));
      await waitImages(model(kind));assert.equal(await model(kind).locator('.playbook-preview-choice [data-playbook-node="image"]').count(),2);
      assert.equal(await picture(kind,keys[0]).locator('figcaption').textContent(),caption);assert.equal(await picture(kind,keys[1]).locator('figcaption').textContent(),'');
      await ribbon(kind,'styles');await active(kind).locator('['+configs[kind].prefix+'-list-layout="columns-3"]').click();
      for(const [category,property,value] of [['alignment','align','center'],['spacing','spacing','relaxed'],['borders','border','strong'],['presets','preset','card']]){
        await active(kind).locator('['+configs[kind].prefix+'-style-category="'+category+'"]').click();await active(kind).locator('['+configs[kind].prefix+'-style-'+property+'="'+value+'"]').click();
      }
      await active(kind).locator('['+configs[kind].prefix+'-style-category="colors"]').click();await active(kind).locator('['+configs[kind].prefix+'-style-color="border"]').evaluate(el=>{el.value='#0066ff';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      const styled=choice.locator('.pb-doc-choice-options');for(const [property,value] of [['list-layout','columns-3'],['align','center'],['spacing','relaxed'],['border','strong'],['preset','card'],['color-border','#0066ff']])assert.equal(await styled.getAttribute('data-playbook-'+property),value);
      assert.equal(await model(kind).locator('.playbook-preview-choice-options').getAttribute('data-playbook-preset'),'card');await snapshot(kind+'-picture-functions');
      pass(kind+' Shift-click makes two unnamed pictures into Either / Or with independent option IDs, styles and custom color');
      await saved(kind);const html=await page.evaluate(kind=>{const id=instrumentImageDocumentId(kind);return JSON.parse(localStorage.getItem(instrumentImageScope(kind))).find(doc=>doc.id===id).documentHtml},kind);
      assert.ok(keys.every(key=>html.includes(key)));assert.ok(values.every(value=>html.includes(value)));assert.equal(/data:image\/|data-playbook-image-hydrated|ti-picture-selected/.test(html),false);
      await active(kind).locator(configs[kind].save).click();await switchBuilder(kind==='playbook'?'checklist':'playbook');await switchBuilder(kind);await page.reload({waitUntil:'load'});await switchBuilder(kind);
      await waitImages(editor(kind));assert.deepEqual(await choice.locator('[data-choice-option]').evaluateAll(nodes=>nodes.map(node=>node.dataset.tiChoiceOptionId)),values);assert.equal(await picture(kind,keys[0]).locator('figcaption').textContent(),caption);
      await active(kind).locator(configs[kind].open).click();const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');await waitImages(mapped);
      assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);const radios=mapped.locator('.execution-map-choice-options > label > input[type="radio"]');assert.deepEqual(await radios.evaluateAll(inputs=>inputs.map(input=>input.value)),values);
      await mapped.locator('.execution-map-choice-options img').first().click();assert.equal(await radios.first().isChecked(),true);await mapped.locator('.execution-map-choice-options img').last().click();assert.equal(await radios.first().isChecked(),false);assert.equal(await radios.last().isChecked(),true);
      assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'true');assert.equal(await mapped.locator('.execution-map-choice-options').getAttribute('data-playbook-color-border'),'#0066ff');
      if(kind==='playbook')assert.equal(await page.locator('#executionMapScore').textContent(),'100.0%');
      await mapped.locator('.execution-map-choice-options img').first().dblclick();assert.equal(await page.locator('#playbookImageViewer').getAttribute('aria-hidden'),'false');await page.keyboard.press('Escape');
      await page.locator('#executionMapResetBtn').click();assert.deepEqual(await radios.evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false]);
      await page.locator('#executionBackToInstrumentsBtn').click();
      pass(kind+' autosave, Save, builder switching and reload retain picture functions; mapped images select exclusively and open on double-click');
      await selectPicture(kind,keys[0]);await back(kind);assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);assert.equal(await model(kind).locator('.playbook-preview-choice').count(),0);
      assert.deepEqual(await editor(kind).locator('[data-playbook-node="image"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.playbookImageKey)),keys);assert.equal(await editor(kind).locator('#picture-neighbor').evaluate(el=>el.outerHTML),neighbor);
      pass(kind+' Back to text removes only the selected picture group and keeps both original pictures and captions');
      await editor(kind).evaluate((el,key)=>{
        const image=el.querySelector('[data-playbook-node="image"][data-playbook-image-key="'+key+'"]');
        const block=image.closest('[data-ti-text-block]')||image;
        block.insertAdjacentHTML('afterend','<p id="mixed-picture-words"><i>Already written words.</i></p>');el.dispatchEvent(new Event('input',{bubbles:true}));
        const range=document.createRange();range.setStartBefore(block);range.setEndAfter(el.querySelector('#mixed-picture-words'));el.focus();
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
      },keys[1]);
      await apply(kind,'choice');const mixed=editor(kind).locator('[data-playbook-node="choice"]');assert.equal(await mixed.locator('[data-choice-option]').count(),2);
      assert.equal(await mixed.locator('[data-playbook-image-key="'+keys[1]+'"]').count(),1);assert.equal(await mixed.locator('[data-choice-option] i').textContent(),'Already written words.');
      assert.equal(await model(kind).locator('.playbook-preview-choice img[src]').count(),1);assert.equal(await model(kind).locator('.playbook-preview-choice i').textContent(),'Already written words.');
      await back(kind);assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);assert.equal(await editor(kind).locator('i').textContent(),'Already written words.');
      assert.equal(await editor(kind).locator('#picture-neighbor').evaluate(el=>el.outerHTML),neighbor);
      pass(kind+' a normal highlighted range can combine pictures and existing formatted text without adding or removing information');
      const ids=[await fieldDesign(kind,0),await fieldDesign(kind,1)];
      await field(kind,ids[0]).locator('.ti-image-field-placeholder').click();await field(kind,ids[1]).locator('.ti-image-field-placeholder').click({modifiers:['Shift']});await apply(kind,'rule');
      assert.equal(await editor(kind).locator('[data-playbook-node="rule"] [data-playbook-node="image-field"]').count(),2);assert.equal(await model(kind).locator('.playbook-preview-check [data-playbook-node="image-field"]').count(),2);
      assert.deepEqual(await editor(kind).locator('[data-playbook-node="image-field"]').evaluateAll(nodes=>nodes.map(node=>[node.dataset.tiImageFieldId,node.dataset.tiImageFieldLabel])),ids.map(id=>[id,'']));
      await field(kind,ids[0]).locator('.ti-image-field-placeholder').click();await field(kind,ids[1]).locator('.ti-image-field-placeholder').click({modifiers:['Shift']});await apply(kind,'choice');
      assert.equal(await model(kind).locator('.playbook-preview-choice [data-playbook-node="image-field"]').count(),2);
      await field(kind,ids[0]).locator('[data-ti-image-field-edit]').click();assert.equal(await form().locator('[name="label"]').inputValue(),'');assert.equal(await form().locator('[required]').count(),0);await form().locator('[type="submit"]').click();
      pass(kind+' unnamed designed picture fields accept Rule and Either / Or without losing field identities or optional editing');
      const patternId=await fieldDesign(kind,2,'choice',file);await field(kind,patternId).locator('.ti-image-pattern-picture').first().click();await apply(kind,'rule');
      const patternModel=model(kind).locator('[data-ti-image-field-id="'+patternId+'"]');await waitImages(patternModel);const trial=patternModel.locator('[data-ti-image-pattern-response]');await trial.first().check();
      await active(kind).locator(configs[kind].open).click();const mappedPattern=mapped.locator('[data-ti-image-field-id="'+patternId+'"]');await waitImages(mappedPattern);
      const patternRadios=mappedPattern.locator('[data-ti-image-pattern-response]');assert.notEqual(await patternRadios.first().getAttribute('name'),await trial.first().getAttribute('name'));
      await mappedPattern.locator('img').last().click();assert.equal(await patternRadios.last().isChecked(),true);assert.equal(await patternRadios.first().isChecked(),false);assert.equal(await trial.first().isChecked(),true);
      assert.equal(await mappedPattern.evaluate(el=>el.closest('.execution-map-rule').querySelector('.execution-map-rule-main > input[type="checkbox"]').checked),false,'Trial pattern responses cannot mark the outer Rule as followed');
      await page.locator('#executionBackToInstrumentsBtn').click();await field(kind,patternId).locator('.ti-image-pattern-picture').first().click();await back(kind);assert.equal(await field(kind,patternId).getAttribute('data-ti-image-field-selection'),'choice');
      pass(kind+' picture-pattern definitions and Choice logic survive a function, stay independent between Live Model and Execution Quality, and return intact');
    }
    await switchBuilder('playbook');await page.setViewportSize({width:390,height:844});const first=editor('playbook').locator('[data-playbook-node="image"] img').first();await first.click();await ribbon('playbook','home');const control=active('playbook').locator(configs.playbook.functions);assert.equal(await control.isEnabled(),true);await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);await snapshot('picture-functions-mobile');pass('Picture selection and Functions remain usable on a phone');
    await page.locator('#playbookDraftTitle').click();assert.equal(await control.isDisabled(),true);assert.equal(await editor('playbook').locator('.ti-picture-selected').count(),0);pass('Leaving the editor clears picture selection and prevents stale ribbon operations');
    assert.deepEqual(errors,[]);pass('No browser console or JavaScript errors');console.log(checks+' picture-function browser checks passed');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
