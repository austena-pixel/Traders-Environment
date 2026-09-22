/* H-IOS CONNECTION LAYER 1
   Shared communication gateway for H-IOS and Goals-IOS.
   Goals-IOS remains the owner of goal-domain records; H-IOS consumes them. */

(function initialiseHiosConnectionLayer(global){
  'use strict';

  if(global.HIOSConnectionLayer)return;

  const KEYS=Object.freeze({
    goals:'hios_gios_goals_v2',
    snapshot:'hios_gios_dashboard_v1',
    lastSignal:'hios_communication_last_signal_v1',
    log:'hios_communication_log_v1',
    connectionState:'hios_connection_state_v1',
    requests:'hios_communication_requests_v1'
  });

  const CHANNEL='hios-communication-centre-v1';
  const CONTRACT_VERSION=1;
  const MAX_LOG_ENTRIES=250;

  const allowedSources=new Set([
    'goals-ios',
    'h-ios'
  ]);

  const allowedTypes=new Set([
    'goal.created',
    'goal.updated',
    'goal.completed',
    'goal.deleted',
    'goal.progress.changed',
    'goal.deadline.changed',

    'task.created',
    'task.updated',
    'task.completed',
    'task.deleted',

    'goals.snapshot.updated',
    'goals.state.synchronised',

    'calendar.item.created',
    'calendar.item.updated',
    'calendar.item.deleted',

    'task.calendar.remove.requested',
    'goal.calendar.remove.requested',
    'task.delete.requested',
    'goal.delete.requested'
  ]);

  let channel=null;

  try{
    if('BroadcastChannel' in global){
      channel=new BroadcastChannel(CHANNEL);
    }
  }catch(error){
    console.warn(
      'H-IOS live channel is unavailable:',
      error
    );
  }

  function safeParse(raw,fallback){
    try{
      return raw
        ? JSON.parse(raw)
        : fallback;
    }catch(error){
      return fallback;
    }
  }

  function randomId(prefix='sig'){
    if(
      global.crypto &&
      typeof global.crypto.randomUUID==='function'
    ){
      return `${prefix}_${global.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  function createSignal(
    source,
    type,
    payload={},
    meta={}
  ){
    return {
      signalId:randomId('signal'),
      contractVersion:CONTRACT_VERSION,
      source,
      type,
      timestamp:new Date().toISOString(),

      payload:
        payload &&
        typeof payload==='object'
          ? payload
          : {value:payload},

      meta:
        meta &&
        typeof meta==='object'
          ? meta
          : {}
    };
  }

  function validateSignal(signal){
    const errors=[];

    if(
      !signal ||
      typeof signal!=='object'
    ){
      errors.push(
        'Signal must be an object.'
      );
    }

    if(!signal?.signalId){
      errors.push(
        'signalId is required.'
      );
    }

    if(!allowedSources.has(signal?.source)){
      errors.push(
        'Unknown signal source.'
      );
    }

    if(!allowedTypes.has(signal?.type)){
      errors.push(
        'Unknown signal type.'
      );
    }

    if(
      !signal?.timestamp ||
      Number.isNaN(
        Date.parse(signal.timestamp)
      )
    ){
      errors.push(
        'Valid timestamp is required.'
      );
    }

    if(
      !signal?.payload ||
      typeof signal.payload!=='object' ||
      Array.isArray(signal.payload)
    ){
      errors.push(
        'payload must be an object.'
      );
    }

    return {
      valid:errors.length===0,
      errors
    };
  }

  function readLog(){
    const parsed=safeParse(
      localStorage.getItem(KEYS.log),
      []
    );

    return Array.isArray(parsed)
      ? parsed
      : [];
  }

  function appendLog(
    signal,
    status='routed',
    errors=[]
  ){
    const entries=readLog();

    entries.push({
      signalId:
        signal?.signalId ||
        randomId('invalid'),

      source:
        signal?.source ||
        'unknown',

      type:
        signal?.type ||
        'unknown',

      timestamp:
        signal?.timestamp ||
        new Date().toISOString(),

      status,
      errors
    });

    localStorage.setItem(
      KEYS.log,
      JSON.stringify(
        entries.slice(-MAX_LOG_ENTRIES)
      )
    );
  }

  function updateConnectionState(source){
    const state=safeParse(
      localStorage.getItem(
        KEYS.connectionState
      ),
      {}
    );

    state[source]={
      status:'connected',
      lastSeenAt:new Date().toISOString()
    };

    localStorage.setItem(
      KEYS.connectionState,
      JSON.stringify(state)
    );
  }

  function readRequests(){
    const parsed=safeParse(
      localStorage.getItem(KEYS.requests),
      []
    );

    return Array.isArray(parsed)
      ? parsed
      : [];
  }

  function queueRequest(signal){
    if(
      !String(signal?.type || '')
        .endsWith('.requested')
    ){
      return;
    }

    const requests=readRequests();

    const alreadyQueued=requests.some(
      request=>
        request.signalId===signal.signalId
    );

    if(alreadyQueued)return;

    requests.push({
      ...signal,
      status:'pending'
    });

    localStorage.setItem(
      KEYS.requests,
      JSON.stringify(
        requests.slice(-100)
      )
    );
  }

  function getPendingRequests(){
    return readRequests().filter(
      request=>
        request.status==='pending'
    );
  }

  function acknowledgeRequest(
    signalId,
    outcome={}
  ){
    if(!signalId)return false;

    const requests=readRequests();

    const index=requests.findIndex(
      request=>
        request.signalId===signalId
    );

    if(index<0)return false;

    requests[index]={
      ...requests[index],

      status:'handled',

      handledAt:
        new Date().toISOString(),

      outcome:
        outcome &&
        typeof outcome==='object'
          ? outcome
          : {value:outcome}
    };

    localStorage.setItem(
      KEYS.requests,
      JSON.stringify(
        requests.slice(-100)
      )
    );

    return true;
  }

  function route(signal){
    const result=validateSignal(signal);

    if(!result.valid){
      appendLog(
        signal,
        'rejected',
        result.errors
      );

      console.warn(
        'H-IOS rejected an invalid signal:',
        result.errors,
        signal
      );

      return {
        ok:false,
        errors:result.errors
      };
    }

    appendLog(signal);

    updateConnectionState(
      signal.source
    );

    queueRequest(signal);

    localStorage.setItem(
      KEYS.lastSignal,
      JSON.stringify(signal)
    );

    global.dispatchEvent(
      new CustomEvent(
        'hios:signal',
        {
          detail:signal
        }
      )
    );

    if(channel){
      channel.postMessage(signal);
    }

    return {
      ok:true,
      signal
    };
  }

  function subscribe(
    handler,
    options={}
  ){
    if(typeof handler!=='function'){
      return function noop(){};
    }

    const source=
      options.source || '';

    const types=
      options.types
        ? new Set(options.types)
        : null;

    const seenSignalIds=
      new Set();

    const accept=signal=>{
      if(!signal)return;

      if(
        source &&
        signal.source!==source
      ){
        return;
      }

      if(
        types &&
        !types.has(signal.type)
      ){
        return;
      }

      if(
        signal.signalId &&
        seenSignalIds.has(
          signal.signalId
        )
      ){
        return;
      }

      if(signal.signalId){
        seenSignalIds.add(
          signal.signalId
        );

        if(seenSignalIds.size>100){
          seenSignalIds.delete(
            seenSignalIds
              .values()
              .next()
              .value
          );
        }
      }

      handler(signal);
    };

    const onWindow=event=>{
      accept(event.detail);
    };

    const onStorage=event=>{
      if(
        event.key!==KEYS.lastSignal ||
        !event.newValue
      ){
        return;
      }

      accept(
        safeParse(
          event.newValue,
          null
        )
      );
    };

    const onChannel=event=>{
      accept(event.data);
    };

    global.addEventListener(
      'hios:signal',
      onWindow
    );

    global.addEventListener(
      'storage',
      onStorage
    );

    if(channel){
      channel.addEventListener(
        'message',
        onChannel
      );
    }

    return ()=>{
      global.removeEventListener(
        'hios:signal',
        onWindow
      );

      global.removeEventListener(
        'storage',
        onStorage
      );

      if(channel){
        channel.removeEventListener(
          'message',
          onChannel
        );
      }
    };
  }

  function readGoals(){
    const parsed=safeParse(
      localStorage.getItem(KEYS.goals),
      []
    );

    return Array.isArray(parsed)
      ? parsed
      : [];
  }

  function readSnapshot(){
    const parsed=safeParse(
      localStorage.getItem(
        KEYS.snapshot
      ),
      null
    );

    return (
      parsed &&
      typeof parsed==='object'
    )
      ? parsed
      : null;
  }

  function writeGoals(goals){
    if(!Array.isArray(goals)){
      throw new TypeError(
        'Goals must be an array.'
      );
    }

    localStorage.setItem(
      KEYS.goals,
      JSON.stringify(goals)
    );
  }

  let lastSnapshotFingerprint='';

  function publishSnapshot(snapshot){
    if(
      !snapshot ||
      typeof snapshot!=='object'
    ){
      throw new TypeError(
        'Snapshot must be an object.'
      );
    }

    const serialised=
      JSON.stringify(snapshot);

    localStorage.setItem(
      KEYS.snapshot,
      serialised
    );

    const fingerprint=
      JSON.stringify({
        ...snapshot,
        updatedAt:undefined
      });

    if(
      fingerprint===
      lastSnapshotFingerprint
    ){
      return null;
    }

    lastSnapshotFingerprint=
      fingerprint;

    return route(
      createSignal(
        'goals-ios',
        'goals.snapshot.updated',
        {
          updatedAt:
            snapshot.updatedAt,

          activeGoals:
            snapshot.activeGoals,

          highPriority:
            snapshot.highPriority
        }
      )
    );
  }

  function emit(
    source,
    type,
    payload={},
    meta={}
  ){
    return route(
      createSignal(
        source,
        type,
        payload,
        meta
      )
    );
  }

  function connect(source){
    if(!allowedSources.has(source)){
      throw new Error(
        `Unsupported H-IOS source: ${source}`
      );
    }

    updateConnectionState(source);

    return Object.freeze({
      emit:(
        type,
        payload,
        meta
      )=>{
        return emit(
          source,
          type,
          payload,
          meta
        );
      },

      subscribe,

      readGoals,

      readSnapshot,

      getPendingRequests,

      acknowledgeRequest:
        source==='goals-ios'
          ? acknowledgeRequest
          : undefined,

      writeGoals:
        source==='goals-ios'
          ? writeGoals
          : undefined,

      publishSnapshot:
        source==='goals-ios'
          ? publishSnapshot
          : undefined,

      getConnectionState:()=>{
        return safeParse(
          localStorage.getItem(
            KEYS.connectionState
          ),
          {}
        );
      },

      getLog:readLog
    });
  }

  global.HIOSConnectionLayer=
    Object.freeze({
      version:CONTRACT_VERSION,
      keys:KEYS,
      connect,
      validateSignal
    });

})(window);
