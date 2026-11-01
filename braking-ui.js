'use strict';
(()=>{
 const tr=(ru,en)=>window.SE2I18N?.language==='en'?en:ru;
 let reaction=1,distance=1000;
 function panel(){
  $('braking-panel').innerHTML=`<h3>${tr('Успею ли затормозить?','Can I stop in time?')}</h3><p class="hint">${tr('Горизонтальный полёт носом вперёд с удержанием высоты. Скорость берётся из первой вкладки. Сначала задержка на постоянной скорости, затем полная тяга назад.','Forward horizontal flight while holding altitude. Speed comes from the first tab. Constant-speed delay, then full reverse thrust.')}</p><div class="fields"><label>${tr('Задержка пилота, с','Pilot delay, s')}<input id="brake-reaction" type="number" min="0" step="0.1" value="${reaction}"></label><label>${tr('Дистанция до препятствия, м','Distance to obstacle, m')}<input id="brake-distance" type="number" min="0" step="any" value="${distance}"></label></div><div id="braking-results" aria-live="polite"></div>`;
 }
 window.renderBrakingResults=r=>{
  if(!$('braking-results'))return;
  try{
   const b=FlightTools.stopping(s.speed,r.accel[3],reaction,distance),resources=FlightTools.brakingResources(s,r,reaction);
   const possible=Number.isFinite(b.time),ok=possible&&b.fits&&resources.ok;
   $('braking-results').innerHTML=`<p class="${ok?'goodtext':'badtext'}"><b>${tr(ok?'По модели: остановка укладывается в дистанцию и запас ресурсов.':'Остановка не подтверждена: проверьте дистанцию, тягу и ресурсы.',ok?'Model result: stopping fits the distance and resource budget.':'Stop not confirmed: check distance, thrust and resources.')}</b></p><div class="stats"><div class="stat"><strong>${fmt(b.total)} ${tr('м','m')}</strong><span>${tr('Весь путь с задержкой','Total distance including delay')}</span></div><div class="stat"><strong>${fmt(b.time)} ${tr('с','s')}</strong><span>${tr('Время самого торможения','Braking time after delay')}</span></div><div class="stat"><strong>≈ ${fmt(b.maxSpeed)} ${tr('м/с','m/s')}</strong><span>${tr('Предел скорости по дистанции','Speed limit from distance')}</span></div></div><p>${tr('Текущая скорость: ','Current speed: ')}${fmt(s.speed)} ${tr('м/с','m/s')} · ${tr('чистый тормозной путь: ','braking distance: ')}${fmt(b.brake)} ${tr('м','m')}.</p><p>${tr('На этот манёвр: ','For this maneuver: ')}${fmt(resources.energy,4)} ${tr('МВт·ч','MWh')} · ${fmt(resources.fuel,2)} ${tr('л H₂','L H₂')}. ${resources.ok?tr('Ресурсов хватает.','Resources sufficient.'):tr('Ресурсов или тяги для удержания высоты недостаточно.','Insufficient resources or thrust to hold altitude.')}</p><p class="hint">${tr('Отдельный манёвр от начального заряда и топлива, не после этапов миссии. Предел скорости учитывает только дистанцию, задержку и тягу; ресурсы проверяются для текущей скорости. Лимит скорости игры, поворот корабля и неровности рельефа не моделируются.','Independent maneuver using starting charge and fuel, not remaining resources after mission stages. The speed limit uses only distance, delay and thrust; resources are checked at the current speed. Game speed limits, ship rotation and terrain are not simulated.')}</p>`;
  }catch(err){$('braking-results').textContent=tr('Проверьте задержку и дистанцию: нужны неотрицательные числа.','Check delay and distance: non-negative numbers are required.');}
 };
 document.addEventListener('input',e=>{if(e.target.id==='brake-reaction')reaction=e.target.value===''?NaN:Number(e.target.value);else if(e.target.id==='brake-distance')distance=e.target.value===''?NaN:Number(e.target.value);else return;compute();});
 document.addEventListener('se2-language-change',()=>{panel();compute();});
 panel();compute();
})();
