'use strict';
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','..','t-ios.html'),'utf8');
function block(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<=a)throw Error('Missing application source block: '+start);return source.slice(a,b);}
// Document parsing/storage and transport are fixtures. The real application
// renders, captures/restores drafts, calculates scores and saves responses.
function installRecordingWorkspace(e){
 const w=e.w;
 w.document.body.insertAdjacentHTML('beforeend',block('    <section class="page" id="page-execution">','\n\n\n\n\n    <!-- INTELLIGENCE -->'));
 const workspace=w.document.querySelector('#page-execution .execution-map-layout');
 const documents={
  playbook:[{id:'pb',name:'Entry plan',documentHtml:JSON.stringify([{type:'check',label:'Entry condition'},{type:'psych-prompt',reflectionId:'pb-note',label:'Entry context'}])}],
  checklist:[{id:'rules',name:'Trade rules',ruleScope:'trade',documentHtml:JSON.stringify([{type:'check',label:'Respect risk'}])},
    ...['session','daily','weekly','monthly'].map(ruleScope=>({id:ruleScope,name:ruleScope+' rules',ruleScope,documentHtml:JSON.stringify([{type:'check',label:'Period rule'},{type:'psych-prompt',reflectionId:'period-note',label:'Period behaviour'}])}))],
  psych:[{id:'psych',name:'Mindset',documentHtml:JSON.stringify([{type:'psych-prompt',reflectionId:'psych-note',label:'What happened?'},{type:'psych-prompt',reflectionId:'score_discipline',responseType:'score',label:'Discipline'}])}]
 };
 const tables={trade_execution_reviews:[{id:'review',user_id:'owner',trade_id:'trade',notes:'Existing review',execution_score:50}],trade_execution_checks:[{id:'existing',review_id:'review',user_id:'owner',criterion_key:'legacy_rule',criterion_label:'Original rule',complied:false,comment:'Original recorded evidence',sort_order:1}]},writes=[];
 const db={from(table){let rows=null,method='get',single=false;const filters=[];
  const q={insert(row){method='insert';rows=[row];return q},upsert(data){method='upsert';rows=data;return q},select(){return q},single(){single=true;return q},eq(k,v){filters.push([k,v]);return q},then(resolve,reject){return Promise.resolve().then(()=>{
   let result=tables[table].filter(row=>filters.every(([k,v])=>row[k]===v));
   if(rows){writes.push({table,method,rows:JSON.parse(JSON.stringify(rows))});result=rows.map(row=>{
    const previous=method==='upsert'?tables[table].find(item=>item.review_id===row.review_id&&item.criterion_key===row.criterion_key):null;
    const saved={...previous,...row,id:previous?.id||'row-'+table+'-'+tables[table].length};
    if(previous)Object.assign(previous,saved);else tables[table].push(saved);return {...saved};
   });}
   return {data:single?result[0]||null:result,error:null};
  }).then(resolve,reject)}};return q;
 }};
 Object.assign(w,{
  currentUser:{id:'owner'},tradingAccount:{id:'account',account_name:'Deriv Demo'},db,
  trades:[{...e.trade,trade_date:'2026-10-10',direction:'BUY',pnl:10},{...e.trade,id:'trade-2',trade_date:'2026-10-09',direction:'SELL',pnl:-5}],selectedExecutionTradeId:null,
  executionReviews:tables.trade_execution_reviews.slice(),executionChecks:tables.trade_execution_checks.slice(),playbookDocuments:documents.playbook,
  $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],
  escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  loadPlaybookDocuments:()=>{},currentPlaybookDocument:()=>documents.playbook[0]||null,
  loadSecondaryDocuments:()=>{},secondaryState:kind=>({docs:documents[kind],selectedId:documents[kind][0]?.id}),currentSecondaryDocument:kind=>documents[kind][0]||null,
  playbookStructuredPreviewItems:html=>JSON.parse(html),normalizePlaybookListLayout:layout=>layout||'vertical',
  playbookStyleRenderAttributes:()=>'',instrumentTextPresentation:()=>'',hydratePlaybookImages:()=>{},
  journalTradeNumbers:()=>new Map(w.trades.map((trade,i)=>[String(trade.id),i+1])),
  journalDayGroups:trades=>trades.map(trade=>({date:trade.trade_date,trades:[trade]})),compareTradeChronology:(a,b)=>a.id.localeCompare(b.id),
  formatDate:value=>value,localDateString:date=>date.toISOString().slice(0,10),signedMoney:value=>String(value),
  executionDirectionClass:value=>value==='BUY'?'buy':'sell',pnlClass:value=>value>0?'pos':value<0?'neg':'neutral',showStatus:value=>{w.lastRecordingStatus=value;}
 });
 for(const file of ['technical-instruments/period-rules.js','technical-instruments/condition-logic.js'])w.eval(fs.readFileSync(path.join(__dirname,'..','..',file),'utf8'));
 w.eval(block('function executionScoreResponseFromComment(', '\nfunction executionReflectionSignature('));
 w.eval(block('function instrumentReflectionRenderHtml(', '\nconst INSTRUMENT_DEFAULT_TEMPLATES='));
 w.eval(block('let executionMappingPlaybookId=null;', '\nfunction renderExecution(){'));
 const select=(kind,id)=>{const names={playbook:'Playbook',checklist:'Checklist',psych:'Psych'};const field=w.document.querySelector('#executionMap'+names[kind]+'Select');if(id)field.value=id;field.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const input=(id,value)=>{const field=w.document.querySelector('[data-execution-reflection-id="'+id+'"]');field.value=String(value);field.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {workspace,documents,tables,writes,select,input};
}
module.exports={installRecordingWorkspace};
