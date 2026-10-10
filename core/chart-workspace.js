/* Versioned, serializable defaults for T-IOS. No TradingView account or market data. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIOSChartPreferences=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const intervals=[['1','M1'],['3','M3'],['5','M5'],['15','M15'],['30','M30'],['60','H1'],['120','H2'],['240','H4'],['D','D1'],['W','W1'],['M','MN1']];
  const timezones=[['Etc/UTC','UTC'],['exchange','Exchange timezone']];
  const symbolPattern=/^[A-Z0-9_]{1,20}:[A-Z0-9_./!^\-]{1,60}$/;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  function defaults(){
    return {version:1,layout:'single',theme:'dark',timezone:'Etc/UTC',charts:{
      single:[{id:'single',symbol:'FX:EURUSD',interval:'60',responsibility:'Market analysis'}],
      multiple:[
        {id:'context',symbol:'FX:EURUSD',interval:'240',responsibility:'Market Context'},
        {id:'setup',symbol:'FX:EURUSD',interval:'60',responsibility:'Setup Development'},
        {id:'entry',symbol:'FX:EURUSD',interval:'5',responsibility:'Entry Execution'}
      ]
    }};
  }
  function validate(value){
    if(!exactKeys(value,['version','layout','theme','timezone','charts'])||value.version!==1
      ||!['single','multiple'].includes(value.layout)||!['dark','light'].includes(value.theme)
      ||!timezones.some(item=>item[0]===value.timezone)||!exactKeys(value.charts,['single','multiple']))return 'Unsupported chart preferences.';
    for(const mode of ['single','multiple']){
      const charts=value.charts[mode];
      if(!Array.isArray(charts)||charts.length<1||charts.length>12||(mode==='single'&&charts.length!==1))return 'Unsupported chart count.';
      const ids=new Set();
      for(const [index,chart] of charts.entries()){
        const name=(mode==='single'?'Single chart':'Multiple charts · Chart '+(index+1));
        if(!exactKeys(chart,['id','symbol','interval','responsibility'])||typeof chart.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(chart.id)||ids.has(chart.id))return name+': invalid chart identity.';
        ids.add(chart.id);
        if(typeof chart.symbol!=='string'||!symbolPattern.test(chart.symbol))return name+': use an EXCHANGE:SYMBOL, such as FX:EURUSD.';
        if(!intervals.some(item=>item[0]===chart.interval))return name+': choose a supported timeframe.';
        if(typeof chart.responsibility!=='string'||Array.from(chart.responsibility).length>120)return name+': keep the responsibility within 120 characters.';
      }
    }
    return null;
  }
  function widgetSettings(chart,prefs){
    return {autosize:true,symbol:chart.symbol,interval:chart.interval,timezone:prefs.timezone,
      theme:prefs.theme,style:'1',locale:'en',allow_symbol_change:true,hide_side_toolbar:false,
      withdateranges:true,save_image:false,show_popup_button:true,popup_width:'1200',popup_height:'800',
      support_host:'https://www.tradingview.com'};
  }
  return {defaults,clone,validate,intervals,timezones,symbolPattern,widgetSettings};
});
