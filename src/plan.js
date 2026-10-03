// =====================================================================
// DIET PLAN — the locked food structure, the quantity solver, supplements and the grocery list.
// Foods never change; only grams do. Every change from the base plan comes with a reason.
// =====================================================================
(function (root) {
'use strict';
const DB = root.FOOD_DB || (typeof require !== 'undefined' ? require('./foods.js') : null);
const FOOD = Object.fromEntries(DB.foods.map(f => [f.key, f]));

// ---------- the locked base plan (2100 kcal starting quantities) ----------
const MEALS = [
  { key:'breakfast', name:'Breakfast', items:[['eggs',150],['greek_yogurt',150],['blueberries',100],['banana',120]] },
  { key:'lunch', name:'Lunch', items:[['chicken_breast',150],['rice',150],['broccoli',150],['spinach',100],['olive_oil',10]] },
  { key:'preworkout', name:'Pre-workout', items:[['greek_yogurt',150],['banana',120]] },
  { key:'dinner', name:'Dinner', items:[['DINNER_PROTEIN',120],['sweet_potato',190],['cucumber',100],['red_pepper',100]] },
  { key:'evening', name:'Evening', items:[['milk',254],['whey',25],['strawberries',150],['walnuts',15]] }
];
const ML_PER = { milk: 254 / 250 };             // grams per ml, from USDA portion data (1 cup = 244 g / 240 ml)

// Dinner alternates; Saturday is always a beef day with 25 g of the beef swapped for liver.
// A 7-day week can't alternate perfectly, so Sunday and Monday are both salmon days.
const WEEK = { 0:'salmon', 1:'salmon', 2:'beef', 3:'salmon', 4:'beef', 5:'salmon', 6:'beef_liver' };   // getUTCDay()
function dayType(iso){ return WEEK[new Date(iso + 'T00:00:00Z').getUTCDay()]; }
const DAY_LABEL = { salmon:'Salmon day', beef:'Beef day', beef_liver:'Beef day + liver (Saturday)' };

function baseDay(type){
  return MEALS.map(m => ({ key:m.key, name:m.name, items: m.items.flatMap(([k, g]) => {
    if (k !== 'DINNER_PROTEIN') return [{ food:k, grams:g }];
    if (type === 'salmon') return [{ food:'salmon', grams:g }];
    if (type === 'beef') return [{ food:'lean_beef', grams:g }];
    return [{ food:'lean_beef', grams:g - 25 }, { food:'liver', grams:25 }];
  }) }));
}

// ---------- nutrition of a day / meal ----------
function itemsOf(day){ return day.flatMap(m => m.items).map(it => ({ name: FOOD[it.food] ? FOOD[it.food].name : it.name, grams: it.grams, per100g: FOOD[it.food] ? FOOD[it.food].per100g : it.per100g })); }
// Calories are counted as 4 kcal per g of protein and carbs and 9 per g of fat — the same rule
// used to set the targets — so eating the plan exactly lands exactly on the calorie target.
// USDA's own energy value (which treats fiber and each food differently) is kept as usdaKcal.
// Custom foods keep the calories you typed in.
function macrosOf(items){
  const t = { kcal:0, protein:0, carbs:0, fat:0, fiber:0, usdaKcal:0 };
  for (const it of items){
    const p = it.per100g || {}, f = it.grams / 100, g = k => (p[k] != null ? p[k] : 0) * f;
    t.protein += g('protein'); t.carbs += g('carbs'); t.fat += g('fat'); t.fiber += g('fiber'); t.usdaKcal += g('kcal');
    t.kcal += it.customKcal ? g('kcal') : g('protein') * 4 + g('carbs') * 4 + g('fat') * 9;
  }
  return t;
}
function mealMacros(meal){ return macrosOf(itemsOf([meal])); }
function dayMacros(day){ return macrosOf(itemsOf(day)); }

// ---------- quantity solver ----------
// Order (from the spec): protein foods only if protein is meaningfully off, then calories through
// rice → sweet potato → olive oil. Vegetables and fruit are never changed to hit numbers.
const LIMITS = { rice:[50, 400], sweet_potato:[100, 400], olive_oil:[0, 25], chicken_breast:[100, 250], whey:[20, 50], greek_yogurt:[100, 250], salmon:[100, 200], lean_beef:[100, 200] };
const STEP = { rice:5, sweet_potato:5, olive_oil:1, chicken_breast:5, whey:5, greek_yogurt:10, salmon:5, lean_beef:5 };
const PROTEIN_TOLERANCE = 10;   // g
const clone = d => JSON.parse(JSON.stringify(d));
function setGrams(day, food, grams){ for (const m of day) for (const it of m.items) if (it.food === food) it.grams = grams; }
function getGrams(day, food){ for (const m of day) for (const it of m.items) if (it.food === food) return it.grams; return 0; }
function countOf(day, food){ return day.reduce((n, m) => n + m.items.filter(it => it.food === food).length, 0); }
const snap = (x, step, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(x / step) * step));

// Exact solver: hits protein, carbs and fat to within 1 g by solving for three "lever" foods at once.
// Levers, in the spec's order of preference:
//   protein → chicken, then whey, then the dinner protein, then Greek yogurt
//   carbs   → rice, then sweet potato
//   fat     → olive oil, then walnuts
// If a lever would go outside its sensible range it is held at the limit and the next lever takes over.
// Vegetables and fruit are never changed. Calories follow from the USDA values of the foods.
const LEVERS = {
  protein: type => ['chicken_breast', 'whey', type === 'salmon' ? 'salmon' : 'lean_beef', 'greek_yogurt'],
  carbs: () => ['rice', 'sweet_potato'],
  fat: () => ['olive_oil', 'walnuts']
};
const RANGE = { chicken_breast:[80, 300], whey:[10, 60], salmon:[80, 220], lean_beef:[70, 220], greek_yogurt:[100, 250], rice:[50, 450], sweet_potato:[100, 450], olive_oil:[0, 30], walnuts:[0, 40] };
function solveN(A, b){             // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++){
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c){ const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function solveDay(type, targets){
  const base = baseDay(type), day = clone(base);
  const per = food => FOOD[food].per100g, K = ['protein', 'carbs', 'fat'];
  const lists = { protein: LEVERS.protein(type), carbs: LEVERS.carbs(), fat: LEVERS.fat() };
  const idx = { protein: 0, carbs: 0, fat: 0 }, held = {};
  for (let iter = 0; iter < 20; iter++){
    const active = K.filter(k => lists[k][idx[k]]);           // macros that still have a free lever
    if (!active.length) break;
    const foods = active.map(k => lists[k][idx[k]]);
    const others = { protein: 0, carbs: 0, fat: 0 };
    for (const m of day) for (const it of m.items){
      if (foods.includes(it.food)) continue;
      for (const k of K) others[k] += (per(it.food)[k] || 0) * it.grams / 100;
    }
    const A = active.map(k => foods.map(f => (per(f)[k] || 0) / 100 * countOf(day, f)));
    const x = solveN(A, active.map(k => targets[k] - others[k])); if (!x) break;
    let clamped = false;
    foods.forEach((f, i) => {
      const [lo, hi] = RANGE[f], g = x[i];
      if (g < lo - 1e-6 || g > hi + 1e-6){ setGrams(day, f, g < lo ? lo : hi); held[f] = g < lo ? 'min' : 'max'; idx[active[i]]++; clamped = true; }
      else setGrams(day, f, g);
    });
    if (!clamped) break;
  }
  // round every gram amount to a whole gram
  for (const m of day) for (const it of m.items) it.grams = Math.round(it.grams);
  const mac = dayMacros(day);
  const off = { kcal: mac.kcal - targets.calories, protein: mac.protein - targets.protein, carbs: mac.carbs - targets.carbs, fat: mac.fat - targets.fat };
  const exact = Math.abs(off.protein) <= 1.5 && Math.abs(off.carbs) <= 1.5 && Math.abs(off.fat) <= 1.5;
  const changes = [];
  const seen = new Set();
  for (const m of base) for (const it of m.items){
    if (seen.has(it.food)) continue; seen.add(it.food);
    const to = getGrams(day, it.food); if (to === it.grams) continue;
    const role = LEVERS.protein(type).includes(it.food) ? 'protein' : LEVERS.carbs().includes(it.food) ? 'carbs' : 'fat';
    const tgt = role === 'protein' ? `${targets.protein} g protein` : role === 'carbs' ? `${targets.carbs} g carbs` : `${targets.fat} g fat`;
    changes.push({ food: it.food, from: it.grams, to, reason: `${FOOD[it.food].name} ${to > it.grams ? 'increased' : 'reduced'} from ${it.grams} g to ${to} g${countOf(day, it.food) > 1 ? ' (each serving)' : ''} to reach ${tgt}${held[it.food] ? ` (held at its ${held[it.food] === 'min' ? 'minimum' : 'maximum'} portion)` : ''}.` });
  }
  const r = x => Math.round(x);
  return { type, day, macros: mac, off, ok: exact, exact, changes,
    summary: exact ? `Hits your targets: ${r(mac.kcal)} kcal, ${r(mac.protein)} g protein, ${r(mac.carbs)} g carbs, ${r(mac.fat)} g fat.`
      : `Closest practical fit: ${r(mac.protein)} g protein, ${r(mac.carbs)} g carbs, ${r(mac.fat)} g fat. Some portions reached their limits, so the plan needs a review.` };
}
function solvePlan(targets){ return { salmon: solveDay('salmon', targets), beef: solveDay('beef', targets), beef_liver: solveDay('beef_liver', targets) }; }

// ---------- supplements (locked stack, doses editable) ----------
const SUPPLEMENTS = [
  { key:'creatine', name:'Creatine monohydrate', when:'breakfast', dose:5, unit:'g', nutrients: () => ({}) },
  { key:'vitD3', name:'Vitamin D3', when:'breakfast', dose:25, unit:'µg', note:'25 µg = 1000 IU', nutrients: d => ({ vitD: d }) },
  { key:'omega3', name:'Omega-3 (EPA + DHA)', when:'breakfast', dose:1000, unit:'mg EPA+DHA', nutrients: d => ({ epaDha: d / 1000 }) },
  { key:'preworkout', name:'Pre-workout', when:'preworkout', dose:200, unit:'mg caffeine', nutrients: () => ({}), caffeine: d => d },
  { key:'magnesium', name:'Magnesium (elemental)', when:'evening', dose:200, unit:'mg', nutrients: d => ({ magnesium: d }) },
  { key:'ashwagandha', name:'Ashwagandha extract', when:'evening', dose:300, unit:'mg', nutrients: () => ({}) }
];
function suppNutrients(list, doses){ return list.map(s => ({ name: s.name, nutrients: s.nutrients(doses && doses[s.key] != null ? doses[s.key] : s.dose) })); }

// ---------- grocery list from planned days ----------
const CATEGORY = { protein:'Proteins', carbs:'Carbohydrates', fruit:'Fruit', vegetables:'Vegetables', dairy_eggs:'Dairy & eggs', fats:'Fats / pantry' };
// Approximate raw purchase amounts for foods planned at cooked weight (shown separately, labelled approximate).
const RAW_FACTOR = { chicken_breast: 1 / 0.75, salmon: 1 / 0.8, lean_beef: 1 / 0.75, liver: 1 / 0.8, rice: 1 / 2.9, sweet_potato: 1 / 0.85 };
const RAW_LABEL = { rice:'dry rice', sweet_potato:'raw, with skin' };
function grocery(days){
  const tot = {};
  for (const d of days) for (const m of d) for (const it of m.items) tot[it.food] = (tot[it.food] || 0) + it.grams;
  const groups = {};
  for (const [food, grams] of Object.entries(tot)){
    const f = FOOD[food], cat = CATEGORY[f.category];
    (groups[cat] = groups[cat] || []).push({ food, name: f.name, grams, state: f.state,
      ml: ML_PER[food] ? grams / ML_PER[food] : null,
      raw: RAW_FACTOR[food] ? { grams: grams * RAW_FACTOR[food], label: RAW_LABEL[food] || 'raw' } : null });
  }
  return Object.keys(CATEGORY).map(k => CATEGORY[k]).filter(c => groups[c]).map(c => ({ category: c, items: groups[c].sort((a, b) => b.grams - a.grams) }));
}

const api = { FOOD, MEALS, ML_PER, WEEK, DAY_LABEL, dayType, baseDay, itemsOf, macrosOf, mealMacros, dayMacros, solveDay, solvePlan, SUPPLEMENTS, suppNutrients, grocery, CATEGORY, RAW_FACTOR };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
