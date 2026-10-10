/* Private, versioned native chart analysis. Widget state is never inferred.
   Persist operations before transport; replay only those operations over the
   latest server revision so a stale tab cannot resurrect removed analysis. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIOSChartAnalysis=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const TABLE='chart_workspace_analysis',KEY='tios_chart_analysis_v1:';
  const markets=['v75_1s','v75'],intervals=['1','3','5','15','30','60','120','240','D'];
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const keys=(v,list)=>object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
  const safeKey=v=>typeof v==='string'&&/^[a-z0-9_-]{1,80}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
  const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const empty=()=>({version:1,panes:{}});
  const context=()=>({drawings:[],indicators:[],views:{}});
  const pane=(market='v75_1s',interval='60')=>({engine:'tradingview',market,interval,contexts:{}});
  function validDrawing(d){
    return keys(d,['id','type','points','color','text'])&&safeKey(d.id)
      &&['level','trend','rectangle','text'].includes(d.type)&&color(d.color)
      &&typeof d.text==='string'&&Array.from(d.text).length<=240
      &&Array.isArray(d.points)&&d.points.length===(['trend','rectangle'].includes(d.type)?2:1)
      &&d.points.every(p=>keys(p,['time','price'])&&Number.isSafeInteger(p.time)&&p.time>0&&p.time<8640000000000&&typeof p.price==='number'&&Number.isFinite(p.price)&&p.price>0);
  }
  function validIndicator(i){return keys(i,['id','type','period','color'])&&safeKey(i.id)&&['sma','ema'].includes(i.type)&&Number.isInteger(i.period)&&i.period>=2&&i.period<=500&&color(i.color);}
  function validRange(r){return keys(r,['from','to'])&&Number.isSafeInteger(r.from)&&Number.isSafeInteger(r.to)&&r.from>0&&r.to>r.from&&r.to<8640000000000;}
  function validate(value){
    if(!keys(value,['version','panes'])||value.version!==1||!object(value.panes)||Object.keys(value.panes).length>25||JSON.stringify(value).length>400000)return 'Unsupported saved analysis.';
    for(const [id,p] of Object.entries(value.panes)){
      if(!safeKey(id)||!keys(p,['engine','market','interval','contexts'])||!['native','tradingview'].includes(p.engine)||!markets.includes(p.market)||!intervals.includes(p.interval)||!object(p.contexts)||Object.keys(p.contexts).some(k=>!markets.includes(k)))return 'Unsupported saved chart.';
      for(const c of Object.values(p.contexts)){
        if(!keys(c,['drawings','indicators','views'])||!Array.isArray(c.drawings)||c.drawings.length>200||!c.drawings.every(validDrawing)||new Set(c.drawings.map(d=>d.id)).size!==c.drawings.length||!Array.isArray(c.indicators)||c.indicators.length>25||!c.indicators.every(validIndicator)||new Set(c.indicators.map(i=>i.id)).size!==c.indicators.length||!object(c.views)||Object.entries(c.views).some(([tf,r])=>!intervals.includes(tf)||!validRange(r)))return 'Unsupported saved analysis items.';
      }
    }
    return null;
  }
  function apply(content,op){
    if(!object(op)||!safeKey(op.pane))throw Error('Invalid chart operation.');
    const result=clone(content);
    if(!Object.hasOwn(result.panes,op.pane))result.panes[op.pane]=pane();
    const p=result.panes[op.pane];
    if(op.type==='settings'){
      if(!object(op.value)||Object.keys(op.value).some(k=>!['engine','market','interval'].includes(k)))throw Error('Invalid chart settings.');
      Object.assign(p,op.value);
    }else{
      if(!markets.includes(op.market))throw Error('Invalid analysis market.');
      if(!p.contexts[op.market])p.contexts[op.market]=context();
      const c=p.contexts[op.market];
      if(op.type==='add-drawing'||op.type==='add-indicator'){
        const list=op.type==='add-drawing'?c.drawings:c.indicators;
        if(!list.some(item=>item.id===op.value?.id))list.push(clone(op.value));
      }else if(op.type==='remove-drawing'||op.type==='remove-indicator'){
        const field=op.type==='remove-drawing'?'drawings':'indicators';
        c[field]=c[field].filter(item=>item.id!==op.item);
      }else if(op.type==='view'){
        if(!intervals.includes(op.interval)||!validRange(op.value))throw Error('Invalid view range.');
        c.views[op.interval]=clone(op.value);
      }else throw Error('Unsupported chart operation.');
    }
    const invalid=validate(result);if(invalid)throw Error(invalid);
    return result;
  }
  function replay(base,ops){return ops.reduce(apply,clone(base));}
  function movingAverage(bars,type,period){
    if(!['sma','ema'].includes(type)||!Number.isInteger(period)||period<2||period>500)throw Error('Unsupported indicator.');
    const values=[];let sum=0,ema=null;
    for(let n=0;n<bars.length;n++){
      sum+=bars[n].close;if(n>=period)sum-=bars[n-period].close;
      if(n<period-1)continue;
      ema=n===period-1?sum/period:(bars[n].close-ema)*(2/(period+1))+ema;
      values.push({time:bars[n].time,value:type==='sma'?sum/period:ema});
    }
    return values;
  }
  function create({getClient,getUser,storage,onChange=()=>{},makeId=()=>crypto.randomUUID()}){
    const owner=getUser()?.id;if(!owner)throw Error('Sign in to Charts first.');
    let base=empty(),content=empty(),pending=[],revision=null,ready=false,disposed=false,loading=false,flushing=null;
    let state='loading',message='Loading saved analysis…',localDurable=false,cacheAvailable=false;
    const alive=()=>!disposed&&getUser()?.id===owner;
    const snapshot=()=>({content:clone(content),ready,state,message,pending:pending.length,localDurable});
    const publish=()=>{if(alive())onChange(snapshot());};
    function remember(){
      try{
        if(!storage)throw Error('Local storage unavailable');
        storage.setItem(KEY+owner,JSON.stringify({version:1,userId:owner,base,pending,revision}));
        localDurable=true;cacheAvailable=true;
      }catch(_){localDurable=false;}
    }
    try{
      const cache=JSON.parse(storage?.getItem(KEY+owner)||'null');
      if(cache?.version===1&&cache.userId===owner&&!validate(cache.base)&&Array.isArray(cache.pending)&&cache.pending.length<=500){
        const restored=replay(cache.base,cache.pending);
        base=cache.base;content=restored;pending=cache.pending;revision=cache.revision;cacheAvailable=true;localDurable=true;
      }
    }catch(_){/* Preserve the original cache and rely on the account copy. */}
    async function verified(){
      if(!alive())throw Error('Charts account changed.');
      const {data,error}=await getClient().auth.getUser();
      if(error||data?.user?.id!==owner||data.user.is_anonymous||!alive())throw Error('Your T-IOS session must be verified before analysis can be saved.');
    }
    function readRow(row){
      if(!row)return {content:empty(),revision:null};
      if(row.user_id!==owner||!Number.isInteger(row.revision)||row.revision<1||validate(row.content))throw Error('Saved analysis could not be read safely. The account copy is preserved.');
      return {content:row.content,revision:row.revision};
    }
    async function read(){
      const {data,error}=await getClient().from(TABLE).select('user_id,content,revision').eq('user_id',owner).maybeSingle();
      if(error)throw Error('Your saved analysis could not be loaded. Retry when your connection is available.');
      return readRow(data);
    }
    async function load(){
      if(loading||!alive())return;
      loading=true;state='loading';publish();
      try{
        await verified();const row=await read();if(!alive())return;
        base=clone(row.content);revision=row.revision;content=replay(base,pending);ready=true;remember();
        state=pending.length?'pending':'saved';message=pending.length?'Restoring unsynced analysis…':row.revision===null?'No saved analysis yet · choose Saved analysis to begin':'Analysis saved to your Charts account';publish();
      }catch(error){
        if(!alive())return;
        ready=cacheAvailable;state='error';message=error.message+(ready?' Your recovery copy is retained on this browser.':'');publish();
      }finally{loading=false;}
      if(alive()&&ready&&pending.length)flush();
    }
    function change(op){
      if(!alive()||!ready)throw Error('Wait for saved analysis to load.');
      if(pending.length>=500)throw Error('Reconnect and save your pending analysis before adding more.');
      const next={...clone(op),opId:makeId()};
      content=apply(content,next);
      if(next.type==='view')pending=pending.filter(previous=>!(previous.type==='view'&&previous.pane===next.pane&&previous.market===next.market&&previous.interval===next.interval));
      pending.push(next);remember();
      state='pending';message=localDurable?'Saved on this browser · syncing to your account…':'Saving to your account · keep this page open until saved';publish();flush();
    }
    function flush(){
      if(flushing||!alive()||!ready||!pending.length)return flushing||Promise.resolve();
      flushing=(async()=>{
        state='saving';publish();
        try{
          for(let attempts=0;pending.length&&attempts<8;attempts++){
            await verified();const row=await read();if(!alive())return;
            const batch=pending.slice(),next=replay(row.content,batch);
            const query=row.revision===null
              ?getClient().from(TABLE).insert({user_id:owner,content:next})
              :getClient().from(TABLE).update({content:next}).eq('user_id',owner).eq('revision',row.revision);
            const {data,error}=await query.select('user_id,content,revision').maybeSingle();if(!alive())return;
            if(error?.code==='23505'||(!error&&!data))continue;
            if(error)throw Error('Account save failed. Your analysis is retained; press Retry save when connected.');
            const acknowledged=readRow(data);
            const sent=new Set(batch.map(op=>op.opId));pending=pending.filter(op=>!sent.has(op.opId));
            base=clone(acknowledged.content);revision=acknowledged.revision;content=replay(base,pending);remember();
            state=pending.length?'saving':'saved';message=pending.length?'Saving latest changes…':'Analysis saved to your Charts account';publish();
          }
          if(pending.length)throw Error('Another tab is changing this workspace. Your changes are retained; press Retry save.');
        }catch(error){if(alive()){state='error';message=error.message+(!localDurable?' Local recovery is unavailable; keep this page open until saved.':'');publish();}}
      })().finally(()=>{flushing=null;});
      return flushing;
    }
    return {load,change,flush,snapshot,
      getPane(id,market='v75_1s',interval='60'){return clone(content.panes[id]||pane(market,intervals.includes(interval)?interval:'60'));},
      getContext(id,market){return clone(content.panes[id]?.contexts[market]||context());},
      dispose(){disposed=true;},owner};
  }
  return {TABLE,KEY,markets,intervals,empty,pane,context,validate,validDrawing,validIndicator,apply,replay,movingAverage,create};
});
