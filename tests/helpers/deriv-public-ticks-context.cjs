'use strict';
// Deliberately synthetic transport and times, used only in tests.
class FakeSocket{
 constructor(url){this.url=url;this.readyState=0;this.sent=[];this.handlers=new Map();this.closeCount=0;}
 addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);}
 removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);}
 emit(name,event={}){for(const fn of [...(this.handlers.get(name)||[])])fn(event);}
 open(){this.readyState=1;this.emit('open');}
 send(value){this.sent.push(JSON.parse(value));}
 receive(value){this.emit('message',{data:JSON.stringify(value)});}
 close(){this.readyState=3;this.closeCount++;this.emit('close');}
}
function clock(start=1791633600000){
 let time=start,id=0;const timers=new Map();
 const setTimeout=(fn,delay)=>{const key=++id;timers.set(key,{fn,at:time+delay});return key;};
 const clearTimeout=key=>timers.delete(key);
 const advance=amount=>{
  const end=time+amount;
  while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}
  time=end;
 };
 return {now:()=>time,setTimeout,clearTimeout,advance,timers};
}
const catalog=[
 {underlying_symbol:'catalog-one-second',underlying_symbol_name:'Volatility 75 (1s) Index',exchange_is_open:1,is_trading_suspended:0},
 {underlying_symbol:'catalog-standard',underlying_symbol_name:'Volatility 75 Index',exchange_is_open:1,is_trading_suspended:0}
];
function resolve(socket,items=catalog){socket.open();socket.receive({msg_type:'active_symbols',active_symbols:items});}
function tick(socket,epoch,quote=123.456,symbol='catalog-one-second'){socket.receive({msg_type:'tick',tick:{epoch,quote,symbol}});}
module.exports={FakeSocket,clock,catalog,resolve,tick};
