// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { PHASES } = E;

// ---------- fixtures ----------
const REVIEW = '2026-10-14';
// Two weeks of daily readings: previous week (Oct 1–7) at w0, current week (Oct 8–14) at w0 × (1 + changePct/100).
function twoWeeks({ w0 = 85, changePct = -0.7, bf = 18 } = {}){
  const out = [];
  for (let i = 0; i < 14; i++){
    const date = E.addDays('2026-10-01', i);
    out.push({ date, weightKg: i < 7 ? w0 : w0 * (1 + changePct / 100), bodyFatPct: bf });
  }
  return out;
}
const TARGET = { calories: 2100, protein: 180 };
function logs(adherentDays, end = REVIEW, t = TARGET){
  const out = {};
  for (let i = 0; i < 7; i++){
    const d = E.addDays(end, -i);
    out[d] = i < adherentDays ? { kcal: t.calories, protein: t.protein } : { kcal: t.calories * 1.3, protein: t.protein * 0.7 };
  }
  return out;
}
const review = (o) => E.weeklyReview({ phase: PHASES.CUT, calories: 2100, reviewDate: REVIEW, dayLogs: logs(7), target: TARGET, slowStreak: 0, ...o });

// ---------- trends ----------
test('trend: 7-day average of real readings', () => {
  const t = E.trend(twoWeeks({ w0: 80, changePct: 0 }), 'weightKg', REVIEW);
  assert.equal(t.ok, true); assert.equal(t.count, 7); assert.equal(t.value, 80);
});
test('trend: fewer than 4 readings in 7 days is not reliable', () => {
  const m = [{ date: '2026-10-14', weightKg: 80 }, { date: '2026-10-12', weightKg: 81 }, { date: '2026-10-09', weightKg: 80 }];
  const t = E.trend(m, 'weightKg', REVIEW);
  assert.equal(t.ok, false); assert.match(t.reason, /Not enough data for a reliable trend/);
});
test('trend: readings outside the window are ignored, never interpolated', () => {
  const m = [...['2026-10-01','2026-10-02','2026-10-03','2026-10-04'].map(d => ({ date: d, weightKg: 90 })), { date: '2026-10-14', weightKg: 80 }];
  assert.equal(E.trend(m, 'weightKg', REVIEW).ok, false);
});
test('trend: a corrected reading for the same date replaces the old one', () => {
  const m = ['2026-10-11','2026-10-12','2026-10-13'].map(d => ({ date: d, weightKg: 80 }));
  m.push({ date: '2026-10-14', weightKg: 99, updatedAt: 1 }, { date: '2026-10-14', weightKg: 80, updatedAt: 2 });
  assert.equal(E.trend(m, 'weightKg', REVIEW).value, 80);
});

// ---------- cutting speed ranges ----------
test('cut ranges by body fat', () => {
  assert.deepEqual([E.cutRange(22).min, E.cutRange(22).max], [0.75, 1.0]);
  assert.deepEqual([E.cutRange(18).min, E.cutRange(18).max], [0.6, 0.8]);
  assert.deepEqual([E.cutRange(20).min, E.cutRange(15).min], [0.6, 0.6]);
  assert.deepEqual([E.cutRange(13).min, E.cutRange(12).min], [0.4, 0.4]);
  assert.deepEqual([E.cutRange(11).min, E.cutRange(11).max], [0.3, 0.5]);
});

// ---------- spec section 32: cut reviews ----------
test('CUT 18% BF, loss 0.7% → no calorie change', () => {
  const r = review({ measurements: twoWeeks({ changePct: -0.7, bf: 18 }) });
  assert.equal(r.change, 0); assert.equal(r.status, 'on_target'); assert.equal(r.calories, 2100);
  assert.match(r.reason, /decreased 0\.7%, which is inside your 0\.6–0\.8% target/);
});
test('CUT loss 0.2%: first slow week no change, second consecutive adherent slow week −100', () => {
  const m = twoWeeks({ changePct: -0.2, bf: 18 });
  const w1 = review({ measurements: m });
  assert.equal(w1.change, 0); assert.equal(w1.status, 'slow_once'); assert.equal(w1.slowStreak, 1);
  const w2 = review({ measurements: m, slowStreak: w1.slowStreak });
  assert.equal(w2.change, -100); assert.equal(w2.calories, 2000); assert.equal(w2.slowStreak, 0);
});
test('CUT loss 1.1% → +100 kcal', () => {
  const r = review({ measurements: twoWeeks({ changePct: -1.1, bf: 18 }) });
  assert.equal(r.change, 100); assert.equal(r.calories, 2200); assert.equal(r.status, 'too_fast');
});
test('CUT weight going up counts as slow', () => {
  const r = review({ measurements: twoWeeks({ changePct: 0.3, bf: 18 }) });
  assert.equal(r.status, 'slow_once'); assert.match(r.reason, /increased 0\.3%/);
});
test('LOW ADHERENCE 3/7 → no adjustment, and the slow streak resets', () => {
  const r = review({ measurements: twoWeeks({ changePct: -0.2 }), dayLogs: logs(3), slowStreak: 1 });
  assert.equal(r.change, 0); assert.equal(r.status, 'low_adherence'); assert.equal(r.slowStreak, 0);
  assert.match(r.reason, /Calories unchanged because adherence was not consistent enough/);
});
test('adherence: missing food logs never count as adherent', () => {
  const l = logs(7); delete l[REVIEW]; delete l[E.addDays(REVIEW, -1)]; delete l[E.addDays(REVIEW, -2)];
  assert.equal(E.adherence(l, TARGET, REVIEW).count, 4);
});
test('adherence boundaries: exactly ±10% calories and 90% protein still count', () => {
  assert.equal(E.dayAdherent({ kcal: 2310, protein: 162 }, TARGET), true);
  assert.equal(E.dayAdherent({ kcal: 2311, protein: 180 }, TARGET), false);
  assert.equal(E.dayAdherent({ kcal: 2100, protein: 161.9 }, TARGET), false);
});
test('CUT floor: no automatic cut below 1800 → manual review', () => {
  const r = review({ calories: 1850, target: { calories: 1850, protein: 180 }, dayLogs: logs(7, REVIEW, { calories: 1850, protein: 180 }),
    measurements: twoWeeks({ changePct: -0.1 }), slowStreak: 1 });
  assert.equal(r.change, 0); assert.equal(r.status, 'manual_review'); assert.match(r.reason, /Manual review required/);
});
test('CUT 1900 → 1800 is allowed (reaches the floor, not below it)', () => {
  const r = review({ calories: 1900, target: { calories: 1900, protein: 180 }, dayLogs: logs(7, REVIEW, { calories: 1900, protein: 180 }),
    measurements: twoWeeks({ changePct: -0.1 }), slowStreak: 1 });
  assert.equal(r.calories, 1800);
});
test('insufficient weight data → no adjustment', () => {
  const m = twoWeeks().filter(x => x.date >= '2026-10-12');
  const r = review({ measurements: m });
  assert.equal(r.change, 0); assert.equal(r.reason, 'No calorie adjustment — insufficient weight data.');
});
test('final cut uses the same body-fat-based loss ranges', () => {
  const r = review({ phase: PHASES.FINAL_CUT, measurements: twoWeeks({ changePct: -0.45, bf: 13 }) });
  assert.equal(r.status, 'on_target'); assert.equal(r.details.range.min, 0.4);
});

// ---------- spec section 32: lean bulk reviews ----------
const bulk = (o) => review({ phase: PHASES.LEAN_BULK, calories: 2800, target: { calories: 2800, protein: 160 }, dayLogs: logs(7, REVIEW, { calories: 2800, protein: 160 }), ...o });
test('LEAN BULK gain 0.22% → no change', () => {
  const r = bulk({ measurements: twoWeeks({ w0: 78, changePct: 0.22, bf: 12 }) });
  assert.equal(r.change, 0); assert.equal(r.status, 'on_target');
});
test('LEAN BULK gain 0.10%: first week no change, second consecutive +100', () => {
  const m = twoWeeks({ w0: 78, changePct: 0.10, bf: 12 });
  const w1 = bulk({ measurements: m }); assert.equal(w1.change, 0); assert.equal(w1.slowStreak, 1);
  const w2 = bulk({ measurements: m, slowStreak: 1 }); assert.equal(w2.change, 100); assert.equal(w2.calories, 2900);
});
test('LEAN BULK gain 0.40% → −100', () => {
  const r = bulk({ measurements: twoWeeks({ w0: 78, changePct: 0.40, bf: 12 }) });
  assert.equal(r.change, -100); assert.equal(r.calories, 2700);
});
test('LEAN BULK gain 0.33% (above 0.30, not above 0.35) → no change', () => {
  const r = bulk({ measurements: twoWeeks({ w0: 78, changePct: 0.33, bf: 12 }) });
  assert.equal(r.change, 0); assert.equal(r.status, 'slightly_fast');
});

// ---------- spec section 32: phase transitions ----------
const bfSeries = (vals, w = 76) => vals.map((v, i) => ({ date: E.addDays(REVIEW, i - vals.length + 1), bodyFatPct: v, weightKg: w }));
test('CUT COMPLETION: 7-day BF 9.9% with 5/7 readings ≤10.5% → lean bulk', () => {
  const r = E.evaluatePhase(PHASES.CUT, bfSeries([9.6, 9.8, 10.0, 9.7, 10.2, 10.6, 9.4]), REVIEW);
  assert.equal(r.phase, PHASES.LEAN_BULK); assert.equal(r.changed, true);
  assert.match(r.reason, /reached 9\.9%, with 6 of the last 7 readings at or below 10\.5%/);
});
test('CUT FALSE TRIGGER: one 9.8% reading but 7-day average 11.0% → stay in cut', () => {
  const r = E.evaluatePhase(PHASES.CUT, bfSeries([11.2, 11.3, 11.1, 9.8, 11.5, 11.4, 10.7]), REVIEW);
  assert.equal(r.phase, PHASES.CUT); assert.equal(r.changed, false);
});
test('CUT: average ≤10% but only 4/7 readings ≤10.5% → stay in cut', () => {
  const r = E.evaluatePhase(PHASES.CUT, bfSeries([9.0, 9.0, 9.0, 9.0, 10.9, 10.9, 10.9]), REVIEW);
  assert.equal(r.phase, PHASES.CUT); assert.match(r.reason, /only 4 of the last 7/);
});
test('CUT: insufficient BF data → transition cannot be confirmed', () => {
  const r = E.evaluatePhase(PHASES.CUT, bfSeries([9, 9, 9]), REVIEW);
  assert.equal(r.changed, false); assert.equal(r.blocked, true); assert.match(r.reason, /Phase transition cannot yet be confirmed/);
});
test('BULK COMPLETION: weight 81.5 kg, BF 17.0% → final cut', () => {
  const r = E.evaluatePhase(PHASES.LEAN_BULK, bfSeries([17, 17, 17, 17, 17, 17, 17], 81.5), REVIEW);
  assert.equal(r.phase, PHASES.FINAL_CUT); assert.match(r.reason, /17%/);
});
test('BULK COMPLETION by weight: 83 kg average → final cut', () => {
  const r = E.evaluatePhase(PHASES.LEAN_BULK, bfSeries([15, 15, 15, 15, 15, 15, 15], 83), REVIEW);
  assert.equal(r.phase, PHASES.FINAL_CUT); assert.match(r.reason, /83 kg/);
});
test('FINAL CUT: 12% BF at 80 kg → complete', () => {
  assert.equal(E.evaluatePhase(PHASES.FINAL_CUT, bfSeries([12, 12, 11.9, 12, 12, 12, 11.8], 80), REVIEW).phase, PHASES.DONE);
});
test('FINAL CUT: 12% BF at 84 kg → flagged for review, no forced change', () => {
  const r = E.evaluatePhase(PHASES.FINAL_CUT, bfSeries([12, 12, 12, 12, 12, 12, 12], 84), REVIEW);
  assert.equal(r.phase, PHASES.FINAL_CUT); assert.equal(r.flag, 'review'); assert.match(r.reason, /Flagged for review/);
});

// ---------- macros ----------
test('macros: cut at 2100 kcal, 81.8 kg', () => {
  const m = E.macros(2100, 81.8, PHASES.CUT);
  assert.deepEqual([m.protein, m.fat, m.carbs], [180, 65, 198]);
  assert.ok(m.totalKcal <= 2100);
  assert.match(m.why.protein, /2\.2 g per kg/);
  assert.match(m.why.carbs, /calories left after protein and fat/);
});
test('macros: lean bulk uses 2.0 g/kg protein', () => {
  assert.equal(E.macros(2800, 78, PHASES.LEAN_BULK).protein, 155);
});
test('macros: never negative carbs, returns a review state', () => {
  const m = E.macros(1000, 90, PHASES.CUT);
  assert.equal(m.ok, false); assert.equal(m.carbs, 0); assert.match(m.why.carbs, /Review needed/);
});

// ---------- progress ----------
test('progress: cut from 20% toward 10%, now 15% → 50%', () => {
  assert.equal(E.phaseProgress(PHASES.CUT, { startBodyFat: 20, bodyFatTrend: 15 }).value, 0.5);
});
test('progress: clamped to 0–100%', () => {
  assert.equal(E.phaseProgress(PHASES.CUT, { startBodyFat: 20, bodyFatTrend: 21 }).value, 0);
  assert.equal(E.phaseProgress(PHASES.CUT, { startBodyFat: 20, bodyFatTrend: 9 }).value, 1);
});
test('progress: lean bulk from 76 kg toward 83 kg, now 79.5 → 50%, with BF ceiling', () => {
  const p = E.phaseProgress(PHASES.LEAN_BULK, { bulkStartWeight: 76, weightTrend: 79.5, bodyFatTrend: 13 });
  assert.equal(p.value, 0.5); assert.deepEqual(p.ceiling, { current: 13, max: 17 });
});

// ---------- discipline calendar ----------
test('discipline colours', () => {
  assert.equal(E.dayStatus({ kcal: 2150, protein: 175 }, TARGET).status, 'green');
  assert.equal(E.dayStatus({ kcal: 2250, protein: 165 }, TARGET).status, 'yellow');
  assert.equal(E.dayStatus({ kcal: 2500, protein: 180 }, TARGET).status, 'red');
  assert.equal(E.dayStatus(null, TARGET).status, 'grey');
});

// ---------- maintenance + phase start ----------
test('maintenance: starts at 2600 and moves toward real data', () => {
  assert.equal(E.maintenanceEstimate([]).value, 2600);
  assert.equal(E.maintenanceEstimate([2800, 2800]).value, 2700);
});
test('observed maintenance from intake and weight change', () => {
  // ate 2100/day and lost 0.5 kg in a week → about 2650 maintenance
  assert.equal(Math.round(E.observedMaintenance(2100, 85, 84.5)), 2650);
});
test('phase start calories: lean bulk = maintenance + surplus for 0.25%/week', () => {
  const r = E.phaseStartCalories(PHASES.LEAN_BULK, { maintenance: 2700, weightKg: 76 });
  assert.equal(r.calories, 2900);   // 76 kg × 7700 ÷ 100 ÷ 7 × 0.25 ≈ 209 → 200 kcal surplus
});
test('phase start calories: final cut never below the 1800 floor', () => {
  assert.equal(E.phaseStartCalories(PHASES.FINAL_CUT, { maintenance: 1900, weightKg: 83, bodyFatPct: 17 }).calories, 1800);
});

// ---------- target trajectory ----------
test('trajectory: cut steps down at the band midpoint and stops at 10%', () => {
  const t = E.targetTrajectory({ phase: PHASES.CUT, fromDate: '2026-10-01', weightKg: 90, bodyFatPct: 18 });
  assert.equal(t[1].weightKg, 89.37);          // 0.7% of 90 = 0.63 kg
  assert.ok(t[t.length - 2].bodyFatPct > 10);
  assert.ok(t.every((p, i) => i === 0 || p.weightKg < t[i - 1].weightKg));
});
test('trajectory: lean bulk gains 0.25%/week until 83 kg', () => {
  const t = E.targetTrajectory({ phase: PHASES.LEAN_BULK, fromDate: '2026-10-01', weightKg: 80, bodyFatPct: 11 });
  assert.equal(t[1].weightKg, 80.2); assert.ok(t[t.length - 1].weightKg >= 83);
});
