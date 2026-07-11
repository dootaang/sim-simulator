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

function lodging(state, id = 'lodging_review', params = {}, source = schema) {
  return applyEvent(source, state, { id, params }, createRng(999));
}

test('lodging review is reproducible for the same seed and day', () => {
  const a = lodging(createState(schema, 42));
  const b = lodging(createState(schema, 42));
  assert.deepEqual(a.state.lodging.requests, b.state.lodging.requests);
});

test('lodging review rejects a second review on the same day', () => {
  const first = lodging(createState(schema, 42));
  assert.equal(lodging(first.state).log[0].reason, 'already_reviewed');
});

test('lodging review on a new day replaces prior pending requests', () => {
  const first = lodging(createState(schema, 42));
  const priorIds = first.state.lodging.requests.map((item) => item.id);
  first.state.day = 2;
  const second = lodging(first.state);
  assert.ok(second.state.lodging.requests.every((item) => item.id.startsWith('req_2_')));
  assert.ok(second.state.lodging.requests.every((item) => !priorIds.includes(item.id)));
});

test('lodging segment eligibility gates noble by room level and rank', () => {
  const lowSchema = JSON.parse(JSON.stringify(schema));
  lowSchema.traffic.lodging.base = [[20, 20], [20, 20], [20, 20]];
  const low = createState(lowSchema, 1);
  assert.ok(lodging(low, 'lodging_review', {}, lowSchema).state.lodging.requests.every((item) => item.segment !== 'noble'));
  let appeared = false;
  for (let seed = 1; seed <= 30 && !appeared; seed += 1) {
    const high = createState(lowSchema, seed);
    high.facilities.room = 3;
    high.reputation.noble = { rank: 'C', exp: 0 };
    appeared = lodging(high, 'lodging_review', {}, lowSchema).state.lodging.requests.some((item) => item.segment === 'noble');
  }
  assert.equal(appeared, true);
});

test('lodging accept prepays per guest and occupies the selected room', () => {
  const reviewed = lodging(createState(schema, 42));
  const request = reviewed.state.lodging.requests[0];
  const before = reviewed.state.gold;
  const accepted = lodging(reviewed.state, 'lodging_accept', { requestId: request.id });
  assert.equal(accepted.log[0].goldDelta, 30000 * request.stayDays * request.party);
  assert.equal(accepted.state.gold - before, accepted.log[0].goldDelta);
  assert.equal(accepted.state.rooms['101'].length, request.party);
});

test('lodging accept keeps request pending when no room is available', () => {
  const source = JSON.parse(JSON.stringify(schema));
  for (const room of source.entities.find((item) => item.type === 'room').instances) room.capacity = 1;
  const reviewed = lodging(createState(source, 42), 'lodging_review', {}, source);
  const request = reviewed.state.lodging.requests[0];
  for (const room of source.entities.find((item) => item.type === 'room').instances) reviewed.state.rooms[String(room.no)] = [{ guestName: 'full', nightsLeft: 1 }];
  const result = lodging(reviewed.state, 'lodging_accept', { requestId: request.id }, source);
  assert.equal(result.log[0].reason, 'no_room_available');
  assert.equal(reviewed.state.lodging.requests[0].status, 'pending');
});

test('lodging reject prevents later acceptance', () => {
  const reviewed = lodging(createState(schema, 42));
  const request = reviewed.state.lodging.requests[0];
  const rejected = lodging(reviewed.state, 'lodging_reject', { requestId: request.id });
  assert.equal(lodging(rejected.state, 'lodging_accept', { requestId: request.id }).log[0].reason, 'request_not_pending');
});

test('accepted lodging guests follow day-end nightsLeft decrement', () => {
  const reviewed = lodging(createState(schema, 42));
  const request = reviewed.state.lodging.requests[0];
  request.stayDays = 2;
  const accepted = lodging(reviewed.state, 'lodging_accept', { requestId: request.id });
  const ended = applyEvent(schema, accepted.state, { id: 'day_end', params: {} }, createRng(1));
  assert.ok(ended.state.rooms['101'].every((guest) => guest.nightsLeft === 1));
});
