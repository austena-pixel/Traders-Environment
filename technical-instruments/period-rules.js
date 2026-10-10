(function(root){
  'use strict';

  const SCHEMA='tios.period-rule-review.v1';
  const SCOPES={trade:'Individual trade',session:'Session',daily:'Daily',weekly:'Weekly',monthly:'Monthly'};
  const normalizeScope=value=>Object.hasOwn(SCOPES,value)?value:'trade';
  const dayString=date=>date.toISOString().slice(0,10);
  const periodKey=value=>JSON.stringify([value.scope,value.startDate,value.endDate,
    value.scope==='session'?value.sessionLabel.trim().toLowerCase():'',value.startTime||'',value.endTime||'',value.timeZone||'']);

  function parseDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&dayString(date)===value?date:null;
  }

  function period(scope,input={}){
    if(!Object.hasOwn(SCOPES,scope)||scope==='trade')return null;
    const date=parseDay(input.date);
    if(!date)return null;
    let from=new Date(date),to=new Date(date);
    const result={scope,startDate:input.date,endDate:input.date};
    if(scope==='weekly'){
      from.setUTCDate(from.getUTCDate()-((from.getUTCDay()+6)%7));
      to=new Date(from);to.setUTCDate(to.getUTCDate()+6);
    }else if(scope==='monthly'){
      from.setUTCDate(1);to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,0));
    }else if(scope==='session'){
      const label=String(input.sessionLabel||'').trim();
      const startTime=String(input.startTime||''),endTime=String(input.endTime||'');
      const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      if(!label||label.length>80||!validTime(startTime)||!validTime(endTime)||startTime===endTime)return null;
      if(endTime<startTime)to.setUTCDate(to.getUTCDate()+1);
      const localTime=(day,time)=>{
        const [year,month,dayNumber]=day.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
        const value=new Date(year,month-1,dayNumber,hour,minute);
        // Do not silently move a nonexistent local time across a daylight-saving transition.
        return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===dayNumber&&value.getHours()===hour&&value.getMinutes()===minute?value:null;
      };
      const start=localTime(input.date,startTime),end=localTime(dayString(to),endTime);
      if(!start||!end||end<=start)return null;
      result.sessionLabel=label;result.startTime=startTime;result.endTime=endTime;
      result.startAt=start.toISOString();result.endAt=new Date(end.getTime()+59999).toISOString();
      result.timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Local time';
    }
    result.startDate=dayString(from);result.endDate=dayString(to);
    result.key=periodKey(result);
    return result;
  }

  function includesTrade(trade,selected){
    if(!selected)return false;
    if(selected.scope!=='session'){
      const date=String(trade.trade_date||'').slice(0,10);
      return Boolean(parseDay(date)&&date>=selected.startDate&&date<=selected.endDate);
    }
    // Import time does not identify a trading session. MT5 trades need their actual close time.
    const value=trade.closed_at||(trade.source==='mt5'?null:trade.created_at);
    const timestamp=value?Date.parse(value):NaN;
    return Number.isFinite(timestamp)&&timestamp>=Date.parse(selected.startAt)&&timestamp<=Date.parse(selected.endAt);
  }

  function reviewKey(record){
    return JSON.stringify([record.userId,record.accountId,record.ruleScope,record.period?.key,record.documentId]);
  }

  function storageKey(userId,accountId){
    if(!userId||!accountId)throw new Error('Sign in and select an account before saving a period review.');
    return 'tios_period_rule_reviews_v1:'+encodeURIComponent(userId)+':'+encodeURIComponent(accountId);
  }

  function validRecord(record,userId,accountId){
    if(!record||record.schema!==SCHEMA||record.userId!==userId||record.accountId!==accountId||
      !Object.hasOwn(SCOPES,record.ruleScope)||record.ruleScope==='trade'||!record.documentId||
      record.period?.scope!==record.ruleScope||!parseDay(record.period.startDate)||!parseDay(record.period.endDate)||
      record.period.startDate>record.period.endDate||typeof record.period.key!=='string'||
      record.key!==reviewKey(record)||typeof record.definition!=='string'||!Array.isArray(record.answers))return false;
    if(record.ruleScope==='session'){
      const selected=record.period;
      if(typeof selected.sessionLabel!=='string'||!selected.sessionLabel.trim()||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(selected.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(selected.endTime)||
        typeof selected.timeZone!=='string'||!selected.timeZone||!Number.isFinite(Date.parse(selected.startAt))||
        !Number.isFinite(Date.parse(selected.endAt))||Date.parse(selected.endAt)<=Date.parse(selected.startAt)||selected.key!==periodKey(selected))return false;
    }else{
      const expected=period(record.ruleScope,{date:record.period.startDate});
      if(!expected||expected.key!==record.period.key)return false;
    }
    const keys=new Set();
    return record.answers.every(answer=>{
      if(!answer||typeof answer.key!=='string'||typeof answer.comment!=='string'||keys.has(answer.key))return false;
      keys.add(answer.key);return true;
    });
  }

  function read(storage,userId,accountId){
    const raw=storage.getItem(storageKey(userId,accountId));
    if(raw===null)return [];
    let rows;
    try{rows=JSON.parse(raw)}catch(error){throw new Error('Saved period reviews could not be read. Their stored data has been kept.');}
    if(!Array.isArray(rows))throw new Error('Saved period reviews could not be read. Their stored data has been kept.');
    return rows.filter(row=>validRecord(row,userId,accountId));
  }

  function save(storage,record){
    if(!validRecord(record,record?.userId,record?.accountId))throw new Error('Select a valid period and Rules document before saving.');
    const key=storageKey(record.userId,record.accountId);
    // Re-read before each write so reviews made in another tab are preserved.
    const rows=read(storage,record.userId,record.accountId).filter(row=>row.key!==record.key);
    rows.push(record);
    try{storage.setItem(key,JSON.stringify(rows));}catch(error){throw new Error('This device could not save the review. Keep this page open and retry.');}
    const saved=read(storage,record.userId,record.accountId).find(row=>row.key===record.key);
    if(JSON.stringify(saved)!==JSON.stringify(record))throw new Error('The saved review could not be verified. Please retry.');
    return saved;
  }

  const api={schema:SCHEMA,scopes:SCOPES,normalizeScope,parseDay,period,includesTrade,reviewKey,storageKey,read,save};
  root.TIOSPeriodRules=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
