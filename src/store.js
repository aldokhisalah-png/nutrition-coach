// =====================================================================
// LOCAL STORE — every record lives in this device's IndexedDB first.
// One store of records { id, kind, body, updatedAt, deleted? } keeps sync (stage 9) simple:
// each record maps to one cloud row, and the newest updatedAt wins.
// =====================================================================
(function (root) {
'use strict';
let dbp = null;
function open(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('nutrition-coach', 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('records', { keyPath: 'id' });
      s.createIndex('kind', 'kind');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn){
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction('records', mode), req = fn(t.objectStore('records'));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const listeners = [];
const changed = kind => listeners.forEach(f => { try{ f(kind); }catch(e){} });
const newId = kind => kind + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const Store = {
  onChange(f){ listeners.push(f); },
  async all(kind){ const rows = await tx('readonly', s => s.index('kind').getAll(kind)); return rows.filter(r => !r.deleted); },
  async get(id){ const r = await tx('readonly', s => s.get(id)); return r && !r.deleted ? r : null; },
  async put(kind, body, id){
    const now = Date.now(), prev = id ? await tx('readonly', s => s.get(id)) : null;
    const rec = { id: id || newId(kind), kind, body: JSON.parse(JSON.stringify(body)), createdAt: prev ? prev.createdAt : now, updatedAt: now };
    await tx('readwrite', s => s.put(rec)); changed(kind); return rec;
  },
  // Deletes are kept as markers so the delete can reach other devices later.
  async remove(id){
    const prev = await tx('readonly', s => s.get(id)); if (!prev) return;
    await tx('readwrite', s => s.put({ ...prev, deleted: true, updatedAt: Date.now() })); changed(prev.kind);
  },
  async raw(){ return tx('readonly', s => s.getAll()); },
  async putRaw(rec){ await tx('readwrite', s => s.put(rec)); changed(rec.kind); },
  newId
};
root.Store = Store;
})(window);
