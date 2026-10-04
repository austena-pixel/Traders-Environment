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
    requests:'hios_communication_requests_v1',
    products:'hios_added_products_v1',
    evidenceRequests:'hios_goal_evidence_requests_v1',
    reorientations:'hios_goal_reorientation_requests_v1'
  });
  const CHANNEL='hios-communication-centre-v1';
  const CONTRACT_VERSION=1;
  const MAX_LOG_ENTRIES=250;
  const SOURCES=Object.freeze(['goals-ios','h-ios','t-ios']);
  const TYPES=Object.freeze([
    'goal.created','goal.updated','goal.completed','goal.deleted',
    'goal.progress.changed','goal.deadline.changed',
    'task.created','task.updated','task.completed','task.deleted',
    'goals.snapshot.updated','goals.state.synchronised',
    'calendar.item.created','calendar.item.updated','calendar.item.deleted',
    'task.calendar.remove.requested','goal.calendar.remove.requested',
    'task.delete.requested','goal.delete.requested',
    'evidence.observed','evidence.requested','evidence.responded',
    'goal.reorientation.requested'
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
      'goals.snapshot.updated','goals.state.synchronised',
      'evidence.requested'
    ]),
    'h-ios':Object.freeze([
      'calendar.item.created','calendar.item.updated','calendar.item.deleted',
      'task.calendar.remove.requested','goal.calendar.remove.requested',
      'task.delete.requested','goal.delete.requested',
      'goal.reorientation.requested'
    ]),
    't-ios':Object.freeze([
      'evidence.observed','evidence.responded'
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

  const sourceProductIds=Object.freeze({'t-ios':'tios'});

  function read(){
    const state=contracts.safeParse(localStorage.getItem(contracts.KEYS.connectionState),{});
    return state&&typeof state==='object'&&!Array.isArray(state)?state:{};
  }

  function isProductEnabled(productId){
    if(productId==='gios')return true;
    const products=contracts.safeParse(localStorage.getItem(contracts.KEYS.products),[]);
    return Array.isArray(products)&&products.includes(productId);
  }

  function isEnabled(source){
    const productId=sourceProductIds[source];
    return productId?isProductEnabled(productId):true;
  }

  function touch(source,status='connected'){
    const state=read();
    state[source]={status,lastSeenAt:new Date().toISOString()};
    localStorage.setItem(contracts.KEYS.connectionState,JSON.stringify(state));
    return state[source];
  }

  modules.connectionState=Object.freeze({read,touch,isEnabled,isProductEnabled});
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
    const type=String(signal?.type||'');
    if(!type.endsWith('.requested')&&type!=='evidence.responded')return;
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

  function stage1ReorientationFromEvidenceResponse(signal){
    const response=signal?.payload?.response;
    if(signal?.type!=='evidence.responded'||response?.source!=='t-ios'||response?.target!=='goals-ios')return null;
    const evidence=Array.isArray(response.evidence)?response.evidence:[];
    const executionErrors=evidence.find(item=>item?.metric==='execution_errors'&&Number.isFinite(Number(item?.value)));
    if(!executionErrors||Number(executionErrors.value)<=0)return null;

    const reorientationId=`reorient_${response.requestId}_execution_errors`;
    const store=contracts.safeParse(localStorage.getItem(contracts.KEYS.reorientations),{});
    if(store&&typeof store==='object'&&!Array.isArray(store)&&store[reorientationId])return null;

    return {
      schema:'hios.goal-reorientation-request.v1',
      reorientationId,
      source:'h-ios',
      target:'goals-ios',
      area:response.area||'Trading',
      phaseId:response.phaseId||null,
      phaseName:response.phaseName||null,
      createdAt:new Date().toISOString(),
      requiresUserApproval:true,
      evidenceBasis:[{
        sourceProductId:'tios',
        requestId:response.requestId,
        responseSignalId:signal.signalId,
        metric:'execution_errors',
        value:Number(executionErrors.value),
        unit:executionErrors.unit||'errors',
        sampleSize:executionErrors.sampleSize??null,
        observedAt:response.respondedAt
      }],
      proposedAdjustment:{
        kind:'working-emphasis',
        code:'reduce_execution_errors',
        title:'Reduce execution errors before increasing pace',
        description:`Keep the current goal structure, but place extra working emphasis on reducing execution errors during ${response.phaseName||'this stage'}.`,
        preserveGoalStructure:true,
        target:{area:response.area||'Trading',phaseId:response.phaseId||null}
      }
    };
  }

  function route(signal){
    const validation=contracts.validateSignal(signal);
    const errors=[...validation.errors];
    if(validation.valid&&!permissions.canEmit(signal.source,signal.type)){
      errors.push(`${signal.source} is not allowed to emit ${signal.type}.`);
    }
    if(validation.valid&&!connectionState.isEnabled(signal.source)){
      errors.push(`${signal.source} is disconnected from H-IOS.`);
      connectionState.touch(signal.source,'disconnected');
    }
    if(validation.valid&&signal.type==='evidence.observed'){
      const evidenceContract=global.HIOSEvidenceContract;
      const evidence=signal.payload?.evidence;
      if(!evidenceContract||typeof evidenceContract.validateEvidence!=='function'){
        errors.push('Shared evidence contract is unavailable.');
      }else{
        const evidenceValidation=evidenceContract.validateEvidence(evidence);
        if(!evidenceValidation.valid)errors.push(...evidenceValidation.errors);
      }
      if(signal.source==='t-ios'&&evidence?.sourceProductId!=='tios'){
        errors.push('T-IOS evidence source does not match sourceProductId.');
      }
    }
    if(validation.valid&&signal.type==='evidence.requested'){
      const request=signal.payload?.request;
      const requestIsObject=request&&typeof request==='object'&&!Array.isArray(request);
      if(!requestIsObject){
        errors.push('Evidence request must be an object.');
      }else{
        const metrics=Array.isArray(request.metrics)?request.metrics:[];
        if(request.schema!=='hios.goal-evidence-request.v1')errors.push('Unsupported evidence request schema.');
        if(request.source!=='goals-ios'||request.source!==signal.source)errors.push('Evidence request source must be Goals-IOS.');
        if(typeof request.requestId!=='string'||!request.requestId.trim())errors.push('Evidence requestId is required.');
        if(typeof request.targetProductId!=='string'||!request.targetProductId.trim())errors.push('Evidence request targetProductId is required.');
        if(!metrics.length||metrics.some(metric=>typeof metric!=='string'||!metric.trim()))errors.push('Evidence request must contain selected metric names.');
        if(new Set(metrics).size!==metrics.length)errors.push('Evidence request metrics must be unique.');
        if(!request.requestedAt||Number.isNaN(Date.parse(request.requestedAt)))errors.push('Evidence request requestedAt must be a valid timestamp.');
        if(signal.meta?.targetProductId&&signal.meta.targetProductId!==request.targetProductId)errors.push('Evidence request target does not match routing metadata.');
        if(request.targetProductId&&!connectionState.isProductEnabled(request.targetProductId)){
          errors.push(`Target product ${request.targetProductId} is disconnected from H-IOS.`);
        }
      }
    }
    if(validation.valid&&signal.type==='evidence.responded'){
      const response=signal.payload?.response;
      const responseIsObject=response&&typeof response==='object'&&!Array.isArray(response);
      if(!responseIsObject){
        errors.push('Evidence response must be an object.');
      }else{
        const requested=Array.isArray(response.requestedMetrics)?response.requestedMetrics:[];
        const delivered=Array.isArray(response.deliveredMetrics)?response.deliveredMetrics:[];
        const unavailable=Array.isArray(response.unavailableMetrics)?response.unavailableMetrics:[];
        const evidence=Array.isArray(response.evidence)?response.evidence:[];
        const unavailableMetrics=unavailable.map(item=>item?.metric);
        const requestedSet=new Set(requested);
        const deliveredSet=new Set(delivered);
        const unavailableSet=new Set(unavailableMetrics);
        if(response.schema!=='hios.goal-evidence-response.v1')errors.push('Unsupported evidence response schema.');
        if(response.source!=='t-ios'||response.source!==signal.source)errors.push('Evidence response source must be T-IOS.');
        if(response.target!=='goals-ios'||response.productId!=='tios')errors.push('Evidence response target/product is invalid.');
        if(typeof response.requestId!=='string'||!response.requestId.trim())errors.push('Evidence response requestId is required.');
        if(!requested.length||requested.some(metric=>typeof metric!=='string'||!metric.trim())||requestedSet.size!==requested.length){
          errors.push('Evidence response requestedMetrics must be unique non-empty names.');
        }
        if(delivered.some(metric=>!requestedSet.has(metric))||deliveredSet.size!==delivered.length){
          errors.push('Delivered evidence must stay inside the requested metric scope.');
        }
        if(unavailableMetrics.some(metric=>typeof metric!=='string'||!requestedSet.has(metric))||unavailableSet.size!==unavailableMetrics.length){
          errors.push('Unavailable evidence must stay inside the requested metric scope.');
        }
        if(delivered.some(metric=>unavailableSet.has(metric)))errors.push('A metric cannot be both delivered and unavailable.');
        if(evidence.length!==delivered.length||evidence.some(item=>!item||typeof item!=='object'||!deliveredSet.has(item.metric))){
          errors.push('Evidence payload must match deliveredMetrics exactly.');
        }
        if(new Set(evidence.map(item=>item?.metric)).size!==evidence.length)errors.push('Evidence payload metrics must be unique.');
        if(!['fulfilled','partial','unavailable'].includes(response.status))errors.push('Evidence response status is invalid.');
        if(response.status==='fulfilled'&&(delivered.length!==requested.length||unavailable.length))errors.push('Fulfilled response must deliver every requested metric.');
        if(response.status==='partial'&&(!delivered.length||!unavailable.length))errors.push('Partial response must contain delivered and unavailable metrics.');
        if(response.status==='unavailable'&&(delivered.length||unavailable.length!==requested.length))errors.push('Unavailable response must mark every requested metric unavailable.');
        if(!response.respondedAt||Number.isNaN(Date.parse(response.respondedAt)))errors.push('Evidence response respondedAt must be a valid timestamp.');
        if(signal.meta?.requestId&&signal.meta.requestId!==response.requestId)errors.push('Evidence response request does not match routing metadata.');

        const requests=contracts.safeParse(localStorage.getItem(contracts.KEYS.evidenceRequests),{});
        const active=requests&&typeof requests==='object'&&!Array.isArray(requests)?requests.tios:null;
        if(!active||active.requestId!==response.requestId){
          errors.push('Evidence response does not match the active H-IOS request.');
        }else{
          const activeMetrics=Array.isArray(active.metrics)?active.metrics:[];
          if(activeMetrics.length!==requested.length||activeMetrics.some((metric,index)=>metric!==requested[index])){
            errors.push('Evidence response requestedMetrics do not match the active request.');
          }
        }
      }
    }
    if(validation.valid&&signal.type==='goal.reorientation.requested'){
      const request=signal.payload?.request;
      const evidenceBasis=Array.isArray(request?.evidenceBasis)?request.evidenceBasis:[];
      const adjustment=request?.proposedAdjustment;
      if(!request||typeof request!=='object'||Array.isArray(request)){
        errors.push('Goal reorientation request must be an object.');
      }else{
        if(request.schema!=='hios.goal-reorientation-request.v1')errors.push('Unsupported goal reorientation schema.');
        if(request.source!=='h-ios'||request.source!==signal.source)errors.push('Goal reorientation source must be H-IOS.');
        if(request.target!=='goals-ios')errors.push('Goal reorientation target must be Goals-IOS.');
        if(typeof request.reorientationId!=='string'||!request.reorientationId.trim())errors.push('Goal reorientationId is required.');
        if(typeof request.area!=='string'||!request.area.trim())errors.push('Goal reorientation area is required.');
        if(request.requiresUserApproval!==true)errors.push('Goal reorientation must require user approval.');
        if(!request.createdAt||Number.isNaN(Date.parse(request.createdAt)))errors.push('Goal reorientation createdAt must be a valid timestamp.');
        if(!evidenceBasis.length||evidenceBasis.some(item=>!item||typeof item!=='object'||!item.sourceProductId||!item.requestId||!item.metric)){
          errors.push('Goal reorientation requires an explicit evidence basis.');
        }
        if(!adjustment||typeof adjustment!=='object'||Array.isArray(adjustment)){
          errors.push('Goal reorientation proposedAdjustment is required.');
        }else{
          if(adjustment.kind!=='working-emphasis')errors.push('Stage 1E supports working-emphasis adjustments only.');
          if(typeof adjustment.title!=='string'||!adjustment.title.trim())errors.push('Goal reorientation adjustment title is required.');
          if(typeof adjustment.description!=='string'||!adjustment.description.trim())errors.push('Goal reorientation adjustment description is required.');
          if(adjustment.preserveGoalStructure!==true)errors.push('Stage 1E reorientation must preserve the goal structure.');
          if(adjustment.target?.area!==request.area)errors.push('Goal reorientation adjustment target must match the request area.');
        }
      }
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

    if(signal.type==='evidence.responded'){
      const request=stage1ReorientationFromEvidenceResponse(signal);
      if(request){
        const generated=contracts.createSignal(
          'h-ios',
          'goal.reorientation.requested',
          {request},
          {responseSignalId:signal.signalId,requestId:request.evidenceBasis[0]?.requestId||null}
        );
        const generatedResult=route(generated);
        if(generatedResult.ok){
          const store=contracts.safeParse(localStorage.getItem(contracts.KEYS.reorientations),{});
          const next=store&&typeof store==='object'&&!Array.isArray(store)?store:{};
          if(!next[request.reorientationId]){
            next[request.reorientationId]={
              ...request,
              hiosSignalId:generated.signalId,
              status:'pending'
            };
            localStorage.setItem(contracts.KEYS.reorientations,JSON.stringify(next));
          }
        }
      }
    }
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
    connectionState.touch(source,connectionState.isEnabled(source)?'connected':'disconnected');
    return Object.freeze({
      emit:(type,payload,meta)=>emit(source,type,payload,meta),
      isConnected:()=>connectionState.isEnabled(source),
      subscribe:signalBus.subscribe,
      readGoals,
      readSnapshot,
      getPendingRequests:router.getPendingRequests,
      acknowledgeRequest:(source==='goals-ios'||source==='h-ios')?router.acknowledgeRequest:undefined,
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
