// Real Supabase Auth, Storage and RLS checks using disposable fixture users/trades.
// Private fixture JSON arrives on stdin; credentials and tokens never enter output.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'t-ios.html'),'utf8');
const base=source.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const key=source.match(/const SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/)[1];
const bucket='trade-setup-evidence',table='trade_setup_evidence';
let config,page,browser,server,checks=0,originalDownloads=0;
const pass=text=>{checks++;console.log('PASS '+text)};
function input(){
  return new Promise(resolve=>{
    if(process.stdin.isTTY)process.stdin.setRawMode(true);
    console.log('Ready for private QA JSON on stdin.');let value='';
    const listener=chunk=>{value+=chunk.toString();if(value.includes('\n')){process.stdin.removeListener('data',listener);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();resolve(JSON.parse(value.trim()))}};
    process.stdin.on('data',listener);process.stdin.resume();
  });
}
async function login(user){
  const res=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password}),signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('Fixture sign-in failed ('+res.status+').');const session=await res.json();
  session.expires_at=Math.floor(Date.now()/1000)+session.expires_in;assert.equal(session.user.id,user.id);return session;
}
async function api(session,url,{method='GET',body,headers={}}={}){
  return fetch(base+url,{method,headers:{apikey:key,...(session?{Authorization:'Bearer '+session.access_token}:{}),...(body&&typeof body==='object'&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
}
async function rows(session,tradeId){const res=await api(session,'/rest/v1/'+table+'?trade_id=eq.'+tradeId+'&order=slot');if(!res.ok){const error=await res.json();throw Error('Evidence API '+res.status+': '+error.code+' '+error.message)}return res.json()}
const dialog=()=>page.locator('.trade-evidence-dialog');
const card=(slot,scope=dialog())=>scope.locator('[data-evidence-slot="'+slot+'"]');
async function settled(slot,scope=dialog()){
  await page.waitForFunction(({slot,selector})=>document.querySelector(selector+' [data-evidence-slot="'+slot+'"]')?.getAttribute('aria-busy')==='false',{slot,selector:scope===null?'':scope===undefined?'.trade-evidence-dialog':await scope.getAttribute('id')?'#'+await scope.getAttribute('id'):'.trade-evidence-dialog'});
}
async function open(id){
  await page.locator('#journalBody [data-trade-evidence-open="'+id+'"]').click();
  await page.waitForFunction(()=>document.querySelector('.trade-evidence-dialog [data-evidence-action="create"]:not(:disabled)')||document.querySelector('.trade-evidence-dialog [data-evidence-slot="1"]')?.getAttribute('aria-busy')==='false');
}
async function createSetup(){
  await dialog().locator('[data-evidence-action="create"]').click();
  await settled(1);assert.equal(await dialog().locator('[data-evidence-slot]').count(),3);
}
async function upload(slot,name='edge-reference.png',scope=dialog()){
  await card(slot,scope).locator('[data-evidence-file]').setInputFiles(path.join(root,'tests/fixtures',name));
  await settled(slot,scope);assert.match(await card(slot,scope).locator('.trade-evidence-status').textContent(),/Image saved/);
}
async function screenshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png'),fullPage:true})}}

(async()=>{
  config=await input();let owner=await login(config.users[0]);const other=await login(config.users[1]);
  assert.equal(owner.user.user_metadata.tios_evidence_qa,true);assert.equal(other.user.user_metadata.tios_evidence_qa,true);
  // Reset only explicit disposable fixture records when rerunning after a failure.
  if(!config.persistenceOnly)for(const id of config.trades)for(const row of await rows(owner,id)){
    const labels=[{timeframe:'H4',responsibility:'Context'},{timeframe:'H1',responsibility:'Setup'},{timeframe:'M5',responsibility:'Entry'}][row.slot-1];
    const reset=await api(owner,'/rest/v1/'+table+'?id=eq.'+row.id,{method:'PATCH',body:{...labels,original_path:null,thumbnail_path:null,original_name:null,mime_type:null,file_size:null,image_width:null,image_height:null,image_uploaded_at:null}});assert.ok(reset.ok,'Fixture metadata reset failed');
  }
  pass('two disposable accounts sign in through the real Supabase Auth API');
  server=http.createServer((req,res)=>{
    const relative=decodeURIComponent(req.url.split('?')[0]);
    if(relative==='/__supabase.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(process.env.TIOS_SUPABASE_JS))}
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.webp')?'image/webp':'text/html');
    if(file.endsWith('.html'))return res.end((file.endsWith('t-ios.html')?source:fs.readFileSync(file,'utf8')).replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,'<script src="/__supabase.js"></script>').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart.js[^\"]*"><\/script>/,''));
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    browser=await chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER,headless:true,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
    page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Africa/Johannesburg'});page.setDefaultTimeout(60000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Route through the host network in restricted QA environments. Requests,
    // bearer tokens, storage bytes and permission responses remain real.
    await page.route(base+'/**',async route=>{
      try{
        const request=route.request();const response=await fetch(request.url(),{method:request.method(),headers:request.headers(),body:request.postDataBuffer()||undefined,signal:AbortSignal.timeout(20000)});
        const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];
        await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
      }catch{await route.fulfill({status:502,contentType:'application/json',body:'{"message":"QA network request failed"}'})}
    });
    page.on('request',req=>{if(req.method()==='GET'&&req.url().includes('/storage/v1/object/')&&req.url().includes(bucket+'/')&&req.url().includes('/original.'))originalDownloads++});
    const tokenKey='sb-'+new URL(base).hostname.split('.')[0]+'-auth-token';
    await page.addInitScript(({tokenKey,owner})=>{if(!sessionStorage.getItem('evidence-qa-seeded')){localStorage.setItem(tokenKey,JSON.stringify(owner));sessionStorage.setItem('evidence-qa-seeded','1')}},{tokenKey,owner});
    const address='http://127.0.0.1:'+server.address().port+'/t-ios.html';
    await page.goto(address,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>currentUser&&trades.length===2&&document.querySelector('#statusBar')?.textContent==='Journal loaded');
    if(config.persistenceOnly){
      await page.locator('.nav-btn[data-page="journal"]').click();await open(config.trades[0]);
      assert.equal(await card(1).locator('[data-evidence-label="timeframe"]').inputValue(),'D1');
      assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),2);
      pass('a fresh authenticated browser session restores the first trade’s two images and edited labels');
      await page.evaluate(tokenKey=>{tradeEvidence.reset();localStorage.removeItem(tokenKey)},tokenKey);
      await page.goto(address,{waitUntil:'domcontentloaded'});await page.waitForURL('**/index.html?view=home');
      pass('clearing the local sign-in state returns T-IOS to the signed-out home page');
      const renewed=await login(config.users[0]);
      await page.evaluate(({tokenKey,renewed})=>localStorage.setItem(tokenKey,JSON.stringify(renewed)),{tokenKey,renewed});
      await page.goto(address,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>currentUser&&trades.length===2&&document.querySelector('#statusBar')?.textContent==='Journal loaded');
      await page.locator('.nav-btn[data-page="journal"]').click();await open(config.trades[0]);
      assert.equal(await card(1).locator('[data-evidence-label="timeframe"]').inputValue(),'D1');assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),2);
      await card(1).locator('.trade-evidence-upload').click();await page.waitForFunction(()=>!document.querySelector('.trade-evidence-viewport img').hidden);
      await page.locator('.trade-evidence-viewer [data-view="close"]').click();await dialog().locator('[data-evidence-dialog-close]').click();await open(config.trades[1]);
      assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),1);
      pass('a second real Supabase password sign-in restores viewable evidence for both separate trades');
      assert.deepEqual(errors,[]);pass('the complete fresh-login persistence flow has no uncaught browser errors');
      console.log(checks+' persistence checks passed.');return;
    }
    await page.locator('.nav-btn[data-page="journal"]').click();
    const numbers=await page.locator('.journal-trade-number').allTextContents();assert.deepEqual([...numbers].sort(),['Trade 1','Trade 2']);assert.equal(originalDownloads,0);
    pass('trade lists retain continuous numbering and download no original evidence images');
    await open(config.trades[0]);
    assert.equal(await dialog().locator('[data-evidence-slot]').count(),0);
    assert.equal((await rows(owner,config.trades[0])).length,0);
    await screenshot('evidence-optional-desktop');
    await dialog().locator('[data-evidence-dialog-close]').click();
    await page.evaluate(id=>openEditTrade(trades.find(t=>t.id===id)),config.trades[0]);
    await page.locator('#tradeSetupEvidence [data-evidence-action="create"]').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('#tradeSetupEvidence [data-evidence-action="create"]').disabled);
    assert.equal(await page.locator('#tradeSetupEvidence [data-evidence-slot]').count(),0);
    await page.locator('#cancelBtn').click();assert.equal((await rows(owner,config.trades[0])).length,0);
    pass('opening Journal or Edit Trade shows an optional Create button without creating chart slots or evidence records');
    await open(config.trades[0]);await createSetup();
    const emptySetup=await rows(owner,config.trades[0]);assert.equal(emptySetup.length,3);assert.ok(emptySetup.every(row=>row.original_path===null));
    await dialog().locator('[data-evidence-dialog-close]').click();await page.reload();
    await page.waitForFunction(()=>currentUser&&trades.length===2&&document.querySelector('#statusBar')?.textContent==='Journal loaded');
    await page.locator('.nav-btn[data-page="journal"]').click();await open(config.trades[0]);
    assert.equal(await dialog().locator('[data-evidence-slot]').count(),3);assert.equal(await dialog().locator('[data-evidence-action="create"]').count(),0);
    pass('explicit creation persists three empty optional chart slots through refresh without requiring an image');
    assert.deepEqual(await dialog().locator('[data-evidence-label="timeframe"]').evaluateAll(inputs=>inputs.map(el=>el.value)),['H4','H1','M5']);
    assert.deepEqual(await dialog().locator('[data-evidence-label="responsibility"]').evaluateAll(inputs=>inputs.map(el=>el.value)),['Context','Setup','Entry']);
    assert.equal(await dialog().locator('.trade-evidence-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
    await screenshot('evidence-empty-desktop');pass('three equal desktop cards match the reference order and editable default labels');
    await upload(1);await upload(2,'edge-reference.jpg');await upload(3,'edge-reference.webp');
    const first=await rows(owner,config.trades[0]);assert.equal(first.length,3);assert.equal(new Set(first.map(row=>row.original_path)).size,3);
    first.forEach(row=>{assert.equal(row.user_id,owner.user.id);assert.equal(row.trade_id,config.trades[0]);assert.ok(row.original_path.startsWith(owner.user.id+'/'+row.trade_id+'/'+row.slot+'/'))});
    assert.equal(originalDownloads,0);await screenshot('evidence-uploaded-desktop');pass('PNG, JPG and WebP uploads persist in independent slots with separate small previews');
    await card(1).locator('[data-evidence-label="timeframe"]').fill('D1');await card(1).locator('[data-evidence-label="timeframe"]').blur();await settled(1);
    await card(1).locator('[data-evidence-label="responsibility"]').fill('Trend and key levels');await card(1).locator('[data-evidence-label="responsibility"]').blur();await settled(1);
    assert.equal((await rows(owner,config.trades[0]))[0].responsibility,'Trend and key levels');pass('timeframe and responsibility edits save independently of trade notes and scores');
    await dialog().locator('[data-evidence-dialog-close]').click();await open(config.trades[1]);
    assert.equal(await dialog().locator('[data-evidence-slot]').count(),0);assert.equal((await rows(owner,config.trades[1])).length,0);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await dialog().locator('[data-evidence-action="create"]').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await screenshot('evidence-optional-mobile');await page.setViewportSize({width:1440,height:900});
    pass('another trade independently offers creation, including on mobile, without inheriting the first trade’s setup');
    const concurrent=await api(owner,'/rest/v1/'+table,{method:'POST',body:{user_id:owner.user.id,trade_id:config.trades[1],slot:1,timeframe:'W1',responsibility:'Existing context'}});assert.ok(concurrent.ok);
    await createSetup();assert.equal(await card(1).locator('[data-evidence-label="timeframe"]').inputValue(),'W1');
    assert.equal((await rows(owner,config.trades[1]))[0].responsibility,'Existing context');
    pass('creating a setup preserves older or concurrently saved timeframe labels');
    assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),0);await upload(2);
    const second=await rows(owner,config.trades[1]);assert.equal(second.length,3);assert.equal(second.filter(row=>row.original_path).length,1);pass('a created setup can upload only its middle chart while leaving the other slots empty');
    await dialog().locator('[data-evidence-dialog-close]').click();
    await page.reload();await page.waitForFunction(()=>currentUser&&trades.length===2);await page.locator('.nav-btn[data-page="journal"]').click();await open(config.trades[0]);
    assert.equal(await card(1).locator('[data-evidence-label="timeframe"]').inputValue(),'D1');assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),3);assert.equal(originalDownloads,0);
    pass('refresh restores all three images and edited labels, loading thumbnails only');
    await card(1).locator('.trade-evidence-upload').click();await page.waitForFunction(()=>!document.querySelector('.trade-evidence-viewport img').hidden);
    const viewer=page.locator('.trade-evidence-viewer');assert.equal(originalDownloads,1);
    await viewer.locator('[data-view="actual"]').click();assert.equal(await viewer.locator('output').textContent(),'100%');
    await viewer.locator('[data-view="in"]').click();assert.equal(await viewer.locator('output').textContent(),'125%');
    for(let i=0;i<5;i++)await viewer.locator('[data-view="in"]').click();
    const image=viewer.locator('.trade-evidence-viewport img'),before=await image.getAttribute('style'),bounds=await viewer.locator('.trade-evidence-viewport').boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+70,bounds.y+bounds.height/2+40);await page.mouse.up();assert.notEqual(await image.getAttribute('style'),before);
    await screenshot('evidence-viewer');await page.keyboard.press('Escape');assert.equal(await viewer.isVisible(),false);assert.equal(await dialog().isVisible(),true);
    pass('full image downloads on demand; 100% inspection, zoom, panning and Escape return to the same trade');
    const old=(await rows(owner,config.trades[0]))[0];await upload(1,'edge-reference.jpg');const replacement=(await rows(owner,config.trades[0]))[0];assert.notEqual(replacement.original_path,old.original_path);
    const oldResponse=await api(owner,'/storage/v1/object/authenticated/'+bucket+'/'+old.original_path);assert.ok(!oldResponse.ok);
    pass('replacement saves a new immutable image before deleting the previous original and preview');
    await card(3).locator('[data-evidence-action="remove"]').click();await settled(3);assert.equal((await rows(owner,config.trades[0]))[2].original_path,null);assert.equal((await rows(owner,config.trades[0]))[2].timeframe,'M5');
    pass('removing one image preserves its timeframe labels and the other chart slots');
    await page.setViewportSize({width:390,height:844});assert.equal(await dialog().locator('.trade-evidence-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot('evidence-mobile');
    await card(2).locator('.trade-evidence-actions [data-evidence-action="view"]').click();await page.waitForFunction(()=>!document.querySelector('.trade-evidence-viewport img').hidden);assert.equal(await viewer.locator('[data-view="close"]').isVisible(),true);await viewer.locator('[data-view="close"]').click();
    pass('mobile cards stack without horizontal overflow and the image viewer keeps controls accessible');
    await page.setViewportSize({width:1440,height:900});await dialog().locator('[data-evidence-dialog-close]').click();
    await page.evaluate(id=>openEditTrade(trades.find(t=>t.id===id)),config.trades[0]);await settled(1,page.locator('#tradeSetupEvidence'));
    await page.locator('#notes').fill('Unsaved journal state must survive chart inspection.');await card(1,page.locator('#tradeSetupEvidence')).locator('.trade-evidence-actions [data-evidence-action="view"]').click();await page.waitForFunction(()=>!document.querySelector('.trade-evidence-viewport img').hidden);await viewer.locator('[data-view="close"]').click();
    assert.equal(await page.locator('#notes').inputValue(),'Unsaved journal state must survive chart inspection.');await page.locator('#cancelBtn').click();
    pass('the same cards work inside Edit Trade and viewing does not discard an unsaved journal note');
    await page.evaluate(()=>{executionMappingTradeId=trades[0].id;renderExecutionMappingTradeContext()});assert.equal(await page.locator('#executionMapEvidenceBtn').getAttribute('data-trade-evidence-open'),await page.evaluate(()=>trades[0].id));
    pass('Execution Quality opens evidence for its selected individual trade');
    const latest=(await rows(owner,config.trades[0]))[0];
    assert.deepEqual(await rows(other,config.trades[0]),[]);
    const foreignInsert=await api(other,'/rest/v1/'+table,{method:'POST',body:{user_id:other.user.id,trade_id:config.trades[0],slot:1,timeframe:'H4',responsibility:'Context'}});assert.equal(foreignInsert.status,403);
    const foreignUpdate=await api(other,'/rest/v1/'+table+'?id=eq.'+latest.id,{method:'PATCH',body:{responsibility:'Unauthorized change'},headers:{Prefer:'return=representation'}});assert.equal(foreignUpdate.status,200);assert.deepEqual(await foreignUpdate.json(),[]);
    const foreignDownload=await api(other,'/storage/v1/object/authenticated/'+bucket+'/'+latest.original_path);assert.ok(!foreignDownload.ok);
    const publicDownload=await api(null,'/storage/v1/object/public/'+bucket+'/'+latest.original_path);assert.ok(!publicDownload.ok);
    const anonymousMetadata=await api(null,'/rest/v1/'+table);assert.ok(!anonymousMetadata.ok);
    const foreignUpload=await api(other,'/storage/v1/object/'+bucket+'/'+other.user.id+'/'+config.trades[0]+'/1/00000000-0000-4000-8000-000000000003/original.png',{method:'POST',body:fs.readFileSync(path.join(root,'tests/fixtures/edge-reference.png')),headers:{'Content-Type':'image/png'}});assert.ok(!foreignUpload.ok);
    assert.equal((await rows(owner,config.trades[0]))[0].responsibility,'Trend and key levels');
    pass('a second signed-in user cannot read, edit, attach images to, or download another user’s evidence; anonymous/public access is denied');
    // Forget only the fixture browser credentials, then establish a fresh real
    // password session. Remote auth-session revocation is outside this feature.
    await page.evaluate(tokenKey=>{tradeEvidence.reset();localStorage.removeItem(tokenKey)},tokenKey);
    await page.goto(address,{waitUntil:'domcontentloaded'});await page.waitForURL('**/index.html?view=home');
    const renewed=await login(config.users[0]);
    owner=renewed;
    await page.evaluate(({tokenKey,renewed})=>localStorage.setItem(tokenKey,JSON.stringify(renewed)),{tokenKey,renewed});
    await page.goto(address);await page.waitForFunction(()=>currentUser&&trades.length===2);await page.locator('.nav-btn[data-page="journal"]').click();await open(config.trades[0]);
    assert.equal(await card(1).locator('[data-evidence-label="timeframe"]').inputValue(),'D1');assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),2);
    await dialog().locator('[data-evidence-dialog-close]').click();await open(config.trades[1]);assert.equal(await dialog().locator('[data-evidence-action="remove"]:visible').count(),1);
    pass('clearing local sign-in and a fresh password login restore each trade’s separate evidence set');
    assert.deepEqual(errors,[]);pass('no uncaught browser errors during the complete evidence flow');
    console.log(checks+' live evidence checks passed.');
  }finally{
    try{if(!config.persistenceOnly){
    // Remove fixture files through the Storage API, never direct storage.objects SQL.
    const res=await api(owner,'/storage/v1/object/list/'+bucket,{method:'POST',body:{prefix:owner.user.id,limit:100}});
    if(!res.ok)console.log('Fixture storage cleanup requires follow-up.');
    const objectPaths=(await Promise.all(config.trades.map(id=>rows(owner,id)))).flat().flatMap(row=>[row.original_path,row.thumbnail_path]).filter(Boolean);
    if(objectPaths.length){const removed=await api(owner,'/storage/v1/object/'+bucket,{method:'DELETE',body:{prefixes:objectPaths}});assert.ok(removed.ok,'Fixture file cleanup failed')}
    }}catch(error){console.log('Fixture cleanup: '+error.message)}
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error('FAIL '+error.stack);process.exitCode=1});
