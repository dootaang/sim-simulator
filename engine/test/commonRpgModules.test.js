'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEvent, getDefaultModuleRegistry } = require('../core/applyEvent.js');
const { createState } = require('../core/createState.js');
const { createRng } = require('../core/rng.js');

const schema = {
  initialState: { day: 1, gold: 100, resources: { herb: 3, potion: 0 }, items: { sword: 1 }, player: { level: 1, exp: 0, atk: 2, statPoints: 0 }, location: 'guild' },
  progression: { sources: { hunt: [6, 6] }, thresholds: [5, 10], statPointsPerLevel: 2, allocatableStats: ['atk'] },
  equipment: { slots: ['weapon'] },
  entities: [
    { type: 'item', instances: [{ id: 'sword', slot: 'weapon' }, { id: 'potion' }] },
    { type: 'npc', instances: [{ id: 'iris' }, { id: 'sera' }] },
  ],
  rpgQuests: [{ id: 'q1', steps: [{ id: 'kill', target: 2 }], rewards: { gold: 20, potion: 1 } }],
  party: { maxSize: 2, roles: ['leader', 'support'] },
  time: { startHour: 8, hoursPerStep: 3 },
  locations: [{ id: 'guild', links: ['gate'] }, { id: 'gate', links: ['guild', 'dungeon'] }, { id: 'dungeon', links: ['gate'] }],
  lootTables: [{ id: 'slime', entries: [{ itemId: 'herb', qty: [1, 1], weight: 1 }] }],
  shops: [{ id: 'store', items: [{ itemId: 'potion', buyPrice: 10, sellPrice: 4 }] }],
  recipes: [{ id: 'brew', inputs: { herb: 2 }, outputs: { potion: 1 } }],
  factions: [{ id: 'association', min: -10, max: 10, initial: 0, sources: { help: [3, 3] } }],
  jobs: [{ id: 'repair', duration: 2, cost: { gold: 10 }, outputs: { potion: 1 } }],
};

function run(state, id, params = {}, seed = 9) { return applyEvent(schema, state, { id, params }, createRng(seed)); }

test('공통 모듈 11종이 기본 registry에 독립 event/selector/state ownership으로 등록된다', () => {
  const registry = getDefaultModuleRegistry();
  const ids = ['core.progression','core.equipment','rpg.quests','rpg.party','core.time','core.location','rpg.loot','rpg.shop','rpg.crafting','core.factions','core.jobs'];
  for (const id of ids) assert.ok(registry.getModule(id), id);
  assert.equal(registry.eventOwner('location/move'), 'core.location');
  assert.equal(registry.selectorOwner('crafting/recipes'), 'rpg.crafting');
});

test('진행·장비·파티·퀘스트 루프가 수치와 보상을 엔진에서 결정한다', () => {
  let state = createState(schema, 1);
  state = run(state, 'progression/gain', { source: 'hunt' }).state;
  assert.deepEqual({ level: state.player.level, exp: state.player.exp, points: state.player.statPoints }, { level: 2, exp: 1, points: 2 });
  state = run(state, 'progression/allocate', { stat: 'atk' }).state; assert.equal(state.player.stats.atk, 3);
  state = run(state, 'equipment/equip', { slot: 'weapon', itemId: 'sword' }).state; assert.equal(state.equipment.weapon, 'sword');
  state = run(state, 'party/add', { memberId: 'iris' }).state;
  state = run(state, 'party/assign', { memberId: 'iris', role: 'leader' }).state; assert.equal(state.party.formation.leader, 'iris');
  state = run(state, 'quest/start', { questId: 'q1' }).state;
  state = run(state, 'quest/progress', { questId: 'q1', stepId: 'kill' }).state;
  state = run(state, 'quest/progress', { questId: 'q1', stepId: 'kill' }).state; assert.equal(state.questProgress.q1.status, 'complete');
  state = run(state, 'quest/claim', { questId: 'q1' }).state;
  assert.equal(state.questProgress.q1.status, 'claimed'); assert.equal(state.gold, 120); assert.equal(state.resources.potion, 1);
});

test('시간·장소는 연결 규칙과 하루 넘김을 결정론적으로 적용한다', () => {
  let state = createState(schema, 1);
  const blocked = run(state, 'location/move', { locationId: 'dungeon' }); assert.equal(blocked.log[0].reason, 'location_not_connected'); assert.equal(blocked.state, state);
  state = run(state, 'location/move', { locationId: 'gate' }).state; assert.equal(state.location, 'gate');
  state.clock.hour = 23; state = run(state, 'time/advance', { unit: 'hour' }).state;
  assert.deepEqual(state.clock, { day: 2, hour: 2, turn: 0 }); assert.equal(state.day, 2);
});

test('전리품·상점·제작·세력은 같은 seed와 입력으로 같은 결과를 만든다', () => {
  const once = () => {
    let state = createState(schema, 1);
    state = run(state, 'loot/roll', { tableId: 'slime' }, 77).state;
    state = run(state, 'shop/buy', { shopId: 'store', itemId: 'potion', qty: 2 }).state;
    state = run(state, 'crafting/craft', { recipeId: 'brew' }).state;
    state = run(state, 'factions/change', { factionId: 'association', source: 'help' }, 77).state;
    return state;
  };
  assert.deepEqual(once(), once());
  const state = once(); assert.equal(state.resources.herb, 2); assert.equal(state.resources.potion, 3); assert.equal(state.gold, 80); assert.equal(state.factions.association, 3);
});

test('시간이 걸리는 작업은 비용→진행→완료→수령 순서를 강제한다', () => {
  let state = createState(schema, 1);
  let result = run(state, 'jobs/start', { jobId: 'repair' }); state = result.state; const instanceId = result.log[0].instanceId;
  assert.equal(state.gold, 90); assert.equal(state.jobs[0].remaining, 2);
  state = run(state, 'jobs/tick', { instanceId }).state; assert.equal(state.jobs[0].status, 'active');
  state = run(state, 'jobs/tick', { instanceId }).state; assert.equal(state.jobs[0].status, 'complete'); assert.equal(state.resources.potion, 1);
  state = run(state, 'jobs/collect', { instanceId }).state; assert.equal(state.jobs.length, 0);
});

test('잘못된 동적 키는 prototype을 오염시키지 않고 상태와 RNG를 되돌린다', () => {
  const malicious = JSON.parse(JSON.stringify(schema)); malicious.factions = [{ id: '__proto__', sources: { help: [1, 1] } }];
  const state = createState(malicious, 1); const rng = createRng(3); const untouched = createRng(3);
  const result = applyEvent(malicious, state, { id: 'factions/change', params: { factionId: '__proto__', source: 'help' } }, rng);
  assert.equal(result.log[0].ok, false); assert.equal(result.state, state); assert.equal({}.polluted, undefined); assert.equal(rng.int(1, 10), untouched.int(1, 10));
});

