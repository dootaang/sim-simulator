'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inn = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../core/createState.js');
const { createRng } = require('../core/rng.js');
const { runDayEnd } = require('../core/dayEnd.js');

function schema(settlement) {
  return { resources: [{ id: 'res' }], settlement };
}

function state() {
  return { day: 1, gold: 100, resources: { res: 0 }, facilities: { base4: 4, base5: 2 }, staff: [], rooms: {}, npcs: {}, player: { pools: { hp: { cur: 20, max: 100 }, mp: { cur: 45, max: 50 } } } };
}

test('facility yields use exact/fallback/range and skip undeclared resources', () => {
  const result = runDayEnd(schema([
    { type: 'facility_yield', facility: 'base4', resource: 'res', perLevel: { 2: 600, 4: [10, 20] } },
    { type: 'facility_yield', facility: 'base5', gold: true, perLevel: { 1: 30 } },
    { type: 'facility_yield', facility: 'base4', resource: 'missing', perLevel: { 1: 99 } },
  ]), state(), createRng(42));
  assert.equal(result.state.resources.res, result.report.settlement[0].amount);
  assert.equal(result.report.settlement[1].amount, 30);
  assert.equal(result.report.settlement[2].skipped, 'unknown_resource');
});

test('pool recovery precedence, clamp, missing pool, and upkeep shortfall', () => {
  const input = state(); input.gold = 40;
  const result = runDayEnd(schema([
    { type: 'pool_recover', pools: ['hp'], facility: 'base5', perLevel: { 1: 10, 2: 20 }, amount: 90, ratio: 1 },
    { type: 'pool_recover', pools: ['mp', 'missing'], amount: 10, ratio: 1 },
    { type: 'pool_recover', pools: ['hp'], ratio: 0.5 },
    { type: 'upkeep', gold: 100 },
  ]), input, createRng(42));
  assert.deepEqual(result.report.settlement[0].pools[0], { id: 'hp', healed: 20, cur: 40, max: 100 });
  assert.deepEqual(result.report.settlement[1].pools, [{ id: 'mp', healed: 5, cur: 50, max: 50 }]);
  assert.equal(result.state.player.pools.hp.cur, 90);
  assert.deepEqual(result.report.settlement[3], { type: 'upkeep', gold: 100, paid: 40, shortfall: 60 });
});

test('only ranged yields consume rng in step order and same seed reproduces', () => {
  const steps = [
    { type: 'pool_recover', pools: ['hp'], amount: 1 },
    { type: 'facility_yield', facility: 'base4', resource: 'res', perLevel: { 4: [1, 100] } },
    { type: 'upkeep', gold: 1 },
    { type: 'facility_yield', facility: 'base4', gold: true, perLevel: { 4: [1, 100] } },
  ];
  const a = runDayEnd(schema(steps), state(), createRng(77));
  const b = runDayEnd(schema(steps), state(), createRng(77));
  const raw = createRng(77);
  assert.equal(a.report.settlement[1].amount, raw.int(1, 100));
  assert.equal(a.report.settlement[3].amount, raw.int(1, 100));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('legacy inn dayEnd report and state remain byte-identical without settlement', () => {
  const original = JSON.parse(JSON.stringify(inn));
  const stateA = createState(original);
  const stateB = createState(inn);
  const a = runDayEnd(original, stateA, createRng(42));
  const b = runDayEnd(inn, stateB, createRng(42));
  assert.equal(Object.hasOwn(a.report, 'settlement'), false);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
