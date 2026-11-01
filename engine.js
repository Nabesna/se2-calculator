(function(root){
'use strict';
const dirs=['up','down','forward','back','left','right'];
const names=['Вверх','Вниз','Вперёд','Назад / торможение','Влево','Вправо'];
const clamp=x=>Math.max(0,Math.min(1,x));
function efficiency(kind,density){if(kind==='Hydrogen')return 1;return clamp(kind==='Ion'?(0.8-density)/0.6:(density-0.2)/0.6);}
function validate(s){
 if(!s||!Array.isArray(s.targets)||s.targets.length!==6||!Array.isArray(s.rows)||s.rows.length>100||!Array.isArray(s.engines)||s.engines.length>100||!Array.isArray(s.phases)||s.phases.length>200||!s.battery||!s.tank)throw Error('Неверная структура профиля.');
 if(typeof s.loaded!=='boolean'||typeof s.growMass!=='boolean')throw Error('Флаги профиля должны быть логическими значениями.');
 if(s.rows.some(r=>!r||!Array.isArray(r.counts)||r.counts.length!==6)||s.phases.some(p=>!p||typeof p.name!=='string'))throw Error('Неверная структура двигателей или этапов.');
 const nonneg=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e12)throw Error('Проверьте поле «'+label+'»: нужно число от 0 до 10¹².');};
 ['base','cargo','g','density','margin','speed','hotel','generator','charge','reserve','tankFill','fuelMass'].forEach(k=>nonneg(s[k],k));
 if(s.base+(s.loaded?0:s.cargo)<=0)throw Error('Суммарная масса должна быть больше нуля.');
 if(!['existing','new'].includes(s.mode)||s.targets.length!==6||s.rows.some(r=>r.counts.length!==6))throw Error('Неверный режим или число направлений в профиле.');
 if(s.charge>100||s.reserve>=100||s.tankFill>100||s.density>1)throw Error('Проверьте проценты и плотность атмосферы (0…1).');
 if(s.charge<s.reserve)throw Error('Заряд батарей не может быть ниже неприкосновенного остатка.');
 s.targets.forEach(v=>nonneg(v,'ускорение'));
 for(let e of s.engines){['thrust','power','h2'].forEach(k=>nonneg(e[k],e.name+' '+k));if(e.mass!==null)nonneg(e.mass,e.name+' масса'); if(e.factor!==null){nonneg(e.factor,'эффективность');if(e.factor>1)throw Error('Эффективность должна быть 0…1.');}}
 for(let r of s.rows){if(!s.engines.some(e=>e.id===r.id))throw Error('Неизвестный двигатель');r.counts.forEach(v=>{nonneg(v,'число двигателей');if(!Number.isInteger(v)||v>1e6)throw Error('Число блоков должно быть целым, не более 1 000 000.');});}
 for(let k of ['battery','tank']){let b=s[k]; for(let n of (k==='battery'?['power','energy']:['capacity','flow']))nonneg(b[n],k+' '+n);if(b.mass!==null)nonneg(b.mass,k+' масса');}
 ['nb','nt'].forEach(k=>{nonneg(s[k],k);if(!Number.isInteger(s[k])||s[k]>1e6)throw Error('Число батарей/баков должно быть целым до 1 000 000.');});
 s.phases.forEach(p=>{nonneg(p.seconds,'длительность');if(p.g!=null)nonneg(p.g,'гравитация этапа');if(p.density!=null){nonneg(p.density,'атмосфера этапа');if(p.density>1)throw Error('Атмосфера этапа должна быть 0…1.');}for(let k of ['x','y','z'])if(!Number.isFinite(p[k])||Math.abs(p[k])>1e12)throw Error('Ускорения этапов должны быть числами.');});
}
function perMass(s){let g=s.g*9.81;let a=s.targets.map((v,i)=>Math.max(0,v+(i===0?g:i===1?-g:0)));for(let p of s.phases.filter(p=>p.seconds>0)){[(p.g??s.g)*9.81+p.y,p.x,p.z].forEach((v,j)=>{let i=j*2+(v<0?1:0);a[i]=Math.max(a[i],Math.abs(v));});}return a.map(v=>v*(1+s.margin/100));}
function required(s,m){return perMass(s).map(a=>m*a/1000);}
function hardware(s,rows,nb,nt){let total=0;for(let r of rows){let n=r.counts.reduce((a,b)=>a+b,0),e=s.engines.find(e=>e.id===r.id);if(n&&e.mass===null)throw Error('Для подбора укажите массу: '+e.name+' (кг).'); total+=n*(e.mass||0);}
 if(nb&&s.battery.mass===null)throw Error('Для подбора укажите массу выбранной батареи (кг).');
 if(nt&&s.tank.mass===null)throw Error('Для подбора укажите массу выбранного бака (кг).');
 return total+nb*(s.battery.mass||0)+nt*(s.tank.mass||0);}
function environment(s,p={}){return {g:p.g??s.g,density:p.density??s.density};}
function forces(s,p,m){let d=Array(6).fill(0);[m*((p.g??s.g)*9.81+p.y)/1000,m*p.x/1000,m*p.z/1000].forEach((f,j)=>d[j*2+(f<0?1:0)]=Math.abs(f));return d;}
function capacities(s,rows,density){const thrust=Array(6).fill(0),pw=Array(6).fill(0),gas=Array(6).fill(0);for(const r of rows){const e=s.engines.find(e=>e.id===r.id),f=e.factor??efficiency(e.kind,density);r.counts.forEach((n,i)=>{thrust[i]+=n*e.thrust*f;if(f>0){pw[i]+=n*e.power;gas[i]+=n*e.h2;}});}return {thrust,pw,gas};}
function constraints(s,m){const k=1+s.margin/100,g=s.g*9.81;return [{density:s.density,need:s.targets.map((v,i)=>Math.max(0,v+(i===0?g:i===1?-g:0))*m*k/1000)},...s.phases.filter(p=>p.seconds>0).map(p=>({density:p.density??s.density,need:forces(s,p,m).map(f=>f*k)}))];}
function metrics(s,rows,nb,nt,m){
 const {thrust,pw,gas}=capacities(s,rows,s.density),scenarios=constraints(s,m);
 const peaks=d=>Math.max(d[0],d[1])+Math.max(d[2],d[3])+Math.max(d[4],d[5]);
 let peak=0,gasPeak=0;for(const c of scenarios){const a=capacities(s,rows,c.density);peak=Math.max(peak,s.hotel+peaks(a.pw));gasPeak=Math.max(gasPeak,peaks(a.gas));}
 const usable=s.battery.energy*nb*(s.charge-s.reserve)/100,fuel=s.tank.capacity*nt*s.tankFill/100;
 let energy=0,volume=0,seconds=0,phaseResults=[];
 for(const p of s.phases.filter(p=>p.seconds>0)){
  const env=environment(s,p),a=capacities(s,rows,env.density),demand=forces(s,p,m);let power=s.hotel,h2=0,ok=true;
  demand.forEach((f,i)=>{const q=f===0?0:a.thrust[i]>0?f/a.thrust[i]:Infinity;if(q>1+1e-9)ok=false;power+=a.pw[i]*Math.min(q,1);h2+=a.gas[i]*Math.min(q,1);});
  const stageEnergy=Math.max(0,power-s.generator)*p.seconds/3600,stageVolume=h2*p.seconds;
  energy+=stageEnergy;volume+=stageVolume;seconds+=p.seconds;
  phaseResults.push({...p,...env,power,h2,ok,stageEnergy,stageVolume,energyLeft:usable-energy,fuelLeft:fuel-volume,resourcesOK:energy<=usable+1e-9&&volume<=fuel+1e-9&&power<=s.generator+nb*s.battery.power+1e-9&&h2<=nt*s.tank.flow+1e-9});
 }
 const accel=thrust.map((f,i)=>f*1000/m+(i===0?-s.g*9.81:i===1?s.g*9.81:0));
 const req=scenarios[0].need,shortages=req.map((f,i)=>Math.max(0,f-thrust[i]));
 const batteryPower=usable>0?nb*s.battery.power:0;
 const powerOK=s.generator+batteryPower+1e-9>=peak,energyOK=usable+1e-9>=energy;
 const fuelOK=(gasPeak===0||fuel>0)&&fuel+1e-9>=volume&&nt*s.tank.flow+1e-9>=gasPeak;
 let limit=Infinity,missionThrustOK=true;for(const c of scenarios){const a=capacities(s,rows,c.density);c.need.forEach((f,i)=>{if(f>0){limit=Math.min(limit,a.thrust[i]*m/f);if(a.thrust[i]+1e-7<f)missionThrustOK=false;}});}
 const coast=a=>s.speed===0?0:a>0?s.speed*s.speed/(2*a):Infinity,netPeak=Math.max(0,peak-s.generator);
 return {m,rows,nb,nt,thrust,pw,gas,peak,gasPeak,energy,volume,seconds,phaseResults,usable,fuel,batteryPower,accel,req,shortages,powerOK,energyOK,fuelOK,missionThrustOK,stop:coast(accel[3]),stopVertical:coast(accel[0]),limit,cargoLimit:limit-s.base*1000,duration:netPeak?usable/netPeak*3600:Infinity,ok:missionThrustOK&&powerOK&&energyOK&&fuelOK&&phaseResults.every(p=>p.ok&&p.resourcesOK)};
}
function chooseEngine(s,density,policy='auto'){
 const kind=policy==='auto'?(density>=0.8?'Atmospheric':density<=0.2?'Ion':'Hydrogen'):policy;
 const candidates=s.engines.filter(e=>e.kind===kind&&(e.factor??efficiency(e.kind,density))>0&&e.thrust>0);
 if(!candidates.length)throw Error('Выбранный тип двигателя не работает в одной из сред миссии. Выберите авто или водород.');
 // Prefer a medium nominal engine; sizing is not a global mass/cost optimization.
 return candidates.find(e=>e.id===(kind==='Hydrogen'?'Hydrogen2.5':kind==='Ion'?'Ion5':'Atmospheric5'))||candidates[0];
}
function autofill(s,policy='auto'){
 const draft=structuredClone(s);draft.rows=draft.rows.filter(r=>r.id);draft.mode='new';draft.growMass=false;draft.autoPolicy=policy;
 const result=calculate(draft);return result;
}
function calculate(s){validate(s);let rows=[];for(const row of s.rows){let found=rows.find(r=>r.id===row.id);if(found)found.counts=found.counts.map((n,i)=>n+row.counts[i]);else rows.push(structuredClone(row));}let nb=s.nb,nt=s.nt;
 const baseMass=(s.base+(s.loaded?0:s.cargo))*1000;
 if(s.mode==='existing')return metrics(s,rows,nb,nt,baseMass);
 // Monotonic fixed point: never remove already selected blocks.
 let last='';for(let iter=0;iter<400;iter++){
  let m=baseMass+(s.growMass?s.fuelMass*1000+hardware(s,rows,nb,nt):0); if(m>1e13)throw Error('Подбор расходится: добавленная масса требует всё больше блоков. Измените оснащение или цели.');
  let r=metrics(s,rows,nb,nt,m),need=required(s,m);
  for(const c of constraints(s,m))for(let i=0;i<6;i++){let deficit=c.need[i]-capacities(s,rows,c.density).thrust[i];if(deficit<=1e-7)continue;let e=s.autoPolicy?chooseEngine(s,c.density,s.autoPolicy):s.engines.find(e=>e.id===s.preferred[i]);if(!e)throw Error('Выберите двигатель для направления '+names[i]);let t=e.thrust*(e.factor??efficiency(e.kind,c.density));if(t<=0)throw Error(names[i]+': выбранный двигатель не создаёт тягу в одной из сред миссии.');let row=rows.find(r=>r.id===e.id);if(!row){row={id:e.id,counts:Array(6).fill(0)};rows.push(row);}row.counts[i]+=Math.ceil(deficit/t-1e-12);}
  r=metrics(s,rows,nb,nt,m);
  let bp=Math.max(0,r.peak-s.generator),be=r.energy,den=s.battery.energy*(s.charge-s.reserve)/100;
  if(bp>0&&(s.battery.power<=0||den<=0)||be>0&&den<=0)throw Error('Выбранная батарея не покрывает требуемую мощность/энергию.');
  nb=Math.max(nb,bp?Math.ceil(bp/s.battery.power-1e-12):0,be?Math.ceil(be/den-1e-12):0);
  if(r.gasPeak>0&&(s.tank.capacity*s.tankFill<=0||s.tank.flow<=0))throw Error('Нужен бак с ненулевыми запасом и отдачей H₂.');
  nt=Math.max(nt,r.volume?Math.ceil(r.volume/(s.tank.capacity*s.tankFill/100)-1e-12):0,r.gasPeak?Math.ceil(r.gasPeak/s.tank.flow-1e-12):0);
  if(nb>1e6||nt>1e6||rows.some(r=>r.counts.some(n=>n>1e6)))throw Error('Подбор превысил миллион блоков: вариант непрактичен или расходится.');
  let key=JSON.stringify([rows,nb,nt]);if(key===last){let mass=baseMass+(s.growMass?s.fuelMass*1000+hardware(s,rows,nb,nt):0);return {...metrics(s,rows,nb,nt,mass),iterations:iter+1};}last=key;
 }
 throw Error('Нет сходимости за 400 итераций. Выберите более эффективные блоки или снизьте требования.');
}
root.Flight={calculate,autofill,chooseEngine,efficiency,required,capacities,constraints,dirs,names};if(typeof module!=='undefined')module.exports=root.Flight;
})(globalThis);
