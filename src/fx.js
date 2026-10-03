// =====================================================================
// FX — haptics, ripples, toasts, XP floaters, confetti, animated rings and count-ups.
// Pure presentation; never touches app state.
// =====================================================================
(function(root){
'use strict';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const prev = {};                       // last shown value per ring / counter key, so updates animate from where they were
const FX = { prev };

FX.haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch(e){} };

// Every tap: a short vibration (on phones that support it) and a soft ripple from the touch point.
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('button, .gitem, [data-act]'); if (!b || b.disabled) return;
  FX.haptic(b.classList.contains('btn') || b.classList.contains('sbtn') ? 12 : 6);
  if (reduce() || b.classList.contains('nrow') || b.classList.contains('st-tap')) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden';
  const d = document.createElement('span'); d.className = 'rip';
  d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(d); setTimeout(() => d.remove(), 600);
}, { passive: true });

let toastBox = null;
FX.toast = ({ icon = '✓', title, text = '', kind = '' }, ms = 3200) => {
  if (!toastBox){ toastBox = document.createElement('div'); toastBox.className = 'toasts'; document.body.appendChild(toastBox); }
  const t = document.createElement('div'); t.className = 'toast ' + kind;
  t.innerHTML = `<span class="ti">${icon}</span><div><b>${title}</b>${text ? `<span>${text}</span>` : ''}</div>`;
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 450); }, ms);
};

FX.floatXP = (x, y, text) => {
  const f = document.createElement('div'); f.className = 'xpf'; f.textContent = text;
  f.style.left = x + 'px'; f.style.top = y + 'px'; document.body.appendChild(f); setTimeout(() => f.remove(), 1300);
};

FX.confetti = (x = innerWidth / 2, y = innerHeight / 3, n = 70) => {
  if (reduce()) return;
  const colors = ['#8fd6a8', '#c3f2d2', '#8fc9ef', '#f0b35e', '#ff9b52', '#f1f3ef'];
  for (let i = 0; i < n; i++){
    const p = document.createElement('i'); p.className = 'cf';
    p.style.background = colors[i % colors.length]; p.style.left = x + 'px'; p.style.top = y + 'px';
    if (i % 3 === 0){ p.style.width = '7px'; p.style.height = '7px'; p.style.borderRadius = '50%'; }
    document.body.appendChild(p);
    const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * 260, dx = Math.cos(a) * v, dy = Math.sin(a) * v - 180;
    p.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 420}px)) rotate(${Math.random() * 900}deg)`, opacity: 0 }
    ], { duration: 1400 + Math.random() * 900, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => p.remove();
  }
};

// Called after every render: rings sweep and numbers count from their previous value.
FX.after = rootEl => {
  const rings = rootEl.querySelectorAll('[data-ring]'), counts = rootEl.querySelectorAll('[data-count]');
  rings.length && rootEl.getBoundingClientRect();
  requestAnimationFrame(() => {
    rings.forEach(c => { const v = +c.dataset.v; c.style.strokeDashoffset = 100 - v; prev[c.dataset.ring] = v; });
  });
  counts.forEach(el => {
    const key = el.dataset.count, to = +el.dataset.to, from = prev[key] ?? 0; prev[key] = to;
    if (from === to || reduce()){ el.textContent = Math.round(to).toLocaleString(); return; }
    const t0 = performance.now(), dur = 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
};
FX.ringStart = key => 100 - (prev[key] ?? 0);
FX.countStart = key => Math.round(prev[key] ?? 0).toLocaleString();

root.FX = FX;
})(window);
