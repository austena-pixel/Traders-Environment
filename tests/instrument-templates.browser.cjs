// Run with Playwright installed: node tests/instrument-templates.browser.cjs
// TIOS_TEST_BROWSER can point to an existing Chromium executable.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const configs={
  playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',prefix:'data-playbook',preview:'#playbookExecutionPreviewBody',title:'#playbookDraftTitle',open:'#playbookPreviewOpenExecutionBtn',picker:'#playbookPreviewDocumentSelect',save:'#playbookDraftSaveBtn',executionPicker:'#executionMapPlaybookSelect'},
  checklist:{page:'#page-checklists',editor:'[data-ti-editor]',prefix:'data-ti',preview:'[data-ti-preview-body]',title:'[data-ti-title]',open:'[data-ti-action="preview"]',picker:'[data-ti-preview-select]',save:'[data-ti-action="save"]',executionPicker:'#executionMapChecklistSelect'},
  psych:{page:'#page-reflections',editor:'[data-ti-editor]',prefix:'data-ti',preview:'[data-ti-preview-body]',title:'[data-ti-title]',open:'[data-ti-action="preview"]',picker:'[data-ti-preview-select]',save:'[data-ti-action="save"]',executionPicker:'#executionMapPsychSelect'}
};
const templateIds={
  playbook:['playbook-simple','playbook-sections','playbook-cards','playbook-patterns'],
  checklist:['rules-simple','rules-sections','rules-cards','rules-patterns'],
  psych:['psych-simple','psych-sections','psych-cards','psych-patterns']
};
const insertTemplateIds={playbook:['edge-framework','setup-checklist','minimal-plan'],checklist:['session-rules','risk-rules','execution-rules'],psych:['post-trade-reflection','emotional-state','decision-review']};
const labels={playbook:'Playbook',checklist:'Rules',psych:'Psychological Reflection'};
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(configs[kind].page);
const editor=kind=>active(kind).locator(configs[kind].editor);
const model=kind=>active(kind).locator(configs[kind].preview);
const templateTab=kind=>active(kind).locator('['+configs[kind].prefix+'-ribbon="templates"]');
const templatePanel=kind=>active(kind).locator('['+configs[kind].prefix+'-ribbon-panel="templates"]');
async function switchBuilder(kind){await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind)}
async function docs(kind){return page.evaluate(kind=>JSON.parse(localStorage.getItem(instrumentImageScope(kind))||'[]'),kind)}
const documentContent=documents=>documents.map(({updatedAt,...content})=>content);
async function currentId(kind){return page.evaluate(kind=>instrumentImageDocumentId(kind),kind)}
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
    page=await browser.newPage({viewport:{width:1700,height:1150}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    const librarySnapshots={};
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);
      assert.equal(await active(kind).locator('.playbook-word-main .playbook-word-ribbon').count(),1);
      assert.equal(await active(kind).locator('.playbook-word-page .playbook-word-editor').count(),1);
      assert.equal(await active(kind).locator('.playbook-execution-preview .playbook-preview-body').count(),1);
      assert.equal(await editor(kind).locator('h2').textContent(),labels[kind]);
      await active(kind).locator('['+configs[kind].prefix+'-ribbon="insert"]').click();
      for(const type of ['section','choice','note','table','image-field','image'])assert.equal(await active(kind).locator('['+configs[kind].prefix+'-insert="'+type+'"]').isVisible(),true);
      if(kind==='checklist')assert.equal(await active(kind).locator('[data-ti-insert="rule"]').isVisible(),true);
      assert.equal(await templateTab(kind).evaluate(el=>el.previousElementSibling.textContent),'Styles');
      assert.equal(await templateTab(kind).count(),1);assert.equal(await templatePanel(kind).count(),1);
      const originalId=await currentId(kind),originalHtml=await editor(kind).innerHTML(),beforeBrowse=await docs(kind);
      await templateTab(kind).focus();await page.keyboard.press('Enter');
      assert.equal(await templateTab(kind).getAttribute('aria-selected'),'true');
      assert.deepEqual(await templatePanel(kind).locator('[data-instrument-template]').evaluateAll(nodes=>nodes.map(el=>el.dataset.instrumentTemplate)),[...templateIds[kind],...insertTemplateIds[kind]]);
      assert.ok((await templatePanel(kind).locator('[data-instrument-template-kind]').evaluateAll(nodes=>nodes.map(el=>el.dataset.instrumentTemplateKind))).every(value=>value===kind));
      assert.equal(await editor(kind).innerHTML(),originalHtml);assert.equal(await currentId(kind),originalId);assert.deepEqual(documentContent(await docs(kind)),documentContent(beforeBrowse));
      await screenshot(kind+'-templates');
      pass(kind+' has the shared editor / Insert / Live Model structure and Templates directly after Styles');
      pass(kind+' gallery shows only its own templates and browsing leaves the current document intact');
      for(const [index,id] of templateIds[kind].entries()){
        const previousId=await currentId(kind),before=await docs(kind),marker=kind+'-edit-before-'+index;
        // Exercise a template switch before the editor's delayed autosave fires.
        await editor(kind).evaluate((el,marker)=>{const p=document.createElement('p');p.textContent=marker;el.appendChild(p);el.dispatchEvent(new Event('input',{bubbles:true}))},marker);
        const name=await templatePanel(kind).locator('[data-instrument-template="'+id+'"] strong').textContent();
        await templatePanel(kind).locator('[data-instrument-template="'+id+'"]').click();
        const nextId=await currentId(kind),after=await docs(kind);
        assert.notEqual(nextId,previousId);assert.equal(after.length,before.length+1);
        assert.ok(after.find(doc=>doc.id===previousId).documentHtml.includes(marker));
        assert.equal(await active(kind).locator(configs[kind].title).inputValue(),name);
        assert.equal(after.find(doc=>doc.id===nextId).name,name);assert.ok(await model(kind).textContent());
        assert.equal(after.find(doc=>doc.id===nextId).templateDraft,true);assert.equal(after.find(doc=>doc.id===nextId).templateId,id);
        await page.evaluate(()=>renderExecutionMappingControls());
        assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+nextId+'"]').count(),0);
        await active(kind).locator(configs[kind].open).click();assert.equal(await active(kind).evaluate(el=>el.classList.contains('active')),true,'Preview cannot implicitly save a template draft');
        if(index===0){assert.equal(await editor(kind).locator('h2').count(),1);assert.equal(await editor(kind).locator('p').count(),1)}
        if(index===1){
          assert.ok(await editor(kind).locator('h3').count()>=3);
          if(kind==='psych')assert.equal(await model(kind).locator('.ti-preview-prompt').count(),3);
          else assert.ok(await model(kind).locator('.playbook-preview-check').count()>=3);
        }
        if(index===2){
          const target=editor(kind).locator('[data-playbook-list-layout="columns-2"]');
          assert.equal(await target.getAttribute('data-playbook-preset'),'card');assert.equal(await target.getAttribute('data-playbook-spacing'),'relaxed');assert.equal(await target.getAttribute('data-playbook-border'),'thin');
          const live=model(kind).locator('[data-playbook-list-layout="columns-2"]');
          assert.equal(await live.getAttribute('data-playbook-preset'),'card');assert.equal(await live.getAttribute('data-playbook-color-border'),await target.getAttribute('data-playbook-color-border'));
          assert.equal(await target.evaluate(el=>getComputedStyle(el).display),'grid');
          await screenshot(kind+'-card-template');
        }
        if(index===3){
          const fields=editor(kind).locator('[data-playbook-node="image-field"]');assert.equal(await fields.count(),2);
          assert.deepEqual(await fields.evaluateAll(nodes=>nodes.map(el=>el.dataset.tiImageFieldSelection)),['choice','check']);
          const radios=model(kind).locator('input[type="radio"]');await radios.first().check();await radios.last().check();assert.equal(await radios.first().isChecked(),false);
          const checkboxes=model(kind).locator('input[type="checkbox"]');await checkboxes.first().check();await checkboxes.last().check();assert.equal(await checkboxes.first().isChecked(),true);assert.equal(await checkboxes.last().isChecked(),true);
          assert.equal(await fields.locator('input').count(),0);
        }
        await active(kind).locator(configs[kind].save).click();
        assert.equal((await docs(kind)).find(doc=>doc.id===nextId).templateDraft,false);
        await active(kind).locator(configs[kind].open).click();
        assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+nextId+'"]').count(),1);
        const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
        assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);
        if(index===1&&kind==='psych')assert.equal(await mapped.locator('.execution-psych-prompt textarea').count(),4); // Three prompts plus the introductory content.
        if(index===2){const styled=mapped.locator('[data-playbook-list-layout="columns-2"]');assert.equal(await styled.getAttribute('data-playbook-preset'),'card');assert.equal(await styled.getAttribute('data-playbook-border'),'thin')}
        if(index===3){
          const radios=mapped.locator('input[type="radio"]');await radios.first().check();await radios.last().check();assert.equal(await radios.first().isChecked(),false);
          const checkboxes=mapped.locator('input[type="checkbox"]');await checkboxes.first().check();await checkboxes.last().check();assert.equal(await checkboxes.first().isChecked(),true);
        }
        await page.locator('#executionBackToInstrumentsBtn').click();
        await templateTab(kind).click();
        pass(id+' stays a draft until explicit Save, preserves pending edits, updates Live Model and then maps separately');
      }
      // Retain the section insertion workflow added on main while this work was paused.
      for(const [index,id] of insertTemplateIds[kind].entries()){
        const documentId=await currentId(kind),count=(await docs(kind)).length,marker=kind+'-section-'+index;
        const heading=await page.evaluate(({kind,id})=>new DOMParser().parseFromString(technicalInstrumentTemplate(kind,id).html,'text/html').querySelector('h2').textContent,{kind,id});
        await editor(kind).evaluate((el,marker)=>{
          const before=document.createElement('p'),after=document.createElement('p');before.textContent='before-'+marker;after.textContent='after-'+marker;el.append(before,after);el.focus();
          const range=document.createRange();range.selectNodeContents(before);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
          el.dispatchEvent(new Event('input',{bubbles:true}));
        },marker);
        // Moving focus into the ribbon must retain the editor's insertion point.
        await templateTab(kind).focus();await page.keyboard.press('Enter');
        const button=templatePanel(kind).locator('[data-instrument-template="'+id+'"]');
        assert.equal(await button.locator('.ti-template-action').textContent(),'Insert section');
        await button.focus();await page.keyboard.press('Enter');
        const text=await editor(kind).textContent(),start=text.indexOf('before-'+marker),end=text.indexOf('after-'+marker);
        assert.ok(start>=0&&end>start);assert.ok(text.slice(start,end).includes(heading),'Section is inserted at the remembered caret');
        assert.equal(await currentId(kind),documentId);assert.equal((await docs(kind)).length,count);assert.ok((await model(kind).textContent()).includes(heading));
        await active(kind).locator(configs[kind].open).click();
        const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
        assert.ok((await mapped.textContent()).includes(heading));
        await page.locator('#executionBackToInstrumentsBtn').click();await templateTab(kind).click();
        assert.ok((await docs(kind)).find(doc=>doc.id===documentId).documentHtml.includes(heading));
        pass(kind+' '+id+' preserves section insertion at the caret, the current document, Save, Live Model and separate mapping');
      }
      const pictureDocumentId=await currentId(kind),ids=await editor(kind).locator('[data-ti-image-field-id]').evaluateAll(nodes=>nodes.map(el=>el.dataset.tiImageFieldId));
      await templatePanel(kind).locator('[data-instrument-template="'+templateIds[kind][3]+'"]').click();
      const nextIds=await editor(kind).locator('[data-ti-image-field-id]').evaluateAll(nodes=>nodes.map(el=>el.dataset.tiImageFieldId));
      assert.equal(ids.some(id=>nextIds.includes(id)),false,'Each template instance gets fresh field identities');
      await active(kind).locator(configs[kind].picker).selectOption(pictureDocumentId);
      await page.reload({waitUntil:'load'});await switchBuilder(kind);
      assert.equal(await currentId(kind),pictureDocumentId);assert.deepEqual(await editor(kind).locator('[data-ti-image-field-id]').evaluateAll(nodes=>nodes.map(el=>el.dataset.tiImageFieldId)),ids);
      assert.deepEqual(await editor(kind).locator('[data-playbook-node="image-field"]').evaluateAll(nodes=>nodes.map(el=>el.dataset.tiImageFieldSelection)),['choice','check']);
      librarySnapshots[kind]=documentContent(await docs(kind));
      pass(kind+' repeated templates have fresh identities and document switching / reload preserve the saved design');
    }
    await switchBuilder('checklist');assert.deepEqual(documentContent(await docs('playbook')),librarySnapshots.playbook);assert.deepEqual(documentContent(await docs('psych')),librarySnapshots.psych);
    const before=await docs('checklist');
    await page.evaluate(()=>{createInstrumentFromTemplate('checklist','playbook-cards');createInstrumentFromTemplate('playbook','playbook-cards');applyInstrumentTemplate('checklist','edge-framework');applyPlaybookDefaultTemplate('edge-framework');applySecondaryDefaultTemplate('psych','emotional-state')});
    assert.deepEqual(documentContent(await docs('checklist')),documentContent(before));assert.deepEqual(documentContent(await docs('playbook')),librarySnapshots.playbook);
    pass('Template libraries remain separate and stale / cross-builder template calls cannot create documents');
    await page.setViewportSize({width:980,height:900});await templateTab('checklist').click();
    const tabBox=await templateTab('checklist').boundingBox(),builtBox=await active('checklist').locator('.ti-builder-switcher').boundingBox();
    assert.ok(tabBox.x+tabBox.width<=builtBox.x||tabBox.y>=builtBox.y+builtBox.height,'Templates does not overlap the Built switcher on compact desktop');
    await screenshot('rules-templates-compact');
    await page.setViewportSize({width:390,height:844});
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);await templateTab(kind).click();
      const panel=templatePanel(kind),box=await panel.boundingBox(),gallery=panel.locator('.ti-template-gallery');
      assert.ok(box.x>=0&&box.x+box.width<=390);assert.ok(await gallery.evaluate(el=>el.scrollWidth>el.clientWidth));
      await gallery.evaluate(el=>el.scrollLeft=el.scrollWidth);await panel.locator('[data-instrument-template="'+templateIds[kind][3]+'"]').click();
      assert.equal(await editor(kind).locator('[data-playbook-node="image-field"]').count(),2);
    }
    await screenshot('psych-templates-mobile');
    pass('Templates fits the compact desktop ribbon and scrolls on a phone for all three builders');
    await page.setViewportSize({width:1700,height:1150});
    for(const kind of Object.keys(configs)){
      // A template draft survives edits, autosave, builder switching and reload,
      // including a renamed draft, without appearing in Execution Quality.
      await switchBuilder(kind);const draftId=await currentId(kind);
      await active(kind).locator(configs[kind].title).fill('My unsaved '+kind+' design');
      await editor(kind).evaluate(el=>{const p=document.createElement('p');p.textContent='Draft work to preserve';el.appendChild(p);el.dispatchEvent(new Event('input',{bubbles:true}))});
      await page.waitForFunction(({scope,id})=>JSON.parse(localStorage.getItem(scope)||'[]').some(doc=>doc.id===id&&doc.documentHtml.includes('Draft work to preserve')),{scope:await page.evaluate(kind=>instrumentImageScope(kind),kind),id:draftId});
      await switchBuilder(kind==='playbook'?'psych':'playbook');await switchBuilder(kind);assert.equal(await currentId(kind),draftId);
      await page.reload({waitUntil:'load'});await switchBuilder(kind);
      assert.equal(await currentId(kind),draftId);assert.ok((await editor(kind).textContent()).includes('Draft work to preserve'));assert.equal((await docs(kind)).find(doc=>doc.id===draftId).templateDraft,true);
      await page.evaluate(()=>navigate('execution'));
      assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+draftId+'"]').count(),0);
      await page.evaluate(({kind,id})=>{if(kind==='playbook')executionMappingPlaybookId=id;else if(kind==='checklist')executionMappingChecklistId=id;else executionMappingPsychId=id;renderExecutionMappingWorkspace()},{kind,id:draftId});
      assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+draftId+'"]').count(),0,'A stale mapping ID cannot expose a draft');
      await switchBuilder(kind);await active(kind).locator(configs[kind].save).click();
      await page.reload({waitUntil:'load'});await switchBuilder(kind);await active(kind).locator(configs[kind].open).click();
      assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+draftId+'"]').count(),1);
      pass(kind+' renamed draft survives autosave, switching and reload; only manual Save makes it available in Execution Quality');
      // Seed the exact previous release format, which had no template metadata.
      const legacy=await page.evaluate(kind=>{
        const defaults=INSTRUMENT_DEFAULT_TEMPLATES[kind].filter(item=>item.variant!=='insert');
        const docs=defaults.map((template,index)=>({id:'legacy_'+kind+'_'+index,name:template.name,documentHtml:instrumentTemplateDocumentHtml(kind,template),description:'',tags:[],instrumentState:'draft'}));
        const card=docs[2];
        docs.push({...card,id:'legacy_'+kind+'_edited',documentHtml:card.documentHtml+'<p>My actual trading conditions</p>'});
        docs.push({...card,id:'legacy_'+kind+'_renamed',name:'My custom trading system'});
        docs.push({...card,id:'legacy_'+kind+'_colors',documentHtml:card.documentHtml.replace(/data-playbook-color-border="[^"]+"/,'data-playbook-color-border="#123456"')});
        docs.push({...card,id:'legacy_'+kind+'_confirmed',templateDraft:false,templateId:defaults[2].id});
        const host=document.createElement('div');host.innerHTML=docs[3].documentHtml;host.querySelectorAll('.pb-doc-remove-btn').forEach(button=>button.setAttribute('contenteditable','false'));docs[3].documentHtml=host.innerHTML;
        localStorage.setItem(instrumentImageScope(kind),JSON.stringify(docs));localStorage.setItem(instrumentImageScope(kind)+':selected',docs[0].id);
        return docs;
      },kind);
      await page.reload({waitUntil:'load'});await switchBuilder(kind);
      const migrated=await docs(kind);assert.equal(migrated.length,legacy.length);
      for(const previous of legacy){const stored=migrated.find(doc=>doc.id===previous.id);assert.equal(stored.documentHtml,previous.documentHtml);assert.equal(stored.templateDraft,!previous.id.match(/_(edited|renamed|colors|confirmed)$/))}
      await page.evaluate(()=>navigate('execution'));
      assert.deepEqual(await page.locator(configs[kind].executionPicker+' option').evaluateAll(nodes=>nodes.map(el=>el.value)),legacy.slice(4).map(doc=>doc.id));
      if(kind!=='playbook')assert.ok((await page.locator(configs[kind].executionPicker).evaluate(el=>el.closest('.execution-map-control').querySelector(':scope > span').textContent)).includes('(4)'));
      await page.evaluate(({kind,documents})=>{localStorage.setItem(instrumentImageScope(kind),JSON.stringify(documents));localStorage.setItem(instrumentImageScope(kind)+':selected',documents[0].id)},{kind,documents:migrated.slice(0,4)});
      await page.reload({waitUntil:'load'});await page.evaluate(()=>{setLoggedInUI(true);navigate('execution')});
      assert.deepEqual(await page.locator(configs[kind].executionPicker+' option').evaluateAll(nodes=>nodes.map(el=>el.value)),['']);
      assert.equal(await page.locator(configs[kind].executionPicker).evaluate(el=>el.closest('.execution-map-control').querySelector('button').disabled),true);
      assert.equal(await page.evaluate(kind=>kind==='playbook'?executionMappingPlaybook():executionMappingSecondary(kind),kind),null);
      await page.evaluate(({kind,documents})=>{localStorage.setItem(instrumentImageScope(kind),JSON.stringify(documents));localStorage.setItem(instrumentImageScope(kind)+':selected',documents[0].id)},{kind,documents:migrated});
      await page.reload({waitUntil:'load'});
      await switchBuilder(kind);await active(kind).locator(configs[kind].save).click();
      await page.reload({waitUntil:'load'});await switchBuilder(kind);await active(kind).locator(configs[kind].open).click();
      assert.equal(await page.locator(configs[kind].executionPicker+' option[value="'+legacy[0].id+'"]').count(),1);
      pass(kind+' legacy untouched templates become drafts without deletion; custom / confirmed documents stay listed and Save restores a migrated draft');
    }
    assert.deepEqual(errors,[]);pass('No browser console or JavaScript errors');
    console.log(checks+' instrument-template browser checks passed');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
