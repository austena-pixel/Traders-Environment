// Isolated dashboard fixture: no live account access or external requests.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=process.env.TIOS_QA_OUTPUT;
async function run(){
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
    fs.readFile(file,(error,bytes)=>{
      if(error){res.writeHead(404);return res.end()}
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
      res.end(file.endsWith('.html')?bytes.toString().replace(/<script src="https:\/\/[^\"]+"><\/script>/g,''):bytes);
    });
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.TIOS_TEST_BROWSER,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.route('https://**/*',route=>route.abort());
    await context.addInitScript(()=>{
      window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/t-ios.html');
    await page.evaluate(()=>{
      currentUser={id:'qa-user'};
      tradingAccount={id:'qa-account',account_name:'QA Manual Account',account_type:'manual',currency:'USD',starting_balance:10000};
      tradingAccounts=[tradingAccount];viewDate=new Date(2026,9,1);
      trades=[{id:'one',user_id:'qa-user',account_id:'qa-account',trade_date:'2026-10-01',pnl:200},{id:'two',user_id:'qa-user',account_id:'qa-account',trade_date:'2026-10-02',pnl:-50}];
      setLoggedInUI(true);renderDashboard();
      document.getElementById('activeAccountSelect').innerHTML='<option>QA Manual Account</option>';
      document.getElementById('startingBalance').value='10000';
      document.getElementById('accountSwitcherStatus').textContent='Test data · Manual journal account';
    });
    const screenshot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name)})}};
    const send=async message=>{await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).fill(message);await page.getByRole('button',{name:'Send message',exact:true}).click()};
    const log=page.getByRole('log',{name:'Conversation with T-IOS'});
    const assertFixed=async()=>{
      const measured=await page.evaluate(()=>({height:innerHeight,width:innerWidth,doc:document.documentElement.scrollHeight,body:document.body.scrollHeight,scroll:scrollY,compose:document.getElementById('tiosConversationForm').getBoundingClientRect().toJSON()}));
      assert.ok(measured.doc<=measured.height+1,JSON.stringify(measured));assert.ok(measured.body<=measured.height+1,JSON.stringify(measured));assert.equal(measured.scroll,0);
      if(await page.locator('#tiosConversation').isVisible()){assert.ok(measured.compose.bottom<=measured.height,JSON.stringify(measured));assert.ok(measured.compose.right<=measured.width,JSON.stringify(measured))}
      if(await page.locator('#tiosConversation').isVisible())assert.ok((await page.locator('#tiosConversationMessages').boundingBox()).height>=36,'conversation retains a readable scroll area');
    };
    assert.equal(await page.getByRole('heading',{name:'Key Performance',exact:true}).count(),0);
    assert.equal(await page.locator('#tiosConversation').isVisible(),false);
    assert.equal(await page.locator('.account-overview').isVisible(),true);
    const originalBalance=await page.locator('#startingBalance').inputValue();
    const chartButton=await page.locator('#openAccountChart').boundingBox(),overviewBox=await page.locator('.account-overview').boundingBox();
    assert.ok(chartButton.y+chartButton.height<=overviewBox.y,'Open Chart sits above Account Overview');
    assert.equal(chartButton.width,overviewBox.width,'Open Chart spans the right column');
    await assertFixed();
    await page.evaluate(()=>{viewDate=new Date(2026,7,1);renderDashboard()});
    assert.equal(await page.locator('#calendarGrid > *').count(),56);
    await assertFixed();
    await page.evaluate(()=>{viewDate=new Date(2026,9,1);renderDashboard()});
    await page.getByRole('button',{name:'Open Chart',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Close Chart',exact:true}).getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.account-overview').isVisible(),false);
    assert.equal(await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).evaluate(el=>document.activeElement===el),true);
    await assertFixed();
    await send('How did I perform this month?');
    assert.match(await log.innerText(),/Net P&L: \$150\.00/);assert.match(await log.innerText(),/Win rate: 50\.0%/);assert.match(await log.innerText(),/1\.50%/);
    await send('What do my execution reviews show?');assert.match(await log.innerText(),/no comparable execution reviews/);
    await screenshot('desktop-conversation.png');
    console.log('PASS Open Chart replaces Account Overview, sends messages and reports actual recorded outcomes');
    await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).fill('What evidence is missing?');
    await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).press('Shift+Enter');
    assert.match(await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).inputValue(),/\n$/);
    await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).press('Enter');assert.match(await log.innerText(),/2 loaded closed trades/);
    await send('<img src=x onerror="window.qaInjected=true">');
    assert.equal(await log.locator('img').count(),0);assert.match(await log.innerText(),/general AI conversation/);
    await page.getByRole('button',{name:'Close conversation',exact:true}).click();assert.equal(await page.locator('#tiosConversation').isVisible(),false);
    assert.equal(await page.locator('.account-overview').isVisible(),true);
    assert.equal(await page.locator('#startingBalance').inputValue(),originalBalance);
    assert.equal(await page.getByRole('button',{name:'Open Chart',exact:true}).evaluate(el=>document.activeElement===el),true);
    await page.getByRole('button',{name:'Open Chart',exact:true}).click();assert.match(await log.innerText(),/Net P&L/);
    await page.getByRole('button',{name:'New conversation',exact:true}).click();assert.equal(await page.locator('.tios-conversation-message').count(),1);
    console.log('PASS keyboard sending, multiline entry, safe message text, closing/reopening and conversation reset');
    for(const size of [{width:1920,height:1080},{width:1280,height:720},{width:1024,height:768},{width:768,height:1024},{width:390,height:844},{width:320,height:568},{width:900,height:450}]){
      await page.setViewportSize(size);await assertFixed();
      await page.locator('#calendarGrid').evaluate(el=>{el.parentElement.scrollTop=200;el.parentElement.scrollLeft=200});
      await page.mouse.move(size.width-30,size.height-30);await page.mouse.wheel(0,600);await assertFixed();
      if(size.width===390)await screenshot('mobile-conversation.png');
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#prevMonth').click();await page.locator('#nextMonth').click();
    assert.equal(await page.locator('#calendarGrid > *').count(),48); // Six rows incl. weekday headings in October 2026.
    await assertFixed();
    console.log('PASS fixed document on desktop, tablet, mobile and short screens; internal calendar scrolling and month navigation');
    await page.evaluate(()=>{
      trades.push({id:'other',account_id:'other-account',user_id:'other-user',trade_date:'2026-10-03',pnl:900000});
      trades.push({id:'missing',account_id:'qa-account',user_id:'qa-user',trade_date:'2026-10-03',pnl:null});
    });
    await send('How did I perform this month?');
    const last=await page.locator('.tios-conversation-message[data-role="assistant"]').last().innerText();
    assert.match(last,/3 recorded closed trades/);assert.match(last,/\$150\.00/);assert.match(last,/1 trade is missing P&L/);assert.doesNotMatch(last,/900,000/);
    await page.getByRole('textbox',{name:'Message T-IOS',exact:true}).fill('Private draft');
    await page.evaluate(()=>{
      window.dispatchEvent(new Event('tios:conversation-scope-changing'));tiosConversationReady=false;tradingAccount={id:'new-account',account_type:'manual',account_name:'Second QA Account',starting_balance:0};
    });
    await send('How did I perform this month?');assert.match(await log.innerText(),/still loading/);assert.doesNotMatch(await log.innerText(),/150\.00/);
    await page.evaluate(()=>{trades=[];renderDashboard()});await send('How did I perform this month?');assert.match(await log.innerText(),/no loaded closed trades/);
    await page.evaluate(()=>setLoggedInUI(false));assert.equal(await page.locator('#tiosConversation').isVisible(),false);
    assert.doesNotMatch(await page.locator('#tiosConversationMessages').innerText(),/150\.00|Private draft/);
    console.log('PASS selected user/account isolation, missing outcomes, account loading and sign-out clear sensitive conversation context');
    assert.deepEqual(errors,[]);console.log('PASS no browser JavaScript errors');
  }finally{await browser.close();server.close()}
}
run().catch(error=>{console.error(error);process.exitCode=1});
