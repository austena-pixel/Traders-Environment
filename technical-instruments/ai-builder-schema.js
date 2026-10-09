(function(root){
  'use strict';
  const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
  const text=(max=1200)=>({type:'string',maxLength:max});
  const nullable=schema=>({anyOf:[schema,{type:'null'}]});
  const list=(items,max=40)=>({type:'array',items,maxItems:max});
  const enumeration=values=>({type:'string',enum:values});
  const id={type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'};
  const condition=obj({
    type:enumeration(['observation','comparison','risk_limit','time_window','price_cross','unspecified']),
    verification:enumeration(['objective','subjective','undefined']),
    field:nullable(text(120)),operator:nullable(enumeration(['lt','lte','eq','gte','gt','between','crosses_above','crosses_below'])),
    value:nullable({type:'number'}),unit:nullable(text(60)),timeframe:nullable(text(60)),
    parameters:list(obj({name:text(80),value:text(200)}),10)
  });
  const node=obj({
    id,type:enumeration(['heading','text','rule','choice','prompt','score','note']),label:text(),
    level:nullable({type:'integer',minimum:1,maximum:3}),
    options:list(obj({id,label:text(),condition:nullable(condition)}),20),
    logic:enumeration(['all','any','exclusive']),dependsOn:nullable(id),
    condition:nullable(condition),maximum:nullable({type:'number',enum:[10]})
  });
  const operation=obj({
    action:enumeration(['insert','update','remove','move','group']),
    targetId:nullable(id),afterId:nullable(id),beforeId:nullable(id),node:nullable(node),
    members:list(id,20),logic:nullable(enumeration(['all','any','exclusive'])),dependsOn:nullable(id)
  });
  const proposal=obj({
    intent:enumeration(['create','edit']),kind:enumeration(['playbook','checklist','psych']),
    name:nullable(text(200)),description:nullable(text(1200)),operations:list(operation,48)
  });
  const responseSchema=obj({message:text(4000),questions:list(text(500),3),proposal:nullable(proposal)});
  function validate(value,schema=responseSchema,path='response'){
    if(schema.anyOf){if(!schema.anyOf.some(s=>!validate(value,s,path).length))return [path+' has an unsupported value.'];return []}
    const errors=[],type=schema.type;
    if(type==='null')return value===null?[]:[path+' must be null.'];
    if(type==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value))return [path+' must be an object.'];
      for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties,key))errors.push(path+'.'+key+' is unsupported.');
      for(const key of schema.required){if(!Object.hasOwn(value,key))errors.push(path+'.'+key+' is required.');else errors.push(...validate(value[key],schema.properties[key],path+'.'+key))}
    }else if(type==='array'){
      if(!Array.isArray(value))return [path+' must be an array.'];
      if(value.length>schema.maxItems)errors.push(path+' contains too many items.');
      value.forEach((v,i)=>errors.push(...validate(v,schema.items,path+'['+i+']')));
    }else if(type==='string'){
      if(typeof value!=='string')return [path+' must be text.'];
      if(value.length>(schema.maxLength||10000))errors.push(path+' is too long.');
      if(schema.pattern&&!new RegExp(schema.pattern).test(value))errors.push(path+' has an invalid identifier.');
    }else if(type==='number'||type==='integer'){
      if(typeof value!=='number'||!Number.isFinite(value)||(type==='integer'&&!Number.isInteger(value)))return [path+' must be a finite number.'];
      if(schema.minimum!=null&&value<schema.minimum||schema.maximum!=null&&value>schema.maximum)errors.push(path+' is out of range.');
    }
    if(schema.enum&&!schema.enum.includes(value))errors.push(path+' is unsupported.');
    return errors;
  }
  function validateResponse(value){
    const errors=validate(value);
    if(errors.length)return errors;
    const p=value.proposal;if(!p)return errors;
    if(value.questions.length)errors.push('Answer the clarification questions before proposing changes.');
    if(p.intent==='create'&&!p.name?.trim())errors.push('A new instrument needs a name.');
    if(!p.operations.length&&!p.name&&!p.description)errors.push('The proposal contains no changes.');
    for(const op of p.operations){
      if(op.beforeId&&op.afterId)errors.push('Choose either a before or after position.');
      if(['update','remove','move'].includes(op.action)&&!op.targetId)errors.push('The change needs a target.');
      if(['insert','update'].includes(op.action)&&!op.node)errors.push('The change needs a structured node.');
      if(op.action==='group'&&(op.members.length<2||!op.logic||!op.node))errors.push('A logic group needs a node, logic and at least two conditions.');
      if(op.node){
        if(!op.node.label.trim())errors.push('Every new block needs a label.');
        if(op.node.type==='choice'&&op.node.options.length<2)errors.push('A choice needs at least two options.');
        if(op.node.type==='score'&&op.node.maximum!==10)errors.push('Scoring uses the existing 0–10 scale.');
        if(op.node.type!=='score'&&op.node.maximum!==null)errors.push('Only score fields can define a score maximum.');
        if(op.node.type!=='choice'&&op.node.options.length)errors.push('Only choices can define options.');
      }
    }
    return errors;
  }
  function evaluate(logic,values){return logic==='any'?values.some(Boolean):logic==='exclusive'?values.filter(Boolean).length===1:values.every(Boolean)}
  const api=Object.freeze({responseSchema,validateResponse,validate,evaluate,version:'tios.ai-builder.v1'});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TIOSAIContract=api;
})(typeof window!=='undefined'?window:globalThis);
