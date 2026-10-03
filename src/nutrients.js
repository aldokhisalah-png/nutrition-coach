// =====================================================================
// MICRONUTRIENT ENGINE — targets, upper limits, totals, adequacy status.
// Targets: Dietary Reference Intakes for adult males 19–30 (RDA where set, otherwise AI).
// Upper limits (UL) only where an official UL exists, applied to the intake the UL is defined for.
// =====================================================================
(function (root) {
'use strict';

// basis: which intake the UL applies to
//   total        → food + supplements
//   supplemental → supplements and fortificants only (food amounts don't count)
//   preformed    → preformed vitamin A (retinol) from food + supplements
//   folicAcid    → synthetic folic acid from fortified food + supplements
const REF = [
  // ---- vitamins ----
  { key:'vitA', label:'Vitamin A', group:'Vitamins', unit:'µg RAE', target:900, kind:'RDA', ul:3000, ulBasis:'preformed', ulNote:'UL applies to preformed vitamin A (retinol), not beta-carotene.' },
  { key:'vitC', label:'Vitamin C', group:'Vitamins', unit:'mg', target:90, kind:'RDA', ul:2000, ulBasis:'total' },
  { key:'vitD', label:'Vitamin D', group:'Vitamins', unit:'µg', target:15, kind:'RDA', ul:100, ulBasis:'total', note:'15 µg = 600 IU.' },
  { key:'vitE', label:'Vitamin E', group:'Vitamins', unit:'mg', target:15, kind:'RDA', ul:1000, ulBasis:'supplemental', ulNote:'UL applies to supplemental alpha-tocopherol only.' },
  { key:'vitK', label:'Vitamin K', group:'Vitamins', unit:'µg', target:120, kind:'AI' },
  { key:'b1', label:'Thiamin (B1)', group:'Vitamins', unit:'mg', target:1.2, kind:'RDA' },
  { key:'b2', label:'Riboflavin (B2)', group:'Vitamins', unit:'mg', target:1.3, kind:'RDA' },
  { key:'niacinNE', label:'Niacin (B3)', group:'Vitamins', unit:'mg NE', target:16, kind:'RDA', ul:35, ulBasis:'supplemental', ulNote:'UL applies to niacin from supplements and fortified foods.', note:'Niacin equivalents = niacin + tryptophan ÷ 60.' },
  { key:'b5', label:'Pantothenic acid (B5)', group:'Vitamins', unit:'mg', target:5, kind:'AI' },
  { key:'b6', label:'Vitamin B6', group:'Vitamins', unit:'mg', target:1.3, kind:'RDA', ul:100, ulBasis:'total' },
  { key:'b7', label:'Biotin (B7)', group:'Vitamins', unit:'µg', target:30, kind:'AI' },
  { key:'folateDFE', label:'Folate (B9)', group:'Vitamins', unit:'µg DFE', target:400, kind:'RDA', ul:1000, ulBasis:'folicAcid', ulNote:'UL applies to folic acid from supplements and fortified food (e.g. enriched rice).' },
  { key:'b12', label:'Vitamin B12', group:'Vitamins', unit:'µg', target:2.4, kind:'RDA' },
  { key:'choline', label:'Choline', group:'Vitamins', unit:'mg', target:550, kind:'AI', ul:3500, ulBasis:'total' },
  // ---- minerals ----
  { key:'calcium', label:'Calcium', group:'Minerals', unit:'mg', target:1000, kind:'RDA', ul:2500, ulBasis:'total' },
  { key:'chloride', label:'Chloride', group:'Minerals', unit:'mg', target:2300, kind:'AI', ul:3600, ulBasis:'total' },
  { key:'chromium', label:'Chromium', group:'Minerals', unit:'µg', target:35, kind:'AI' },
  { key:'copper', label:'Copper', group:'Minerals', unit:'µg', target:900, kind:'RDA', ul:10000, ulBasis:'total' },
  { key:'fluoride', label:'Fluoride', group:'Minerals', unit:'mg', target:4, kind:'AI', ul:10, ulBasis:'total', note:'Most fluoride usually comes from drinking water, which isn’t logged.' },
  { key:'iodine', label:'Iodine', group:'Minerals', unit:'µg', target:150, kind:'RDA', ul:1100, ulBasis:'total' },
  { key:'iron', label:'Iron', group:'Minerals', unit:'mg', target:8, kind:'RDA', ul:45, ulBasis:'total' },
  { key:'magnesium', label:'Magnesium', group:'Minerals', unit:'mg', target:400, kind:'RDA', ul:350, ulBasis:'supplemental', ulNote:'UL (350 mg) applies to supplemental magnesium only, not magnesium in food.' },
  { key:'manganese', label:'Manganese', group:'Minerals', unit:'mg', target:2.3, kind:'AI', ul:11, ulBasis:'total' },
  { key:'molybdenum', label:'Molybdenum', group:'Minerals', unit:'µg', target:45, kind:'RDA', ul:2000, ulBasis:'total' },
  { key:'phosphorus', label:'Phosphorus', group:'Minerals', unit:'mg', target:700, kind:'RDA', ul:4000, ulBasis:'total' },
  { key:'potassium', label:'Potassium', group:'Minerals', unit:'mg', target:3400, kind:'AI' },
  { key:'selenium', label:'Selenium', group:'Minerals', unit:'µg', target:55, kind:'RDA', ul:400, ulBasis:'total' },
  { key:'sodium', label:'Sodium', group:'Minerals', unit:'mg', target:1500, kind:'AI', cdrr:2300, note:'No UL. Intake above 2300 mg (the chronic-disease risk reduction level) is flagged. Salt added while cooking isn’t logged.' },
  { key:'zinc', label:'Zinc', group:'Minerals', unit:'mg', target:11, kind:'RDA', ul:40, ulBasis:'total' },
  // ---- fatty acids ----
  { key:'la', label:'Linoleic acid', group:'Fatty acids', unit:'g', target:17, kind:'AI' },
  { key:'ala', label:'ALA omega-3', group:'Fatty acids', unit:'g', target:1.6, kind:'AI' },
  { key:'epa', label:'EPA', group:'Fatty acids', unit:'g', target:null, note:'No official target.' },
  { key:'dha', label:'DHA', group:'Fatty acids', unit:'g', target:null, note:'No official target.' },
  { key:'epaDha', label:'EPA + DHA', group:'Fatty acids', unit:'g', target:null, note:'Combined, including the omega-3 supplement. No official target.' },
  // ---- amino acids (RDA, mg per kg body weight per day) ----
  { key:'his', label:'Histidine', group:'Amino acids', unit:'mg', perKg:14, kind:'RDA' },
  { key:'ile', label:'Isoleucine', group:'Amino acids', unit:'mg', perKg:19, kind:'RDA' },
  { key:'leu', label:'Leucine', group:'Amino acids', unit:'mg', perKg:42, kind:'RDA' },
  { key:'lys', label:'Lysine', group:'Amino acids', unit:'mg', perKg:38, kind:'RDA' },
  { key:'metCys', label:'Methionine + cysteine', group:'Amino acids', unit:'mg', perKg:19, kind:'RDA' },
  { key:'pheTyr', label:'Phenylalanine + tyrosine', group:'Amino acids', unit:'mg', perKg:33, kind:'RDA' },
  { key:'thr', label:'Threonine', group:'Amino acids', unit:'mg', perKg:20, kind:'RDA' },
  { key:'trp', label:'Tryptophan', group:'Amino acids', unit:'mg', perKg:5, kind:'RDA' },
  { key:'val', label:'Valine', group:'Amino acids', unit:'mg', perKg:24, kind:'RDA' },
  // ---- other ----
  { key:'protein', label:'Protein', group:'Other', unit:'g', fromTargets:'protein' },
  { key:'fiber', label:'Fiber', group:'Other', unit:'g', target:38, kind:'AI' }
];
const REF_BY_KEY = Object.fromEntries(REF.map(r => [r.key, r]));

// Derived nutrients built from raw food keys. A derived value is only known if all its parts are known.
const DERIVED = {
  niacinNE: { parts:['niacin', 'trp'], fn: v => v.niacin + v.trp / 60 },
  metCys:   { parts:['met', 'cys'], fn: v => v.met + v.cys },
  pheTyr:   { parts:['phe', 'tyr'], fn: v => v.phe + v.tyr },
  epaDha:   { parts:['epa', 'dha'], fn: v => v.epa + v.dha }
};

// items: [{ name, grams, per100g }]  (per100g missing a key = unknown for that food)
// supplements: [{ name, nutrients: { key: amount } }]  (amounts in the REF units; epaDha allowed)
// Returns per nutrient: { value, known, missingFrom:[names], supplemental, preformed, folicAcid }
function totals(items, supplements){
  const raw = {};                                   // key → { sum, missing:Set }
  const addFood = (key, name, amt) => {
    const r = raw[key] || (raw[key] = { sum:0, missing:[] });
    if (amt == null) r.missing.push(name); else r.sum += amt;
  };
  const RAW_KEYS = new Set(['kcal','protein','fat','carbs','fiber','vitA','retinol','vitC','vitD','vitE','vitK','b1','b2','niacin','b5','b6','b7','folateDFE','folicAcid','b12','choline','calcium','iron','magnesium','phosphorus','potassium','sodium','zinc','copper','manganese','selenium','fluoride','iodine','chloride','chromium','molybdenum','la','ala','epa','dha','his','ile','leu','lys','met','cys','phe','tyr','thr','trp','val']);
  for (const it of items || []){
    if (!it || !(it.grams > 0)) continue;
    for (const k of RAW_KEYS){
      const v = it.per100g ? it.per100g[k] : undefined;
      addFood(k, it.name, v == null ? null : v * it.grams / 100);
    }
  }
  const supp = {};
  for (const s of supplements || []) for (const [k, v] of Object.entries(s.nutrients || {})) supp[k] = (supp[k] || 0) + v;
  const out = {};
  const hasFood = (items || []).some(it => it && it.grams > 0);
  for (const k of RAW_KEYS){
    const r = raw[k] || { sum:0, missing:[] };
    const s = supp[k] || 0;
    out[k] = { value: r.sum + s, known: r.missing.length === 0 && (hasFood || s > 0), anyData: r.missing.length < (items || []).filter(i => i && i.grams > 0).length || s > 0,
      missingFrom: r.missing, supplemental: s };
  }
  for (const [k, d] of Object.entries(DERIVED)){
    const parts = d.parts.map(p => out[p]);
    const vals = Object.fromEntries(d.parts.map((p, i) => [p, parts[i].value]));
    const s = supp[k] || 0;
    const known = parts.every(p => p.known);
    out[k] = { value: d.fn(vals) + s, known: known || (s > 0 && parts.every(p => p.known)), anyData: parts.some(p => p.anyData) || s > 0,
      missingFrom: [...new Set(parts.flatMap(p => p.missingFrom))], supplemental: s + (k === 'niacinNE' ? (supp.niacin || 0) : 0) };
  }
  // UL bases that aren't "total"
  out.vitA.preformed = (out.retinol ? out.retinol.value : 0) + (supp.vitA || 0);
  out.vitA.preformedKnown = out.retinol ? out.retinol.known : false;
  out.folateDFE.folicAcid = (out.folicAcid ? out.folicAcid.value : 0) + (supp.folicAcid || 0);
  out.folateDFE.folicAcidKnown = out.folicAcid ? out.folicAcid.known : false;
  return out;
}

// Status for one nutrient. Never rewards going past the target.
//   unavailable · low · below · reached · high (≥80% of UL) · over (≥ UL)
function assess(ref, t, ctx){
  const target = ref.fromTargets ? (ctx.targets && ctx.targets[ref.fromTargets]) : ref.perKg ? (ctx.weightKg ? ref.perKg * ctx.weightKg : null) : ref.target;
  if (!t || !t.anyData) return { status:'unavailable', target, label:'Data unavailable', reason:`USDA has no ${ref.label.toLowerCase()} data for these foods.` };
  const value = t.value, partial = !t.known;
  let ulValue = null;
  if (ref.ul != null){
    ulValue = ref.ulBasis === 'supplemental' ? t.supplemental : ref.ulBasis === 'preformed' ? t.preformed : ref.ulBasis === 'folicAcid' ? t.folicAcid : value;
  }
  const pct = target ? value / target : null;
  let status, label;
  if (ref.ul != null && ulValue >= ref.ul){ status = 'over'; label = 'Above upper limit'; }
  else if (ref.ul != null && ulValue >= ref.ul * 0.8){ status = 'high'; label = 'High: near upper limit'; }
  else if (ref.cdrr && value > ref.cdrr){ status = 'high'; label = `Above ${ref.cdrr} mg`; }
  else if (target == null){ status = 'info'; label = 'No target'; }
  else if (Math.round(pct * 100) >= 100){ status = 'reached'; label = 'Target reached'; }
  else if (pct >= 0.7){ status = 'below'; label = 'Below target'; }
  else { status = 'low'; label = 'Low'; }
  const missingTxt = partial && t.missingFrom.length ? ` No USDA data for: ${t.missingFrom.join(', ')}, so the real total is likely higher.` : '';
  return { status, label, value, target, pct, ul: ref.ul ?? null, ulValue, partial, missingFrom: t.missingFrom,
    reason: (target != null ? `${fmt(value)} of ${fmt(target)} ${ref.unit} (${Math.round(pct * 100)}%).` : `${fmt(value)} ${ref.unit}.`) +
      (ref.ul != null ? ` Upper limit ${fmt(ref.ul)} ${ref.unit}${ref.ulBasis !== 'total' ? ` (${ref.ulBasis === 'supplemental' ? 'supplements only' : ref.ulBasis === 'preformed' ? 'preformed vitamin A' : 'folic acid'}: ${fmt(ulValue)})` : ''}.` : '') + missingTxt };
}
function fmt(x){ if (x == null || !isFinite(x)) return '—'; const a = Math.abs(x); return a >= 100 ? String(Math.round(x)) : a >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''); }

const api = { REF, REF_BY_KEY, DERIVED, totals, assess, fmt };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Nutrients = api;
})(typeof window !== 'undefined' ? window : globalThis);
