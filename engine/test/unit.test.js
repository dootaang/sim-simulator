'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createRng } = require('../core/rng.js');
const { createState } = require('../core/createState.js');
const { applyEvent } = require('../core/applyEvent.js');
const { staffMax, availableMenu, availableManagement, summarize } = require('../core/selectors.js');
const { deepFreeze } = require('./helpers.js');

function event(state, id, params = {}) {
  return applyEvent(schema, state, { id, params }, createRng(42));
}

test('full room checkin is rejected without throwing or mutating', () => {
  let state = createState(schema);
  state = event(state, 'checkin', { roomNo: 106, guestName: 'a', stayDays: 1 }).state;
  const before = JSON.stringify(state);
  const result = event(state, 'checkin', { roomNo: 106, guestName: 'b', stayDays: 1 });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'room_full');
  assert.equal(result.state, state);
  assert.equal(JSON.stringify(state), before);
});

test('buy_item is schema-priced, inventory-backed, guarded, and consumes no rng', () => {
  const shop = JSON.parse(JSON.stringify(schema));
  const menus = shop.entities.find((entry) => entry.type === 'menuItem').instances;
  menus.push({ name: '서약반지', category: '보급품', grade: 'S', price: 30000, requiresKitchenLevel: 1, consumes: {}, trade: 'buy' });
  let state = createState(shop);
  let rngCalls = 0;
  const rng = { int() { rngCalls += 1; return 1; } };
  const bought = applyEvent(shop, state, { id: 'buy_item', params: { menuName: '서약반지', qty: 2 } }, rng);
  assert.equal(bought.state.gold, state.gold - 60000);
  assert.equal(bought.state.items['서약반지'], 2);
  assert.equal(bought.log[0].owned, 2);
  assert.equal(rngCalls, 0);
  assert.equal(applyEvent(shop, state, { id: 'buy_item', params: { menuName: '서약반지', qty: 1, price: 1 } }, rng).log[0].reason, 'item_number_not_allowed');
  assert.equal(applyEvent(shop, state, { id: 'sale', params: { menuName: '서약반지', qty: 1 } }, rng).log[0].reason, 'menu_not_sellable');
  assert.equal(applyEvent(shop, state, { id: 'buy_item', params: { menuName: '고기 스튜' } }, rng).log[0].reason, 'menu_not_buyable');
  assert.equal(rngCalls, 0);
  state = bought.state;
  assert.match(summarize(shop, state), /\[소지품\] 서약반지 ×2/);
  assert.deepEqual(availableManagement(shop, state).sections.map((section) => section.type), ['traffic', 'sell', 'buy', 'purchase', 'upgrade', 'gather', 'day_end']);
  state.combat = { active: true };
  assert.deepEqual(availableManagement(shop, state), { sections: [] });
});

test('locked menu above kitchen level is rejected', () => {
  const state = createState(schema);
  const result = event(state, 'sale', { menuName: '허브 로스트', qty: 1 });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'menu_locked');
  assert.equal(result.state, state);
});

test('manual sale rejects entire order when stock is short', () => {
  const state = createState(schema);
  state.resources.food = 1;
  const result = event(state, 'sale', { menuName: '고기 스튜', qty: 2 });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'insufficient_stock');
  assert.equal(result.state.resources.food, 1);
  assert.equal(result.state.gold, 500000);
});

test('staffMax blocks hire beyond quarters capacity', () => {
  let state = createState(schema);
  assert.equal(staffMax(schema, state), 1);
  state = event(state, 'hire', { npcId: 'silvia', dailyWage: 100000 }).state;
  const result = event(state, 'hire', { npcId: 'mierian', dailyWage: 100000 });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'staff_full');
  assert.equal(result.state.staff.length, 1);
});

test('purchase and resource_delta clamp resources and gold', () => {
  let state = createState(schema);
  state = event(state, 'purchase', { resource: 'food', qty: 2 }).state;
  assert.equal(state.gold, 494000);
  assert.equal(state.resources.food, 22);
  state = event(state, 'resource_delta', { resource: 'food', amount: -1000 }).state;
  assert.equal(state.resources.food, 0);
  state = event(state, 'gold_delta', { amount: -999999 }).state;
  assert.equal(state.gold, 0);
});

test('exp_gain uses seeded ranges and carries overflow across level thresholds', () => {
  let state = createState(schema);
  state.player.exp = 95;
  const result = event(state, 'exp_gain', { category: '메뉴/장비 개발' });
  assert.equal(result.log[0].ok, true);
  assert.equal(result.log[0].amount, 6);
  assert.deepEqual(result.state.player, { level: 2, exp: 1 });
});

test('checkout and fire reject missing targets', () => {
  let result = event(createState(schema), 'checkout', { roomNo: 106, guestName: 'none' });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'guest_not_found');

  result = event(createState(schema), 'fire', { npcId: 'silvia' });
  assert.equal(result.log[0].ok, false);
  assert.equal(result.log[0].reason, 'not_hired');
});

test('availableMenu respects kitchen level gates', () => {
  const state = createState(schema);
  const levelOne = availableMenu(schema, state);
  assert.ok(levelOne.some((item) => item.name === '고기 스튜'));
  assert.equal(levelOne.some((item) => item.name === '허브 로스트'), false);
  state.facilities.kitchen = 2;
  assert.equal(availableMenu(schema, state).some((item) => item.name === '허브 로스트'), true);
});

test('management lists follow state resources, hide menu duplicates, and summarize non-inn facilities', () => {
  const shop = {
    resources: [
      { id: 'res', basePrice: 10 }, { id: 'part', basePrice: 20 },
      { id: 'ring', label: '서약반지', basePrice: 999 }, { id: 'unused', basePrice: 30 },
    ],
    entities: [
      { type: 'menuItem', instances: [{ name: '서약반지', price: 300, trade: 'buy' }] },
      { type: 'facility', instances: [{ id: 'training', label: '훈련 시설' }, { id: 'defense', label: '방위 시설' }] },
    ],
    gather: { small: [1, 2] },
  };
  const state = { gold: 1000, resources: { res: 1, part: 2 }, facilities: { training: 2 } };
  const sections = availableManagement(shop, state).sections;
  assert.deepEqual(sections.find((section) => section.type === 'gather').resources, ['res', 'part']);
  assert.deepEqual(sections.find((section) => section.type === 'purchase').items.map((item) => item.id), ['res', 'part', 'unused']);
  // [자원] 줄은 자원 수량도 함께 표기한다(M9a.1 — 정산으로 불어난 자원 가시화).
  assert.equal(summarize(shop, state), '[자원] 골드 1,000원 · res 1 · part 2\n[시설] 훈련 시설 Lv.2 · 방위 시설 Lv.1');
});

test('frozen failed state remains intact', () => {
  const state = createState(schema);
  const before = JSON.stringify(state);
  deepFreeze(state);
  const result = event(state, 'sale', { menuName: '허브 로스트', qty: 1 });
  assert.equal(result.log[0].ok, false);
  assert.equal(JSON.stringify(state), before);
});
