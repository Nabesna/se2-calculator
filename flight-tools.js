(function(root){
'use strict';
function normalizeProfile(data,defaults,catalog,flight){
 if(!data||data.schema!==1||!Array.isArray(data.rows)||data.rows.length>100||!Array.isArray(data.phases)||data.phases.length>200)throw Error('Неверный формат профиля или слишком большой файл.');
 const next=structuredClone(defaults);
 for(const k of Object.keys(defaults))if(Object.hasOwn(data,k))next[k]=structuredClone(data[k]);
 next.mode='existing';next.growMass=false;
 next.engines=structuredClone(catalog.engines).map(e=>({...e,factor:null}));
 for(const [key,list] of [['battery',catalog.batteries],['tank',catalog.tanks]]){
  const item=list.find(e=>e.id===data[key]?.id);if(!item)throw Error('Неизвестная батарея или бак.');
  next[key]=structuredClone(item);
 }
 // Explicit user-entered battery capacity is preserved, catalogue metadata is not imported.
 if(data.batteryEnergy!=null){if(!Number.isFinite(data.batteryEnergy)||data.batteryEnergy<0||data.batteryEnergy>1e12)throw Error('Проверьте ёмкость батареи.');next.batteryEnergy=data.batteryEnergy;next.battery.energy=data.batteryEnergy;}
 if(!Array.isArray(next.preferred)||next.preferred.length!==6||next.preferred.some(id=>!catalog.engines.some(e=>e.id===id)))throw Error('Неизвестный двигатель для подбора.');
 for(const r of next.rows){if(!r||!Array.isArray(r.counts)||r.counts.length!==6||r.counts.some(n=>!Number.isInteger(n)||n<0||n>1e6))throw Error('Проверьте количество двигателей.');if(!r.id&&r.counts.some(n=>n!==0))throw Error('Выберите тип для введённых двигателей.');}
 flight.calculate({...next,rows:next.rows.filter(r=>r.id)});
 return next;
}
function stopping(speed,acceleration,reaction,distance){
 if([speed,reaction,distance].some(v=>!Number.isFinite(v)||v<0||v>1e12)||!Number.isFinite(acceleration))throw Error('Проверьте скорость, задержку и дистанцию.');
 const time=speed===0?0:acceleration>0?speed/acceleration:Infinity;
 const brake=speed===0?0:acceleration>0?speed*speed/(2*acceleration):Infinity;
 const total=brake+speed*reaction;
 // Rationalized root of d = v*t + v²/(2a), stable for short distances.
 const maxSpeed=acceleration>0&&distance>0?2*acceleration*distance/(Math.sqrt((acceleration*reaction)**2+2*acceleration*distance)+acceleration*reaction):0;
 return {time,brake,total,maxSpeed,fits:total<=distance};
}
function brakingResources(s,r,reaction){
 const k=stopping(s.speed,r.accel[3],reaction,0);
 if(!Number.isFinite(k.time))return {ok:false,energy:Infinity,fuel:Infinity,hoverOK:false};
 const hover=s.g===0?0:r.thrust[0]>0?(r.m*s.g*9.81/1000)/r.thrust[0]:Infinity;
 if(!Number.isFinite(hover)||hover>1+1e-9)return {ok:false,energy:Infinity,fuel:Infinity,hoverOK:false};
 const delay=s.speed===0?0:reaction,coastPower=s.hotel+r.pw[0]*hover,coastGas=r.gas[0]*hover;
 const power=coastPower+(s.speed>0?r.pw[3]:0),gas=coastGas+(s.speed>0?r.gas[3]:0);
 const energy=(Math.max(0,coastPower-s.generator)*delay+Math.max(0,power-s.generator)*k.time)/3600;
 const fuel=coastGas*delay+gas*k.time;
 return {energy,fuel,hoverOK:true,ok:power<=s.generator+r.batteryPower+1e-9&&gas<=r.nt*s.tank.flow+1e-9&&energy<=r.usable+1e-9&&fuel<=r.fuel+1e-9};
}
root.FlightTools={normalizeProfile,stopping,brakingResources};
if(typeof module!=='undefined')module.exports=root.FlightTools;
})(globalThis);
