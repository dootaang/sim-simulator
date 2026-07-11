'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchema } = require('../src/schema/validate.js');

// 컴파일러가 실제로 내는 형태를 축약한 여관형 스키마 (traffic 없음, lv_* 시설 id).
function compiledInnLike() {
  return {
    meta: { id: 'inn', title: 'inn', schemaVersion: '0.1' },
    resources: [{ id: 'food', unit: '인분', min: 0 }, { id: 'drink', unit: '잔', min: 0 }],
    scales: [],
    ladders: [{
      id: 'reputation',
      axes: ['rep_village', 'rep_noble'],
      axisLabels: { rep_village: '마을 평판', rep_noble: '귀족 평판' },
      ranks: [{ id: 'E', next: 100 }, { id: 'D', next: 300 }, { id: 'C', next: 800 }, { id: 'B', next: 2000 }, { id: 'A', next: 5000 }, { id: 'S', next: null }],
      onPromote: 'resetExp',
      onNegative: 'demoteBorrow',
      categories: { rep_village: { minor_help: [3, 5] }, rep_noble: { minor_noble: [3, 10] } },
    }],
    entities: [
      { type: 'room', fields: ['no', 'kind', 'pricePerNight', 'capacity', 'requiresRoomLevel'], instances: [
        { no: 101, kind: '다인실', pricePerNight: 30000, capacity: null, requiresRoomLevel: 1 },
      ] },
      { type: 'menuItem', fields: ['name', 'category', 'grade', 'price', 'requiresKitchenLevel', 'consumes'], instances: [
        { name: '빵', category: '요리', grade: 'E', price: 5000, requiresKitchenLevel: 1, consumes: { food: 1 } },
      ] },
      { type: 'facility', fields: ['id', 'label', 'maxLevel'], instances: [
        { id: 'lv_tavern', label: '주점 홀', maxLevel: 4 },
        { id: 'lv_kitchen', label: '주방', maxLevel: 4 },
        { id: 'lv_room', label: '객실', maxLevel: 4 },
      ] },
    ],
    formulas: [{ id: 'daily_revenue', baseline: {
      1: { cap: 15, customers: [8, 15] }, 2: { cap: 30, customers: [15, 30] },
    } }],
    events: [{ id: 'sale', params: {} }],
    initialState: { day: 1, gold: 100000, facilities: { lv_tavern: 1, lv_kitchen: 1, lv_room: 1 } },
  };
}

test('lv_ facility ids are normalized and references remapped', () => {
  const { schema } = validateSchema(compiledInnLike());
  const ids = schema.entities.find((entry) => entry.type === 'facility').instances.map((item) => item.id);
  assert.deepEqual(ids, ['tavern', 'kitchen', 'room']);
  assert.deepEqual(Object.keys(schema.initialState.facilities).sort(), ['kitchen', 'room', 'tavern']);
});

test('inn-like schema without traffic gets a synthesized module', () => {
  const { schema, issues } = validateSchema(compiledInnLike());
  assert.ok(schema.traffic, 'traffic must be synthesized');
  assert.equal(schema.traffic.capacityFacility, 'tavern');
  // 기준표는 컴파일러 formula(baseline)에서 흡수한다.
  assert.deepEqual(schema.traffic.base, [[8, 15], [15, 30]]);
  assert.deepEqual(schema.traffic.capacity, [15, 30]);
  // 평판 축 이름은 스키마 사다리에서 가져온다(rep_village/rep_noble).
  const ladderModifier = schema.traffic.modifiers.find((item) => item.type === 'ladder_rank');
  assert.equal(ladderModifier.axis, 'rep_village');
  const noble = schema.traffic.lodging.segments.find((item) => item.id === 'noble');
  assert.equal(noble.requires.ladderRank.axis, 'rep_noble');
  assert.ok(schema.traffic.mail, 'mail synthesized when reputation ladder exists');
  assert.ok(schema.traffic.incidents.deck.length >= 3);
  assert.ok(issues.some((issue) => issue.path === 'traffic'), 'synthesis leaves a warn');
  assert.ok(issues.every((issue) => issue.level !== 'error'));
});

test('existing traffic block is respected (no overwrite)', () => {
  const input = compiledInnLike();
  input.traffic = {
    id: 'custom', capacityFacility: 'lv_tavern', base: [[1, 2]], capacity: [5],
    waves: [{ id: 'day', label: '영업', share: 1 }], modifiers: [], sells: { entity: 'menuItem' },
  };
  const { schema } = validateSchema(input);
  assert.equal(schema.traffic.id, 'custom');
  // lv_ 재명명이 traffic 참조에도 반영된다.
  assert.equal(schema.traffic.capacityFacility, 'tavern');
});

test('non-inn schema (no rooms) does not get traffic', () => {
  const input = compiledInnLike();
  input.entities = input.entities.filter((entry) => entry.type !== 'room');
  const { schema } = validateSchema(input);
  assert.equal(schema.traffic, undefined);
});

test('quests in combat schemas get default encounter chance by name heuristic', () => {
  const input = compiledInnLike();
  input.combat = { d: 20 };
  input.pools = [{ id: 'hp', label: '체력', max: 100 }];
  input.rewards = { gold: { D: [1000, 2000] } };
  input.quests = [
    { id: 'DUNGEON', name: '던전 탐사 의뢰', check: { mode: 'rate', rate: 70 }, rewardTier: 'D' },
    { id: 'INTEL', name: '정보 거래 의뢰', check: { mode: 'rate', rate: 85 }, rewardTier: 'D' },
    { id: 'FIXED', name: '고정 의뢰', check: { mode: 'rate', rate: 50 }, rewardTier: 'D', encounterChance: 5 },
  ];
  const { schema } = validateSchema(input);
  const byId = Object.fromEntries(schema.quests.map((quest) => [quest.id, quest.encounterChance]));
  assert.equal(byId.DUNGEON, 35);
  assert.equal(byId.INTEL, 15);
  assert.equal(byId.FIXED, 5); // 명시 값은 존중
  assert.ok(schema.encounters && schema.encounters.pool.length >= 3); // 기본 풀 합성 선행 확인
});

test('compiled inn synthesizes quarter staffing, Korean resource labels, and tavern level 2 quest board', () => {
  const input = compiledInnLike();
  input.resources.push({ id: 'material', unit: '개', min: 0, basePrice: 5000 });
  input.entities.push({ type: 'npc', fields: ['id', 'nameKo', 'nameEn', 'class', 'group'], instances: [{ id: 'silvia', nameKo: '실비아', nameEn: 'silvia', class: '레인저', group: 'inn' }] });
  input.entities.find((entry) => entry.type === 'facility').instances.push({ id: 'lv_quarter', label: '직원 숙소', maxLevel: 4 });
  input.initialState.facilities.lv_quarter = 1;
  input.rewards = { gold: { E: [1, 2] } };
  input.quests = [{ id: 'q1', name: '첫 의뢰', check: { mode: 'rate', rate: 90 }, rewardTier: 'E' }];
  const { schema } = validateSchema(input);
  assert.deepEqual(schema.staffing, { facility: 'quarter', capacityByLevel: { 1: 1, 2: 2, 3: 3, 4: 4 } });
  assert.deepEqual(schema.questBoard, { facility: 'tavern', unlockLevel: 2, size: 3, refresh: 'daily' });
  assert.equal(schema.resources.find((item) => item.id === 'food').label, '식자재');
  assert.equal(schema.resources.find((item) => item.id === 'material').label, '재료');
});
