'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEvent } = require('../core/applyEvent.js');
const { availableManagement } = require('../core/selectors.js');

const schema = {
  combat: {}, pools: {}, encounters: { pool: [{ id: 'wolves', name: '들개 떼', rank: 'E', count: [1, 2] }] },
  quests: [{ id: 'hunt', name: '토벌', rewardTier: 'E', check: { mode: 'rate', rate: 100 }, encounterChance: 100 }],
  rewards: { gold: { E: [10, 10] } },
};
const state = (seed = 7) => ({ seed, day: 1, gold: 0, claimedRewards: [], player: { level: 1, exp: 0, pools: { hp: { cur: 30, max: 30 } } } });
const rng = { next: () => 0, int: (min) => min };

test('quest encounter is reproducible and defers quest resolution', () => {
  const a = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  const b = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  assert.deepEqual(a.state.combat.enemies, b.state.combat.enemies);
  assert.deepEqual(a.state.pendingQuest, { questId: 'hunt', day: 1 });
  assert.equal(a.state.gold, 0); assert.equal(a.log[0].success, undefined);
});

test('victory continuation skips encounter roll and resolves quest', () => {
  let current = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng).state;
  current.combat.cleared = true; current.combat.enemies.forEach((enemy) => { enemy.dead = true; enemy.hp.cur = 0; });
  current = applyEvent(schema, current, { id: 'end_encounter', params: {} }, rng).state;
  const item = availableManagement(schema, current).sections.find((s) => s.type === 'quests').items[0];
  assert.equal(item.pending, true);
  const result = applyEvent(schema, current, { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  assert.equal(result.log[0].success, true); assert.equal(result.state.pendingQuest, undefined); assert.equal(result.state.gold >= 10, true);
});

test('defeat keeps pending quest retryable', () => {
  let current = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng).state;
  current.player.dead = true; current.player.pools.hp.cur = 0;
  current = applyEvent(schema, current, { id: 'end_encounter', params: {} }, rng).state;
  assert.deepEqual(current.pendingQuest, { questId: 'hunt', day: 1 });
  assert.equal(availableManagement(schema, current).sections.find((s) => s.type === 'quests').items[0].pending, true);
});

test('chance zero or missing pool preserves direct quest behavior', () => {
  for (const altered of [{ ...schema, quests: [{ ...schema.quests[0], encounterChance: 0 }] }, { ...schema, encounters: undefined }]) {
    const result = applyEvent(altered, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
    assert.equal(result.log[0].success, true); assert.equal(result.state.combat, undefined);
  }
});

test('day boundary clears pending quest', () => {
  const s = state(); s.pendingQuest = { questId: 'hunt', day: 1 };
  const result = applyEvent({ ...schema, processes: [] }, s, { id: 'day_end', params: {} }, rng);
  assert.equal(result.state.day, 2); assert.equal(result.state.pendingQuest, undefined);
});

test('manual combat is opt-in in play view source', () => {
  const fs = require('node:fs'); const source = fs.readFileSync(require('node:path').join(__dirname, '../../app/src/playView.js'), 'utf8');
  assert.match(source, /simbot\.play\.manualCombat/); assert.match(source, /디버그: 수동 전투 개시/);
});

test('defeat or flee requires combat retry and blocks direct quest check', () => {
  let current = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng).state;
  // 1. 패배 시나리오
  current.player.dead = true; current.player.pools.hp.cur = 0;
  current = applyEvent(schema, current, { id: 'end_encounter', params: {} }, rng).state;
  // 패배 후 다시 attempt_quest를 호출하면, cleared가 없으므로 다시 조우(전투)가 시작되어야 함.
  let retryResult = applyEvent(schema, current, { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  assert.equal(retryResult.state.combat.active, true);
  assert.equal(retryResult.log[0].success, undefined); // 의뢰 본판정 미실행

  // 2. 도주 시나리오
  let current2 = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng).state;
  current2.combat.active = false; current2.combat.fled = true;
  current2 = applyEvent(schema, current2, { id: 'end_encounter', params: {} }, rng).state;
  // 도주 후 다시 attempt_quest를 호출하면, cleared가 없으므로 다시 조우(전투)가 시작되어야 함.
  let retryResult2 = applyEvent(schema, current2, { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  assert.equal(retryResult2.state.combat.active, true);
  assert.equal(retryResult2.log[0].success, undefined); // 의뢰 본판정 미실행
});


test('victory in an unrelated combat does not unlock a pending quest', () => {
  // 의뢰 조우에서 도주 → 무관한 전투에서 승리해도 의뢰 본판정이 열리면 안 된다.
  let current = applyEvent(schema, state(), { id: 'attempt_quest', params: { questId: 'hunt' } }, rng).state;
  current.combat.active = false; current.combat.fled = true;
  current = applyEvent(schema, current, { id: 'end_encounter', params: {} }, rng).state;
  // 무관한 전투(LLM 자유 조우 상당) — questId 태그 없음
  current = applyEvent(schema, current, { id: 'start_encounter', params: { enemies: [{ name: '들쥐', hp: 1 }] } }, rng).state;
  for (const enemy of current.combat.enemies) { enemy.hp.cur = 0; enemy.dead = true; }
  current.combat.cleared = true;
  current = applyEvent(schema, current, { id: 'end_encounter', params: {} }, rng).state;
  assert.equal(current.pendingQuest && current.pendingQuest.cleared, undefined);
  // 재도전은 여전히 조우부터
  const retry = applyEvent(schema, current, { id: 'attempt_quest', params: { questId: 'hunt' } }, rng);
  assert.equal(retry.state.combat.active, true);
});
