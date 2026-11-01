(function (root) {
  'use strict';

  const blocks = [
    {id:'cargo15',group:'cargo',name:'Грузовой контейнер 1,5 м',size:1.5,blockKg:245.17,capacity:16.8},
    {id:'cargo25',group:'cargo',name:'Грузовой контейнер 2,5 м',size:2.5,blockKg:669.08,capacity:67.2},
    {id:'cargo75',group:'cargo',name:'Грузовой контейнер 7,5 м',size:7.5,blockKg:5092.09,capacity:2150.4},
    {id:'h2tank15',group:'tank',name:'Водородный бак 1,5 м',size:1.5,blockKg:382.4,capacity:8000},
    {id:'h2tank5',group:'tank',name:'Водородный бак 5 м',size:5,blockKg:1534.87,capacity:32000},
    {id:'h2tank125',group:'tank',name:'Водородный бак 12,5 м',size:12.5,blockKg:9552.79,capacity:1280000},
    {id:'o2tank15',group:'tank',name:'Кислородный бак 1,5 м',size:1.5,blockKg:382.4,capacity:8000},
    {id:'gen15',group:'generator',name:'Генератор O₂/H₂ 1,5 м',size:1.5,blockKg:523.01,capacity:8400},
    {id:'gen5',group:'generator',name:'Генератор O₂/H₂ 5 м',size:5,blockKg:2957.53,capacity:16800}
  ];
  const engines = (root.SE2_CATALOG?.engines || []).map(e => ({
    id:`thruster:${e.id}`, engineId:e.id, group:'thruster', name:e.name,
    size:e.size, blockKg:0, capacity:0
  }));
  const catalog = [...blocks, ...engines];
  const getType=id=>catalog.find(v=>v.id===id)||blocks[1];
  const initialObj=(type,load,pos)=>{
    const t=getType(type);
    return {type,load:load||0,fill:t.group==='tank'?100:0,count:1,direction:'up',external:t.group==='thruster',pos,dim:[t.size,t.size,t.size]};
  };
  const clone=o=>JSON.parse(JSON.stringify(o));
  function center(model,legacyFill=model.fill??1) {
    if (!Number.isFinite(model.mass)||model.mass<=0||model.mass>1e12) throw Error('Нужна масса остального корабля больше нуля.');
    if (!Number.isFinite(legacyFill)||legacyFill<0||legacyFill>1) throw Error('Проверьте старый общий уровень загрузки.');
    if(!Array.isArray(model.origin)||model.origin.length!==3||!model.origin.every(Number.isFinite))throw Error('Проверьте центр остального корабля.');
    let total=model.mass, sum=model.origin.map(v=>v*model.mass), cargo=0, blocksMass=0;
    if(Array.isArray(model.objects)) {
      for(const o of model.objects) {
        if(!o||!catalog.some(t=>t.id===o.type)||!Array.isArray(o.pos)||o.pos.length!==3||!Array.isArray(o.dim)||o.dim.length!==3)throw Error('Неверный объект компоновки.');
        const t=getType(o.type), count=t.group==='thruster'?Math.max(1,Number(o.count)||1):1;
        const load=Number(o.load),fill=Number(o.fill);
        if(t.group==='thruster'&&(!Number.isInteger(count)||count>1e6||!['up','down','forward','back','left','right'].includes(o.direction)))throw Error('Проверьте количество и направление двигателей.');
        if(!Number.isFinite(load)||load<0||(t.group==='tank'&&(!Number.isFinite(fill)||fill<0||fill>100))||!o.pos.every(Number.isFinite)||!o.dim.every(v=>Number.isFinite(v)&&v>0)) throw Error('Проверьте массу, габариты и положение объектов.');
        const contents=t.group==='tank'?load*fill/100:t.group==='cargo'||t.group==='thruster'||t.group==='generator'?load:0;
        const blockMass=t.blockKg/1000*count, objectMass=blockMass+contents;
        total+=objectMass; blocksMass+=blockMass; cargo+=contents;
        o.pos.forEach((v,i)=>sum[i]+=objectMass*v);
      }
    } else {
      for(const o of (model.cargo||[])) {
        if(!Number.isFinite(o.mass)||o.mass<0||!o.pos.every(Number.isFinite)) throw Error('Проверьте массу и положение старого груза.');
        const load=o.mass*legacyFill;total+=load;cargo+=load;o.pos.forEach((v,i)=>sum[i]+=load*v);
      }
    }
    const pos=sum.map(v=>v/total);
    return {total,pos,delta:pos.map((v,i)=>v-model.origin[i]),cargo,blocks:blocksMass};
  }
  function displacement(model) {
    const r=center(model),ratios=r.delta.map((v,i)=>Math.abs(v)/([model.length,model.width,model.height][i]/2)),score=Math.max(...ratios);
    return {score,level:score<.1?'low':score<.25?'medium':'high',label:score<.1?'Малое смещение':score<.25?'Заметное смещение':'Большое смещение'};
  }
  const MAX_OBJECTS=200;
  const STORAGE_KEY='se2-balance-v1', RECOVERY_KEY='se2-balance-recovery-v1';
  const fresh=()=>({mass:400,length:30,width:12,height:8,origin:[0,0,0],contentsSchema:1,decks:[],zoom:1,focus:[0,0,0],objects:[initialObj('cargo25',20,[8,0,0]),initialObj('cargo25',40,[-8,0,0])]});
  const finite=v=>Number.isFinite(v)&&Math.abs(v)<=1e9;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
  function restoreLayout(old){
    if(!old||!['length','width','height','mass'].every(k=>finite(old[k])&&old[k]>0)||!vector(old.origin))throw Error('Проверьте массу, размеры и центр корабля.');
    const list=Array.isArray(old.objects)?old.objects:old.cargo;
    if(!Array.isArray(list)||list.length>MAX_OBJECTS)throw Error('В схеме допускается до 200 объектов. Исходные данные не обрезаны.');
    const priorFill=old.fill??1;if(!finite(priorFill)||priorFill<0||priorFill>1)throw Error('Неверная загрузка старой схемы.');
    const objects=list.map(o=>{
      if(!o||!vector(o.pos))throw Error('Неверное положение объекта.');
      const legacy=!Array.isArray(old.objects),type=legacy?'cargo25':o.type,t=catalog.find(t=>t.id===type);
      if(!t)throw Error('Неизвестный блок в схеме.');
      const load=legacy?o.mass:o.load;if(!finite(load)||load<0)throw Error('Неверная масса объекта.');
      const independent=o.fill!=null,fill=t.group==='tank'?(independent?o.fill:priorFill*100):0;
      const count=o.count??1,dim=o.dim??[t.size,t.size,t.size],direction=o.direction??'up';
      if(!Number.isInteger(count)||count<1||count>1e6||!vector(dim)||!dim.every(v=>v>0)||!finite(fill)||fill<0||fill>100)throw Error('Неверные габариты, количество или заполнение.');
      if(t.group==='thruster'&&!['up','down','forward','back','left','right'].includes(direction))throw Error('Неверное направление двигателя.');
      if(o.external!=null&&typeof o.external!=='boolean')throw Error('Неверный тип крепления.');
      return {...initialObj(type,0,[...o.pos]),load:t.group==='generator'&&!old.contentsSchema?0:load*(legacy||t.group==='cargo'&&!independent?priorFill:1),fill,count,direction,dim:[...dim],external:o.external??t.group==='thruster',customDimensions:!!o.customDimensions};
    });
    const zoom=old.zoom??1,focus=old.focus??[0,0,0],decks=old.decks??[];
    if(!finite(zoom)||zoom<.5||zoom>4||!vector(focus)||!Array.isArray(decks)||decks.length>2||!decks.every((v,i,a)=>finite(v)&&v>=.01&&v<=.99&&(!i||v-a[i-1]>=.01)))throw Error('Неверный масштаб или палубы.');
    const model={...fresh(),mass:old.mass,length:old.length,width:old.width,height:old.height,origin:[...old.origin],zoom,focus:[...focus],decks:[...decks],objects};
    if(finite(old.viewScale)&&old.viewScale>0)model.viewScale=old.viewScale;
    center(model);return model;
  }
  function readLayoutStorage(storage){
    let raw=null,recovery=null;
    try{
      raw=storage.getItem(STORAGE_KEY);recovery=storage.getItem(RECOVERY_KEY);
      if(raw===null)return {model:fresh(),recovery,canSave:true};
      return {model:restoreLayout(JSON.parse(raw)),recovery,canSave:true};
    }catch{
      // Never overwrite the original unless its recovery copy was actually saved.
      let canSave=false;
      if(raw!==null){recovery=raw;try{storage.setItem(RECOVERY_KEY,raw);canSave=true;}catch{}}
      return {model:fresh(),recovery,canSave,recovered:raw!==null};
    }
  }
  root.BalanceMath={center,displacement,restoreLayout,readLayoutStorage};
  if(typeof module!=='undefined')module.exports=root.BalanceMath;
  if(typeof document==='undefined')return;
  const el=document.getElementById('balance'), I=()=>root.SE2I18N;
  let storageState;
  try{storageState=readLayoutStorage(localStorage);}catch{storageState={model:fresh(),canSave:false,recovery:null};}
  let m=storageState.model,selected=0,layoutMessage='';

  Object.assign(m,root.LayoutGeometry.proportionHull(m));
  function setHullDimension(k,v){m[k]=v;Object.assign(m,root.LayoutGeometry.proportionHull(m,k));}
  const fitScale=()=>{const d=root.LayoutGeometry.required(m,root.SE2_CATALOG.engines);return Math.min(420/Math.max(m.length,m.width,d[0],d[1]),130/Math.max(m.width,m.height,d[1],d[2]));};
  if(!Number.isFinite(m.viewScale)||m.viewScale<=0)m.viewScale=fitScale();
  const fmt=v=>Number(v).toLocaleString(I()?.language==='en'?'en-US':'ru-RU',{maximumFractionDigits:2});
  const dim=i=>m[['length','width','height'][i]];
  const bound=(v,i)=>Math.max(-dim(i)/2,Math.min(dim(i)/2,v));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function name(t){
    if(t.group==='thruster') return t.name;
    const en={cargo15:'Cargo Container 1.5 m',cargo25:'Cargo Container 2.5 m',cargo75:'Cargo Container 7.5 m',h2tank15:'Hydrogen Tank 1.5 m',h2tank5:'Hydrogen Tank 5 m',h2tank125:'Hydrogen Tank 12.5 m',o2tank15:'Oxygen Tank 1.5 m',gen15:'O₂/H₂ Generator 1.5 m',gen5:'O₂/H₂ Generator 5 m'};
    return I()?.language==='en'?en[t.id]:t.name;
  }
  function persist(){if(storageState.canSave)try{localStorage.setItem(STORAGE_KEY,JSON.stringify(m));}catch{storageState.canSave=false;}const status=document.getElementById('layout-storage-status');if(status)status.textContent=tr(storageState.canSave?'Схема автоматически сохраняется в этом браузере.':'Автосохранение недоступно. Скачайте схему через «Экспорт компоновки».',storageState.canSave?'Layout is saved automatically in this browser.':'Autosave unavailable. Download the layout using Export layout.');}
  function downloadLayout(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function objectMass(o){const t=getType(o.type),contents=t.group==='tank'?(Number(o.load)||0)*(Number(o.fill)||0)/100:t.group==='cargo'||t.group==='thruster'||t.group==='generator'?(Number(o.load)||0):0;return t.blockKg/1000*(t.group==='thruster'?Math.max(1,Number(o.count)||1):1)+contents;}
  function collisions(){
    const out=[];
    for(let i=0;i<m.objects.length;i++){
      const a=m.objects[i],outside=a.pos.some((v,k)=>Math.abs(v)+objectDims(a)[k]/2>dim(k)/2+.001);
      if(outside&&!external(a))out.push({i,type:'outside'});
      for(let j=0;j<i;j++){const b=m.objects[j],overlap=a.pos.every((v,k)=>Math.abs(v-b.pos[k])<(objectDims(a)[k]+objectDims(b)[k])/2-.001);if(overlap)out.push({i,j,type:'overlap'});}
    }
    return out;
  }
  function objectEditor(o,t){
    const contents=t.group==='cargo'
      ? `<label>Груз, т<input type="number" min="0" max="${t.capacity}" step="any" data-object="load" value="${o.load}"></label><label>Масса блока, кг<input type="number" value="${t.blockKg}" disabled></label><div class="quick load-presets"><button data-cargo-preset="0">Пустой</button><button data-cargo-preset="half">Половина</button><button data-cargo-preset="full">Полный</button></div>`
      : t.group==='tank'
        ? `<label>Масса газа при 100% заполнении, т<input type="number" min="0" step="any" data-object="load" value="${o.load}"></label><label>Масса бака, кг<input type="number" value="${t.blockKg}" disabled></label><label class="object-fill">Заполнение бака: ${fmt(o.fill)}%<input type="range" min="0" max="100" step="1" data-object="fill" value="${o.fill}"></label><div class="quick load-presets"><button data-tank-fill="0">Пустой</button><button data-tank-fill="100">Полный</button></div><p class="muted small">Заполнение каждого бака задаётся отдельно и меняет его массу газа. Введи массу газа для полного бака: перевод игровых литров в массу в игре не подтверждён.</p>`
        : t.group==='generator'
          ? `<label>${tr("Лёд и содержимое, т","Ice and contents, t")}<input type="number" min="0" step="any" data-object="load" value="${o.load}"></label><label>Масса блока, кг<input type="number" value="${t.blockKg}" disabled></label><p class="muted small">${tr("Масса содержимого прибавляется к массе генератора. Производство газа здесь не рассчитывается.","Contents mass is added to generator mass. Gas production is not simulated here.")}</p>`
          : `<label>Количество одинаковых двигателей<input type="number" min="1" step="1" data-object="count" value="${o.count}"></label><label>Масса всех этих двигателей, т<input type="number" min="0" step="any" data-object="load" value="${o.load}"></label><label>${tr('Крепление','Mounting')}<select data-object="external"><option value="external" ${external(o)?'selected':''}>${tr('Снаружи корпуса','Outside hull')}</option><option value="internal" ${!external(o)?'selected':''}>${tr('Внутри корпуса','Inside hull')}</option></select></label><label>Направление тяги<select data-object="direction">${[['up','Вверх'],['down','Вниз'],['forward','Вперёд'],['back','Назад'],['left','Влево'],['right','Вправо']].map(([v,l])=>`<option value="${v}" ${o.direction===v?'selected':''}>${I()?.language==='en'?({up:'Up',down:'Down',forward:'Forward',back:'Back',left:'Left',right:'Right'}[v]):l}</option>`).join('')}</select></label><p class="muted small">Размер двигателя для схемы берётся из каталога. Его массу введи из игры; она не подтверждена в каталоге сайта.</p>`;
    const capacity=t.group==='cargo'?`Предел груза: ${fmt(t.capacity)} т.`:t.group==='tank'?`Ёмкость бака: ${fmt(t.capacity)} игровых литров.`:t.group==='generator'?`Инвентарь генератора: до ${fmt(t.capacity)} кг льда.`:`Двигатели добавляются для планировки; масса не задана автоматически.`;
    const over=(t.group==='cargo'&&o.load>t.capacity||t.group==='generator'&&o.load>t.capacity/1000)?'<p class="layout-warning">Содержимое превышает каталожный предел массы инвентаря.</p>':'';
    return `<div class="object-card"><h3>${esc(name(t))} · ${fmt(t.size)} м</h3><p class="small muted">${capacity}</p><div class="fields">${contents}</div>${over}<h4>${t.group==='thruster'?tr('Габарит одного двигателя (Д × Ш × В), м','One engine envelope (L × W × H), m'):'Габарит модели (Д × Ш × В), м'}</h4><div class="fields three">${['Длина','Ширина','Высота'].map((v,i)=>`<label>${I()?.language==='en'?['Length','Width','Height'][i]:v}<input type="number" min="0.1" step="0.1" data-dim="${i}" value="${o.dim[i]}"></label>`).join('')}</div><p class="small muted">Объём габарита: ${fmt(o.dim[0]*o.dim[1]*o.dim[2])} м³ · масса объекта: ${fmt(objectMass(o))} т. ${t.group==='thruster'?'Установленные блоки двигателей должны входить в массу корпуса или указанную выше массу.':''}</p><p class="muted small">Координаты центра объекта от середины корпуса:</p>${['Корма ← → нос','Правый ← → левый борт','Низ ← → верх'].map((v,i)=>`<label class="balance-coordinate">${I()?.language==='en'?['Aft ← → nose','Starboard ← → port','Bottom ← → top'][i]:v}: ${fmt(o.pos[i])} м<input type="range" aria-label="${v}" data-pos="${i}" min="${-coordinateReach(o,i)}" max="${coordinateReach(o,i)}" step="0.01" value="${o.pos[i]}"></label>`).join('')}</div>`;
  }
  const tr=(ru,en)=>I()?.language==='en'?en:ru;
  const geometry=root.LayoutGeometry;
  const projections={top:{h:0,v:1,axes:['length','width'],ru:'Вид сверху',en:'Top view'},front:{h:1,v:2,axes:['width','height'],ru:'Вид спереди',en:'Front view'},side:{h:0,v:2,axes:['length','height'],ru:'Вид сбоку',en:'Side view'}};
  const external=o=>getType(o.type).group==='thruster'&&o.external!==false;
  const objectBound=(v,k,o)=>external(o)?v:bound(v,k);
  const coordinateReach=(o,k)=>Math.ceil(Math.max(dim(k)/2+(external(o)?objectDims(o)[k]*2:0),Math.abs(o.pos[k]))*10)/10;
  function totals(){const f=flight();return geometry.thrust(m,f.engines,f.density);}
  function thrustAssessment(){const c=flight(),need=root.Flight.required({...c,targets:c.targets||[0,0,0,0,0,0],margin:c.margin??0,phases:[]},center(m).total*1000),f=totals();return Object.fromEntries(root.Flight.dirs.map((d,i)=>[d,{...geometry.adequacy(f[d],need[i]),need:need[i]}]));}
  function assessmentText(a){return a.level==='neutral'?tr('Цель не задана','No target'):a.level==='enough'?tr('Хватает','Enough')+' · '+a.percent+'%':tr('Не хватает','Insufficient')+' · '+a.percent+'%';}
  function thrustSummary(){const f=totals(),max=Math.max(...Object.values(f)),checks=thrustAssessment();return '<div class="thrust-overview"><h3>'+tr('Тяга и достаточность','Thrust and adequacy')+'</h3><p class="small muted">'+tr('Цвет: красный → жёлтый → зелёный по мере достижения нужной тяги. Зелёный — хватает с выбранным запасом. Длина и толщина — относительная сила. кН — килоньютоны, единица силы. Питание и топливо проверяются отдельно.','Color: red → yellow → green as required thrust is reached. Green includes the chosen margin. Length and thickness show relative force. kN means kilonewtons, a unit of force. Power and fuel are checked separately.')+'</p><div class="thrust-cards">'+Object.entries(f).map(([d,t])=>{const q=max?t/max:0,a=checks[d];return '<div class="thrust-card" style="--thrust-color:'+a.color+'"><span>'+directionName(d)+'</span><strong>'+fmt(t)+' '+tr('кН','kN')+'</strong><small class="adequacy-label">'+assessmentText(a)+'</small><small>'+tr('Нужно: ','Required: ')+fmt(a.need)+' '+tr('кН','kN')+'</small><svg viewBox="0 0 120 20" aria-label="'+directionName(d)+': '+assessmentText(a)+'"><path class="thrust-capacity" stroke-width="'+(2+4*q)+'" d="M 4 10 H '+(4+100*q)+'"/>'+(q?'<path class="thrust-capacity" d="M '+(4+100*q-Math.min(6,40*q))+' 5 L '+(4+100*q)+' 10 L '+(4+100*q-Math.min(6,40*q))+' 15"/>':'')+'</svg></div>';}).join('')+'</div>';}

  const flight=()=>root.SE2FlightApp?.layoutConditions?.()||{density:1,g:1,engines:root.SE2_CATALOG.engines};
  const minHull=()=>{const kinds=new Set(m.objects.map(o=>flight().engines.find(e=>'thruster:'+e.id===o.type)?.kind).filter(Boolean));const list=kinds.size?flight().engines.filter(e=>kinds.has(e.kind)):flight().engines;return geometry.minimum(list,flight().density);};
  const objectDims=o=>geometry.dimensions(o,flight().engines);
  const deckBounds=()=>[0,...m.decks,1];
  function moveDeck(i,v){const b=deckBounds();m.decks[i]=Math.max(b[i]+.01,Math.min(b[i+2]-.01,v));}
  function deckPanel(){return '<div class="deck-panel"><h3>'+tr('Палубы / этажи','Decks / floors')+'</h3><div class="quick">'+[1,2,3].map(n=>'<button data-decks="'+n+'" aria-pressed="'+(m.decks.length===n-1)+'">'+n+'</button>').join('')+'</div><div id="deck-controls"></div></div>';}
  function syncDecks(){const b=deckBounds();if(document.activeElement?.dataset.deck!==undefined)return;document.getElementById('deck-controls').innerHTML=m.decks.map((f,i)=>'<label>'+tr('Перекрытие','Divider')+' '+(i+1)+' · '+tr('м от низа','m above bottom')+'<input type="number" step="any" data-deck="'+i+'" value="'+Number((f*m.height).toFixed(3))+'"></label>').join('')+'<div class="quick">'+b.slice(1).map((f,i)=>{const o=m.objects[selected],fits=o&&objectDims(o)[2]<=(f-b[i])*m.height+.001;return '<button data-place-deck="'+i+'" '+(fits?'':'disabled')+'>'+tr('Объект на палубу','Place on deck')+' '+(i+1)+'</button>';}).join('')+'</div><p>'+b.slice(1).map((f,i)=>tr('Палуба','Deck')+' '+(i+1)+': '+fmt((f-b[i])*m.height)+' '+tr('м','m')).join(' · ')+'</p>'+m.objects.flatMap((o,i)=>m.decks.flatMap((f,j)=>{const d=objectDims(o),intersectsFloor=Math.abs(o.pos[0])<(m.length+d[0])/2-.001&&Math.abs(o.pos[1])<(m.width+d[1])/2-.001;if(!intersectsFloor)return [];const z=(f-.5)*m.height,h=d[2]/2;return o.pos[2]-h<z-.001&&o.pos[2]+h>z+.001?['<p class="layout-warning">'+tr('Объект','Object')+' '+(i+1)+': '+tr('пересекает перекрытие','crosses divider')+' '+(j+1)+'</p>']:[];})).join('');
  el.querySelectorAll('[data-decks]').forEach(e=>e.setAttribute('aria-pressed',String(+e.dataset.decks===m.decks.length+1)));}
  function thrustArrows(view){const f=totals(),checks=thrustAssessment(),max=Math.max(...Object.values(f));const dirs=view==='front'?[['up',280,62,0,-1],['down',280,178,0,1],['left',450,122,1,0],['right',110,122,-1,0]]:view==='side'?[['up',280,62,0,-1],['down',280,178,0,1],['forward',450,122,1,0],['back',110,122,-1,0]]:[['left',280,62,0,-1],['right',280,178,0,1],['forward',450,122,1,0],['back',110,122,-1,0]];return dirs.map(([d,x,y,dx,dy])=>{const a=checks[d];if(f[d]<=0&&a.level==='neutral')return '';const q=max?f[d]/max:0,l=6+42*q,ex=x+dx*l,ey=y+dy*l,h=Math.min(7,l*.4);return '<g class="thrust-arrow '+(['up','down'].includes(d)?'vertical-thrust':'horizontal-thrust')+' '+(q?'':'zero-thrust')+'" style="--thrust-color:'+a.color+'" data-adequacy="'+a.level+'" data-thrust="'+d+'" data-ratio="'+q+'"><title>'+directionName(d)+': '+fmt(f[d])+' kN · '+assessmentText(a)+'</title><path opacity="0.95" style="stroke-width:'+(2+4*q)+'" d="M '+x+' '+y+' L '+ex+' '+ey+(q?' M '+(ex-dx*h-dy*h*.6)+' '+(ey-dy*h+dx*h*.6)+' L '+ex+' '+ey+' L '+(ex-dx*h+dy*h*.6)+' '+(ey-dy*h-dx*h*.6):'')+'"/><text text-anchor="middle" x="'+(dx?x+dx*22:x)+'" y="'+(dy<0?y+14:dy>0?y-9:y+19)+'">'+fmt(f[d])+' '+tr('кН','kN')+(a.percent===null?'':' · '+a.percent+'%')+'</text></g>';}).join('');}
  const family=t=>root.SE2_CATALOG.engines.find(e=>e.id===t.engineId)?.kind;
  const familyName=k=>({Atmospheric:tr('Атмосферные','Atmospheric'),Hydrogen:tr('Водородные','Hydrogen'),Ion:tr('Ионные','Ion')}[k]||k);
  const directionName=d=>({up:tr('↑ Вверх','↑ Up'),down:tr('↓ Вниз','↓ Down'),forward:tr('→ Вперёд','→ Forward'),back:tr('← Назад','← Back'),left:tr('Влево','Left'),right:tr('Вправо','Right')}[d]||d);
  function syncAddControls(){for(const group of ['engines','equipment']){const chosen=document.getElementById('balance-'+group+'-type')?.value;const direction=document.getElementById('balance-engine-direction')?.value;el.querySelector('[data-add-group="'+group+'"]').disabled=!chosen||(group==='engines'&&!root.Flight.dirs.includes(direction));}}
  function placeEngine(o){const index=root.Flight.dirs.indexOf(o.direction),axis=index<2?2:index<4?0:1,sign=index%2===0?-1:1;o.pos[axis]=sign*(dim(axis)/2+o.dim[axis]/2);const tangent=axis===0?1:0,n=m.objects.filter(v=>v.type.startsWith('thruster:')&&v.direction===o.direction).length;const offset=n?Math.ceil(n/2)*(n%2?1:-1)*(o.dim[tangent]+.5):0;o.pos[tangent]=offset;}
  function objectSections(){return '<div class="object-sections">'+['engines','equipment'].map(group=>{
    const motor=group==='engines',items=catalog.filter(t=>(t.group==='thruster')===motor);
    const options=motor?['Atmospheric','Hydrogen','Ion'].map(kind=>'<optgroup label="'+familyName(kind)+'">'+items.filter(t=>family(t)===kind).map(t=>'<option value="'+t.id+'">'+esc(name(t))+'</option>').join('')+'</optgroup>').join(''):items.map(t=>'<option value="'+t.id+'">'+esc(name(t))+'</option>').join('');
    return '<section class="object-group" data-object-section="'+group+'"><h3>'+tr(motor?'Двигатели':'Остальное оборудование',motor?'Engines':'Other equipment')+'</h3><div id="balance-'+group+'-list"></div><div class="balance-add-row"><select id="balance-'+group+'-type" aria-label="'+tr(motor?'Выбрать двигатель':'Выбрать оборудование',motor?'Choose engine':'Choose equipment')+'" data-add-choice="'+group+'"><option value="" disabled selected>'+tr(motor?'Выберите двигатель':'Выберите оборудование',motor?'Choose an engine':'Choose equipment')+'</option>'+options+'</select>'+(motor?'<label class="engine-direction-choice">'+tr('Куда должен толкать корабль','Which way should the ship be pushed')+'<select id="balance-engine-direction" data-add-choice="engines" aria-label="'+tr('Направление тяги нового двигателя','New engine thrust direction')+'"><option value="" disabled selected>'+tr('Выберите направление тяги','Choose thrust direction')+'</option>'+root.Flight.dirs.map(d=>'<option value="'+d+'">'+directionName(d)+'</option>').join('')+'</select></label>':'')+'<button data-add-group="'+group+'" disabled>'+tr(motor?'+ Двигатель':'+ Оборудование',motor?'+ Engine':'+ Equipment')+'</button></div>'+(motor?'<p class="small muted">'+tr('Выбирайте направление силы, а не струи. Двигатель для подъёма ставится снизу; для хода вперёд — на корме. После добавления положение можно изменить на схемах.','Choose the force direction, not exhaust direction. Lift engines mount underneath; forward engines mount aft. Drag to adjust after adding.')+'</p>':'')+'</section>';
  }).join('')+'</div>';}
  function objectLists(){
    const row=(o,i)=>{const t=getType(o.type),motor=t.group==='thruster';return '<div class="layout-list-item"><button data-select="'+i+'" aria-pressed="'+(selected===i)+'"><strong>'+String(i+1)+'. '+esc(name(t))+'</strong><small>'+ (motor?esc(directionName(o.direction))+' · '+o.count+' '+tr('шт.','pcs')+' · '+tr(external(o)?'снаружи':'внутри',external(o)?'external':'internal')+' · ':'')+fmt(objectMass(o))+' '+tr('т','t')+(t.group==='tank'?' · '+fmt(o.fill)+'%':'')+'</small></button><button class="delete" data-remove="'+i+'" aria-label="'+tr('Удалить объект','Remove object')+' '+(i+1)+'">×</button></div>';};
    const motor=m.objects.map((o,i)=>({o,i})).filter(({o})=>getType(o.type).group==='thruster');
    document.getElementById('balance-engines-list').innerHTML=motor.length?['Atmospheric','Hydrogen','Ion'].map(kind=>{const items=motor.filter(({o})=>family(getType(o.type))===kind);return items.length?'<h4 class="engine-family">'+familyName(kind)+'</h4>'+items.map(({o,i})=>row(o,i)).join(''):'';}).join(''):'<p class="muted small">'+tr('Двигатели пока не добавлены.','No engines added yet.')+'</p>';
    document.getElementById('balance-equipment-list').innerHTML=m.objects.map((o,i)=>getType(o.type).group==='thruster'?'':row(o,i)).join('')||'<p class="muted small">'+tr('Оборудование пока не добавлено.','No equipment added yet.')+'</p>';
  }
  function viewPanel(view){
    const cfg=projections[view],viewName=tr(cfg.ru,cfg.en);
    const axes=cfg.axes;
    const labels={length:tr('Длина','Length'),width:tr('Ширина','Width'),height:tr('Высота','Height')};
    return `<section class="hull-view" aria-label="${viewName}"><div class="schematic"><div class="schematic-zoom" role="group" aria-label="${tr('Масштаб схемы','Diagram zoom')}"><button type="button" data-zoom-step="-1" aria-label="${tr('Уменьшить масштаб','Zoom out')}" title="${tr('Уменьшить масштаб','Zoom out')}">−</button><output data-zoom-label aria-live="polite">${fmt(m.zoom*100)}%</output><button type="button" data-zoom-step="1" aria-label="${tr('Увеличить масштаб','Zoom in')}" title="${tr('Увеличить масштаб','Zoom in')}">+</button></div><div id="balance-${view}-canvas"></div><div class="hull-size-controls">${axes.map(k=>{
      const label=`${labels[k]} · ${tr('м','m')}`,id=`hull-${view}-${k}`;
      return `<div class="hull-size-control"><label for="${id}">${label}</label><input id="${id}-exact" class="hull-size-number" type="number" min="5" max="${geometry.hullLimits[k][1]}" step="0.1" value="${m[k]}" data-hull-dim="${k}" aria-label="${tr('Точное значение','Exact value')}: ${label} — ${viewName}"><input id="${id}" type="range" min="5" max="${geometry.hullLimits[k][1]}" step="0.1" value="${m[k]}" data-hull-dim="${k}" aria-label="${label} — ${viewName}"></div>`;
    }).join('')}</div></div><p class="hull-view-size" data-view-dimensions="${view}"></p>${view==='side'?deckPanel():''}</section>`;
  }
  function syncHullControls(){
    el.querySelectorAll('[data-hull-dim]').forEach(input=>{
      const v=m[input.dataset.hullDim]; input.min=5;input.max=geometry.hullLimits[input.dataset.hullDim][1];
      
      if(input!==document.activeElement)input.value=v;
    });
    el.querySelectorAll('[data-b]').forEach(input=>{if(input.dataset.b!=='mass'){input.min=5;input.max=geometry.hullLimits[input.dataset.b][1];}if(input!==document.activeElement)input.value=m[input.dataset.b];});
    el.querySelectorAll('[data-view-dimensions]').forEach(label=>{
      const cfg=projections[label.dataset.viewDimensions];
      label.textContent=`${tr('Корпус','Hull')}: ${fmt(dim(cfg.h))} × ${fmt(dim(cfg.v))} ${tr('м','m')} · ${cfg.axes.map(k=>({length:tr('длина','length'),width:tr('ширина','width'),height:tr('высота','height')}[k])).join(' × ')}`;
    });
  }
  function shell(){
    el.innerHTML=`<h2>Компоновка и баланс корабля</h2><p class="muted">Сначала расставь блоки и груз, проверь габарит, а затем передай расчётную массу на страницу условий полёта.</p><div class="quick"><button id="layout-export">${tr('Экспорт компоновки','Export layout')}</button><label class="button">${tr('Импорт компоновки','Import layout')}<input id="layout-import" type="file" accept="application/json" hidden></label></div><p id="layout-storage-status" class="hint"></p><p id="layout-message" role="status">${esc(layoutMessage)}</p>${storageState.recovery?'<div class="notice">'+tr('Сохранена резервная копия схемы, которую не удалось загрузить.','A recovery copy of a layout that could not be loaded is available.')+' <button id="layout-recovery">'+tr('Скачать исходные данные','Download original data')+'</button></div>':''}<div class="quick balance-fill"><span>Заполнение задаётся отдельно в карточке каждого объекта.</span><button id="balance-focus">Приблизить выбранный объект</button><button id="balance-zoom-reset">${tr('Показать корабль целиком','Fit whole ship')}</button></div><div class="legend"><span class="engine-legend">${tr('Фиолетовые блоки Д№ — двигатели; подпись помогает найти маленький блок. ⊙ к вам · ⊗ от вас.','Purple E# blocks are engines; labels locate small blocks. ⊙ toward you · ⊗ away.')}</span><span>◆ Центр с грузом</span><span>＋ Центр остального корабля</span><span>Цвет показывает величину смещения</span></div><div id="balance-indicator"></div><div id="thrust-summary"></div><div id="balance-views">${viewPanel('top')}${viewPanel('side')}<details class="extra-projection"><summary>${tr('Дополнительно: вид спереди','Additional: front view')}</summary>${viewPanel('front')}</details></div><p class="hint">${tr('Подгоняй корпус ползунками прямо на каждой схеме или вводи точные размеры в метрах. Общие размеры синхронизированы между тремя видами. Размеры и положение оборудования при этом не меняются. Пунктир показывает габарит корпуса без учёта толщины обшивки и проходов.','Resize the hull with the sliders inside each view or enter exact dimensions in metres. Shared dimensions stay synchronized across all three views. Equipment keeps its size and position. The dashed outline marks the hull envelope; allow extra room for hull thickness and access.')}</p><p class="muted small">${tr('Вид сверху: длина × ширина; спереди: ширина × высота; сбоку: длина × высота. Масштаб метров одинаковый и не меняется от размеров корпуса. Чтобы вместить корпус в кадр, нажми «Показать корабль целиком».','Top: length × width; front: width × height; side: length × height. Both views use the same fixed metre scale. Use Fit whole ship to fit the hull in view.')} Схема показывает габаритные контуры, не копирует текстуры модели.</p><div class="balance-controls"><details class="ship-envelope"><summary>Масса и размер корпуса</summary><div class="fields"><label>Масса остального корабля, т<input type="number" min="0.001" step="any" data-b="mass" value="${m.mass}"></label>${['length','width','height'].map((k,i)=>`<label>${['Длина','Ширина','Высота'][i]}, м<input type="number" min="5" max="${geometry.hullLimits[k][1]}" step="0.1" data-b="${k}" value="${m[k]}"></label>`).join('')}</div><p class="hint">Масса остального корабля включает всё, кроме перечисленных блоков и их содержимого. Размеры задают масштаб корпуса; исходные габариты блоков приблизительные и поправляются в карточке.</p><details><summary>Уточнить центр остального корабля</summary><p class="muted small">Координаты относительно середины корпуса, в метрах. Если положение неизвестно, оставь 0.</p>${['Нос + / корма −','Левый борт + / правый −','Верх + / низ −'].map((t,i)=>`<label class="balance-coordinate">${t}<input type="number" step="any" data-origin="${i}" value="${m.origin[i]}"></label>`).join('')}</details></details></div><div class="balance-layout"><div>${objectSections()}<div id="balance-editor"></div></div><div id="balance-result"></div></div><p class="hint">У каждого грузового контейнера своя масса, у каждого бака — своё заполнение и отдельно заданная масса газа. Генераторы не получают общий режим «пустой/полный». Габариты на схеме редактируются, но точные три измерения модели для всех блоков в каталоге игры не опубликованы.</p><details><summary>Источники данных блоков</summary><ul><li><a href="https://spaceengineers2.wiki.gg/wiki/Cargo_Container_1.5_m" target="_blank" rel="noreferrer">Грузовые контейнеры SE2 Wiki</a></li><li><a href="https://spaceengineers2.wiki.gg/wiki/Hydrogen_Tank_1.5_m" target="_blank" rel="noreferrer">Водородные баки</a>, <a href="https://spaceengineers2.wiki.gg/wiki/Oxygen_Tank_1.5_m" target="_blank" rel="noreferrer">кислородный бак</a></li><li><a href="https://spaceengineers2.wiki.gg/wiki/O2_H2_Generator_1.5_m" target="_blank" rel="noreferrer">Генераторы O₂/H₂</a></li></ul></details>`;
    draw();
  }
  function svg(view){
    const cfg=projections[view],side=view==='front';
    const horizontal=cfg.h,axis=cfg.v,scale=m.viewScale*m.zoom;
    const x=v=>280+(v-(m.focus?.[horizontal]||0))*scale,y=v=>130-(v-(m.focus?.[axis]||0))*scale;
    const L=dim(horizontal)*scale/2,H=dim(axis)*scale/2;
    const shape=view==='front'
      ? '<path class="hull-body" d="M -1 -.72 L -.78 -1 H .78 L 1 -.72 V 1 H -1 Z"/><path class="ship-canopy" d="M -.3 -.64 H .3 V -.32 H -.3 Z"/>'
      :view==='side'
        ? '<path class="hull-body" d="M -1 -1 H .38 L .55 -.64 H .76 L 1 .1 V 1 H -1 Z"/><path class="ship-canopy" d="M .58 -.48 H .73 L .86 -.12 H .58 Z"/><path class="ship-panel" d="M -.91 -.85 V .85 M .4 -.8 V .85"/>'
        : '<path class="hull-body" d="M -1 -1 H .55 L 1 -.36 V .36 L .55 1 H -1 Z"/><path class="ship-canopy" d="M .77 -.28 L .9 -.18 V .18 L .77 .28 Z"/><path class="ship-panel" d="M -.91 -.85 V .85 M .58 -.89 V .89"/>';
    const ship=`<rect class="hull-envelope" x="${x(-dim(horizontal)/2)}" y="${y(dim(axis)/2)}" width="${L*2}" height="${H*2}"/><g class="ship-drawing" transform="translate(${x(0)} ${y(0)}) scale(${L} ${H})">${shape}</g>`;
    const blocks=m.objects.map((o,i)=>({o,i})).sort((a,b)=>(a.i===selected)-(b.i===selected)).map(({o,i})=>{
      const typ=getType(o.type),w=objectDims(o)[horizontal]*scale,h=objectDims(o)[axis]*scale,cx=x(o.pos[horizontal]),cy=y(o.pos[axis]),rx=Math.max(1,Math.min(w,h)*.13);
      const body=typ.group==='tank'?`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${Math.min(w,h)/2}"/><path class="object-detail" d="M ${-w*.25} ${-h/2} V ${h/2} M ${w*.25} ${-h/2} V ${h/2}"/>`
        :typ.group==='generator'?`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${rx}"/><circle class="object-detail" cx="0" cy="0" r="${Math.max(2,Math.min(w,h)*.19)}"/>`
        :typ.group==='thruster'?`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${rx}"/><circle class="object-detail" cx="0" cy="0" r="${Math.max(2,Math.min(w,h)*.2)}"/>`
        :`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${rx}"/><path class="object-detail" d="M ${-w/2} 0 H ${w/2} M 0 ${-h/2} V ${h/2}"/>`;
      const dirText=typ.group==='thruster'?(side?({up:'↑',down:'↓',left:'→',right:'←',forward:'⊙',back:'⊗'}[o.direction]||''):view==='side'?({up:'↑',down:'↓',forward:'→',back:'←',left:'⊗',right:'⊙'}[o.direction]||''):({forward:'→',back:'←',left:'↑',right:'↓',up:'⊙',down:'⊗'}[o.direction]||'')):'';
      const labelY=-h/2-12-(i%3)*12;
      const badge=typ.group==='thruster'?'<rect class="engine-hit" x="'+(-Math.max(22,w)/2)+'" y="'+(-Math.max(22,h)/2)+'" width="'+Math.max(22,w)+'" height="'+Math.max(22,h)+'"/><path class="engine-leader" d="M 0 0 L '+(w/2+7)+' '+labelY+'"/><text class="engine-label" x="'+(w/2+9)+'" y="'+labelY+'">'+tr('Д','E')+(i+1)+' '+dirText+(o.count>1?' ×'+o.count:'')+'</text>':'';
      return `<g data-container="${i}" class="layout-object object-${typ.group} ${i===selected?'selected':''}" transform="translate(${cx} ${cy})"><title>${esc(name(typ))} · ${fmt(objectMass(o))} т${typ.group==='tank'?` · ${fmt(o.fill)}%`:''}</title>${body}${badge}<text text-anchor="middle" dominant-baseline="middle">${typ.group==='thruster'?'':i+1}</text></g>`;
    }).join('');
    const deckLines=view!=='top'?m.decks.map((f,i)=>{const yy=y((f-.5)*m.height);return '<g data-deck-divider="'+i+'" class="deck-divider"><line x1="'+x(-dim(horizontal)/2)+'" x2="'+x(dim(horizontal)/2)+'" y1="'+yy+'" y2="'+yy+'"/><rect x="'+(x(dim(horizontal)/2)-12)+'" y="'+(yy-5)+'" width="12" height="10" fill="#ffd166"/><text x="'+(x(-dim(horizontal)/2)+4)+'" y="'+(yy-4)+'">'+(i+1)+' · '+fmt(f*m.height)+' m</text></g>';}).join(''):'';
    return `<svg class="balance-svg balance-${displacement(m).level}" viewBox="0 0 560 260" data-view="${view}" role="img" aria-label="${tr(cfg.ru,cfg.en)} корабля"><text x="16" y="24" class="view-label">${tr(cfg.ru,cfg.en).toUpperCase()} · ${fmt(m.zoom*100)}%</text>${ship}<path d="M 30 ${y(0)} H 530 M ${x(0)} 40 V 220" class="ship-grid"/><text x="12" y="244">${side?tr('ПРАВЫЙ БОРТ','STARBOARD'):tr('КОРМА','AFT')}</text><text x="440" y="244">${side?tr('ЛЕВЫЙ БОРТ','PORT'):tr('НОС →','NOSE →')}</text>${deckLines}${blocks}${thrustArrows(view)}<g class="origin-marker" transform="translate(${x(m.origin[horizontal])},${y(m.origin[axis])})"><circle r="9"/><path d="M -7 0 H 7 M 0 -7 V 7"/></g><path class="center-trail" d="M ${x(m.origin[horizontal])} ${y(m.origin[axis])} L ${x(center(m).pos[horizontal])} ${y(center(m).pos[axis])}"/><path class="center-marker" d="M ${x(center(m).pos[horizontal])} ${y(center(m).pos[axis])-8} l 8 8 -8 8 -8 -8 Z"/></svg>`;
  }
  function draw(skipEditor=false){
    const r=center(m),state=displacement(m),warn=collisions();el.dataset.level=state.level;
    document.getElementById('balance-indicator').innerHTML=`<div class="balance-state"><strong>${state.label}</strong><span>${fmt(state.score*100)}% от половины размера корпуса</span></div>${warn.length?`<div class="layout-warning">${warn.map(w=>w.type==='outside'?`Объект ${w.i+1}: выступает за корпус.`:`Объекты ${w.i+1} и ${w.j+1}: габариты пересекаются.`).join(' ')}</div>`:'<p class="goodtext small">Внутренние объекты помещаются в корпус; габариты оборудования не пересекаются.</p>'}<p class="small muted">Цвет — условная оценка смещения центра массы, не прогноз безопасности полёта.</p>`;
    for(const view of Object.keys(projections))document.getElementById('balance-'+view+'-canvas').innerHTML=svg(view);
    document.getElementById('thrust-summary').innerHTML=thrustSummary();
    syncHullControls();
    syncDecks();
    el.querySelectorAll('[data-zoom-label]').forEach(e=>e.textContent=`${fmt(m.zoom*100)}%`);
    el.querySelectorAll('[data-zoom-step]').forEach(b=>b.disabled=Number(b.dataset.zoomStep)<0?m.zoom<=.5:m.zoom>=4);
    objectLists();
    const o=m.objects[selected],typ=o&&getType(o.type);if(!skipEditor)document.getElementById('balance-editor').innerHTML=o?objectEditor(o,typ):'<p>Добавь объект, чтобы изменить его положение.</p>';
    document.getElementById('balance-result').innerHTML=`<h3>Итог компоновки</h3><div class="balance-metrics"><div><strong>${fmt(r.total)} т</strong><span>Масса корпуса, блоков и содержимого</span></div><div><strong>${fmt(r.blocks)} т</strong><span>Масса блоков с известной массой</span></div><div><strong>${fmt(r.cargo)} т</strong><span>Груз и вручную заданная масса содержимого</span></div><div><strong>${fmt(r.delta[0])} м · ${fmt(r.delta[1])} м · ${fmt(r.delta[2])} м</strong><span>Смещение центра: длина · ширина · высота</span></div></div><button id="balance-apply" class="primary">Передать массу и установленные двигатели в расчёт</button>`;
    const need=geometry.required(m,flight().engines,false),fits=need.every((v,i)=>v<=dim(i)+.001),f=totals(),weight=r.total*flight().g*9.81;
    document.getElementById('balance-result').insertAdjacentHTML('beforeend','<h3>'+tr('Габариты основного корпуса','Main hull envelope')+'</h3><p class="'+(fits?'goodtext':'layout-warning')+'">'+tr(fits?'Помещается по габаритам.':need.some((v,i)=>v>geometry.hullLimits[['length','width','height'][i]][1])?'Оборудование не помещается в допустимый корпус. Переставьте блоки или уменьшите их количество.':'Нужно увеличить корпус.',fits?'Fits the hull envelope.':'Equipment does not fit. Enlarge within limits or rearrange blocks.')+'</p><p>'+tr('При текущем расположении Д × Ш × В:','At current positions L × W × H:')+' <strong>'+need.map(v=>fmt(v)).join(' × ')+' '+tr('м','m')+'</strong></p><button id="fit-hull">'+tr('Увеличить корпус до габарита','Expand hull to envelope')+'</button><p class="small muted">'+tr('Одинаковые двигатели стоят в один ряд; их количество увеличивает занимаемое место. Подсказка не учитывает проходы и струю. Размер одного двигателя задаётся в карточке: каталожный размер пока номинальный, точные три оси не подтверждены.','Identical engines occupy a row. Counts increase their envelope. Access and exhaust clearance are excluded. Edit individual engine dimensions in its card: catalogue dimensions are nominal, the three axes remain unverified.')+'</p><p>'+tr('Размеры корпуса: длина 5–200 м; ширина и высота 5–20 м. Длина не больше 10 ширин или высот; корпус не выше своей ширины. Связанные размеры меняются вместе.','Hull limits: length 5–200 m; width and height 5–20 m.')+'</p><h3>'+tr('Тяга показанного оснащения','Displayed engine thrust')+'</h3><p class="'+(f.up>=weight?'goodtext':'layout-warning')+'">'+tr(f.up>=weight?'По вертикальной тяге удерживает высоту.':'Вертикальной тяги недостаточно.',f.up>=weight?'Vertical thrust can hold altitude.':'Insufficient vertical thrust.')+' '+fmt(f.up)+' / '+fmt(weight)+' kN</p><p class="small muted">'+tr('Цвет стрелок показывает достаточность тяги с учётом ускорений и запаса в текущей среде; этапы проверяются во вкладке «Полёт». Длина и толщина показывают относительную силу. Учитывается атмосфера из условий полёта. Питание и топливо проверяются на странице расчёта.','Arrows show force direction; length and brightness use the maximum across all six directions. Flight atmosphere is applied. Check power and fuel on the flight page.')+'</p>');
    const outsideEngines=m.objects.filter(o=>external(o)&&o.pos.some((v,k)=>Math.abs(v)+objectDims(o)[k]/2>dim(k)/2+.001)).length;
    if(outsideEngines)document.getElementById('balance-indicator').insertAdjacentHTML('beforeend','<p class="external-note">'+tr('Наружное размещение двигателей: ','External engines: ')+outsideEngines+tr('. Допустимо; основной корпус не расширяется под них.','. Allowed; hull fitting excludes them.')+'</p>');
    m.contentsSchema=1;persist();
  }
  function activatePage(id){const b=document.querySelector(`nav [data-page="${id}"]`);if(b)b.click();}
  el.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='layout-export'){downloadLayout(JSON.stringify({kind:'se2-layout',version:1,layout:m},null,2),'se2-layout.json');return;}
    if(b.id==='layout-recovery'){downloadLayout(storageState.recovery,'se2-layout-recovery.json');return;}
    if(b.dataset.zoomStep!==undefined){m.zoom=Math.max(.5,Math.min(4,Math.round((m.zoom+Number(b.dataset.zoomStep)*.1)*10)/10));}

    else if(b.dataset.decks!==undefined){const n=Number(b.dataset.decks);m.decks=Array.from({length:n-1},(_,i)=>(i+1)/n);}
    else if(b.id==='fit-hull'){const need=geometry.required(m,flight().engines,false);['length','width','height'].forEach((k,i)=>m[k]=geometry.clampHull(k,Math.max(m[k],need[i])));Object.assign(m,geometry.proportionHull(m));}
    else if(b.dataset.cargoPreset!==undefined){const t=getType(m.objects[selected]?.type);m.objects[selected].load=b.dataset.cargoPreset==='full'?t.capacity:b.dataset.cargoPreset==='half'?t.capacity/2:0;}
    else if(b.dataset.placeDeck!==undefined){const o=m.objects[selected],i=Number(b.dataset.placeDeck),bounds=deckBounds();if(o&&objectDims(o)[2]<=(bounds[i+1]-bounds[i])*m.height+.001)o.pos[2]=(bounds[i]-.5)*m.height+objectDims(o)[2]/2;}
    else if(b.dataset.tankFill!==undefined){if(m.objects[selected])m.objects[selected].fill=Number(b.dataset.tankFill);}
    else if(b.dataset.select!==undefined)selected=Number(b.dataset.select);
    else if(b.dataset.remove!==undefined){m.objects.splice(Number(b.dataset.remove),1);selected=Math.max(0,Math.min(selected,m.objects.length-1));}
    else if(b.dataset.addGroup){if(m.objects.length>=MAX_OBJECTS){document.getElementById('layout-message').textContent=tr('Достигнут предел: 200 объектов. Группируйте одинаковые двигатели полем количества.','Limit reached: 200 objects. Group identical engines using the count field.');return;}const choice=document.getElementById('balance-'+b.dataset.addGroup+'-type'),t=catalog.find(t=>t.id===choice.value&&((t.group==='thruster')===(b.dataset.addGroup==='engines')));if(!t)return;const o=initialObj(t.id,t.group==='cargo'?t.capacity:0,[0,0,0]);if(t.group==='thruster'){const direction=document.getElementById('balance-engine-direction').value;if(!root.Flight.dirs.includes(direction))return;o.direction=direction;placeEngine(o);}m.objects.push(o);selected=m.objects.length-1;choice.value='';syncAddControls();if(t.group==='thruster'){m.viewScale=fitScale();m.zoom=1;m.focus=[0,0,0];}}
    else if(b.id==='balance-focus'){const o=m.objects[selected];if(o)m.focus=[...o.pos];m.zoom=Math.max(m.zoom,2);}
    else if(b.id==='balance-zoom-reset'){m.zoom=1;m.focus=[0,0,0];m.viewScale=fitScale();}
    else if(b.id==='balance-reset'){m=fresh();m.viewScale=fitScale();selected=0;shell();return;}
    else if(b.id==='balance-apply'){const total=center(m).total;root.SE2FlightApp?.applyLayout(total,m.objects);activatePage('setup');return;}
    else return;
    draw();
    if(b.dataset.addGroup==='engines')document.getElementById('balance-top-canvas').scrollIntoView({block:'center',behavior:'smooth'});
  });
  function validNumericInput(t){
    if(!['number','range'].includes(t.type))return true;
    const v=Number(t.value),positive=t.dataset.b!==undefined||t.dataset.dim!==undefined;
    return t.value!==''&&finite(v)&&(!positive||v>0)&&(!(t.dataset.object==='load')||v>=0)&&(!(t.dataset.object==='fill')||v>=0&&v<=100)&&(!(t.dataset.object==='count')||Number.isInteger(v)&&v>=1&&v<=1e6);
  }
  el.addEventListener('input',e=>{
    const t=e.target,o=m.objects[selected],n=Number(t.value);
    if(!validNumericInput(t)){t.setAttribute('aria-invalid','true');document.getElementById('layout-message').textContent=tr('Недопустимое число. Расчёт сохраняет последнее допустимое значение; исправьте поле.','Invalid number. The calculation retains the last valid value; correct this field.');return;}t.removeAttribute('aria-invalid');if(!el.querySelector('[aria-invalid="true"]'))document.getElementById('layout-message').textContent='';
    if(t.dataset.addChoice){syncAddControls();return;}
    if(t.dataset.deck!==undefined){if(t.value!==''&&Number.isFinite(n)){moveDeck(+t.dataset.deck,n/m.height);draw(true);}return;}
    if(t.dataset.hullDim!==undefined){if(t.value!==''&&Number.isFinite(n)){setHullDimension(t.dataset.hullDim,n);draw(true);}return;}
    if(t.dataset.b!==undefined&&t.value!==''&&Number.isFinite(n)&&n>0){if(t.dataset.b==='mass')m.mass=n;else setHullDimension(t.dataset.b,n);draw(true);return;}
    if(t.dataset.object==='load'&&o){o.load=Math.max(0,Number(t.value)||0);draw(true);}
    else if(t.dataset.object==='fill'&&o){o.fill=Math.max(0,Math.min(100,n));draw(true);}
    else if(t.dataset.object==='count'&&o){o.count=Math.max(1,Math.floor(n||1));draw(true);}
    else if(t.dataset.object==='external'&&o){o.external=t.value==='external';draw(true);}
    else if(t.dataset.object==='direction'&&o){o.direction=t.value;draw(true);}
    else if(t.dataset.pos!==undefined&&o){o.pos[+t.dataset.pos]=Number(t.value);draw(true);}
    else if(t.dataset.dim!==undefined&&o){const v=Number(t.value);if(v>0){o.dim[+t.dataset.dim]=v;o.customDimensions=true;}draw(true);}
    else if(t.dataset.zoom!==undefined){m.zoom=Math.max(.5,Math.min(4,n||1));draw(true);}
  });
  el.addEventListener('change',async e=>{
    if(e.target.id==='layout-import'){try{const file=e.target.files[0];if(!file)return;if(file.size>1000000)throw Error(tr('Файл превышает 1 МБ.','File exceeds 1 MB.'));const data=JSON.parse(await file.text());if(data.kind!=='se2-layout'||data.version!==1)throw Error(tr('Это не файл компоновки.','This is not a layout file.'));const next=restoreLayout(data.layout);Object.assign(next,geometry.proportionHull(next));m=next;selected=0;m.viewScale=fitScale();layoutMessage=tr('Компоновка импортирована. Профиль полёта не изменён.','Layout imported. Flight profile unchanged.');shell();}catch(err){document.getElementById('layout-message').textContent=tr('Ошибка импорта: ','Import error: ')+err.message;}finally{e.target.value='';}return;}
    const t=e.target,v=Number(t.value);
    if(!validNumericInput(t)){layoutMessage=tr('Некорректное число: восстановлено последнее допустимое значение.','Invalid number: restored the last valid value.');shell();return;}
    if(t.dataset.addChoice){syncAddControls();return;}
    if(t.dataset.deck!==undefined){if(t.value!==''&&Number.isFinite(v))moveDeck(+t.dataset.deck,v/m.height);draw();}
    else if(t.dataset.hullDim!==undefined){if(t.value!==''&&Number.isFinite(v))setHullDimension(t.dataset.hullDim,v);t.value=m[t.dataset.hullDim];draw();}
    else if(t.dataset.b){if(!Number.isFinite(v)||(t.dataset.b==='mass'&&v<=0))return;if(t.dataset.b==='mass')m.mass=v;else setHullDimension(t.dataset.b,v);shell();}
    else if(t.dataset.origin!==undefined){m.origin[+t.dataset.origin]=bound(v,+t.dataset.origin);shell();}
    else if(t.dataset.dim!==undefined&&v>0){m.objects[selected].dim[+t.dataset.dim]=v;shell();}
    else if(t.dataset.object==='load'&&v>=0){m.objects[selected].load=v;draw();}
    else return;
  });
  let drag=null;
  el.addEventListener('pointerdown',e=>{const divider=e.target.closest('[data-deck-divider]'),b=divider||e.target.closest('[data-container]');if(!b)return;if(!divider)selected=Number(b.dataset.container);const svg=b.closest('svg');drag={id:e.pointerId,view:svg.dataset.view,board:svg,deck:divider?Number(divider.dataset.deckDivider):null};el.setPointerCapture(e.pointerId);e.preventDefault();});
  el.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const rect=drag.board.getBoundingClientRect(),ratio=Math.min(rect.width/560,rect.height/260),px=(e.clientX-rect.left-(rect.width-560*ratio)/2)/ratio,py=(e.clientY-rect.top-(rect.height-260*ratio)/2)/ratio,horizontal=projections[drag.view].h,axis=projections[drag.view].v,scale=m.viewScale*m.zoom,o=m.objects[selected];if(drag.deck!==null){moveDeck(drag.deck,((130-py)/scale+(m.focus?.[2]||0)+m.height/2)/m.height);}else{o.pos[horizontal]=objectBound((px-280)/scale+(m.focus?.[horizontal]||0),horizontal,o);o.pos[axis]=objectBound((130-py)/scale+(m.focus?.[axis]||0),axis,o);}draw();drag.board=el.querySelector(`svg[data-view="${drag.view}"]`);});
  el.addEventListener('pointerup',()=>{if(drag){drag=null;draw();}});el.addEventListener('pointercancel',()=>{drag=null;draw();});
  document.addEventListener('se2-flight-change',()=>draw());
  document.addEventListener('se2-language-change',()=>shell());
  shell();
})(globalThis);
