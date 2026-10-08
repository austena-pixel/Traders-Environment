/* UI contracts only. Maturity and readiness must come from validated assessments,
   never record counts, existing product scores or subscription entitlements. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HIOSIntelligenceDevelopment=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const LEVELS=Object.freeze([
    {name:'Unknown Individual',description:'No established personal understanding.'},
    {name:'Initial Understanding',description:'Initial evidence and descriptive personal assessments.'},
    {name:'Pattern Discovery',description:'Preliminary recognition of recurring behaviours and tendencies.'},
    {name:'Contextual Understanding',description:'Understanding patterns across relevant circumstances and conditions.'},
    {name:'Predictive Intelligence',description:'Validated personalized predictions supported by suitable evidence.'},
    {name:'Adaptive Intelligence',description:'Personalized assistance and environmental adaptation evaluated against outcomes.'}
  ]);
  const DOMAINS=Object.freeze([
    {id:'trading-edge',productId:'tios',product:'T-IOS',name:'Trading Edge Intelligence',accent:'131 181 244',purpose:'Develop an evidence-based understanding of profitable trading edge.',sources:'Trading outcomes, strategy records and relevant market context.',foundation:'Trading journal & performance records',future:['Personalized edge analysis','Validated risk estimates']},
    {id:'execution',productId:'tios',product:'T-IOS',name:'Execution Quality Intelligence',accent:'131 181 244',purpose:'Understand execution quality and how consistently trading decisions follow the intended process.',sources:'Execution reviews, rule checks and contextual trading records.',foundation:'Execution reviews',future:['Recurring execution patterns','Context-aware execution assistance']},
    {id:'goals',productId:'gios',product:'G-IOS',name:'Goals Intelligence',accent:'166 152 233',purpose:'Develop understanding of goal planning, progress, consistency, productivity and personal development.',sources:'Goals, daily tasks, progress and outcomes in Goals-IOS.',foundation:'Goal planning & daily progress',future:['Personalized planning guidance','Adaptive workload suggestions']},
    {id:'cross',productId:'hios',product:'H-IOS',name:'Cross-Intelligence',accent:'117 239 192',purpose:'Connect authorized product insights when the combined evidence supports useful personal understanding.',sources:'Authorized, validated insights from connected products and their outcomes.',foundation:'Shared calendar & daily priorities',future:['Cross-product pattern analysis','Authorized environmental adaptation']}
  ]);
  const EVENT_TYPES=Object.freeze(['maturity-established','capability-available','conclusion-revised','evidence-required','capability-suspended']);
  function emptyState(userId=null){
    return {userId,maturity:{},evidenceQuality:{},readiness:{},entitlements:{},notifications:[],adaptation:{}};
  }
  function validTime(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
  function currentAssessment(value,now=Date.now()){
    return !!(value&&validTime(value.assessedAt)&&validTime(value.validUntil)&&
      Date.parse(value.assessedAt)<=now&&Date.parse(value.validUntil)>now&&
      typeof value.assessmentId==='string'&&value.assessmentId.trim());
  }
  function assessedLevel(value,now=Date.now()){
    return currentAssessment(value,now)&&Number.isInteger(value.level)&&value.level>=0&&value.level<=5?value.level:null;
  }
  function capabilityPresentation(readiness,entitlement,now=Date.now()){
    if(!currentAssessment(readiness,now))return {label:'Awaiting assessment',tone:'pending',available:false};
    if(readiness.status==='suspended')return {label:'Suspended',tone:'suspended',available:false};
    if(readiness.status==='collecting')return {label:'Collecting Evidence',tone:'pending',available:false};
    if(readiness.status==='preliminary')return {label:'Preliminary',tone:'preliminary',available:false};
    if(readiness.status!=='available'||readiness.permissionGranted!==true||readiness.safetyValidated!==true)
      return {label:'Unavailable',tone:'pending',available:false};
    // Commercial access is a separate gate; it cannot raise intelligence maturity.
    if(readiness.requiredPlan==='pro'&&!(currentAssessment(entitlement,now)&&entitlement.granted===true))
      return {label:'Ready — Pro Required',tone:'preliminary',available:false};
    return {label:'Available',tone:'available',available:true};
  }
  function ownedExecutionEvidence(records,userId,validate){
    if(!userId||typeof validate!=='function')return [];
    const rows=Array.isArray(records?.tios)?records.tios:[];
    const seen=new Set();
    return rows.filter(row=>{
      if(!row||row.userId!==userId||row.sourceProductId!=='tios'||
        row.evidenceType!=='rule_compliance_assessment'||seen.has(row.id)||!validate(row))return false;
      seen.add(row.id);return true;
    });
  }
  function unreadEvents(events,userId,readIds=[],now=Date.now()){
    const seen=new Set(),read=new Set(readIds);
    return (Array.isArray(events)?events:[]).filter(event=>{
      if(!userId||event?.userId!==userId||typeof event.id!=='string'||!event.id.trim()||seen.has(event.id)||
        !EVENT_TYPES.includes(event.type)||!validTime(event.occurredAt)||Date.parse(event.occurredAt)>now)return false;
      seen.add(event.id);return !read.has(event.id)&&event.readAt==null;
    });
  }
  return Object.freeze({LEVELS,DOMAINS,EVENT_TYPES,emptyState,currentAssessment,assessedLevel,capabilityPresentation,ownedExecutionEvidence,unreadEvents});
});
