(function(global){
  'use strict';

  const root=global.TIOS=global.TIOS||{};
  const instruments=root.technicalInstruments=root.technicalInstruments||{};

  const VERSION='tios.reflection-structures.v1';
  const FIELD_TYPES=new Set(['text','textarea','single-select','multi-select']);

  function textValue(value){
    return String(value==null?'':value).trim();
  }

  function makeId(prefix){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return prefix+'_'+global.crypto.randomUUID();
    }
    return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  }

  function normalizeField(field={},index=0){
    const requested=textValue(field.type);
    const type=FIELD_TYPES.has(requested)?requested:'textarea';
    return {
      id:textValue(field.id)||makeId('reflection'),
      label:textValue(field.label),
      description:textValue(field.description),
      type,
      options:Array.isArray(field.options)?[...new Set(field.options.map(textValue).filter(Boolean))]:[],
      required:Boolean(field.required),
      order:Number.isFinite(Number(field.order))?Number(field.order):index
    };
  }

  function create(input={}){
    const now=new Date().toISOString();
    return {
      schema:VERSION,
      id:textValue(input.id)||makeId('reflection_structure'),
      name:textValue(input.name),
      description:textValue(input.description),
      fields:Array.isArray(input.fields)?input.fields.map(normalizeField):[],
      tags:Array.isArray(input.tags)?[...new Set(input.tags.map(textValue).filter(Boolean))]:[],
      instrumentState:textValue(input.instrumentState)||'active',
      createdAt:textValue(input.createdAt)||now,
      updatedAt:now
    };
  }

  function validate(structure){
    const errors=[];
    if(!structure||typeof structure!=='object') errors.push('Reflection structure is required.');
    else{
      if(!textValue(structure.name)) errors.push('Reflection structure name is required.');
      if(!Array.isArray(structure.fields)) errors.push('Reflection fields must be an array.');
      else if(structure.fields.some(field=>!textValue(field&&field.label))) errors.push('Every reflection field needs a label.');
    }
    return {valid:errors.length===0,errors};
  }

  instruments.reflections={
    version:VERSION,
    fieldTypes:[...FIELD_TYPES],
    purpose:'Define how the trader wants to describe behaviour, decisions and state of mind. Responses and analysis belong elsewhere.',
    create,
    validate
  };
})(typeof window!=='undefined'?window:globalThis);
