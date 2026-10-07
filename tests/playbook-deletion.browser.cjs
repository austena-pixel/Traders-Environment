// Real saved-document deletion, confirmation, persistence and mapping coverage.
// Run with Playwright installed; TIOS_TEST_BROWSER may select an existing Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const editor=()=>page.locator('#playbookDocumentEditor');
const modal=()=>page.locator('#playbookDeleteModal');
const topDelete=()=>page.locator('#playbookDraftDeleteTopBtn');
async function builder(kind='playbook'){await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind)}
async function documents(){return page.evaluate(()=>JSON.parse(localStorage.getItem(playbookDocumentKey())||'[]'))}
async function selected(){return page.evaluate(()=>selectedPlaybookDocumentId)}
const content=docs=>docs.map(({updatedAt,...doc})=>doc);
async function screenshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')})}}
async function openDelete(){await topDelete().click();assert.equal(await modal().getAttribute('aria-hidden'),'false');assert.equal(await page.locator('#playbookDeleteCancel').evaluate(el=>el===document.activeElement),true)}
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
    page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})};window.confirmCalls=0;window.confirm=()=>{window.confirmCalls++;return false}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});await builder();
    assert.equal(await editor().getAttribute('contenteditable'),'true');assert.equal((await documents()).length,1);
    await page.locator('#playbookDraftTitle').fill('Keep this Playbook');await editor().fill('Original strategy stays intact.');await page.locator('#playbookDraftSaveBtn').click();
    const keepId=await selected();
    for(const kind of ['checklist','psych']){
      await builder(kind);const active=page.locator(kind==='checklist'?'#page-checklists':'#page-reflections');
      await active.locator('[data-ti-title]').fill('Keep '+kind);await active.locator('[data-ti-editor]').fill('Separate '+kind+' content.');await active.locator('[data-ti-action="save"]').click();
    }
    await builder();await page.locator('#playbookDraftNewBtn').click();
    const deleteName='Breakout "<edge>"';await page.locator('#playbookDraftTitle').fill(deleteName);await editor().fill('Only this selected strategy will be removed.');await page.locator('#playbookDraftSaveBtn').click();
    const deleteId=await selected(),saved=content(await documents());
    await page.locator('#playbookPreviewOpenExecutionBtn').click();assert.equal(await page.locator('#executionMapPlaybookSelect').inputValue(),deleteId);await page.locator('#executionBackToInstrumentsBtn').click();
    const others=await page.evaluate(()=>Object.fromEntries(['checklist','psych'].map(kind=>[kind,JSON.parse(localStorage.getItem(secondaryStoreKey(kind)))])));
    const history=await page.evaluate(()=>{
      planReviews=[{id:'historical-edge',trade_id:'historical-trade',notes:'Original edge review'}];executionReviews=[{id:'historical-execution',trade_id:'historical-trade',notes:'Original execution review'}];
      planChecks=[{id:'edge-check',review_id:'historical-edge',passed:true}];executionChecks=[{id:'execution-check',review_id:'historical-execution',passed:false}];
      playbooks=[{id:'legacy-saved-playbook',name:'Historical edge'}];tradePlaybookMap={'historical-trade':'legacy-saved-playbook'};
      return JSON.stringify({planReviews,executionReviews,planChecks,executionChecks,playbooks,tradePlaybookMap});
    });
    pass('Existing saved Playbooks can be selected independently of Rules, Psychological Reflection and historical reviews');

    await openDelete();assert.equal(await page.locator('#playbookDeleteName').textContent(),deleteName);assert.equal(await page.locator('#playbookDeleteName > *').count(),0);
    assert.deepEqual(content(await documents()),saved);await screenshot('playbook-delete-confirmation');
    await page.locator('#playbookDeleteCancel').click();assert.equal(await modal().getAttribute('aria-hidden'),'true');assert.equal(await selected(),deleteId);assert.deepEqual(content(await documents()),saved);
    assert.equal(await topDelete().evaluate(el=>el===document.activeElement),true);
    await openDelete();await page.keyboard.press('Escape');assert.equal(await modal().getAttribute('aria-hidden'),'true');
    await openDelete();await modal().click({position:{x:4,y:4}});assert.equal(await modal().getAttribute('aria-hidden'),'true');assert.deepEqual(content(await documents()),saved);
    pass('The in-page confirmation names the exact selected Playbook, escapes its name, and Cancel / Escape / backdrop preserve it');

    await topDelete().focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.locator('#playbookDeleteConfirm').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await modal().locator('[aria-label="Close"]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#playbookDeleteConfirm').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');
    pass('Keyboard activation, focus trapping and dismissal work without a browser confirmation popup');

    await openDelete();await page.evaluate(id=>selectPlaybookDocument(id),keepId);await page.locator('#playbookDeleteConfirm').click();assert.equal((await documents()).length,2);assert.equal(await selected(),keepId);
    await page.locator('#playbookPreviewDocumentSelect').selectOption(deleteId);
    const account=await page.evaluate(()=>tradingAccount);await openDelete();await page.evaluate(()=>{tradingAccount={id:'changed-account'}});await page.locator('#playbookDeleteConfirm').click();await page.evaluate(account=>{tradingAccount=account},account);
    assert.equal((await documents()).length,2);assert.equal(await selected(),deleteId);
    pass('A stale confirmation cannot delete another selected Playbook or cross into another account');

    await editor().fill('A pending autosave must not restore this deleted strategy.');await openDelete();await page.locator('#playbookDeleteConfirm').click();
    assert.equal(await modal().getAttribute('aria-hidden'),'true');assert.deepEqual((await documents()).map(doc=>doc.id),[keepId]);assert.equal(await selected(),keepId);
    assert.equal(await page.locator('#playbookDraftTitle').inputValue(),'Keep this Playbook');assert.equal(await editor().textContent(),'Original strategy stays intact.');
    assert.equal(await page.locator('#playbookExecutionPreviewBody').textContent(),'Original strategy stays intact.');
    assert.equal(await page.locator('#playbookPreviewDocumentSelect option[value="'+deleteId+'"]').count(),0);assert.equal(await page.locator('#executionMapPlaybookSelect option[value="'+deleteId+'"]').count(),0);
    assert.equal(await page.locator('#playbookSaveAction').evaluate(el=>el.classList.contains('show')),false);
    assert.equal(await page.evaluate(()=>JSON.stringify({planReviews,executionReviews,planChecks,executionChecks,playbooks,tradePlaybookMap})),history);
    for(const kind of ['checklist','psych'])assert.deepEqual(content(await page.evaluate(kind=>JSON.parse(localStorage.getItem(secondaryStoreKey(kind))),kind)),content(others[kind]));
    pass('Confirm deletes only the selected Playbook, updates both pickers / Live Model / Execution Quality, and preserves other instruments and historical reviews');

    await page.waitForTimeout(900);assert.deepEqual((await documents()).map(doc=>doc.id),[keepId]);
    await page.reload({waitUntil:'load'});await builder();assert.deepEqual((await documents()).map(doc=>doc.id),[keepId]);assert.equal(await editor().textContent(),'Original strategy stays intact.');
    pass('Deletion survives pending autosave and page reload, while the remaining Playbook stays intact');

    await page.locator('#playbookPreviewOpenExecutionBtn').click();await page.locator('#executionBackToInstrumentsBtn').click();
    await openDelete();await page.locator('#playbookDeleteConfirm').click();assert.deepEqual(await documents(),[]);
    assert.equal(await page.evaluate(()=>localStorage.getItem(playbookDocumentKey()+':selected')),null);assert.equal(await selected(),null);
    assert.equal(await editor().textContent(),'');assert.equal(await editor().getAttribute('contenteditable'),'false');assert.equal(await page.locator('#playbookDraftTitle').inputValue(),'');
    assert.equal(await topDelete().isDisabled(),true);assert.equal(await page.locator('#playbookDraftSaveBtn').isDisabled(),true);assert.equal(await page.locator('#playbookDraftNewBtn').isEnabled(),true);
    assert.equal(await page.locator('#playbookPreviewTitle').textContent(),'No Playbook');assert.equal(await page.locator('#executionMapPlaybookSelect').textContent(),'No Playbooks');
    await page.waitForTimeout(900);assert.deepEqual(await documents(),[]);assert.equal(await page.locator('#playbookDraftSaveState').textContent(),'Create a playbook to begin');await screenshot('playbook-library-empty');
    await builder('checklist');await builder();assert.deepEqual(await documents(),[]);await page.reload({waitUntil:'load'});await builder();assert.deepEqual(await documents(),[]);
    await page.locator('#playbookPreviewOpenExecutionBtn').click();assert.equal(await page.locator('#executionMapPlaybookSelect').textContent(),'No Playbooks');assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section="playbook"] input').count(),0);await page.locator('#executionBackToInstrumentsBtn').click();assert.deepEqual(await documents(),[]);
    pass('Deleting the last Playbook leaves a persistent empty library, clears the selection and mapping, and does not recreate an unwanted document');

    await page.locator('#playbookDraftNewBtn').click();assert.equal((await documents()).length,1);assert.equal(await editor().getAttribute('contenteditable'),'true');assert.equal(await topDelete().isEnabled(),true);
    await page.locator('#playbookDraftTitle').fill('A new Playbook after deletion');await editor().fill('Fresh writing is available.');await page.locator('#playbookDraftSaveBtn').click();
    await page.reload({waitUntil:'load'});await builder();assert.equal(await editor().textContent(),'Fresh writing is available.');assert.equal((await documents()).length,1);
    pass('New Playbook creates a normal editable and savable document after an empty library');

    await page.setViewportSize({width:390,height:844});await openDelete();const card=await modal().locator('.modal-card').boundingBox(),button=await page.locator('#playbookDeleteConfirm').boundingBox();
    assert.ok(card.x>=0&&card.x+card.width<=390);assert.ok(button.x>=0&&button.x+button.width<=390);await screenshot('playbook-delete-mobile');await page.locator('#playbookDeleteCancel').click();assert.equal((await documents()).length,1);
    assert.equal(await page.evaluate(()=>window.confirmCalls),0);assert.deepEqual(errors,[]);
    pass('Confirmation fits a phone, cancellation remains available, and the browser console is error-free');
    console.log('Completed '+checks+' Playbook deletion checks');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
