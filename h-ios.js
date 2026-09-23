(function(){
  'use strict';

  var STORAGE_KEY = 'hios_auto_zoom_enabled_v1';
  var enabled = false;
  var activePanel = '';
  var focusClasses = ['hios-focus-b','hios-focus-c'];
  var activeDay = null;

  function getLayout(){ return document.querySelector('.home-layout'); }

  function clearFocus(){
    var layout=getLayout();
    if(!layout)return;
    focusClasses.forEach(function(name){layout.classList.remove(name)});
    layout.setAttribute('data-focus-panel','');
    activePanel='';
  }

  function applyFocus(panel){
    var layout=getLayout();
    if(!layout)return;
    if(!enabled||window.innerWidth<900||!['b','c'].includes(panel)){
      clearFocus();
      return;
    }
    focusClasses.forEach(function(name){layout.classList.remove(name)});
    layout.classList.add('hios-focus-'+panel);
    layout.setAttribute('data-focus-panel',panel);
    activePanel=panel;
  }

  function clearCalendarDay(){
    if(activeDay)activeDay.classList.remove('hios-day-hover');
    activeDay=null;
  }

  function activateCalendarDay(day){
    if(!day||!enabled||window.innerWidth<900){clearCalendarDay();return}
    if(activeDay===day)return;
    clearCalendarDay();
    activeDay=day;
    day.classList.add('hios-day-hover');
  }

  function paintToggle(){
    var toggle=document.getElementById('autoZoomToggle');
    var state=document.getElementById('autoZoomState');
    var layout=getLayout();
    if(layout)layout.classList.toggle('auto-zoom-enabled',enabled);
    if(toggle){
      toggle.classList.toggle('is-on',enabled);
      toggle.setAttribute('aria-pressed',enabled?'true':'false');
      toggle.setAttribute('title',enabled?'Auto Zoom is on.':'Auto Zoom is off. Click to turn it on.');
    }
    if(state)state.textContent=enabled?'On':'Off';
  }

  function savePreference(){
    try{localStorage.setItem(STORAGE_KEY,enabled?'1':'0')}catch(error){}
  }

  function setEnabled(value,persist){
    enabled=!!value;
    paintToggle();
    if(!enabled){clearFocus();clearCalendarDay()}
    if(persist!==false)savePreference();
  }

  function bind(){
    var layout=getLayout();
    var toggle=document.getElementById('autoZoomToggle');
    var calendar=document.getElementById('hiosCalendar');
    if(!layout||!toggle)return;

    try{enabled=localStorage.getItem(STORAGE_KEY)==='1'}catch(error){enabled=false}
    setEnabled(enabled,false);

    toggle.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      setEnabled(!enabled,true);
      /* Do not auto-focus B when enabling. A panel zooms only while the pointer
         is actually inside that panel. */
      clearFocus();
    });

    ['b','c'].forEach(function(key){
      var panel=document.querySelector('[data-home-panel="'+key+'"]');
      if(!panel)return;
      panel.addEventListener('pointerenter',function(){if(enabled)applyFocus(key)});
      panel.addEventListener('pointermove',function(){if(enabled&&activePanel!==key)applyFocus(key)});
      panel.addEventListener('pointerleave',function(){
        if(activePanel===key)clearFocus();
      });
    });

    if(calendar){
      /* Pointer-bound zoom. The enlarged day remains active only while the
         pointer is actually over that day (including its task scrollbar).
         This also preserves native scrolling inside .calendar-events. */
      calendar.addEventListener('pointerover',function(event){
        if(!enabled||window.innerWidth<900)return;
        var day=event.target&&event.target.closest?event.target.closest('.calendar-day'):null;
        if(!day)return;
        var from=event.relatedTarget;
        if(!from||!day.contains(from))activateCalendarDay(day);
      });
      calendar.addEventListener('pointerout',function(event){
        var day=event.target&&event.target.closest?event.target.closest('.calendar-day'):null;
        if(!day||day!==activeDay)return;
        var to=event.relatedTarget;
        if(to&&day.contains(to))return;
        clearCalendarDay();
      });
      calendar.addEventListener('pointerleave',clearCalendarDay);
    }

    /* Safety reset: a zoom can never remain stuck after the pointer has left. */
    document.addEventListener('pointermove',function(){
      if(activeDay&&typeof activeDay.matches==='function'&&!activeDay.matches(':hover'))clearCalendarDay();
    },{passive:true});

    window.addEventListener('blur',function(){clearFocus();clearCalendarDay()});
    window.addEventListener('resize',function(){
      if(window.innerWidth<900){clearFocus();clearCalendarDay()}
    });

    window.hiosAutoZoom={
      isEnabled:function(){return enabled},
      setEnabled:function(value){setEnabled(value,true)},
      focus:function(panel){applyFocus(panel)},
      reset:function(){clearFocus();clearCalendarDay()}
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();

/* SAME SUPABASE AUTH PROJECT USED BY Traders-IOS */
const SUPABASE_URL = "https://tmxosoyqflmwqzjgnkez.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_meHq49fLyw8PVNPZxWacnw_SQMj5B-h";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);


/* =========================================================
   H·IOS PRODUCT MANAGER
   Products are stored locally for this browser.
   Only products that have been added appear in the sidebar.
========================================================= */
const HIOS_PRODUCT_CATALOG = window.HIOSProductRegistry.getAll();
let addedProductIds = window.HIOSProductState.list();

function loadAddedProducts(){
  return window.HIOSProductState.list();
}

function saveAddedProducts(){
  addedProductIds=window.HIOSProductState.save(addedProductIds);
}

function isProductAdded(id){
  return addedProductIds.includes(id);
}

function addProduct(id){
  addedProductIds=window.HIOSProductState.add(id);
  renderProductManager();
}

function removeProduct(id){
  addedProductIds=window.HIOSProductState.remove(id);
  renderProductManager();
}

function toggleProduct(id){
  if(isProductAdded(id))removeProduct(id);
  else addProduct(id);
}

function openProduct(id){
  const product = HIOS_PRODUCT_CATALOG.find(item => item.id === id);
  if(!product) return;

  if(!isProductAdded(id)){
    openProductModal();
    return;
  }

  if(product.url){
    window.location.href = product.url;
    return;
  }

  showMessage(product.name, product.name + ' is added to H·IOS, but its dedicated product page has not been built yet.');
}

function renderProductManager(){
  const sidebar = document.getElementById('productSidebarNav');
  const grid = document.getElementById('productsGrid');
  const catalog = document.getElementById('productCatalogList');
  const connectedCount = document.getElementById('connectedProductsCount');

  if(connectedCount){
    connectedCount.textContent = addedProductIds.length;
  }

  if(sidebar){
    const addedProducts = HIOS_PRODUCT_CATALOG.filter(product => isProductAdded(product.id));

    sidebar.innerHTML = addedProducts.length
      ? addedProducts.map(product => `
          <button type="button" onclick="openProduct('${product.id}')">
            <span class="product-nav-icon">${product.icon}</span>
            <span>${product.name}</span>
          </button>
        `).join('')
      : `<div class="product-nav-empty">No products added yet.<br>Use <b>Add Product</b> to build your workspace.</div>`;
  }

  if(grid){
    grid.innerHTML = HIOS_PRODUCT_CATALOG.map(product => {
      const added = isProductAdded(product.id);
      return `
        <div class="product">
          <div class="picon">${product.icon}</div>
          <h4>${product.name}</h4>
          <p>${product.description}</p>
          <span class="status ${added ? 'added' : 'not-added'}">
            ${added ? 'Added to H·IOS' : product.availability}
          </span>

          <div class="product-actions">
            ${
              added
                ? `<button class="product-action primary-action" type="button" onclick="openProduct('${product.id}')">Open</button>
                   <button class="product-action remove-action" type="button" onclick="removeProduct('${product.id}')">Remove</button>`
                : `<button class="product-action primary-action" type="button" onclick="addProduct('${product.id}')">Add Product</button>`
            }
          </div>
        </div>
      `;
    }).join('');
  }

  if(catalog){
    catalog.innerHTML = HIOS_PRODUCT_CATALOG.map(product => {
      const added = isProductAdded(product.id);
      return `
        <div class="catalog-item">
          <div class="catalog-icon">${product.icon}</div>
          <div>
            <h4>${product.name}</h4>
            <p>${product.description}</p>
          </div>
          <div class="catalog-actions">
            ${added && product.url ? `<button type="button" onclick="openProduct('${product.id}')">Open</button>` : ''}
            <button
              type="button"
              class="${added ? 'added' : ''}"
              onclick="toggleProduct('${product.id}')"
            >${added ? 'Remove' : 'Add'}</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function openProductModal(){
  renderProductManager();
  document.getElementById('productModal').classList.add('show');
}

function closeProductModal(){
  document.getElementById('productModal').classList.remove('show');
}

document.getElementById('productModal').addEventListener('click', event => {
  if(event.target.id === 'productModal') closeProductModal();
});

document.addEventListener('keydown', event => {
  if(event.key === 'Escape') closeProductModal();
});

renderProductManager();

/* =========================================================
   H·IOS HOME INTELLIGENCE + Goals-IOS CALENDAR BRIDGE
   H·IOS consumes goal data and sends change requests through the gateway.
========================================================= */
const HIOS_GIOS_GOALS_KEY = 'hios_gios_goals_v2';
const HIOS_GIOS_LEGACY_KEYS = ['hios_gios_goals_v1','gios_standalone_goals_v1'];
const HIOS_GIOS_SNAPSHOT_KEY = 'hios_gios_dashboard_v1';
const HIOS_GIOS_FOCUS_AREAS_KEY = 'hios_gios_focus_areas_v1';
const HIOS_CALENDAR_EVENTS_KEY = 'hios_calendar_events_v1';
const hiosBridge=window.HIOSConnectionLayer.connect('h-ios');

function pendingGoalRequests(){
  return hiosBridge.getPendingRequests().filter(request=>
    request?.source==='h-ios'&&String(request?.type||'').endsWith('.requested')
  );
}

function pendingGoalIds(mode='any'){
  const requests=pendingGoalRequests().filter(request=>{
    if(mode==='delete')return request.type.includes('.delete.');
    if(mode==='calendar')return request.type.includes('.calendar.remove.');
    return true;
  });
  return new Set(requests.map(request=>String(request.payload?.goalId||'')).filter(Boolean));
}

let hiosCalendarCursor = new Date();
hiosCalendarCursor = new Date(
  hiosCalendarCursor.getFullYear(),
  hiosCalendarCursor.getMonth(),
  1
);

function hiosEscape(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function loadHiosGoals(){
  try{
    let goals=hiosBridge.readGoals();
    if(!goals.length){
      let raw='';
      for(const key of HIOS_GIOS_LEGACY_KEYS){
        const legacy=localStorage.getItem(key);
        if(legacy){raw=legacy;break;}
      }
      const parsed=raw?JSON.parse(raw):[];
      goals=Array.isArray(parsed)?parsed:[];
    }
    const snapshot=hiosBridge.readSnapshot();
    const snapshotGoals=Array.isArray(snapshot?.goals)?snapshot.goals:[];
    const progressById=new Map(snapshotGoals.map(goal=>[goal.id,Number(goal.progress??goal.manualProgress??0)]));
    return goals.map(goal=>({
      ...goal,
      progress:progressById.has(goal.id)
        ? progressById.get(goal.id)
        : Number(goal.progress??goal.manualProgress??0)
    }));
  }catch(error){
    console.warn('Could not read Goals-IOS goals for H·IOS:',error);
    return [];
  }
}

function loadHiosSnapshot(){
  return hiosBridge.readSnapshot()||{
    domainProgress:[],
    focusItems:[],
    activeGoals:0,
    highPriority:0
  };
}

function loadHiosFocusAreas(){
  try{
    const parsed=JSON.parse(localStorage.getItem(HIOS_GIOS_FOCUS_AREAS_KEY)||'[]');
    if(!Array.isArray(parsed))return [];
    const seen=new Set();
    return parsed
      .map(area=>String(area||'').trim())
      .filter(area=>area&&!seen.has(area.toLowerCase())&&seen.add(area.toLowerCase()));
  }catch(error){
    return [];
  }
}

function loadHiosCalendarEvents(){
  try{
    const raw=localStorage.getItem(HIOS_CALENDAR_EVENTS_KEY);
    const parsed=raw?JSON.parse(raw):[];
    return Array.isArray(parsed)?parsed:[];
  }catch(error){
    console.warn('Could not read H·IOS calendar items:',error);
    return [];
  }
}

function saveHiosCalendarEvents(events){
  localStorage.setItem(HIOS_CALENDAR_EVENTS_KEY,JSON.stringify(events));
}

function parseHiosDate(value){
  if(!value)return null;
  const parts=String(value).split('-').map(Number);
  if(parts.length!==3||parts.some(v=>!Number.isFinite(v)))return null;
  return new Date(parts[0],parts[1]-1,parts[2]);
}

function hiosDateKey(date){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function hiosEventTypeLabel(type){
  const labels={
    due:'Due',
    test:'Test',
    assessment:'Assessment',
    assignment:'Assignment',
    milestone:'Milestone',
    appointment:'Appointment',
    other:'Event'
  };
  return labels[type]||'Event';
}

function allHiosDatedCommitments(){
  const pending=pendingGoalIds('any');
  const goalItems=loadHiosGoals()
    .filter(goal=>
      goal.targetDate&&
      Number(goal.progress??goal.manualProgress??0)<100&&
      !pending.has(String(goal.id))
    )
    .map(goal=>({
      id:`goal_${goal.id}`,
      title:goal.title,
      date:goal.targetDate,
      type:'goal',
      domain:goal.domain||'Goals-IOS',
      source:'gios'
    }));

  const manualItems=loadHiosCalendarEvents().map(event=>({
    ...event,
    source:'hios'
  }));

  return [...goalItems,...manualItems];
}

function hiosDeadlineText(value){
  const date=parseHiosDate(value);
  if(!date)return 'no deadline';
  const today=new Date();
  today.setHours(0,0,0,0);
  const days=Math.round((date-today)/86400000);
  if(days<0)return `${Math.abs(days)}d overdue`;
  if(days===0)return 'due today';
  if(days===1)return 'due tomorrow';
  if(days<=30)return `due in ${days}d`;
  return date.toLocaleDateString(undefined,{day:'numeric',month:'short'});
}

function isHiosTodayDailyTask(goal,todayKey=hiosDateKey(new Date())){
  const level=String(goal?.level||goal?.horizon||'').toLowerCase();
  return level==='daily'&&(
    goal?.targetDate===todayKey||
    goal?.periodKey===todayKey
  );
}

function renderGoalsDashboardViews(){
  const snapshot=loadHiosSnapshot();
  const goals=loadHiosGoals();
  const goalsById=new Map(goals.map(goal=>[String(goal.id),goal]));
  const pendingDeletes=pendingGoalIds('delete');
  const progressRoot=document.getElementById('hiosGoalProgressList');
  const focusRoot=document.getElementById('hiosFocusList');

  const snapshotAreas=Array.isArray(snapshot.focusAreas)?snapshot.focusAreas:[];
  const activeAreas=(snapshotAreas.length?snapshotAreas:loadHiosFocusAreas())
    .map(area=>String(area||'').trim())
    .filter(Boolean);
  const progressByArea=new Map(
    (Array.isArray(snapshot.domainProgress)?snapshot.domainProgress:[])
      .map(item=>[String(item.domain||'').toLowerCase(),item])
  );
  const todayKey=hiosDateKey(new Date());
  const domainProgress=activeAreas.map(domain=>{
    const snapshotItem=progressByArea.get(domain.toLowerCase());
    if(snapshotItem&&snapshotItem.date===todayKey)return {...snapshotItem,domain};
    const tasks=goals.filter(goal=>
      String(goal.level||goal.horizon||'')==='daily'&&
      String(goal.domain||'').toLowerCase()===domain.toLowerCase()&&
      (goal.targetDate===todayKey||goal.periodKey===todayKey)
    );
    const completed=tasks.filter(goal=>Number(goal.progress??goal.manualProgress??0)>=100).length;
    return {
      domain,
      completed,
      expected:tasks.length,
      progress:tasks.length?Math.round((completed/tasks.length)*100):0,
      measure:'daily-expected'
    };
  });

  if(progressRoot){
    progressRoot.innerHTML=domainProgress.length
      ? domainProgress.map(item=>{
          const progress=Math.max(0,Math.min(100,Number(item.progress)||0));
          const expected=Math.max(0,Number(item.expected)||0);
          const completed=Math.max(0,Math.min(expected,Number(item.completed)||0));
          const detail=expected?`${completed} of ${expected} done today`:'No tasks expected today';
          return `<div class="goal-row"><div class="goal-head"><span class="goal-area-copy"><span>${hiosEscape(item.domain)}</span><small>${hiosEscape(detail)}</small></span><b>${progress}%</b></div><div class="bar"><span style="width:${progress}%"></span></div></div>`;
        }).join('')
      : '<div class="sub" style="margin-top:12px">Add a Goals-IOS category to begin daily progress tracking.</div>';
  }

  let focusItems=(Array.isArray(snapshot.focusItems)?snapshot.focusItems:[]).filter(item=>{
    const id=String(item.id||'');
    const goal=goalsById.get(id);
    return goal&&
      isHiosTodayDailyTask(goal,todayKey)&&
      Number(goal.progress??goal.manualProgress??0)<100&&
      !pendingDeletes.has(id);
  });
  if(!focusItems.length&&goals.length){
    focusItems=goals
      .filter(goal=>
        isHiosTodayDailyTask(goal,todayKey)&&
        Number(goal.progress??goal.manualProgress??0)<100&&
        !pendingDeletes.has(String(goal.id||''))
      )
      .sort((a,b)=>{
        const priority={high:3,medium:2,low:1};
        return (priority[String(b.priority||'').toLowerCase()]||0)-
          (priority[String(a.priority||'').toLowerCase()]||0);
      })
      .slice(0,6)
      .map((goal,index)=>({...goal,rank:index+1,urgency:goal.priority==='high'?'High':'Maintain'}));
  }

  if(focusRoot){
    focusRoot.innerHTML=focusItems.length
      ? focusItems.slice(0,6).map((item,index)=>{
          const urgency=item.urgency||'Maintain';
          const high=/high/i.test(urgency)?' high':'';
          const progress=Math.max(0,Math.min(100,Number(item.progress)||0));
          const level=String(item.level||item.horizon||'goal').replace(/^./,letter=>letter.toUpperCase());
          const deadline=item.targetDate?` · ${hiosDeadlineText(item.targetDate)}`:'';
          return `<div class="focus-item"><div class="rank">${index+1}</div><div><b>${hiosEscape(item.title)}</b><small>Goals-IOS · ${hiosEscape(item.domain||'Other')} · ${hiosEscape(level)} · ${progress}% complete${hiosEscape(deadline)}</small></div><span class="tag${high}">${hiosEscape(urgency)}</span></div>`;
        }).join('')
      : '<div class="sub">No active tasks for today. Add a daily task in Goals-IOS.</div>';
  }
}

function renderHiosIntelligence(){
  renderGoalsDashboardViews();
  const goals=loadHiosGoals();
  const manualEvents=loadHiosCalendarEvents();
  const todayKey=hiosDateKey(new Date());
  const pendingDeletes=pendingGoalIds('delete');
  const active=goals.filter(goal=>
    isHiosTodayDailyTask(goal,todayKey)&&
    Number(goal.progress??goal.manualProgress??0)<100&&
    !pendingDeletes.has(String(goal.id||''))
  );
  const high=active.filter(goal=>String(goal.priority||'').toLowerCase()==='high');
  const connected=Array.isArray(addedProductIds)?addedProductIds.length:0;
  const today=new Date();
  today.setHours(0,0,0,0);

  const dated=allHiosDatedCommitments()
    .map(item=>({item,date:parseHiosDate(item.date)}))
    .filter(item=>item.date)
    .sort((a,b)=>a.date-b.date);

  const upcoming=dated.filter(item=>item.date>=today);
  const overdue=dated.filter(item=>item.date<today);
  const next=upcoming[0]||null;

  const summary=document.getElementById('hiosIntelligenceSummary');
  const activeMetric=document.getElementById('hiosMetricActiveGoals');
  const highMetric=document.getElementById('hiosMetricHighPriority');
  const calendarMetric=document.getElementById('hiosMetricCalendarItems');
  const connectedMetric=document.getElementById('hiosMetricConnected');

  if(activeMetric) activeMetric.textContent=active.length;
  if(highMetric) highMetric.textContent=high.length;
  if(calendarMetric) calendarMetric.textContent=dated.length;
  if(connectedMetric) connectedMetric.textContent=connected;
  if(!summary)return;

  if(!goals.length&&!manualEvents.length){
    summary.textContent='H·IOS is waiting for dated commitments. Click any calendar day to add a due date, test, assessment, milestone or other important date.';
    return;
  }

  const pieces=[];

  if(overdue.length){
    pieces.push(`${overdue.length} dated commitment${overdue.length===1?' is':'s are'} overdue and should be reviewed.`);
  }

  if(next){
    pieces.push(`Your next dated commitment is “${next.item.title}” on ${next.date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}.`);
  }else{
    pieces.push('No upcoming dated commitment is currently recorded.');
  }

  if(!overdue.length&&next){
    pieces.unshift('Your current ecosystem evidence is organized around the next scheduled commitment.');
  }

  summary.textContent=pieces.join(' ');
}

function renderHiosCalendar(){
  if(window.hiosAutoZoom&&typeof window.hiosAutoZoom.reset==='function')window.hiosAutoZoom.reset();
  const root=document.getElementById('hiosCalendar');
  const monthLabel=document.getElementById('hiosCalendarMonth');
  if(!root||!monthLabel)return;

  const pending=pendingGoalIds('any');
  const goals=loadHiosGoals()
    .filter(goal=>
      goal.targetDate&&
      Number(goal.progress??goal.manualProgress??0)<100&&
      !pending.has(String(goal.id))
    )
    .map(goal=>({...goal,_date:parseHiosDate(goal.targetDate),_source:'gios'}))
    .filter(goal=>goal._date);

  const manual=loadHiosCalendarEvents()
    .filter(event=>event.date)
    .map(event=>({...event,targetDate:event.date,_date:parseHiosDate(event.date),_source:'hios'}))
    .filter(event=>event._date);

  const events=[...goals,...manual];

  monthLabel.textContent=hiosCalendarCursor.toLocaleDateString(undefined,{month:'long',year:'numeric'});

  const year=hiosCalendarCursor.getFullYear();
  const month=hiosCalendarCursor.getMonth();
  const first=new Date(year,month,1);
  const gridStart=new Date(year,month,1-first.getDay());
  const today=new Date();
  today.setHours(0,0,0,0);

  let markup='';

  for(let i=0;i<42;i++){
    const date=new Date(gridStart);
    date.setDate(gridStart.getDate()+i);

    const key=hiosDateKey(date);
    const dayEvents=events.filter(event=>event.targetDate===key);
    const outside=date.getMonth()!==month;
    const isToday=date.getTime()===today.getTime();
    const isPast=date.getTime()<today.getTime();
    const hasUpcomingSchedule=!isPast && !isToday && dayEvents.length>0;

    markup+=`<div class="calendar-day${outside?' outside':''}${isPast?' past-day':''}${isToday?' today':''}${hasUpcomingSchedule?' upcoming-day':''}" onclick="openCalendarEntryModal('${key}')">`;
    markup+=`<div class="calendar-date">${date.getDate()}</div><div class="calendar-events">`;

    dayEvents.forEach(event=>{
      if(event._source==='hios'){
        const type=String(event.type||'other').toLowerCase();
        const label=`${hiosEventTypeLabel(type)}: ${event.title}`;
        const eventStatus=isPast?'event-past':(isToday?'event-today':'event-upcoming');
        markup+=`<button type="button" class="calendar-event manual ${hiosEscape(type)} ${eventStatus}" onclick="event.stopPropagation();editCalendarEntry('${hiosEscape(event.id)}')">${hiosEscape(label)}</button>`;
      }else{
        const priority=['high','medium','low'].includes(String(event.priority).toLowerCase())
          ? String(event.priority).toLowerCase()
          : 'medium';
        const label=event.domain?`${event.domain}: ${event.title}`:event.title;
        const eventStatus=isPast?'event-past':(isToday?'event-today':'event-upcoming');
        markup+=`<button type="button" class="calendar-event ${priority} ${eventStatus}" onclick="event.stopPropagation();openGiosCalendarTask('${hiosEscape(event.id)}')">${hiosEscape(label)}</button>`;
      }
    });


    markup+='</div></div>';
  }

  root.innerHTML=markup;
}

function renderHiosHome(){
  renderHiosIntelligence();
  renderHiosCalendar();
}

/* Calendar entry modal */
const calendarEntryModal=document.getElementById('calendarEntryModal');
const calendarEntryForm=document.getElementById('calendarEntryForm');
const calendarEntryId=document.getElementById('calendarEntryId');
const calendarEntryDate=document.getElementById('calendarEntryDate');
const calendarEntryTitle=document.getElementById('calendarEntryTitle');
const calendarEntryType=document.getElementById('calendarEntryType');
const calendarEntryDomain=document.getElementById('calendarEntryDomain');
const calendarEntryNotes=document.getElementById('calendarEntryNotes');
const calendarEntryDelete=document.getElementById('calendarEntryDelete');
const calendarEntryHeading=document.getElementById('calendarEntryHeading');
const calendarEntryDateLabel=document.getElementById('calendarEntryDateLabel');
const giosTaskModal=document.getElementById('giosTaskModal');
const giosTaskHeading=document.getElementById('giosTaskHeading');
const giosTaskDateLabel=document.getElementById('giosTaskDateLabel');
const giosTaskDomain=document.getElementById('giosTaskDomain');
const giosTaskLevel=document.getElementById('giosTaskLevel');
const giosTaskPriority=document.getElementById('giosTaskPriority');
const giosTaskProgress=document.getElementById('giosTaskProgress');
let selectedGiosTaskId='';

function openGiosCalendarTask(id){
  const goal=loadHiosGoals().find(item=>String(item.id)===String(id));
  if(!goal)return;
  selectedGiosTaskId=String(goal.id);
  giosTaskHeading.textContent=goal.title||'Goals-IOS task';
  const parsed=parseHiosDate(goal.targetDate);
  giosTaskDateLabel.textContent=parsed
    ? parsed.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    : 'No scheduled date';
  giosTaskDomain.textContent=goal.domain||'Other';
  giosTaskLevel.textContent=String(goal.level||goal.horizon||'goal').replace(/^./,letter=>letter.toUpperCase());
  giosTaskPriority.textContent=String(goal.priority||'medium').replace(/^./,letter=>letter.toUpperCase());
  giosTaskProgress.textContent=Math.max(0,Math.min(100,Number(goal.progress??goal.manualProgress??0)))+'%';
  giosTaskModal.classList.add('show');
}

function closeGiosTaskModal(){
  giosTaskModal.classList.remove('show');
  selectedGiosTaskId='';
}

function requestGiosTaskAction(action){
  const goal=loadHiosGoals().find(item=>String(item.id)===selectedGiosTaskId);
  if(!goal)return;
  const entity=goal.level==='daily'?'task':'goal';
  const type=action==='delete'
    ? `${entity}.delete.requested`
    : `${entity}.calendar.remove.requested`;
  hiosBridge.emit(type,{
    goalId:goal.id,
    title:goal.title,
    level:goal.level,
    requestedAt:new Date().toISOString()
  });
  closeGiosTaskModal();
  renderHiosHome();
}

document.getElementById('giosTaskClose').addEventListener('click',closeGiosTaskModal);
document.getElementById('giosTaskCancel').addEventListener('click',closeGiosTaskModal);
document.getElementById('giosTaskOpen').addEventListener('click',()=>{
  closeGiosTaskModal();
  openProduct('gios');
});
document.getElementById('giosTaskUnschedule').addEventListener('click',()=>{
  requestGiosTaskAction('calendar');
});
document.getElementById('giosTaskDelete').addEventListener('click',()=>{
  const goal=loadHiosGoals().find(item=>String(item.id)===selectedGiosTaskId);
  if(!goal)return;
  if(window.confirm(`Delete "${goal.title}" from Goals-IOS and all connected H-IOS views?`)){
    requestGiosTaskAction('delete');
  }
});
giosTaskModal.addEventListener('click',event=>{
  if(event.target===giosTaskModal)closeGiosTaskModal();
});

function openCalendarEntryModal(dateKey){
  calendarEntryForm.reset();
  calendarEntryId.value='';
  calendarEntryDate.value=dateKey;
  calendarEntryType.value='due';
  calendarEntryDomain.value='General';
  calendarEntryHeading.textContent='Add calendar item';

  const parsed=parseHiosDate(dateKey);
  calendarEntryDateLabel.textContent=parsed
    ? parsed.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    : dateKey;

  calendarEntryDelete.classList.add('hidden');
  calendarEntryModal.classList.add('show');
  setTimeout(()=>calendarEntryTitle.focus(),0);
}

function closeCalendarEntryModal(){
  calendarEntryModal.classList.remove('show');
}

function editCalendarEntry(id){
  const event=loadHiosCalendarEvents().find(item=>item.id===id);
  if(!event)return;

  calendarEntryId.value=event.id;
  calendarEntryDate.value=event.date;
  calendarEntryTitle.value=event.title||'';
  calendarEntryType.value=event.type||'other';
  calendarEntryDomain.value=event.domain||'General';
  calendarEntryNotes.value=event.notes||'';
  calendarEntryHeading.textContent='Edit calendar item';

  const parsed=parseHiosDate(event.date);
  calendarEntryDateLabel.textContent=parsed
    ? parsed.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})
    : event.date;

  calendarEntryDelete.classList.remove('hidden');
  calendarEntryModal.classList.add('show');
}

calendarEntryForm.addEventListener('submit',event=>{
  event.preventDefault();

  const title=calendarEntryTitle.value.trim();
  const date=calendarEntryDate.value;
  if(!title||!date)return;

  const events=loadHiosCalendarEvents();
  const id=calendarEntryId.value||`hcal_${Date.now()}`;
  const next={
    id,
    title,
    date,
    type:calendarEntryType.value,
    domain:calendarEntryDomain.value,
    notes:calendarEntryNotes.value.trim(),
    updatedAt:new Date().toISOString()
  };

  const index=events.findIndex(item=>item.id===id);
  if(index>=0)events[index]=next;
  else events.push(next);

  saveHiosCalendarEvents(events);
  hiosBridge.emit(index>=0?'calendar.item.updated':'calendar.item.created',{
    itemId:id,
    title:next.title,
    date:next.date,
    type:next.type,
    domain:next.domain
  });
  closeCalendarEntryModal();
  renderHiosHome();
});

calendarEntryDelete.addEventListener('click',()=>{
  const id=calendarEntryId.value;
  if(!id)return;
  const current=loadHiosCalendarEvents();
  const removed=current.find(item=>item.id===id);
  const events=current.filter(item=>item.id!==id);
  saveHiosCalendarEvents(events);
  hiosBridge.emit('calendar.item.deleted',{
    itemId:id,
    title:removed?.title||'',
    date:removed?.date||''
  });
  closeCalendarEntryModal();
  renderHiosHome();
});

document.getElementById('calendarEntryClose').addEventListener('click',closeCalendarEntryModal);
document.getElementById('calendarEntryCancel').addEventListener('click',closeCalendarEntryModal);

calendarEntryModal.addEventListener('click',event=>{
  if(event.target===calendarEntryModal)closeCalendarEntryModal();
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(calendarEntryModal.classList.contains('show'))closeCalendarEntryModal();
    if(giosTaskModal.classList.contains('show'))closeGiosTaskModal();
  }
});

const hiosPrevMonth=document.getElementById('hiosPrevMonth');
const hiosNextMonth=document.getElementById('hiosNextMonth');

if(hiosPrevMonth){
  hiosPrevMonth.addEventListener('click',()=>{
    hiosCalendarCursor=new Date(
      hiosCalendarCursor.getFullYear(),
      hiosCalendarCursor.getMonth()-1,
      1
    );
    renderHiosCalendar();
  });
}

if(hiosNextMonth){
  hiosNextMonth.addEventListener('click',()=>{
    hiosCalendarCursor=new Date(
      hiosCalendarCursor.getFullYear(),
      hiosCalendarCursor.getMonth()+1,
      1
    );
    renderHiosCalendar();
  });
}

window.addEventListener('storage',event=>{
  if(
    event.key===HIOS_GIOS_GOALS_KEY ||
    HIOS_GIOS_LEGACY_KEYS.includes(event.key) ||
    event.key===HIOS_GIOS_SNAPSHOT_KEY ||
    event.key===HIOS_GIOS_FOCUS_AREAS_KEY ||
    event.key===HIOS_CALENDAR_EVENTS_KEY
  ){
    renderHiosHome();
  }
});

hiosBridge.subscribe(()=>renderHiosHome(),{
  source:'goals-ios',
  types:[
    'goal.created','goal.updated','goal.completed','goal.deleted',
    'goal.progress.changed','goal.deadline.changed',
    'task.created','task.updated','task.completed','task.deleted',
    'goals.snapshot.updated','goals.state.synchronised'
  ]
});

window.addEventListener('pageshow',renderHiosHome);
window.addEventListener('focus',renderHiosHome);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)renderHiosHome();
});

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const notice = document.getElementById('notice');
const passwordInput = document.getElementById('password');
const signInButton = document.getElementById('signInButton');

document.getElementById('togglePassword').addEventListener('click', () => {
  const visible = passwordInput.type === 'text';
  passwordInput.type = visible ? 'password' : 'text';
  document.getElementById('togglePassword').textContent = visible ? '◉' : '◎';
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = passwordInput.value;

  if(!email || !password){
    setNotice('Enter your email and password.', 'error');
    return;
  }

  signInButton.disabled = true;
  signInButton.textContent = 'Signing in...';
  setNotice('Checking your H·IOS account...', 'info');

  try{
    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if(error){
      setNotice(error.message, 'error');
      return;
    }

    if(!data?.user){
      setNotice('A valid user session was not returned.', 'error');
      return;
    }

    /* IMPORTANT:
       NO window.location.href = "h-ios.html"
       NO redirect at all.
       We reveal the goals/default H·IOS page in this exact same file. */
    showApp();

  }catch(err){
    console.error(err);
    setNotice('Could not connect to authentication. Check your connection and try again.', 'error');
  }finally{
    signInButton.disabled = false;
    signInButton.textContent = 'Enter H·IOS';
  }
});

document.getElementById('forgotLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();

  if(!email){
    setNotice('Enter your email first, then choose “Forgot password?”.', 'error');
    return;
  }

  try{
    const { error } = await db.auth.resetPasswordForEmail(email);
    if(error){
      setNotice(error.message, 'error');
      return;
    }
    setNotice('Password reset email sent. Check your inbox.', 'info');
  }catch(err){
    setNotice('Unable to send reset email right now.', 'error');
  }
});

function showApp(){
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  renderProductManager();
  renderHiosHome();
  window.scrollTo({top:0,behavior:'instant'});
}

async function logout(){
  try{ await db.auth.signOut(); }catch(e){}
  showLoginScreen();
  document.getElementById('loginForm').reset();
  notice.className = 'notice';
  notice.textContent = '';
  window.scrollTo({top:0,behavior:'instant'});
}

function goToTIOS(){
  window.location.href = 't-ios.html';
}

function showMessage(title, text){
  alert(title + "\n\n" + text);
}

function setNotice(message,type){
  notice.textContent = message;
  notice.className = 'notice ' + type;
}

/* =========================================================
   SESSION RESTORATION
   Supabase persists the authenticated session in this browser.
   On refresh or when returning from another ·IOS product,
   H·IOS checks that session and opens the app instead of
   forcing the user back through the login screen.
========================================================= */

function showLoginScreen(){
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

async function restoreExistingSession(){
  try{
    const { data, error } = await db.auth.getSession();

    if(error){
      console.warn('Could not restore H·IOS session:', error);
      showLoginScreen();
      return;
    }

    if(data?.session?.user){
      showApp();
      return;
    }

    showLoginScreen();

  }catch(error){
    console.warn('H·IOS session restore failed:', error);
    showLoginScreen();
  }
}

/* Keep the UI synchronized if Supabase refreshes or clears the session. */
db.auth.onAuthStateChange((event, session) => {
  if(
    (event === 'SIGNED_IN' ||
     event === 'TOKEN_REFRESHED' ||
     event === 'INITIAL_SESSION') &&
    session?.user
  ){
    showApp();
  }

  if(event === 'SIGNED_OUT'){
    showLoginScreen();
  }
});

/* This is what fixes refresh + returning from Goals-IOS/Traders-IOS. */
restoreExistingSession();


/* =========================================================
   H·IOS SECTION A — OPERATIONS ANIMATION LOOP
   Rotates through distinct operation scenes rather than
   repeating one continuous visual. The loop is intentionally
   lightweight: HTML/CSS/JS only, no external video asset.
========================================================= */
(function initHiosOperationLoop(){
  const root = document.getElementById('hiosOperationLoop');
  if(!root) return;

  const scenes = [...root.querySelectorAll('[data-op-scene]')];
  const dots = [...root.querySelectorAll('[data-op-dot]')];
  if(!scenes.length) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SCENE_MS = 4200;
  let current = 0;
  let timer = null;

  function showScene(index, restart=true){
    current = (index + scenes.length) % scenes.length;
    scenes.forEach((scene,i)=>scene.classList.toggle('active',i===current));
    dots.forEach((dot,i)=>dot.classList.toggle('active',i===current));

    if(restart && !reducedMotion){
      clearInterval(timer);
      timer = setInterval(()=>showScene(current+1,false),SCENE_MS);
    }
  }

  dots.forEach((dot,i)=>dot.addEventListener('click',()=>showScene(i,true)));

  root.addEventListener('mouseenter',()=>{ if(timer) clearInterval(timer); });
  root.addEventListener('mouseleave',()=>{
    if(!reducedMotion){
      clearInterval(timer);
      timer = setInterval(()=>showScene(current+1,false),SCENE_MS);
    }
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      clearInterval(timer);
    }else if(!reducedMotion){
      clearInterval(timer);
      timer = setInterval(()=>showScene(current+1,false),SCENE_MS);
    }
  });

  showScene(0,false);
  if(!reducedMotion){
    timer = setInterval(()=>showScene(current+1,false),SCENE_MS);
  }
})();
