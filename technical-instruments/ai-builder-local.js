(function(root){
  'use strict';
  // Whole-instruction grammars produce bounded structured operations, never HTML.
  // A failed match or an ambiguous target cannot fall through to a paid request.
  const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const unquote=s=>String(s||'').trim().replace(/^["“]([\s\S]*)["”]$|^'([\s\S]*)'$/,(m,a,b)=>a??b);
  const isQuoted=s=>/^(?:"[^"]*"|“[^”]*”|'[^']*')$/.test(s);
  const format=values=>({align:null,spacing:null,border:null,preset:null,layout:null,fontSize:null,bold:null,italic:null,underline:null,...values});
  const operation=values=>({action:'insert',targetId:null,beforeId:null,afterId:null,node:null,members:[],logic:null,dependsOn:null,color:null,formatting:null,...values});
  const node=(id,label,type='rule',level=null)=>({id,label,type,level,options:[],logic:'all',dependsOn:null,condition:null,maximum:type==='score'?10:null});
  const question=(q,pending=null)=>({engine:'clarify',answer:{message:'I need one detail before preparing a preview. Your instrument has not been changed.',questions:[q.slice(0,500)],proposal:null},pending});
  const ai=()=>({engine:'ai',pending:null});
  const colors='red|orange|yellow|green|blue|purple|pink|black|white|gray|default|#[0-9a-f]{6}';
  const command=/^(?:change|set|make|rename|delete|remove|move|align|format|color|colour|resize|bold|italicize|underline|add|insert|create|build|analy[sz]e|explain|help|develop|undo)\b/i;
  const mixed=/(?:\band\b|\bthen\b|\balso\b|\bbut\b|,|;|\n)\s*(?:please\s+)?(?:change|set|make|rename|delete|remove|move|align|format|color|colour|resize|add|insert|create|build|analy[sz]e|explain|help|develop|identify|review|organize|improve)\b/i;
  const literal=value=>{
    const raw=String(value||'').trim(),quoted=isQuoted(raw);
    if(!raw||raw.length>1200||(!quoted&&mixed.test(raw)))return null;
    return unquote(raw);
  };
  function target(reference,blocks){
    let value=String(reference||'').trim().replace(/^(?:only\s+)?(?:the\s+)?(?:only\s+)?/i,'');
    let kind=null,match=value.match(/^(heading|paragraph|text|rule|section|block|note|prompt|score)(?:\s+(?:named|called|titled))?\b\s*(.*)$/i);
    if(match){kind=match[1].toLowerCase();value=match[2]}
    else if((match=value.match(/^(.+?)\s+(heading|paragraph|rule|section|note|prompt|score)$/i))){value=match[1];kind=match[2].toLowerCase()}
    if(kind==='section')kind='heading';if(kind==='paragraph')kind='text';
    const name=normalize(unquote(value));
    let candidates=blocks.filter(b=>!kind||kind==='block'||b.type===kind);
    const id=kind==='block'&&name.replace(/^#|^id\s+/,'');
    let matches=name?candidates.filter(b=>normalize(b.label)===name||id===b.id):candidates;
    if(kind==='rule'&&/^#?\d+$/.test(name))matches=candidates.filter(b=>normalize(b.label)==='rule '+name.replace('#',''));
    // An exact Rule 2 label wins; otherwise an explicit numbered rule means the
    // second individual rule in document order, never the second arbitrary block.
    if(!matches.length&&kind==='rule'&&/^#?\d+$/.test(name))matches=candidates.slice(Number(name.replace('#',''))-1,Number(name.replace('#','')));
    if(matches.length!==1){
      const examples=(matches.length?matches:candidates).slice(0,2).map(b=>'“'+b.label.slice(0,70)+'” (block '+b.id+')').join(', ');
      return {error:(matches.length?'More than one block matches. Which exact block ID should I use?':'Which exact '+(kind||'block')+' should I use?')+(examples?' For example: '+examples+'.':' Give its exact text or block ID.')};
    }
    return {block:matches[0]};
  }
  function nameList(text,count){
    const names=String(text||'').replace(/^(?:names?|named|called|titled)\s*:\s*/i,'').split(/[\n,;]+/).map(x=>unquote(x.replace(/^\s*\d+[.)]\s*/,''))).filter(Boolean);
    return names.length===count&&new Set(names.map(normalize)).size===count&&names.every(x=>x.length<=160&&!command.test(x))?names:null;
  }
  function clarifyRules(input){
    if(!input||!['playbook','checklist','psych'].includes(input.context?.kind)||input.images?.length)return null;
    const match=String(input.message||'').match(/^(?:please\s+)?(?:create|add|insert|make|build|generate)\s+(?:me\s+)?(?:exactly\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+)?(?:trading\s+)?rules?\b([\s\S]*)$/i);
    if(!match)return null;
    const count=({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10})[match[1].toLowerCase()]||Number(match[1]);
    if(count<1||count>20)return null;
    const remainder=match[2].replace(/^[\s,:;.\-–—]+|[\s.;]+$/g,'').replace(/^(?:named|called|titled)\s+/i,'');
    const placeholders=remainder.replace(/\brules?\s*(?:number\s*)?#?\s*\d{1,2}\b/gi,'').replace(/\b(?:to|through|and)\b/gi,'').replace(/[\s,:;.()#\-–—]+/g,'');
    if(!placeholders){const written=count===5?'five':count===1?'one':String(count);return question('What should I name the '+written+' rule'+(count===1?'':'s')+'?',{type:'rule_names',count})}
    const names=/^\s*[:;,]?\s*(?:named|called|titled)\s+/i.test(match[2])?nameList(remainder,count):null;
    return names?question('What should each rule check? Provide one line per rule as Name: condition.',{type:'rule_conditions',names}):null;
  }
  function route(message,context={}){
    const input=String(message||'').trim().replace(/^please\s+/i,'').replace(/[.!]$/,'').trim(),blocks=context.blocks||[],kind=context.kind||'playbook';
    if(!input)return context.hasImages?ai():question('What would you like to edit or develop?');
    const initial=clarifyRules({message:input,context:{kind},images:context.hasImages?[{}]:[]});if(initial)return initial;
    const pending=context.hasImages?null:context.pending;
    if(pending?.type==='rule_names'&&!command.test(input)){
      const names=nameList(input,pending.count);
      return names?question('What should each rule check? Provide one line per rule as Name: condition.',{type:'rule_conditions',names}):question('Please give '+pending.count+' distinct rule names, separated by commas or new lines.',pending);
    }
    const makeProposal=(operations,description,activity='Preparing preview…')=>({engine:'local',pending:null,activity,answer:{message:description,questions:[],proposal:{intent:'edit',kind,name:null,description:null,operations}}});
    const fresh=()=>{let i=1;while(blocks.some(b=>b.id==='local_'+i))i++;return 'local_'+i};
    if(pending?.type==='rule_conditions'&&!command.test(input)){
      const lines=input.split(/\n+/).map(s=>s.trim()).filter(Boolean),pairs=lines.map(s=>{const i=s.indexOf(':');return i>0?[normalize(s.slice(0,i)),literal(s.slice(i+1))]:null});
      if(pairs.length!==pending.names.length||pairs.some(p=>!p||!p[1])||new Set(pairs.map(p=>p?.[0])).size!==pending.names.length||pending.names.some(n=>!pairs.some(p=>p?.[0]===normalize(n))))return question('Give the actual condition for each named rule, one line per rule as Name: condition. I will not invent conditions.',pending);
      const used=new Set(blocks.map(b=>b.id));let i=1;
      return makeProposal(pending.names.map(name=>{while(used.has('local_'+i))i++;const id='local_'+i++;return operation({node:node(id,name+': '+pairs.find(p=>p[0]===normalize(name))[1])})}),'Append the supplied names and conditions at the end of this instrument.');
    }
    if(/^(?:undo|undo (?:the )?(?:last|previous)(?: approved| applied)?(?: ai| local| builder)? change)$/i.test(input))return {engine:'undo',pending:null,activity:'Preparing undo preview…'};
    // Compound editing requests are never partially applied. A reasoning-first
    // request goes to AI as a whole; an edit-first mixture asks for explicit scope.
    if(command.test(input)&&!/^(?:analy[sz]e|explain|help|develop|build)\b/i.test(input)&&mixed.test(input.replace(/"[^"]*"|“[^”]*”|'[^']*'/g,'')))return question('This combines multiple changes or editing with analysis. Send one exact edit, or start with “Analyze” and describe the complete AI proposal you want.');
    let match,reference,values;
    if((match=input.match(new RegExp('^(?:change|set|make|color|colour)\\s+(.+?)\\s+(?:text\\s+colou?r\\s+)?(?:to\\s+)?('+colors+')$','i')))){
      reference=match[1].replace(/\s+(?:text\s+)?colou?r$/i,'');values={color:match[2].toLowerCase()};
    }else if((match=input.match(/^(?:align\s+(.+?)\s+(?:to\s+the\s+|to\s+)?(left|center|right)|(?:change|set)\s+(?:the\s+)?alignment\s+of\s+(.+?)\s+to\s+(left|center|right))$/i))){
      reference=match[1]||match[3];values={formatting:format({align:(match[2]||match[4]).toLowerCase()})};
    }else if((match=input.match(/^(?:change|set)\s+(?:the\s+)?font size\s+of\s+(.+?)\s+to\s+(\d+)\s*(px|pt)$/i))){
      reference=match[1];const size=Number(match[2])*(match[3].toLowerCase()==='pt'?4/3:1);
      if(!Number.isInteger(size)||size<8||size>72)return question('Choose a font size from 8 to 72 px (or a pt size that converts to whole pixels).');
      values={formatting:format({fontSize:size})};
    }else if((match=input.match(/^(?:make|set)\s+(.+?)\s+(bold|italic|underlined|not bold|not italic|not underlined)$/i))){
      reference=match[1];const key=match[2].toLowerCase(),property=key.replace('not ','').replace('underlined','underline');values={formatting:format({[property]:!key.startsWith('not ')})};
    }else if((match=input.match(/^(?:change|set)\s+(?:the\s+)?(spacing|border|preset|layout)\s+of\s+(.+?)\s+to\s+([a-z0-9-]+)$/i))){
      const key=match[1].toLowerCase(),value=match[3].toLowerCase(),allowed={spacing:['compact','normal','relaxed'],border:['default','none','thin','strong'],preset:['plain','card','highlight','minimal'],layout:['vertical','row','columns-2','columns-3','squares']}[key];
      if(!allowed.includes(value))return question('Choose a supported '+key+': '+allowed.join(', ')+'.');
      reference=match[2];values={formatting:format({[key]:value})};
    }
    if(values){
      const found=target(reference,blocks);if(found.error)return question(found.error);
      const b=found.block;
      if(values.formatting?.layout&&!b.layoutSupported)return question('Layout changes require an existing list or choice layout. Use its exact block ID or the Manual editor.');
      if(!values.formatting?.layout&&!['heading','text','rule','note','prompt','score','group'].includes(b.type))return question('This compound block needs the Manual editor. Specify an individual heading, paragraph or rule for local formatting.');
      return makeProposal([operation({action:'style',targetId:b.id,...values})],'Update only the formatting of “'+b.label+'”; preserve its text, conditions and logic.','Updating formatting…');
    }
    if((match=input.match(/^rename\s+(.+?)\s+to\s+([\s\S]+)$/i))){
      const found=target(match[1],blocks),name=literal(match[2]);if(found.error)return question(found.error);
      if(!name)return question('What exact new text should I use? Put literal text in quotes.');
      const b=found.block;if(b.locked||!['heading','text','rule','note','prompt','score'].includes(b.type))return question('This block contains multiple items. Specify the exact individual heading or rule to rename.');
      return makeProposal([operation({action:'rename',targetId:b.id,node:node(b.id,name,b.type,b.level||null)})],'Rename only “'+b.label+'” to “'+name+'”.');
    }
    if((match=input.match(/^(?:remove|delete)\s+([\s\S]+)$/i))){
      const raw=match[1].replace(/^(?:only\s+)?(?:the\s+)?(?:whole\s+|entire\s+)?/i,''),section=/^section\b|\bsection$/i.test(raw),found=target(raw,blocks);
      if(found.error)return question(found.error);
      if(section&&!found.block.sectionSafe)return question('The section boundary is ambiguous. Use individual block IDs or the Manual editor.');
      return makeProposal([operation({action:section?'remove_section':'remove',targetId:found.block.id})],section?'Remove this heading and its section up to the next heading of the same or higher level.':'Remove only “'+found.block.label+'”.');
    }
    if((match=input.match(/^move\s+(.+?)\s+(?:(before|after)\s+(.+)|to\s+(?:the\s+)?(top|start|end|bottom))$/i))){
      if(/\bsection\b/i.test(match[1]))return question('Move the heading alone, or move the entire section? Use the Manual editor for a whole-section move.');
      const found=target(match[1],blocks);if(found.error)return question(found.error);if(found.block.parentId)return question('Moving this nested block could change its execution group. Use the Manual editor or ask AI to reorganize the complete structure.');
      let anchor,direction=match[2]?.toLowerCase();
      if(match[4]){const top=blocks.filter(b=>!b.parentId&&b.id!==found.block.id);direction=/top|start/i.test(match[4])?'before':'after';anchor=direction==='before'?top[0]:top.at(-1)}
      else {const result=target(match[3],blocks);if(result.error)return question(result.error);anchor=result.block}
      if(!anchor||anchor.id===found.block.id||anchor.parentId)return question('Specify a different top-level block as the before/after position.');
      return makeProposal([operation({action:'move',targetId:found.block.id,[direction==='before'?'beforeId':'afterId']:anchor.id})],'Move only “'+found.block.label+'” '+direction+' “'+anchor.label+'”.');
    }
    if((match=input.match(/^(?:add|insert|create)\s+(?:a\s+)?(heading|rule|paragraph|note|prompt)\s*(?:(?:called|named|titled)\s+|:\s*)([\s\S]+)$/i))){
      const type=match[1].toLowerCase();let supplied=match[2],position={};
      // Placement suffixes must be outside quoted literal content.
      const placement=supplied.match(/^([\s\S]+?)\s+(before|after)\s+(.+)$/i);
      if(placement&&!isQuoted(supplied)){
        const found=target(placement[3],blocks);if(found.error)return question(found.error);if(found.block.parentId)return question('Use a top-level heading or block as the insertion position.');
        supplied=placement[1];position[placement[2].toLowerCase()==='before'?'beforeId':'afterId']=found.block.id;
      }
      const content=literal(supplied);if(!content)return question('Provide the exact text in quotes and a clear before/after position, or omit the position to append it.');
      if(type==='rule'&&!/:/.test(input.slice(0,input.indexOf(match[2]))))return question('What should “'+content+'” check? Provide the actual trading condition as '+content+': condition.',{type:'rule_conditions',names:[content]});
      return makeProposal([operation({node:node(fresh(),content,type==='paragraph'?'text':type,type==='heading'?2:null),...position})],(position.beforeId?'Insert before the identified block.':position.afterId?'Insert after the identified block.':'Append at the end of this instrument.')+' Use only the text you supplied.');
    }
    // A local-looking instruction that did not match the complete grammar is a
    // clarification, not an invitation to run a paid model or guess a target.
    if(/^(?:change|set|make|rename|delete|remove|move|align|format|color|colour|resize|bold|italicize|underline|undo)\b/i.test(input)||/^(?:add|insert|create)\s+(?:a\s+)?(?:heading|paragraph|rule|note|prompt)\b/i.test(input))return question('Specify one exact edit, for example: Change only the “Market Context” heading to red; Rename Rule 2 to “Risk Management”; or Create a rule: “your condition”. Use block IDs when labels repeat.');
    return ai();
  }
  const api=Object.freeze({route,clarifyRules,operation,format});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TIOSAILocal=api;
})(typeof window!=='undefined'?window:globalThis);
