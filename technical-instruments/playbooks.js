(function(global){
  'use strict';

  const root=global.TIOS=global.TIOS||{};
  const instruments=root.technicalInstruments=root.technicalInstruments||{};

  const VERSION='tios.playbooks.v1';

  function textValue(value){
    return String(value==null?'':value).trim();
  }

  function stringList(value){
    return Array.isArray(value)
      ? [...new Set(value.map(textValue).filter(Boolean))]
      : [];
  }

  function makeId(prefix){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return prefix+'_'+global.crypto.randomUUID();
    }
    return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  }

  function create(input={}){
    const now=new Date().toISOString();
    return {
      schema:VERSION,
      id:textValue(input.id)||makeId('playbook'),
      name:textValue(input.name),
      description:textValue(input.description),
      marketContext:textValue(input.marketContext),
      setup:textValue(input.setup),
      entryPlan:textValue(input.entryPlan),
      riskPlan:textValue(input.riskPlan),
      managementPlan:textValue(input.managementPlan),
      exitPlan:textValue(input.exitPlan),
      checklistIds:stringList(input.checklistIds),
      reflectionStructureIds:stringList(input.reflectionStructureIds),
      tags:stringList(input.tags),
      instrumentState:textValue(input.instrumentState)||'active',
      createdAt:textValue(input.createdAt)||now,
      updatedAt:now
    };
  }

  function validate(playbook){
    const errors=[];
    if(!playbook||typeof playbook!=='object') errors.push('Playbook is required.');
    else{
      if(!textValue(playbook.name)) errors.push('Playbook name is required.');
      if(playbook.checklistIds&&!Array.isArray(playbook.checklistIds)) errors.push('checklistIds must be an array.');
      if(playbook.reflectionStructureIds&&!Array.isArray(playbook.reflectionStructureIds)) errors.push('reflectionStructureIds must be an array.');
    }
    return {valid:errors.length===0,errors};
  }

  instruments.playbooks={
    version:VERSION,
    purpose:'Define how the trader intends to trade and link reusable instruments. No execution measurement belongs here.',
    create,
    validate
  };
})(typeof window!=='undefined'?window:globalThis);
