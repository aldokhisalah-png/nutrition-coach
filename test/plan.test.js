const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/plan.js'), N = require('../src/nutrients.js'), DB = require('../src/foods.js');

test('food database: every plan food comes from USDA with a stated state', () => {
  for (const f of DB.foods){ assert.ok(f.fdcId > 0); assert.ok(['raw','cooked','ready'].includes(f.state)); assert.ok(f.per100g.kcal > 0 || f.key === 'cucumber'); }
});
test('missing USDA values are absent, never zero', () => {
  assert.equal(P.FOOD.whey.per100g.leu, undefined);
  assert.equal(P.FOOD.eggs.per100g.iodine, undefined);
});
test('week: Saturday is beef + liver, liver replaces 25 g of beef', () => {
  assert.equal(P.dayType('2026-10-03'), 'beef_liver');              // a Saturday
  const dinner = P.baseDay('beef_liver').find(m => m.key === 'dinner').items;
  assert.deepEqual(dinner.slice(0, 2), [{ food:'lean_beef', grams:95 }, { food:'liver', grams:25 }]);
});
test('base plan is close to 2100 kcal on a salmon day', () => {
  const m = P.dayMacros(P.baseDay('salmon'));
  assert.ok(Math.abs(m.kcal - 2100) < 60, String(m.kcal));
});
test('solver: lower calories reduce rice first, foods never change', () => {
  const s = P.solveDay('beef', { calories:2000, protein:180, carbs:185, fat:60 });
  const rice = s.changes.find(c => c.food === 'rice'); assert.ok(rice && rice.to < 150);
  assert.deepEqual(s.day.map(m => m.items.map(i => i.food)), P.baseDay('beef').map(m => m.items.map(i => i.food)));
  assert.ok(s.ok);
});
test('solver: rice reduction explains itself', () => {
  const s = P.solveDay('beef', { calories:2000, protein:180, carbs:190, fat:60 });
  assert.match(s.changes.find(c => c.food === 'rice').reason, /White rice.*reduced from 150 g to \d+ g to reach \d+ g carbs/);
});
test('solver: big protein gap moves protein foods, not vegetables', () => {
  const s = P.solveDay('salmon', { calories:2300, protein:200, carbs:200, fat:65 });
  assert.ok(s.changes.some(c => c.food === 'chicken_breast'));
  assert.ok(!s.changes.some(c => ['broccoli','spinach','cucumber','red_pepper','blueberries','strawberries','banana'].includes(c.food)));
});
test('MICROS: vitamin D target reached from food + supplement → reached, not rewarded further', () => {
  const t = N.totals(P.itemsOf(P.baseDay('salmon')), P.suppNutrients(P.SUPPLEMENTS));
  const a = N.assess(N.REF_BY_KEY.vitD, t.vitD, {});
  assert.equal(a.status, 'reached'); assert.equal(a.label, 'Target reached');
});
test('magnesium UL counts supplements only', () => {
  const t = N.totals(P.itemsOf(P.baseDay('salmon')), [{ name:'Mg', nutrients:{ magnesium:200 } }]);
  const a = N.assess(N.REF_BY_KEY.magnesium, t.magnesium, {});
  assert.ok(t.magnesium.value > 350); assert.equal(a.ulValue, 200); assert.notEqual(a.status, 'over');
});
test('iodine has no USDA data → Data unavailable', () => {
  const t = N.totals(P.itemsOf(P.baseDay('salmon')), []);
  assert.equal(N.assess(N.REF_BY_KEY.iodine, t.iodine, {}).label, 'Data unavailable');
});
test('amino acids are partial when whey has no data, and say so', () => {
  const t = N.totals(P.itemsOf(P.baseDay('salmon')), []);
  const a = N.assess(N.REF_BY_KEY.leu, t.leu, { weightKg: 84 });
  assert.equal(a.partial, true); assert.match(a.reason, /Whey protein powder/);
});
test('niacin equivalents add tryptophan ÷ 60', () => {
  const t = N.totals([{ name:'x', grams:100, per100g:{ niacin:10, trp:600 } }], []);
  assert.equal(t.niacinNE.value, 20);
});
test('grocery: 7 days aggregate duplicate foods and keep cooked weights', () => {
  const days = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'].map(d => P.baseDay(P.dayType(d)));
  const g = P.grocery(days), dairy = g.find(c => c.category === 'Dairy & eggs').items;
  assert.equal(dairy.find(i => i.food === 'greek_yogurt').grams, 2100);
  const prot = g.find(c => c.category === 'Proteins').items, chicken = prot.find(i => i.food === 'chicken_breast');
  assert.equal(chicken.grams, 1050); assert.equal(chicken.state, 'cooked'); assert.ok(chicken.raw.grams > 1050);
});

test('solver: hits protein, carbs and fat to the gram at 2100 kcal', () => {
  for (const type of ['salmon', 'beef', 'beef_liver']){
    const s = P.solveDay(type, { calories:2100, protein:185, carbs:193, fat:65 });
    assert.ok(s.exact, type);
    for (const k of ['protein', 'carbs', 'fat']) assert.ok(Math.abs(s.off[k]) <= 1.5, `${type} ${k} ${s.off[k]}`);
    assert.ok(Math.abs(s.off.kcal) <= 15, `${type} kcal ${s.off.kcal}`);
  }
});
test("solver: when carbs can't go lower it still hits protein and fat, and says so", () => {
  const s = P.solveDay('salmon', { calories:1800, protein:180, carbs:120, fat:64 });
  assert.equal(s.exact, false); assert.ok(Math.abs(s.off.protein) <= 1.5); assert.ok(Math.abs(s.off.fat) <= 1.5);
  assert.match(s.summary, /Closest practical fit/);
});
