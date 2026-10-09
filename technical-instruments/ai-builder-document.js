(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const makeId=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
  const clean=node=>{const n=node.cloneNode(true);n.querySelectorAll('.pb-doc-label,.pb-doc-remove-btn,[data-instrument-remove-reflection]').forEach(x=>x.remove());return (n.textContent||'').replace(/\s+/g,' ').trim()};
  const meaningful='h1,h2,h3,p,blockquote,ul,ol,li,[data-playbook-node]';
  function documentHost(html){const host=document.createElement('div');host.innerHTML=html||'';let index=0;
    [...host.querySelectorAll(meaningful)].filter(el=>!el.closest('.pb-doc-choice-options')&&!el.closest('.pb-doc-label')&&!el.closest('[data-playbook-node="image"]')&&!el.closest('[data-playbook-node="image-field"]')).forEach(el=>{
      if(el.closest('.pb-doc-remove-btn'))return;
      if(!el.dataset.tiAiNodeId)el.dataset.tiAiNodeId='b_'+index;index++;
    });return host;
  }
  function type(node){
    if(node.dataset.playbookNode==='condition-group')return 'group';
    if(node.dataset.playbookNode==='psych-prompt')return node.dataset.tiResponseType==='score'?'score':'prompt';
    if(node.dataset.playbookNode==='choice')return 'choice';
    if(node.dataset.playbookNode==='rule'||node.tagName==='LI')return 'rule';
    if(/^H[123]$/.test(node.tagName))return 'heading';
    if(node.dataset.playbookNode==='note'||node.tagName==='BLOCKQUOTE')return 'note';
    if(node.tagName==='P'&&!node.closest('[data-playbook-node]'))return 'text';
    return 'preserved';
  }
  function summarize(html){
    const host=documentHost(html);
    return [...host.querySelectorAll('[data-ti-ai-node-id]')].filter(n=>!n.parentElement.closest('[data-playbook-node="rule"],[data-playbook-node="choice"],[data-playbook-node="psych-prompt"],[data-playbook-node="note"]')).map(n=>({
      id:n.dataset.tiAiNodeId,type:type(n),label:clean(n).slice(0,1200),parentId:n.parentElement?.closest('[data-ti-ai-node-id]')?.dataset.tiAiNodeId||null,
      logic:n.dataset.tiLogic||(type(n)==='choice'?'exclusive':'all'),dependsOn:n.dataset.tiDependsOn||null,
      options:[...n.querySelectorAll(':scope > .pb-doc-choice-options [data-choice-option]')].map((x,i)=>({id:x.dataset.tiChoiceOptionId||n.dataset.tiAiNodeId+'_option_'+i,label:clean(x)})),
      condition:(()=>{try{return JSON.parse(n.dataset.tiCondition||'null')}catch{return null}})(),metadataStatus:n.dataset.tiConditionStatus||null,maximum:type(n)==='score'?10:null,locked:type(n)==='preserved'||clean(n).length>1200||Boolean(n.querySelector('[data-playbook-node="image"],[data-playbook-node="image-field"],table'))
    }));
  }
  function nodeElement(data,previous=null){
    const tag=data.type==='heading'?'h'+(data.level||2):data.type==='text'?'p':'div';
    const node=document.createElement(previous?.tagName==='LI'&&data.type==='rule'?'li':tag);
    if(previous){for(const a of previous.attributes)if(a.name==='style'||a.name==='class'||a.name.startsWith('data-playbook-')||a.name.startsWith('data-ti-'))node.setAttribute(a.name,a.value)}
    for(const key of ['playbookNode','tiResponseType','tiAiCondition','tiDependsOn','tiLogic','tiGroupLabel','tiCondition','tiConditionLabel','tiConditionStatus','tiFunctionHeading','tiReflectionId'])delete node.dataset[key];
    node.classList.remove('pb-doc-rule','pb-doc-choice','pb-doc-note','ti-condition-group');
    node.dataset.tiAiNodeId=data.id;
    if(data.dependsOn)node.dataset.tiDependsOn=data.dependsOn;
    if(data.condition){node.dataset.tiCondition=JSON.stringify(data.condition);node.dataset.tiConditionLabel=data.label;node.dataset.tiConditionStatus='defined'}
    if(data.type==='rule'){
      node.classList.add('pb-doc-rule');node.dataset.playbookNode='rule';node.dataset.tiAiCondition='1';
      node.innerHTML='<span class="pb-doc-label">RULE</span><p>'+escape(data.label)+'</p>';
    }else if(data.type==='choice'){
      node.dataset.playbookNode='condition-group';node.dataset.tiLogic=data.logic;node.dataset.tiGroupLabel=data.label;node.classList.add('ti-condition-group');
      node.innerHTML='<span class="pb-doc-label">'+escape(data.logic.toUpperCase())+'</span><b>'+escape(data.label)+'</b><div class="ti-condition-members">'+data.options.map(o=>'<div data-ti-condition-member data-ti-ai-node-id="'+escape(o.id)+'" data-playbook-node="rule"'+(o.condition?' data-ti-condition="'+escape(JSON.stringify(o.condition))+'" data-ti-condition-label="'+escape(o.label)+'" data-ti-condition-status="defined"':'')+'><p>'+escape(o.label)+'</p></div>').join('')+'</div>';
    }else if(data.type==='prompt'||data.type==='score'){
      node.dataset.playbookNode='psych-prompt';node.dataset.tiReflectionId=previous?.dataset.tiReflectionId&&type(previous)===data.type?previous.dataset.tiReflectionId:makeId(data.type);
      if(data.type==='score')node.dataset.tiResponseType='score';node.dataset.tiTextBlock='1';node.innerHTML='<p>'+escape(data.label)+'</p>';
    }else if(data.type==='note'){node.classList.add('pb-doc-note');node.dataset.playbookNode='note';node.innerHTML='<p>'+escape(data.label)+'</p>'}
    else node.textContent=data.label;
    return node;
  }
  function compile(base,proposal){
    const host=documentHost(proposal.intent==='create'?'':base.documentHtml);
    const find=id=>[...host.querySelectorAll('[data-ti-ai-node-id]')].find(n=>n.dataset.tiAiNodeId===id);
    const needed=id=>{const node=find(id);if(!node)throw Error('The proposal refers to a missing block. Ask the AI to prepare it again.');return node};
    function place(node,op){
      const anchorId=op.beforeId||op.afterId;if(!anchorId){host.append(node);return}
      let anchor=needed(anchorId);
      if(anchor===node||node.contains(anchor))throw Error('A block cannot be moved inside itself.');
      if(['UL','OL'].includes(anchor.parentElement.tagName)&&node.tagName!=='LI'){
        if(['rule','group'].includes(type(node))){const li=document.createElement('li');for(const a of node.attributes)li.setAttribute(a.name,a.value);li.innerHTML=node.innerHTML;node=li}
        else anchor=anchor.parentElement;
      }
      if(op.beforeId)anchor.before(node);else anchor.after(node);
    }
    for(const op of proposal.operations){
      if(op.action==='insert'){
        if(find(op.node.id))throw Error('The proposal repeats a block identifier.');
        place(nodeElement(op.node),op);
      }else if(op.action==='update'){
        const previous=needed(op.targetId);
        if(type(previous)==='preserved'||clean(previous).length>1200||previous.querySelector('[data-playbook-node="image"],[data-playbook-node="image-field"],table'))throw Error('Edit this compound or long manual block through its individual conditions, or move/remove the whole block.');
        if(type(previous)==='group'&&op.node.type!=='choice')throw Error('Update a logic group as a choice with its existing condition IDs.');
        if(type(previous)==='group'){
          const members=[...previous.querySelectorAll('[data-ti-condition-member]')];
          if(members.length===op.node.options.length&&members.every((m,i)=>m.dataset.tiAiNodeId===op.node.options[i].id&&clean(m)===op.node.options[i].label)){
            previous.dataset.tiLogic=op.node.logic;previous.dataset.tiGroupLabel=op.node.label;
            previous.querySelector(':scope > b').textContent=op.node.label;previous.querySelector(':scope > .pb-doc-label').textContent=op.node.logic.toUpperCase();
            if(op.node.dependsOn)previous.dataset.tiDependsOn=op.node.dependsOn;else delete previous.dataset.tiDependsOn;
            continue;
          }
        }
        previous.replaceWith(nodeElement({...op.node,id:op.targetId},previous));
      }else if(op.action==='remove')needed(op.targetId).remove();
      else if(op.action==='move')place(needed(op.targetId),op);
      else if(op.action==='group'){
        if(find(op.node.id))throw Error('The logic group needs a new identifier.');
        const members=op.members.map(needed);
        if(new Set(op.members).size!==op.members.length||members.some(n=>type(n)!=='rule'))throw Error('Group distinct individual rule conditions.');
        if(members.some(n=>n.contains(members.find(m=>m!==n))))throw Error('A logic group cannot contain itself.');
        const first=members[0],group=document.createElement(first.tagName==='LI'?'li':'div');
        group.dataset.playbookNode='condition-group';group.dataset.tiAiNodeId=op.node.id;group.dataset.tiLogic=op.logic;group.dataset.tiGroupLabel=op.node.label;group.className='ti-condition-group';
        if(op.dependsOn)group.dataset.tiDependsOn=op.dependsOn;
        group.innerHTML='<span class="pb-doc-label">'+escape(op.logic.toUpperCase())+'</span><b>'+escape(op.node.label)+'</b><div class="ti-condition-members"></div>';
        first.before(group);const container=group.querySelector('.ti-condition-members');
        for(const member of members){const copy=member.tagName==='LI'?document.createElement('div'):member;
          if(copy!==member){for(const a of member.attributes)copy.setAttribute(a.name,a.value);copy.innerHTML=member.innerHTML;member.remove()}
          copy.dataset.tiConditionMember='';delete copy.dataset.tiAiCondition;container.append(copy);
        }
        if(op.beforeId||op.afterId)place(group,op);
      }
    }
    host.querySelectorAll('ul,ol').forEach(list=>{if(!list.children.length)list.remove()});
    host.querySelectorAll('.pb-doc-remove-btn,[data-instrument-remove-reflection]').forEach(x=>x.remove());
    const nodes=[...host.querySelectorAll('[data-ti-ai-node-id]')],ids=nodes.map(n=>n.dataset.tiAiNodeId);
    if(new Set(ids).size!==ids.length)throw Error('The proposal duplicates a condition identifier.');
    const byId=new Map(nodes.map(n=>[n.dataset.tiAiNodeId,n]));
    for(const n of nodes){const dep=n.dataset.tiDependsOn;if(!dep)continue;const parent=byId.get(dep);
      if(!parent||!['rule','group','choice'].includes(type(parent))||parent.contains(n)||n.contains(parent)||!(parent.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('Each dependent condition needs an earlier valid prerequisite.');
    }
    return {...base,name:proposal.name??base.name,description:proposal.description??base.description,documentHtml:host.innerHTML};
  }
  function refreshMetadata(host){if(!host)return;for(const node of host.querySelectorAll('[data-ti-condition-label]'))node.dataset.tiConditionStatus=clean(node)===node.dataset.tiConditionLabel.replace(/\s+/g,' ').trim()?'defined':'needs-review'}
  root.TIOSAIDocument=Object.freeze({summarize,compile,makeId,refreshMetadata});
})(window);
