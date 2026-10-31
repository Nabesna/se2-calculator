(function(root){
'use strict';
const axes=['length','width','height'];
function dimensions(o,catalog){const e=catalog.find(e=>'thruster:'+e.id===o.type);let d=[...o.dim];if(e){const n=Math.max(1,Math.floor(o.count||1));const axis=['forward','back'].includes(o.direction)?1:0;d[axis]*=n;}return d;}
function required(model,catalog,includeExternal=true){model={...model,objects:model.objects.filter(o=>includeExternal||!catalog.some(e=>'thruster:'+e.id===o.type)||o.external===false)};return axes.map((k,i)=>Math.max(0,...model.objects.map(o=>2*Math.abs(o.pos[i])+dimensions(o,catalog)[i])));}
function thrust(model,catalog,density){const f=Object.fromEntries(['up','down','forward','back','left','right'].map(d=>[d,0]));for(const o of model.objects){const e=catalog.find(e=>'thruster:'+e.id===o.type);if(e&&o.direction in f)f[o.direction]+=e.thrust*Math.max(1,o.count||1)*(e.factor??root.Flight.efficiency(e.kind,density));}return f;}
function minimum(catalog,density){const applicable=catalog.filter(e=>(e.factor??root.Flight.efficiency(e.kind,density))>0);return Math.min(...(applicable.length?applicable:catalog).map(e=>Math.min(...(e.dimensions||[e.size,e.size,e.size]))));}
function fromRows(rows,catalog,density){const objects=rows.flatMap(r=>r.counts.map((n,i)=>({type:'thruster:'+r.id,count:n,direction:['up','down','forward','back','left','right'][i]})).filter(o=>o.count>0));return thrust({objects},catalog,density);}
function adequacy(available,needed){
 if(needed<=0)return {ratio:null,percent:null,level:'neutral',color:'#8bbbd9'};
 const ratio=available/needed,q=Math.max(0,Math.min(1,ratio));
 const hue=q<=.85?60*q/.85:60+60*(q-.85)/.15;
 return {ratio,percent:Math.floor(ratio*100),level:ratio>=1?'enough':'short',color:'hsl('+hue.toFixed(2)+' 85% 65%)'};
}
const hullLimits={length:[5,200],width:[5,20],height:[5,20]};
function clampHull(axis,value){const [min,max]=hullLimits[axis];return Math.max(min,Math.min(max,value));}
function proportionHull(model,changed='length'){
 const r=Object.fromEntries(Object.keys(hullLimits).map(k=>[k,clampHull(k,model[k])]));
 if(changed==='length'){
  for(const k of ['width','height'])r[k]=Math.max(5,r.length/10,Math.min(r[k],r.length));
  r.height=Math.min(r.height,r.width);
 }else{
  if(changed==='width')r.height=Math.min(r.height,r.width);else r.width=Math.max(r.width,r.height);
  r.length=Math.max(r.width,r.height,Math.min(r.length,10*Math.min(r.width,r.height)));
 }
 return r;
}
root.LayoutGeometry={dimensions,required,thrust,minimum,fromRows,adequacy,hullLimits,clampHull,proportionHull};if(typeof module!=='undefined')module.exports=root.LayoutGeometry;
})(globalThis);
