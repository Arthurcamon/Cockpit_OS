  // Update new FUEL tab
  var fuelTabLiters = document.getElementById('fuel-tab-liters-val');
  if (fuelTabLiters) fuelTabLiters.textContent = fmtVal(fuel.liters, function(v) { return v.toFixed(1); }, "0.0");
  
  var fEstLaps = 0;
  if (fuel.estimatedLaps !== undefined && fuel.estimatedLaps !== null) {
    fEstLaps = fuel.estimatedLaps;
  } else if (fuel.liters && fuel.avgConsumptionPerLap) {
    fEstLaps = (fuel.liters / fuel.avgConsumptionPerLap);
  }
  
  var fuelTabLaps = document.getElementById('fuel-tab-laps-val');
  if (fuelTabLaps) fuelTabLaps.textContent = fEstLaps > 0 ? fEstLaps.toFixed(1) : "--";
  
  var maxF = data.maxFuel || 120; // default to 120 if maxFuel not in data
  if (fuel.maxFuel) maxF = fuel.maxFuel;
  var pctF = 0;
  if (fuel.liters !== undefined && fuel.liters !== null) {
    pctF = Math.min(100, Math.max(0, (fuel.liters / maxF) * 100));
  }
  var fuelTabBarFill = document.getElementById('fuel-tab-bar-fill');
  if (fuelTabBarFill) fuelTabBarFill.style.width = pctF + '%';
  
  var fuelAvgC = fuel.avgConsumptionPerLap || 0;
  var fuelTabAvg = document.getElementById('fuel-tab-avg');
  if (fuelTabAvg) fuelTabAvg.textContent = fuelAvgC > 0 ? fuelAvgC.toFixed(3) : "--";
  
  var fuelTabLast = document.getElementById('fuel-tab-last');
  // If we don't have last lap fuel, we fall back to average for now.
  var lastF = fuel.lastLapConsumption || fuelAvgC;
  if (fuelTabLast) fuelTabLast.textContent = lastF > 0 ? lastF.toFixed(3) : "--";
  
  var sessionTime = data.sessionTimeLeftSeconds || 0; // if we have it
  var lapTime = (data.lastLapTimeMs || 100000) / 1000;
  var lapsLeft = 0;
  if (sessionTime > 0 && lapTime > 0) {
    lapsLeft = sessionTime / lapTime;
  }
  var fuelNeeded = lapsLeft * fuelAvgC;
  var refuel = fuelNeeded - (fuel.liters || 0);
  var fuelTabRefuel = document.getElementById('fuel-tab-refuel');
  if (fuelTabRefuel) fuelTabRefuel.textContent = (refuel > 0) ? refuel.toFixed(1) : "0.0";
  
  var fuelTabTime = document.getElementById('fuel-tab-time');
  var estTimeS = fEstLaps * lapTime;
  if (estTimeS > 0) {
    var eH = Math.floor(estTimeS / 3600).toString().padStart(2, '0');
    var eM = Math.floor((estTimeS % 3600) / 60).toString().padStart(2, '0');
    var eS = Math.floor(estTimeS % 60).toString().padStart(2, '0');
    if (fuelTabTime) fuelTabTime.textContent = (eH !== '00' ? eH + ':' : '') + eM + ':' + eS;
  } else {
    if (fuelTabTime) fuelTabTime.textContent = "--:--";
  }
