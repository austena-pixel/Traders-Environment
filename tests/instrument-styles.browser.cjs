// Requires Playwright. Run: node tests/instrument-styles.browser.cjs
// Set TIOS_TEST_BROWSER to use an existing Chromium executable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const fixture = '<h2>Styles QA</h2><p id="unselected">Outside any structure</p>' +
  '<ul id="style-ul"><li>Context A</li><li>Context B</li><li>Context C</li></ul>' +
  '<ol id="style-ol"><li>Step A</li><li>Step B</li><li>Step C</li></ol>' +
  '<div class="pb-doc-choice" data-playbook-node="choice" id="style-choice">' +
  '<b data-choice-title>Market context</b><div class="pb-doc-choice-options">' +
  '<div class="pb-doc-choice-option"><span class="pb-doc-choice-dot"></span><span data-choice-option>Balance</span></div>' +
  '<div class="pb-doc-choice-option"><span class="pb-doc-choice-dot"></span><span data-choice-option>Imbalance</span></div>' +
  '</div></div><p>End</p>';
const configs = {
  playbook: { page:'#page-playbook', editor:'#playbookDocumentEditor', ribbon:'data-playbook-ribbon', prefix:'data-playbook', preview:'#playbookExecutionPreviewBody', save:'#playbookDraftSaveBtn' },
  checklist: { page:'#page-checklists', editor:'[data-ti-editor]', ribbon:'data-ti-ribbon', prefix:'data-ti', preview:'[data-ti-preview-body]', save:'[data-ti-action="save"]' },
  psych: { page:'#page-reflections', editor:'[data-ti-editor]', ribbon:'data-ti-ribbon', prefix:'data-ti', preview:'[data-ti-preview-body]', save:'[data-ti-action="save"]' }
};
let page;
let checks = 0;
const passed = text => { checks++; console.log('PASS ' + text); };
const active = kind => page.locator(configs[kind].page);
const styleButton = (kind, property, value) => active(kind).locator('[' + configs[kind].prefix + '-style-' + property + '="' + value + '"]');
const layoutButton = (kind, value) => active(kind).locator('button[' + configs[kind].prefix + '-list-layout="' + value + '"]');
async function select(kind, selector) {
  const editor = active(kind).locator(configs[kind].editor);
  await editor.locator(selector).first().click();
  // Position a real browser selection inside the clicked structure's text.
  await editor.locator(selector).first().evaluate(el => {
    const editor = el.closest('[contenteditable="true"]'); editor.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(text || el, 0); range.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}
async function styles(kind) { await active(kind).locator('[' + configs[kind].ribbon + '="styles"]').click(); }
async function setStyle(kind, property, value) {
  const button = styleButton(kind, property, value);
  assert.equal(await button.isEnabled(), true, kind + ' has an active style target');
  await button.click();
  assert.match(await button.getAttribute('class'), /\bactive\b/);
}
async function colors(kind, values) {
  for (const [key, value] of Object.entries(values)) {
    const input = active(kind).locator('[' + configs[kind].prefix + '-style-color="' + key + '"]');
    // Move focus to the actual color input before its native picker event.
    await input.focus();
    await input.evaluate((el, value) => { el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true})); }, value);
  }
}
async function presentation(locator) {
  // Autosave may replace the preview between resolving a locator and reading it.
  // Retry only a detached snapshot; assertions still check the current live DOM.
  for(let attempt=0;attempt<5;attempt++){
    const snapshot=await locator.evaluate(el => {
    if(!el.isConnected)return null;
    const s=getComputedStyle(el),item=el.firstElementChild,isRule=item?.matches('.execution-map-rule');
    const content=isRule?item.querySelector('.execution-map-rule-main'):item;
    const c=getComputedStyle(content),box=getComputedStyle(item);
    const text=content.querySelector('.execution-map-rule-copy strong,.playbook-preview-choice-text') || content.lastElementChild || content;
    return {data:{...el.dataset},display:s.display,columns:s.gridTemplateColumns,gap:s.rowGap,align:c.textAlign,justify:c.justifyContent,padding:c.paddingTop,border:box.borderTopWidth,bottom:box.borderBottomWidth,borderColor:box.borderTopColor,bg:box.backgroundColor,shadow:box.boxShadow,text:getComputedStyle(text).color,accent:el.style.getPropertyValue('--pb-style-accent')};
    });
    if(snapshot)return snapshot;
  }
  throw new Error('Presentation target kept detaching during rendering');
}
async function verifyCombined(kind, target='#style-ul', preview='.playbook-preview-check-layout', expectedLayout='columns-2') {
  const editor=active(kind).locator(configs[kind].editor).locator(target);
  const model=active(kind).locator(configs[kind].preview).locator(preview).first();
  for(const [label,loc] of [['editor',editor],['Live Model',model]]) {
    const result=await presentation(loc);
    assert.equal(result.data.playbookListLayout,expectedLayout,label+' layout');
    assert.equal(result.data.playbookAlign,'center',label+' alignment');
    assert.equal(result.data.playbookSpacing,'relaxed',label+' spacing');
    assert.equal(result.data.playbookBorder,'strong',label+' border mode');
    assert.equal(result.data.playbookPreset,'card',label+' preset');
    assert.equal(result.border,'2px',label+' computed border width');
    assert.equal(result.borderColor,'rgb(0, 102, 255)',label+' custom border');
    assert.equal(result.bg,'rgb(238, 247, 255)',label+' custom fill');
    assert.equal(result.text,'rgb(36, 54, 75)',label+' custom text');
    assert.equal(result.accent,'#22aa88',label+' custom accent');
    assert.equal(result.align,'center',label+' computed alignment');
    assert.ok(parseFloat(result.padding)>=12,label+' relaxed padding');
  }
}
async function seed(kind) {
  await page.evaluate(kind => {setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)}, kind);
  await active(kind).locator(configs[kind].editor).evaluate((el, html) => {el.innerHTML=html;el.dispatchEvent(new Event('input',{bubbles:true}))}, fixture);
}
async function verifyExecution(kind, layout='columns-2', styledChoice=false) {
  await active(kind).locator(kind==='playbook'?'#playbookPreviewOpenExecutionBtn':'[data-ti-action="preview"]').click();
  const section=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
  assert.equal(await section.count(),1);
  assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1,'Mappings remain separate');
  const result=await presentation(section.locator('.execution-map-rule-layout').first());
  assert.equal(result.data.playbookListLayout,layout);assert.equal(result.data.playbookAlign,'center');
  assert.equal(result.data.playbookSpacing,'relaxed');assert.equal(result.data.playbookBorder,'strong');assert.equal(result.data.playbookPreset,'card');
  assert.equal(result.border,'2px');assert.equal(result.borderColor,'rgb(0, 102, 255)');assert.equal(result.bg,'rgb(238, 247, 255)');assert.equal(result.text,'rgb(36, 54, 75)');
  assert.equal(result.justify,'center');assert.ok(parseFloat(result.padding)>=12);
  if(styledChoice){
    const choice=await presentation(section.locator('.execution-map-choice-options'));
    assert.equal(choice.data.playbookListLayout,'columns-2');assert.equal(choice.data.playbookAlign,'center');
    assert.equal(choice.data.playbookSpacing,'relaxed');assert.equal(choice.data.playbookBorder,'strong');assert.equal(choice.data.playbookPreset,'card');
    assert.equal(choice.justify,'center');assert.equal(choice.border,'2px');assert.equal(choice.borderColor,'rgb(0, 102, 255)');assert.equal(choice.bg,'rgb(238, 247, 255)');assert.equal(choice.text,'rgb(36, 54, 75)');
  }
  const radios=section.locator('input[type="radio"]');
  await radios.nth(0).check();await radios.nth(1).check();
  assert.equal(await radios.nth(0).isChecked(),false);assert.equal(await radios.nth(1).isChecked(),true);
  assert.equal(await section.locator('input[type="checkbox"]').count(),6,'Styles preserve all six measurable conditions');
  await page.locator('#executionBackToInstrumentsBtn').click();
  assert.equal(await active(kind).isVisible(),true,'Return to the same builder');
  passed(kind+' Execution Quality presentation, separate mapping, Either / Or exclusivity');
}
async function run() {
  const server=http.createServer((req,res)=>{
    const filename=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));
    if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'text/html');
    // These tests exercise the actual editor and mappings without calling accounts
    // or databases. Only the external auth/chart dependencies are isolated.
    const source=fs.readFileSync(filename);
    res.end(filename.endsWith('t-ios.html')?source.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/[^\"]+"><\/script>/g,''):source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1600,height:1100}});page=await context.newPage();page.setDefaultTimeout(8000);
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    const url='http://127.0.0.1:'+server.address().port+'/t-ios.html';
    await page.goto(url,{waitUntil:'load'});
    for(const kind of ['playbook','checklist','psych']) {
      await seed(kind);await select(kind,'#style-ul li');await styles(kind);
      await layoutButton(kind,'columns-2').click();await setStyle(kind,'align','center');await setStyle(kind,'spacing','relaxed');
      await setStyle(kind,'border','strong');await setStyle(kind,'preset','card');
      await colors(kind,{background:'#eef7ff',border:'#0066ff',text:'#24364b',accent:'#22aa88'});
      await verifyCombined(kind);passed(kind+' combined styles and immediate Live Model');
      await active(kind).locator(configs[kind].save).click();
      await active(kind).locator('[data-ti-builder-switch="'+(kind==='playbook'?'checklist':'playbook')+'"]').click();
      await page.locator('.page.active [data-ti-builder-switch="'+kind+'"]').click();
      await verifyCombined(kind);passed(kind+' builder-switch persistence');
      await page.reload({waitUntil:'load'});await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind);
      await verifyCombined(kind);passed(kind+' reload persistence');await verifyExecution(kind);

      await select(kind,'#style-ul li');await styles(kind);
      for(const layout of ['vertical','row','columns-2','columns-3','squares']) {
        await layoutButton(kind,layout).click();
        const result=await presentation(active(kind).locator(configs[kind].editor).locator('#style-ul'));
        assert.equal(result.data.playbookListLayout||'vertical',layout);assert.equal(result.data.playbookAlign,'center');assert.equal(result.data.playbookBorder,'strong');
        assert.equal(result.display,layout==='row'?'flex':(['columns-2','columns-3','squares'].includes(layout)?'grid':'block'));
        const model=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-check-layout').first());
        assert.equal(model.data.playbookListLayout,layout);assert.equal(model.data.playbookBorder,'strong');
        assert.equal(model.display,['columns-2','columns-3','squares'].includes(layout)?'grid':'flex');
      }
      passed(kind+' all five layouts retain styles');
      await layoutButton(kind,'columns-3').click();await verifyCombined(kind,'#style-ul','.playbook-preview-check-layout','columns-3');
      for(const align of ['left','center','right']) {
        await setStyle(kind,'align',align);
        const textAlign=(await presentation(active(kind).locator(configs[kind].editor).locator('#style-ul'))).align;
        assert.equal(textAlign==='start'?'left':textAlign,align);
        const model=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-check-layout').first());
        assert.equal(model.data.playbookAlign||'left',align);assert.equal(model.justify,align==='left'?'normal':align==='right'?'flex-end':'center');
      }
      await setStyle(kind,'align','center');
      for(const spacing of ['compact','normal','relaxed']) {
        await setStyle(kind,'spacing',spacing);
        const result=await presentation(active(kind).locator(configs[kind].editor).locator('#style-ul'));
        assert.equal(result.data.playbookSpacing||'normal',spacing);assert.equal(parseFloat(result.padding),spacing==='compact'?4:spacing==='relaxed'?12:9);
        const model=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-check-layout').first());
        assert.equal(model.data.playbookSpacing||'normal',spacing);assert.equal(parseFloat(model.padding),spacing==='compact'?5:spacing==='relaxed'?12:9);
      }
      for(const border of ['none','thin','strong','default']) {
        await setStyle(kind,'border',border);
        const result=await presentation(active(kind).locator(configs[kind].editor).locator('#style-ul'));
        assert.equal(result.border,border==='none'?'0px':border==='strong'?'2px':'1px');if(border!=='none')assert.equal(result.borderColor,'rgb(0, 102, 255)');
        const model=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-check-layout').first());
        assert.equal(model.border,border==='none'?'0px':border==='strong'?'2px':'1px');
      }
      passed(kind+' every alignment, spacing and border mode');
      await setStyle(kind,'border','strong');
      for(const preset of ['plain','card','highlight','minimal']) {
        await setStyle(kind,'preset',preset);
        const result=await presentation(active(kind).locator(configs[kind].editor).locator('#style-ul'));
        assert.equal(result.data.playbookPreset||'plain',preset);assert.equal(result.border,'2px');assert.equal(result.borderColor,'rgb(0, 102, 255)');assert.equal(result.bg,'rgb(238, 247, 255)');
        const model=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-check-layout').first());
        assert.equal(model.data.playbookPreset||'plain',preset);assert.equal(model.border,'2px');assert.equal(model.bg,'rgb(238, 247, 255)');
      }
      await setStyle(kind,'preset','card');passed(kind+' presets preserve independent colors and borders');

      await select(kind,'#style-ol li');await layoutButton(kind,'row').click();await setStyle(kind,'align','right');await setStyle(kind,'spacing','compact');await setStyle(kind,'preset','minimal');
      const orderedBefore=await active(kind).locator('#style-ol').evaluate(el=>el.outerHTML);
      await select(kind,'#style-choice [data-choice-option]');await layoutButton(kind,'columns-2').click();await setStyle(kind,'align','center');await setStyle(kind,'spacing','relaxed');await setStyle(kind,'border','strong');await setStyle(kind,'preset','card');
      await colors(kind,{background:'#eef7ff',border:'#0066ff',text:'#24364b',accent:'#22aa88'});
      await verifyCombined(kind,'#style-choice .pb-doc-choice-options','.playbook-preview-choice-options');passed(kind+' ordered-list and Either / Or styling');
      await verifyExecution(kind,'columns-3',true);await styles(kind);

      await select(kind,'#unselected');assert.equal(await styleButton(kind,'align','center').isEnabled(),false);
      await active(kind).locator(configs[kind].editor).evaluate(editor=>{
        const range=document.createRange();range.setStart(editor.querySelector('#style-ul li').firstChild,0);range.setEnd(editor.querySelector('#style-ol li').firstChild,1);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));
      });
      assert.equal(await styleButton(kind,'align','center').isEnabled(),false);passed(kind+' invalid and cross-structure selection disables tools');
      const untouched=await active(kind).locator(configs[kind].editor).evaluate(el=>el.innerHTML);
      await page.evaluate(kind=>{if(kind==='playbook')applyPlaybookVisualStyle('align','right');else applySecondaryVisualStyle(kind,'align','right')},kind);
      assert.equal(await active(kind).locator(configs[kind].editor).evaluate(el=>el.innerHTML),untouched,'Invalid selection cannot alter the last valid target');

      await select(kind,'#style-ul li');
      const choiceBefore=await active(kind).locator('#style-choice .pb-doc-choice-options').evaluate(el=>el.outerHTML);
      await active(kind).locator(kind==='playbook'?'#playbookStyleResetSelected':'[data-ti-action="reset-style"]').click();
      const reset=await active(kind).locator('#style-ul').evaluate(el=>({data:{...el.dataset},style:el.getAttribute('style')}));
      assert.deepEqual(reset.data,{});assert.ok(!reset.style||!reset.style.includes('--pb-style'));
      assert.equal(await active(kind).locator('#style-ol').evaluate(el=>el.outerHTML),orderedBefore);
      assert.equal(await active(kind).locator('#style-choice .pb-doc-choice-options').evaluate(el=>el.outerHTML),choiceBefore);
      for(const [property,value] of Object.entries({align:'left',spacing:'normal',border:'default',preset:'plain'}))assert.match(await styleButton(kind,property,value).getAttribute('class'),/\bactive\b/);
      passed(kind+' Reset Selected affects only its target');
      await select(kind,'#style-choice [data-choice-option]');
      await active(kind).locator(kind==='playbook'?'#playbookStyleColorReset':'[data-ti-action="default-colors"]').click();
      await setStyle(kind,'border','default');await setStyle(kind,'preset','minimal');
      const minimal=await presentation(active(kind).locator(configs[kind].editor).locator('#style-choice .pb-doc-choice-options'));
      assert.equal(minimal.border,'0px');assert.equal(minimal.bottom,'1px');assert.equal(minimal.bg,'rgba(0, 0, 0, 0)');
      await colors(kind,{border:'#0066ff'});const coloredMinimal=await presentation(active(kind).locator(configs[kind].preview).locator('.playbook-preview-choice-options'));
      assert.equal(coloredMinimal.bg,'rgba(0, 0, 0, 0)');assert.equal(coloredMinimal.border,'0px');assert.equal(coloredMinimal.bottom,'1px');passed(kind+' minimal preset and single-color composability');
      // Save on rapid navigation before the 650ms autosave timer expires.
      await select(kind,'#style-ul li');await setStyle(kind,'preset','highlight');
      await page.locator('.page.active [data-ti-builder-switch="'+(kind==='playbook'?'checklist':'playbook')+'"]').click();
      await page.locator('.page.active [data-ti-builder-switch="'+kind+'"]').click();
      assert.equal(await active(kind).locator('#style-ul').getAttribute('data-playbook-preset'),'highlight');
      assert.equal(await styleButton(kind,'align','center').isEnabled(),false,'Document replacement clears stale target');
      passed(kind+' immediate navigation saves pending styles and clears stale selection');
      const originalId=await page.evaluate(kind=>kind==='playbook'?selectedPlaybookDocumentId:secondaryState(kind).selectedId,kind);
      await select(kind,'#style-ul li');await setStyle(kind,'align','right');
      await page.waitForFunction(kind=>{
        const el=kind==='playbook'?document.querySelector('#playbookDraftSaveState'):secondaryFind(kind,'[data-ti-save-state]');return el?.textContent==='Saved';
      },kind);
      const savedHtml=await page.evaluate(kind=>{
        const key=kind==='playbook'?playbookDocumentKey():secondaryStoreKey(kind),id=kind==='playbook'?selectedPlaybookDocumentId:secondaryState(kind).selectedId;
        return JSON.parse(localStorage.getItem(key)).find(doc=>doc.id===id).documentHtml;
      },kind);
      assert.match(savedHtml,/data-playbook-align="right"/);passed(kind+' autosave stores styles inside document HTML');
      await active(kind).locator(kind==='playbook'?'#playbookDraftNewBtn':'[data-ti-action="new"]').click();
      assert.equal(await styleButton(kind,'align','center').isEnabled(),false);
      await active(kind).locator(kind==='playbook'?'#playbookPreviewDocumentSelect':'[data-ti-preview-select]').selectOption(originalId);
      assert.equal(await active(kind).locator('#style-ul').getAttribute('data-playbook-align'),'right');
      assert.equal(await active(kind).locator('#style-ul').getAttribute('data-playbook-preset'),'highlight');
      assert.equal(await active(kind).locator('#style-ol').evaluate(el=>el.outerHTML),orderedBefore);
      passed(kind+' switching documents and reopening preserves independent structures');
    }
    assert.deepEqual(errors,[],'Browser console and runtime errors');passed('no JavaScript console/runtime errors');
    console.log(checks+' browser checks passed');
  } finally {await browser.close();server.close()}
}
run().catch(error=>{console.error(error);process.exitCode=1});
