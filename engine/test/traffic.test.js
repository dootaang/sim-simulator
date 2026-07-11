'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../core/createState.js');
const { createRng } = require('../core/rng.js');
const { applyEvent } = require('../core/applyEvent.js');

const legacySchema = JSON.parse(JSON.stringify(schema));
delete legacySchema.traffic.incidents;

function run(state, wave = 'lunch', source = legacySchema) {
  return applyEvent(source, state, { id: 'traffic_wave', params: { wave } }, createRng(999));
}

function incidentSchema(card, chance = 100) {
  const source = JSON.parse(JSON.stringify(legacySchema));
  source.traffic.incidents = { chance, deck: [card] };
  return source;
}

function incident(state, id, params, source) {
  return applyEvent(source, state, { id, params }, createRng(999));
}

test('incident occurrence and card are reproducible for the same seed/day/wave', () => {
  const source = incidentSchema({ id: 'fixed', label: '고정 사건', desc: '설명', weight: 1, choices: [{ id: 'ok', label: '대응', effects: {} }] });
  assert.deepEqual(run(createState(source, 17), 'lunch', source), run(createState(source, 17), 'lunch', source));
});

test('incident pauses wave, stores pending, and guards retry', () => {
  const source = incidentSchema({ id: 'fixed', label: '고정 사건', desc: '설명', weight: 1, choices: [{ id: 'ok', label: '대응', effects: {} }] });
  const rolled = run(createState(source, 1), 'lunch', source);
  assert.equal(rolled.log[0].awaitingChoice, true);
  assert.deepEqual(rolled.state.pendingIncident, { day: 1, waveId: 'lunch', incidentId: 'fixed' });
  assert.equal(rolled.state.traffic, undefined);
  assert.equal(run(rolled.state, 'lunch', source).log[0].reason, 'incident_pending');
});

test('incident choice resolves wave and prevents reroll', () => {
  const source = incidentSchema({ id: 'fixed', label: '고정 사건', weight: 1, choices: [{ id: 'ok', label: '대응', effects: {} }] });
  const rolled = run(createState(source, 1), 'lunch', source);
  const chosen = incident(rolled.state, 'incident_choice', { choice: 'ok' }, source);
  assert.equal(chosen.log[1].wave, 'lunch');
  assert.equal(chosen.state.traffic.resolved.lunch, true);
  assert.equal(chosen.state.pendingIncident, undefined);
  assert.equal(run(chosen.state, 'lunch', source).log[0].reason, 'wave_already_resolved');
});

test('waveMultiplier 0.7 reduces potential versus 1.0', () => {
  const make = (value) => incidentSchema({ id: 'fixed', label: '사건', weight: 1, choices: [{ id: 'pick', label: '선택', effects: { waveMultiplier: value } }] });
  const resolve = (source) => incident(run(createState(source, 5), 'evening', source).state, 'incident_choice', { choice: 'pick' }, source).log[1].potential;
  assert.ok(resolve(make(0.7)) < resolve(make(1)));
});

test('negative incident gold clamps balance at zero', () => {
  const source = incidentSchema({ id: 'cost', label: '비용', weight: 1, choices: [{ id: 'pay', label: '지불', effects: { gold: [-100, -100] } }] });
  const state = createState(source, 2); state.gold = 30;
  const result = incident(run(state, 'lunch', source).state, 'incident_choice', { choice: 'pay' }, source);
  assert.equal(result.state.gold >= 0, true);
  assert.equal(result.log[0].goldShortfall, 70);
});

test('incident requires gate treats missing noble rank as E', () => {
  const noble = { id: 'noble_visit', label: '귀족', weight: 1, requires: { ladderRank: { ladder: 'reputation', axis: 'noble', rank: 'C' } }, choices: [{ id: 'ok', label: '응대', effects: {} }] };
  const fallback = { id: 'common', label: '일반', weight: 1, choices: [{ id: 'ok', label: '응대', effects: {} }] };
  const source = incidentSchema(noble); source.traffic.incidents.deck.push(fallback);
  for (let seed = 1; seed <= 20; seed += 1) assert.notEqual(run(createState(source, seed), 'lunch', source).state.pendingIncident.incidentId, 'noble_visit');
});

test('incident choice gold uses deterministic choice address', () => {
  const source = incidentSchema({ id: 'gold', label: '골드', weight: 1, choices: [{ id: 'roll', label: '굴림', effects: { gold: [-50, 50] } }] });
  const choose = () => incident(run(createState(source, 77), 'lunch', source).state, 'incident_choice', { choice: 'roll' }, source).log[0].goldDelta;
  assert.equal(choose(), choose());
});

test('stale pending incident expires at day boundary', () => {
  const source = incidentSchema({ id: 'fixed', label: '사건', weight: 1, choices: [{ id: 'ok', label: '대응', effects: {} }] }, 0);
  const state = createState(source, 1); state.pendingIncident = { day: 1, waveId: 'lunch', incidentId: 'fixed' }; state.day = 2;
  const result = run(state, 'lunch', source);
  assert.equal(result.state.pendingIncident, undefined);
  assert.equal(result.state.traffic.day, 2);
});

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
  delete source.traffic.incidents;
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

function mail(state, id = 'mail_check', params = {}, source = schema) {
  return applyEvent(source, state, { id, params }, createRng(999));
}

function mailSchema(chance = 100) {
  const source = JSON.parse(JSON.stringify(schema));
  for (const type of ['reward', 'quest']) for (const rank of ['C', 'B', 'A', 'S']) source.traffic.mail.chances[type][rank] = chance;
  return source;
}

test('mail check is reproducible for the same seed and day', () => {
  const source = mailSchema(50);
  const a = createState(source, 42); const b = createState(source, 42);
  for (const state of [a, b]) state.reputation = { zed: { rank: 'A' }, alpha: { rank: 'C' } };
  assert.deepEqual(mail(a, 'mail_check', {}, source).state.mail.letters, mail(b, 'mail_check', {}, source).state.mail.letters);
});

test('mail check rejects a second check on the same day', () => {
  const source = mailSchema(); const first = mail(createState(source, 1), 'mail_check', {}, source);
  assert.equal(mail(first.state, 'mail_check', {}, source).log[0].reason, 'already_checked');
});

test('mail check does not roll ranks E or D when chances are undefined', () => {
  const source = mailSchema(); const state = createState(source, 1);
  state.reputation = { low: { rank: 'E' }, next: { rank: 'D' } };
  assert.deepEqual(mail(state, 'mail_check', {}, source).state.mail.letters, []);
});

test('unopened mail blocks the same axis and type roll on later days', () => {
  const source = mailSchema(); const state = createState(source, 1);
  state.reputation = { guild: { rank: 'C' } };
  const first = mail(state, 'mail_check', {}, source); first.state.day += 1;
  const second = mail(first.state, 'mail_check', {}, source);
  assert.deepEqual(second.state.mail.letters, first.state.mail.letters);
});

test('reward mail gold is in range and deterministic', () => {
  const source = mailSchema(); const state = createState(source, 7);
  state.mail = { checkedDay: 1, letters: [{ id: 'fixed_reward', axis: 'guild', type: 'reward', day: 1 }] };
  const a = mail(state, 'mail_open', { mailId: 'fixed_reward' }, source);
  const b = mail(JSON.parse(JSON.stringify(state)), 'mail_open', { mailId: 'fixed_reward' }, source);
  assert.equal(a.log[0].goldDelta, b.log[0].goldDelta);
  assert.ok(a.log[0].goldDelta >= 30000 && a.log[0].goldDelta <= 80000);
});

test('quest mail opening does not change gold', () => {
  const state = createState(schema, 7); const before = state.gold;
  state.mail = { letters: [{ id: 'fixed_quest', axis: 'guild', type: 'quest', day: 1 }] };
  assert.equal(mail(state, 'mail_open', { mailId: 'fixed_quest' }).state.gold, before);
});

test('opening removes a letter and reopening fails', () => {
  const state = createState(schema, 7);
  state.mail = { letters: [{ id: 'fixed_quest', axis: 'guild', type: 'quest', day: 1 }] };
  const opened = mail(state, 'mail_open', { mailId: 'fixed_quest' });
  assert.deepEqual(opened.state.mail.letters, []);
  assert.equal(mail(opened.state, 'mail_open', { mailId: 'fixed_quest' }).log[0].reason, 'mail_not_found');
});

test('mail-less schema rejects mail check without mutation', () => {
  const source = JSON.parse(JSON.stringify(schema)); delete source.traffic.mail;
  const state = createState(source, 7); const result = mail(state, 'mail_check', {}, source);
  assert.equal(result.log[0].reason, 'mail_not_configured'); assert.equal(result.state, state);
});

test('a pending incident blocks every other wave until resolved', () => {
  const state = createState(schema, 42);
  state.pendingIncident = { day: state.day, waveId: 'lunch', incidentId: 'drunk_brawl' };
  const blocked = run(state, 'evening');
  assert.equal(blocked.log[0].reason, 'incident_pending');
  assert.equal(blocked.log[0].detail, 'lunch');
});

test('unknown required rank never unlocks (fail-closed gate)', () => {
  const source = JSON.parse(JSON.stringify(schema));
  source.traffic.incidents.chance = 100;
  source.traffic.incidents.deck = [{ id: 'ghost', label: '유령', desc: '?', weight: 1,
    requires: { ladderRank: { ladder: 'reputation', axis: 'village', rank: 'X' } },
    choices: [{ id: 'run', label: '도망', effects: {} }] }];
  const state = createState(source, 42);
  const result = run(state, 'lunch', source);
  // 덱이 전부 부적격이면 사건 없이 파동이 그대로 해결된다.
  assert.equal(result.log[0].ok, true);
  assert.equal(result.log[0].awaitingChoice, undefined);
});

test('kitchenFacility binding gates menus for arbitrary facility ids', () => {
  const source = JSON.parse(JSON.stringify(schema));
  source.traffic.kitchenFacility = 'cooking';
  const entity = source.entities.find((entry) => entry.type === 'menuItem');
  entity.instances = [{ name: '고급 요리', category: '요리', price: 20000, requiresKitchenLevel: 2, consumes: { food: 1 } }];
  const locked = createState(source, 42);
  locked.facilities.cooking = 1;
  const lockedRun = run(locked, 'lunch', source);
  assert.equal(lockedRun.log[0].served, 0); // 바인딩 시설 Lv1 → Lv2 메뉴 잠김
  const open = createState(source, 42);
  open.facilities.cooking = 2;
  const openRun = run(open, 'lunch', source);
  assert.ok(openRun.log[0].served > 0); // 바인딩 시설 Lv2 → 판매
});

test('roomFacility binding gates lodging demand level', () => {
  const source = JSON.parse(JSON.stringify(schema));
  source.traffic.lodging.roomFacility = 'guestroom';
  source.traffic.lodging.base = [[0, 0], [0, 0], [9, 9], [9, 9]];
  const low = createState(source, 42);
  low.facilities.guestroom = 1;
  assert.equal(lodging(low, 'lodging_review', {}, source).state.lodging.requests.length, 0);
  const high = createState(source, 42);
  high.facilities.guestroom = 3;
  assert.ok(lodging(high, 'lodging_review', {}, source).state.lodging.requests.length > 0);
});
