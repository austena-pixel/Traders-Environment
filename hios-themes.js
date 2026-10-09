/* Shared, device-local appearance preference. Existing data and authored content
   are untouched; theme colors are applied to the site's stylesheets only. */
(function(){
  'use strict';
  const KEY='hios_color_theme_v1';
  const root=document.documentElement;
  const themes=[
    {id:'blue',name:'Original Blue',description:'The current blue and violet style.',base:[218,.25],primary:[216,.9],secondary:[260,.8],bg:'#07090d',surface:'#111927',accent:'#6ea8ff',accent2:'#8b5cf6'},
    {id:'graphite',name:'Graphite',description:'Charcoal surfaces with soft silver accents.',base:[0,0],primary:[0,0],secondary:[30,.06],bg:'#0b0b0b',surface:'#1b1b1b',accent:'#c5c5c5',accent2:'#a9a39b'},
    {id:'forest',name:'Forest',description:'Deep green surfaces with mint and gold.',base:[155,.25],primary:[156,.5],secondary:[40,.54],bg:'#080e0b',surface:'#15231d',accent:'#8cdbba',accent2:'#ddc18e'},
    {id:'sand',name:'Warm Sand',description:'Warm brown surfaces with gold and copper.',base:[31,.25],primary:[36,.67],secondary:[17,.42],bg:'#100d09',surface:'#241d15',accent:'#e7c98c',accent2:'#ceaa9b'},
    {id:'amethyst',name:'Amethyst',description:'Plum surfaces with lavender and rose.',base:[276,.24],primary:[274,.7],secondary:[327,.55],bg:'#0e0a12',surface:'#201728',accent:'#c6a0ec',accent2:'#dda4c3'}
  ];
  const colors=new Map(),seenRules=new WeakSet();
  let current='blue',persistent=true,dialog=null,opener=null;
  try{const saved=localStorage.getItem(KEY);if(themes.some(t=>t.id===saved))current=saved}catch{persistent=false}

  function parseColor(value){
    let channels;
    if(value[0]==='#'){
      let hex=value.slice(1);if(hex.length===3||hex.length===4)hex=[...hex].map(c=>c+c).join('');
      channels=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
      channels.push(hex.length===8?parseInt(hex.slice(6),16)/255:1);
    }else{
      const parts=value.slice(value.indexOf('(')+1,-1).trim().split(/[\s,\/]+/);
      if(parts.length<3||parts.length>4||parts.some(p=>!/^\d*\.?\d+%?$/.test(p)))return null;
      channels=parts.slice(0,3).map(p=>parseFloat(p)/(p.endsWith('%')?100:255));
      channels.push(parts[3]?parseFloat(parts[3])/(parts[3].endsWith('%')?100:1):1);
    }
    const [r,g,b,alpha]=channels,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,light=(max+min)/2;
    let hue=0,saturation=0;
    if(d){saturation=d/(1-Math.abs(2*light-1));hue=60*(max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4)}
    // Preserve black shadows, white, and semantic red/amber/green colors.
    if(light===0||light>=.985)return null;
    const cool=hue>=180&&hue<=300;
    if(saturation>.18&&!cool)return null;
    const slot=light<=.32?'base':saturation<=.18?'text':hue>=255?'secondary':'primary';
    return {hue,saturation,light,alpha,slot};
  }
  function token(value){
    const color=parseColor(value);if(!color)return value;
    const key=value.toLowerCase();
    if(!colors.has(key))colors.set(key,{...color,name:'--hios-color-'+colors.size});
    return `var(${colors.get(key).name}, ${value})`;
  }
  function bridgeRules(rules){
    for(const rule of rules){
      if(rule.style&&!seenRules.has(rule)){
        seenRules.add(rule);
        // A shorthand containing var() can expose empty longhands in CSSOM.
        // Read those shorthands directly before visiting the remaining properties.
        const properties=new Set(['background','border','border-top','border-right','border-bottom','border-left','outline',...rule.style]);
        for(const property of properties){
          if(!property.startsWith('--')&&!/^(color|background|border|outline|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|scrollbar-color)/.test(property))continue;
          const value=rule.style.getPropertyValue(property);
          if(value.includes('url(')||value.includes('--hios-'))continue;
          const themed=value.replace(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|rgba?\([^()]*\)/gi,token);
          if(themed!==value)rule.style.setProperty(property,themed,rule.style.getPropertyPriority(property));
        }
      }
      if(rule.cssRules)bridgeRules(rule.cssRules);
    }
  }
  function bridgeStyles(){
    for(const sheet of document.styleSheets){
      if(sheet.ownerNode?.hasAttribute('data-hios-theme-sheet'))continue;
      let rules;
      try{rules=sheet.cssRules}catch{continue}
      bridgeRules(rules);
    }
  }
  function apply(id,save=false){
    const theme=themes.find(t=>t.id===id);if(!theme)return;
    current=id;root.dataset.hiosTheme=id;
    for(const color of colors.values()){
      if(id==='blue'){root.style.removeProperty(color.name);continue}
      const [h,s]=color.slot==='text'?[theme.base[0],Math.min(theme.base[1],.08)]:theme[color.slot];
      root.style.setProperty(color.name,`hsl(${h} ${(s*100).toFixed(2)}% ${(color.light*100).toFixed(2)}% / ${color.alpha})`);
    }
    for(const key of ['bg','surface','accent','accent2'])root.style.setProperty('--hios-theme-'+key,theme[key]);
    root.style.setProperty('--hios-theme-line',id==='blue'?'#34435a':`hsl(${theme.base[0]} ${theme.base[1]*100}% 27%)`);
    if(save){try{localStorage.setItem(KEY,id);persistent=true}catch{persistent=false}}
    document.querySelectorAll('.hios-theme-button').forEach(button=>{button.title='Color theme: '+theme.name});
    if(dialog){
      dialog.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===id)));
      dialog.querySelector('.hios-theme-save-status').textContent=persistent?'Saved for this browser. Used across the H-IOS family.':'Theme applies for this visit. Browser storage is unavailable.';
    }
    let meta=document.querySelector('meta[name="theme-color"]');
    if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta)}
    meta.content=id==='blue'?getComputedStyle(root).getPropertyValue('--bg').trim():theme.bg;
  }
  bridgeStyles();apply(current);
  function open(button){opener=button;apply(current);if(!dialog.open)dialog.showModal()}
  function makeButton(){
    const button=document.createElement('button');button.type='button';button.className='hios-theme-button';button.setAttribute('aria-label','Change color theme');button.setAttribute('aria-haspopup','dialog');
    button.innerHTML='<span class="hios-theme-swatch" aria-hidden="true"></span><span>Theme</span>';
    button.addEventListener('click',()=>open(button));return button;
  }
  function mount(){
    bridgeStyles();
    dialog=document.createElement('dialog');dialog.className='hios-theme-dialog';dialog.setAttribute('aria-labelledby','hiosThemeTitle');
    dialog.innerHTML='<div class="hios-theme-heading"><div><h2 id="hiosThemeTitle">Color theme</h2><p>Choose the style of your H-IOS environment.</p></div><button class="hios-theme-close" type="button" aria-label="Close color themes" autofocus>×</button></div><div class="hios-theme-choices">'+themes.map(t=>`<button class="hios-theme-choice" type="button" data-theme-choice="${t.id}" aria-pressed="false"><span class="hios-theme-preview" aria-hidden="true" style="--preview-bg:${t.bg};--preview-surface:${t.surface};--preview-accent:${t.accent};--preview-accent2:${t.accent2}"><i></i><i></i><i></i></span><span><b>${t.name}</b><small>${t.description}</small></span><span class="hios-theme-selected" aria-hidden="true">✓</span></button>`).join('')+'</div><div class="hios-theme-footer"><p class="hios-theme-save-status" role="status"></p><button class="hios-theme-done" type="button">Done</button></div>';
    document.body.append(dialog);
    dialog.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>apply(button.dataset.themeChoice,true)));
    dialog.querySelectorAll('.hios-theme-close,.hios-theme-done').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('close',()=>{if(opener?.isConnected&&opener.getClientRects().length)opener.focus()});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close()}});
    const footer=document.querySelector('.sidebar .side-foot,.sidebar .sidebar-footer,.sidebar .nav-note,.sidebar .sidebar-bottom');
    if(footer){
      const entry=document.createElement('div');entry.className='hios-theme-entry';entry.append(makeButton());footer.prepend(entry);
      const mobile=document.querySelector('.mobile-top')||document.querySelector('.sidebar-bottom')&&document.querySelector('.topline');
      if(mobile){const move=()=>{(innerWidth<=950?mobile:footer).prepend(entry)};window.addEventListener('resize',move);move()}
    }
    const auth=document.getElementById('authScreen');if(auth){const button=makeButton();button.classList.add('hios-theme-auth');auth.append(button)}
    apply(current);
    // Theme newly inserted app styles; authored inline document colors are never rewritten.
    const observer=new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches('style,link[rel="stylesheet"]')||node.querySelector('style,link[rel="stylesheet"]'))))){bridgeStyles();apply(current)}});
    observer.observe(document.head,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  document.addEventListener('load',event=>{if(event.target?.matches?.('link[rel="stylesheet"]')){bridgeStyles();apply(current)}},true);
  window.addEventListener('storage',event=>{if(event.key===KEY)apply(themes.some(t=>t.id===event.newValue)?event.newValue:'blue')});
})();
