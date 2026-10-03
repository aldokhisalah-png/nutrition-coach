// =====================================================================
// SYNC — this device's IndexedDB is the main copy; Supabase is the cloud copy.
// Every record is one cloud row. The newest updatedAt wins; deletes travel as markers.
// Works with no connection: changes wait on this device and go up when you're back online.
// Also: account sheet (sign in / out), backup download and restore.
// =====================================================================
(function (root) {
'use strict';
const Store = root.Store;
const CFG = root.NC_CONFIG || {};
const TABLE = 'nutrition_records';
const cloudOn = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && root.supabase && root.supabase.createClient);
const sb = cloudOn ? root.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nc-auth' } }) : null;

const ls = { get(k){ try { return localStorage.getItem(k); } catch(_){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(_){} }, del(k){ try { localStorage.removeItem(k); } catch(_){} } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const st = { user: null, busy: false, again: false, error: '', lastSync: null, booted: false, pending: 0 };
const k = name => `nc-${name}-${st.user ? st.user.id : 'none'}`;

// ---------- cloud rows <-> local records ----------
const toRow = r => ({ id: r.id, kind: r.kind, body: r.body ?? null, created_at: r.createdAt || r.updatedAt || Date.now(), updated_at: r.updatedAt || Date.now(), deleted: !!r.deleted });
const toRec = w => { const r = { id: w.id, kind: w.kind, body: w.body, createdAt: +w.created_at, updatedAt: +w.updated_at }; if (w.deleted) r.deleted = true; return r; };

async function pull(since){
  const out = [], size = 500;
  for (let from = 0; ; from += size){
    let q = sb.from(TABLE).select('id,kind,body,created_at,updated_at,deleted,synced_at').order('synced_at', { ascending: true }).range(from, from + size - 1);
    if (since) q = q.gt('synced_at', since);
    const { data, error } = await q; if (error) throw error;
    out.push(...data); if (data.length < size) break;
  }
  return out;
}
async function push(rows){
  for (let i = 0; i < rows.length; i += 200){
    const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 200), { onConflict: 'user_id,id' });
    if (error) throw error;
  }
}

// One full round: bring down what changed in the cloud, then send up what changed here.
async function syncNow(){
  if (!sb || !st.user) return false;
  if (st.busy){ st.again = true; return false; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false){ st.error = ''; paint(); return false; }
  st.busy = true; st.error = ''; paint();
  let changedHere = false;
  try {
    const first = !ls.get(k('synced'));
    const cursor = first ? null : ls.get(k('cursor'));
    // Re-read a minute of overlap so rows saved at the same moment are never skipped.
    const since = cursor ? new Date(new Date(cursor).getTime() - 60000).toISOString() : null;
    const remote = await pull(since);
    const local = Object.fromEntries((await Store.raw()).map(r => [r.id, r]));
    let pushed = {}; try { pushed = JSON.parse(ls.get(k('pushed')) || '{}'); } catch(_){}
    let maxAt = cursor;
    for (const w of remote){
      if (!maxAt || w.synced_at > maxAt) maxAt = w.synced_at;
      const L = local[w.id], R = toRec(w);
      // First sync on this device: the cloud copy wins, so a fresh device can't overwrite real data.
      if (!L || first || R.updatedAt > L.updatedAt){
        if (!L || JSON.stringify(L) !== JSON.stringify(R)){ await Store.putRaw(R); changedHere = true; }
        local[w.id] = R;
      }
      pushed[w.id] = local[w.id].updatedAt === R.updatedAt ? R.updatedAt : pushed[w.id];
    }
    const out = Object.values(local).filter(r => pushed[r.id] !== r.updatedAt);
    if (out.length){ await push(out.map(toRow)); out.forEach(r => { pushed[r.id] = r.updatedAt; }); }
    ls.set(k('pushed'), JSON.stringify(pushed));
    if (maxAt) ls.set(k('cursor'), maxAt);
    ls.set(k('synced'), String(Date.now()));
    st.lastSync = Date.now(); st.pending = 0;
  } catch (e){
    st.error = friendly(e);
  } finally {
    st.busy = false; paint();
  }
  if (changedHere && st.booted && root.NC && root.NC.reload) await root.NC.reload();
  if (st.again){ st.again = false; return syncNow(); }
  return !st.error;
}
function friendly(e){
  const m = String(e && (e.message || e.error_description || e) || 'Unknown error');
  if (/relation .* does not exist|nutrition_records/i.test(m)) return 'The cloud table is missing — run the setup SQL in Supabase.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Your changes are saved on this device and will sync later.';
  if (/JWT|token|session/i.test(m)) return 'Your sign-in expired. Sign in again.';
  return m;
}

// Every local save schedules a quick sync.
let timer = null;
const schedule = () => { st.pending++; paint(); if (!st.user) return; clearTimeout(timer); timer = setTimeout(syncNow, 1500); };
const _put = Store.put.bind(Store), _remove = Store.remove.bind(Store);
Store.put = async (...a) => { const r = await _put(...a); schedule(); return r; };
Store.remove = async (...a) => { const r = await _remove(...a); schedule(); return r; };

// ---------- account ----------
async function signIn(email, password){
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  st.user = data.user; return syncNow();
}
async function signOut(){ await sb.auth.signOut(); st.user = null; st.lastSync = null; paint(); }

// ---------- backup ----------
async function backupText(){
  const records = await Store.raw();
  return JSON.stringify({ app: 'nutrition-coach', version: 1, exportedAt: new Date().toISOString(), records });
}
async function restore(text){
  let data; try { data = JSON.parse(text); } catch(_){ throw new Error("That isn't a Nutrition Coach backup (not valid JSON)."); }
  const recs = data && data.app === 'nutrition-coach' && Array.isArray(data.records) ? data.records : null;
  if (!recs) throw new Error("That isn't a Nutrition Coach backup.");
  const local = Object.fromEntries((await Store.raw()).map(r => [r.id, r]));
  let n = 0;
  for (const r of recs){
    if (!r || !r.id || !r.kind) continue;
    const L = local[r.id];
    if (!L || (r.updatedAt || 0) > (L.updatedAt || 0)){ await Store.putRaw(r); n++; }
  }
  if (root.NC && root.NC.reload) await root.NC.reload();
  if (st.user) await syncNow();
  return { total: recs.length, applied: n };
}
function download(name, text){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- UI: cloud button + account sheet ----------
const ui = { open: false, gate: false, msg: '', err: '', email: '', paste: false };
let chip, ov;
function statusText(){
  if (!cloudOn) return { cls: 'local', t: 'On this device' };
  if (!st.user) return { cls: 'off', t: 'Not signed in' };
  if (st.busy) return { cls: 'busy', t: 'Syncing…' };
  if (navigator.onLine === false) return { cls: 'wait', t: 'Offline — saved here' };
  if (st.error) return { cls: 'bad', t: 'Sync problem' };
  return { cls: 'ok', t: 'Synced' };
}
const ago = t => { if (!t) return 'not yet'; const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString(); };
function paint(){
  if (!chip) return;
  const s = statusText();
  chip.className = 'nc-cloud ' + s.cls; chip.setAttribute('aria-label', 'Your data: ' + s.t);
  chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg><i></i><span>${esc(s.t)}</span>`;
  if (ui.open) sheet();
}
function sheet(){
  const s = statusText(), signed = cloudOn && st.user;
  const login = cloudOn && !st.user ? `
    <form class="nc-form" data-f="login">
      <label class="field">Email<input name="email" type="email" autocomplete="username" required value="${esc(ui.email)}"></label>
      <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn big" type="submit">Sign in</button>
    </form>` : '';
  const acct = signed ? `
    <div class="nc-rows">
      <div><span>Account</span><b>${esc(st.user.email)}</b></div>
      <div><span>Status</span><b class="nc-s ${s.cls}">${esc(s.t)}</b></div>
      <div><span>Last synced</span><b>${esc(ago(st.lastSync))}</b></div>
    </div>
    <button class="btn" data-a="sync" ${st.busy ? 'disabled' : ''}>Sync now</button>` : '';
  const why = !cloudOn ? 'Everything is saved in this browser only. Download a backup to move it into the installed app.'
    : signed ? 'Everything is saved on this device first, then copied to your private cloud account so your phone and laptop match. Only you can read it.'
    : ui.gate ? 'Sign in so your phone and laptop share the same data. Your data stays on this device too, so the app works offline.'
    : 'Sign in to sync this device with your other devices. Until then everything stays on this device only.';
  ov.innerHTML = `<div class="sheet nc-sheet" role="dialog" aria-modal="true" aria-label="Your data">
    <div><p class="eyebrow">Nutrition Coach</p><h2 class="display" style="font-size:44px">Your data</h2></div>
    <p class="why">${why}</p>
    ${ui.err ? `<div class="notice warn">${esc(ui.err)}</div>` : st.error && signed ? `<div class="notice warn">${esc(st.error)}</div>` : ''}
    ${ui.msg ? `<div class="notice good">${esc(ui.msg)}</div>` : ''}
    ${login}${acct}
    <div class="nc-sec"><p class="eyebrow">Backup</p>
      <div class="nc-btns">
        <button class="btn ghost sm" data-a="dl">Download backup</button>
        <button class="btn ghost sm" data-a="copy">Copy backup</button>
        <button class="btn ghost sm" data-a="file">Restore from file</button>
        <button class="btn ghost sm" data-a="paste">Paste backup</button>
      </div>
      ${ui.show ? `<textarea class="nc-paste" readonly onfocus="this.select()">${esc(ui.show)}</textarea>` : ''}
      ${ui.paste ? `<textarea class="nc-paste" placeholder="Paste a backup here"></textarea><button class="btn sm" data-a="paste-go">Restore pasted backup</button>` : ''}
      <input type="file" accept="application/json,.json" hidden data-f="file">
    </div>
    ${signed ? '<button class="link" data-a="out">Sign out of this device</button>' : ''}
    ${ui.gate ? '<button class="link" data-a="local">Use on this device only for now</button>' : '<button class="btn ghost" data-a="close">Close</button>'}
  </div>`;
}
function openSheet(gate){ ui.open = true; ui.gate = !!gate; ui.msg = ''; ui.err = ''; ov.hidden = false; sheet(); }
function closeSheet(){ ui.open = false; ui.paste = false; ui.show = ''; ov.hidden = true; ov.innerHTML = ''; if (ui.gate){ ui.gate = false; startApp(); } }

async function act(a){
  ui.msg = ''; ui.err = '';
  try {
    if (a === 'close' || a === 'local') return closeSheet();
    if (a === 'sync'){ await syncNow(); ui.msg = st.error ? '' : 'Up to date.'; }
    else if (a === 'out'){ await signOut(); ui.msg = 'Signed out. Your data is still on this device.'; }
    else if (a === 'dl'){ download(`nutrition-coach-backup-${new Date().toISOString().slice(0, 10)}.json`, await backupText()); ui.msg = 'Backup downloaded.'; }
    else if (a === 'copy'){
      const t = await backupText();
      try { await navigator.clipboard.writeText(t); ui.msg = 'Backup copied. Paste it into the other app with "Paste backup".'; }
      catch(_){ ui.show = t; ui.msg = 'Copying is blocked here. Select all the text below and copy it yourself.'; }
    }
    else if (a === 'file'){ ov.querySelector('[data-f=file]').click(); return; }
    else if (a === 'paste'){ ui.paste = !ui.paste; }
    else if (a === 'paste-go'){ const r = await restore(ov.querySelector('.nc-paste').value); ui.paste = false; ui.msg = `Restored ${r.applied} of ${r.total} records (newer copies already here were kept).`; }
  } catch (e){ ui.err = e && e.message || String(e); }
  sheet();
}

function mountUI(){
  const css = document.createElement('style');
  css.textContent = `
  .nc-cloud{position:fixed;z-index:60;top:calc(env(safe-area-inset-top,0px) + 12px);right:12px;height:34px;display:flex;align-items:center;gap:7px;padding:0 12px 0 10px;border-radius:999px;border:1px solid var(--line2);background:rgba(17,21,19,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--muted);font:600 12px var(--f-body)}
  .nc-cloud svg{width:18px;height:18px}
  .nc-cloud i{width:7px;height:7px;border-radius:50%;background:var(--dim);margin-left:-11px;margin-top:9px;box-shadow:0 0 0 2px #111513}
  .nc-cloud.ok i{background:var(--accent)} .nc-cloud.busy i{background:var(--ice);animation:breathe 1s infinite} .nc-cloud.wait i,.nc-cloud.off i{background:var(--warn)} .nc-cloud.bad i{background:var(--bad)}
  @media (max-width:899px){ .nc-cloud span{display:none} .nc-cloud{padding:0;width:34px;justify-content:center} .nc-cloud i{margin-left:-12px} }
  .nc-ov[hidden]{display:none}
  .nc-form{display:flex;flex-direction:column;gap:12px}
  .nc-form .field input{font:500 16px var(--f-body)}
  .nc-rows{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;overflow:hidden}
  .nc-rows div{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-top:1px solid var(--line);font-size:13px} .nc-rows div:first-child{border-top:0}
  .nc-rows span{color:var(--muted)} .nc-rows b{font-weight:600;text-align:right;overflow-wrap:anywhere}
  .nc-s.ok{color:var(--accent)} .nc-s.bad{color:var(--bad)} .nc-s.wait,.nc-s.off{color:var(--warn)}
  .nc-sec{display:flex;flex-direction:column;gap:10px}
  .nc-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .nc-paste{min-height:110px;border-radius:14px;border:1px solid var(--line2);background:#0b0e0d;color:var(--fg);padding:10px;font:12px var(--f-mono)}
  .nc-sheet .link{align-self:center}`;
  document.head.appendChild(css);
  chip = document.createElement('button'); chip.type = 'button';
  chip.addEventListener('click', () => openSheet(false));
  ov = document.createElement('div'); ov.className = 'ov nc-ov'; ov.hidden = true;
  ov.addEventListener('click', e => {
    if (e.target === ov && !ui.gate) return closeSheet();
    const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a);
  });
  ov.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target); ui.email = String(f.get('email') || '');
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…'; ui.err = ''; ui.msg = '';
    try { await signIn(ui.email, String(f.get('password') || '')); ui.msg = st.error ? '' : 'Signed in and synced.'; if (ui.gate){ ui.gate = false; startApp(); } }
    catch (err){ ui.err = /invalid login/i.test(err.message) ? 'Wrong email or password.' : friendly(err); }
    sheet();
  });
  ov.addEventListener('change', async e => {
    if (!e.target.matches('[data-f=file]') || !e.target.files[0]) return;
    try { const r = await restore(await e.target.files[0].text()); ui.msg = `Restored ${r.applied} of ${r.total} records (newer copies already here were kept).`; ui.err = ''; }
    catch (err){ ui.err = err.message; }
    sheet();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.open && !ui.gate) closeSheet(); });
  document.body.append(chip, ov); paint();
}

// ---------- start-up ----------
let bootFn = null;
function startApp(){ if (st.booted || !bootFn) return; st.booted = true; Promise.resolve(bootFn()); }
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

async function ready(boot){
  bootFn = boot; mountUI();
  if (!cloudOn) return startApp();
  try { const { data } = await sb.auth.getSession(); st.user = data.session ? data.session.user : null; } catch(_){}
  sb.auth.onAuthStateChange((_ev, session) => { st.user = session ? session.user : null; paint(); });
  if (st.user){
    // Catch up with the cloud before showing anything (max 6 s, then carry on offline).
    await withTimeout(syncNow(), 6000);
    return startApp();
  }
  const any = (await Store.raw()).length > 0;
  if (any) return startApp();
  openSheet(true);        // brand-new device: offer sign-in first so it starts from your real data
}
// Keep catching up: when the connection returns, when the app comes back to the front, and every 2 minutes.
root.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
setInterval(() => { if (document.visibilityState !== 'hidden') syncNow(); }, 120000);

root.NCSync = { ready, syncNow, backupText, restore, open: () => openSheet(false), state: st };
})(window);
