// Isolated browser checks: no real account or external service writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=process.env.HIOS_QA_OUTPUT;
let checks=0;
const pass=message=>{checks++;console.log('PASS '+message)};
function luminance(color){const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*values[0]+.7152*values[1]+.0722*values[2]}
async function run(){
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(file.endsWith('.html')?bytes.toString().replace(/<script src="https:\/\/[^\"]+"><\/script>/g,''):bytes)});
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.HIOS_TEST_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.route('https://**/*',route=>route.abort());
    await context.addInitScript(()=>{
      window.supabase={createClient:()=>({auth:{getSession:()=>/\/(t|s)-ios\.html$/.test(location.pathname)?new Promise(()=>{}):Promise.resolve({data:{session:{user:{id:'00000000-0000-4000-8000-000000000001'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}})};
      if(!localStorage.getItem('qa_theme_seed')){
        localStorage.setItem('hios_added_products_v1',JSON.stringify(['gios','tios']));
        localStorage.setItem('hios_gios_goals_v2',JSON.stringify([]));
        localStorage.setItem('qa_theme_seed','1');
      }
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const origin='http://127.0.0.1:'+server.address().port;
    const screenshot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name)})}};
    const launch=async()=>{
      const reopen=page.locator('#desktopSidebarReopenBtn');
      if(await reopen.count()&&await reopen.isVisible())await reopen.click();
      await page.locator('.hios-theme-button:visible').first().click();
    };
    const choose=id=>page.locator(`[data-theme-choice="${id}"]`).click();
    const colors=()=>page.evaluate(()=>{
      const style=selector=>getComputedStyle(document.querySelector(selector));
      return {body:style('body').backgroundImage,header:style('.hios-top-row').backgroundImage,calendar:style('.calendar-card').backgroundImage+' '+style('.calendar-card').backgroundColor,card:style('.hios-domain').backgroundColor,text:style('.hios-level-progress-meta > span').color,button:style('.sidebar-add-product').backgroundImage,good:style(':root').getPropertyValue('--good'),danger:style(':root').getPropertyValue('--danger')};
    });
    await page.goto(origin,{waitUntil:'load'});
    const original=await colors(),storedGoals=await page.evaluate(()=>localStorage.getItem('hios_gios_goals_v2'));
    assert.equal(await page.locator('html').getAttribute('data-hios-theme'),'blue');
    await launch();
    assert.equal(await page.locator('.hios-theme-choice').count(),5);
    await screenshot('theme-picker.png');
    for(const id of ['graphite','forest','sand','amethyst','blue']){
      await choose(id);
      assert.equal(await page.locator('html').getAttribute('data-hios-theme'),id);
      assert.equal(await page.locator('[data-theme-choice][aria-pressed="true"]').count(),1);
      assert.equal(await page.evaluate(()=>localStorage.getItem('hios_color_theme_v1')),id);
      assert.equal(await page.evaluate(()=>localStorage.getItem('hios_gios_goals_v2')),storedGoals);
      await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.waitForTimeout(200); // Let the existing card color transition finish.
      const current=await colors();
      assert.equal(current.good,original.good);assert.equal(current.danger,original.danger);
      if(id==='blue')assert.deepEqual(current,original,'original colors restore exactly');
      else{for(const part of ['body','header','calendar','card','button'])assert.notEqual(current[part],original[part],id+' changes '+part)}
      const contrast=(luminance(current.text)+.05)/(luminance(current.card)+.05);
      assert.ok(contrast>=4.5,`${id} intelligence label contrast ${contrast}`);
      if(id!=='blue'){
        const ink=await page.locator('.sidebar-add-product').evaluate(el=>getComputedStyle(el).color);
        for(const stop of current.button.match(/rgba?\([^)]*\)/g))assert.ok((luminance(stop)+.05)/(luminance(ink)+.05)>=4.5,id+' primary action contrast');
      }
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).filter),'none');
      await screenshot(id+'.png');
      await launch();
    }
    for(const hex of ['#ff3300','#000000','#ffffff','#7c3aed']){
      await page.getByLabel('HEX',{exact:true}).fill(hex);
      assert.equal(await page.locator('html').getAttribute('data-hios-theme'),'custom');
      assert.equal(await page.getByLabel('Custom theme color',{exact:true}).inputValue(),hex);
      const current=await colors();assert.equal(current.good,original.good);assert.equal(current.danger,original.danger);
    }
    await page.getByLabel('HEX',{exact:true}).fill('#xyz');
    assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('hios_color_theme_v1'))).color,'#7c3aed');
    await page.getByLabel('Custom theme color',{exact:true}).evaluate(input=>{input.value='#ff8800';input.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.getByLabel('HEX',{exact:true}).inputValue(),'#ff8800');
    await screenshot('custom-color.png');
    await page.keyboard.press('Escape');await page.reload({waitUntil:'load'});
    assert.equal(await page.locator('html').getAttribute('data-hios-theme'),'custom');
    await launch();assert.equal(await page.getByLabel('Custom theme color',{exact:true}).inputValue(),'#ff8800');
    const customPeer=await context.newPage();await customPeer.goto(origin+'/g-ios.html');
    assert.equal(await customPeer.locator('html').getAttribute('data-hios-theme'),'custom');
    await page.getByLabel('HEX',{exact:true}).fill('#36b5a0');
    await customPeer.waitForFunction(()=>document.documentElement.style.getPropertyValue('--hios-theme-accent').includes('170'));
    await customPeer.close();
    pass('custom color block and HEX entry accept any hue, reject invalid input and persist through reload');
    await choose('forest');await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('hios-theme-button')),true);
    pass('all five palettes change the full dashboard, restore blue exactly, retain semantic colors and readable level labels');
    await page.reload({waitUntil:'load'});
    assert.equal(await page.locator('html').getAttribute('data-hios-theme'),'forest');
    const peer=await context.newPage();await peer.goto(origin+'/g-ios.html');
    assert.equal(await peer.locator('html').getAttribute('data-hios-theme'),'forest');
    await launch();await choose('sand');await page.keyboard.press('Escape');
    await peer.waitForFunction(()=>document.documentElement.dataset.hiosTheme==='sand');await peer.close();
    pass('theme persists through reload, product navigation and an already open second tab');
    for(const filename of ['g-ios.html','t-ios.html','s-ios.html','health-ios.html','h-ios.html']){
      await page.goto(origin+'/'+filename,{waitUntil:'load'});
      if(filename==='t-ios.html'||filename==='s-ios.html')await page.evaluate(()=>setLoggedInUI(true));
      assert.equal(await page.locator('html').getAttribute('data-hios-theme'),'sand');
      const before=await page.locator('.sidebar').evaluate(el=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).backgroundColor}));
      await launch();await choose('graphite');await page.keyboard.press('Escape');
      const after=await page.locator('.sidebar').evaluate(el=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).backgroundColor}));
      assert.notDeepEqual(after,before,filename+' sidebar follows the theme');
      if(filename==='t-ios.html'){
        await page.evaluate(()=>switchTechnicalInstrumentBuilder('playbook'));
        await page.locator('#playbookDocumentEditor').evaluate(el=>{el.innerHTML='<p id="qa-authored-color" style="color:#24364b;background:#eef7ff;border:1px solid #0066ff">Authored colors</p>';el.dispatchEvent(new Event('input',{bubbles:true}))});
        const authored=()=>page.locator('#qa-authored-color').evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor}));
        const preserved=await authored();
        await launch();await choose('amethyst');await page.keyboard.press('Escape');
        assert.deepEqual(await authored(),preserved,'authored Playbook colors remain unchanged');
      }
      await launch();await choose('sand');await page.keyboard.press('Escape');
    }
    pass('all six family pages support the shared preference; authored Playbook colors remain intact');
    await page.goto(origin,{waitUntil:'load'});
    for(const [width,height] of [[768,900],[390,844],[320,568]]){
      await page.setViewportSize({width,height});await launch();
      assert.equal(await page.locator('.hios-theme-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      await choose('amethyst');await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1),true);
      const overlaps=await page.evaluate(()=>{
        const theme=document.querySelector('.sidebar .hios-theme-button').getBoundingClientRect();
        return ['.sidebar-add-product','#hiosSignOut'].some(selector=>{const other=document.querySelector(selector).getBoundingClientRect();return Math.min(theme.right,other.right)>Math.max(theme.left,other.left)&&Math.min(theme.bottom,other.bottom)>Math.max(theme.top,other.top)});
      });
      assert.equal(overlaps,false,width+' mobile theme control does not overlap navigation');
    }
    pass('tablet and mobile picker stays usable without page scrolling or overlapping navigation');
    const blocked=await browser.newContext({viewport:{width:1440,height:900}});
    await blocked.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError')}})});
    await blocked.route('https://**/*',route=>route.abort());
    const fallback=await blocked.newPage();await fallback.goto(origin+'/health-ios.html');
    await fallback.locator('.hios-theme-button:visible').first().click();await fallback.locator('[data-theme-choice="forest"]').click();
    assert.equal(await fallback.locator('html').getAttribute('data-hios-theme'),'forest');
    assert.match(await fallback.locator('.hios-theme-save-status').innerText(),/this visit/);
    await blocked.close();pass('theme remains selectable when browser storage is unavailable');
    assert.deepEqual(errors,[]);pass('no page JavaScript errors during theme selection and family navigation');
    await context.close();console.log(`${checks} theme checks passed`);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
