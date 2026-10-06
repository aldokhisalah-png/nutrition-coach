// =====================================================================
// COOK — how to make each meal of the day, with the exact amounts from the current plan.
// Nutrition Coach counts meat, fish, rice and sweet potato at COOKED weight (USDA cooked values), so every
// amount here is worked out from the plan: what to take raw, how to cook it, and the cooked weight to serve.
// Raw ↔ cooked factors are the app's own (plan.js RAW_FACTOR). Safe internal temperatures are USDA's.
// The measurements change automatically whenever the plan's grams change.
// =====================================================================
(function (root) {
'use strict';
const P = root.Plan || (typeof require !== 'undefined' ? require('./plan.js') : null);

const r5 = g => Math.max(5, Math.round(g / 5) * 5);
const r1 = x => Math.round(x * 10) / 10;
const EGG = 50;                 // grams per large egg, out of the shell
const BANANA = 118;             // grams per medium banana, peeled (USDA)
const OIL_TSP = 4.5;            // grams of olive oil per teaspoon (1 tbsp ≈ 13.5 g)
const WALNUT_HALF = 2;          // grams per walnut half, roughly

/** Amount lines for one item: what to buy/cook and what goes on the plate. */
function amount(it) {
  const f = P.FOOD[it.food], g = it.grams, raw = P.RAW_FACTOR[it.food];
  const name = f ? f.name.split(',')[0] : it.food;
  switch (it.food) {
    case 'eggs': return { name: 'Eggs', serve: `${Math.round(g)} g`, prep: `${r1(g / EGG)} large egg${r1(g / EGG) === 1 ? '' : 's'} (about ${EGG} g each out of the shell — crack into a bowl on the scale)` };
    case 'rice': { const dry = g * raw; return { name: 'White rice', serve: `${Math.round(g)} g cooked`, prep: `${r5(dry)} g dry rice + about ${r5(dry * 2)} ml water` }; }
    case 'chicken_breast': case 'lean_beef': case 'salmon': case 'liver':
      return { name, serve: `${Math.round(g)} g cooked`, prep: `about ${r5(g * raw)} g raw (it loses about ${Math.round((1 - 1 / raw) * 100)}% of its weight cooking)` };
    case 'sweet_potato': return { name: 'Sweet potato', serve: `${Math.round(g)} g cooked flesh`, prep: `about ${r5(g * raw)} g raw, with skin` };
    case 'olive_oil': return { name: 'Olive oil', serve: `${Math.round(g)} g`, prep: `${r1(g / OIL_TSP)} tsp — weigh it: oil is the easiest place to miss calories` };
    case 'milk': return { name: 'Milk (2%)', serve: `${Math.round(g)} g`, prep: `${Math.round(g / P.ML_PER.milk)} ml` };
    case 'banana': return { name: 'Banana', serve: `${Math.round(g)} g peeled`, prep: `about ${r1(g / BANANA)} medium banana${r1(g / BANANA) === 1 ? '' : 's'}` };
    case 'walnuts': return { name: 'Walnuts', serve: `${Math.round(g)} g`, prep: `about ${Math.round(g / WALNUT_HALF)} halves` };
    case 'whey': return { name: 'Whey', serve: `${Math.round(g)} g`, prep: 'weigh it — scoop sizes vary by brand (check your label)' };
    default: return { name, serve: `${Math.round(g)} g`, prep: f && f.state === 'cooked' ? 'weigh after cooking' : 'weigh as is' };
  }
}

const SAFE = { chicken_breast: 'Chicken is done at 74°C in the thickest part (USDA).', salmon: 'Salmon is done at 63°C, or when it flakes easily (USDA).',
  lean_beef: 'Steak: 63°C, then rest 3 minutes. If it\'s minced: 71°C (USDA).', liver: 'Liver: cook to 71°C — no pink in the middle.', eggs: 'Cook eggs until the whites and yolks are firm (USDA).' };

/** Step-by-step method for each meal, built from the items actually in it. */
function method(meal, items) {
  const has = k => items.find(i => i.food === k), a = k => has(k) ? amount(has(k)) : null, out = [];
  if (meal === 'breakfast') {
    if (has('eggs')) out.push(`Crack ${a('eggs').prep.split(' (')[0]} into a bowl on the scale until it reads ${a('eggs').serve}. Beat with a pinch of salt.`,
      'Non-stick pan on medium-low, no oil needed. Pour in, stir slowly with a spatula for 3–4 minutes until just set — or boil whole eggs 9–10 minutes and peel.');
    const side = items.filter(i => ['greek_yogurt', 'blueberries', 'banana'].includes(i.food));
    if (side.length) out.push(`In a bowl: ${side.map(i => `${amount(i).name.toLowerCase()} ${amount(i).serve}${i.food === 'banana' ? ` (${amount(i).prep})` : ''}`).join(', ')}.`);
    out.push('Take creatine, vitamin D3 and omega-3 with it.');
    return { minutes: 15, steps: out, safety: SAFE.eggs };
  }
  if (meal === 'lunch') {
    if (has('rice')) out.push(`Rice: rinse ${a('rice').prep.split(' +')[0]} until the water runs clear. Bring ${a('rice').prep.split('+ about ')[1]} to the boil, add the rice, lid on, lowest heat for 15 minutes, then off the heat 5 minutes. Weigh out ${a('rice').serve}.`);
    if (has('chicken_breast')) out.push(`Chicken: take ${a('chicken_breast').prep.split(' (')[0]}, pat dry, season (salt, pepper, paprika, garlic). Air fryer 200°C for 18–22 minutes (turn once), or oven 200°C for 20–25 minutes. Rest 5 minutes, then weigh ${a('chicken_breast').serve}.`);
    if (has('broccoli')) out.push(`Broccoli: ${a('broccoli').serve} — steam 4–5 minutes (or microwave with 2 tbsp water, covered, 3–4 minutes) until bright green and just tender.`);
    if (has('spinach')) out.push(`Spinach: ${a('spinach').serve} raw — eat as a base, or wilt it in the hot pan for 30 seconds.`);
    if (has('olive_oil')) out.push(`Olive oil: ${a('olive_oil').serve} (${a('olive_oil').prep.split(' —')[0]}) drizzled over the plate at the end, not in the pan, so none is lost.`);
    out.push('Packing it for uni: let it cool, box it within 2 hours, and keep it with an ice pack or in a fridge.');
    return { minutes: 35, steps: out, safety: SAFE.chicken_breast };
  }
  if (meal === 'dinner') {
    if (has('sweet_potato')) out.push(`Sweet potato: ${a('sweet_potato').prep}. Oven 200°C for 40–45 minutes whole (fork goes in easily), or cubes for 25–30 minutes — or microwave whole, pierced, 6–8 minutes. Weigh ${a('sweet_potato').serve}.`);
    if (has('salmon')) out.push(`Salmon: ${a('salmon').prep.split(' (')[0]}, skin on. Season, then air fryer 200°C 8–10 minutes, oven 200°C 12–15 minutes, or a hot pan skin-side down 4–5 minutes and 2–3 on the other side. Weigh ${a('salmon').serve}.`);
    if (has('lean_beef')) out.push(`Beef: ${a('lean_beef').prep.split(' (')[0]} (top round is what the numbers assume). Very hot pan, a few drops of oil wiped out, 3–4 minutes a side for a steak, then rest 3 minutes and slice thin. Weigh ${a('lean_beef').serve}.`);
    if (has('liver')) out.push(`Liver: ${a('liver').prep.split(' (')[0]}, sliced thin. Pan, 1½–2 minutes a side until no pink remains. Weigh ${a('liver').serve}.`);
    const veg = items.filter(i => ['cucumber', 'red_pepper'].includes(i.food));
    if (veg.length) out.push(`Raw on the side: ${veg.map(i => `${amount(i).name.toLowerCase()} ${amount(i).serve}`).join(', ')}.`);
    const protein = ['salmon', 'lean_beef', 'liver'].find(has);
    return { minutes: has('sweet_potato') ? 45 : 25, steps: out, safety: [SAFE[protein], has('liver') && protein !== 'liver' ? SAFE.liver : null].filter(Boolean).join(' ') };
  }
  if (meal === 'preworkout') {
    out.push(`Greek yogurt ${a('greek_yogurt') ? a('greek_yogurt').serve : ''} with ${a('banana') ? `banana ${a('banana').serve} (${a('banana').prep})` : 'banana'}, sliced in.`, 'Pre-workout drink 30–45 minutes before training (200 mg caffeine — not within 6 hours of bed).');
    return { minutes: 5, steps: out, safety: null };
  }
  if (meal === 'evening') {
    out.push(`Blend: milk ${a('milk') ? `${a('milk').serve} (${a('milk').prep})` : ''}, whey ${a('whey') ? a('whey').serve : ''}, strawberries ${a('strawberries') ? a('strawberries').serve : ''}.`,
      `Walnuts ${a('walnuts') ? `${a('walnuts').serve} (${a('walnuts').prep})` : ''} on the side or blended in.`, 'Take magnesium and ashwagandha with it.');
    return { minutes: 5, steps: out, safety: null };
  }
  return { minutes: 10, steps: items.map(i => `${amount(i).name}: ${amount(i).serve}`), safety: null };
}

/** The whole day's cooking guide. day = a planned day (array of meals with items). */
function guide(day, type) {
  return (day || []).map(m => {
    const items = m.items || [], how = method(m.key, items);
    return { key: m.key, name: m.name, ingredients: items.map(amount), ...how,
      batch: ['lunch', 'dinner'].includes(m.key) ? 'Cooking ahead: meat, fish and vegetables keep 3–4 days in the fridge; rice is best within a day. Multiply the raw amounts by the number of days, then weigh each cooked portion.' : null,
      maidText: ['lunch', 'dinner', 'breakfast'].includes(m.key) ? `${m.name} please: ${items.map(i => { const x = amount(i); return `${x.name.toLowerCase()} ${x.serve}${['chicken_breast', 'lean_beef', 'salmon', 'liver', 'rice', 'sweet_potato'].includes(i.food) ? ` (${x.prep.split(' (')[0].replace('about ', '~')})` : ''}`; }).join(', ')}. Please weigh the cooked amounts.` : null };
  });
}

const api = { amount, method, guide, EGG, BANANA, OIL_TSP };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Cook = api;
})(typeof window !== 'undefined' ? window : globalThis);
