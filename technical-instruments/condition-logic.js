(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={all:'All requirements · AND',any:'At least one requirement · OR',exclusive:'Exactly one option'};
  function clean(node){const clone=node.cloneNode(true);clone.querySelectorAll('.pb-doc-label,.pb-doc-remove-btn,[data-instrument-remove-reflection]').forEach(x=>x.remove());return (clone.textContent||'').replace(/\s+/g,' ').trim()}
  function item(node){
    if(node.dataset.playbookNode!=='condition-group'&&node.dataset.tiAiCondition!=='1')return null;
    const grouped=node.dataset.playbookNode==='condition-group';
    const members=grouped?[...node.querySelectorAll(':scope > [data-ti-condition-member],:scope > .ti-condition-members > [data-ti-condition-member]')]:[node];
    return {type:'condition-group',id:node.dataset.tiAiNodeId,dependsOn:node.dataset.tiDependsOn||null,logic:grouped?(node.dataset.tiLogic||'all'):'all',
      label:grouped?(node.dataset.tiGroupLabel||'Conditions'):'',
      members:members.map(x=>({id:grouped?x.dataset.tiAiNodeId:x.dataset.tiAiNodeId+'_value',label:clean(x),dependsOn:grouped?(x.dataset.tiDependsOn||null):null,condition:x.dataset.tiCondition||null,metadataChanged:Boolean(x.dataset.tiConditionLabel&&clean(x)!==x.dataset.tiConditionLabel.replace(/\s+/g,' ').trim())})),single:!grouped};
  }
  function render(value,area,kind='playbook'){
    const execution=area==='execution',prefix=kind==='playbook'?'map':kind;
    const mode=['all','any','exclusive'].includes(value.logic)?value.logic:'all';
    const group=value.id||'condition';
    return '<div class="ti-logic-model" data-ti-ai-group="'+escape(group)+'" data-ti-logic="'+mode+'" data-ti-condition-id="'+escape(group)+'"'+(value.dependsOn?' data-ti-depends-on="'+escape(value.dependsOn)+'"':'')+'>'+
      (!value.single?'<div class="ti-logic-heading"><b>'+escape(value.label)+'</b><small>'+label[mode]+'</small></div>':'')+
      value.members.map((m,i)=>'<label class="ti-logic-option" data-ti-condition-id="'+escape(m.id)+'"'+(m.dependsOn?' data-ti-depends-on="'+escape(m.dependsOn)+'"':'')+'><input type="'+(mode==='exclusive'?'radio':'checkbox')+'" name="'+escape(prefix+'_logic_'+group)+'" value="'+escape(m.id)+'" '+(execution?'data-execution-'+prefix+'-check="'+escape('logic_'+group+'_'+i)+'"':'disabled')+'><span>'+escape(m.label)+(m.metadataChanged?'<small class="ti-logic-dependency">Definition changed: review the stored technical parameters.</small>':'')+'</span></label>').join('')+
      (value.dependsOn?'<small class="ti-logic-dependency">Applies when the linked prerequisite is met.</small>':'')+
      (execution?'<small class="ti-logic-status" aria-live="polite"></small>':'')+'</div>';
  }
  function scores(section){
    if(!section)return {total:0,followed:0};
    const groups=[...section.querySelectorAll('[data-ti-ai-group]')],states=new Map(),resolving=new Set();
    const candidates=[...section.querySelectorAll('[data-ti-condition-id]')];
    if(candidates.some(el=>el.dataset.tiDependsOn&&!candidates.some(other=>other.dataset.tiConditionId===el.dataset.tiDependsOn&&other!==el&&!other.contains(el)&&(other.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))))return {total:0,followed:0,invalid:true};
    function state(id){
      if(states.has(id))return states.get(id);
      const el=candidates.find(x=>x.dataset.tiConditionId===id);
      if(!el||resolving.has(id))return false;
      resolving.add(id);
      const dep=el.dataset.tiDependsOn;
      const enclosing=el.hasAttribute('data-ti-ai-group')?null:el.closest('[data-ti-ai-group]');
      const applicable=(!dep||state(dep))&&(!enclosing?.dataset.tiDependsOn||state(enclosing.dataset.tiDependsOn));
      let met=false;
      if(el.hasAttribute('data-ti-ai-group')){
        const members=[...el.querySelectorAll(':scope > .ti-logic-option')];
        const active=members.filter(m=>!m.dataset.tiDependsOn||state(m.dataset.tiDependsOn));
        const values=active.map(m=>state(m.dataset.tiConditionId));
        met=applicable&&active.length>0&&root.TIOSAIContract.evaluate(el.dataset.tiLogic,values);
        el.dataset.tiApplicable=String(applicable);
        el.querySelector('.ti-logic-status').textContent=!applicable?'Not applicable: prerequisite is not met.':!active.length?'No applicable requirements.':met?'Requirement met.':'Requirement not yet met.';
      }else{
        const input=el.querySelector('input');met=applicable&&Boolean(input?.checked);
      }
      el.querySelectorAll('input').forEach(input=>{
        const member=input.closest('[data-ti-condition-id]');
        input.disabled=!applicable||Boolean(member?.dataset.tiDependsOn&&!state(member.dataset.tiDependsOn));
      });
      el.classList.toggle('ti-logic-inactive',!applicable);
      states.set(id,met);resolving.delete(id);return met;
    }
    let total=0,followed=0;
    for(const group of groups){const met=state(group.dataset.tiConditionId);if(group.dataset.tiApplicable!=='false'){total++;if(met)followed++}}
    return {total,followed};
  }
  root.TIOSConditionLogic=Object.freeze({item,render,scores});
})(window);
