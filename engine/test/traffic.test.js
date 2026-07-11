'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../core/createState.js');
const { createRng } = require('../core/rng.js');
const { applyEvent } = require('../core/applyEvent.js');

function run(state, wave = 'lunch', source = schema) {
  return applyEvent(source, state, { id: 'traffic_wave', params: { wave } }, createRng(999));
}

test('traffic wave is reproducible by addressed seed/day/wave and independent of shared rng', () => {
  const a = run(createState(schema, 42));
  const b = applyEvent(schema, createState(schema, 42), { id: 'traffic_wave', params: { wave: 'lunch' } }, createRng(123));
  assert.deepEqual(a, b);
  const later = createState(schema, 42);
  later.day = 2;
  assert.notDeepEqual(run(later).log[0].sales, a.log[0].sales);
});

test('traffic guards combat, unknown and duplicate waves', () => {
  const combat = createState(schema, 42);
  combat.combat = { active: true };
  assert.equal(run(combat).log[0].reason, 'in_combat');
  assert.equal(run(createState(schema, 42), 'missing').log[0].reason, 'unknown_wave');
  const first = run(createState(schema, 42));
  assert.equal(run(first.state).log[0].reason, 'wave_already_resolved');
});

test('stockout records loss without negative resources and revenue matches sales', () => {
  const state = createState(schema, 42);
  state.resources.food = 1;
  state.resources.drink = 0;
  const result = run(state, 'evening');
  assert.ok(result.log.some((entry) => entry.lostStockout > 0));
  assert.ok(Object.values(result.state.resources).every((value) => value >= 0));
  assert.equal(result.state.gold - state.gold, result.log[0].sales.reduce((sum, sale) => sum + sale.subtotal, 0));
});

test('capacity loss and reputation modifier are observable', () => {
  const high = createState(schema, 42);
  high.facilities.tavern = 1;
  high.staff = [{}, {}, {}, {}];
  high.reputation.village = { rank: 'S', exp: 0 };
  const boosted = run(high, 'evening');
  assert.ok(boosted.log.some((entry) => entry.lostCapacity > 0));
  const base = createState(schema, 42);
  assert.ok(boosted.log[0].potential >= run(base, 'evening').log[0].potential);
});

test('reputation rank alone never decreases potential (isolated variable)', () => {
  const low = createState(schema, 42);
  low.reputation.village = { rank: 'E', exp: 0 };
  const high = createState(schema, 42);
  high.reputation.village = { rank: 'S', exp: 0 };
  assert.ok(run(high, 'evening').log[0].potential >= run(low, 'evening').log[0].potential);
});

test('day change resets resolved waves', () => {
  const first = run(createState(schema, 42));
  assert.equal(run(first.state).log[0].reason, 'wave_already_resolved');
  const nextDay = first.state;
  nextDay.day = 2;
  const again = run(nextDay);
  assert.equal(again.log[0].ok, true);
  assert.equal(again.state.traffic.day, 2);
  assert.deepEqual(Object.keys(again.state.traffic.resolved), ['lunch']);
});

test('missing sells entity resolves without crash and without gold', () => {
  const source = JSON.parse(JSON.stringify(schema));
  delete source.traffic.sells;
  const state = createState(source, 42);
  const result = run(state, 'lunch', source);
  assert.equal(result.log[0].ok, true);
  assert.equal(result.log[0].served, 0);
  assert.equal(result.state.gold, state.gold);
});

test('menu without consumes still burns category ingredients (no free money)', () => {
  const source = JSON.parse(JSON.stringify(schema));
  const entity = source.entities.find((entry) => entry.type === 'menuItem');
  entity.instances = [{ name: '유령 스튜', category: '요리', price: 10000, requiresKitchenLevel: 1 }];
  const state = createState(source, 42);
  const before = state.resources.food;
  const result = run(state, 'lunch', source);
  if (result.log[0].served > 0) assert.ok(result.state.resources.food < before);
});

test('zero-priced item does not break the weighted roll', () => {
  const source = JSON.parse(JSON.stringify(schema));
  const entity = source.entities.find((entry) => entry.type === 'menuItem');
  entity.instances = [
    { name: '공짜 물', category: '주류', price: 0, requiresKitchenLevel: 1, consumes: { drink: 1 } },
    { name: '에일', category: '주류', price: 5000, requiresKitchenLevel: 1, consumes: { drink: 1 } },
  ];
  const state = createState(source, 42);
  const result = run(state, 'evening', source);
  assert.equal(result.log[0].ok, true);
  const summary = result.log[0];
  assert.ok(Number.isFinite(summary.revenue));
  assert.equal(result.state.gold - state.gold, summary.sales.reduce((sum, sale) => sum + sale.subtotal, 0));
});

test('traffic-less schema rejects traffic wave without mutation', () => {
  const source = JSON.parse(JSON.stringify(schema));
  delete source.traffic;
  const state = createState(source, 42);
  const result = run(state, 'lunch', source);
  assert.equal(result.log[0].reason, 'traffic_not_configured');
  assert.equal(result.state, state);
});
