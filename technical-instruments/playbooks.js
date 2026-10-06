(function(global){
  'use strict';

  const root=global.TIOS=global.TIOS||{};
  const instruments=root.technicalInstruments=root.technicalInstruments||{};
  const VERSION='tios.playbooks.v2';

  function textValue(value){return String(value==null?'':value).trim();}
  function rawText(value){return String(value==null?'':value);}
  function stringList(value){return Array.isArray(value)?[...new Set(value.map(textValue).filter(Boolean))]:[];}
  function makeId(prefix){
    if(global.crypto&&typeof global.crypto.randomUUID==='function')return prefix+'_'+global.crypto.randomUUID();
    return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  }

  function create(input={}){
    const now=new Date().toISOString();
    return {
      schema:VERSION,
      id:textValue(input.id)||makeId('playbook'),
      name:textValue(input.name)||'Untitled Playbook',
      description:textValue(input.description),
      documentHtml:rawText(input.documentHtml),
      editorMode:'document',
      checklistIds:stringList(input.checklistIds),
      reflectionStructureIds:stringList(input.reflectionStructureIds),
      tags:stringList(input.tags),
      instrumentState:textValue(input.instrumentState)||'draft',
      createdAt:textValue(input.createdAt)||now,
      updatedAt:textValue(input.updatedAt)||now
    };
  }

  function validate(playbook){
    const errors=[];
    if(!playbook||typeof playbook!=='object')errors.push('Playbook is required.');
    else{
      if(!textValue(playbook.name))errors.push('Playbook name is required.');
      if(playbook.checklistIds&&!Array.isArray(playbook.checklistIds))errors.push('checklistIds must be an array.');
      if(playbook.reflectionStructureIds&&!Array.isArray(playbook.reflectionStructureIds))errors.push('reflectionStructureIds must be an array.');
      if(playbook.documentHtml!=null&&typeof playbook.documentHtml!=='string')errors.push('documentHtml must be text.');
    }
    return {valid:errors.length===0,errors};
  }

  instruments.playbooks={
    version:VERSION,
    purpose:'Define and organize how the trader intends to trade in a flexible document workspace. No execution measurement belongs here.',
    create,
    validate
  };
})(typeof window!=='undefined'?window:globalThis);
