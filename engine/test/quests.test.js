'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEvent } = require('../core/applyEvent.js');
const { availableManagement } = require('../core/selectors.js');

const schema = {
  quests: [
    { id: 'once', name: '일회 의뢰', check: { mode: 'rate', rate: 50 }, rewardTier: 'Q' },
    { id: 'daily', name: '일상 의뢰', check: { mode: 'rate', rate: 100 }, rewardTier: 'Q', repeatable: true },
    { id: 'dc', name: '근력 의뢰', check: { mode: 'dc', dc: 12, sides: 20, stat: 'strength' }, rewardTier: 'Q' },
    { id: 'broken', name: '고장 의뢰', check: { mode: 'rate', rate: 50 }, rewardTier: 'NOPE' },
  ],
  rewards: { gold: { Q: [10, 20] } },
};
const state = () => ({ gold: 0, claimedRewards: [], player: { stats: { strength: 3 } } });
const rng = (...values) => ({ calls: 0, int(min, max) { const value = values[this.calls++]; return value == null ? min : value; } });
const attempt = (s, id, random, extra = {}) => applyEvent(schema, s, { id: 'attempt_quest', params: { questId: id, ...extra } }, random);

test('success rewards, marks, and shares idempotency with reward', () => {
  const random = rng(1, 17);
  const result = attempt(state(), 'once', random);
  assert.equal(result.state.gold, 17);
  assert.deepEqual(result.state.claimedRewards, ['once']);
  assert.equal(random.calls, 2);
  assert.equal(attempt(result.state, 'once', random).log[0].reason, 'already_claimed');
  assert.equal(applyEvent(schema, result.state, { id: 'reward', params: { questId: 'once', tier: 'Q' } }, random).log[0].reason, 'already_claimed');
});

test('failure is ok, unchanged, retryable, and consumes check only', () => {
  const initial = state();
  const random = rng(90, 1, 13);
  const failed = attempt(initial, 'once', random);
  assert.equal(failed.log[0].ok, true);
  assert.equal(failed.log[0].success, false);
  assert.deepEqual(failed.state, initial);
  assert.equal(random.calls, 1);
  const success = attempt(failed.state, 'once', random);
  assert.equal(success.log[0].goldDelta, 13);
  assert.equal(random.calls, 3);
});

test('repeatable quest never marks and can retry', () => {
  const random = rng(1, 10, 1, 11);
  const first = attempt(state(), 'daily', random);
  const second = attempt(first.state, 'daily', random);
  assert.deepEqual(second.state.claimedRewards, []);
  assert.equal(second.state.gold, 21);
});

test('rejections consume no rng and numeric backdoors are rejected', () => {
  for (const [id, extra, reason] of [['missing', {}, 'unknown_quest'], ['broken', {}, 'unknown_reward_tier'], ['once', { roll: 1 }, 'quest_number_not_allowed']]) {
    const random = rng(1);
    assert.equal(attempt(state(), id, random, extra).log[0].reason, reason);
    assert.equal(random.calls, 0);
  }
});

test('dc uses player stat and selector computes exact distribution', () => {
  const random = rng(9, 10);
  assert.equal(attempt(state(), 'dc', random).log[0].success, true);
  const quests = availableManagement(schema, state()).sections.find((section) => section.type === 'quests');
  assert.equal(quests.items.find((item) => item.id === 'dc').chance, 60);
});

test('failure leaves the next seeded value for the next check', () => {
  const a = rng(90, 7);
  attempt(state(), 'once', a);
  const afterFailure = attempt(state(), 'dc', a).log[0].roll;
  const b = rng(90, 7);
  b.int(1, 100);
  const directNext = b.int(1, 20);
  assert.equal(afterFailure, directNext);
});

test('quest board is locked by facility level, deterministic, and limited per day', () => {
  const source = JSON.parse(JSON.stringify(schema));
  source.questBoard = { facility: 'tavern', unlockLevel: 2, size: 2, refresh: 'daily' };
  const locked = { ...state(), day: 1, seed: 42, facilities: { tavern: 1 } };
  assert.equal(availableManagement(source, locked).sections.some((section) => section.type === 'quests'), false);
  assert.equal(applyEvent(source, locked, { id: 'attempt_quest', params: { questId: 'once' } }, rng(1)).log[0].reason, 'unknown_quest');
  const open = { ...locked, facilities: { tavern: 2 } };
  const first = availableManagement(source, open).sections.find((section) => section.type === 'quests').items;
  const second = availableManagement(source, JSON.parse(JSON.stringify(open))).sections.find((section) => section.type === 'quests').items;
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
});
