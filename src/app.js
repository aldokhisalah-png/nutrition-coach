// =====================================================================
// APP — screens. All decisions come from NutritionEngine; this file only stores and displays.
// =====================================================================
(function(){
'use strict';
const E = window.NutritionEngine, Store = window.Store, P = E.PHASES, PL = window.Plan, N = window.Nutrients;
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (x, d = 1) => x == null || !isFinite(x) ? '—' : String(+(+x).toFixed(d));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dayLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }); };
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

const S = { tab: 'progress', loaded: false, profile: null, measurements: [], history: [], chartMode: 'weight', form: { date: todayISO(), w: '', bf: '' }, formErr: '', editId: null, edit: {}, showAll: false, notice: null, readout: '',
  plans: [], logs: {}, reviews: [], grocery: {}, logDate: todayISO(), microsDate: todayISO(), microsSource: 'plan', mealEdit: null, addFor: null, custom: {}, openNutrient: null, suppEdit: false };

// ---------- profile + phase state ----------
const DEFAULT_PROFILE = () => ({ phase: P.CUT, phaseStartDate: todayISO(), calories: E.ENERGY.initialCutCalories, startBodyFat: null, bulkStartWeight: null, slowStreak: 0, maintenanceObs: [], flag: null,
  caloriesReason: `The cut starts at ${E.ENERGY.initialCutCalories} kcal: your starting target, about ${E.ENERGY.initialMaintenance - E.ENERGY.initialCutCalories} kcal below the initial ${E.ENERGY.initialMaintenance} kcal maintenance estimate.` });
async function saveProfile(){ await Store.put('profile', S.profile, 'profile'); }

async function load(){
  const prof = await Store.get('profile');
  S.profile = prof ? { ...DEFAULT_PROFILE(), ...prof.body } : DEFAULT_PROFILE();
  if (!prof) await saveProfile();
  S.measurements = (await Store.all('measurement')).map(r => ({ id: r.id, ...r.body, updatedAt: r.updatedAt }));
  S.history = (await Store.all('phase_history')).map(r => r.body).sort((a, b) => a.at - b.at);
  S.plans = (await Store.all('plan_version')).map(r => r.body).sort((a, b) => a.version - b.version);
  S.logs = Object.fromEntries((await Store.all('food_log')).map(r => [r.body.date, { id: r.id, ...r.body }]));
  S.reviews = (await Store.all('weekly_review')).map(r => r.body).sort((a, b) => a.reviewDate < b.reviewDate ? -1 : 1);
  S.grocery = Object.fromEntries((await Store.all('grocery_check')).map(r => [r.body.week, { id: r.id, ...r.body }]));
  await checkPhase();
  await runReviews();
  await ensurePlan();
  S.loaded = true; S.enter = true; render();
}

// Applies automatic rules after every new measurement: fill in starting values, then check the phase.
async function checkPhase(){
  const pr = S.profile, today = todayISO(), m = S.measurements;
  let dirty = false;
  const bf = E.trend(m, 'bodyFatPct', today), wt = E.trend(m, 'weightKg', today);
  // Starting values = the first reliable 7-day averages on or after the phase start date.
  const firstTrend = field => { for (let d = pr.phaseStartDate; d <= today; d = E.addDays(d, 1)){ const t = E.trend(m, field, d); if (t.ok) return { date: d, value: +t.value.toFixed(2) }; } return null; };
  if ((pr.phase === P.CUT || pr.phase === P.FINAL_CUT) && pr.startBodyFat == null){
    const f = firstTrend('bodyFatPct');
    if (f){ const w0 = E.trend(m, 'weightKg', f.date); pr.startBodyFat = f.value; pr.startWeight = w0.ok ? +w0.value.toFixed(2) : null; pr.trajectoryStart = f.date; dirty = true; }
  }
  if (pr.phase === P.LEAN_BULK && pr.bulkStartWeight == null){ const f = firstTrend('weightKg'); if (f){ pr.bulkStartWeight = f.value; pr.trajectoryStart = f.date; dirty = true; } }
  if (pr.phase !== P.DONE){
    const ev = E.evaluatePhase(pr.phase, m, today);
    pr.flag = ev.flag ? ev.reason : null;
    // Transitions are detected here but only applied once you confirm (smart-scale BF is noisy).
    const pend = ev.changed ? { from: pr.phase, to: ev.phase, reason: ev.reason, date: today } : null;
    if (JSON.stringify(pend && [pend.from, pend.to]) !== JSON.stringify(pr.pendingPhase && [pr.pendingPhase.from, pr.pendingPhase.to])){
      pr.pendingPhase = pend; pr.pendingSnooze = null; dirty = true;
    } else if (pend && pr.pendingPhase.reason !== pend.reason){ pr.pendingPhase = pend; dirty = true; }
  }
  if (dirty) await saveProfile();
}
async function confirmPhase(){
  const pr = S.profile, today = todayISO(), m = S.measurements, pp = pr.pendingPhase;
  if (!pp || pp.from !== pr.phase) return;
  const bf = E.trend(m, 'bodyFatPct', today), wt = E.trend(m, 'weightKg', today), ev = { phase: pp.to, reason: pp.reason };
  {
    {
      const from = pr.phase, to = ev.phase;
      const maint = E.maintenanceEstimate(pr.maintenanceObs).value;
      pr.phase = to; pr.phaseStartDate = today; pr.slowStreak = 0;
      if (to === P.LEAN_BULK){ pr.bulkStartWeight = wt.ok ? +wt.value.toFixed(2) : null; pr.startWeight = pr.bulkStartWeight; pr.startBodyFat = bf.ok ? +bf.value.toFixed(2) : null; }
      if (to === P.FINAL_CUT){ pr.startBodyFat = bf.ok ? +bf.value.toFixed(2) : null; pr.startWeight = wt.ok ? +wt.value.toFixed(2) : null; }
      pr.trajectoryStart = today;
      if (to !== P.DONE && wt.ok){
        const c = E.phaseStartCalories(to, { maintenance: maint, weightKg: wt.value, bodyFatPct: bf.ok ? bf.value : null });
        pr.calories = c.calories; pr.caloriesReason = c.reason;
      }
      const entry = { at: Date.now(), date: today, from, to, reason: ev.reason, calories: pr.calories };
      await Store.put('phase_history', entry, 'phase_history:' + entry.at); S.history.push(entry);
      S.notice = { kind: 'good', text: `${ev.reason} You confirmed the switch. ${to !== P.DONE ? pr.caloriesReason : ''}` };
    }
  }
  pr.pendingPhase = null; pr.pendingSnooze = null;
  await saveProfile(); await ensurePlan(today, `Phase changed to ${E.PHASE_LABEL[pr.phase]} after you confirmed.`); S.enter = true; render();
  window.FX && (FX.confetti(innerWidth / 2, innerHeight * .3, 180), FX.haptic([20, 40, 20, 40, 30]));
}
const PHASE_PROMPT = {
  'cut>lean_bulk': ['Cut target reached', 'Ready to start Lean Bulk'],
  'lean_bulk>final_cut': ['Bulk target reached', 'Ready to start Final Cut'],
  'final_cut>done': ['Final cut target reached', 'Ready to finish the program']
};
function phasePrompt(){
  const pp = S.profile.pendingPhase;
  if (!pp || pp.from !== S.profile.phase || S.profile.pendingSnooze === S.measurements.length) return '';
  const [t, s] = PHASE_PROMPT[pp.from + '>' + pp.to] || ['Phase target reached', `Ready to start ${E.PHASE_LABEL[pp.to]}`];
  return `<section class="card phase-prompt" style="margin-bottom:14px">
    <span class="eyebrow" style="color:var(--accent)">Needs your confirmation</span>
    <h2 class="display" style="font-size:clamp(40px,7vw,60px)">${t}<br><span style="color:var(--accent)">${s}</span></h2>
    <p class="why">${esc(pp.reason)}</p>
    <p class="why">Smart-scale body fat can swing a few points, so nothing changes until you confirm. Calories and macros are reset for the new phase when you do.</p>
    <div class="row"><button class="btn" data-act="phase-confirm">Start ${E.PHASE_LABEL[pp.to].toLowerCase()}</button><button class="btn ghost" data-act="phase-snooze">Not yet, keep ${E.PHASE_LABEL[pp.from].toLowerCase()}</button></div>
  </section>`;
}

// ---------- actions ----------
async function saveCheckin(){
  const __b = window.X && X.snapshot(document.querySelector('[data-act="save"]'));
  const { date } = S.form, w = num(S.form.w), bf = num(S.form.bf);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick a date.');
  if (w == null && bf == null) return fail('Enter your weight, body fat, or both.');
  if (w != null && (w < 30 || w > 250)) return fail('Weight should be in kg, between 30 and 250.');
  if (bf != null && (bf < 3 || bf > 60)) return fail('Body fat should be a percentage between 3 and 60.');
  const existing = S.measurements.find(x => x.date === date);
  const body = { date, weightKg: w ?? existing?.weightKg ?? null, bodyFatPct: bf ?? existing?.bodyFatPct ?? null };
  const rec = await Store.put('measurement', body, existing ? existing.id : undefined);
  S.measurements = S.measurements.filter(x => x.id !== rec.id).concat({ id: rec.id, ...body, updatedAt: rec.updatedAt });
  S.form = { date: todayISO(), w: '', bf: '' }; S.formErr = '';
  await checkPhase(); await runReviews(); await ensurePlan(); render(); window.X && X.after(__b, 'checkin');
  function fail(msg){ S.formErr = msg; render(); }
}
async function saveEdit(id){
  const w = num(S.edit.w), bf = num(S.edit.bf), date = S.edit.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || (w == null && bf == null)) return;
  const body = { date, weightKg: w, bodyFatPct: bf };
  const rec = await Store.put('measurement', body, id);
  S.measurements = S.measurements.filter(x => x.id !== id).concat({ id, ...body, updatedAt: rec.updatedAt });
  S.editId = null; await checkPhase(); await ensurePlan(); render();
}
async function removeMeasurement(id){
  await Store.remove(id); S.measurements = S.measurements.filter(x => x.id !== id); S.editId = null; await checkPhase(); await ensurePlan(); render();
}

// Example data: 3 weeks of plausible cut readings, clearly marked, removable in one tap.
async function loadDemo(){
  const t = new Date(), iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const start = new Date(t); start.setDate(t.getDate() - 24);
  for (let i = 24; i >= 0; i--){
    if (i % 6 === 3) continue;
    const d = new Date(t); d.setDate(t.getDate() - i); const n = Math.sin(i * 1.7) * 0.35;
    await Store.put('measurement', { date: iso(d), weightKg: +(86 - (24 - i) * 0.085 + n).toFixed(1), bodyFatPct: +(19 - (24 - i) * 0.05 + n * 0.6).toFixed(1), demo: true });
  }
  S.profile = { ...DEFAULT_PROFILE(), phaseStartDate: iso(start), demo: true }; await saveProfile(); await load();
}
async function clearDemo(){
  for (const m of S.measurements) if (m.demo) await Store.remove(m.id);
  S.profile = DEFAULT_PROFILE(); await saveProfile(); await load();
}

// ---------- view helpers ----------
const ICONS = {
  progress: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  macros: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 4v8l6 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  micros: '<path d="M5 20V12M10 20V6M15 20V10M20 20V4" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  log: '<rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  cook: '<path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-2zM8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5M20 11l2-1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  grocery: '<path d="M3 4h2l2.4 11h11l2-8H6.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="19.5" r="1.5" fill="currentColor"/><circle cx="17" cy="19.5" r="1.5" fill="currentColor"/>'
};
const TABS = [['progress', 'Progress'], ['macros', 'Macros'], ['micros', 'Micros'], ['log', 'Log'], ['cook', 'Cook'], ['grocery', 'Grocery']];
function nav(){
  const items = TABS.map(([k, l]) => `<button class="nv-i" data-act="tab" data-v="${k}" aria-current="${S.tab === k}" aria-label="${l}"><svg viewBox="0 0 24 24">${ICONS[k]}</svg><span>${l}</span></button>`).join('');
  return `<aside class="rail"><div class="brand"><span class="brand-mark"></span><span class="brand-t">Nutrition<br>Coach</span></div><nav class="rail-nav">${items}</nav>${window.X ? X.railCard(S.g) : ''}</aside><nav class="tabbar">${items}</nav>`;
}
function render(){
  if (!S.loaded) return;
  S.g = window.Game ? Game.compute() : null;
  const v = S.tab === 'progress' ? viewProgress() : S.tab === 'macros' ? viewMacros() : S.tab === 'log' ? viewLog() : S.tab === 'micros' ? viewMicros() : S.tab === 'cook' ? viewCook() : viewGrocery();
  const enter = S.enter; S.enter = false;
  $app.innerHTML = nav() + `<main class="view${enter ? ' enter' : ''}" data-tab="${S.tab}">${v}</main>`;
  window.FX && FX.after($app);
  window.X && X.onRender();
}

// ---------- PROGRESS ----------
function viewProgress(){
  const pr = S.profile, today = todayISO(), m = S.measurements;
  const wt = E.trend(m, 'weightKg', today), bf = E.trend(m, 'bodyFatPct', today);
  const order = [P.CUT, P.LEAN_BULK, P.FINAL_CUT], idx = pr.phase === P.DONE ? 3 : order.indexOf(pr.phase);
  const legs = [
    { n: 'Phase 1', t: 'Cut', g: `Target about ${E.GOALS.cutBodyFat}% body fat` },
    { n: 'Phase 2', t: 'Lean bulk', g: `Target about ${E.GOALS.bulkWeight} kg · body-fat ceiling about ${E.GOALS.bulkBodyFatCeiling}%` },
    { n: 'Phase 3', t: 'Final cut', g: `Target about ${E.GOALS.finalBodyFat}% body fat · around ${E.GOALS.finalWeightMin}–${E.GOALS.finalWeightMax} kg` }
  ].map((l, i) => `<div class="leg ${i === idx ? 'on' : i < idx ? 'done' : ''}"><span class="n">${l.n}</span><span class="t">${l.t}</span><span class="g">${l.g}</span></div>`).join('');

  const prog = E.phaseProgress(pr.phase, { startBodyFat: pr.startBodyFat, bulkStartWeight: pr.bulkStartWeight, weightTrend: wt.ok ? wt.value : null, bodyFatTrend: bf.ok ? bf.value : null });
  const pctTxt = prog.value == null ? '—' : Math.round(prog.value * 100) + '%';
  const ev = pr.phase === P.DONE ? { reason: 'All three phases are complete.' } : E.evaluatePhase(pr.phase, m, today);
  const ceiling = prog.ceiling ? `<div class="stack" style="gap:6px"><div class="spread"><span class="eyebrow">Body-fat ceiling</span><span class="num">${fmt(prog.ceiling.current)}% / ${prog.ceiling.max}%</span></div>
      <div class="bar thin ${prog.ceiling.current / prog.ceiling.max > 0.9 ? 'warnfill' : ''}"><span style="width:${Math.min(100, prog.ceiling.current / prog.ceiling.max * 100)}%"></span></div></div>` : '';

  const hero = `<section class="card">
      <div class="spread"><span class="eyebrow">Current phase</span><span class="eyebrow">Since ${dayLabel(pr.phaseStartDate)}</span></div>
      <h2 class="display phase-name">${E.PHASE_LABEL[pr.phase]}</h2>
      ${pr.phase === P.DONE ? '' : `<div class="spread"><span class="eyebrow">Phase complete</span><span class="big-pct num">${pctTxt}</span></div>
      <div class="bar"><span style="width:${prog.value == null ? 0 : prog.value * 100}%"></span></div>
      <p class="why">${esc(prog.value == null ? (pr.phase === P.LEAN_BULK ? 'Progress starts once your first reliable 7-day weight average is in.' : 'Progress starts once your first reliable 7-day body-fat average is in. Log at least 4 readings in 7 days.') : prog.reason)}</p>`}
      ${ceiling}
      <p class="why">${esc(ev.reason)}</p>
      ${pr.flag ? `<div class="notice warn">${esc(pr.flag)}</div>` : ''}
    </section>`;

  const existing = S.measurements.find(x => x.date === S.form.date);
  const checkin = `<section class="card">
      <div class="spread"><h3 class="display" style="font-size:26px">Daily check-in</h3>${existing ? `<span class="eyebrow">Updates ${dayLabel(S.form.date)}</span>` : ''}</div>
      <div class="fields">
        <label class="field">Date<input type="date" id="f-date" value="${esc(S.form.date)}" max="${today}"></label>
        <label class="field">Weight (kg)<input id="f-w" inputmode="decimal" placeholder="${existing?.weightKg ?? 'e.g. 82.4'}" value="${esc(S.form.w)}"></label>
        <label class="field">Body fat (%)<input id="f-bf" inputmode="decimal" placeholder="${existing?.bodyFatPct ?? 'e.g. 17.2'}" value="${esc(S.form.bf)}"></label>
      </div>
      ${S.formErr ? `<div class="err">${esc(S.formErr)}</div>` : ''}
      <button class="btn" data-act="save">Save</button>
      <p class="why">Daily readings are inputs. Decisions use 7-day averages, so one high or low day changes nothing.</p>
    </section>`;

  const trendStat = (t, unit, label) => t.ok
    ? `<div class="stat"><span class="eyebrow">${label}</span><span class="v num">${fmt(t.value)}<small>${unit}</small></span><span class="s">${t.count} readings, last 7 days</span></div>`
    : `<div class="stat"><span class="eyebrow">${label}</span><span class="v num muted">—</span><span class="s">Not enough data for a reliable trend (${t.count} of 4 readings).</span></div>`;
  const trends = `<section class="card"><span class="eyebrow">7-day trends</span><div class="stats">${trendStat(wt, ' kg', 'Weight')}${trendStat(bf, '%', 'Body fat')}</div></section>`;

  const chart = `<section class="card">
      <div class="spread"><h3 class="display" style="font-size:26px">Trend</h3>
        <div class="seg" role="group" aria-label="Chart"><button data-act="mode" data-v="weight" aria-pressed="${S.chartMode === 'weight'}">Weight</button><button data-act="mode" data-v="bf" aria-pressed="${S.chartMode === 'bf'}">Body fat</button></div></div>
      ${chartSvg()}
      <div class="legend"><span><i style="border-color:var(--chart-raw);border-top-style:dotted;border-top-width:3px"></i>Daily</span><span><i style="border-color:var(--accent)"></i>7-day average</span>${S.chartMode === 'weight' ? '<span><i style="border-color:var(--warn);border-top-style:dashed"></i>Target trajectory</span>' : '<span><i style="border-color:var(--ice);border-top-style:dashed"></i>Recent trend</span>'}</div>
      ${S.chartMode === 'bf' ? `<p class="why">${esc(S.bfNote || '')}</p>` : ''}
      <div class="readout" id="readout">${esc(S.readout)}</div>
    </section>`;

  const sorted = [...S.measurements].sort((a, b) => a.date < b.date ? 1 : -1), shown = S.showAll ? sorted : sorted.slice(0, 10);
  const rows = shown.map(x => S.editId === x.id
    ? `<div class="hedit"><input type="date" id="e-date" value="${esc(S.edit.date)}" max="${today}"><input id="e-w" inputmode="decimal" value="${esc(S.edit.w)}" placeholder="kg"><input id="e-bf" inputmode="decimal" value="${esc(S.edit.bf)}" placeholder="%">
        <button class="btn sm" data-act="edit-save" data-id="${x.id}">Save</button><span class="row"><button class="link" data-act="edit-cancel">Cancel</button><button class="link danger" data-act="del" data-id="${x.id}">Delete</button></span></div>`
    : `<div class="hrow"><span class="d">${dayLabel(x.date)}</span><span class="num">${x.weightKg != null ? fmt(x.weightKg) + ' kg' : '—'}</span><span class="num">${x.bodyFatPct != null ? fmt(x.bodyFatPct) + '%' : '—'}</span><button class="link" data-act="edit" data-id="${x.id}">Edit</button></div>`).join('');
  const hist = `<section class="card"><div class="spread"><h3 class="display" style="font-size:26px">Measurements</h3><span class="eyebrow">${sorted.length} saved</span></div>
      ${sorted.length ? `<div class="hist">${rows}</div>${sorted.length > 10 ? `<button class="link" data-act="all">${S.showAll ? 'Show fewer' : `Show all ${sorted.length}`}</button>` : ''}` : '<p class="why">Your first check-in will appear here.</p><button class="btn ghost sm" data-act="demo">Try it with example data</button>'}
      ${S.profile.demo ? '<div class="notice warn">You are looking at example data, not your own readings. <button class="link" data-act="demo-clear">Clear example data</button></div>' : ''}</section>`;

  const notice = S.notice ? `<div class="notice ${S.notice.kind}">${esc(S.notice.text)} <button class="link" data-act="dismiss">OK</button></div>` : '';
  return `${window.X && S.g ? X.hero() : `<header class="page"><span class="eyebrow">${dayLabel(today)}</span><h1 class="display">Progress</h1></header>`}
    ${phasePrompt()}${notice}
    <section class="card" style="margin-bottom:14px"><span class="eyebrow">Physique roadmap</span><div class="road">${legs}</div></section>
    <div class="grid two"><div class="stack">${hero}${chart}${calendar()}</div><div class="stack">${checkin}${trends}${window.X && S.g ? X.badges() : ''}${hist}</div></div>`;
}

// SVG chart: daily readings (dots), 7-day average (line), target trajectory (dashed) from the phase start.
function chartSvg(){
  const field = S.chartMode === 'weight' ? 'weightKg' : 'bodyFatPct', unit = field === 'weightKg' ? ' kg' : '%';
  const today = todayISO(), pr = S.profile;
  const raw = E.readings(S.measurements, field).filter(r => r.date >= E.addDays(today, -120));
  const avg = []; if (raw.length){ for (let d = raw[0].date; d <= today; d = E.addDays(d, 1)){ const t = E.trend(S.measurements, field, d); if (t.ok) avg.push({ date: d, value: t.value }); } }
  let traj = [];
  const isBf = field === 'bodyFatPct';
  if (isBf){ traj = bfTrend(avg, today); }
  else if (pr.trajectoryStart && pr.phase !== P.DONE){
    const t = E.targetTrajectory({ phase: pr.phase, fromDate: pr.trajectoryStart, weightKg: pr.phase === P.LEAN_BULK ? pr.bulkStartWeight : pr.startWeight, bodyFatPct: pr.startBodyFat, maxWeeks: 40 });
    traj = t.filter(p => p[field] != null).map(p => ({ date: p.date, value: p[field] }));
  }
  if (!raw.length) return `<p class="why">Your chart appears after the first check-in.</p>`;
  const endTraj = traj.length ? traj[traj.length - 1].date : today;
  const xMin = raw[0].date, xMax = [today, E.addDays(today, 42) < endTraj ? E.addDays(today, 42) : endTraj].sort().pop();
  traj = traj.filter(p => p.date <= xMax);
  const vals = [...raw, ...avg, ...traj].map(p => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max((hi - lo) * 0.12, field === 'weightKg' ? 0.5 : 0.3); lo -= pad; hi += pad;
  const narrow = window.innerWidth < 600, W = narrow ? 360 : 640, H = narrow ? 230 : 260, L = 40, R = 10, T = 14, B = 26, span = Math.max(1, E.daysBetween(xMin, xMax));
  const x = d => L + E.daysBetween(xMin, d) / span * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const step = niceStep((hi - lo) / 4), ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(+v.toFixed(3));
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.06)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="#6c7570" font-size="11" font-family="IBM Plex Mono">${fmt(v)}</text>`).join('');
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const xl = [xMin, today].concat(xMax !== today ? [xMax] : []).map((d, i, a) => `<text x="${x(d)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}" fill="#6c7570" font-size="11" font-family="IBM Plex Mono">${dayLabel(d).replace(/^\w+,?\s*/, '')}</text>`).join('');
  const todayLine = `<line x1="${x(today)}" x2="${x(today)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.12)" stroke-dasharray="2 4"/>`;
  const goal = S.chartMode === 'bf' ? (pr.phase === P.CUT ? E.GOALS.cutBodyFat : pr.phase === P.FINAL_CUT ? E.GOALS.finalBodyFat : pr.phase === P.LEAN_BULK ? E.GOALS.bulkBodyFatCeiling : null) : (pr.phase === P.LEAN_BULK ? E.GOALS.bulkWeight : null);
  const goalLine = goal != null && goal >= lo && goal <= hi ? `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="rgba(143,214,168,.35)" stroke-dasharray="6 6"/><text x="${W - R}" y="${y(goal) - 5}" text-anchor="end" fill="#8fd6a8" font-size="11" font-family="IBM Plex Mono">goal ${goal}${unit}</text>` : '';
  const dots = raw.map(p => `<circle cx="${x(p.date)}" cy="${y(p.value)}" r="3" fill="#5b6560"/>`).join('');
  const last = avg[avg.length - 1];
  const data = esc(JSON.stringify({ raw: raw.map(p => [p.date, p.value]), avg: avg.map(p => [p.date, +p.value.toFixed(2)]), traj: traj.map(p => [p.date, +p.value.toFixed(2)]), tl: isBf ? 'trend' : 'target', xMin, span, L, W, R, unit }));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${S.chartMode === 'weight' ? 'Weight' : 'Body fat'} over time" data-chart="${data}">
    ${grid}${goalLine}${todayLine}
    ${traj.length > 1 ? `<path d="${path(traj)}" fill="none" stroke="${isBf ? '#8fc9ef' : '#f0b35e'}" stroke-width="2" stroke-dasharray="${isBf ? '3 6' : '6 5'}" stroke-linecap="round" ${isBf ? 'opacity=".8"' : ''}/>` : ''}
    ${dots}
    ${avg.length > 1 ? `<path d="${path(avg)}" fill="none" stroke="#8fd6a8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${last ? `<circle cx="${x(last.date)}" cy="${y(last.value)}" r="5" fill="#8fd6a8" stroke="#151917" stroke-width="2"/>` : ''}
    ${xl}<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.35)" visibility="hidden"/>
    <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg></div>`;
}
// Body fat: no modelled forecast. A straight line fitted to the last 3 weeks of 7-day averages,
// extended up to 6 weeks (or to the goal), labelled as a trend, not a prediction.
function bfTrend(avg, today){
  const pr = S.profile, goal = pr.phase === P.CUT ? E.GOALS.cutBodyFat : pr.phase === P.FINAL_CUT ? E.GOALS.finalBodyFat : pr.phase === P.LEAN_BULK ? E.GOALS.bulkBodyFatCeiling : null;
  const pts = avg.filter(p => p.date >= E.addDays(today, -21));
  if (pts.length < 7 || E.daysBetween(pts[0].date, pts[pts.length - 1].date) < 10){ S.bfNote = 'Smart-scale body fat is noisy, so there is no forecast here. A recent-trend line appears after about 2 weeks of readings.'; return []; }
  const xs = pts.map(p => E.daysBetween(pts[0].date, p.date)), mx = xs.reduce((a, b) => a + b) / xs.length, my = pts.reduce((a, p) => a + p.value, 0) / pts.length;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (pts[i].value - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const last = pts[pts.length - 1], wk = slope * 7, cutting = pr.phase !== P.LEAN_BULK;
  let days = 42;
  const toward = goal != null && (cutting ? slope < 0 && last.value > goal : slope > 0 && last.value < goal);
  if (toward) days = Math.min(days, Math.ceil((goal - last.value) / slope));
  const out = [{ date: last.date, value: last.value }, { date: E.addDays(last.date, days), value: last.value + slope * days }];
  const dir = Math.abs(wk) < 0.05 ? 'flat' : `${wk < 0 ? 'down' : 'up'} about ${fmt(Math.abs(wk))} points a week`;
  const eta = toward && cutting ? ` At that pace you would reach ${goal}% in roughly ${Math.max(1, Math.round((goal - last.value) / slope / 7))} weeks, but treat that as a rough guide.` : '';
  S.bfNote = `Your 7-day body-fat average has been ${dir} over the last 3 weeks.${eta} Scale body fat is noisy, so phase decisions wait for your confirmation.`;
  return out;
}
function niceStep(raw){ const m = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(k => k * m).find(s => s >= raw) || 10 * m; }

// =====================================================================
// PLAN VERSIONS — targets are snapshotted; history is never rewritten.
// A new version is made when: there is none yet; the first reliable weight trend arrives;
// calories change (weekly review or phase change); or a weekly review changes the macros.
// =====================================================================
const r5 = x => Math.round(x / 5) * 5;
const SOLVER = 2;   // bump when the quantity solver changes; the current plan is then recalculated as a new version
function latestPlan(){ return S.plans[S.plans.length - 1] || null; }
function planFor(date){ let v = null; for (const p of S.plans) if (p.from <= date) v = p; return v || S.plans[0] || null; }
function plannedDay(date){ const pv = planFor(date); return pv ? pv.days[PL.dayType(date)] : null; }
function targetsOf(pv){ return pv ? { calories: pv.calories, protein: pv.protein, carbs: pv.carbs, fat: pv.fat } : null; }

async function ensurePlan(fromDate, reasonIn, review){
  const pr = S.profile, today = todayISO(), from = fromDate || today, cur = latestPlan();
  const basis = review ? E.addDays(from, -1) : today;
  const wt = E.trend(S.measurements, 'weightKg', basis);
  const phase = pr.phase === P.DONE ? P.FINAL_CUT : pr.phase;
  let next = null, reason = reasonIn;
  if (wt.ok){
    const m = E.macros(pr.calories, wt.value, phase);
    next = { base:false, calories: pr.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, weightKg: +wt.value.toFixed(1), why: m.why, macrosOk: m.ok };
  } else if (!cur){
    const bm = PL.dayMacros(PL.baseDay('salmon'));
    next = { base:true, calories: pr.calories, protein: r5(bm.protein), carbs: r5(bm.carbs), fat: r5(bm.fat), weightKg: null, macrosOk: true,
      why: { protein: 'Protein comes from the starting plan for now. It will be set at 2.2 g per kg once you have 4 weigh-ins in 7 days.',
             fat: 'Fat comes from the starting plan for now. It will be set at 0.8 g per kg once you have a reliable 7-day average weight.',
             carbs: 'Carbs come from the starting plan for now. They will be set from the calories left after protein and fat.' } };
    reason = reason || 'Starting plan: the fixed diet at its starting quantities.';
  }
  if (!next) return;
  const outdated = cur && !cur.base && !next.base && cur.solver !== SOLVER;
  const differs = !cur || outdated || (cur.base && !next.base) || cur.calories !== next.calories || (review && !next.base && (cur.protein !== next.protein || cur.fat !== next.fat || cur.carbs !== next.carbs));
  if (!differs) return;
  if (outdated && !reason) reason = 'Meal plan recalculated so each day hits your protein, carbs and fat to the gram.';
  if (!reason) reason = cur && cur.base && !next.base ? 'Your first reliable 7-day average weight is in, so protein, fat and carbs are now set from it.' : (pr.caloriesReason || 'Targets updated.');
  const t = { calories: next.calories, protein: next.protein, carbs: next.carbs, fat: next.fat };
  const days = next.base
    ? Object.fromEntries(['salmon', 'beef', 'beef_liver'].map(k => [k, { type:k, day: PL.baseDay(k), macros: PL.dayMacros(PL.baseDay(k)), changes: [], ok: true, summary: 'Starting quantities, not yet scaled to your targets.' }]))
    : PL.solvePlan(t);
  const body = { version: (cur ? cur.version : 0) + 1, from, createdAt: Date.now(), phase: pr.phase, ...next, reason, days, solver: SOLVER };
  await Store.put('plan_version', body, 'plan_version:' + body.version); S.plans.push(body);
}

// What changed between two plan versions for one day type, explained.
function versionDiff(prev, cur, type){
  if (!prev) return [];
  const g = d => { const o = {}; for (const m of d.day) for (const it of m.items) o[it.food] = it.grams; return o; };
  const a = g(prev.days[type]), b = g(cur.days[type]), out = [];
  const why = prev.calories !== cur.calories ? `because your calorie target ${cur.calories < prev.calories ? 'decreased' : 'increased'} by ${Math.abs(cur.calories - prev.calories)} kcal`
    : prev.protein !== cur.protein ? `because your protein target changed from ${prev.protein} g to ${cur.protein} g` : 'to fit the updated macros';
  for (const k of Object.keys(b)) if (a[k] !== b[k] && a[k] != null) out.push(`${PL.FOOD[k].name} ${b[k] < a[k] ? 'reduced' : 'increased'} by ${Math.abs(b[k] - a[k])} g (${a[k]} → ${b[k]} g) ${why}.`);
  return out;
}

// =====================================================================
// WEEKLY REVIEWS — one every 7 days, only once the 7-day window has fully ended.
// =====================================================================
function dayActual(date){
  const l = S.logs[date]; if (!l) return null;
  const items = Object.values(l.meals).filter(m => m.actual).flatMap(m => m.actual.map(itemOf));
  if (!Object.values(l.meals).some(m => m.actual)) return null;
  return { items, macros: PL.macrosOf(items), mealsLogged: Object.values(l.meals).filter(m => m.actual).length };
}
async function runReviews(){
  const pr = S.profile, firstReal = S.plans.find(p => !p.base);
  if (!firstReal || pr.phase === P.DONE) return;
  let last = pr.lastReviewDate || E.addDays(firstReal.from, -1), ran = false;
  const yesterday = E.addDays(todayISO(), -1);
  while (E.addDays(last, 7) <= yesterday){
    const reviewDate = E.addDays(last, 7), dayLogs = {};
    for (let i = 0; i < 7; i++){ const d = E.addDays(reviewDate, -i), a = dayActual(d); if (a) dayLogs[d] = { kcal: a.macros.kcal, protein: a.macros.protein }; }
    const target = d => targetsOf(planFor(d));
    const r = E.weeklyReview({ phase: pr.phase, calories: pr.calories, reviewDate, measurements: S.measurements, dayLogs, target, slowStreak: pr.slowStreak || 0 });
    const obs = r.details && r.details.observedMaintenance;
    if (obs != null && isFinite(obs) && !['low_adherence', 'insufficient_data'].includes(r.status)) pr.maintenanceObs = (pr.maintenanceObs || []).concat(Math.round(obs));
    const before = pr.calories;
    pr.slowStreak = r.slowStreak; pr.calories = r.calories; pr.lastReviewDate = reviewDate; pr.lastReview = r.reason;
    if (r.change) pr.caloriesReason = r.reason;
    const rec = { reviewDate, status: r.status, change: r.change, from: before, to: r.calories, reason: r.reason,
      adherence: r.details && r.details.adherence ? r.details.adherence.count : null, changePct: r.details ? r.details.changePct ?? null : null };
    await Store.put('weekly_review', rec, 'weekly_review:' + rec.reviewDate); S.reviews.push(rec);
    await ensurePlan(E.addDays(reviewDate, 1), r.change ? r.reason : 'Weekly review: protein, fat and carbs refreshed from your current 7-day average weight.', true);
    ran = true;
  }
  if (ran){ await saveProfile(); const lr = S.reviews[S.reviews.length - 1]; S.notice = { kind: lr.change ? 'good' : '', text: 'Weekly review: ' + lr.reason }; }
}

// =====================================================================
// FOOD LOG — every day stores the planned meals AND what was actually eaten.
// =====================================================================
function itemOf(it){
  if (it.custom) return { name: it.name, grams: 100, customKcal: true, per100g: { kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat } };
  const f = PL.FOOD[it.food]; return { name: f.name, grams: it.grams, per100g: f.per100g };
}
function logFor(date, create){
  if (S.logs[date]) return S.logs[date];
  if (!create) return null;
  const pv = planFor(date), day = plannedDay(date);
  const meals = Object.fromEntries(day.day.map(m => [m.key, { name: m.name, planned: JSON.parse(JSON.stringify(m.items)), actual: null }]));
  return (S.logs[date] = { date, planVersion: pv.version, meals, supps: {}, otherCaffeine: 0 });
}
async function saveLog(date){
  const l = S.logs[date], body = { ...l }; delete body.id;
  const rec = await Store.put('food_log', body, l.id || 'food_log:' + date); l.id = rec.id;
}
async function logAction(act, el){
  const __b = window.X && ['ate', 'supp', 'item-add-save', 'meal-edit'].includes(act) ? X.snapshot(el) : null;
  const date = S.logDate, l = logFor(date, true), mk = el.dataset.meal, meal = mk ? l.meals[mk] : null;
  const clone = x => JSON.parse(JSON.stringify(x));
  if (act === 'ate'){ meal.actual = clone(meal.planned); S.mealEdit = null; }
  else if (act === 'meal-edit'){ if (!meal.actual) meal.actual = clone(meal.planned); S.mealEdit = S.mealEdit === mk ? null : mk; S.addFor = null; }
  else if (act === 'meal-else'){ meal.actual = []; S.mealEdit = mk; S.addFor = mk; S.custom = {}; }
  else if (act === 'meal-undo'){ meal.actual = null; S.mealEdit = null; }
  else if (act === 'item-remove'){ meal.actual.splice(+el.dataset.i, 1); }
  else if (act === 'item-add'){ S.addFor = S.addFor === mk ? null : mk; S.custom = { food: 'chicken_breast', grams: '' }; }
  else if (act === 'item-add-save'){
    if (S.custom.mode === 'custom'){
      const c = S.custom, kcal = num(c.kcal), protein = num(c.protein) ?? 0, carbs = num(c.carbs) ?? 0, fat = num(c.fat) ?? 0;
      if (!c.name || kcal == null) { S.custom.err = 'Give it a name and its calories.'; render(); return; }
      meal.actual.push({ custom: true, name: c.name, kcal, protein, carbs, fat });
    } else {
      const g = num(S.custom.grams); if (!(g > 0)) { S.custom.err = 'Enter the grams.'; render(); return; }
      meal.actual.push({ food: S.custom.food, grams: Math.round(g) });
    }
    S.addFor = null; S.custom = {};
  }
  else if (act === 'add-mode'){ S.custom = { ...S.custom, mode: el.dataset.v, err: '' }; render(); return; }
  else if (act === 'supp'){ l.supps[el.dataset.k] = !l.supps[el.dataset.k]; }
  await saveLog(date); render(); window.X && X.after(__b, act);
}

// ---------- discipline calendar (month of S.logDate) ----------
function statusFor(date){
  const a = dayActual(date), pv = planFor(date);
  if (!pv) return { status: 'grey', reason: 'No plan.' };
  if (!a) return { status: 'grey', reason: 'No sufficient food log for this day.' };
  if (date === todayISO() && a.mealsLogged < 5) return { status: 'progress', reason: `Day in progress: ${a.mealsLogged} of 5 meals logged. The colour is set once the day is complete.` };
  return E.dayStatus({ kcal: a.macros.kcal, protein: a.macros.protein, complete: true }, targetsOf(pv));
}
function calendar(){
  const [y, m] = (S.calMonth || todayISO().slice(0, 7)).split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = todayISO();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-c empty"></span>';
  for (let d = 1; d <= days; d++){
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const st = iso > today ? 'future' : statusFor(iso).status;
    cells += `<button class="cal-c ${st} ${iso === today ? 'today' : ''}" data-act="log-day" data-d="${iso}" ${iso > today ? 'disabled' : ''} title="${dayLabel(iso)}: ${esc(statusFor(iso).reason)}">${d}</button>`;
  }
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const thisMonth = todayISO().slice(0, 7), cur = `${y}-${String(m).padStart(2, '0')}`;
  return `<section class="card"><div class="spread"><h3 class="display" style="font-size:26px">Macro discipline</h3>
      <span class="row"><button class="btn ghost sm" data-act="cal-shift" data-d="-1" aria-label="Previous month">←</button><span class="num" style="min-width:7.5em;text-align:center">${label}</span><button class="btn ghost sm" data-act="cal-shift" data-d="1" ${cur >= thisMonth ? 'disabled' : ''} aria-label="Next month">→</button></span></div>
    <div class="cal">${['M','T','W','T','F','S','S'].map(x => `<span class="cal-h">${x}</span>`).join('')}${cells}</div>
    <div class="legend"><span><b class="dot green"></b>Calories ±5%, protein ≥95%</span><span><b class="dot yellow"></b>±10%, ≥90%</span><span><b class="dot red"></b>Outside</span><span><b class="dot grey"></b>Not logged</span></div>
    <p class="why">Tap a day to open its log.</p></section>`;
}

// =====================================================================
// VIEWS
// =====================================================================
const pctBar = (v, t) => `<div class="bar thin"><span style="width:${Math.max(0, Math.min(100, v / t * 100))}%"></span></div>`;
const STATE = { raw: 'raw', cooked: 'cooked', ready: 'ready to eat' };
function gramsLabel(it){
  if (it.custom) return `<span class="ig num">${Math.round(it.kcal)} kcal</span><span class="tag">custom</span>`;
  const ml = PL.ML_PER[it.food] ? ` · ${Math.round(it.grams / PL.ML_PER[it.food])} ml` : '';
  return `<span class="ig num">${it.grams} g${ml}</span><span class="tag">${STATE[PL.FOOD[it.food].state]}</span>`;
}
function itemName(it){ return `<span class="iname">${it.custom ? esc(it.name) : esc(PL.FOOD[it.food].name)}`; }
const macroLine = m => `<span class="num">${Math.round(m.kcal)} kcal · P ${Math.round(m.protein)} · C ${Math.round(m.carbs)} · F ${Math.round(m.fat)}</span>`;

// ---------- MACROS ----------
function viewMacros(){
  const pr = S.profile, today = todayISO(), pv = planFor(today);
  const head = `<header class="page"><span class="eyebrow">${dayLabel(today)}</span><h1 class="display">Macros</h1></header>`;
  if (!pv) return head + `<section class="card"><p class="why">No plan yet.</p></section>`;
  const todayType = PL.dayType(today), type = S.macroDay || todayType, prev = S.plans.find(p => p.version === pv.version - 1), sol = pv.days[type];
  const diff = versionDiff(prev, pv, type), solverWhy = sol.changes.map(c => c.reason);
  const lastRev = S.reviews[S.reviews.length - 1];
  const nextRev = pr.lastReviewDate ? E.addDays(pr.lastReviewDate, 7) : (S.plans.find(p => !p.base) ? E.addDays(S.plans.find(p => !p.base).from, 6) : null);
  return head + `<div class="grid two"><div class="stack"><section class="card">
      <div class="spread"><span class="eyebrow">${E.PHASE_LABEL[pr.phase]} · plan v${pv.version}</span><span class="eyebrow">since ${dayLabel(pv.from)}</span></div>
      <div class="macro-cal num">${pv.calories}<span class="muted" style="font-size:28px"> kcal</span></div>
      <div class="mgrid">
        <div class="stat"><span class="eyebrow">Protein</span><span class="v num">${pv.protein}<small>g</small></span></div>
        <div class="stat"><span class="eyebrow">Carbs</span><span class="v num">${pv.carbs}<small>g</small></span></div>
        <div class="stat"><span class="eyebrow">Fat</span><span class="v num">${pv.fat}<small>g</small></span></div>
      </div>
      ${pv.base ? '<div class="notice warn">These are the starting-plan numbers. Your own targets are set once you have 4 weigh-ins within 7 days.</div>' : ''}
      ${pv.macrosOk === false ? `<div class="notice warn">${esc(pv.why.carbs)}</div>` : ''}
    </section>
    <section class="card"><h3 class="display" style="font-size:24px">Weekly review</h3>
      <p class="why">${lastRev ? esc(`${dayLabel(lastRev.reviewDate)}: ${lastRev.reason}`) : 'No review yet.'}</p>
      <p class="why">${nextRev ? `Next review after ${dayLabel(nextRev)}. Calories only change at a review, never from one day’s weight.` : 'Reviews start once your targets are set from your weight.'}</p>
    </section></div>
    ${mealPlanCard(pv, type, todayType)}
    <section class="card"><h3 class="display" style="font-size:26px">Why these numbers</h3>
      <ul class="whylist">
        <li><b>Calories</b><span>${esc(pr.caloriesReason)}</span></li>
        <li><b>Protein</b><span>${esc(pv.why.protein)}</span></li>
        <li><b>Fat</b><span>${esc(pv.why.fat)}</span></li>
        <li><b>Carbs</b><span>${esc(pv.why.carbs)}</span></li>
        <li><b>${type === todayType ? 'Today' : 'This day'}</b><span>${esc(PL.DAY_LABEL[type])}. ${esc(sol.summary)} Calories are counted as 4 kcal per g of protein and carbs and 9 per g of fat, the same rule used to set your targets.</span></li>
        ${solverWhy.length ? `<li><b>Portions</b><span>${solverWhy.map(esc).join('<br>')}</span></li>` : ''}
        ${diff.length ? `<li><b>Changed</b><span>${diff.map(esc).join('<br>')}</span></li>` : ''}
      </ul>
    </section></div>`;
}

// The fixed diet with exact grams for a day type, meal by meal, with totals against the targets.
function mealPlanCard(pv, type, todayType){
  const sol = pv.days[type], t = targetsOf(pv), doses = S.profile.suppDoses || {};
  const types = [['salmon', 'Salmon day'], ['beef', 'Beef day'], ['beef_liver', 'Saturday']];
  const seg = types.map(([k, l]) => `<button data-act="mday" data-v="${k}" aria-pressed="${type === k}">${l}${k === todayType ? ' · today' : ''}</button>`).join('');
  const meals = sol.day.map(m => {
    const mm = PL.mealMacros(m), supps = PL.SUPPLEMENTS.filter(s => s.when === m.key);
    return `<div class="pmeal"><div class="spread"><span class="pm-name">${esc(m.name)}</span><span class="num muted" style="font-size:12.5px">${Math.round(mm.kcal)} kcal · P ${Math.round(mm.protein)} · C ${Math.round(mm.carbs)} · F ${Math.round(mm.fat)}</span></div>
      ${m.items.map(it => { const ch = sol.changes.find(c => c.food === it.food);
        return `<div class="irow">${itemName(it)}${ch ? ' <span class="tag adj">adjusted</span>' : ''}</span>${gramsLabel(it)}</div>`; }).join('')}
      ${supps.length ? `<div class="psupp">Then: ${supps.map(s => `${esc(s.name)} ${doses[s.key] ?? s.dose} ${esc(s.unit)}`).join(' · ')}</div>` : ''}</div>`;
  }).join('');
  const mac = sol.macros, cell = (lab, v, tv, u) => { const d = Math.round(v) - tv; return `<div class="stat"><span class="eyebrow">${lab}</span><span class="v num">${Math.round(v)}<small>${u}</small></span><span class="s ${Math.abs(d) <= (u === 'kcal' ? 15 : 1) ? 'hit' : ''}">${Math.abs(d) <= (u === 'kcal' ? 15 : 1) ? '✓ on target' : `${d > 0 ? '+' : ''}${d} vs ${tv}`}</span></div>`; };
  return `<section class="card"><div class="spread"><h3 class="display" style="font-size:26px">Meal plan</h3><span class="eyebrow">Plan v${pv.version}</span></div>
    <div class="seg wrap" role="group" aria-label="Day">${seg}</div>
    <div class="mgrid four">${cell('Calories', mac.kcal, t.calories, 'kcal')}${cell('Protein', mac.protein, t.protein, 'g')}${cell('Carbs', mac.carbs, t.carbs, 'g')}${cell('Fat', mac.fat, t.fat, 'g')}</div>
    ${sol.exact === false ? `<div class="notice warn">${esc(sol.summary)}</div>` : ''}
    <div class="pmeals">${meals}</div>
    <p class="why">Weights are for the state shown (raw, cooked or ready to eat). Only rice, sweet potato, olive oil and the protein foods are adjusted; fruit and vegetables stay fixed.</p></section>`;
}

// ---------- LOG ----------
function viewLog(){
  const date = S.logDate, today = todayISO(), pv = planFor(date);
  const head = `<header class="page"><span class="eyebrow">${E.PHASE_LABEL[S.profile.phase]} · ${PL.DAY_LABEL[PL.dayType(date)]}</span>
    <div class="spread"><h1 class="display">Log</h1><span class="row"><button class="btn ghost sm" data-act="log-shift" data-d="-1" aria-label="Previous day">←</button>
    <span class="num" style="min-width:8.5em;text-align:center">${dayLabel(date)}</span><button class="btn ghost sm" data-act="log-shift" data-d="1" ${date >= today ? 'disabled' : ''} aria-label="Next day">→</button></span></div></header>`;
  if (!pv) return head;
  const l = logFor(date, false), meals = l ? Object.entries(l.meals) : plannedDay(date).day.map(m => [m.key, { name: m.name, planned: m.items, actual: null }]);
  const a = dayActual(date), t = targetsOf(planFor(date)), st = a ? statusFor(date) : null;
  const sum = `<section class="card"><div class="spread"><span class="eyebrow">Eaten today vs target</span>${st ? `<span class="chip ${st.status}">${st.status}</span>` : ''}</div>
    <div class="mgrid four">${[['Calories', 'kcal', ''], ['Protein', 'protein', 'g'], ['Carbs', 'carbs', 'g'], ['Fat', 'fat', 'g']].map(([lab, k, u]) => {
      const v = a ? a.macros[k] : 0, tv = t[k === 'kcal' ? 'calories' : k];
      return `<div class="stat"><span class="eyebrow">${lab}</span><span class="v num">${Math.round(v)}<small>/${tv}${u}</small></span>${pctBar(v, tv)}</div>`; }).join('')}</div>
    ${st ? `<p class="why">${esc(st.reason)}</p>` : '<p class="why">Nothing logged yet. Tap “Ate as planned” after each meal.</p>'}</section>`;
  const mealCards = meals.map(([mk, m]) => {
    const planned = PL.macrosOf(m.planned.map(itemOf)), editing = S.mealEdit === mk && m.actual;
    const logged = m.actual ? PL.macrosOf(m.actual.map(itemOf)) : null;
    const plannedRows = m.planned.map(it => `<div class="irow">${itemName(it)}</span>${gramsLabel(it)}</div>`).join('');
    const actualRows = m.actual ? m.actual.map((it, i) => editing
      ? `<div class="irow edit">${itemName(it)}</span><span class="row">${it.custom ? `<span class="num">${Math.round(it.kcal)} kcal</span>` : `<input class="gin" id="g-${mk}-${i}" data-meal="${mk}" data-i="${i}" inputmode="numeric" value="${it.grams}"> g`}</span><button class="link danger" data-act="item-remove" data-meal="${mk}" data-i="${i}">Remove</button></div>`
      : `<div class="irow">${itemName(it)}</span>${gramsLabel(it)}</div>`).join('') : '';
    const adder = S.addFor === mk ? addForm(mk) : '';
    const same = m.actual && JSON.stringify(m.actual) === JSON.stringify(m.planned);
    return `<section class="card meal ${m.actual ? 'done' : ''}" id="meal-${mk}">
      <div class="spread"><h3 class="display" style="font-size:24px">${esc(m.name)}</h3>${m.actual ? `<span class="chip green">${same ? '✓ As planned' : '✓ Logged'}</span>` : `<span class="muted num" style="font-size:13px">${Math.round(planned.kcal)} kcal · P ${Math.round(planned.protein)}</span>`}</div>
      ${m.actual ? `<div class="items">${actualRows || '<p class="why">No foods yet. Add what you ate.</p>'}</div><div class="spread">${macroLine(logged)}<span class="row">
          <button class="link" data-act="meal-edit" data-meal="${mk}">${editing ? 'Done' : 'Edit meal'}</button>
          ${editing ? `<button class="link" data-act="item-add" data-meal="${mk}">Add food</button>` : ''}
          <button class="link danger" data-act="meal-undo" data-meal="${mk}">Undo</button></span></div>
          ${!same ? `<details class="plandiff"><summary>Planned</summary><div class="items">${plannedRows}</div></details>` : ''}`
        : `<div class="items">${plannedRows}</div>
          <button class="btn" data-act="ate" data-meal="${mk}">Ate as planned</button>
          <div class="row" style="justify-content:space-between"><button class="link" data-act="meal-edit" data-meal="${mk}">Edit meal</button><button class="link" data-act="meal-else" data-meal="${mk}">I ate something else</button></div>`}
      ${adder}
      ${suppBlock(mk, l)}
    </section>`;
  }).join('');
  return head + `<div class="grid two"><div class="stack">${window.X && S.g ? X.deck(date, meals) : ''}${sum}${mealCards}</div><div class="stack">${caffeineCard(l)}</div></div>`;
}
function addForm(mk){
  const c = S.custom, mode = c.mode || 'food';
  const opts = PL.MEALS && Object.values(PL.FOOD).map(f => `<option value="${f.key}" ${c.food === f.key ? 'selected' : ''}>${esc(f.name)} (${STATE[f.state]})</option>`).join('');
  return `<div class="addbox"><div class="seg"><button data-act="add-mode" data-meal="${mk}" data-v="food" aria-pressed="${mode === 'food'}">Food list</button><button data-act="add-mode" data-meal="${mk}" data-v="custom" aria-pressed="${mode === 'custom'}">Custom</button></div>
    ${mode === 'food' ? `<div class="fields two"><label class="field">Food<select id="add-food">${opts}</select></label><label class="field">Grams<input id="add-grams" inputmode="numeric" value="${esc(c.grams || '')}" placeholder="e.g. 150"></label></div>`
      : `<div class="fields"><label class="field" style="grid-column:1/-1">Name<input id="add-name" value="${esc(c.name || '')}" placeholder="e.g. Shawarma wrap"></label>
         <label class="field">Calories<input id="add-kcal" inputmode="decimal" value="${esc(c.kcal || '')}"></label><label class="field">Protein g<input id="add-protein" inputmode="decimal" value="${esc(c.protein || '')}"></label>
         <label class="field">Carbs g<input id="add-carbs" inputmode="decimal" value="${esc(c.carbs || '')}"></label><label class="field">Fat g<input id="add-fat" inputmode="decimal" value="${esc(c.fat || '')}"></label></div>
         <p class="why">Custom foods count toward calories and macros. Their vitamins and minerals are unknown, so Micros marks totals as incomplete.</p>`}
    ${c.err ? `<div class="err">${esc(c.err)}</div>` : ''}
    <button class="btn sm" data-act="item-add-save" data-meal="${mk}">Add</button></div>`;
}
function suppBlock(mk, l){
  const list = PL.SUPPLEMENTS.filter(s => s.when === mk); if (!list.length) return '';
  const doses = S.profile.suppDoses || {};
  return `<div class="supps"><span class="eyebrow">Supplements after this meal</span>${list.map(s => {
    const on = l && l.supps[s.key], dose = doses[s.key] ?? s.dose;
    return `<button class="supp ${on ? 'on' : ''}" data-act="supp" data-k="${s.key}" data-meal="${mk}" aria-pressed="${!!on}"><span class="box">${on ? '✓' : ''}</span><span>${esc(s.name)}</span><span class="num muted">${dose} ${esc(s.unit)}</span></button>`; }).join('')}</div>`;
}
function caffeineCard(l){
  const doses = S.profile.suppDoses || {}, pre = PL.SUPPLEMENTS.find(s => s.key === 'preworkout');
  const fromPre = l && l.supps.preworkout ? (doses.preworkout ?? pre.dose) : 0, other = l ? (l.otherCaffeine || 0) : 0, total = fromPre + other;
  return `<section class="card"><h3 class="display" style="font-size:24px">Caffeine</h3>
    <div class="spread"><span class="big-pct num" style="font-size:34px">${total}<small class="muted" style="font-size:16px"> mg</small></span><span class="why">Pre-workout ${fromPre} mg + other ${other} mg</span></div>
    <label class="field">Other caffeine today (coffee, tea, energy drinks), mg<input id="caf-other" inputmode="numeric" value="${other || ''}" placeholder="e.g. 95 for a cup of coffee"></label>
    ${total > 400 ? '<div class="notice warn">Above 400 mg, the amount the FDA says is generally not linked with negative effects for healthy adults.</div>' : ''}
    <details><summary class="link">Supplement doses</summary>${PL.SUPPLEMENTS.map(s => `<label class="field" style="margin-top:8px">${esc(s.name)} (${esc(s.unit)})<input id="dose-${s.key}" data-k="${s.key}" inputmode="decimal" value="${doses[s.key] ?? s.dose}"></label>`).join('')}
      <p class="why">Doses are used in Micros, the grocery list and the caffeine total.</p></details></section>`;
}

// ---------- MICROS gauge ----------
// Zones: Low (below target) · Adequate (target up to the "high" point) · High (80% of the upper limit up to it) · Above UL.
// Each zone is drawn to scale within its own band so small targets stay readable next to large limits.
function gauge(r, as){
  if (as.status === 'unavailable' || as.target == null) return '';
  const T = as.target, ulTotal = r.ul != null && r.ulBasis === 'total' ? r.ul : null, cd = r.cdrr || null;
  const stops = [{ v: 0, p: 0 }, { v: T, p: 46 }];
  let H = null, U = null;
  if (ulTotal){ H = ulTotal * 0.8; U = ulTotal; if (H <= T) H = (T + U) / 2; stops.push({ v: H, p: 76 }, { v: U, p: 90 }, { v: U * 1.25, p: 100 }); }
  else if (cd){ H = cd; stops.push({ v: cd, p: 80 }, { v: cd * 1.5, p: 100 }); }
  else stops.push({ v: T * 2, p: 100 });
  const pos = v => { if (v >= stops[stops.length - 1].v) return 100; for (let i = 1; i < stops.length; i++) if (v <= stops[i].v) { const a = stops[i - 1], b = stops[i]; return a.p + (v - a.v) / (b.v - a.v) * (b.p - a.p); } return 100; };
  const zones = [`<span class="z low" style="left:0;width:46%"></span>`,
    `<span class="z ok" style="left:46%;width:${(H != null ? pos(H) : 100) - 46}%"></span>`];
  if (ulTotal) zones.push(`<span class="z hi" style="left:76%;width:14%"></span><span class="z over" style="left:90%;width:10%"></span>`);
  else if (cd) zones.push(`<span class="z hi" style="left:80%;width:20%"></span>`);
  const ticks = [`<span class="tk" style="left:46%"><i></i><b>${N.fmt(T)}</b><em>target</em></span>`];
  if (ulTotal){ ticks.push(`<span class="tk" style="left:76%"><i></i><b>${N.fmt(H)}</b><em>high</em></span>`, `<span class="tk" style="left:90%"><i></i><b>${N.fmt(U)}</b><em>UL</em></span>`); }
  else if (cd) ticks.push(`<span class="tk" style="left:80%"><i></i><b>${N.fmt(cd)}</b><em>limit</em></span>`);
  const vp = pos(as.value), beyond = as.value > stops[stops.length - 1].v;
  const supp = r.ul != null && r.ulBasis !== 'total'
    ? `<span class="gnote">Upper limit ${N.fmt(r.ul)} ${r.unit} applies to ${r.ulBasis === 'supplemental' ? 'supplements' : r.ulBasis === 'preformed' ? 'preformed vitamin A (retinol)' : 'folic acid'} only: ${N.fmt(as.ulValue)} ${r.unit} (${Math.round(as.ulValue / r.ul * 100)}%).</span>` : '';
  return `<span class="gauge"><span class="track">${zones.join('')}<span class="mk ${as.status} ${vp < 8 ? 'el' : vp > 92 ? 'er' : ''}" style="left:${vp}%"><span>${as.partial ? '≥' : ''}${N.fmt(as.value)}${beyond ? '›' : ''}</span></span></span><span class="ticks">${ticks.join('')}</span></span>${supp}`;
}

// ---------- MICROS ----------
function viewMicros(){
  const date = S.microsDate, src = S.microsSource, today = todayISO(), pv = planFor(date);
  const doses = S.profile.suppDoses || {};
  let items = [], supps = [], note = '';
  if (src === 'plan'){
    items = PL.itemsOf(plannedDay(date).day);
    supps = PL.SUPPLEMENTS.map(s => ({ name: s.name, nutrients: s.nutrients(doses[s.key] ?? s.dose) }));
    note = `Plan v${pv.version} for ${PL.DAY_LABEL[PL.dayType(date)].toLowerCase()}, plus every scheduled supplement.`;
  } else {
    const a = dayActual(date), l = S.logs[date];
    items = a ? a.items : [];
    supps = PL.SUPPLEMENTS.filter(s => l && l.supps[s.key]).map(s => ({ name: s.name, nutrients: s.nutrients(doses[s.key] ?? s.dose) }));
    note = a ? `What you logged (${a.mealsLogged} of 5 meals) plus supplements marked as taken.` : 'Nothing logged for this day yet.';
  }
  const tot = N.totals(items, supps), wt = E.trend(S.measurements, 'weightKg', today);
  const ctx = { weightKg: wt.ok ? wt.value : (pv && pv.weightKg) || null, targets: targetsOf(pv) };
  const groups = ['Vitamins', 'Minerals', 'Fatty acids', 'Amino acids', 'Other'];
  const head = `<header class="page"><span class="eyebrow">${dayLabel(date)}</span><h1 class="display">Micros</h1></header>`;
  const ctrl = `<section class="card"><div class="spread"><span class="eyebrow">Nutrition source</span>
      <div class="seg"><button data-act="msrc" data-v="plan" aria-pressed="${src === 'plan'}">Plan</button><button data-act="msrc" data-v="actual" aria-pressed="${src === 'actual'}">Actual</button></div></div>
      <div class="row"><button class="btn ghost sm" data-act="mshift" data-d="-1">←</button><span class="num">${dayLabel(date)}</span><button class="btn ghost sm" data-act="mshift" data-d="1" ${date >= today ? 'disabled' : ''}>→</button></div>
      <p class="why">${esc(note)} Bars stop at the target: going past it isn’t rewarded. Values come from USDA FoodData Central.</p></section>`;
  const sec = groups.map(g => {
    const rows = N.REF.filter(r => r.group === g).map(r => {
      const as = N.assess(r, tot[r.key], ctx), open = S.openNutrient === r.key;

      const val = as.status === 'unavailable' ? 'Data unavailable' : `${as.partial ? '≥ ' : ''}${N.fmt(as.value)}${as.target != null ? ' / ' + N.fmt(as.target) : ''} ${r.unit}`;
      return `<button class="nrow ${as.status}" data-act="nopen" data-k="${r.key}" aria-expanded="${open}">
          <span class="nl">${esc(r.label)}<span class="nv num">${val}</span></span><span class="chip ${as.status}">${esc(as.label)}${as.partial ? ' · incomplete' : ''}</span>${gauge(r, as)}
          ${open ? `<span class="nwhy">${esc(as.reason || '')} ${r.ul != null && r.ulNote ? esc(r.ulNote) : ''} ${r.note ? esc(r.note) : ''}${r.perKg ? ` Target ${r.perKg} mg per kg of body weight.` : ''}</span>` : ''}</button>`;
    }).join('');
    return `<section class="card"><h3 class="display" style="font-size:24px">${g}</h3><div class="nlist">${rows}</div></section>`;
  }).join('');
  return head + ctrl + `<div class="grid two"><div class="stack">${sec.split('</section>').slice(0, 2).join('</section>')}</section></div><div class="stack">${sec.split('</section>').slice(2, 5).join('</section>')}</section></div></div>`;
}

// ---------- COOK ----------
// How to make each of the day's meals, with every amount worked out from the current plan (cooked weights → raw).
function viewCook(){
  const today = todayISO(), date = S.cookDate || today, days = S.cookDays || 1, pd = plannedDay(date);
  const dayType = PL.dayType(date);
  const scaled = (pd ? pd.day : []).map(m => ({ ...m, items: m.items.map(it => ({ ...it, grams: it.grams * (['lunch', 'dinner'].includes(m.key) ? days : 1) })) }));
  const G = Cook.guide(scaled, dayType);
  const pick = (v, label, cur, act) => `<button class="btn ${cur ? '' : 'ghost'}" data-act="${act}" data-v="${v}" style="padding:6px 12px">${label}</button>`;
  const head = `<header class="page"><span class="eyebrow">${dayLabel(date)} · ${esc(PL.DAY_LABEL[dayType] || dayType)}</span><h1 class="display">Cook</h1></header>
    <p class="why" style="margin:-6px 0 12px">Every amount comes from your current plan. Meat, fish, rice and sweet potato are counted cooked, so this tells you what to take raw and what to weigh on the plate. When your plan's grams change, these change with them.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${pick(today, 'Today', date === today, 'cook-date')}${pick(E.addDays(today, 1), 'Tomorrow', date === E.addDays(today, 1), 'cook-date')}
      <span style="width:12px"></span>${[1, 2, 3].map(n => pick(n, n === 1 ? 'Lunch & dinner for 1 day' : `for ${n} days`, days === n, 'cook-days')).join('')}</div>`;
  const cards = G.map(m => `<section class="card cook" data-meal="${m.key}">
    <div class="spread"><h3 class="display" style="font-size:24px">${esc(m.name)}</h3><span class="eyebrow">about ${m.minutes} min${days > 1 && ['lunch', 'dinner'].includes(m.key) ? ` · ${days} portions` : ''}</span></div>
    <div class="ck-ing">${m.ingredients.map(i => `<div class="gitem" style="cursor:default;grid-template-columns:minmax(0,1fr) auto"><span class="gname">${esc(i.name)}<span class="gsub" style="display:block">${esc(i.prep)}</span></span><span class="gqty num">${esc(i.serve)}</span></div>`).join('')}</div>
    <ol class="ck-steps">${m.steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol>
    ${m.safety ? `<p class="why"><b>Safe:</b> ${esc(m.safety)}</p>` : ''}
    ${days > 1 && ['lunch', 'dinner'].includes(m.key) ? `<p class="why">Split into ${days} equal portions after cooking — weigh each one.</p>` : m.batch ? `<p class="why">${esc(m.batch)}</p>` : ''}
    ${m.maidText ? `<button class="btn ghost" data-act="cook-copy" data-meal="${m.key}" style="align-self:flex-start">Copy for the maid</button>` : ''}</section>`).join('');
  return head + `<div class="grid two"><div class="stack">${cards}</div></div>`;
}

// ---------- GROCERY ----------
function viewGrocery(){
  const start = todayISO(), dates = Array.from({ length: 7 }, (_, i) => E.addDays(start, i));
  const days = dates.map(d => plannedDay(d).day), groups = PL.grocery(days);
  const doses = S.profile.suppDoses || {}, week = start, checks = (S.grocery[week] && S.grocery[week].checked) || {};
  const head = `<header class="page"><span class="eyebrow">${dayLabel(dates[0])} – ${dayLabel(dates[6])}</span><h1 class="display">Grocery</h1></header>`;
  const fmtW = g => g >= 1000 ? (g / 1000).toFixed(2).replace(/0$/, '') + ' kg' : Math.round(g) + ' g';
  const row = (key, name, qty, sub) => `<label class="gitem ${checks[key] ? 'on' : ''}"><input type="checkbox" data-gk="${key}" ${checks[key] ? 'checked' : ''}><span class="gname">${name}</span><span class="gqty num">${qty}</span>${sub ? `<span class="gsub">${sub}</span>` : ''}</label>`;
  const cards = groups.map(c => `<section class="card"><h3 class="display" style="font-size:22px">${c.category}</h3>${c.items.map(it =>
    row(it.food, esc(it.name), it.ml ? `${(it.ml / 1000).toFixed(2).replace(/0$/, '')} L` : fmtW(it.grams),
      `${STATE[it.state]} weight${it.raw ? ` · buy about ${fmtW(it.raw.grams)} ${it.raw.label} (approximate)` : ''}`)).join('')}</section>`).join('');
  const supp = `<section class="card"><h3 class="display" style="font-size:22px">Supplements</h3>${PL.SUPPLEMENTS.map(s =>
    row('supp-' + s.key, esc(s.name), `7 × ${doses[s.key] ?? s.dose} ${esc(s.unit)}`, 'one serving a day')).join('')}</section>`;
  return head + `<p class="why" style="margin:-6px 0 14px">From your plan for the next 7 days (${dates.map(d => PL.dayType(d) === 'salmon' ? 'S' : 'B').join('')}: S salmon, B beef). Weights are as eaten; raw amounts are estimates.</p>
    <div class="grid two"><div class="stack">${cards}</div><div class="stack">${supp}<button class="btn ghost" data-act="g-clear">Clear checkmarks</button></div></div>`;
}
async function toggleGrocery(key, on){
  const week = todayISO(), g = S.grocery[week] || (S.grocery[week] = { week, checked: {} });
  g.checked[key] = on; const body = { week, checked: g.checked };
  const rec = await Store.put('grocery_check', body, g.id || 'grocery_check:' + week); g.id = rec.id; render();
}

// ---------- events ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'cook-date'){ S.cookDate = b.dataset.v; render(); return; }
  if (a === 'cook-days'){ S.cookDays = +b.dataset.v; render(); return; }
  if (a === 'cook-copy'){
    const date = S.cookDate || todayISO(), days = S.cookDays || 1, pd = plannedDay(date);
    const day = (pd ? pd.day : []).map(m => ({ ...m, items: m.items.map(it => ({ ...it, grams: it.grams * (['lunch', 'dinner'].includes(m.key) ? days : 1) })) }));
    const m = Cook.guide(day).find(x => x.key === b.dataset.meal), txt = m.maidText + (days > 1 && ['lunch', 'dinner'].includes(m.key) ? ` That's ${days} portions — split equally.` : '');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = txt; });
    return;
  }
  if (a === 'tab'){ if (S.tab !== b.dataset.v) S.enter = true; S.tab = b.dataset.v; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (a === 'save') saveCheckin();
  else if (a === 'mode'){ S.chartMode = b.dataset.v; S.readout = ''; render(); }
  else if (a === 'edit'){ const x = S.measurements.find(m => m.id === b.dataset.id); S.editId = x.id; S.edit = { date: x.date, w: x.weightKg ?? '', bf: x.bodyFatPct ?? '' }; render(); }
  else if (a === 'edit-cancel'){ S.editId = null; render(); }
  else if (a === 'edit-save') saveEdit(b.dataset.id);
  else if (a === 'del') removeMeasurement(b.dataset.id);
  else if (a === 'all'){ S.showAll = !S.showAll; render(); }
  else if (a === 'dismiss'){ S.notice = null; render(); }
  else if (a === 'phase-confirm') confirmPhase();
  else if (a === 'phase-snooze'){ S.profile.pendingSnooze = S.measurements.length; saveProfile(); render(); }
  else if (a === 'demo') loadDemo();
  else if (['ate','meal-edit','meal-else','meal-undo','item-remove','item-add','item-add-save','add-mode','supp'].includes(a)) logAction(a, b);
  else if (a === 'log-shift'){ const d = E.addDays(S.logDate, +b.dataset.d); if (d <= todayISO()){ S.logDate = d; S.mealEdit = null; S.addFor = null; render(); } }
  else if (a === 'log-day'){ S.logDate = b.dataset.d; S.mealEdit = null; S.addFor = null; S.tab = 'log'; S.enter = true; render(); window.scrollTo(0, 0); }
  else if (a === 'cal-shift'){ const [y, mo] = (S.calMonth || todayISO().slice(0, 7)).split('-').map(Number), d = new Date(Date.UTC(y, mo - 1 + (+b.dataset.d), 1)); S.calMonth = d.toISOString().slice(0, 7); render(); }
  else if (a === 'mday'){ S.macroDay = b.dataset.v; render(); }
  else if (a === 'msrc'){ S.microsSource = b.dataset.v; render(); }
  else if (a === 'mshift'){ const d = E.addDays(S.microsDate, +b.dataset.d); if (d <= todayISO()){ S.microsDate = d; render(); } }
  else if (a === 'nopen'){ S.openNutrient = S.openNutrient === b.dataset.k ? null : b.dataset.k; render(); }
  else if (a === 'g-clear'){ const g = S.grocery[todayISO()]; if (g){ g.checked = {}; Store.put('grocery_check', { week: g.week, checked: {} }, g.id).then(render); } }
  else if (a === 'demo-clear') clearDemo();
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'f-date'){ S.form.date = e.target.value; render(); document.getElementById('f-date')?.focus(); }
  else if (id === 'f-w') S.form.w = e.target.value;
  else if (id === 'f-bf') S.form.bf = e.target.value;
  else if (id === 'e-date') S.edit.date = e.target.value;
  else if (id === 'e-w') S.edit.w = e.target.value;
  else if (id === 'e-bf') S.edit.bf = e.target.value;
  else if (id === 'add-grams') S.custom.grams = e.target.value;
  else if (id && id.startsWith('add-')) S.custom[id.slice(4)] = e.target.value;
});
document.addEventListener('change', async e => {
  const t = e.target, id = t.id || '';
  if (id === 'add-food'){ S.custom.food = t.value; return; }
  if (t.dataset && t.dataset.gk){ toggleGrocery(t.dataset.gk, t.checked); return; }
  if (id.startsWith('g-')){                       // grams edit in a logged meal
    const l = logFor(S.logDate, true), it = l.meals[t.dataset.meal].actual[+t.dataset.i], g = num(t.value);
    if (g != null && g >= 0){ it.grams = Math.round(g); await saveLog(S.logDate); render(); }
    return;
  }
  if (id === 'caf-other'){ const l = logFor(S.logDate, true), v = num(t.value); l.otherCaffeine = v != null && v >= 0 ? Math.round(v) : 0; await saveLog(S.logDate); render(); return; }
  if (id.startsWith('dose-')){
    const v = num(t.value); if (v == null || v < 0) return;
    S.profile.suppDoses = { ...(S.profile.suppDoses || {}), [t.dataset.k]: v }; await saveProfile(); render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'f-w' || e.target.id === 'f-bf')) saveCheckin(); });
// Chart readout: nearest day under the pointer.
function chartPoint(e){
  const svg = e.target.closest && e.target.closest('svg[data-chart]'); if (!svg) return;
  const d = JSON.parse(svg.dataset.chart), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const sx = (e.clientX - r.left) / r.width * vb.width, day = Math.round((sx - d.L) / (d.W - d.L - d.R) * d.span);
  if (day < 0 || day > d.span) return;
  const date = E.addDays(d.xMin, day), pick = arr => { const p = arr.find(q => q[0] === date); return p ? fmt(p[1]) + d.unit : null; };
  const parts = [dayLabel(date)], rv = pick(d.raw), av = pick(d.avg), tv = pick(d.traj);
  if (rv) parts.push('daily ' + rv); if (av) parts.push('7-day ' + av); if (tv) parts.push((d.tl || 'target') + ' ' + tv);
  S.readout = parts.join(' · '); const el = document.getElementById('readout'); if (el) el.textContent = S.readout;
  const c = svg.querySelector('.cross'), x = d.L + day / d.span * (d.W - d.L - d.R); c.setAttribute('x1', x); c.setAttribute('x2', x); c.setAttribute('visibility', 'visible');
}
document.addEventListener('pointermove', chartPoint);
document.addEventListener('pointerdown', chartPoint);

window.NC = { reload: () => load(), S, render, statusFor, dayActual, planFor, plannedDay, targetsOf, logFor, logAction, todayISO, dayLabel, esc, fmt, E, PL, P };
const boot = () => load().catch(err => { $app.innerHTML = `<p class="err">Couldn't open storage on this device: ${esc(err && err.message || err)}</p>`; });
// The sync layer (sync.js) starts the app once this device's copy is up to date; without it, start now.
if (window.NCSync) window.NCSync.ready(boot); else boot();
})();
