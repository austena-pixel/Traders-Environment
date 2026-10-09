// Isolated UI/connection regression test. Requires Playwright and Chromium.
// No real account is signed in and no requests write to external services.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const output=process.env.HIOS_QA_OUTPUT;
const user='00000000-0000-4000-8000-000000000001';
let checks=0;
function passed(message){checks++;console.log('PASS '+message)}
async function run(){
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data)});
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.HIOS_TEST_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.route('https://**/*',route=>route.request().url().includes('@supabase/supabase-js')?route.fulfill({contentType:'text/javascript',body:''}):route.abort());
    await context.addInitScript(({user})=>{
      window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:user}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}})};
      if(!localStorage.getItem('qa_seeded')){
        const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
        const goals=[{id:'qa-daily',title:'Review trading process',domain:'Trading',level:'daily',priority:'high',manualProgress:0,targetDate:today,periodKey:today},{id:'qa-complete',title:'Journal completed session',domain:'Trading',level:'daily',priority:'medium',manualProgress:100,targetDate:today,periodKey:today}];
        const row={id:'qa-owned-evidence',schema:'hios.evidence.v1',sourceProductId:'tios',domain:'trading',userId:user,evidenceType:'rule_compliance_assessment',observedAt:new Date().toISOString(),subject:{type:'trade',id:'qa-trade'},observation:{reviewId:'qa-review'},hiosVerified:true};
        localStorage.setItem('hios_gios_goals_v2',JSON.stringify(goals));
        localStorage.setItem('hios_gios_focus_areas_v1',JSON.stringify(['Trading']));
        localStorage.setItem('hios_added_products_v1',JSON.stringify(['gios','tios']));
        localStorage.setItem('hios_verified_evidence_v1',JSON.stringify({tios:[row,{...row,id:'qa-other-user-evidence',userId:'00000000-0000-4000-8000-000000000002'}]}));
        localStorage.setItem('qa_seeded','1');
      }
    },{user});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const url='http://127.0.0.1:'+server.address().port;
    await page.goto(url,{waitUntil:'load'});
    assert.equal(await page.locator('#appScreen').isVisible(),true);
    assert.equal(await page.locator('.hios-domain').count(),4);
    assert.equal(await page.locator('.hios-domain-level').filter({hasText:'Not yet assessed'}).count(),4);
    assert.equal(await page.locator('.hios-domain .hios-level-progress-track').count(),4);
    assert.equal(await page.locator('.hios-level-segments').count(),0);
    assert.equal(await page.locator('.hios-domain [aria-valuenow]').count(),0);
    assert.match(await page.locator('#hiosPriorityTasks').innerText(),/1 active task.*1 high priority/);
    assert.equal(await page.locator('.top-k-panel #hiosGoalProgressList').count(),1);
    assert.equal(await page.locator('.home-sidebar #hiosDomainGrid').count(),1);
    assert.equal(await page.locator('.hios-top-row .hios-development, #hiosFocusList, .top-k-actions, .top-k-metrics').count(),0);
    assert.equal(await page.locator('.hios-product-intelligence').count(),3);
    assert.equal(await page.locator('[data-intelligence-product="tios"] .hios-domain').count(),2);
    assert.equal(await page.locator('[data-intelligence-capabilities]').count(),3);
    assert.equal(await page.locator('#hiosSignOut').isVisible(),true);
    assert.equal(await page.locator('.top-k-panel .goal-status-copy').count(),0);
    assert.match(await page.locator('#hiosGoalProgressList').innerText(),/50%/);
    assert.equal(await page.locator('#hiosGoalProgressList .goal-row').count(),1);
    assert.doesNotMatch(await page.locator('#hiosGoalProgressList').innerText(),/Trading/);
    assert.equal(await page.locator('#hiosIntelligenceUnread').isVisible(),false);
    passed('real task priorities coexist with independent pending maturity and an empty unread indicator');

    for(const domain of ['trading-edge','execution','goals','cross']){
      await page.locator(`[data-intelligence-domain="${domain}"]`).click();
      assert.equal(await page.locator('#hiosIntelligenceDialog').evaluate(el=>el.open),true);
      assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Intelligence overview/);
      assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Evidence overview/);
      assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Capability development/);
      assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Intelligence transparency/);
      await page.getByText('Maturity development · Six proposed stages',{exact:true}).click();
      assert.equal(await page.locator('.hios-maturity-stages li').count(),6);
      if(domain==='execution'){
        assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/1 matching source record/);
        await page.getByText('Inspect received source records',{exact:true}).click();
        assert.match(await page.locator('.hios-source-records').innerText(),/qa-owned-evidence/);
        assert.doesNotMatch(await page.locator('.hios-source-records').innerText(),/qa-other-user-evidence/);
      }
      for(let i=0;i<9;i++)await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#hiosIntelligenceDialog')),true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.intelligenceDomain),domain);
    }
    passed('all domain drawers, six stages, evidence ownership, keyboard containment and Escape focus restoration');

    for(const [id,name,count] of [['tios','T-IOS',6],['gios','G-IOS',3],['hios','H-IOS',3]]){
      await page.locator(`[data-intelligence-capabilities="${id}"]`).click();
      assert.equal(await page.locator('#hiosIntelligenceTitle').innerText(),`${name} capabilities`);
      assert.equal(await page.locator('.hios-capability-row').count(),count);
      assert.equal(await page.locator('.hios-capability-row .available').count(),id==='tios'?2:1);
      assert.equal(await page.locator('.hios-capability-row').filter({hasText:'Awaiting assessment'}).count(),id==='tios'?4:2);
      if(id==='tios'){
        assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Trading Edge Intelligence/);
        assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Execution Quality Intelligence/);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.intelligenceCapabilities),id);
    }
    passed('product capability buttons list available tools and pending capabilities with both T-IOS intelligences');

    const month=await page.locator('#hiosCalendarMonth').innerText();
    await page.locator('#hiosNextMonth').click();assert.notEqual(await page.locator('#hiosCalendarMonth').innerText(),month);
    await page.locator('#hiosPrevMonth').click();assert.equal(await page.locator('#hiosCalendarMonth').innerText(),month);
    await page.locator('.calendar-day.today').click();
    assert.equal(await page.locator('#calendarEntryModal').isVisible(),true);
    await page.locator('#calendarEntryTitle').fill('QA calendar milestone');
    await page.locator('#calendarEntryForm button[type="submit"]').click();
    assert.match(await page.locator('.calendar-day.today').innerText(),/QA calendar milestone/);
    await page.locator('.calendar-event').filter({hasText:'QA calendar milestone'}).click();
    assert.equal(await page.locator('#calendarEntryTitle').inputValue(),'QA calendar milestone');
    await page.locator('#calendarEntryCancel').click();
    passed('calendar previous/next month, day creation, persisted record and event edit interaction');

    await page.locator('#autoZoomToggle').click();
    assert.equal(await page.locator('#autoZoomToggle').getAttribute('aria-pressed'),'true');
    await page.locator('[data-home-panel="b"]').hover();
    assert.equal(await page.locator('.top-k-panel').evaluate(el=>el.classList.contains('hios-panel-zoomed')),true);
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.top-k-panel')).transform).a>1.01);
    await page.locator('[data-home-panel="c"]').hover();
    assert.equal(await page.locator('.hios-development').evaluate(el=>el.classList.contains('hios-panel-zoomed')),true);
    assert.equal(await page.locator('.top-k-panel').evaluate(el=>el.classList.contains('hios-panel-zoomed')),false);
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.hios-development')).transform).a>1.01);
    await page.waitForFunction(()=>{
      const panel=document.querySelector('.hios-development');
      const scale=new DOMMatrix(getComputedStyle(panel).transform).a;
      return Math.abs(scale-1.025)<0.0001;
    });
    const zoomLayer=await page.evaluate(()=>{
      const panel=document.querySelector('.hios-development');
      const sidebar=document.querySelector('.home-sidebar');
      const calendar=document.querySelector('.calendar-card');
      const box=panel.getBoundingClientRect(),outer=sidebar.getBoundingClientRect();
      const hit=document.elementFromPoint((box.left+outer.left)/2,box.top+24);
      return {outsideParent:box.left<outer.left,visibleOutsideParent:!!hit?.closest('.hios-development'),aboveCalendar:Number(getComputedStyle(sidebar).zIndex)>Number(getComputedStyle(calendar).zIndex),withinViewport:box.bottom<=innerHeight+1,pageScroll:scrollY};
    });
    assert.deepEqual(zoomLayer,{outsideParent:true,visibleOutsideParent:true,aboveCalendar:true,withinViewport:true,pageScroll:0});
    if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'zoom-front.png')})}
    await page.locator('.calendar-day.today').hover();
    assert.equal(await page.locator('.calendar-day.today').evaluate(el=>el.classList.contains('hios-day-hover')),true);
    await page.locator('#autoZoomToggle').click();
    assert.equal(await page.locator('#autoZoomToggle').getAttribute('aria-pressed'),'false');
    await page.locator('.sidebar-add-product').click();
    await page.locator('#productCatalogList [data-product-id="healthios"] .catalog-actions button').last().click();
    assert.equal(await page.locator('#productSidebarNav [data-product-id="healthios"]').count(),1);
    await page.locator('#productCatalogList [data-product-id="healthios"] .catalog-actions button').last().click();
    assert.equal(await page.locator('#productSidebarNav [data-product-id="healthios"]').count(),0);
    await page.keyboard.press('Escape');
    passed('intelligence zoom is unclipped and in front of the calendar, with Auto Zoom/day and Add Product behavior preserved');

    await page.locator('#productSidebarNav [data-product-id="gios"]').click();
    await page.waitForURL('**/g-ios.html');
    await page.locator('[data-stage-complete="qa-daily"]').click();
    await page.locator('#backToHios').click();
    await page.waitForURL('**/index.html?view=home');
    assert.match(await page.locator('#hiosGoalProgressList').innerText(),/100%/);
    assert.match(await page.locator('#hiosPriorityTasks').innerText(),/No unfinished daily tasks/);
    passed('sidebar navigation to G-IOS, actual Done action and refreshed H-IOS priorities/progress in section A');

    const png=async (name,fullPage=true)=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name),fullPage})}};
    await page.setViewportSize({width:1440,height:600});
    const intelligenceList=page.locator('#hiosDomainGrid');
    assert.equal(await intelligenceList.evaluate(el=>el.scrollHeight>el.clientHeight),true);
    await intelligenceList.hover();
    await page.mouse.wheel(0,650);
    await page.waitForFunction(()=>document.getElementById('hiosDomainGrid').scrollTop>0);
    await page.mouse.wheel(0,1800);
    assert.deepEqual(await page.evaluate(()=>({page:scrollY,main:document.querySelector('.main').scrollTop,sidebar:document.querySelector('.home-sidebar').scrollTop})),{page:0,main:0,sidebar:0});
    await intelligenceList.focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.getElementById('hiosDomainGrid').scrollTop===0);
    await page.keyboard.press('End');
    await page.waitForFunction(()=>document.getElementById('hiosDomainGrid').scrollTop>0);
    passed('section A scrolls by wheel and keyboard without scrolling the page or calendar/main container');
    for(const [width,height] of [[1920,900],[1440,900],[1280,768],[1024,600],[768,900],[390,844],[320,568]]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}px page overflow`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true,`${width}x${height}px page must remain fixed`);
      assert.equal(await page.locator('.main').evaluate(el=>getComputedStyle(el).overflowY),'hidden');
      assert.ok(await intelligenceList.evaluate(el=>el.clientHeight)>=50,`${width}x${height}px intelligence list remains usable`);
      if(width<=950)assert.ok(await page.locator('.calendar-day').first().evaluate(el=>el.getBoundingClientRect().height)>=28,'short-screen calendar dates remain readable');
      assert.equal(await page.locator('.hios-domain').count(),4);
      const clipped=await page.locator('.hios-domain, .hios-development, .hios-product-intelligence, .hios-product-intelligence-head, .hios-intelligence-copy, .top-k-panel').evaluateAll(elements=>elements.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className));
      assert.deepEqual(clipped,[],`${width}px intelligence clipping`);
      if(width>=951){
        const layout=await page.evaluate(()=>{
          const calendar=document.querySelector('.calendar-card').getBoundingClientRect();
          const intelligence=document.querySelector('.hios-development').getBoundingClientRect();
          const progress=document.querySelector('.top-k-panel').getBoundingClientRect();
          return {sidebarWidth:intelligence.width,calendarRight:calendar.right,intelligenceLeft:intelligence.left,progressBottom:progress.bottom,calendarTop:calendar.top};
        });
        assert.equal(Math.round(layout.sidebarWidth),350,`${width}px calendar retains its sidebar allocation`);
        assert.ok(layout.calendarRight<layout.intelligenceLeft,`${width}px intelligence beside calendar`);
        assert.ok(layout.progressBottom<=layout.calendarTop,`${width}px progress above calendar`);
      }
      const fill=await page.evaluate(()=>{
        const section=document.querySelector('.hios-intelligence').getBoundingClientRect();
        const main=document.querySelector('.hios-intelligence-main').getBoundingClientRect();
        return section.width-main.width;
      });
      assert.ok(fill<=45,`${width}px intelligence should use the available section width`);
      await intelligenceList.evaluate(el=>{el.scrollTop=0});
      if(width===1440)await png('desktop.png');
      if(width===768)await png('tablet.png');
      if(width===390)await png('mobile.png');
      if(width===320)await png('small-mobile.png');
      if(width===1024)await png('short-desktop.png');
      await page.locator('[data-intelligence-domain="goals"]').click();
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('hiosIntelligenceDialog')).transform==='none');
      assert.equal(await page.locator('#hiosIntelligenceDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${width}px drawer overflow`);
      const bounds=await page.locator('#hiosIntelligenceDialog').evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,right:box.right,viewport:innerWidth,width:box.width,inset:getComputedStyle(el).inset,margin:getComputedStyle(el).margin}});
      assert.ok(bounds.left>=-1&&bounds.right<=bounds.viewport+1,`${width}px drawer bounds ${JSON.stringify(bounds)}`);
      if(width===1440)await png('drawer-desktop.png',false);
      if(width===390)await png('drawer-mobile.png',false);
      await page.locator('#hiosIntelligenceClose').click();
    }
    passed('1920/1440/1280/1024/768/390/320px fixed workspace and drawer without page overflow or clipping');

    await page.setViewportSize({width:1440,height:900});
    await page.locator('#hiosIntelligenceNotifications').click();
    assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/No intelligence updates yet/);
    await page.mouse.click(20,50);
    assert.equal(await page.locator('#hiosIntelligenceDialog').evaluate(el=>el.open),false);
    await page.evaluate(user=>{
      const base={assessmentId:'qa-assessment',assessedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString()};
      window.qaAssessment=base;
      window.HIOSIntelligenceUI.connect({load:async()=>({schema:'hios.intelligence-development.v1',userId:user,maturity:{goals:{...base,level:2,levelProgress:{...base,level:2,percent:80,basis:'QA validated requirements for this level'}}},readiness:{'goals.future.0':{...base,status:'available',permissionGranted:true,safetyValidated:true,requiredPlan:'pro'}},notifications:[{id:'qa-event',userId:user,type:'capability-available',occurredAt:base.assessedAt,title:'QA engine event'},{id:'wrong-user-event',userId:'other',type:'capability-available',occurredAt:base.assessedAt}]})});
    },user);
    await page.waitForFunction(()=>document.querySelector('[data-intelligence-domain="goals"] .hios-domain-level').textContent.startsWith('Level 2'));
    assert.equal(await page.locator('[data-intelligence-domain="goals"] .hios-level-progress-track').count(),1);
    assert.equal(await page.locator('[data-intelligence-domain="goals"] .hios-level-progress-track').getAttribute('aria-valuenow'),'80');
    assert.equal(await page.locator('[data-intelligence-domain="goals"] .hios-level-progress-track > span').evaluate(el=>el.style.width),'80%');
    assert.equal(await page.locator('#hiosIntelligenceUnread').innerText(),'1');
    await page.locator('[data-intelligence-domain="goals"]').click();
    assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Ready — Pro Required/);
    assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/Progress basis: QA validated requirements for this level/);
    await page.keyboard.press('Escape');
    await page.locator('#hiosIntelligenceNotifications').click();
    assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/QA engine event/);
    assert.equal(await page.locator('#hiosIntelligenceUnread').isVisible(),false);
    await page.keyboard.press('Escape');
    await page.evaluate(user=>window.HIOSIntelligenceUI.connect({load:async()=>({schema:'hios.intelligence-development.v1',userId:user,maturity:{goals:{...window.qaAssessment,level:4,validUntil:new Date(Date.now()-1).toISOString()}}})}),user);
    await page.waitForFunction(()=>document.querySelector('[data-intelligence-domain="goals"] .hios-domain-level').textContent==='Not yet assessed');
    assert.equal(await page.locator('.hios-domain [aria-valuenow]').count(),0);
    passed('one-level assessed progress, independent Pro readiness, real unread events, read markers and expired assessment fallback');

    await page.evaluate(user=>{
      let resolve;const pending=new Promise(r=>resolve=r);
      window.HIOSIntelligenceUI.connect({load:()=>pending});
      window.HIOSIntelligenceUI.setSessionUser('00000000-0000-4000-8000-000000000002');
      resolve({schema:'hios.intelligence-development.v1',userId:user,maturity:{goals:{...window.qaAssessment,level:5}}});
    },user);
    await page.locator('[data-intelligence-domain="execution"]').click();
    assert.match(await page.locator('#hiosIntelligenceBody').innerText(),/1 matching source record/);
    await page.getByText('Inspect received source records',{exact:true}).click();
    assert.match(await page.locator('.hios-source-records').innerText(),/qa-other-user-evidence/);
    assert.doesNotMatch(await page.locator('.hios-source-records').innerText(),/qa-owned-evidence/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hios-domain [aria-valuenow]').count(),0);
    await page.evaluate(()=>window.HIOSIntelligenceUI.setSessionUser(null));
    assert.equal(await page.locator('#hiosIntelligenceUnread').isVisible(),false);
    passed('account switch clears assessments, rejects stale callbacks and scopes evidence to the new user');
    assert.deepEqual(errors,[]);
    passed('no page JavaScript errors throughout the full local flow');
    await context.close();
    console.log(`${checks} browser checks passed`);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error);process.exitCode=1});
