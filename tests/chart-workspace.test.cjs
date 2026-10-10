'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../core/chart-workspace.js');
test('single and multiple layouts keep independent optional responsibility labels',()=>{
 const first=P.defaults(),other=P.defaults();assert.equal(first.layout,'single');
 first.charts.single[0].symbol='BINANCE:BTCUSDT';first.charts.single[0].responsibility='';
 assert.equal(first.charts.multiple[0].symbol,'FX:EURUSD');assert.equal(other.charts.single[0].symbol,'FX:EURUSD');assert.equal(P.validate(first),null);
 assert.deepEqual(first.charts.multiple.map(c=>c.interval),['240','60','5']);
});
test('versioned preferences reject hostile symbols, unknown settings and duplicate chart identities',()=>{
 for(const change of [p=>p.charts.single[0].symbol='<script>alert(1)</script>',p=>p.charts.single[0].symbol='https://example.com',p=>p.version=2,p=>p.secret='unexpected',p=>p.charts.multiple[1].id='context',p=>p.charts.single[0].interval='999',p=>p.charts.single[0].responsibility='x'.repeat(121)]){
  const prefs=P.defaults();change(prefs);assert.ok(P.validate(prefs));
 }
});
test('bounded chart arrays permit future counts without changing the preference shape',()=>{
 const p=P.defaults();p.charts.multiple=Array.from({length:12},(_,n)=>({...p.charts.single[0],id:'chart-'+n}));assert.equal(P.validate(p),null);
 p.charts.multiple.push({...p.charts.single[0],id:'overflow'});assert.ok(P.validate(p));
});
test('official widget configuration requests supported analysis controls without a screenshot or account API',()=>{
 const p=P.defaults(),config=P.widgetSettings(p.charts.multiple[2],p);
 assert.equal(config.interval,'5');assert.equal(config.allow_symbol_change,true);assert.equal(config.hide_side_toolbar,false);assert.equal(config.autosize,true);assert.equal(config.save_image,false);
 assert.equal(config.support_host,'https://www.tradingview.com');assert.equal(Object.keys(config).some(k=>/token|password|user|api_key/.test(k)),false);
});
