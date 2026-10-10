// Full UI → real Supabase Auth/RLS/preferences → restored UI, plus official live widgets.
// Requires two explicitly marked disposable users. Credentials arrive privately on stdin.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'t-ios.html'),'utf8');
const base=source.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/)[1],key=source.match(/const SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/)[1];
const table='chart_workspace_preferences',P=require('../core/chart-workspace.js');
let browser,server,page,checks=0,address,config,widgetRequests=0;
const errors=[],pass=text=>{checks++;console.log('PASS '+text)},cards=()=>page.locator('[data-chart-id]'),card=id=>page.locator('[data-chart-id="'+id+'"]');
function input(){return new Promise(resolve=>{if(process.stdin.isTTY)process.stdin.setRawMode(true);console.log('Ready for private Charts QA JSON on stdin.');let value='';const listener=chunk=>{value+=chunk.toString();if(value.includes('\n')){process.stdin.removeListener('data',listener);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();resolve(JSON.parse(value.trim()))}};process.stdin.on('data',listener);process.stdin.resume()})}
async function login(user){const r=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password}),signal:AbortSignal.timeout(20000)});assert.ok(r.ok,'QA sign-in failed: '+r.status);const s=await r.json();s.expires_at=Math.floor(Date.now()/1000)+s.expires_in;assert.equal(s.user.id,user.id);assert.equal(s.user.user_metadata.tios_charts_qa,true);return s}
async function api(session,suffix='',options={}){return fetch(base+'/rest/v1/'+table+suffix,{method:options.method||'GET',headers:{apikey:key,...(session?{Authorization:'Bearer '+session.access_token}:{}),...(options.body?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(20000)})}
async function row(session){const r=await api(session,'?user_id=eq.'+session.user.id);assert.ok(r.ok);return (await r.json())[0]}
async function open(){await page.locator('.nav-btn[data-page="charts"]').click();await cards().first().waitFor()}
async function save(){const button=page.locator('[data-charts-action="save"]');if(await button.isEnabled())await button.click();await page.waitForFunction(()=>document.querySelector('[data-charts-status]')?.textContent==='Preferences saved')}
async function snapshot(name){if(process.env.TIOS_TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TIOS_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TIOS_TEST_SCREENSHOT_DIR,name+'.png')})}}
async function broker(route){try{const request=route.request(),response=await fetch(request.url(),{method:request.method(),headers:request.headers(),body:request.postDataBuffer()||undefined,signal:AbortSignal.timeout(30000)});const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})}catch{await route.fulfill({status:502,contentType:'text/plain',body:'QA network request failed'})}}
async function createPage(session,viewport={width:1440,height:1000}){
 const p=await browser.newPage({viewport,ignoreHTTPSErrors:!!process.env.TIOS_TEST_PROXY});p.setDefaultTimeout(60000);
 p.on('pageerror',e=>{if(!/https:\/\/[^/]*(?:tradingview\.com|tradingview-widget\.com)\//.test(e.stack||''))errors.push(e.message)});
 if(process.env.TIOS_TEST_NETWORK_BROKER){
  await p.route(base+'/**',broker);await p.route(/https:\/\/[^/]*(?:tradingview\.com|tradingview-widget\.com)\//,broker);
  if(address.startsWith('https:')){await p.route(new URL(address).origin+'/**',broker);await p.route('https://cdn.jsdelivr.net/**',broker)}
 }
 p.on('request',r=>{if(r.url().includes('embed-widget-advanced-chart.js'))widgetRequests++});
 const tokenKey='sb-'+new URL(base).hostname.split('.')[0]+'-auth-token';
 await p.addInitScript(({tokenKey,session})=>{if(!sessionStorage.getItem('charts-qa-seeded')){localStorage.setItem(tokenKey,JSON.stringify(session));sessionStorage.setItem('charts-qa-seeded','1')}},{tokenKey,session});
 await p.goto(address,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>currentUser&&document.querySelector('#statusBar')?.textContent==='Journal loaded');return p;
}
async function liveChart(id){
 const host=await card(id).locator('iframe.charts-frame').elementHandle();const hostFrame=await host.contentFrame();
 await hostFrame.locator('.tradingview-widget-container iframe').waitFor();
 const embedded=await hostFrame.locator('.tradingview-widget-container iframe').elementHandle(),chart=await embedded.contentFrame();
 await chart.waitForFunction(()=>document.querySelectorAll('canvas').length>=2,{},{timeout:90000});
 return chart;
}
async function launchBrowser(){return chromium.launch({executablePath:process.env.TIOS_TEST_BROWSER,headless:true,...(process.env.TIOS_TEST_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']})}
(async()=>{
 config=await input();const owner=await login(config.users[0]),other=await login(config.users[1]);
 // Reruns reset only this explicitly marked QA user's chart defaults, never real users.
 if(await row(owner)){const reset=await api(owner,'?user_id=eq.'+owner.user.id,{method:'PATCH',body:{configuration:P.defaults()}});assert.ok(reset.ok)}
 const initialRow=await row(owner);
 pass('both disposable users authenticate with the real Supabase service');
 server=http.createServer((req,res)=>{const relative=decodeURIComponent(req.url.split('?')[0]);if(relative==='/__supabase.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(process.env.TIOS_SUPABASE_JS))}const file=path.resolve(root,'.'+relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');if(file.endsWith('.html'))return res.end(fs.readFileSync(file,'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,'<script src="/__supabase.js"></script>').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart.js[^\"]*"><\/script>/,''));res.end(fs.readFileSync(file))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));address=process.env.TIOS_TEST_BASE_URL||'http://127.0.0.1:'+server.address().port+'/t-ios.html';
 try{
  browser=await launchBrowser();
  page=await createPage(owner);
  assert.equal(widgetRequests,0);assert.equal(await page.locator('#chartsWorkspace iframe').count(),0);
  const nav=await page.locator('.nav').evaluate(el=>Array.from(el.children).map(n=>n.dataset.page||n.dataset.navGroup));assert.deepEqual(nav.slice(0,3),['dashboard','charts','technical']);
  pass('Charts is directly below Dashboard, and Dashboard loads no TradingView widgets');
  await open();assert.equal(await cards().count(),1);assert.equal(await page.locator('.charts-frame').count(),1);assert.deepEqual(await row(owner),initialRow);
  pass('Single Chart is the optional initial layout; opening it creates no database record');
  await card('single').locator('[data-chart-field="symbol"]').fill('BINANCE:BTCUSDT');await card('single').locator('button[type="submit"]').click();
  const chart=await liveChart('single');
  assert.ok((await chart.locator('canvas').count())>=2);const ui=await chart.locator('body').innerText();assert.match(ui,/BTC|Bitcoin|BINANCE/i);
  console.log('TradingView controls: '+JSON.stringify((await chart.locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')||n.title||n.textContent).filter(Boolean))).slice(0,35)));
  await chart.getByRole('button',{name:'Indicators, metrics, and strategies',exact:true}).first().click();
  console.log('Indicator search fields: '+JSON.stringify(await chart.locator('input').evaluateAll(nodes=>nodes.map(n=>({type:n.type,role:n.getAttribute('role'),placeholder:n.getAttribute('placeholder')})))));
  const search=chart.locator('input:visible').first();await search.waitFor({state:'visible'});await search.fill('Relative Strength Index');
  await search.press('Escape');
  pass('the native indicator selector opens and supports searching within the official widget');
  await snapshot('charts-single-desktop');pass('the official widget renders actual Bitcoin chart canvases and native controls');
  await card('single').locator('[data-chart-field="responsibility"]').fill('Trend and key levels');
  const oldSingle=await card('single').locator('.charts-frame').getAttribute('src');await save();assert.equal(await card('single').locator('.charts-frame').getAttribute('src'),oldSingle);
  assert.equal(JSON.parse(decodeURIComponent(new URL(oldSingle).hash.slice(1))).chart.responsibility,'');assert.equal(oldSingle.includes(owner.user.id),false);
  const singleSaved=await row(owner);assert.equal(singleSaved.configuration.charts.single[0].symbol,'BINANCE:BTCUSDT');assert.equal(singleSaved.configuration.charts.single[0].responsibility,'Trend and key levels');
  pass('saving labels and unchanged widget settings preserves the running chart and persists real preferences');
  await page.locator('[data-charts-layout="multiple"]').click();assert.equal(await cards().count(),3);assert.equal(await page.locator('.charts-frame').count(),3);
  assert.deepEqual(await cards().locator('[data-chart-field="interval"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['240','60','5']);
  assert.deepEqual(await cards().locator('[data-chart-field="responsibility"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['Market Context','Setup Development','Entry Execution']);
  for(const id of ['context','setup','entry']){await card(id).locator('[data-chart-field="symbol"]').fill('BINANCE:BTCUSDT');await card(id).locator('button[type="submit"]').click()}
  const charts=[];for(const id of ['context','setup','entry'])charts.push(await liveChart(id));assert.equal(new Set(charts).size,3);
  assert.equal(await page.locator('.charts-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
  await snapshot('charts-multiple-desktop');pass('three independent live charts render horizontally with H4, H1 and M5 defaults');
  const before=await card('setup').locator('.charts-frame').getAttribute('src'),unaffected=await card('context').locator('.charts-frame').getAttribute('src');
  await card('entry').locator('[data-chart-field="interval"]').selectOption('15');await card('entry').locator('[data-chart-field="responsibility"]').fill('Confirmation and timing');
  assert.equal(await card('setup').locator('.charts-frame').getAttribute('src'),before);assert.equal(await card('context').locator('.charts-frame').getAttribute('src'),unaffected);
  pass('changing one chart timeframe and responsibility leaves both other widget instances intact');
  const retained=await card('setup').locator('.charts-frame').elementHandle();await card('setup').locator('[data-charts-action="expand"]').click();assert.equal(await card('setup').getAttribute('aria-modal'),'true');
  assert.equal(await retained.evaluate(el=>el.isConnected),true);const expanded=await card('setup').boundingBox();assert.ok(expanded.width>1380&&expanded.height>950);await snapshot('charts-expanded-desktop');
  await page.keyboard.press('Escape');assert.equal(await card('setup').getAttribute('aria-modal'),null);assert.equal(await retained.evaluate(el=>el.isConnected),true);
  await page.locator('#desktopSidebarCollapseBtn').click();assert.equal(await retained.evaluate(el=>el.isConnected),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#desktopSidebarReopenBtn').click();
  pass('Expand/Return and sidebar resizing retain the same chart frame without horizontal page scrolling');
  await save();await page.locator('[data-charts-layout="single"]').click();assert.equal(await card('single').locator('[data-chart-field="symbol"]').inputValue(),'BINANCE:BTCUSDT');assert.equal(await card('single').locator('[data-chart-field="responsibility"]').inputValue(),'Trend and key levels');
  await page.locator('[data-charts-layout="multiple"]').click();assert.equal(await card('entry').locator('[data-chart-field="interval"]').inputValue(),'15');await save();
  pass('switching layouts preserves the independent Single and Multiple settings');
  await page.locator('.nav-btn[data-page="journal"]').click();assert.equal(await page.locator('.charts-frame').count(),0);assert.equal(await page.locator('#page-journal').isVisible(),true);
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('charts-workspace')),false);await open();assert.equal(await card('entry').locator('[data-chart-field="interval"]').inputValue(),'15');
  pass('leaving Charts disposes every widget and restores normal Journal navigation');
  await page.reload();await page.waitForFunction(()=>currentUser&&document.querySelector('#statusBar')?.textContent==='Journal loaded');assert.equal(await page.locator('.charts-frame').count(),0);await open();assert.equal(await cards().count(),3);assert.equal(await card('entry').locator('[data-chart-field="interval"]').inputValue(),'15');
  pass('refresh restores the saved mode, symbols, timeframes and responsibility labels');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.charts-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await card('entry').scrollIntoViewIfNeeded();assert.equal(await card('entry').locator('[data-chart-field="responsibility"]').isVisible(),true);await snapshot('charts-multiple-mobile');
  await card('entry').locator('[data-charts-action="expand"]').click();const mobile=await card('entry').boundingBox();assert.ok(mobile.width<=390&&mobile.x>=0);await snapshot('charts-expanded-mobile');await card('entry').locator('[data-charts-action="expand"]').click();
  await page.locator('[data-charts-layout="single"]').click();await snapshot('charts-single-mobile');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  pass('mobile charts stack, remain accessible and expand without clipped controls or page overflow');
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-charts-layout="multiple"]').click();await save();
  const renewed=await login(config.users[0]);await page.evaluate(async()=>{await db.auth.signOut({scope:'local'})});await page.waitForURL('**/index.html?view=home');
  await page.close();await browser.close();browser=await launchBrowser();page=await createPage(renewed);await open();assert.equal(await cards().count(),3);assert.equal(await card('entry').locator('[data-chart-field="responsibility"]').inputValue(),'Confirmation and timing');
  pass('real sign-out followed by another sign-in in a fresh browser context restores preferences from Supabase');
  const current=await row(renewed),external=P.clone(current.configuration);external.charts.multiple[0].responsibility='Saved on another device';const edit=await api(renewed,'?user_id=eq.'+renewed.user.id+'&revision=eq.'+current.revision,{method:'PATCH',body:{configuration:external}});assert.ok(edit.ok);
  await card('context').locator('[data-chart-field="responsibility"]').fill('Older unsaved local change');await page.locator('[data-charts-action="save"]').click();await page.locator('[data-charts-action="reload"]').waitFor({state:'visible'});assert.equal((await row(renewed)).configuration.charts.multiple[0].responsibility,'Saved on another device');
  await page.locator('[data-charts-action="reload"]').click();await cards().first().waitFor();assert.equal(await card('context').locator('[data-chart-field="responsibility"]').inputValue(),'Saved on another device');
  pass('a stale device cannot overwrite newer cloud preferences; Reload resolves the revision conflict');
  const foreign=await api(other,'?user_id=eq.'+renewed.user.id);assert.ok(foreign.ok);assert.deepEqual(await foreign.json(),[]);
  const forged=await api(other,'',{method:'POST',body:{user_id:renewed.user.id,configuration:P.defaults()}});assert.equal(forged.status,403);
  const changedForeign=await api(other,'?user_id=eq.'+renewed.user.id,{method:'PATCH',body:{configuration:P.defaults()}});assert.ok(changedForeign.ok);assert.deepEqual(await changedForeign.json(),[]);
  const anonymous=await api(null);assert.ok([401,403].includes(anonymous.status),'Anonymous reads must be denied');
  pass('real RLS rejects another user’s insert, hides their rows and prevents updates; anonymous reads are denied');
  const bad=P.defaults();bad.charts.single[0].symbol='<script>alert(1)</script>';const invalid=await api(renewed,'?user_id=eq.'+renewed.user.id,{method:'PATCH',body:{configuration:bad}});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'23514');
  const stolen=await api(renewed,'?user_id=eq.'+renewed.user.id,{method:'PATCH',body:{user_id:other.user.id}});assert.ok(!stolen.ok);
  pass('server constraints reject malformed configurations and immutable ownership prevents moving a preferences row');
  await page.close();await browser.close();browser=await launchBrowser();page=await createPage(other);await open();assert.equal(await cards().count(),1);assert.equal(await card('single').locator('[data-chart-field="responsibility"]').inputValue(),'Market analysis');assert.equal(await row(other),undefined);
  pass('a different account opens clean defaults without the first user’s chart preferences');
  assert.deepEqual(errors,[]);pass('the full Charts flow has no uncaught application errors');
  console.log(checks+' Charts browser checks passed.');
 }finally{if(page&&!page.isClosed())await page.close();if(browser)await browser.close();server.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
