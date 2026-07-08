'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createRng } = require('../core/rng.js');
const { createState } = require('../core/createState.js');
const { applyEvent } = require('../core/applyEvent.js');
const { staffMax, availableMenu } = require('../core/selectors.js');
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

test('frozen failed state remains intact', () => {
  const state = createState(schema);
  const before = JSON.stringify(state);
  deepFreeze(state);
  const result = event(state, 'sale', { menuName: '허브 로스트', qty: 1 });
  assert.equal(result.log[0].ok, false);
  assert.equal(JSON.stringify(state), before);
});
