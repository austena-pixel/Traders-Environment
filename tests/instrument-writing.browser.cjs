// Real editor / ribbon / Live Model / Execution Quality regression coverage.
// Run with Playwright installed; TIOS_TEST_BROWSER may select an existing Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const configs={
  playbook:{page:'#page-playbook',editor:'#playbookDocumentEditor',prefix:'data-playbook',functions:'#playbookBlockStyle',model:'#playbookExecutionPreviewBody',save:'#playbookDraftSaveBtn',open:'#playbookPreviewOpenExecutionBtn',title:'#playbookDraftTitle'},
  checklist:{page:'#page-checklists',editor:'[data-ti-editor]',prefix:'data-ti',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]',title:'[data-ti-title]'},
  psych:{page:'#page-reflections',editor:'[data-ti-editor]',prefix:'data-ti',functions:'[data-ti-block-style]',model:'[data-ti-preview-body]',save:'[data-ti-action="save"]',open:'[data-ti-action="preview"]',title:'[data-ti-title]'}
};
let page,checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
const active=kind=>page.locator(configs[kind].page),editor=kind=>active(kind).locator(configs[kind].editor),model=kind=>active(kind).locator(configs[kind].model);
const attribute=(kind,key)=>configs[kind].prefix+'-'+key;
async function clickDisabledControl(control){
  await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();
  const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.click(point.x,point.y);return point;
}
async function assertGuidanceNear(point){
  const notice=page.locator('#statusBar');assert.equal(await notice.isVisible(),true);
  assert.equal(await notice.getAttribute('data-instrument-selection-hint'),'1');
  const box=await notice.boundingBox(),viewport=page.viewportSize();
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'Guidance stays inside the viewport');
  const distanceX=Math.max(box.x-point.x,point.x-box.x-box.width,0),distanceY=Math.max(box.y-point.y,point.y-box.y-box.height,0);
  assert.ok(distanceX<=16&&distanceY<=16,'Guidance appears beside its click or keyboard target');
}
async function switchBuilder(kind){await page.evaluate(kind=>{setLoggedInUI(true);switchTechnicalInstrumentBuilder(kind)},kind)}
async function select(kind,start,end=start,substring=null,collapse=false){
  await editor(kind).evaluate((el,{start,end,substring,collapse})=>{
    el.focus();const first=el.querySelector(start),last=el.querySelector(end),range=document.createRange();
    if(substring){const walker=document.createTreeWalker(first,NodeFilter.SHOW_TEXT);let node;while(walker.nextNode()){if(walker.currentNode.textContent.includes(substring)){node=walker.currentNode;break}}if(!node)throw Error('Missing selection text: '+substring);const offset=node.textContent.indexOf(substring);range.setStart(node,offset);range.setEnd(node,offset+substring.length)}
    else{range.setStart(first,0);range.setEnd(last,last.childNodes.length)}
    if(collapse)range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  },{start,end,substring,collapse});
}
async function apply(kind,value){
  await active(kind).locator('['+attribute(kind,'ribbon')+'="home"]').click();
  const control=active(kind).locator(configs[kind].functions);
  // Keyboard-style ribbon focus intentionally takes focus away from the editor.
  await control.focus();await control.selectOption(value);
}
async function backToText(kind,keyboard=false){
  await active(kind).locator('['+attribute(kind,'ribbon')+'="home"]').click();
  const button=active(kind).locator('[data-instrument-back-to-text]');assert.equal(await button.isEnabled(),true);
  if(keyboard){await button.focus();await page.keyboard.press('Enter')}else await button.click();
  assert.equal(await button.isDisabled(),true);
}
async function style(kind,category,value){
  await active(kind).locator('['+attribute(kind,'ribbon')+'="styles"]').click();
  await active(kind).locator('['+attribute(kind,'style-category')+'="'+category+'"]').click();
  const key={alignment:'align',spacing:'spacing',borders:'border',presets:'preset'}[category];
  const button=active(kind).locator('['+attribute(kind,'style-'+key)+'="'+value+'"]');
  await button.focus();await page.keyboard.press('Enter');assert.equal(await button.evaluate(el=>el.classList.contains('active')),true);
}
async function color(kind,key,value){
  await active(kind).locator('['+attribute(kind,'style-category')+'="colors"]').click();
  await active(kind).locator('['+attribute(kind,'style-color')+'="'+key+'"]').evaluate((el,value)=>{el.focus();el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},value);
}
async function append(kind,html){await editor(kind).evaluate((el,html)=>{el.insertAdjacentHTML('beforeend',html);el.dispatchEvent(new Event('input',{bubbles:true}))},html)}
async function screenshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')})}}
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
    page=await browser.newPage({viewport:{width:1745,height:1100}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html',{waitUntil:'load'});
    const snapshots={};
    for(const kind of Object.keys(configs)){
      await switchBuilder(kind);assert.equal(await editor(kind).textContent(),'');
      assert.ok((await active(kind).locator('['+attribute(kind,'ribbon-panel')+'="home"]').textContent()).includes('Functions'));
      const untouched=await editor(kind).innerHTML(),notice=page.locator('#statusBar');
      const functionControl=active(kind).locator(configs[kind].functions);
      assert.equal(await functionControl.isDisabled(),true);
      await assertGuidanceNear(await clickDisabledControl(functionControl));assert.match(await notice.textContent(),/^First, highlight.*apply a function/);
      await screenshot('selection-guidance-'+kind);
      await active(kind).locator('[data-instrument-selection-functions] .playbook-word-tool-label').click();assert.match(await notice.textContent(),/highlight.*function/);
      await assertGuidanceNear(await clickDisabledControl(active(kind).locator('[data-instrument-reflection-function]')));assert.match(await notice.textContent(),/highlight.*Reflection/);
      await assertGuidanceNear(await clickDisabledControl(active(kind).locator('[data-instrument-back-to-text]')));assert.match(await notice.textContent(),/^First, select.*Back to text/);
      assert.equal(await editor(kind).innerHTML(),untouched);
      pass(kind+' disabled Functions, Reflection and Back to text controls show selection guidance on real clicks without changing the document');

      const stylesTab=active(kind).locator('['+attribute(kind,'ribbon')+'="styles"]');
      await stylesTab.click();assert.match(await notice.textContent(),/^First, highlight text.*structure.*style/);
      assert.equal(await active(kind).locator('['+attribute(kind,'ribbon-panel')+'="styles"]').isVisible(),true);
      await assertGuidanceNear(await clickDisabledControl(active(kind).locator('['+attribute(kind,'style-align')+'="center"]')));assert.match(await notice.textContent(),/structure.*style/);
      await assertGuidanceNear(await clickDisabledControl(active(kind).locator('['+attribute(kind,'list-layout')+'="columns-2"]')));assert.match(await notice.textContent(),/^First, select a list.*layout/);
      await active(kind).locator('['+attribute(kind,'style-category')+'="colors"]').click();
      await assertGuidanceNear(await clickDisabledControl(active(kind).locator('['+attribute(kind,'style-color')+'="border"]')));assert.match(await notice.textContent(),/structure.*style/);
      await stylesTab.focus();await page.keyboard.press('Enter');assert.match(await notice.textContent(),/structure.*style/);assert.equal(await notice.isVisible(),true);
      const keyboardBox=await stylesTab.boundingBox();await assertGuidanceNear({x:keyboardBox.x+keyboardBox.width/2,y:keyboardBox.y+keyboardBox.height});
      assert.equal(await notice.getAttribute('role'),'status');assert.equal(await editor(kind).innerHTML(),untouched);
      pass(kind+' click and keyboard guidance appears beside Functions, Styles, layout and colors while keeping Styles accessible');

      await active(kind).locator('['+attribute(kind,'ribbon')+'="home"]').click();
      await active(kind).locator('['+attribute(kind,'command')+'="bold"]').click();assert.match(await notice.textContent(),/^First, highlight text to format/);
      assert.equal(await editor(kind).innerHTML(),untouched);
      await editor(kind).click();await page.keyboard.type('Context before. Wait for confirmation. Context after.');
      assert.equal(await notice.evaluate(el=>Boolean(el.dataset.instrumentSelectionHint)),false);
      assert.equal(await active(kind).locator('[data-instrument-back-to-text]').isDisabled(),true);
      assert.equal((await page.evaluate(kind=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML),kind)).every(item=>item.type==='content'),true);
      assert.equal(await model(kind).locator('.playbook-preview-checkbox,.ti-preview-prompt').count(),0);
      pass(kind+' opens as a normal blank writing page and typing creates unscored prose');

      await select(kind,':scope > p',undefined,'Wait for confirmation.');
      const prose=await editor(kind).innerHTML();
      await active(kind).locator(configs[kind].title).evaluate(el=>{
        const stale=window.getSelection().getRangeAt(0).cloneRange();
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(stale);
        el.focus();
        document.dispatchEvent(new Event('selectionchange'));
      });
      assert.equal(await functionControl.isDisabled(),true);
      await clickDisabledControl(functionControl);assert.match(await notice.textContent(),/highlight.*function/);
      await stylesTab.click();assert.match(await notice.textContent(),/structure.*style/);
      await active(kind).locator('['+attribute(kind,'style-category')+'="alignment"]').click();
      const center=active(kind).locator('['+attribute(kind,'style-align')+'="center"]');
      assert.equal(await center.isDisabled(),true);await clickDisabledControl(center);
      assert.equal(await editor(kind).innerHTML(),prose);
      pass(kind+' leaving the editor invalidates the target even when the browser retains an old range; ribbon clicks show guidance instead of styling old text');

      await select(kind,':scope > p',undefined,'Wait for confirmation.');await apply(kind,'rule');
      assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').textContent(),'Wait for confirmation.');
      assert.equal(await editor(kind).locator('p').first().textContent(),'Context before. ');assert.equal(await editor(kind).locator('p').last().textContent(),' Context after.');
      assert.equal(await model(kind).locator('.playbook-preview-check').count(),1);
      const undo=active(kind).locator('['+attribute(kind,'command')+'="undo"]');await undo.click();
      assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),0);assert.equal(await editor(kind).textContent(),'Context before. Wait for confirmation. Context after.');
      await active(kind).locator('['+attribute(kind,'command')+'="redo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),1);
      pass(kind+' assigns only highlighted text, preserves both surrounding fragments, and supports Undo / Redo');

      await select(kind,'[data-playbook-node="rule"]',undefined,null,true);await page.keyboard.press('Enter');await page.keyboard.type('An ordinary explanation after this rule.');
      assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').textContent(),'Wait for confirmation.');
      const ordinary=editor(kind).locator(':scope > p').filter({hasText:'An ordinary explanation after this rule.'});assert.equal(await ordinary.getAttribute('data-playbook-node'),null);
      assert.equal(await model(kind).locator('.playbook-preview-check').count(),1);
      pass(kind+' returns to ordinary writing after Enter at the end of a function');

      await append(kind,'<p id="plain-a">A plain paragraph.</p><p id="plain-b">Another plain paragraph.</p><p id="heading-source">A market view</p>');
      await select(kind,'#plain-a','#plain-b');await style(kind,'alignment','center');await style(kind,'spacing','relaxed');await style(kind,'borders','strong');await style(kind,'presets','card');
      await color(kind,'background','#dceeff');await color(kind,'border','#2457bf');await color(kind,'text','#193046');await color(kind,'accent','#9d3dcc');
      for(const selector of ['#plain-a','#plain-b']){
        const state=await editor(kind).locator(selector).evaluate(el=>{const css=getComputedStyle(el);return {align:css.textAlign,border:css.borderTopWidth,borderColor:css.borderTopColor,fill:css.backgroundColor,color:css.color,padding:css.paddingTop}});
        assert.deepEqual(state,{align:'center',border:'2px',borderColor:'rgb(36, 87, 191)',fill:'rgb(220, 238, 255)',color:'rgb(25, 48, 70)',padding:'12px'});
      }
      const styledModel=model(kind).locator('.playbook-preview-content[data-playbook-preset="card"]');assert.equal(await styledModel.count(),2);
      assert.equal(await styledModel.first().getAttribute('data-playbook-color-border'),'#2457bf');
      await select(kind,'#heading-source');await apply(kind,'h2');assert.equal(await editor(kind).locator('h2').textContent(),'A market view');
      pass(kind+' styles highlighted paragraphs together, updates Live Model immediately, and creates headings from prose');

      await append(kind,'<p id="single-option">One existing line</p><p id="duplicate-a">Same wording</p><p id="duplicate-b">Same wording</p>');
      for(const [first,last] of [['#single-option','#single-option'],['#duplicate-a','#duplicate-b']]){
        await select(kind,first,last);const unchanged=await editor(kind).innerHTML();await apply(kind,'choice');
        assert.equal(await editor(kind).innerHTML(),unchanged);assert.equal(await page.locator('#secondaryInstrumentModal.open').count(),0);assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);
      }
      pass(kind+' rejects insufficient / duplicate choices without a dialog, invented options, or document edits');
      await append(kind,'<p id="all-choice-a"><b>Alpha</b></p><p id="all-choice-b">Beta</p><p id="all-choice-c">Gamma</p>');
      await select(kind,'#all-choice-a','#all-choice-c');await apply(kind,'choice');
      assert.deepEqual(await editor(kind).locator('[data-choice-option]').allTextContents(),['Alpha','Beta','Gamma']);
      assert.equal(await editor(kind).locator('[data-choice-title]').count(),0);assert.equal(await model(kind).locator('.playbook-preview-choice > b').count(),0);
      assert.equal(await model(kind).locator('.playbook-preview-choice-text b').textContent(),'Alpha');
      await backToText(kind);assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);
      pass(kind+' assigns every selected line, including the first, as an option and keeps its existing formatting');

      await append(kind,'<div id="legacy-choice" class="pb-doc-choice" data-playbook-node="choice"><b data-choice-title>User written title</b><div class="pb-doc-choice-options"><div class="pb-doc-choice-option"><span data-choice-option>Original A</span></div><div class="pb-doc-choice-option"><span data-choice-option>Original B</span></div></div></div>');
      await select(kind,'#legacy-choice');const legacy=await editor(kind).locator('#legacy-choice').evaluate(el=>el.outerHTML);await apply(kind,'choice');
      assert.equal(await editor(kind).locator('#legacy-choice').evaluate(el=>el.outerHTML),legacy);assert.equal(await model(kind).locator('.playbook-preview-choice > b').textContent(),'User written title');
      await backToText(kind,true);assert.equal(await editor(kind).locator('[data-choice-title]').count(),0);assert.ok((await editor(kind).textContent()).includes('User written title'));
      pass(kind+' preserves already written titles and choices when their existing function is reassigned');

      await append(kind,'<p id="restore-neighbor">Neighboring writing stays unchanged.</p><div id="restore-choice" class="pb-doc-choice" data-playbook-node="choice"><span class="pb-doc-choice-title" data-choice-title>Moment of entry:</span><div class="pb-doc-choice-options" data-playbook-list-layout="columns-3" data-playbook-align="center" data-playbook-border="strong" data-playbook-color-border="#2457bf">'+['<b>Breakout</b>','1st','2nd','3rd','4th'].map(text=>'<div class="pb-doc-choice-option"><span class="pb-doc-choice-dot" contenteditable="false"></span><span data-choice-option>'+text+'</span></div>').join('')+'</div></div>');
      const neighbor=await editor(kind).locator('#restore-neighbor').evaluate(el=>el.outerHTML);
      await select(kind,'#restore-choice [data-choice-option]',undefined,null,true);await backToText(kind);
      const restored=['Moment of entry:','Breakout','1st','2nd','3rd','4th'];
      const plainRestored=editor(kind).locator(':scope > p').filter({hasText:/^(Moment of entry:|Breakout|1st|2nd|3rd|4th)$/});
      assert.deepEqual(await plainRestored.allTextContents(),restored);assert.equal(await plainRestored.locator('[data-choice-option],.pb-doc-choice-dot').count(),0);
      assert.equal(await plainRestored.locator('b').textContent(),'Breakout');assert.equal(await plainRestored.locator('[data-playbook-node]').count(),0);
      assert.equal(await editor(kind).locator('#restore-neighbor').evaluate(el=>el.outerHTML),neighbor);assert.equal(await model(kind).locator('.playbook-preview-choice').count(),0);
      assert.deepEqual(await page.evaluate(({kind,restored})=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML).filter(item=>restored.includes(item.label)).map(item=>item.type),{kind,restored}),Array(6).fill('content'));
      assert.equal(await plainRestored.filter({hasText:/^Breakout$/}).getAttribute('data-playbook-color-border'),'#2457bf');assert.equal(await plainRestored.filter({hasText:/^Breakout$/}).getAttribute('data-playbook-list-layout'),null);
      await active(kind).locator('['+attribute(kind,'command')+'="undo"]').click();assert.equal(await editor(kind).locator('#restore-choice [data-choice-option]').count(),5);
      await active(kind).locator('['+attribute(kind,'command')+'="redo"]').click();assert.deepEqual(await plainRestored.allTextContents(),restored);
      pass(kind+' Back to text removes a five-option group from its caret, keeps every line / formatting / neighboring content, updates Live Model, and supports Undo / Redo');

      for(const type of ['h3','rule','note','psych-prompt','blockquote','ul','ol']){
        const text='Return '+type+' to ordinary writing.';await append(kind,'<p id="restore-function">'+text+'</p>');await select(kind,'#restore-function');await apply(kind,type);await backToText(kind,true);
        const plain=editor(kind).locator(':scope > p').filter({hasText:text});assert.equal(await plain.count(),1);assert.equal(await plain.getAttribute('data-playbook-node'),null);
        assert.equal(await page.evaluate(({kind,text})=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML).find(item=>item.label===text)?.type,{kind,text}),'content');
      }
      pass(kind+' Back to text also removes Heading / Rule / Note / Reflection prompt / Quote / numbered and bulleted list functions with keyboard activation');

      await append(kind,'<p id="choice-title">Market context: 4H</p><p id="choice-a"><b>Balance</b></p><p id="choice-b">Imbalance</p>');
      await select(kind,'#choice-a','#choice-b');await apply(kind,'choice');
      assert.equal(await page.locator('#secondaryInstrumentModal.open').count(),0);
      assert.equal(await editor(kind).locator('#choice-title').textContent(),'Market context: 4H');
      const choice=editor(kind).locator('[data-playbook-node="choice"]');assert.equal(await choice.count(),1);assert.deepEqual(await choice.locator('[data-choice-option]').allTextContents(),['Balance','Imbalance']);
      assert.equal(await choice.locator('[data-choice-title]').count(),0);assert.equal(await choice.locator('[data-choice-option] b').textContent(),'Balance');
      const item=await page.evaluate(kind=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML).find(item=>item.type==='choice'),kind);assert.equal(item.label,'');assert.deepEqual(item.options,['Balance','Imbalance']);
      const surface=await choice.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderLeftWidth,layout:getComputedStyle(el.querySelector('.pb-doc-choice-options')).display}));
      assert.deepEqual(surface,{background:'rgba(0, 0, 0, 0)',border:'0px',layout:'block'});
      assert.equal(await model(kind).locator('.playbook-preview-choice > b').count(),0);
      await backToText(kind);assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);assert.equal(await model(kind).locator('.playbook-preview-choice').count(),0);
      const candidates=editor(kind).locator(':scope > p').filter({hasText:/^Balance$|^Imbalance$/});
      await candidates.evaluateAll(nodes=>nodes.forEach((node,index)=>node.id='rechoice-'+index));
      await select(kind,'#rechoice-0','#rechoice-1');await apply(kind,'choice');
      await active(kind).locator('['+attribute(kind,'command')+'="undo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),0);
      await active(kind).locator('['+attribute(kind,'command')+'="redo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').count(),1);
      await select(kind,'[data-playbook-node="choice"]');await active(kind).locator('['+attribute(kind,'ribbon')+'="styles"]').click();await active(kind).locator('['+attribute(kind,'list-layout')+'="columns-2"]').click();
      await style(kind,'alignment','center');await style(kind,'borders','strong');await style(kind,'presets','card');await color(kind,'border','#2457bf');
      assert.equal(await model(kind).locator('.playbook-preview-choice-options[data-playbook-list-layout="columns-2"][data-playbook-preset="card"]').count(),1);
      pass(kind+' applies Either / Or immediately to the two selected lines, keeps the surrounding heading, and supports removal / Undo / Redo / Styles');

      await append(kind,'<p id="list-a"><b>Condition one</b></p><p id="list-b">Condition two</p><p id="list-c">Condition three</p><p id="prompt-source">What influenced my decision?</p><p id="note-source">This is guidance, not a condition.</p>');
      await select(kind,'#list-a','#list-c');await apply(kind,'ul');assert.equal(await editor(kind).locator('ul > li').count(),3);assert.equal(await editor(kind).locator('ul > li b').textContent(),'Condition one');
      await active(kind).locator('['+attribute(kind,'ribbon')+'="styles"]').click();await active(kind).locator('['+attribute(kind,'list-layout')+'="columns-3"]').click();
      await style(kind,'alignment','center');await style(kind,'spacing','relaxed');await style(kind,'borders','strong');await style(kind,'presets','card');await color(kind,'border','#2457bf');
      assert.equal(await model(kind).locator('[data-playbook-list-layout="columns-3"][data-playbook-preset="card"]').count(),1);assert.equal(await model(kind).locator('.playbook-preview-check b').textContent(),'Condition one');
      assert.equal(await editor(kind).locator('#prompt-source').getAttribute('data-playbook-node'),null);assert.equal(await editor(kind).locator('#note-source').getAttribute('data-playbook-node'),null);
      await select(kind,'[data-playbook-node="rule"]');await apply(kind,'p');assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),0);
      await active(kind).locator('['+attribute(kind,'command')+'="undo"]').click();assert.equal(await editor(kind).locator('[data-playbook-node="rule"]').count(),1);
      await select(kind,'#prompt-source');await apply(kind,'psych-prompt');assert.equal(await model(kind).locator('.ti-preview-prompt').count(),1);
      await select(kind,'#note-source');await apply(kind,'note');assert.equal(await model(kind).locator('.playbook-preview-note-block').count(),1);
      await select(kind,'[data-playbook-node="choice"] .pb-doc-choice-option:last-child [data-choice-option]',undefined,null,true);await page.keyboard.press('Enter');await page.keyboard.type('Explanation after the choices.');
      assert.equal(await editor(kind).locator('[data-playbook-node="choice"]').textContent().then(text=>text.includes('Explanation after')),false);
      const plainAfterChoice=editor(kind).locator(':scope > p').filter({hasText:'Explanation after the choices.'});assert.equal(await plainAfterChoice.getAttribute('data-playbook-node'),null);
      await select(kind,'ul > li:last-child',undefined,null,true);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('Explanation after the list.');
      const parsed=await page.evaluate(kind=>playbookStructuredPreviewItems(instrumentImageEditor(kind).innerHTML),kind);
      assert.ok(parsed.some(item=>item.type==='content'&&item.label==='Explanation after the choices.'));assert.deepEqual(parsed.filter(item=>item.type==='check').map(item=>item.label),['Wait for confirmation.','Condition one','Condition two','Condition three']);
      assert.equal(await editor(kind).locator('ul li').count(),3);assert.equal(await editor(kind).locator('p').filter({hasText:'Explanation after the list.'}).getAttribute('data-playbook-node'),null);
      pass(kind+' preserves list layouts with all Styles, inline formatting, and explicit Note / Reflection prompt functions');

      await select(kind,'#plain-a');await active(kind).locator('['+attribute(kind,'ribbon')+'="styles"]').click();await active(kind).locator('['+attribute(kind,'style-category')+'="reset"]').click();
      const reset=active(kind).locator(kind==='playbook'?'#playbookStyleResetSelected':'[data-ti-action="reset-style"]');await reset.click();
      assert.equal(await editor(kind).locator('#plain-a').getAttribute('data-playbook-preset'),null);assert.equal(await editor(kind).locator('#plain-a').getAttribute('data-playbook-color-text'),null);
      assert.equal(await editor(kind).locator('#plain-b').getAttribute('data-playbook-preset'),'card');assert.equal(await editor(kind).locator('ul').getAttribute('data-playbook-list-layout'),'columns-3');
      await active(kind).locator(configs[kind].title).focus();assert.equal(await reset.isDisabled(),true);
      await active(kind).locator('['+attribute(kind,'ribbon')+'="home"]').click();assert.equal(await active(kind).locator(configs[kind].functions).isDisabled(),true);
      assert.equal(await active(kind).locator('[data-instrument-back-to-text]').isDisabled(),true);
      pass(kind+' Reset affects only selected content and leaving the editor disables functions and styles');

      await active(kind).locator(configs[kind].save).click();
      const id=await page.evaluate(kind=>instrumentImageDocumentId(kind),kind);
      await switchBuilder(kind==='playbook'?'checklist':'playbook');await switchBuilder(kind);assert.equal(await editor(kind).locator('#plain-b').getAttribute('data-playbook-color-border'),'#2457bf');
      await page.reload({waitUntil:'load'});await switchBuilder(kind);assert.equal(await page.evaluate(kind=>instrumentImageDocumentId(kind),kind),id);
      assert.equal(await editor(kind).locator('ul').getAttribute('data-playbook-preset'),'card');assert.equal(await editor(kind).locator('#plain-b').getAttribute('data-playbook-preset'),'card');
      assert.equal(await editor(kind).locator('[data-choice-title]').count(),0);assert.equal(await editor(kind).locator('.pb-doc-choice-options').getAttribute('data-playbook-list-layout'),'columns-2');
      assert.deepEqual(await plainRestored.allTextContents(),restored);
      await screenshot(kind+'-writing');
      await active(kind).locator(configs[kind].open).click();
      const mapped=page.locator('#executionMapFormBody [data-execution-instrument-section="'+kind+'"]');
      assert.equal(await mapped.locator('.execution-map-information[data-playbook-preset="card"]').count(),1);
      assert.equal(await mapped.locator('[data-playbook-list-layout="columns-3"][data-playbook-border="strong"][data-playbook-color-border="#2457bf"]').count(),1);
      assert.equal(await mapped.locator('.execution-psych-prompt textarea').count(),1,'Only explicit prompts create responses; ordinary prose stays informational');
      assert.equal(await mapped.locator('.execution-map-choice-head > strong').count(),0);assert.equal(await mapped.locator('.execution-map-choice-options b').textContent(),'Balance');assert.equal(await mapped.locator('.execution-map-choice-options').getAttribute('data-playbook-preset'),'card');
      const radios=mapped.locator('input[type="radio"]');assert.equal(await radios.count(),2);await radios.first().check();await radios.last().check();assert.equal(await radios.first().isChecked(),false);
      assert.equal(await mapped.locator('input[type="checkbox"]').count(),4);
      const restoredMapped=mapped.locator('.execution-map-information > span').filter({hasText:/^(Moment of entry:|Breakout|1st|2nd|3rd|4th)$/});assert.deepEqual(await restoredMapped.allTextContents(),restored);
      assert.equal(await restoredMapped.locator('input').count(),0);
      assert.equal(await page.locator('#executionMapFormBody [data-execution-instrument-section]').count(),1);
      await page.locator('#executionBackToInstrumentsBtn').click();
      snapshots[kind]=await page.evaluate(kind=>instrumentImageEditor(kind).innerHTML,kind);
      pass(kind+' Save / switching / reload retain document presentation and map separately into Execution Quality with exclusive choices');
    }
    for(const kind of Object.keys(configs)){await switchBuilder(kind);assert.equal(await editor(kind).innerHTML(),snapshots[kind])}
    await page.setViewportSize({width:390,height:844});await switchBuilder('psych');await active('psych').locator('[data-ti-ribbon="home"]').click();
    const functions=active('psych').locator(configs.psych.functions);await editor('psych').locator('h2').click();assert.equal(await functions.isEnabled(),true);await functions.scrollIntoViewIfNeeded();const box=await functions.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
    const back=active('psych').locator('[data-instrument-back-to-text]');assert.equal(await back.isEnabled(),true);await back.scrollIntoViewIfNeeded();const backBox=await back.boundingBox();assert.ok(backBox.x>=0&&backBox.x+backBox.width<=390);
    await screenshot('writing-mobile');pass('Document stores remain separate and Home Functions stays usable on a phone');
    await page.evaluate(()=>{secondaryFind('psych','[data-ti-title]').focus();window.getSelection().removeAllRanges();secondaryState('psych').selectionRange=null;refreshSecondaryStyleControls('psych')});
    await active('psych').locator('[data-ti-ribbon="styles"]').click();
    const popup=page.locator('#statusBar');assert.equal(await popup.isVisible(),true);
    const mobileTab=await active('psych').locator('[data-ti-ribbon="styles"]').boundingBox();
    await assertGuidanceNear({x:mobileTab.x+mobileTab.width/2,y:mobileTab.y+mobileTab.height/2});
    await screenshot('selection-guidance-mobile');pass('Selection guidance wraps inside the phone viewport');
    for(const point of [{x:8,y:8},{x:382,y:836}]){
      await page.evaluate(point=>showInstrumentSelectionGuidance(INSTRUMENT_SELECTION_GUIDANCE.functions,{type:'pointerdown',clientX:point.x,clientY:point.y}),point);
      await assertGuidanceNear(point);
    }
    await screenshot('selection-guidance-edge');
    await page.evaluate(()=>showStatus('Saved',5000));
    assert.equal(await popup.getAttribute('data-instrument-selection-hint'),null);
    const savedBox=await popup.boundingBox();assert.ok(Math.abs(savedBox.x+savedBox.width-372)<1&&Math.abs(savedBox.y+savedBox.height-826)<1);
    await page.evaluate(()=>showInstrumentSelectionGuidance(INSTRUMENT_SELECTION_GUIDANCE.styles,{type:'pointerdown',clientX:150,clientY:300}));
    await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));assert.equal(await popup.isVisible(),false);
    pass('Guidance stays near viewport-edge clicks, dismisses on scroll and leaves Save notifications in their usual position');
    assert.deepEqual(errors,[]);pass('Browser console and JavaScript remain error-free');console.log('Completed '+checks+' writing checks');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
