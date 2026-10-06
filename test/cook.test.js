const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/plan.js'), C = require('../src/cook.js');

test('cook guide: one card per meal, in plan order', () => {
  const g = C.guide(P.baseDay('salmon'));
  assert.deepEqual(g.map(m => m.key), ['breakfast', 'lunch', 'preworkout', 'dinner', 'evening']);
});
test('cooked weights become raw amounts with the app\'s own factors', () => {
  const lunch = C.guide(P.baseDay('beef')).find(m => m.key === 'lunch');
  const chicken = lunch.ingredients.find(i => i.name === 'Chicken breast'), rice = lunch.ingredients.find(i => i.name === 'White rice');
  assert.equal(chicken.serve, '150 g cooked');
  assert.match(chicken.prep, /about 200 g raw/);                       // 150 / 0.75
  assert.match(rice.prep, /^50 g dry rice \+ about 105 ml water$/);      // 150 / 2.9 ≈ 52 → 50
  assert.ok(lunch.steps.some(s => /Weigh out 150 g cooked/.test(s)) && /74°C/.test(lunch.safety));
});
test('Saturday dinner: beef and liver each get raw amounts and their own safe temperature', () => {
  const d = C.guide(P.baseDay('beef_liver')).find(m => m.key === 'dinner');
  assert.match(d.ingredients.find(i => i.name === 'Lean beef').prep, /about 125 g raw/);
  assert.match(d.ingredients.find(i => i.name === 'Beef liver').prep, /about 30 g raw/);
  assert.match(d.safety, /63°C/); assert.match(d.safety, /Liver: cook to 71°C/);
});
test('household measures: eggs, oil, milk, banana, walnuts', () => {
  const g = C.guide(P.baseDay('salmon'));
  const ing = k => g.flatMap(m => m.ingredients).find(i => i.name === k);
  assert.match(ing('Eggs').prep, /^3 large eggs/);
  assert.match(ing('Olive oil').prep, /^2\.2 tsp/);
  assert.match(ing('Milk (2%)').prep, /^250 ml$/);
  assert.match(ing('Banana').prep, /about 1 medium banana$/);
  assert.match(ing('Walnuts').prep, /about 8 halves/);
});
test('amounts follow the plan: a scaled plan scales every measurement', () => {
  const day = P.baseDay('salmon').map(m => m.key === 'dinner' ? { ...m, items: m.items.map(i => ({ ...i, grams: i.grams * 2 })) } : m);
  const d = C.guide(day).find(m => m.key === 'dinner');
  assert.equal(d.ingredients.find(i => i.name === 'Salmon').serve, '240 g cooked');
  assert.match(d.ingredients.find(i => i.name === 'Salmon').prep, /about 300 g raw/);   // 240 / 0.8
  assert.match(d.maidText, /^Dinner please: salmon 240 g cooked \(~300 g raw\)/);
});
