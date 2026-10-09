/* Presentation-only ecosystem overview. No personal intelligence is inferred. */
(function(){
  'use strict';
  const root=document.getElementById('hiosOperationLoop');
  if(!root)return;
  const scenes=[...root.querySelectorAll('[data-op-scene]')];
  const dots=[...root.querySelectorAll('[data-op-dot]')];
  const toggle=root.querySelector('.hios-op-toggle');
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let current=0,timer=null,paused=false,hovered=false,focused=false;
  function syncTimer(){
    clearInterval(timer);timer=null;
    const stopped=paused||hovered||focused||motion.matches||document.hidden||!root.getClientRects().length;
    root.dataset.paused=String(stopped);
    if(!stopped)timer=setInterval(()=>showScene(current+1),4200);
  }
  function showScene(index){
    current=(index+scenes.length)%scenes.length;
    scenes.forEach((scene,i)=>{
      scene.classList.toggle('active',i===current);
      scene.setAttribute('aria-hidden',String(i!==current));
      scene.inert=i!==current;
    });
    dots.forEach((dot,i)=>{
      dot.classList.toggle('active',i===current);
      dot.setAttribute('aria-pressed',String(i===current));
    });
  }
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>{showScene(i);syncTimer()}));
  toggle.addEventListener('click',()=>{
    paused=!paused;
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.setAttribute('aria-label',paused?'Resume animation':'Pause animation');
    toggle.title=paused?'Resume animation':'Pause animation';
    toggle.textContent=paused?'▶':'Ⅱ';
    syncTimer();
  });
  root.addEventListener('mouseenter',()=>{hovered=true;syncTimer()});
  root.addEventListener('mouseleave',()=>{hovered=false;syncTimer()});
  root.addEventListener('focusin',()=>{focused=true;syncTimer()});
  root.addEventListener('focusout',event=>{focused=root.contains(event.relatedTarget);syncTimer()});
  document.addEventListener('visibilitychange',syncTimer);
  window.addEventListener('resize',syncTimer);
  motion.addEventListener('change',syncTimer);
  const app=document.getElementById('appScreen');
  if(app)new MutationObserver(syncTimer).observe(app,{attributes:true,attributeFilter:['class']});
  showScene(0);syncTimer();
})();
