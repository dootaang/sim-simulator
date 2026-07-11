'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchema } = require('../src/schema/validate.js');
const innSchema = require('../../schema/yongsa-inn.v0.json');

function base(extra = {}) {
  return Object.assign({
    meta: { id: 'combat-test', title: '전투 테스트', schemaVersion: '0.1' },
    resources: [], scales: [], ladders: [], entities: [], events: [],
  }, extra);
}

function errors(result) {
  return result.issues.filter((issue) => issue.level === 'error');
}

test('valid pools, combat, and skills produce zero errors', () => {
  const result = validateSchema(base({
    pools: [{ id: 'hp', label: '체력', max: 100 }],
    combat: { d: 20, minDamage: 1, critMult: 2, guardMult: 0.5, fleeRate: 50, expTable: { E: [1, 2] }, lootGold: { default: [3, 4] } },
    skills: { slash: { name: '베기', cost: 0, pool: 'sp', power: 3, acc: 1 } },
    initialState: { player: { pools: { hp: { cur: 100, max: 100 } } } },
  }));
  assert.deepEqual(errors(result), []);
});

test('menu trade keeps sell and buy but removes invalid values with a warning', () => {
  const menu = { type: 'menuItem', fields: ['name', 'category', 'grade', 'price', 'requiresKitchenLevel', 'consumes'], instances: [
    { name: '판매', category: '', grade: 'E', price: 1, requiresKitchenLevel: 1, consumes: {}, trade: 'sell' },
    { name: '구매', category: '', grade: 'E', price: 1, requiresKitchenLevel: 1, consumes: {}, trade: 'buy' },
    { name: '오류', category: '', grade: 'E', price: 1, requiresKitchenLevel: 1, consumes: {}, trade: 'both' },
  ] };
  const result = validateSchema(base({ entities: [menu] }));
  assert.equal(result.schema.entities[0].instances[0].trade, 'sell');
  assert.equal(result.schema.entities[0].instances[1].trade, 'buy');
  assert.equal(result.schema.entities[0].instances[2].trade, undefined);
  assert.ok(result.issues.some((issue) => issue.path.includes('.trade')));
});

test('review-shaped menu items default optional fields and keep independent consumes objects', () => {
  const menu = { type: 'menuItem', fields: ['name', 'category', 'price', 'trade', 'desc', 'requiresKitchenLevel'], instances: [
    { name: '전술인형 계약', category: '상점', price: 100, trade: 'buy', desc: '실측 추가 필드', requiresKitchenLevel: 1 },
    { name: '장비 계약', category: '상점', price: 50, trade: 'sell', desc: '보존 대상', requiresKitchenLevel: 2 },
  ] };
  const result = validateSchema(base({ entities: [menu] }));
  const [first, second] = result.schema.entities[0].instances;
  assert.deepEqual(errors(result), []);
  assert.equal(first.grade, '');
  assert.deepEqual(first.consumes, {});
  assert.equal(first.trade, 'buy');
  assert.equal(first.desc, '실측 추가 필드');
  first.consumes.ammo = 1;
  assert.deepEqual(second.consumes, {});
  assert.equal(result.issues.filter((issue) => issue.path === 'entities[0].fields').length, 1);
  assert.match(result.issues.find((issue) => issue.path === 'entities[0].fields').msg, /grade, consumes 누락/);
});

test('menu item name and price remain required', () => {
  const fields = ['name', 'category', 'grade', 'price', 'requiresKitchenLevel', 'consumes'];
  const result = validateSchema(base({ entities: [{ type: 'menuItem', fields, instances: [
    { category: '', grade: '', price: 1, requiresKitchenLevel: 1, consumes: {} },
    { name: '가격 없음', category: '', grade: '', requiresKitchenLevel: 1, consumes: {} },
  ] }] }));
  assert.ok(errors(result).some((issue) => issue.path.endsWith('instances[0].name')));
  assert.ok(errors(result).some((issue) => issue.path.endsWith('instances[1].price')));
});

test('inn schema remains error-free without menu item normalization warnings', () => {
  const result = validateSchema(innSchema);
  assert.deepEqual(errors(result), []);
  assert.equal(result.issues.some((issue) => issue.path.endsWith('.fields') && issue.msg.includes('선택 필드')), false);
});

test('single _hp pool is normalized to hp with initial state key and warning', () => {
  const result = validateSchema(base({
    pools: [{ id: 'unit_hp', label: '유닛 체력', max: 30 }],
    combat: {},
    initialState: { player: { pools: { unit_hp: { cur: 20, max: 30 } } } },
  }));
  assert.deepEqual(result.schema.pools, [{ id: 'hp', label: '유닛 체력', max: 30 }]);
  assert.deepEqual(result.schema.initialState.player.pools, { hp: { cur: 20, max: 30 } });
  assert.ok(result.issues.some((issue) => issue.level === 'warn' && issue.msg === "플레이어 생명 풀 'unit_hp'를 'hp'로 정규화했습니다(엔진 전투는 hp id를 사용)."));
});

test('multiple _hp pools are not guessed and produce a strong warning', () => {
  const result = validateSchema(base({
    pools: [{ id: 'commander_hp', max: 3 }, { id: 'doll_hp', max: 5 }],
    combat: {},
    initialState: { player: { pools: { commander_hp: { cur: 3, max: 3 }, doll_hp: { cur: 5, max: 5 } } } },
  }));
  assert.deepEqual(result.schema.pools.map((pool) => pool.id), ['commander_hp', 'doll_hp']);
  assert.equal(result.schema.initialState.player.pools.hp, undefined);
  assert.ok(result.issues.some((issue) => issue.level === 'warn' && issue.msg.includes("전투 시작이 거부됩니다")));
});

test('existing hp pool is unchanged without hp contract warning', () => {
  const input = base({
    pools: [{ id: 'hp', label: '체력', max: 100 }],
    combat: {},
    initialState: { player: { pools: { hp: { cur: 75, max: 100 } } } },
  });
  const result = validateSchema(input);
  assert.deepEqual(result.schema.pools, input.pools);
  assert.deepEqual(result.schema.initialState, input.initialState);
  assert.equal(result.issues.some((issue) => issue.path === 'pools' && /hp.*(정규화|없습니다)/.test(issue.msg)), false);
});

test('player hp/mp/sp scales are promoted and initialized', () => {
  const result = validateSchema(base({ scales: [
    { id: 'hp', owner: 'player', range: [0, 120], default: 100 },
    { id: 'mana', owner: 'player', range: [0, 80], default: 60 },
    { id: 'stamina', owner: 'player', range: [0, 70], default: 50 },
  ] }));
  assert.deepEqual(result.schema.pools.map((pool) => [pool.id, pool.max]), [['hp', 100], ['mp', 60], ['sp', 50]]);
  assert.equal(result.schema.scales.length, 0);
  assert.equal(result.schema.initialState.player.pools.mp.cur, 60);
  assert.ok(result.issues.some((issue) => issue.level === 'warn' && /scales에서 pools로 승격/.test(issue.msg)));
});

test('review-shaped hunter schema promotes pools with zero errors and remains combat capable', () => {
  const tier = { range: [1, 20], label: 'E', brief: '초급' };
  const result = validateSchema(base({ scales: [
    { id: 'HP', owner: 'player', range: [0, 130], default: 130 },
    { id: 'MP', owner: 'player', range: [0, 150], default: 150 },
    { id: 'SP', owner: 'player', range: [0, 100], default: 100 },
    { id: 'strength', owner: 'player', range: [1, 99], default: 12, tiers: [tier] },
    { id: 'sense', owner: 'player', range: [1, 99], default: 11, tiers: [tier] },
  ] }));
  assert.deepEqual(errors(result), []);
  assert.deepEqual(result.schema.pools.map((pool) => pool.id), ['hp', 'mp', 'sp']);
  assert.ok(result.schema.pools || result.schema.combat);
  assert.deepEqual(result.schema.scales.map((scale) => scale.id), ['strength', 'sense']);
});

test('invalid combat values are warnings and are removed for engine defaults', () => {
  const result = validateSchema(base({ combat: { critMult: 'x', expTable: { E: 'broken', D: [4, 2], C: [1, 3] } } }));
  assert.deepEqual(errors(result), []);
  assert.equal(result.schema.combat.critMult, undefined);
  assert.deepEqual(result.schema.combat.expTable, { C: [1, 3] });
  assert.ok(result.issues.filter((issue) => issue.level === 'warn').length >= 3);
});

test('player level thresholds remove leading zero and non-increasing values', () => {
  const result = validateSchema(base({ ladders: [{ id: 'player_level', currency: 'exp', sources: {}, thresholds: [0, 100, 100, 200, 'bad'] }] }));
  assert.deepEqual(result.schema.ladders[0].thresholds, [100, 200]);
  assert.ok(result.issues.some((issue) => issue.level === 'warn' && issue.path.endsWith('.thresholds')));
});

test('skill acc outside d20 modifier range resets to zero while valid acc stays', () => {
  const result = validateSchema(base({ skills: {
    percentLike: { cost: 2, pool: 'mp', power: 9, acc: 100 },
    valid: { cost: 3, pool: 'sp', power: 7, acc: 5 },
  } }));
  assert.equal(result.schema.skills.percentLike.acc, 0);
  assert.equal(result.schema.skills.percentLike.power, 9);
  assert.equal(result.schema.skills.valid.acc, 5);
  assert.ok(result.issues.some((issue) => issue.level === 'warn' && issue.path === 'skills.percentLike.acc'));
});

test('resource effects normalize valid amounts and remove invalid effects', () => {
  const result = validateSchema(base({ resources: [
    { id: 'ok', unit: '개', min: 0, effect: { pool: 'hp', amount: '40' } },
    { id: 'bad-pool', unit: '개', min: 0, effect: { pool: 'gold', amount: 10 } },
    { id: 'bad-amount', unit: '개', min: 0, effect: { pool: 'mp', amount: 0 } },
  ] }));
  assert.deepEqual(result.schema.resources[0].effect, { pool: 'hp', amount: 40 });
  assert.equal(result.schema.resources[1].effect, undefined);
  assert.equal(result.schema.resources[2].effect, undefined);
  assert.equal(result.issues.filter((issue) => issue.path.endsWith('.effect')).length, 2);
});
