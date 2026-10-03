// =====================================================================
// OVERLAYS — the daily mission sheet and the weekly recap story.
// =====================================================================
(function(root){
'use strict';
const X = root.X, NC = () => root.NC;
const pct = (v, t) => t ? Math.max(0, Math.min(100, v / t * 100)) : 0;

function open(html, onClose){
  const ov = document.createElement('div'); ov.className = 'ov'; ov.innerHTML = html; document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const close = () => { if (ov.dataset.closing) return; ov.dataset.closing = 1; ov.classList.add('closing'); document.body.style.overflow = ''; onClose && onClose(); setTimeout(() => ov.remove(), 300); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  const esc = e => { if (e.key === 'Escape'){ close(); removeEventListener('keydown', esc); } }; addEventListener('keydown', esc);
  return { ov, close };
}

// ---------- today's mission ----------
X.mission = () => {
  const c = NC(), S = c.S, g = root.Game.compute(), today = c.todayISO(), t = c.targetsOf(c.planFor(today)), PL = c.PL, XP = root.Game.XP;
  const m = g.today.macros || { kcal: 0, protein: 0 }, nS = PL.SUPPLEMENTS.length;
  const list = [
    [`Hit ${t.calories.toLocaleString()} kcal, within ±5%`, g.today.status === 'green', `+${XP.green}`],
    [`Eat at least ${Math.ceil(t.protein * .95)} g protein`, m.protein >= t.protein * .95, ''],
    ['Log all 5 meals', g.today.meals >= 5, `+${5 * XP.meal}`],
    [`Take your ${nS} supplements`, g.today.supps >= nS, `+${nS * XP.supp}`],
    ['Weigh in', g.today.measured, `+${XP.checkin}`]
  ];
  const done = list.filter(x => x[1]).length;
  const { close } = open(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Today's mission">
    <div class="spread"><span class="eyebrow">Today’s mission · ${c.PL.DAY_LABEL[c.PL.dayType(today)]}</span><span class="eyebrow">${done}/5</span></div>
    <h2 class="display">${X.greet()}</h2>
    <div class="mstreak ${g.streak ? '' : 'cold'}">${X.FLAME}<div><b class="num">${g.streak} day${g.streak === 1 ? '' : 's'}</b><div class="why">${g.streak ? 'Don’t break the chain.' : 'Every streak starts at one. Today is day one.'}</div></div></div>
    <ol class="mlist">${list.map(([txt, ok, xp], i) => `<li class="${ok ? 'ok' : ''}"><b>${ok ? '✓' : String(i + 1).padStart(2, '0')}</b><span>${txt}</span><em>${xp ? xp + ' XP' : ''}</em></li>`).join('')}</ol>
    <p class="why">Up to <b style="color:var(--fg)">+${root.Game.MAX_DAY_XP() + 5 * Math.min(g.streak + 1, XP.streakBonusCap)} XP</b> today, streak bonus included. Level ${g.level.n} · ${g.level.name}.</p>
    <button class="btn big" data-go>${done === 5 ? 'Mission complete' : done ? 'Back to it' : 'Accept mission'}</button>
  </div>`);
  document.querySelector('[data-go]').addEventListener('click', () => { close(); if (done < 5){ c.S.tab = 'log'; c.S.logDate = today; c.S.enter = true; c.render(); scrollTo(0, 0); } });
};

// ---------- weekly recap story ----------
const weekKey = () => { const c = NC(); return c.E.addDays(c.todayISO(), -((new Date().getDay() + 6) % 7)); };
X.storySeen = () => { try { return localStorage.getItem('nc-story-seen') === weekKey(); } catch(_){ return false; } };

function recap(){
  const c = NC(), S = c.S, E = c.E, g = root.Game.compute(), today = c.todayISO(), t = c.targetsOf(c.planFor(today));
  const days = g.week, hits = days.filter(d => d.status === 'green' || d.status === 'yellow').length;
  const acts = days.map(d => c.dayActual(d.date)).filter(Boolean);
  const avg = k => acts.length ? acts.reduce((s, a) => s + a.macros[k], 0) / acts.length : 0;
  const w1 = E.trend(S.measurements, 'weightKg', today), w0 = E.trend(S.measurements, 'weightKg', E.addDays(today, -7));
  const b1 = E.trend(S.measurements, 'bodyFatPct', today), b0 = E.trend(S.measurements, 'bodyFatPct', E.addDays(today, -7));
  return { g, t, days, hits, acts, kcal: avg('kcal'), protein: avg('protein'), meals: acts.reduce((s, a) => s + a.mealsLogged, 0),
    xp: days.reduce((s, d) => s + d.xp, 0), dw: w1.ok && w0.ok ? w1.value - w0.value : null, w: w1.ok ? w1.value : null,
    dbf: b1.ok && b0.ok ? b1.value - b0.value : null, range: `${c.dayLabel(days[0].date)} – ${c.dayLabel(today)}` };
}
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);

function slides(r){
  const c = NC(), phase = c.S.profile.phase, cutting = phase !== 'lean_bulk', [line] = X.coachLine(r.g);
  const verdict = r.hits >= 6 ? 'Elite consistency.' : r.hits >= 5 ? 'Solid week. Enough to judge your calories.' : r.hits >= 3 ? 'Good start. Five days on target is the bar.' : 'This week slipped. Next one is yours.';
  const bodyMsg = r.dw == null ? 'Not enough weigh-ins for a trend. Four in seven days unlocks it.'
    : (cutting ? r.dw < 0 : r.dw > 0) ? `Moving the right way for a ${c.E.PHASE_LABEL[phase].toLowerCase()}.` : `Not moving yet. The weekly review handles the calories, your job is consistency.`;
  return [
    `<span class="eyebrow">Your week · ${r.range}</span><div class="st-big num">${r.hits}<small>/7</small></div><h2 class="st-t">days on target</h2>
     <div class="st-dots">${r.days.map(d => `<span class="${d.status}"><i></i>${'SMTWTFS'[new Date(d.date + 'T00:00:00Z').getUTCDay()]}</span>`).join('')}</div><p class="st-p">${verdict}</p>`,
    `<span class="eyebrow">Fuel</span><h2 class="st-t">Your average day</h2>${r.acts.length ? `
     <div class="st-row"><span class="l">Calories</span><span class="v num">${Math.round(r.kcal).toLocaleString()}<small class="muted" style="font-size:15px"> / ${r.t.calories.toLocaleString()}</small></span><div class="bar"><span style="width:${pct(r.kcal, r.t.calories)}%"></span></div></div>
     <div class="st-row"><span class="l">Protein</span><span class="v num">${Math.round(r.protein)}<small class="muted" style="font-size:15px"> / ${r.t.protein} g</small></span><div class="bar"><span style="width:${pct(r.protein, r.t.protein)}%;background:var(--ring-p)"></span></div></div>
     <p class="st-p">Across ${r.acts.length} logged day${r.acts.length === 1 ? '' : 's'}.</p>` : '<p class="st-p">No meals logged this week. Logging every meal is the whole game.</p>'}`,
    `<span class="eyebrow">Body</span><div class="st-big num">${r.dw == null ? '—' : sgn(r.dw)}<small> kg</small></div><h2 class="st-t">7-day average weight</h2>
     ${r.w != null ? `<p class="st-p">Now ${r.w.toFixed(1)} kg${r.dbf != null ? ` · body fat ${sgn(r.dbf)} pts` : ''}.</p>` : ''}<p class="st-p">${bodyMsg}</p>`,
    `<span class="eyebrow">Grind</span><div class="st-big num">+${r.xp}<small> XP</small></div><h2 class="st-t">earned this week</h2>
     <div class="st-row"><span class="l">Meals logged</span><span class="v num">${r.meals}<small class="muted" style="font-size:15px"> / 35</small></span><div class="bar"><span style="width:${pct(r.meals, 35)}%;background:var(--ring-m)"></span></div></div>
     <p class="st-p">Level ${r.g.level.n} · ${r.g.level.name}. ${r.g.level.next - r.g.phaseXp} XP to level ${r.g.level.n + 1}.</p>`,
    `<span class="eyebrow">Streak</span><div class="mstreak ${r.g.streak ? '' : 'cold'}" style="background:none;border:0;padding:0">${X.FLAME}<div class="st-big num">${r.g.streak}</div></div>
     <h2 class="st-t">${r.g.streak ? 'days. Keep it alive.' : 'Start a new chain today.'}</h2><p class="st-p">${line}</p>
     <button class="btn big st-cta" data-close>Keep going</button>`
  ];
}

X.story = () => {
  const s = slides(recap()), n = s.length, DUR = 5200;
  let i = 0, timer = null;
  try { localStorage.setItem('nc-story-seen', weekKey()); } catch(_){}
  const { ov, close } = open(`<div class="st" role="dialog" aria-modal="true" aria-label="Weekly recap">
    <div class="st-bars">${s.map(() => '<span><i></i></span>').join('')}</div>
    <div class="st-head"><span class="brand-mark"></span>Weekly recap</div>
    <button class="st-x" data-close aria-label="Close">×</button>
    <div class="st-body"></div>
    <button class="st-tap l" aria-label="Previous"></button><button class="st-tap r" aria-label="Next"></button></div>`, () => { clearTimeout(timer); NC().render(); });
  ov.classList.add('story');
  const body = ov.querySelector('.st-body'), bars = [...ov.querySelectorAll('.st-bars span')], st = ov.querySelector('.st');
  const show = k => {
    if (k >= n){ close(); return; } i = Math.max(0, k);
    body.innerHTML = `<div class="st-slide t${i} st-view">${s[i]}</div>`;
    bars.forEach((b, j) => { b.className = j < i ? 'past' : j === i ? 'now' : ''; b.style.setProperty('--dur', DUR + 'ms'); const f = b.firstChild; f.style.animation = 'none'; f.offsetWidth; f.style.animation = ''; });
    clearTimeout(timer); if (i < n - 1) timer = setTimeout(() => show(i + 1), DUR);
    FX.haptic(5);
  };
  ov.querySelector('.st-tap.l').onclick = () => show(i - 1);
  ov.querySelector('.st-tap.r').onclick = () => show(i + 1);
  st.addEventListener('pointerdown', e => { if (e.target.closest('.st-tap')){ st.classList.add('paused'); } });
  st.addEventListener('pointerup', () => st.classList.remove('paused'));
  addEventListener('keydown', function k(e){ if (!ov.isConnected) return removeEventListener('keydown', k); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); });
  show(0);
};
})(window);
