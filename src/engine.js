// =====================================================================
// NUTRITION ENGINE — pure, deterministic rules. No DOM, no storage, no network.
// Every decision returns { result..., reason } so the app can always explain itself.
// Works in the browser (window.NutritionEngine) and in Node (module.exports).
// =====================================================================
(function (root) {
'use strict';

// ---------- fixed program constants (from the spec) ----------
const PHASES = { CUT: 'cut', LEAN_BULK: 'lean_bulk', FINAL_CUT: 'final_cut', DONE: 'done' };
const PHASE_LABEL = { cut: 'Cut', lean_bulk: 'Lean bulk', final_cut: 'Final cut', done: 'Complete' };
const GOALS = {
  cutBodyFat: 10,                // Phase 1 target (7-day BF average)
  cutConfirmReading: 10.5,       // at least 5 of the last 7 BF readings must be at or below this
  cutConfirmCount: 5,
  bulkWeight: 83,                // Phase 2 target (7-day weight average)
  bulkBodyFatCeiling: 17,        // Phase 2 ends early if the 7-day BF average reaches this
  finalBodyFat: 12,              // Phase 3 target
  finalWeightMin: 78, finalWeightMax: 82
};
const ENERGY = { bmr: 1771, initialMaintenance: 2600, initialCutCalories: 2100, cutFloor: 1800, step: 100, kcalPerKgTissue: 7700 };
const TREND = { windowDays: 7, minPoints: 4 };
const ADHERENCE = { calTolerance: 0.10, proteinMin: 0.90, daysRequired: 5 };
const BULK = { min: 0.15, max: 0.30, tooFast: 0.35, bullseye: 0.25 };
const MACRO = { proteinPerKg: { cut: 2.2, final_cut: 2.2, lean_bulk: 2.0 }, fatPerKg: 0.8, kcalProtein: 4, kcalCarb: 4, kcalFat: 9, roundTo: 5 };
const DISCIPLINE = { greenCal: 0.05, greenProtein: 0.95, yellowCal: 0.10, yellowProtein: 0.90 };

// ---------- small helpers ----------
const round = (x, d = 2) => { const f = Math.pow(10, d); return Math.round((x + Number.EPSILON) * f) / f; };
const roundTo = (x, step) => Math.round(x / step) * step;
const fmt = (x, d = 1) => { const r = round(x, d); return Number.isInteger(r) ? String(r) : r.toFixed(d); };
const pct = x => fmt(x, 2).replace(/0$/, '').replace(/\.$/, '');
function addDays(iso, n){ const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b){ return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

// One reading per date per field (the latest entry for that date wins). Never interpolates.
function readings(measurements, field){
  const byDate = new Map();
  for (const m of measurements || []){
    const v = m && m[field];
    if (v == null || !isFinite(v)) continue;
    const prev = byDate.get(m.date);
    if (!prev || (m.updatedAt || 0) >= (prev.updatedAt || 0)) byDate.set(m.date, { date: m.date, value: +v, updatedAt: m.updatedAt || 0 });
  }
  return [...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1);
}

// ---------- 1. trends ----------
// 7-day rolling average ending on `endDate` (inclusive). Needs at least 4 real readings in the window.
function trend(measurements, field, endDate){
  const start = addDays(endDate, -(TREND.windowDays - 1));
  const pts = readings(measurements, field).filter(r => r.date >= start && r.date <= endDate);
  const label = field === 'weightKg' ? 'weight' : 'body-fat';
  if (pts.length < TREND.minPoints){
    return { ok: false, value: null, count: pts.length, start, end: endDate,
      reason: `Not enough data for a reliable trend: ${pts.length} ${label} reading${pts.length === 1 ? '' : 's'} between ${start} and ${endDate} (at least ${TREND.minPoints} needed).` };
  }
  const value = pts.reduce((s, p) => s + p.value, 0) / pts.length;
  return { ok: true, value, count: pts.length, start, end: endDate,
    reason: `7-day average of ${pts.length} ${label} readings from ${start} to ${endDate}.` };
}

// ---------- 2. speed ranges ----------
// Cut: faster when fatter. Boundaries: above 20 → top band; 15–20 inclusive → second; 12 up to 15 → third; at or below 12 → slowest.
function cutRange(bodyFatTrend){
  if (bodyFatTrend > 20) return { min: 0.75, max: 1.00, band: 'above 20%' };
  if (bodyFatTrend >= 15) return { min: 0.60, max: 0.80, band: '15–20%' };
  if (bodyFatTrend >= 12) return { min: 0.40, max: 0.60, band: '12–15%' };
  return { min: 0.30, max: 0.50, band: 'about 10–12%' };
}
function bulkRange(){ return { min: BULK.min, max: BULK.max, tooFast: BULK.tooFast, bullseye: BULK.bullseye }; }

// ---------- 3. phase engine ----------
// Returns { phase, changed, reason, flag?, blocked? }. Never transitions on insufficient data.
function evaluatePhase(phase, measurements, date){
  const bf = trend(measurements, 'bodyFatPct', date);
  const wt = trend(measurements, 'weightKg', date);
  if (phase === PHASES.CUT){
    if (!bf.ok) return { phase, changed: false, blocked: true, reason: 'Phase transition cannot yet be confirmed: ' + bf.reason };
    const last7 = readings(measurements, 'bodyFatPct').filter(r => r.date <= date).slice(-7);
    const low = last7.filter(r => r.value <= GOALS.cutConfirmReading).length;
    if (round(bf.value, 2) <= GOALS.cutBodyFat && low >= GOALS.cutConfirmCount){
      return { phase: PHASES.LEAN_BULK, changed: true,
        reason: `Cut is complete because your 7-day body-fat average reached ${fmt(bf.value)}%, with ${low} of the last ${last7.length} readings at or below ${GOALS.cutConfirmReading}%.` };
    }
    const why = round(bf.value, 2) > GOALS.cutBodyFat
      ? `your 7-day body-fat average is ${fmt(bf.value)}%, above the ${GOALS.cutBodyFat}% target`
      : `only ${low} of the last ${last7.length} readings are at or below ${GOALS.cutConfirmReading}% (${GOALS.cutConfirmCount} needed)`;
    return { phase, changed: false, reason: `Still cutting: ${why}.` };
  }
  if (phase === PHASES.LEAN_BULK){
    if (!wt.ok && !bf.ok) return { phase, changed: false, blocked: true, reason: 'Phase transition cannot yet be confirmed: not enough weight or body-fat readings in the last 7 days.' };
    if (wt.ok && round(wt.value, 2) >= GOALS.bulkWeight)
      return { phase: PHASES.FINAL_CUT, changed: true, reason: `Lean bulk is complete because your 7-day average weight reached ${fmt(wt.value)} kg (target ${GOALS.bulkWeight} kg).` };
    if (bf.ok && round(bf.value, 2) >= GOALS.bulkBodyFatCeiling)
      return { phase: PHASES.FINAL_CUT, changed: true, reason: `Lean bulk is complete because your 7-day body-fat average reached ${fmt(bf.value)}%, the ${GOALS.bulkBodyFatCeiling}% ceiling.` };
    const parts = [];
    if (wt.ok) parts.push(`weight average ${fmt(wt.value)} kg of ${GOALS.bulkWeight} kg`);
    if (bf.ok) parts.push(`body-fat average ${fmt(bf.value)}% (ceiling ${GOALS.bulkBodyFatCeiling}%)`);
    return { phase, changed: false, reason: `Still bulking: ${parts.join(', ')}.` };
  }
  if (phase === PHASES.FINAL_CUT){
    if (!bf.ok) return { phase, changed: false, blocked: true, reason: 'Phase transition cannot yet be confirmed: ' + bf.reason };
    if (round(bf.value, 2) > GOALS.finalBodyFat) return { phase, changed: false, reason: `Still in the final cut: 7-day body-fat average is ${fmt(bf.value)}%, target ${GOALS.finalBodyFat}%.` };
    if (!wt.ok) return { phase, changed: false, blocked: true, reason: `Body fat reached ${fmt(bf.value)}%, but the weight trend can't be confirmed yet: ${wt.reason}` };
    if (wt.value >= GOALS.finalWeightMin && wt.value <= GOALS.finalWeightMax)
      return { phase: PHASES.DONE, changed: true, reason: `Final cut is complete: 7-day body-fat average ${fmt(bf.value)}% and weight ${fmt(wt.value)} kg, inside ${GOALS.finalWeightMin}–${GOALS.finalWeightMax} kg.` };
    return { phase, changed: false, flag: 'review',
      reason: `Body fat reached ${fmt(bf.value)}%, but your 7-day weight (${fmt(wt.value)} kg) is outside ${GOALS.finalWeightMin}–${GOALS.finalWeightMax} kg. Flagged for review; the app won't push further loss or gain on its own.` };
  }
  return { phase, changed: false, reason: 'All phases are complete.' };
}

// ---------- 4. phase completion ----------
function phaseProgress(phase, { startBodyFat, bulkStartWeight, weightTrend, bodyFatTrend }){
  const clamp = x => Math.max(0, Math.min(1, x));
  if (phase === PHASES.CUT){
    if (bodyFatTrend == null || startBodyFat == null) return { value: null, reason: 'Not enough body-fat data to measure progress.' };
    const denom = startBodyFat - GOALS.cutBodyFat;
    const raw = denom > 0 ? (startBodyFat - bodyFatTrend) / denom : 1;
    return { value: clamp(raw), reason: `From ${fmt(startBodyFat)}% toward ${GOALS.cutBodyFat}%: now ${fmt(bodyFatTrend)}%.` };
  }
  if (phase === PHASES.LEAN_BULK){
    if (weightTrend == null || bulkStartWeight == null) return { value: null, reason: 'Not enough weight data to measure progress.' };
    const denom = GOALS.bulkWeight - bulkStartWeight;
    const raw = denom > 0 ? (weightTrend - bulkStartWeight) / denom : 1;
    return { value: clamp(raw), ceiling: bodyFatTrend == null ? null : { current: bodyFatTrend, max: GOALS.bulkBodyFatCeiling },
      reason: `From ${fmt(bulkStartWeight)} kg toward ${GOALS.bulkWeight} kg: now ${fmt(weightTrend)} kg.` };
  }
  if (phase === PHASES.FINAL_CUT){
    if (bodyFatTrend == null || startBodyFat == null) return { value: null, reason: 'Not enough body-fat data to measure progress.' };
    const denom = startBodyFat - GOALS.finalBodyFat;
    const raw = denom > 0 ? (startBodyFat - bodyFatTrend) / denom : 1;
    return { value: clamp(raw), reason: `From ${fmt(startBodyFat)}% toward about ${GOALS.finalBodyFat}% (weight roughly ${GOALS.finalWeightMin}–${GOALS.finalWeightMax} kg).` };
  }
  return { value: 1, reason: 'Complete.' };
}

// ---------- 5. adherence ----------
// A day counts when calories are within ±10% of target AND protein is at least 90% of target.
// A day with no food log is NOT adherent (never assumed).
function dayAdherent(log, target){
  if (!log || log.kcal == null || log.protein == null) return false;
  return Math.abs(log.kcal - target.calories) <= target.calories * ADHERENCE.calTolerance + 1e-9
    && log.protein >= target.protein * ADHERENCE.proteinMin - 1e-9;
}
function adherence(dayLogs, targetsByDate, endDate){
  const days = [];
  for (let i = TREND.windowDays - 1; i >= 0; i--){
    const d = addDays(endDate, -i), t = typeof targetsByDate === 'function' ? targetsByDate(d) : targetsByDate;
    days.push({ date: d, adherent: dayAdherent(dayLogs[d], t) });
  }
  const count = days.filter(x => x.adherent).length;
  return { count, days, ok: count >= ADHERENCE.daysRequired,
    reason: `${count} of 7 days were on target (calories within ±10% and protein at least 90%); ${ADHERENCE.daysRequired} are needed.` };
}

// Discipline calendar status for one day.
function dayStatus(log, target){
  if (!log || !log.complete && !(log.kcal > 0)) return { status: 'grey', reason: 'No sufficient food log for this day.' };
  const calOff = Math.abs(log.kcal - target.calories) / target.calories;
  const prot = log.protein / target.protein;
  if (calOff <= DISCIPLINE.greenCal + 1e-9 && prot >= DISCIPLINE.greenProtein - 1e-9) return { status: 'green', reason: 'Calories within ±5% and protein at least 95% of target.' };
  if (calOff <= DISCIPLINE.yellowCal + 1e-9 && prot >= DISCIPLINE.yellowProtein - 1e-9) return { status: 'yellow', reason: 'Calories within ±10% and protein at least 90% of target.' };
  return { status: 'red', reason: `Calories ${fmt(calOff * 100, 0)}% off target and protein at ${fmt(prot * 100, 0)}% of target.` };
}

// ---------- 6. maintenance estimate ----------
// Starts at 2600 kcal and leans on real data as reviews accumulate:
//   observed = average logged intake − (weekly weight change in kg × 7700 / 7)
//   estimate = (2600 × 2 + sum of observations) / (2 + number of observations)
// Only adherent weeks with complete data contribute.
function maintenanceEstimate(observations){
  const obs = (observations || []).filter(x => isFinite(x));
  const prior = ENERGY.initialMaintenance, w = 2;
  const value = Math.round((prior * w + obs.reduce((s, x) => s + x, 0)) / (w + obs.length));
  return { value, observations: obs.length,
    reason: obs.length ? `Based on the starting estimate of ${prior} kcal blended with ${obs.length} week${obs.length === 1 ? '' : 's'} of your real intake and weight change.` : `Starting estimate of ${prior} kcal; it will update from your real intake and weight change.` };
}
function observedMaintenance(avgIntake, prevAvgWeight, curAvgWeight){
  return avgIntake - ((curAvgWeight - prevAvgWeight) * ENERGY.kcalPerKgTissue / 7);
}

// ---------- 7. weekly calorie review ----------
// input: { phase, calories, reviewDate, measurements, dayLogs, target:{calories,protein} | fn(date),
//          slowStreak (consecutive adherent slow reviews before this one) }
// returns: { calories, change, slowStreak, status, reason, details }
function weeklyReview(input){
  const { phase, calories, reviewDate, measurements, dayLogs = {}, target } = input;
  const slowStreak = input.slowStreak || 0;
  const keep = (status, reason, extra = {}) => ({ calories, change: 0, slowStreak, status, reason, ...extra });
  const cur = trend(measurements, 'weightKg', reviewDate);
  const prev = trend(measurements, 'weightKg', addDays(reviewDate, -7));
  if (!cur.ok || !prev.ok) return keep('insufficient_data', 'No calorie adjustment — insufficient weight data.', { details: { current: cur, previous: prev } });

  const changePct = round((cur.value - prev.value) / prev.value * 100, 3);
  const adh = adherence(dayLogs, target, reviewDate);
  const details = { currentAvg: cur.value, previousAvg: prev.value, changePct, adherence: adh };
  if (!adh.ok) return { calories, change: 0, slowStreak: 0, status: 'low_adherence', details,
    reason: `Calories unchanged because adherence was not consistent enough to judge whether the current target needs changing (${adh.count} of 7 days on target).` };

  // Maintenance observation from this (adherent) week.
  const logged = adh.days.map(d => dayLogs[d.date]).filter(l => l && l.kcal != null);
  details.observedMaintenance = logged.length ? observedMaintenance(logged.reduce((s, l) => s + l.kcal, 0) / logged.length, prev.value, cur.value) : null;

  if (phase === PHASES.CUT || phase === PHASES.FINAL_CUT){
    const bf = trend(measurements, 'bodyFatPct', reviewDate);
    if (!bf.ok) return keep('insufficient_data', 'No calorie adjustment — not enough body-fat readings to choose your target loss range.', { details });
    const r = cutRange(round(bf.value, 2)); details.range = r; details.bodyFatTrend = bf.value;
    const loss = round(-changePct, 3);
    const lossTxt = loss >= 0 ? `decreased ${pct(loss)}%` : `increased ${pct(-loss)}%`;
    const rangeTxt = `${pct(r.min)}–${pct(r.max)}% target for body fat ${r.band}`;
    if (loss > r.max) return { calories: calories + ENERGY.step, change: ENERGY.step, slowStreak: 0, status: 'too_fast', details,
      reason: `Your 7-day average weight ${lossTxt}, faster than your ${rangeTxt}. Calories increase by ${ENERGY.step} kcal to ${calories + ENERGY.step}.` };
    if (loss >= r.min) return { calories, change: 0, slowStreak: 0, status: 'on_target', details,
      reason: `Your 7-day average weight ${lossTxt}, which is inside your ${rangeTxt}. Calories remain unchanged.` };
    const streak = slowStreak + 1;
    if (streak < 2) return { calories, change: 0, slowStreak: streak, status: 'slow_once', details,
      reason: `Your 7-day average weight ${lossTxt}, slower than your ${rangeTxt}. This is the first slow week, so calories remain unchanged.` };
    if (calories - ENERGY.step < ENERGY.cutFloor) return { calories, change: 0, slowStreak: streak, status: 'manual_review', details,
      reason: `Manual review required. Loss has been slower than your ${rangeTxt} for ${streak} adherent weeks, but another ${ENERGY.step} kcal cut would go below the ${ENERGY.cutFloor} kcal floor.` };
    return { calories: calories - ENERGY.step, change: -ENERGY.step, slowStreak: 0, status: 'slow_twice', details,
      reason: `Your 7-day average weight ${lossTxt}, slower than your ${rangeTxt} for 2 adherent weeks in a row. Calories decrease by ${ENERGY.step} kcal to ${calories - ENERGY.step}.` };
  }

  if (phase === PHASES.LEAN_BULK){
    const gain = changePct, b = bulkRange(); details.range = b;
    const gainTxt = gain >= 0 ? `increased ${pct(gain)}%` : `decreased ${pct(-gain)}%`;
    if (gain > b.tooFast) return { calories: calories - ENERGY.step, change: -ENERGY.step, slowStreak: 0, status: 'too_fast', details,
      reason: `Your 7-day average weight ${gainTxt}, above ${pct(b.tooFast)}% a week, which is too fast for a lean bulk. Calories decrease by ${ENERGY.step} kcal to ${calories - ENERGY.step}.` };
    if (gain >= b.min && gain <= b.max) return { calories, change: 0, slowStreak: 0, status: 'on_target', details,
      reason: `Your 7-day average weight ${gainTxt}, inside your ${pct(b.min)}–${pct(b.max)}% lean-bulk target. Calories remain unchanged.` };
    if (gain > b.max) return { calories, change: 0, slowStreak: 0, status: 'slightly_fast', details,
      reason: `Your 7-day average weight ${gainTxt}: a little above the ${pct(b.min)}–${pct(b.max)}% target but not above ${pct(b.tooFast)}%. Calories remain unchanged.` };
    const streak = slowStreak + 1;
    if (streak < 2) return { calories, change: 0, slowStreak: streak, status: 'slow_once', details,
      reason: `Your 7-day average weight ${gainTxt}, below the ${pct(b.min)}% minimum. This is the first slow week, so calories remain unchanged.` };
    return { calories: calories + ENERGY.step, change: ENERGY.step, slowStreak: 0, status: 'slow_twice', details,
      reason: `Your 7-day average weight ${gainTxt}, below ${pct(b.min)}% for 2 adherent weeks in a row. Calories increase by ${ENERGY.step} kcal to ${calories + ENERGY.step}.` };
  }
  return keep('no_phase', 'No active phase, so calories are not reviewed.');
}

// ---------- 8. calories when a phase starts ----------
// Not given in the spec; these follow the spec's own rates, using the learned maintenance estimate.
//   Lean bulk: maintenance + the surplus for the 0.25%/week bullseye.
//   Final cut: maintenance − the deficit for the middle of the loss range for your current body fat.
function phaseStartCalories(phase, { maintenance, weightKg, bodyFatPct }){
  const kcalPerPctWeek = weightKg * ENERGY.kcalPerKgTissue / 100 / 7;     // kcal/day per 1% of bodyweight per week
  if (phase === PHASES.LEAN_BULK){
    const surplus = roundTo(BULK.bullseye * kcalPerPctWeek, 50);
    return { calories: maintenance + surplus,
      reason: `Lean bulk starts at your estimated maintenance (${maintenance} kcal) plus ${surplus} kcal, the surplus for about ${pct(BULK.bullseye)}% weight gain per week.` };
  }
  if (phase === PHASES.FINAL_CUT || phase === PHASES.CUT){
    const r = cutRange(bodyFatPct), mid = (r.min + r.max) / 2;
    const deficit = roundTo(mid * kcalPerPctWeek, 50);
    const raw = maintenance - deficit, cal = Math.max(ENERGY.cutFloor, raw);
    return { calories: cal, reason: `${PHASE_LABEL[phase]} starts at your estimated maintenance (${maintenance} kcal) minus ${deficit} kcal, the deficit for about ${pct(mid)}% weight loss per week at ${r.band} body fat${raw < ENERGY.cutFloor ? `, held at the ${ENERGY.cutFloor} kcal floor` : ''}.` };
  }
  return { calories: maintenance, reason: `Maintenance: ${maintenance} kcal.` };
}

// ---------- 9. macros ----------
function macros(calories, weightTrendKg, phase){
  const ppk = MACRO.proteinPerKg[phase] || MACRO.proteinPerKg.cut;
  const protein = roundTo(weightTrendKg * ppk, MACRO.roundTo);
  const fat = roundTo(weightTrendKg * MACRO.fatPerKg, MACRO.roundTo);
  const left = calories - protein * MACRO.kcalProtein - fat * MACRO.kcalFat;
  const why = {
    calories: null,
    protein: `Protein is ${ppk} g per kg of your ${fmt(weightTrendKg)} kg 7-day average weight because you are in the ${PHASE_LABEL[phase].toLowerCase()} phase: ${fmt(weightTrendKg * ppk)} g, rounded to ${protein} g.`,
    fat: `Fat is ${MACRO.fatPerKg} g per kg of your ${fmt(weightTrendKg)} kg 7-day average weight: ${fmt(weightTrendKg * MACRO.fatPerKg)} g, rounded to ${fat} g.`,
    carbs: null
  };
  if (left < 0){
    return { ok: false, calories, protein, fat, carbs: 0, why: { ...why,
      carbs: `Review needed: protein (${protein * 4} kcal) and fat (${fat * 9} kcal) already need ${protein * 4 + fat * 9} kcal, more than the ${calories} kcal target. Carbs can't be negative.` } };
  }
  const carbs = Math.floor(left / MACRO.kcalCarb);   // whole grams, rounded down so the total never exceeds the target
  return { ok: true, calories, protein, fat, carbs, totalKcal: protein * 4 + fat * 9 + carbs * 4, why: { ...why,
    carbs: `Carbohydrates get the calories left after protein and fat: (${calories} − ${protein}×4 − ${fat}×9) ÷ 4 = ${fmt(left / 4, 2)} g, so ${carbs} g.` } };
}

// ---------- 10. target trajectory (not a prediction) ----------
// Weekly points from a starting weight/body fat, following the spec's target rates.
// Cut / final cut: lose the middle of the loss range for the current body-fat band each week,
// re-picking the band as body fat falls; body fat assumes the lost weight is fat.
// Lean bulk: gain the 0.25%/week bullseye; body fat is not projected (the 17% ceiling applies).
function targetTrajectory({ phase, fromDate, weightKg, bodyFatPct, maxWeeks = 52 }){
  const pts = [{ date: fromDate, weightKg, bodyFatPct }];
  if (weightKg == null) return pts;
  let w = weightKg, fat = bodyFatPct == null ? null : weightKg * bodyFatPct / 100;
  for (let k = 1; k <= maxWeeks; k++){
    const date = addDays(fromDate, 7 * k);
    if (phase === PHASES.CUT || phase === PHASES.FINAL_CUT){
      if (fat == null) break;
      const bf = fat / w * 100, goal = phase === PHASES.CUT ? GOALS.cutBodyFat : GOALS.finalBodyFat;
      if (bf <= goal) break;
      const r = cutRange(bf), loss = w * (r.min + r.max) / 2 / 100;
      w -= loss; fat -= loss;
      pts.push({ date, weightKg: round(w, 2), bodyFatPct: round(fat / w * 100, 2) });
    } else if (phase === PHASES.LEAN_BULK){
      if (w >= GOALS.bulkWeight) break;
      w *= 1 + BULK.bullseye / 100;
      pts.push({ date, weightKg: round(w, 2), bodyFatPct: null });
    } else break;
  }
  return pts;
}

const api = { PHASES, PHASE_LABEL, GOALS, ENERGY, TREND, ADHERENCE, BULK, MACRO, DISCIPLINE,
  addDays, daysBetween, readings, trend, cutRange, bulkRange, evaluatePhase, phaseProgress,
  dayAdherent, adherence, dayStatus, maintenanceEstimate, observedMaintenance, weeklyReview, phaseStartCalories, macros, targetTrajectory };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.NutritionEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
