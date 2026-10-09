'use strict';
// Real H-IOS, G-IOS and T-IOS pages in separate tabs on an isolated origin.
// Authentication and review data are fixtures; all external traffic is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const userId = '00000000-0000-4000-8000-000000000001';
let checks = 0;
const pass = message => {checks++; console.log('PASS ' + message);};

async function run() {
  let browser, writes = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {writes++; res.writeHead(405); res.end(); return;}
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({configured:false})); return;
    }
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403); res.end(); return;}
    fs.readFile(file, (error, data) => {
      if (error) {res.writeHead(404); res.end(); return;}
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.HIOS_TEST_BROWSER || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.route('https://**/*', route => route.request().url().includes('@supabase/supabase-js')
      ? route.fulfill({contentType:'text/javascript',body:''}) : route.abort());
    await context.addInitScript(({userId}) => {
      window.supabase = {createClient:() => ({auth:{
        getSession:() => location.pathname.endsWith('t-ios.html') ? new Promise(() => {}) : Promise.resolve({data:{session:{user:{id:userId}}}}),
        onAuthStateChange:() => ({data:{subscription:{unsubscribe(){}}}}), signOut:async() => ({})
      }})};
      if (!localStorage.getItem('qa_evidence_seeded')) {
        localStorage.setItem('hios_added_products_v1', JSON.stringify(['gios','tios']));
        localStorage.setItem('hios_gios_focus_areas_v1', JSON.stringify(['Trading']));
        localStorage.setItem('hios_gios_product_focus_links_v1', JSON.stringify({tios:{productId:'tios',productName:'Traders-IOS',area:'Trading',linkedAt:'2026-10-09T12:00:00Z',evidenceKey:'hios_product_goal_evidence_v1'}}));
        localStorage.setItem('hios_gios_goals_v2', JSON.stringify([{id:'qa-goal',title:'Improve execution',domain:'Trading',level:'yearly',priority:'high',manualProgress:0,targetDate:'2026-12-31'}]));
        localStorage.setItem('hios_gios_progress_models_v1', JSON.stringify({Trading:{name:'Trading Progress Model',activePhaseId:'qa-phase',phases:[{id:'qa-phase',title:'Execution quality',evidence:['execution_adherence','execution_errors'],targetDate:'2026-12-31'}]}}));
        localStorage.setItem('qa_evidence_seeded','1');
      }
    }, {userId});
    const errors = [], pages = {};
    for (const name of ['hios','gios','tios']) {
      pages[name] = await context.newPage();
      pages[name].setDefaultTimeout(12000);
      pages[name].on('pageerror', error => errors.push(name + ': ' + error.message));
    }
    const origin = 'http://127.0.0.1:' + server.address().port;
    await pages.hios.goto(origin + '/index.html', {waitUntil:'load'});
    await pages.gios.goto(origin + '/g-ios.html', {waitUntil:'load'});
    await pages.gios.evaluate(() => {
      window.qaResponseSignals=[];
      goalsBridge.subscribe(signal=>window.qaResponseSignals.push(signal.signalId),{source:'t-ios',types:['evidence.responded']});
    });
    await pages.tios.goto(origin + '/t-ios.html', {waitUntil:'load'});
    await pages.tios.evaluate(userId => {
      currentUser = {id:userId};
      tradingAccount = {id:'qa-account',account_name:'QA',initial_balance:10000,current_equity:10000,currency:'USD'};
      trades = Array.from({length:6}, (_,i) => ({id:'qa-t'+i,trade_date:'2026-09-'+(20+i),pnl:0}));
      executionReviews = trades.map((trade,i) => ({id:'qa-r'+i,trade_id:trade.id,created_at:trade.trade_date+'T12:00:00Z'}));
      executionChecks = executionReviews.flatMap((review,i) => EXECUTION_RECOMMENDED_TEMPLATE.criteria.map(criterion => ({
        review_id:review.id,criterion_key:criterion.key,criterion_label:criterion.label,sort_order:criterion.sort,
        complied:!(i===1 && criterion.key==='trade_management') && !(i===2 && ['trade_management','risk_sizing'].includes(criterion.key))
      })));
      db.from = () => {const query = {select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)}; return query;};
      setLoggedInUI(true);
    }, userId);
    const model = await pages.tios.evaluate(() => window.TIOSExecutionIntelligenceDiagnostic());
    assert.equal(model.sample.totalChecks,36);
    assert.equal(model.sample.missedChecks,3);
    assert.equal(model.execution.adherencePct,91.7);
    pass('T-IOS calculates execution intelligence from the actual reflection and scoring functions');

    const original = await pages.gios.evaluate(() => ({goals:localStorage.getItem('hios_gios_goals_v2'),models:localStorage.getItem('hios_gios_progress_models_v1')}));
    async function requestEvidence() {
      const request = await pages.gios.evaluate(() => publishGoalEvidenceRequest('Trading', progressModelForArea('Trading')));
      assert.ok(request);
      await pages.gios.waitForFunction(id => JSON.parse(localStorage.getItem('hios_goal_evidence_responses_v1') || '{}').tios?.requestId===id, request.requestId);
      await pages.gios.waitForFunction(id => Object.values(JSON.parse(localStorage.getItem('hios_goal_reorientation_requests_v1') || '{}')).some(row => row.evidenceBasis?.[0]?.requestId===id && row.status==='pending'), request.requestId);
      await pages.hios.waitForFunction(id => JSON.parse(localStorage.getItem('hios_goal_evidence_request_receipts_v1') || '{}')[id]?.verified===true, request.requestId);
      return request;
    }
    const first = await requestEvidence();
    const response = await pages.gios.evaluate(() => JSON.parse(localStorage.getItem('hios_goal_evidence_responses_v1')).tios);
    assert.deepEqual(response.requestedMetrics,['execution_adherence','execution_errors']);
    assert.deepEqual(response.deliveredMetrics,response.requestedMetrics);
    assert.equal(response.evidence.find(row=>row.metric==='execution_errors').value,3);
    assert.equal(response.evidence.find(row=>row.metric==='execution_adherence').value,91.7);
    await pages.hios.waitForFunction(id => Object.values(JSON.parse(localStorage.getItem('hios_goal_evidence_response_receipts_v1') || '{}')).some(row => row.requestId===id && row.verified), first.requestId);
    pass('real storage events carry selected G-IOS metrics through H-IOS to T-IOS and back with matching receipts');

    const responseCount = await pages.tios.evaluate(() => HIOSCommunicationModules.router.readRequests().filter(row=>row.type==='evidence.responded').length);
    await pages.tios.evaluate(() => {
      window.qaReceiptSeen=false;
      window.addEventListener('storage',event=>{
        if(event.key===GIOS_EVIDENCE_REQUESTS_KEY&&JSON.parse(event.newValue||'{}').tios?.qaReceiptMarker)window.qaReceiptSeen=true;
      });
    });
    await pages.gios.evaluate(() => {
      const requests=JSON.parse(localStorage.getItem(GIOS_EVIDENCE_REQUESTS_KEY));
      requests.tios.qaReceiptMarker=true;
      localStorage.setItem(GIOS_EVIDENCE_REQUESTS_KEY,JSON.stringify(requests));
    });
    await pages.tios.waitForFunction(() => window.qaReceiptSeen);
    assert.equal(await pages.tios.evaluate(() => HIOSCommunicationModules.router.readRequests().filter(row=>row.type==='evidence.responded').length),responseCount);
    pass('a receipt-only request-store update does not generate another T-IOS response');

    const beforeDecision = await pages.gios.evaluate(() => ({models:localStorage.getItem('hios_gios_progress_models_v1'),goals:localStorage.getItem('hios_gios_goals_v2')}));
    assert.deepEqual(beforeDecision,original);
    assert.match(await pages.gios.locator('#piReorientationState').innerText(),/Pending your decision/);
    await pages.gios.locator('#piReorientationKeep').click();
    assert.match(await pages.gios.locator('#piReorientationState').innerText(),/Current plan kept/);
    assert.equal(await pages.gios.evaluate(() => localStorage.getItem('hios_gios_progress_models_v1')), original.models);
    pass('a proposed emphasis waits for a decision and Keep current plan preserves the progress model');

    const second = await requestEvidence();
    assert.notEqual(second.requestId,first.requestId);
    await pages.gios.locator('#piReorientationApply').click();
    try {
      await pages.gios.waitForFunction(() => goalsBridge.getPendingRequests().filter(row=>['evidence.responded','goal.reorientation.requested'].includes(row.type)).length===0);
    } catch (error) {
      const pending = await pages.gios.evaluate(() => ({
        pending:goalsBridge.getPendingRequests().map(row=>({type:row.type,signalId:row.signalId,requestId:row.payload?.response?.requestId||row.payload?.request?.evidenceBasis?.[0]?.requestId,receipt:localStorage.getItem('hios_communication_request_outcome_v1:'+row.signalId)})),
        queueSize:HIOSCommunicationModules.router.readRequests().length,
        observed:window.qaResponseSignals,
        request:JSON.parse(localStorage.getItem(GIOS_EVIDENCE_REQUESTS_KEY)||'{}').tios,
        response:JSON.parse(localStorage.getItem(TIOS_EVIDENCE_RESPONSES_KEY)||'{}').tios?.hiosSignalId,
        log:goalsBridge.getLog().slice(-20),
        receiptCount:Object.keys(localStorage).filter(key=>key.startsWith('hios_communication_request_outcome_v1:')).length
      }));
      throw new Error('Evidence requests remained pending: ' + JSON.stringify({pending,errors}));
    }
    const accepted = await pages.gios.evaluate(() => ({model:progressModelForArea('Trading'),goals:localStorage.getItem('hios_gios_goals_v2'),pending:goalsBridge.getPendingRequests()}));
    assert.equal(accepted.model.phases[0].workingEmphasis.code,'reduce_execution_errors');
    assert.equal(accepted.model.phases[0].title,'Execution quality');
    assert.equal(accepted.model.phases[0].targetDate,'2026-12-31');
    assert.deepEqual(accepted.model.phases[0].evidence,second.metrics);
    assert.equal(accepted.goals,original.goals);
    assert.deepEqual(accepted.pending.filter(row=>['evidence.responded','goal.reorientation.requested'].includes(row.type)).map(row=>({type:row.type,signalId:row.signalId,requestId:row.payload?.response?.requestId||row.payload?.request?.evidenceBasis?.[0]?.requestId})),[]);
    pass('Apply working emphasis preserves goals, selected evidence and deadlines and acknowledges each received signal');

    const stored = await pages.gios.evaluate(() => localStorage.getItem('hios_goal_evidence_responses_v1'));
    const stale = await pages.tios.evaluate(({response,first}) => tiosHiosBridge.emit('evidence.responded',{response:{...response,requestId:first.requestId}},{requestId:first.requestId}), {response,first});
    assert.equal(stale.ok,false);
    assert.match(stale.errors.join(' '),/active H-IOS request/);
    assert.equal(await pages.gios.evaluate(() => localStorage.getItem('hios_goal_evidence_responses_v1')),stored);
    pass('an old request cannot overwrite the currently received evidence');

    const disconnected = await pages.gios.evaluate(() => {
      localStorage.setItem('hios_added_products_v1',JSON.stringify(['gios']));
      return publishGoalEvidenceRequest('Trading',progressModelForArea('Trading'));
    });
    assert.equal(disconnected,null);
    assert.equal(await pages.gios.evaluate(() => JSON.parse(localStorage.getItem('hios_goal_evidence_requests_v1')).tios.requestId),second.requestId);
    pass('disconnecting T-IOS prevents a new evidence request');

    const textOnly = await pages.tios.evaluate(() => {
      executionChecks = executionReviews.map(review => ({review_id:review.id,criterion_key:'text__reflection',criterion_label:'What did I learn?',sort_order:1,complied:false,comment:'A written reflection.'}));
      localStorage.setItem('hios_added_products_v1',JSON.stringify(['gios','tios']));
      return {model:window.TIOSExecutionIntelligenceDiagnostic(),response:respondToGoalEvidenceRequest('qa_text_only_refresh')};
    });
    assert.equal(textOnly.model.sample.totalChecks,0);
    assert.equal(textOnly.model.execution.adherencePct,null);
    assert.equal(textOnly.model.trend.state,'insufficient-evidence');
    assert.equal(textOnly.response.status,'unavailable');
    assert.deepEqual(textOnly.response.deliveredMetrics,[]);
    assert.equal(textOnly.response.unavailableMetrics.length,2);
    await pages.gios.waitForFunction(() => JSON.parse(localStorage.getItem('hios_goal_evidence_responses_v1') || '{}').tios?.status==='unavailable');
    pass('text-only reflections leave the trend unestablished and return unavailable quantitative evidence to G-IOS');
    assert.deepEqual(errors,[]);
    assert.equal(writes,0);
    pass('no page JavaScript errors, external writes or paid AI requests');
    await context.close();
    console.log(checks + ' browser checks passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => {console.error(error); process.exitCode=1;});
