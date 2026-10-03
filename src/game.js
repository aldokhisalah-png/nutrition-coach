// =====================================================================
// GAME — streaks, streak freezes, XP, levels and milestones.
// Derived entirely from saved logs, measurements and reviews (nothing extra is stored),
// so the numbers are always consistent and can't drift.
// =====================================================================
(function(root){
'use strict';
const XP = { meal: 10, supp: 5, checkin: 20, green: 100, yellow: 50, streakBonus: 5, streakBonusCap: 10, phase: 500, review: 150 };
const LEVELS = ['Rookie', 'Committed', 'Disciplined', 'Locked in', 'Relentless', 'Machine', 'Elite', 'Unbreakable', 'Legend'];
const FREEZE = { start: 1, max: 2, earnEvery: 7 };
const levelOf = xp => { const n = Math.floor(Math.sqrt(xp / 150)) + 1; return { n, name: LEVELS[Math.min(n - 1, LEVELS.length - 1)], base: (n - 1) ** 2 * 150, next: n ** 2 * 150 }; };

// Walk every day from the first record to today.
//   green / yellow day → streak +1 (every 7 in a row banks a freeze, max 2)
//   missed or red day  → a banked freeze covers it; otherwise the streak resets
//   today              → never breaks the streak while it's still in progress
function compute(){
  const C = root.NC, S = C.S, today = C.todayISO(), add = C.E.addDays, PL = C.PL;
  const mDates = S.measurements.map(m => m.date), measured = new Set(mDates);
  const first = [...Object.keys(S.logs), ...mDates].filter(d => d <= today).sort()[0];
  const byDate = {};
  let streak = 0, best = 0, freezes = FREEZE.start, run = 0, xp = 0, phaseXp = 0, meals = 0, greens = 0, greenRun = 0, perfect = false, fullStack = 0;
  const phaseStart = S.profile.phaseStartDate;
  if (first) for (let d = first; d <= today; d = add(d, 1)){
    const st = C.statusFor(d).status, a = C.dayActual(d), l = S.logs[d];
    let dx = 0, frozen = false;
    const ml = a ? a.mealsLogged : 0; meals += ml; dx += ml * XP.meal;
    const sp = l ? Object.values(l.supps || {}).filter(Boolean).length : 0; dx += sp * XP.supp;
    if (sp >= PL.SUPPLEMENTS.length) fullStack++;
    if (measured.has(d)) dx += XP.checkin;
    if (st === 'green' || st === 'yellow'){
      streak++; run++;
      dx += (st === 'green' ? XP.green : XP.yellow) + XP.streakBonus * Math.min(streak, XP.streakBonusCap);
      if (st === 'green'){ greens++; if (++greenRun >= 7) perfect = true; } else greenRun = 0;
      if (run % FREEZE.earnEvery === 0 && freezes < FREEZE.max) freezes++;
    } else if (d !== today){
      greenRun = 0;
      if (streak > 0 && freezes > 0){ freezes--; frozen = true; } else { streak = 0; run = 0; }
    }
    best = Math.max(best, streak);
    xp += dx; if (d >= phaseStart) phaseXp += dx;
    byDate[d] = { status: frozen ? 'frozen' : st, xp: dx };
  }
  const phaseBonus = S.history.length * XP.phase, reviewsOk = S.reviews.filter(r => r.status === 'on_target').length;
  xp += phaseBonus + reviewsOk * XP.review;
  phaseXp += S.reviews.filter(r => r.status === 'on_target' && r.reviewDate >= phaseStart).length * XP.review;
  const level = levelOf(phaseXp);
  const todaySt = first ? byDate[today].status : 'grey', todayA = C.dayActual(today);

  const week = Array.from({ length: 7 }, (_, i) => { const d = add(today, i - 6); return { date: d, status: (byDate[d] || { status: 'grey' }).status, xp: (byDate[d] || {}).xp || 0 }; });

  const B = [
    ['first-checkin', '1', 'First weigh-in', 'Log a check-in', S.measurements.length, 1],
    ['first-green', '✓', 'Bullseye', 'First green day', greens, 1],
    ['streak3', '3', 'On fire', '3-day streak', best, 3],
    ['streak7', '7', 'One week', '7-day streak', best, 7],
    ['streak14', '14', 'Fortnight', '14-day streak', best, 14],
    ['streak30', '30', 'Iron month', '30-day streak', best, 30],
    ['perfect', '7G', 'Perfect week', '7 greens in a row', perfect ? 1 : 0, 1],
    ['stack', 'S', 'Full stack', 'All supplements in a day', fullStack, 1],
    ['meals25', '25', 'Regular', 'Log 25 meals', meals, 25],
    ['meals100', '100', 'Centurion', 'Log 100 meals', meals, 100],
    ['review', 'R', 'Dialed in', 'Review on target', reviewsOk, 1],
    ['phase', 'P', 'Phase cleared', 'Finish a phase', S.history.length, 1]
  ].map(([key, glyph, name, desc, v, goal]) => ({ key, glyph, name, desc, v: Math.min(v, goal), goal, done: v >= goal }));

  return { streak, best, freezes, xp, phaseXp, level, meals, greens, week, byDate, badges: B,
    today: { status: todaySt, meals: todayA ? todayA.mealsLogged : 0, macros: todayA ? todayA.macros : null, measured: measured.has(today),
      supps: S.logs[today] ? Object.values(S.logs[today].supps || {}).filter(Boolean).length : 0, xp: first ? byDate[today].xp : 0 } };
}

const MAX_DAY_XP = () => 5 * XP.meal + root.NC.PL.SUPPLEMENTS.length * XP.supp + XP.checkin + XP.green;
root.Game = { compute, levelOf, XP, LEVELS, MAX_DAY_XP };
})(window);
