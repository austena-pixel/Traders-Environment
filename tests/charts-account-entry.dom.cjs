// Real Charts UI/state machine; deterministic Supabase transport fixtures.
// Live RLS is verified separately in charts-account-entry.sql, without saving data.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),P=require('../core/chart-workspace.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const PROFILES='chart_workspace_profiles',PREFS='chart_workspace_preferences';
function stored(user_id,configuration=P.defaults(),revision=1){return {user_id,configuration:clone(configuration),schema_version:1,revision};}
function environment({profiles=[],preferences=[],user={id:'owner',email:'owner@example.test'}}={}){
  const dom=new JSDOM('<div id="host"></div>',{url:'https://tios.test/t-ios.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.matchMedia=()=>({matches:false});
  Object.defineProperty(w.crypto,'randomUUID',{value:require('node:crypto').randomUUID});
  w.TIOSChartPreferences=P;
  w.TIOSMarketVerification={create:()=>({setControlsVisible(){},mount(){},hide(){},reset(){},openTrade(){}})};
  const tables={[PROFILES]:clone(profiles),[PREFS]:clone(preferences)},requests=[],writes=[];
  let currentUser=user,authenticatedUser=user,hook=()=>{},authHook=()=>{};
  const client={auth:{async getUser(){const result=await authHook();return result||{data:{user:authenticatedUser},error:null};}},from(table){
    const query={table,method:'get',filters:[],body:null};
    const q={select(){return q;},eq(key,value){query.filters.push([key,value]);return q;},maybeSingle(){return q;},
      insert(body){query.method='insert';query.body=clone(body);return q;},update(body){query.method='update';query.body=clone(body);return q;},
      then(resolve,reject){return Promise.resolve().then(async()=>{
        const owner=authenticatedUser?.id;requests.push(clone(query));
        const result=await hook(query);if(result)return result;
        let rows=tables[table].filter(row=>row.user_id===owner&&query.filters.every(([key,value])=>row[key]===value));
        if(query.method==='insert'){
          if(query.body.user_id!==owner)return {data:null,error:{code:'42501'}};
          if(tables[table].some(row=>row.user_id===owner))return {data:null,error:{code:'23505'}};
          const row={...query.body,created_at:'2026-10-10T18:00:00Z',...(table===PREFS?{schema_version:1,revision:1}:{})};
          tables[table].push(row);rows=[row];writes.push(clone(query));
        }else if(query.method==='update'){
          rows=rows.map(row=>Object.assign(row,query.body,{revision:row.revision+1}));
          if(rows.length)writes.push(clone(query));
        }
        return {data:rows[0]?clone(rows[0]):null,error:null};
      }).then(resolve,reject);}};
    return q;
  }};
  w.eval(fs.readFileSync(path.join(__dirname,'..','tios-charts.js'),'utf8'));
  const host=w.document.querySelector('#host');
  const controller=w.TIOSCharts.create({host,getClient:()=>client,getUser:()=>currentUser,getAccounts:()=>[],getSelectedAccount:()=>null,getNumber:()=>1});
  const find=selector=>host.querySelector(selector),action=name=>find('[data-charts-action="'+name+'"]')?.click();
  const frames=()=>host.querySelectorAll('.charts-frame').length;
  async function wait(predicate){for(let i=0;i<25;i++){if(predicate())return;await settle();}assert.ok(predicate(),'UI did not settle: '+host.textContent);}
  return {w,dom,host,controller,tables,requests,writes,find,action,frames,wait,
    async open(){controller.show();await wait(()=>find('[role="dialog"]')||find('.charts-frame')||find('[role="alert"]'));},
    setUser(value){currentUser=value;authenticatedUser=value;},setHook(value){hook=value;},setAuthHook(value){authHook=value;},
    close(){controller.reset();w.close();}};
}
async function choose(e,mode){e.find('[data-charts-onboarding-layout="'+mode+'"]').click();e.action('start-tios-charts');await e.wait(()=>e.frames()>0);}
test('first-time users see the centered two-option entry, with no chart frames or automatic writes',async()=>{
  const e=environment();try{
    await e.open();assert.equal(e.find('h2').textContent,'Welcome to T-IOS Charts');
    assert.equal(e.find('[data-charts-action="sign-in-charts"]').textContent,'Sign in to Charts');
    assert.equal(e.find('[data-charts-action="create-charts-account"]').textContent,'Create Charts account');
    assert.equal(e.frames(),0);assert.equal(e.writes.length,0);assert.equal(e.host.querySelectorAll('input').length,0);
    assert.match(e.host.textContent,/do not sign you in to your personal TradingView account/);
    assert.equal(e.w.document.activeElement,e.find('[data-charts-action="sign-in-charts"]'));
  }finally{e.close();}
});
test('Sign in verifies membership, never creates a profile or pretends missing membership is successful',async()=>{
  const e=environment();try{
    await e.open();e.action('sign-in-charts');await e.wait(()=>e.find('[role="alert"]')?.textContent.includes('No Charts account'));
    assert.equal(e.tables[PROFILES].length,0);assert.equal(e.writes.length,0);assert.equal(e.frames(),0);
    // A genuine registration in another tab is found by an explicit sign-in retry.
    e.tables[PROFILES].push({user_id:'owner'});e.tables[PREFS].push(stored('owner'));
    e.action('sign-in-charts');await e.wait(()=>e.frames()===1);assert.equal(e.writes.length,0);
  }finally{e.close();}
});
test('Create registers exactly one private profile, then saves Single chart before mounting it',async()=>{
  const e=environment();try{
    await e.open();e.action('create-charts-account');e.action('create-charts-account');
    await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    assert.equal(e.tables[PROFILES].length,1);assert.equal(e.frames(),0);assert.deepEqual(e.writes[0].body,{user_id:'owner'});
    assert.equal(e.tables[PREFS].length,0);await choose(e,'single');
    assert.equal(e.frames(),1);assert.equal(e.tables[PREFS][0].configuration.layout,'single');
    assert.equal(P.validate(e.tables[PREFS][0].configuration),null);assert.equal(e.writes.length,2);
    assert.ok(e.writes.every(write=>write.body.user_id==='owner'));
  }finally{e.close();}
});
test('Three charts onboarding persists independent Context H4, Setup H1 and Entry M5 settings',async()=>{
  const e=environment();try{
    await e.open();e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));await choose(e,'multiple');
    const config=e.tables[PREFS][0].configuration;assert.equal(config.layout,'multiple');assert.equal(e.frames(),3);
    assert.deepEqual(config.charts.multiple.map(c=>c.interval),['240','60','5']);
    assert.deepEqual(config.charts.multiple.map(c=>c.id),['context','setup','entry']);
  }finally{e.close();}
});
test('old preferences without a profile cannot bypass entry; creation and layout choice preserve every existing chart setting',async()=>{
  const config=P.defaults();config.layout='multiple';config.theme='light';config.charts.single[0].symbol='BINANCE:BTCUSDT';
  config.charts.multiple[1].symbol=P.preferredDerivSymbol;config.charts.multiple[2].interval='15';config.charts.multiple[0].responsibility='Private context';
  const e=environment({preferences:[stored('owner',config,4)]});try{
    await e.open();assert.equal(e.frames(),0);assert.match(e.host.textContent,/Welcome to T-IOS Charts/);
    e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    assert.deepEqual(e.tables[PREFS][0].configuration,config);assert.equal(e.writes.filter(q=>q.table===PREFS).length,0);
    assert.equal(e.find('[data-charts-onboarding-layout="multiple"]').getAttribute('aria-pressed'),'true');
    await choose(e,'single');assert.deepEqual(e.tables[PREFS][0].configuration,{...config,layout:'single'});
    assert.equal(e.tables[PREFS][0].revision,5);
  }finally{e.close();}
});
test('existing multiple-chart counts survive registration instead of being reset to three',async()=>{
  const config=P.defaults();config.layout='multiple';config.charts.multiple.push({...config.charts.multiple[2],id:'extra'});
  const e=environment({preferences:[stored('owner',config)]});try{
    await e.open();e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    assert.match(e.find('[data-charts-onboarding-layout="multiple"]').textContent,/4 charts/);await choose(e,'multiple');
    assert.deepEqual(e.tables[PREFS][0].configuration,config);assert.equal(e.frames(),4);
  }finally{e.close();}
});
test('returning profiles restore saved single/multiple workspaces without onboarding or writes',async()=>{
  for(const layout of ['single','multiple']){
    const config=P.defaults();config.layout=layout;config.charts.single[0].symbol=P.preferredDerivSymbol;
    const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner',config)]});try{
      await e.open();assert.equal(e.frames(),layout==='single'?1:3);assert.equal(e.find('[role="dialog"]'),null);
      e.controller.hide();assert.equal(e.frames(),0);e.controller.show();assert.equal(e.frames(),layout==='single'?1:3);
      e.controller.reset();await e.open();assert.equal(e.find('[role="dialog"]'),null);assert.equal(e.writes.length,0);
      assert.deepEqual(e.tables[PREFS][0].configuration,config);
    }finally{e.close();}
  }
});
test('layout remains changeable and independent saved settings survive subsequent Save preferences',async()=>{
  const config=P.defaults();config.charts.single[0].symbol=P.preferredDerivSymbol;
  const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner',config)]});try{
    await e.open();e.find('[data-charts-layout="multiple"]').click();assert.equal(e.frames(),3);
    e.action('save');await e.wait(()=>e.tables[PREFS][0].configuration.layout==='multiple');
    assert.deepEqual(e.tables[PREFS][0].configuration.charts,config.charts);
    e.controller.reset();await e.open();assert.equal(e.frames(),3);
  }finally{e.close();}
});
test('a created profile with an unfinished layout resumes setup without registering another account',async()=>{
  const e=environment({profiles:[{user_id:'owner'}]});try{
    await e.open();assert.match(e.find('h2').textContent,/Choose your chart layout/);assert.equal(e.writes.length,0);
    e.controller.reset();await e.open();assert.equal(e.frames(),0);await choose(e,'multiple');assert.equal(e.tables[PROFILES].length,1);
  }finally{e.close();}
});
test('switching users disposes old frames and checks the new profile even when the new user has old preferences',async()=>{
  const config=P.defaults();config.charts.single[0].responsibility='Owner private label';
  const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner',config),stored('other')]});try{
    await e.open();const old=e.find('.charts-frame');e.setUser({id:'other',email:'other@example.test'});await e.open();
    assert.equal(old.isConnected,false);assert.equal(e.frames(),0);assert.match(e.host.textContent,/other@example.test/);
    assert.doesNotMatch(e.host.textContent,/Owner private label/);e.action('create-charts-account');
    await e.wait(()=>e.find('[data-charts-onboarding-layout]'));await choose(e,'multiple');
    assert.ok(e.writes.every(q=>q.body.user_id===undefined||q.body.user_id==='other'));
    assert.deepEqual(e.tables[PREFS].find(row=>row.user_id==='owner').configuration,config);
    e.setUser({id:'owner'});await e.open();assert.equal(e.frames(),1);assert.equal(e.find('[data-chart-field="responsibility"]').value,'Owner private label');
  }finally{e.close();}
});
test('an old profile load finishing after account switching cannot overwrite the current user gate',async()=>{
  let release;const hold=new Promise(resolve=>{release=resolve;});
  const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner')]});try{
    e.setHook(async q=>{if(q.table===PROFILES&&q.filters.some(([k,v])=>k==='user_id'&&v==='owner'))await hold;});
    e.controller.show();await e.wait(()=>e.requests.length===2);e.setUser({id:'other'});await e.open();release();await settle();
    assert.equal(e.frames(),0);assert.equal(e.find('h2').textContent,'Welcome to T-IOS Charts');assert.equal(e.writes.length,0);
  }finally{release();e.close();}
});
test('profile read errors fail closed and Retry loads a verified account',async()=>{
  const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner')]});try{
    e.setHook(q=>q.table===PROFILES?{data:null,error:{code:'NETWORK'}}:undefined);
    await e.open();assert.equal(e.frames(),0);assert.match(e.host.textContent,/could not be verified/);assert.equal(e.writes.length,0);
    e.setHook(()=>{});e.action('reload');await e.wait(()=>e.frames()===1);
  }finally{e.close();}
});
test('expired, mismatched and anonymous Supabase sessions cannot access the Charts tables or mount widgets',async()=>{
  for(const response of [{data:{user:null},error:{message:'expired'}},{data:{user:{id:'other'}},error:null},{data:{user:{id:'owner',is_anonymous:true}},error:null}]){
    const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner')]});try{
      e.setAuthHook(()=>response);await e.open();assert.equal(e.frames(),0);assert.equal(e.requests.length,0);assert.match(e.host.textContent,/session could not be verified/);
    }finally{e.close();}
  }
});
test('invalid saved configuration is preserved and cannot silently turn into defaults',async()=>{
  const row=stored('owner');row.configuration.version=2;
  const e=environment({profiles:[{user_id:'owner'}],preferences:[row]});try{
    await e.open();assert.equal(e.frames(),0);assert.match(e.host.textContent,/unsupported format/);assert.equal(e.tables[PREFS][0].configuration.version,2);assert.equal(e.writes.length,0);
  }finally{e.close();}
});
test('failed profile creation remains on entry, reports an error and unlocks buttons for retry',async()=>{
  const e=environment();try{
    await e.open();e.setHook(q=>q.table===PROFILES&&q.method==='insert'?{data:null,error:{code:'42501'}}:undefined);
    e.action('create-charts-account');await e.wait(()=>e.find('[role="alert"]').textContent.includes('could not be created'));
    assert.equal(e.tables[PROFILES].length,0);assert.equal(e.frames(),0);assert.equal(e.find('[data-charts-action="create-charts-account"]').disabled,false);
    e.setHook(()=>{});e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
  }finally{e.close();}
});
test('failed layout persistence keeps the registered profile and saved preferences, with no early widgets',async()=>{
  const original=P.defaults(),e=environment({preferences:[stored('owner',original)]});try{
    await e.open();e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    e.setHook(q=>q.table===PREFS&&q.method==='update'?{data:null,error:{code:'NETWORK'}}:undefined);
    e.find('[data-charts-onboarding-layout="multiple"]').click();e.action('start-tios-charts');
    await e.wait(()=>e.find('[role="alert"]').textContent.includes('Could not save'));
    assert.equal(e.frames(),0);assert.equal(e.tables[PROFILES].length,1);assert.deepEqual(e.tables[PREFS][0].configuration,original);
    assert.equal(e.find('[data-charts-action="start-tios-charts"]').disabled,false);e.setHook(()=>{});await choose(e,'multiple');
  }finally{e.close();}
});
test('concurrent profile registration loads the real existing profile and saved configuration on duplicate-key conflict',async()=>{
  const config=P.defaults();config.layout='multiple';config.charts.multiple[0].interval='D';
  const e=environment();try{
    await e.open();e.setHook(q=>{
      if(q.table===PROFILES&&q.method==='insert'){
        e.tables[PROFILES].push({user_id:'owner'});e.tables[PREFS].push(stored('owner',config));return {data:null,error:{code:'23505'}};
      }
    });e.action('create-charts-account');await e.wait(()=>e.frames()===3);
    assert.equal(e.tables[PROFILES].length,1);assert.deepEqual(e.tables[PREFS][0].configuration,config);assert.equal(e.writes.length,0);
  }finally{e.close();}
});
test('layout revision conflicts load the latest saved configuration and require confirmation before overwriting it',async()=>{
  const e=environment({preferences:[stored('owner')]});try{
    await e.open();e.action('create-charts-account');await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    const latest=e.tables[PREFS][0];latest.revision=2;latest.configuration.charts.single[0].symbol='BINANCE:BTCUSDT';
    e.action('start-tios-charts');await e.wait(()=>e.find('[role="alert"]').textContent.includes('another device'));
    assert.equal(e.frames(),0);assert.equal(latest.revision,2);await choose(e,'multiple');
    assert.equal(latest.configuration.charts.single[0].symbol,'BINANCE:BTCUSDT');assert.equal(latest.revision,3);
  }finally{e.close();}
});
test('creating a profile while Charts is hidden resumes the layout chooser on return',async()=>{
  let release;const hold=new Promise(resolve=>{release=resolve;}),e=environment();try{
    await e.open();e.setHook(async q=>{if(q.table===PROFILES&&q.method==='insert')await hold;});
    e.action('create-charts-account');await e.wait(()=>e.requests.some(q=>q.method==='insert'));e.controller.hide();release();await settle();await settle();
    assert.equal(e.frames(),0);e.controller.show();await e.wait(()=>e.find('[data-charts-onboarding-layout]'));
    assert.equal(e.tables[PROFILES].length,1);assert.equal(e.find('[data-charts-action="start-tios-charts"]').disabled,false);
  }finally{release();e.close();}
});
test('account changes during profile creation discard stale UI completion and do not unlock a new user operation',async()=>{
  let release;const hold=new Promise(resolve=>{release=resolve;}),e=environment();try{
    await e.open();e.setHook(async q=>{if(q.table===PROFILES&&q.method==='insert'&&q.body.user_id==='owner')await hold;});
    e.action('create-charts-account');await e.wait(()=>e.requests.some(q=>q.method==='insert'));
    e.setUser({id:'other',email:'other@example.test'});await e.open();release();await settle();await settle();
    assert.equal(e.frames(),0);assert.equal(e.find('h2').textContent,'Welcome to T-IOS Charts');
    assert.equal(e.find('[data-charts-action="create-charts-account"]').disabled,false);
    assert.equal(e.tables[PROFILES].filter(row=>row.user_id==='other').length,0);
  }finally{release();e.close();}
});
test('profile identity and private labels never enter external chart iframe settings',async()=>{
  const config=P.defaults();config.charts.single[0].responsibility='Private trading plan';
  const e=environment({profiles:[{user_id:'owner'}],preferences:[stored('owner',config)]});try{
    await e.open();const src=e.find('.charts-frame').src;
    assert.doesNotMatch(decodeURIComponent(src),/owner|example\.test|Private trading plan|access_token|password/);
  }finally{e.close();}
});
test('the application Auth callback clears Charts immediately on account switches and schedules queries outside its lock',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','t-ios.html'),'utf8');
  const start=source.indexOf('  db.auth.onAuthStateChange('),end=source.indexOf('\n}\n',start);
  let callback;const calls=[],scheduled=[];
  const context={db:{auth:{onAuthStateChange(fn){callback=fn;}}},currentUser:{id:'owner'},
    tradeEvidence:{reset:()=>calls.push('evidence')},chartWorkspace:{reset:()=>calls.push('charts')},
    setLoggedInUI:value=>calls.push(value),window:{location:{reload:()=>calls.push('reload'),replace:()=>calls.push('redirect')}},
    setTimeout:fn=>scheduled.push(fn),enterApp:user=>{calls.push('enter '+user.id);return Promise.resolve();},showStatus(){}};
  vm.runInNewContext(source.slice(start,end),context);
  callback('SIGNED_IN',{user:{id:'other'}});assert.deepEqual(calls,['evidence','charts',false,'reload']);assert.equal(context.currentUser,null);
  calls.length=0;callback('INITIAL_SESSION',{user:{id:'other'}});assert.equal(calls.length,0);assert.equal(scheduled.length,1);
  scheduled[0]();assert.deepEqual(calls,['enter other']);calls.length=0;context.currentUser={id:'other'};
  callback('TOKEN_REFRESHED',{user:{id:'other'}});assert.equal(calls.length,0);
  callback('SIGNED_OUT',null);assert.deepEqual(calls,['evidence','charts','redirect']);
});
