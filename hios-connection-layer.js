/* Generated compatibility bundle. Edit 03-communication-centre modules, not this file. */
/* H·IOS Communication Centre — stable signal contracts. */
(function registerDataContracts(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.contracts)return;

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
  const SOURCES=Object.freeze(['goals-ios','h-ios']);
  const TYPES=Object.freeze([
    'goal.created','goal.updated','goal.completed','goal.deleted',
    'goal.progress.changed','goal.deadline.changed',
    'task.created','task.updated','task.completed','task.deleted',
    'goals.snapshot.updated','goals.state.synchronised',
    'calendar.item.created','calendar.item.updated','calendar.item.deleted',
    'task.calendar.remove.requested','goal.calendar.remove.requested',
    'task.delete.requested','goal.delete.requested'
  ]);
  const sourceSet=new Set(SOURCES);
  const typeSet=new Set(TYPES);

  function safeParse(raw,fallback){
    try{return raw?JSON.parse(raw):fallback}catch(error){return fallback}
  }

  function randomId(prefix='sig'){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return `${prefix}_${global.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function createSignal(source,type,payload={},meta={}){
    return {
      signalId:randomId('signal'),
      contractVersion:CONTRACT_VERSION,
      source,
      type,
      timestamp:new Date().toISOString(),
      payload:payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{value:payload},
      meta:meta&&typeof meta==='object'&&!Array.isArray(meta)?meta:{}
    };
  }

  function validateSignal(signal){
    const errors=[];
    if(!signal||typeof signal!=='object')errors.push('Signal must be an object.');
    if(!signal?.signalId)errors.push('signalId is required.');
    if(!sourceSet.has(signal?.source))errors.push('Unknown signal source.');
    if(!typeSet.has(signal?.type))errors.push('Unknown signal type.');
    if(!signal?.timestamp||Number.isNaN(Date.parse(signal.timestamp)))errors.push('Valid timestamp is required.');
    if(!signal?.payload||typeof signal.payload!=='object'||Array.isArray(signal.payload))errors.push('payload must be an object.');
    return {valid:errors.length===0,errors};
  }

  modules.contracts=Object.freeze({
    KEYS,
    CHANNEL,
    CONTRACT_VERSION,
    MAX_LOG_ENTRIES,
    SOURCES,
    TYPES,
    safeParse,
    randomId,
    createSignal,
    validateSignal,
    isAllowedSource:source=>sourceSet.has(source),
    isAllowedType:type=>typeSet.has(type)
  });
})(window);

/* H·IOS Communication Centre — source-level publishing permissions. */
(function registerPermissions(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.permissions)return;

  const sourceTypes=Object.freeze({
    'goals-ios':Object.freeze([
      'goal.created','goal.updated','goal.completed','goal.deleted',
      'goal.progress.changed','goal.deadline.changed',
      'task.created','task.updated','task.completed','task.deleted',
      'goals.snapshot.updated','goals.state.synchronised'
    ]),
    'h-ios':Object.freeze([
      'calendar.item.created','calendar.item.updated','calendar.item.deleted',
      'task.calendar.remove.requested','goal.calendar.remove.requested',
      'task.delete.requested','goal.delete.requested'
    ])
  });
  const permissionSets=Object.fromEntries(
    Object.entries(sourceTypes).map(([source,types])=>[source,new Set(types)])
  );

  modules.permissions=Object.freeze({
    sourceTypes,
    canEmit:(source,type)=>Boolean(permissionSets[source]?.has(type))
  });
})(window);

/* H·IOS Communication Centre — bounded local routing log. */
(function registerCommunicationLog(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.log)return;
  const contracts=modules.contracts;
  if(!contracts)throw new Error('data-contracts.js must load before communication-log.js');

  function read(){
    const parsed=contracts.safeParse(localStorage.getItem(contracts.KEYS.log),[]);
    return Array.isArray(parsed)?parsed:[];
  }

  function append(signal,status='routed',errors=[]){
    const entries=read();
    entries.push({
      signalId:signal?.signalId||contracts.randomId('invalid'),
      source:signal?.source||'unknown',
      type:signal?.type||'unknown',
      timestamp:signal?.timestamp||new Date().toISOString(),
      status,
      errors:Array.isArray(errors)?errors:[]
    });
    localStorage.setItem(
      contracts.KEYS.log,
      JSON.stringify(entries.slice(-contracts.MAX_LOG_ENTRIES))
    );
  }

  modules.log=Object.freeze({read,append});
})(window);

/* H·IOS Communication Centre — product connection presence. */
(function registerConnectionState(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.connectionState)return;
  const contracts=modules.contracts;
  if(!contracts)throw new Error('data-contracts.js must load before connection-state.js');

  function read(){
    const state=contracts.safeParse(localStorage.getItem(contracts.KEYS.connectionState),{});
    return state&&typeof state==='object'&&!Array.isArray(state)?state:{};
  }

  function touch(source,status='connected'){
    const state=read();
    state[source]={status,lastSeenAt:new Date().toISOString()};
    localStorage.setItem(contracts.KEYS.connectionState,JSON.stringify(state));
    return state[source];
  }

  modules.connectionState=Object.freeze({read,touch});
})(window);

/* H·IOS Communication Centre — in-page, cross-tab and storage transport. */
(function registerSignalBus(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.signalBus)return;
  const contracts=modules.contracts;
  if(!contracts)throw new Error('data-contracts.js must load before signal-bus.js');

  let channel=null;
  try{
    if('BroadcastChannel' in global)channel=new global.BroadcastChannel(contracts.CHANNEL);
  }catch(error){
    console.warn('H-IOS live channel is unavailable:',error);
  }

  function publish(signal){
    localStorage.setItem(contracts.KEYS.lastSignal,JSON.stringify(signal));
    global.dispatchEvent(new CustomEvent('hios:signal',{detail:signal}));
    if(channel)channel.postMessage(signal);
  }

  function subscribe(handler,options={}){
    if(typeof handler!=='function')return function noop(){};
    const source=options.source||'';
    const types=options.types?new Set(options.types):null;
    const seenSignalIds=new Set();
    const accept=signal=>{
      if(!signal)return;
      if(source&&signal.source!==source)return;
      if(types&&!types.has(signal.type))return;
      if(signal.signalId&&seenSignalIds.has(signal.signalId))return;
      if(signal.signalId){
        seenSignalIds.add(signal.signalId);
        if(seenSignalIds.size>100)seenSignalIds.delete(seenSignalIds.values().next().value);
      }
      handler(signal);
    };
    const onWindow=event=>accept(event.detail);
    const onStorage=event=>{
      if(event.key!==contracts.KEYS.lastSignal||!event.newValue)return;
      accept(contracts.safeParse(event.newValue,null));
    };
    const onChannel=event=>accept(event.data);

    global.addEventListener('hios:signal',onWindow);
    global.addEventListener('storage',onStorage);
    if(channel)channel.addEventListener('message',onChannel);

    return ()=>{
      global.removeEventListener('hios:signal',onWindow);
      global.removeEventListener('storage',onStorage);
      if(channel)channel.removeEventListener('message',onChannel);
    };
  }

  modules.signalBus=Object.freeze({publish,subscribe});
})(window);

/* H·IOS Communication Centre — validation, permissions and request routing. */
(function registerEventRouter(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.router)return;
  const {contracts,permissions,log,connectionState,signalBus}=modules;
  if(!contracts||!permissions||!log||!connectionState||!signalBus){
    throw new Error('Communication Centre dependencies must load before event-router.js');
  }

  function readRequests(){
    const parsed=contracts.safeParse(localStorage.getItem(contracts.KEYS.requests),[]);
    return Array.isArray(parsed)?parsed:[];
  }

  function queueRequest(signal){
    if(!String(signal?.type||'').endsWith('.requested'))return;
    const requests=readRequests();
    if(requests.some(request=>request.signalId===signal.signalId))return;
    requests.push({...signal,status:'pending'});
    localStorage.setItem(contracts.KEYS.requests,JSON.stringify(requests.slice(-100)));
  }

  function getPendingRequests(){
    return readRequests().filter(request=>request.status==='pending');
  }

  function acknowledgeRequest(signalId,outcome={}){
    if(!signalId)return false;
    const requests=readRequests();
    const index=requests.findIndex(request=>request.signalId===signalId);
    if(index<0)return false;
    requests[index]={
      ...requests[index],
      status:'handled',
      handledAt:new Date().toISOString(),
      outcome:outcome&&typeof outcome==='object'&&!Array.isArray(outcome)?outcome:{value:outcome}
    };
    localStorage.setItem(contracts.KEYS.requests,JSON.stringify(requests.slice(-100)));
    return true;
  }

  function route(signal){
    const validation=contracts.validateSignal(signal);
    const errors=[...validation.errors];
    if(validation.valid&&!permissions.canEmit(signal.source,signal.type)){
      errors.push(`${signal.source} is not allowed to emit ${signal.type}.`);
    }
    if(errors.length){
      log.append(signal,'rejected',errors);
      console.warn('H-IOS rejected a signal:',errors,signal);
      return {ok:false,errors};
    }

    log.append(signal);
    connectionState.touch(signal.source);
    queueRequest(signal);
    signalBus.publish(signal);
    return {ok:true,signal};
  }

  modules.router=Object.freeze({
    route,
    readRequests,
    getPendingRequests,
    acknowledgeRequest
  });
})(window);

/* H·IOS Communication Centre — stable product-facing connector API. */
(function registerProductConnector(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.productConnector)return;
  const {contracts,router,signalBus,connectionState,log}=modules;
  if(!contracts||!router||!signalBus||!connectionState||!log){
    throw new Error('Communication Centre dependencies must load before product-connector.js');
  }

  function readGoals(){
    const parsed=contracts.safeParse(localStorage.getItem(contracts.KEYS.goals),[]);
    return Array.isArray(parsed)?parsed:[];
  }

  function readSnapshot(){
    const parsed=contracts.safeParse(localStorage.getItem(contracts.KEYS.snapshot),null);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }

  function writeGoals(goals){
    if(!Array.isArray(goals))throw new TypeError('Goals must be an array.');
    localStorage.setItem(contracts.KEYS.goals,JSON.stringify(goals));
  }

  let lastSnapshotFingerprint='';
  function publishSnapshot(snapshot){
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)){
      throw new TypeError('Snapshot must be an object.');
    }
    const serialised=JSON.stringify(snapshot);
    localStorage.setItem(contracts.KEYS.snapshot,serialised);
    const fingerprint=JSON.stringify({...snapshot,updatedAt:undefined});
    if(fingerprint===lastSnapshotFingerprint)return null;
    lastSnapshotFingerprint=fingerprint;
    return router.route(contracts.createSignal('goals-ios','goals.snapshot.updated',{
      updatedAt:snapshot.updatedAt,
      activeGoals:snapshot.activeGoals,
      highPriority:snapshot.highPriority
    }));
  }

  function emit(source,type,payload={},meta={}){
    return router.route(contracts.createSignal(source,type,payload,meta));
  }

  function connect(source){
    if(!contracts.isAllowedSource(source))throw new Error(`Unsupported H-IOS source: ${source}`);
    connectionState.touch(source);
    return Object.freeze({
      emit:(type,payload,meta)=>emit(source,type,payload,meta),
      subscribe:signalBus.subscribe,
      readGoals,
      readSnapshot,
      getPendingRequests:router.getPendingRequests,
      acknowledgeRequest:source==='goals-ios'?router.acknowledgeRequest:undefined,
      writeGoals:source==='goals-ios'?writeGoals:undefined,
      publishSnapshot:source==='goals-ios'?publishSnapshot:undefined,
      getConnectionState:connectionState.read,
      getLog:log.read
    });
  }

  modules.productConnector=Object.freeze({connect,readGoals,readSnapshot,writeGoals,publishSnapshot});
})(window);

/* H·IOS Communication Centre — public gateway construction. */
(function registerCommunicationCentre(global){
  'use strict';

  const modules=global.HIOSCommunicationModules=global.HIOSCommunicationModules||{};
  if(modules.communicationCentre)return;
  const {contracts,productConnector}=modules;
  if(!contracts||!productConnector){
    throw new Error('Communication Centre dependencies must load before communication-centre.js');
  }

  function createPublicApi(){
    return Object.freeze({
      version:contracts.CONTRACT_VERSION,
      keys:contracts.KEYS,
      connect:productConnector.connect,
      validateSignal:contracts.validateSignal
    });
  }

  modules.communicationCentre=Object.freeze({createPublicApi});
})(window);

/* H·IOS Communication Centre gateway. Other layers connect through this file. */
(function initialiseCommunicationCentre(global){
  'use strict';
  if(global.HIOSConnectionLayer)return;
  const centre=global.HIOSCommunicationModules?.communicationCentre;
  if(!centre)throw new Error('H-IOS Communication Centre modules were not loaded in the required order.');
  global.HIOSConnectionLayer=centre.createPublicApi();
})(window);
