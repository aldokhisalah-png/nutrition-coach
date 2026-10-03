// =====================================================================
// EXTRAS — the game layer UI: home hero (rings, streak, XP), milestones, rail card,
// swipe-to-log meal deck, and celebrations after each action.
// Reads app state through window.NC; all writes still go through the app's own actions.
// =====================================================================
(function(root){
'use strict';
const X = {};
const NC = () => root.NC;
const pct = (v, t) => t ? Math.max(0, Math.min(100, v / t * 100)) : 0;
const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.9 3.6 4.8 5.6 4.8 10.6a4.8 4.8 0 0 1-9.6 0c0-2.6 1.4-4 2.2-6.2 1.2 1 2 2.4 2.3 3.9.6-2.6.9-5.2.3-8.3z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ADJ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
X.FLAME = FLAME;
const ST_LABEL = { green: 'Locked in', yellow: 'Close', red: 'Off target', progress: 'In progress', grey: 'Not started', frozen: 'Frozen' };
const wd = iso => 'SMTWTFS'[new Date(iso + 'T00:00:00Z').getUTCDay()];
X.greet = () => { const h = new Date().getHours(); return h < 5 ? 'Late night.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.'; };

function coachLine(g){
  const left = 5 - g.today.meals, h = new Date().getHours(), s = g.today.status;
  if (s === 'green') return ['Today is locked in. That’s how it’s done.', ''];
  if (s === 'yellow') return ['Day counted, but not perfect. Tighten it up tomorrow.', ''];
  if (s === 'red') return ['Off target today. Own it, reset, go again tomorrow.', 'risk'];
  if (h >= 17 && left > 0 && g.streak > 0) return [`Your ${g.streak}-day streak is on the line. ${left} meal${left > 1 ? 's' : ''} to go.`, 'risk'];
  if (g.streak === 0) return ['Day one starts with your next meal. Log it.', ''];
  return [`${left} meal${left === 1 ? '' : 's'} left to make it ${g.streak + 1} days.`, ''];
}
X.coachLine = coachLine;

X.rings = (vals, prefix = '') => `<svg class="rings" viewBox="0 0 120 120" aria-hidden="true">${[['k', 52], ['p', 39], ['m', 26]].map(([k, r]) =>
  `<circle class="trk" cx="60" cy="60" r="${r}" stroke-width="10"></circle><circle class="prg ${k}" cx="60" cy="60" r="${r}" stroke-width="10" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${FX.ringStart(prefix + k)}" data-ring="${prefix + k}" data-v="${vals[k].toFixed(1)}" style="opacity:${vals[k] > 0 ? 1 : 0}"></circle>`).join('')}</svg>`;

function todayNumbers(){
  const c = NC(), g = c.S.g, t = c.targetsOf(c.planFor(c.todayISO())), m = g.today.macros || { kcal: 0, protein: 0 };
  return { t, m, g, vals: { k: pct(m.kcal, t.calories), p: pct(m.protein, t.protein), m: g.today.meals / 5 * 100 } };
}

X.xpRow = g => { const L = g.level, inLv = g.phaseXp - L.base, need = L.next - L.base;
  return `<div class="xp"><div class="lv"><span><small>LV</small>${L.n}</span></div>
    <div class="spread"><span class="ttl">${L.name}</span><span class="num muted" style="font-size:12px">${inLv} / ${need} XP</span></div>
    <div class="bar"><span style="width:${pct(inLv, need)}%"></span></div></div>`; };

// ---------- Progress home hero ----------
X.hero = () => {
  const c = NC(), S = c.S, today = c.todayISO(), { t, m, g, vals } = todayNumbers();
  const left = Math.round(t.calories - m.kcal), [line, cls] = coachLine(g), st = g.today.status;
  const sub = st === 'green' ? 'Day locked in.' : g.streak ? `Keep the chain.` : 'Start the chain.';
  const rl = (k, label, v, tv, u) => `<div class="rl ${k}"><i></i><span class="l">${label}</span><span class="v">${Math.round(v).toLocaleString()}<small> / ${tv.toLocaleString()}${u}</small></span><div class="bar"><span style="width:${pct(v, tv)}%"></span></div></div>`;
  return `<header class="hero">
    <div class="hero-top">
      <div class="stack" style="gap:10px"><span class="eyebrow">${c.dayLabel(today)} · ${c.E.PHASE_LABEL[S.profile.phase]}</span>
        <h1 class="display hero-h">${X.greet()}<br><span class="acc">${sub}</span></h1></div>
      <div class="hero-chips">
        <button class="pill" data-act="x-mission">Today’s mission</button>
        <button class="story-btn ${X.storySeen() ? 'seen' : ''}" data-act="x-story" aria-label="Weekly recap"><span class="story-ring"><span>WK</span></span>Recap</button>
      </div>
    </div>
    <div class="hero-grid">
      <section class="card">
        <div class="spread"><span class="eyebrow">Today</span><span class="chip ${st}">${ST_LABEL[st] || st}</span></div>
        <div class="today-grid">
          <div class="rings-wrap">${X.rings(vals)}<div class="rings-c"><b class="num" data-count="kleft" data-to="${Math.abs(left)}">${FX.countStart('kleft')}</b><span>kcal ${left >= 0 ? 'left' : 'over'}</span></div></div>
          <div class="ring-legend">${rl('k', 'Calories', m.kcal, t.calories, '')}${rl('p', 'Protein', m.protein, t.protein, ' g')}${rl('m', 'Meals', g.today.meals, 5, '')}</div>
        </div>
        ${X.xpRow(g)}
      </section>
      <section class="card streak-card ${g.streak ? '' : 'cold'}">
        <div class="spread"><span class="eyebrow">Streak</span><span class="eyebrow">Best ${g.best}</span></div>
        <div class="streak-big">${FLAME}<b class="num" data-count="streak" data-to="${g.streak}">${FX.countStart('streak')}</b><small>day${g.streak === 1 ? '' : 's'}</small></div>
        <div class="wk">${g.week.map(w => `<span class="${w.status} ${w.date === today ? 'today' : ''}" title="${c.dayLabel(w.date)}: ${ST_LABEL[w.status] || ''}"><i>${w.status === 'green' || w.status === 'yellow' ? '✓' : ''}</i>${wd(w.date)}</span>`).join('')}</div>
        <div class="freezes"><span class="frz ${g.freezes > 0 ? 'on' : ''}"></span><span class="frz ${g.freezes > 1 ? 'on' : ''}"></span><span>${g.freezes} streak freeze${g.freezes === 1 ? '' : 's'} banked · earn one every 7 days</span></div>
        <p class="coach ${cls}">${line}</p>
      </section>
    </div>
  </header>`;
};

X.badges = () => {
  const g = NC().S.g, done = g.badges.filter(b => b.done).length;
  return `<section class="card"><div class="spread"><h3 class="display">Milestones</h3><span class="eyebrow">${done} / ${g.badges.length}</span></div>
    <div class="badges">${g.badges.map((b, i) => `<div class="bdg ${b.done ? 'done' : ''}" style="animation-delay:${i * 35}ms"><span class="bdg-m" style="--p:${b.done ? 100 : b.v / b.goal * 100}"><b>${b.glyph}</b></span><span class="bdg-n">${b.name}</span><span class="bdg-d">${b.done ? b.desc : b.goal > 1 ? `${b.v} / ${b.goal}` : b.desc}</span></div>`).join('')}</div></section>`;
};

X.railCard = g => g ? `<div class="rail-card">
    <div class="row"><span class="pill flame ${g.streak ? '' : 'cold'}">${FLAME}<span class="num">${g.streak}</span></span><span class="eyebrow">Lv ${g.level.n} · ${g.level.name}</span></div>
    <div class="bar"><span style="width:${pct(g.phaseXp - g.level.base, g.level.next - g.level.base)}%"></span></div>
    <button class="btn ghost sm" data-act="x-mission">Today’s mission</button></div>` : '';

// ---------- Log: swipe deck ----------
X.deck = (date, meals) => {
  const c = NC(), pending = meals.filter(([, m]) => !m.actual), total = meals.length, logged = total - pending.length;
  const st = c.statusFor(date);
  const card = ([mk, m], k) => {
    const mac = c.PL.macrosOf(m.planned.map(it => ({ grams: it.grams, per100g: c.PL.FOOD[it.food].per100g })));
    const idx = meals.findIndex(x => x[0] === mk) + 1;
    return `<div class="scard ${k === 0 ? 'top' : ''}" style="--k:${k}" data-meal="${mk}" ${k ? 'aria-hidden="true"' : ''}>
      <span class="stamp yes">Ate it</span><span class="stamp no">Adjust</span>
      <div class="spread"><span class="eyebrow">Meal ${idx} of ${total}</span><span class="num muted" style="font-size:12.5px">${Math.round(mac.kcal)} kcal · P ${Math.round(mac.protein)}</span></div>
      <span class="sk">${c.esc(m.name)}</span>
      <div class="items">${m.planned.map(it => `<div class="irow" style="grid-template-columns:minmax(0,1fr) auto"><span class="iname">${c.esc(c.PL.FOOD[it.food].name)}</span><span class="ig num">${it.grams} g</span></div>`).join('')}</div></div>`;
  };
  const top = pending[0];
  return `<section class="card swipe">
    <div class="spread"><h3 class="display">${pending.length ? 'Next up' : 'Done'}</h3><span class="eyebrow">${logged} of ${total} logged</span></div>
    <div class="deck" style="${pending.length ? '' : 'height:170px'}">${pending.length ? pending.slice(0, 3).map(card).reverse().join('')
      : `<div class="deck-done"><b>All meals logged</b><span class="why" style="max-width:30ch">${c.esc(st.reason)}</span></div>`}</div>
    ${top ? `<div class="sacts"><button class="sbtn" data-act="x-adjust" data-meal="${top[0]}">${ADJ}Adjust</button><button class="sbtn yes" data-act="x-ate" data-meal="${top[0]}">${CHECK}Ate it</button></div>
      <p class="hint">Swipe right when eaten · left to adjust grams</p>` : ''}
  </section>`;
};

function commit(card, dir){
  if (!card || card.dataset.busy) return; card.dataset.busy = '1';
  const mk = card.dataset.meal, r = card.getBoundingClientRect();
  card.classList.remove('drag'); card.style.transform = ''; card.classList.add(dir === 'ate' ? 'out-r' : 'out-l');
  FX.haptic(dir === 'ate' ? [12, 30, 18] : 10);
  const el = { dataset: { meal: mk }, getBoundingClientRect: () => r };
  setTimeout(async () => {
    if (dir === 'ate') await NC().logAction('ate', el);
    else { await NC().logAction('meal-edit', el); const m = document.getElementById('meal-' + mk); if (m) window.scrollTo({ top: m.getBoundingClientRect().top + scrollY - 20, behavior: 'smooth' }); }
  }, 280);
}
let drag = null;
document.addEventListener('pointerdown', e => {
  const card = e.target.closest('.scard.top'); if (!card || e.button > 0) return;
  drag = { card, x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.on){ if (Math.abs(dx) < 8) return; if (Math.abs(dy) > Math.abs(dx)){ drag = null; return; } drag.on = true; drag.card.classList.add('drag'); try { drag.card.setPointerCapture(e.pointerId); } catch(_){} }
  drag.dx = dx;
  drag.card.style.transform = `translateX(${dx}px) rotate(${dx / 16}deg)`;
  drag.card.querySelector('.stamp.yes').style.opacity = Math.max(0, Math.min(1, dx / 90));
  drag.card.querySelector('.stamp.no').style.opacity = Math.max(0, Math.min(1, -dx / 90));
});
const endDrag = () => {
  if (!drag) return; const { card, dx, on } = drag; drag = null; if (!on) return;
  if (dx > 90) commit(card, 'ate');
  else if (dx < -90) commit(card, 'adjust');
  else { card.classList.remove('drag'); card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => s.style.opacity = 0); }
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act^="x-"]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'x-ate' || a === 'x-adjust') commit(document.querySelector('.scard.top'), a === 'x-ate' ? 'ate' : 'adjust');
  else if (a === 'x-mission') X.mission();
  else if (a === 'x-story') X.story();
});

// ---------- celebrations ----------
X.snapshot = el => { const g = root.Game ? root.Game.compute() : null; if (!g) return null;
  const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null; g._pt = r && r.width ? [r.left + r.width / 2, r.top + 8] : [innerWidth / 2, innerHeight / 2]; return g; };
X.after = (before, act) => {
  if (!before) return;
  const a = root.Game.compute(), gain = a.xp - before.xp, [x, y] = before._pt;
  if (gain > 0){ FX.floatXP(x, y, `+${gain} XP`); if (act === 'ate' || act === 'checkin') FX.confetti(x, y, 26); }
  let delay = 0;
  const later = f => { setTimeout(f, delay); delay += 700; };
  if (a.today.status === 'green' && before.today.status !== 'green') later(() => { FX.confetti(innerWidth / 2, innerHeight * .35, 160); FX.haptic([20, 40, 20, 40, 30]);
    FX.toast({ icon: FLAME, title: 'Day locked in', text: `${a.streak}-day streak · +${root.Game.XP.green} XP`, kind: 'flame' }); });
  else if (a.today.status === 'yellow' && before.today.status !== 'yellow') later(() => FX.toast({ icon: '✓', title: 'Day counted', text: `Streak alive at ${a.streak}. Green is ±5% kcal and 95% protein.` }));
  else if (a.today.status === 'red' && before.today.status !== 'red') later(() => FX.toast({ icon: '!', title: 'Off target today', text: a.freezes < before.freezes ? 'A streak freeze will cover it.' : 'Reset and go again tomorrow.', kind: 'gold' }));
  if (a.level.n > before.level.n) later(() => { FX.confetti(innerWidth / 2, innerHeight * .3, 120); FX.toast({ icon: 'L' + a.level.n, title: `Level ${a.level.n}: ${a.level.name}`, text: 'Discipline compounds.', kind: 'gold' }); });
  a.badges.forEach((b, i) => { if (b.done && !before.badges[i].done) later(() => FX.toast({ icon: b.glyph, title: 'Milestone unlocked', text: b.name + ' — ' + b.desc, kind: 'gold' })); });
};

let first = true;
X.onRender = () => {
  if (!first) return; first = false;
  const today = NC().todayISO();
  try { if (localStorage.getItem('nc-mission-seen') !== today){ localStorage.setItem('nc-mission-seen', today); setTimeout(() => X.mission(), 450); } } catch(_){}
};

root.X = X;
})(window);
