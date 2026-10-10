'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../core/chart-analysis.js');
const clone=v=>JSON.parse(JSON.stringify(v)),settle=()=>new Promise(r=>setImmediate(r));
const level=id=>({id,type:'level',points:[{time:1791657000,price:101.12345}],color:'#a78bfa',text:''});
const indicator=id=>({id,type:'ema',period:20,color:'#11aaee'});
function environment({storage=new Map(),rows=new Map(),id='owner',hook=()=>{},auth=()=>null,localStorage=null}={}){
  let user={id},counter=0;const requests=[];
  const client={auth:{async getUser(){return await auth()||{data:{user},error:null};}},from(table){
    assert.equal(table,A.TABLE);let method='read',body=null,filters=[];
    const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle(){return q;},insert(v){method='insert';body=clone(v);return q;},update(v){method='update';body=clone(v);return q;},then(resolve,reject){return Promise.resolve().then(async()=>{
      const request={method,body,filters};requests.push(request);const result=await hook(request);if(result)return result;
      const owner=method==='insert'?body.user_id:filters.find(([k])=>k==='user_id')?.[1];
      if(owner!==user.id)return {error:{code:'42501'},data:null};
      let row=rows.get(owner);
      if(method==='insert'){
        if(row)return {error:{code:'23505'},data:null};
        row={...body,revision:1};rows.set(owner,row);
      }else if(method==='update'){
        if(!row||filters.some(([k,v])=>row[k]!==v))return {error:null,data:null};
        row={...row,...body,revision:row.revision+1};rows.set(owner,row);
      }
      return {data:row?clone(row):null,error:null};
    }).then(resolve,reject);}};return q;
  }};
  const local={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  const store=A.create({getClient:()=>client,getUser:()=>user,storage:localStorage||local,makeId:()=> 'op-'+(++counter)+'-'+Math.random().toString(36).slice(2)});
  return {store,rows,storage,requests,setUser:id=>{user={id};},change:op=>store.change({pane:'single_single',market:'v75_1s',...op}),async load(){await store.load();},async saved(){for(let n=0;n<50;n++){if(!store.snapshot().pending)return;await settle();}assert.equal(store.snapshot().pending,0,store.snapshot().message);}};
}
test('analysis reads never create a record or fabricate saved account state',async()=>{
 const e=environment();await e.load();assert.equal(e.rows.size,0);assert.match(e.store.snapshot().message,/No saved analysis yet/);assert.ok(e.requests.every(r=>r.method==='read'));
});
test('drawings, indicator settings, native mode and timeframe restore from the account after refresh',async()=>{
 const e=environment();await e.load();e.change({type:'settings',value:{engine:'native',interval:'5'}});e.change({type:'add-drawing',value:level('support')});e.change({type:'add-indicator',value:indicator('ema')});await e.saved();e.store.dispose();
 const fresh=environment({rows:e.rows});await fresh.load();assert.equal(fresh.store.getPane('single_single').engine,'native');assert.equal(fresh.store.getPane('single_single').interval,'5');assert.deepEqual(fresh.store.getContext('single_single','v75_1s').drawings,[level('support')]);assert.deepEqual(fresh.store.getContext('single_single','v75_1s').indicators,[indicator('ema')]);
});
test('removed drawings and indicators stay removed through repeated refreshes, including explicit empty arrays',async()=>{
 const e=environment();await e.load();e.change({type:'add-drawing',value:level('support')});e.change({type:'add-indicator',value:indicator('ema')});await e.saved();e.change({type:'remove-drawing',item:'support'});e.change({type:'remove-indicator',item:'ema'});await e.saved();
 for(let i=0;i<3;i++){const next=environment({rows:e.rows});await next.load();assert.deepEqual(next.store.getContext('single_single','v75_1s').drawings,[]);assert.deepEqual(next.store.getContext('single_single','v75_1s').indicators,[]);next.store.dispose();}
});
test('a refresh before the network acknowledges an edit restores the synchronous recovery journal',async()=>{
 let offline=true;const e=environment({hook:r=>offline&&r.method!=='read'?{data:null,error:{code:'network'}}:null});await e.load();e.change({type:'settings',value:{engine:'native'}});e.change({type:'add-drawing',value:level('pending')});
 assert.equal(JSON.parse(e.storage.get(A.KEY+'owner')).pending.length,2);await e.store.flush();assert.equal(e.store.snapshot().state,'error');e.store.dispose();offline=false;
 const next=environment({rows:e.rows,storage:e.storage});await next.load();assert.equal(next.store.getContext('single_single','v75_1s').drawings[0].id,'pending');await next.saved();assert.equal(next.rows.get('owner').content.panes.single_single.contexts.v75_1s.drawings[0].id,'pending');
});
test('offline removal survives refresh and is replayed without bringing the indicator back',async()=>{
 const rows=new Map();const first=environment({rows});await first.load();first.change({type:'add-indicator',value:indicator('ema')});await first.saved();first.store.dispose();
 const offline=environment({rows,hook:r=>r.method!=='read'?{data:null,error:{code:'network'}}:null});await offline.load();offline.change({type:'remove-indicator',item:'ema'});await offline.store.flush();offline.store.dispose();
 const next=environment({rows,storage:offline.storage});await next.load();assert.deepEqual(next.store.getContext('single_single','v75_1s').indicators,[]);await next.saved();assert.deepEqual(rows.get('owner').content.panes.single_single.contexts.v75_1s.indicators,[]);
});
test('a stale tab adding new work merges with a remote removal instead of restoring its old snapshot',async()=>{
 const first=environment();await first.load();first.change({type:'add-drawing',value:level('old')});await first.saved();
 const second=environment({rows:first.rows});await second.load();first.change({type:'remove-drawing',item:'old'});await first.saved();second.change({type:'add-drawing',value:level('new')});await second.saved();assert.deepEqual(second.rows.get('owner').content.panes.single_single.contexts.v75_1s.drawings.map(d=>d.id),['new']);
});
test('revision conflicts replay edits over current content and preserve concurrent new analysis',async()=>{
 let conflict=false;const e=environment({hook:r=>{
  if(conflict&&r.method==='update'){conflict=false;const row=e.rows.get('owner');row.content=A.apply(row.content,{type:'add-drawing',pane:'single_single',market:'v75_1s',value:level('other-tab')});row.revision++;return {data:null,error:null};}
 }});await e.load();e.change({type:'settings',value:{engine:'native'}});await e.saved();conflict=true;e.change({type:'add-drawing',value:level('my-edit')});await e.saved();assert.deepEqual(e.rows.get('owner').content.panes.single_single.contexts.v75_1s.drawings.map(d=>d.id),['other-tab','my-edit']);
});
test('duplicate initial insert is reconciled against the real current account row',async()=>{
 let once=true;const e=environment({hook:r=>{if(once&&r.method==='insert'){once=false;e.rows.set('owner',{user_id:'owner',content:A.apply(A.empty(),{type:'add-drawing',pane:'multiple_context',market:'v75',value:level('context')}),revision:1});return {data:null,error:{code:'23505'}};}}});await e.load();e.change({type:'add-drawing',value:level('single')});await e.saved();assert.equal(Object.keys(e.rows.get('owner').content.panes).length,2);
});
test('pane and instrument scope retain separate analysis across layout and timeframe changes',async()=>{
 const e=environment();await e.load();e.change({type:'add-drawing',value:level('single')});e.change({type:'add-drawing',pane:'multiple_context',value:level('context')});e.change({type:'add-drawing',pane:'multiple_entry',market:'v75',value:level('entry')});e.change({type:'settings',value:{market:'v75',interval:'240'}});await e.saved();assert.equal(e.store.getContext('single_single','v75_1s').drawings[0].id,'single');assert.equal(e.store.getContext('multiple_context','v75_1s').drawings[0].id,'context');assert.equal(e.store.getContext('multiple_entry','v75').drawings[0].id,'entry');assert.deepEqual(e.store.getContext('single_single','v75').drawings,[]);
});
test('account switching cannot display the previous account recovery copy or mutate the next account',async()=>{
 const e=environment();await e.load();e.change({type:'add-drawing',value:level('private')});await e.saved();e.setUser('other');assert.throws(()=>e.change({type:'remove-drawing',item:'private'}),/Wait/);e.store.dispose();
 const next=environment({id:'other',rows:e.rows,storage:e.storage});await next.load();assert.deepEqual(next.store.getContext('single_single','v75_1s').drawings,[]);assert.equal(next.rows.has('other'),false);
});
test('expired or mismatched sessions cannot read or save private analysis',async()=>{
 for(const user of [null,{id:'wrong'},{id:'owner',is_anonymous:true}]){
  const e=environment({auth:()=>({data:{user},error:null})});await e.load();assert.equal(e.requests.length,0);assert.equal(e.store.snapshot().ready,false);assert.match(e.store.snapshot().message,/verified/);
 }
});
test('malformed server content fails closed without overwriting the stored record',async()=>{
 const rows=new Map([['owner',{user_id:'owner',content:{version:99},revision:1}]]);const e=environment({rows});await e.load();assert.equal(e.store.snapshot().ready,false);assert.equal(rows.get('owner').content.version,99);assert.equal(e.requests.length,1);
});
test('storage failures cannot claim refresh-safe recovery and leave pending account saves visible',async()=>{
 const e=environment({hook:r=>r.method!=='read'?{data:null,error:{code:'network'}}:null,localStorage:{getItem(){return null;},setItem(){throw Error('quota');}}});
 await e.load();e.change({type:'add-drawing',value:level('pending')});await e.store.flush();assert.equal(e.store.snapshot().localDurable,false);assert.equal(e.store.snapshot().pending,1);assert.match(e.store.snapshot().message,/keep this page open/);assert.equal(e.rows.size,0);
});
test('validating analysis rejects prototype keys, unsafe colours, duplicate identities and unsupported indicators',()=>{
 const safe=A.apply(A.empty(),{type:'add-drawing',pane:'single_single',market:'v75_1s',value:level('one')});assert.equal(A.validate(safe),null);
 assert.throws(()=>A.apply(safe,{type:'settings',pane:'__proto__',value:{engine:'native'}}));
 const dup=clone(safe);dup.panes.single_single.contexts.v75_1s.drawings.push(level('one'));assert.ok(A.validate(dup));
 assert.equal(A.validDrawing({...level('x'),color:'red;url(javascript:1)'}),false);assert.equal(A.validIndicator({...indicator('i'),period:1}),false);
 assert.equal(A.validDrawing({...level('x'),points:[{time:NaN,price:1}]}),false);
});
test('SMA and EMA use real closing prices, including exact seed and iterative EMA values',()=>{
 const bars=[1,2,3,4,5].map((close,n)=>({time:n+1,close}));assert.deepEqual(A.movingAverage(bars,'sma',3),[{time:3,value:2},{time:4,value:3},{time:5,value:4}]);assert.deepEqual(A.movingAverage(bars,'ema',3),[{time:3,value:2},{time:4,value:3},{time:5,value:4}]);assert.deepEqual(A.movingAverage(bars,'sma',20),[]);
});
