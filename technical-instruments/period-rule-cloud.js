(function(root){
  'use strict';
  // Cloud is a validated copy of the existing local period-review format.
  // On failed network calls local reviews stay intact and the caller reports
  // their actual persistence state. No trade-specific execution rows are touched.
  function create({getClient,getUser,getAccount,storage,rules}){
    let generation=0;
    const table='tios_period_rule_reviews';
    function identity(){
      const userId=getUser()?.id,accountId=getAccount()?.id;
      return userId&&accountId?{userId,accountId}:null;
    }
    function valid(row,scope){
      if(!row||row.userId!==scope.userId||row.accountId!==scope.accountId)return false;
      try {
        const key=rules.storageKey(scope.userId,scope.accountId);
        const probe={getItem:k=>k===key?JSON.stringify([row]):null};
        return rules.read(probe,scope.userId,scope.accountId).length===1;
      }catch(_){return false;}
    }
    function stamp(row){
      const ms=Date.parse(row?.savedAt||row?.createdAt||'');
      return Number.isFinite(ms)?ms:0;
    }
    function readLocal(scope){return rules.read(storage,scope.userId,scope.accountId);}
    async function sync(){
      const scope=identity(),client=getClient(),turn=++generation;
      if(!scope||!client) return {state:'unavailable'};
      let local;
      try{local=readLocal(scope);}catch(e){return {state:'local-error',message:e.message};}
      const query=await client.from(table).select('review_key,payload').eq('user_id',scope.userId).eq('account_id',scope.accountId);
      if(query.error) return {state:'cloud-error',message:query.error.message};
      if(turn!==generation||!identity()||identity().userId!==scope.userId||identity().accountId!==scope.accountId)return {state:'scope-changed'};
      const remote=(query.data||[]).map(x=>x.payload).filter(x=>valid(x,scope));
      const remoteByKey=new Map(remote.map(x=>[x.key,x]));
      const localByKey=new Map(local.map(x=>[x.key,x]));
      const push=local.filter(x=>!remoteByKey.has(x.key)||stamp(x)>stamp(remoteByKey.get(x.key)));
      // Never discard a local version if cloud upload is rejected.
      let uploaded=true;
      for(const x of push){
        const result=await client.from(table).upsert({user_id:scope.userId,account_id:scope.accountId,review_key:x.key,payload:x},{onConflict:'user_id,account_id,review_key'}).select('review_key,payload').single();
        if(result.error||result.data?.review_key!==x.key||JSON.stringify(result.data?.payload)!==JSON.stringify(x)){uploaded=false;break;}
        if(turn!==generation||identity()?.accountId!==scope.accountId||identity()?.userId!==scope.userId)return {state:'scope-changed'};
      }
      if(!uploaded)return {state:'cloud-error',message:'Local reviews remain available, but the cloud upload was not verified.'};
      // Refresh immediately before merging to retain edits from another tab.
      let latest;
      try{latest=readLocal(scope);}catch(e){return {state:'local-error',message:e.message};}
      const combined=new Map(latest.map(x=>[x.key,x]));
      remote.forEach(x=>{if(!combined.has(x.key)||stamp(x)>stamp(combined.get(x.key)))combined.set(x.key,x);});
      try{
        const key=rules.storageKey(scope.userId,scope.accountId);
        storage.setItem(key,JSON.stringify([...combined.values()]));
        if(readLocal(scope).length!==combined.size)throw new Error('Local verification failed');
      }catch(e){return {state:'local-error',message:'Cloud is available but local cache could not be updated: '+e.message};}
      return {state:'synced',count:combined.size};
    }
    async function save(record){
      const scope=identity();
      if(!scope||!valid(record,scope))throw new Error('Cannot save a review outside the selected account.');
      rules.save(storage,record);
      // Saving locally is not represented as a successful cloud write.
      const result=await sync();
      return result.state==='synced'?{state:'synced'}:{state:'local-only',reason:result.message||result.state};
    }
    return {sync,save,invalidate:()=>{generation++;}};
  }
  root.TIOSPeriodRuleCloud={create};
  if(typeof module==='object'&&module.exports)module.exports={create};
})(typeof window!=='undefined'?window:globalThis);
