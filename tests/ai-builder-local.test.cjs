'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const local=require('../technical-instruments/ai-builder-local.js'),contract=require('../technical-instruments/ai-builder-schema.js');
const blocks=[
  {id:'context',label:'MARKET CONTEXT 4H',type:'heading',level:2,parentId:null,sectionSafe:true},
  {id:'rule_a',label:'Wait for my area of interest.',type:'rule',parentId:null},
  {id:'rule_b',label:'Maximum risk per trade is 1%.',type:'rule',parentId:null},
  {id:'entry',label:'Entry Conditions',type:'heading',level:2,parentId:null,sectionSafe:true},
  {id:'paragraph',label:'My personal notes.',type:'text',parentId:null},
  {id:'list',label:'My checks',type:'preserved',parentId:null,layoutSupported:true}
];
const route=(s,extra={})=>local.route(s,{kind:'playbook',blocks,...extra});
function proposal(s,extra){const result=route(s,extra);assert.equal(result.engine,'local');assert.deepEqual(contract.validateResponse(result.answer),[]);return result.answer.proposal}
test('precise full-instruction formatting resolves an exact heading without a provider',()=>{
  for(const s of ['Change only the MARKET CONTEXT 4H heading to red.','Change the heading “MARKET CONTEXT 4H” to #aa00ff','Make heading MARKET CONTEXT 4H red']){
    const p=proposal(s);assert.equal(p.operations[0].targetId,'context');assert.equal(p.operations[0].action,'style');assert.equal(p.operations[0].node,null);
  }
});
test('alignment, font size, emphasis and supported styles share the strict contract',()=>{
  for(const s of ['Align paragraph “My personal notes.” to the center','Set font size of heading “MARKET CONTEXT 4H” to 24 px','Make Rule 2 bold','Make Rule 2 not italic','Set spacing of heading “MARKET CONTEXT 4H” to compact','Set border of heading “MARKET CONTEXT 4H” to thin','Set preset of heading “MARKET CONTEXT 4H” to card','Set layout of block list to columns-2'])proposal(s);
  for(const s of ['Set font size of heading “MARKET CONTEXT 4H” to 999 px','Set layout of heading “MARKET CONTEXT 4H” to columns-2','Set border of heading “MARKET CONTEXT 4H” to executable'])assert.equal(route(s).engine,'clarify');
});
test('unique rule references prefer literal labels before document order',()=>{
  assert.equal(proposal('Rename Rule 2 to Risk Management').operations[0].targetId,'rule_b');
  const result=proposal('Rename Rule 2 to Risk Management',{blocks:[...blocks,{id:'named',label:'Rule 2',type:'rule',parentId:null}]});assert.equal(result.operations[0].targetId,'named');
});
test('unknown, duplicate and vague targets only ask; no proposal is manufactured',()=>{
  for(const s of ['Change heading to red','Change my context heading to red','Remove the old section','Delete everything','Rename Rule 22 to Risk','Move Rule 2 before the first heading']){const r=route(s);assert.equal(r.engine,'clarify');assert.equal(r.answer.proposal,null)}
  assert.equal(route('Change only the MARKET CONTEXT 4H heading to red',{blocks:[...blocks,{...blocks[0],id:'duplicate'}]}).engine,'clarify');
});
test('sections are removed only with proven boundaries and explicit scope',()=>{
  assert.equal(proposal('Remove MARKET CONTEXT 4H section').operations[0].action,'remove_section');
  assert.equal(proposal('Delete heading MARKET CONTEXT 4H').operations[0].action,'remove');
  assert.equal(route('Remove MARKET CONTEXT 4H section',{blocks:[{...blocks[0],sectionSafe:false}]}).engine,'clarify');
});
test('explicit content and positions become bounded inserts without inferring trading metadata',()=>{
  assert.equal(proposal('Add a heading called Entry Conditions').operations[0].node.label,'Entry Conditions');
  const rule=proposal('Create a rule: Maximum risk per trade is 1%').operations[0];assert.equal(rule.node.label,'Maximum risk per trade is 1%');assert.equal(rule.node.condition,null);assert.equal(rule.afterId,null);
  assert.equal(proposal('Insert a heading called “Risk” before heading “Entry Conditions”').operations[0].beforeId,'entry');
  assert.equal(proposal('Add a paragraph: “<img src=x onerror=alert(1)>”').operations[0].node.label,'<img src=x onerror=alert(1)>');
});
test('block movement never silently changes a nested execution group',()=>{
  const op=proposal('Move Rule 2 before heading “Entry Conditions”').operations[0];assert.equal(op.targetId,'rule_b');assert.equal(op.beforeId,'entry');
  assert.equal(route('Move Rule 2 before heading “Entry Conditions”',{blocks:blocks.map(b=>b.id==='rule_b'?{...b,parentId:'group'}:b)}).engine,'clarify');
  assert.equal(route('Move MARKET CONTEXT 4H section to the end').engine,'clarify');
});
test('names and conditions are collected in separate free local clarifications',()=>{
  const first=route('Create five rules');assert.equal(first.engine,'clarify');assert.match(first.answer.questions[0],/What should I name the five rules/);
  const names=route('Risk, Entry, Exit, Context, Discipline',{pending:first.pending});assert.equal(names.engine,'clarify');assert.match(names.answer.questions[0],/each rule check/);
  const missing=route('Risk: Follow my limit',{pending:names.pending});assert.equal(missing.engine,'clarify');assert.equal(missing.answer.proposal,null);
  const final=proposal('Risk: Maximum risk 1%\nEntry: Wait for my signal\nExit: Exit at my target\nContext: Use my context\nDiscipline: Follow my plan',{pending:names.pending});
  assert.equal(final.operations.length,5);assert.equal(new Set(final.operations.map(o=>o.node.id)).size,5);assert.ok(final.operations.every(o=>o.node.condition===null));
  assert.equal(route('Analyze my methodology',{pending:first.pending}).engine,'ai');
});
test('intelligence, image interpretation and reasoning-first mixed requests use AI in full',()=>{
  for(const s of ['Build a profitable trading methodology','Analyze this chart and identify possible entry conditions','Explain weaknesses in my current Rules','Help me develop conditions for a trading edge','Analyze my rules and change the heading color in one proposal'])assert.equal(route(s).engine,'ai');
  assert.equal(route('Analyze my attached chart',{hasImages:true}).engine,'ai');
  assert.equal(route('Change heading MARKET CONTEXT 4H to red',{hasImages:true}).engine,'local');
  assert.equal(route('',{hasImages:true}).engine,'ai');
});
test('edit-first mixed, trailing and unsupported operations cannot be partially executed or silently escalated',()=>{
  for(const s of ['Change heading MARKET CONTEXT 4H to red and analyze my edge','Rename Rule 2 to Risk and delete Rule 1','Remove MARKET CONTEXT 4H section; create a strategy','Change heading MARKET CONTEXT 4H to red, but improve my rules too','Align heading MARKET CONTEXT 4H center and set spacing to compact'])assert.equal(route(s).engine,'clarify');
  assert.equal(route('Undo the last approved change').engine,'undo');
});
test('style schema rejects executable formatting, type coercion and condition changes',()=>{
  const p=proposal('Make Rule 2 bold'),answer={message:'Preview',questions:[],proposal:p};
  p.operations[0].formatting.bold='true';assert.ok(contract.validateResponse(answer).length);
  p.operations[0].formatting=local.format({fontSize:73});assert.ok(contract.validateResponse(answer).length);
  p.operations[0].formatting=local.format({bold:true});p.operations[0].dependsOn='other';assert.ok(contract.validateResponse(answer).length);
  p.operations[0].dependsOn=null;p.operations[0].formatting.url='javascript:alert(1)';assert.ok(contract.validateResponse(answer).length);
});
