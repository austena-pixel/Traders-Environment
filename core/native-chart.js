/* Opt-in native analysis, using Lightweight Charts public APIs and real candles. */
(function(){
  'use strict';
  const A=window.TIOSChartAnalysis,F=window.TIOSDerivChartFeed;
  class Drawings {
    constructor(){this.items=[];this.preview=null;this.coordinates=[];this.view={zOrder:()=> 'top',renderer:()=>({draw:target=>this.draw(target)})};}
    attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;this.requestUpdate=requestUpdate;}
    detached(){this.requestUpdate=null;this.chart=null;this.series=null;}
    paneViews(){return [this.view];}
    set(items,preview=null){this.items=items;this.preview=preview;this.requestUpdate?.();}
    updateAllViews(){
      if(!this.chart||!this.series)return;
      this.coordinates=[...this.items,...(this.preview?[this.preview]:[])].map(item=>({...item,points:item.points.map(p=>({x:this.chart.timeScale().timeToCoordinate(p.time),y:this.series.priceToCoordinate(p.price)}))}));
    }
    draw(target){
      target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
        ctx.save();ctx.lineWidth=2;
        for(const d of this.coordinates){
          const [a,b]=d.points;if(a.y===null||!Number.isFinite(a.y))continue;
          ctx.strokeStyle=d.color;ctx.fillStyle=d.color;ctx.beginPath();
          if(d.type==='level'){ctx.moveTo(0,a.y);ctx.lineTo(mediaSize.width,a.y);ctx.stroke();}
          else if(a.x!==null&&Number.isFinite(a.x)){
            if(d.type==='text'){ctx.font='12px Arial';ctx.fillText(d.text,a.x+5,a.y-5);}
            else if(b&&b.x!==null&&b.y!==null){
              if(d.type==='trend'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
              else{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);ctx.globalAlpha=.12;ctx.fillRect(x,y,w,h);ctx.globalAlpha=1;ctx.strokeRect(x,y,w,h);}
            }
          }
        }
        ctx.restore();
      });
    }
  }
  window.TIOSNativeChart={create({host,paneId,store,feed,theme='dark',initialMarket='v75_1s',initialInterval='60',chartLibrary=window.LightweightCharts}){
    if(!A||!F||!chartLibrary?.createChart)throw Error('The native chart engine could not load. Your saved analysis is preserved.');
    let settings=store.getPane(paneId,initialMarket,initialInterval),market=settings.market,interval=settings.interval;
    let chart=null,series=null,primitive=null,unsubscribe=null,bars=[],disposed=false,restoring=false,interacted=false,firstPoint=null,tool='cursor';
    const indicatorSeries=new Map();let lastListKey=null;
    host.innerHTML=`<div class="native-analysis-tools" role="group" aria-label="Saved chart analysis tools">
      <label>Instrument<select data-native-market aria-label="Saved analysis instrument">${Object.entries(F.marketLabels).map(([key,label])=>`<option value="${key}" ${market===key?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Timeframe<select data-native-interval aria-label="Saved analysis timeframe">${A.intervals.map(tf=>`<option value="${tf}" ${interval===tf?'selected':''}>${tf==='D'?'D1':Number(tf)<60?'M'+tf:'H'+Number(tf)/60}</option>`).join('')}</select></label>
      <label>Colour<input type="color" value="#a78bfa" data-native-color aria-label="Analysis colour"></label>
      <div class="native-drawing-tools">${[['cursor','Move'],['level','Level'],['trend','Trend line'],['rectangle','Zone'],['text','Note']].map(([id,label])=>`<button type="button" class="btn small" data-native-tool="${id}" aria-pressed="${id==='cursor'}">${label}</button>`).join('')}</div>
      <label class="native-note-input" hidden>Note<input data-native-note maxlength="240" placeholder="Write your analysis, then click the chart" aria-label="Chart note"></label>
      <div class="native-indicator-controls"><label>Indicator<select data-native-indicator aria-label="Indicator type"><option value="sma">SMA</option><option value="ema">EMA</option></select></label><label>Period<input type="number" min="2" max="500" value="20" data-native-period aria-label="Indicator period"></label><button type="button" class="btn small" data-native-add-indicator>Add</button></div>
    </div>
    <p class="native-analysis-hint" data-native-hint role="status">Select a drawing tool, then click the chart. Every change is saved automatically.</p>
    <div class="native-chart-surface" data-native-surface aria-label="Native candlestick chart"></div>
    <div class="native-chart-source"><span data-native-feed-status role="status">Loading real Deriv candles…</span><button type="button" class="btn small" data-native-earlier>Load earlier candles</button><button type="button" class="btn small" data-native-retry>Retry data</button><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Lightweight Charts™ by TradingView</a></div>
    <details class="native-analysis-items"><summary data-native-summary>Saved analysis</summary><div data-native-items></div></details>`;
    const $=s=>host.querySelector(s),hint=text=>{$('[data-native-hint]').textContent=text;};
    const currentContext=()=>store.getContext(paneId,market);
    function operation(op){try{store.change({pane:paneId,market,...op});return true;}catch(error){hint(error.message);return false;}}
    function updateAnalysis(){
      if(disposed||!chart)return;
      const p=store.getPane(paneId,initialMarket,initialInterval);
      if(p.market!==market||p.interval!==interval){
        market=p.market;interval=p.interval;$('[data-native-market]').value=market;$('[data-native-interval]').value=interval;
        firstPoint=null;connect();return;
      }
      const c=currentContext();primitive.set(c.drawings);
      const ids=new Set(c.indicators.map(i=>i.id));
      for(const [id,line] of indicatorSeries)if(!ids.has(id)){chart.removeSeries(line);indicatorSeries.delete(id);}
      for(const i of c.indicators){
        let line=indicatorSeries.get(i.id);
        if(!line){line=chart.addSeries(chartLibrary.LineSeries,{color:i.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:i.type.toUpperCase()+' '+i.period});indicatorSeries.set(i.id,line);}
        line.setData(A.movingAverage(bars,i.type,i.period));
      }
      const listKey=JSON.stringify([market,c.drawings,c.indicators]);if(listKey===lastListKey)return;lastListKey=listKey;
      $('[data-native-summary]').textContent='Saved analysis · '+c.drawings.length+' drawing'+(c.drawings.length===1?'':'s')+' · '+c.indicators.length+' indicator'+(c.indicators.length===1?'':'s');
      const list=$('[data-native-items]');list.replaceChildren();
      for(const [kind,items] of [['drawing',c.drawings],['indicator',c.indicators]])for(const item of items){
        const row=document.createElement('div');row.className='native-analysis-item';
        const name=document.createElement('span');name.textContent=kind==='drawing'?(item.type==='text'?item.text:item.type==='level'?'Level · '+item.points[0].price:item.type==='trend'?'Trend line':'Zone'):item.type.toUpperCase()+' '+item.period;
        const button=document.createElement('button');button.type='button';button.className='btn small';button.textContent='Remove';button.dataset.nativeRemove=kind;button.dataset.itemId=item.id;button.setAttribute('aria-label','Remove '+name.textContent);
        row.append(name,button);list.appendChild(row);
      }
      if(!list.children.length)list.textContent='No analysis added to this instrument yet.';
    }
    function point(param){
      if(!param.point||!Number.isSafeInteger(param.time))return null;
      const price=series.coordinateToPrice(param.point.y);
      return Number.isFinite(price)&&price>0?{time:param.time,price}:null;
    }
    function setTool(value){
      tool=value;firstPoint=null;primitive?.set(currentContext().drawings);
      host.querySelectorAll('[data-native-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.nativeTool===tool)));
      $('.native-note-input').hidden=tool!=='text';
      chart?.applyOptions({handleScroll:tool==='cursor',handleScale:tool==='cursor'});
      hint(tool==='cursor'?'Move and zoom the chart. Analysis stays until you remove it.':tool==='text'?'Write a note, then click a candle to place it.':['trend','rectangle'].includes(tool)?'Click the first point, then the second point.':'Click the chart to place a price level.');
    }
    function clicked(param){
      if(tool==='cursor'||disposed)return;
      const p=point(param);if(!p){hint('Choose a point over the loaded candles.');return;}
      let points=[p];
      if(['trend','rectangle'].includes(tool)){
        if(!firstPoint){firstPoint=p;hint('Click the second point to finish.');return;}
        points=[firstPoint,p];
      }
      const text=tool==='text'?$('[data-native-note]').value.trim():'';
      if(tool==='text'&&!text){hint('Write a note before placing it.');return;}
      const drawing={id:crypto.randomUUID(),type:tool,points,color:$('[data-native-color]').value,text};
      if(operation({type:'add-drawing',value:drawing})){firstPoint=null;setTool('cursor');updateAnalysis();}
    }
    function preview(param){
      if(!firstPoint||!['trend','rectangle'].includes(tool))return;
      const p=point(param);if(p)primitive.set(currentContext().drawings,{id:'preview',type:tool,points:[firstPoint,p],color:$('[data-native-color]').value,text:''});
    }
    function saveView(range){
      if(disposed||restoring||!interacted||!range||!Number.isFinite(range.from)||!Number.isFinite(range.to))return;
      const value={from:Math.round(range.from),to:Math.round(range.to)};
      if(value.to<=value.from||JSON.stringify(currentContext().views[interval])===JSON.stringify(value))return;
      operation({type:'view',interval,value});
    }
    function connect(){
      unsubscribe?.();bars=[];series.setData([]);updateAnalysis();interacted=false;
      const savedContext=currentContext(),view=savedContext.views[interval];
      const required=[...(view?[view.from]:[]),...savedContext.drawings.filter(d=>d.type!=='level').flatMap(d=>d.points.map(p=>p.time))];
      unsubscribe=feed.subscribe(market,interval,result=>{
        if(disposed)return;
        $('[data-native-feed-status]').textContent=result.message;
        $('[data-native-retry]').hidden=!['error','stale'].includes(result.status);
        if(!result.bars.length)return;
        const first=!bars.length;bars=result.bars;restoring=true;
        try{
          series.setData(bars);updateAnalysis();
          if(!interacted&&view&&(first||bars[0].time<=view.from))chart.timeScale().setVisibleRange(view);
          else if(first)chart.timeScale().fitContent();
        }finally{restoring=false;}
      },required.length?Math.min(...required):null);
    }
    const surface=$('[data-native-surface]'),light=theme==='light';
    chart=chartLibrary.createChart(surface,{autoSize:true,layout:{background:{type:'solid',color:light?'#ffffff':'#131722'},textColor:light?'#394155':'#b6c2d4',attributionLogo:true},grid:{vertLines:{color:light?'#edf0f5':'#222c3c'},horzLines:{color:light?'#edf0f5':'#222c3c'}},timeScale:{timeVisible:true,secondsVisible:false},localization:{locale:'en-US'},rightPriceScale:{borderColor:'#334155'}});
    series=chart.addSeries(chartLibrary.CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350',priceFormat:{type:'price',precision:4,minMove:.0001}});
    primitive=new Drawings();series.attachPrimitive(primitive);
    chart.subscribeClick(clicked);chart.subscribeCrosshairMove(preview);chart.timeScale().subscribeVisibleTimeRangeChange(saveView);
    for(const type of ['pointerdown','wheel','touchstart','keydown'])surface.addEventListener(type,()=>{interacted=true;},{passive:true});
    host.addEventListener('click',event=>{
      if(disposed)return;
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.nativeTool)setTool(button.dataset.nativeTool);
      if(button.hasAttribute('data-native-add-indicator')){
        const period=Number($('[data-native-period]').value);
        if(!Number.isInteger(period)||period<2||period>500){hint('Choose an indicator period from 2 to 500.');return;}
        if(operation({type:'add-indicator',value:{id:crypto.randomUUID(),type:$('[data-native-indicator]').value,period,color:$('[data-native-color]').value}}))updateAnalysis();
      }
      if(button.dataset.nativeRemove&&operation({type:'remove-'+button.dataset.nativeRemove,item:button.dataset.itemId}))updateAnalysis();
      if(button.hasAttribute('data-native-retry'))connect();
      if(button.hasAttribute('data-native-earlier'))feed.loadEarlier(market,interval);
    });
    host.addEventListener('change',event=>{
      if(disposed||!event.target.matches('[data-native-market],[data-native-interval]'))return;
      const nextMarket=$('[data-native-market]').value,nextInterval=$('[data-native-interval]').value;
      if(operation({type:'settings',value:{market:nextMarket,interval:nextInterval}})){setTool('cursor');updateAnalysis();}
    });
    updateAnalysis();connect();
    return {update:updateAnalysis,settings:()=>({market,interval}),dispose(){if(disposed)return;disposed=true;unsubscribe?.();chart.remove();indicatorSeries.clear();}};
  }};
})();
