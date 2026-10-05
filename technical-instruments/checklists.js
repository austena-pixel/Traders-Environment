(function(global){
  'use strict';

  const root=global.TIOS=global.TIOS||{};
  const instruments=root.technicalInstruments=root.technicalInstruments||{};

  const VERSION='tios.checklists.v1';

  function textValue(value){
    return String(value==null?'':value).trim();
  }

  function makeId(prefix){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return prefix+'_'+global.crypto.randomUUID();
    }
    return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  }

  function normalizeItem(item={},index=0){
    return {
      id:textValue(item.id)||makeId('check'),
      label:textValue(item.label),
      description:textValue(item.description),
      section:textValue(item.section),
      order:Number.isFinite(Number(item.order))?Number(item.order):index
    };
  }

  function create(input={}){
    const now=new Date().toISOString();
    return {
      schema:VERSION,
      id:textValue(input.id)||makeId('checklist'),
      name:textValue(input.name),
      description:textValue(input.description),
      category:textValue(input.category)||'custom',
      items:Array.isArray(input.items)?input.items.map(normalizeItem):[],
      tags:Array.isArray(input.tags)?[...new Set(input.tags.map(textValue).filter(Boolean))]:[],
      instrumentState:textValue(input.instrumentState)||'active',
      createdAt:textValue(input.createdAt)||now,
      updatedAt:now
    };
  }

  function validate(checklist){
    const errors=[];
    if(!checklist||typeof checklist!=='object') errors.push('Checklist is required.');
    else{
      if(!textValue(checklist.name)) errors.push('Checklist name is required.');
      if(!Array.isArray(checklist.items)) errors.push('Checklist items must be an array.');
      else if(checklist.items.some(item=>!textValue(item&&item.label))) errors.push('Every checklist item needs a label.');
    }
    return {valid:errors.length===0,errors};
  }

  instruments.checklists={
    version:VERSION,
    purpose:'Define reusable rules and conditions. Checked states, adherence and scores belong to Execution Quality, not this file.',
    create,
    validate
  };
})(typeof window!=='undefined'?window:globalThis);
