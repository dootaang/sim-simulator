'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../core/createState.js');
const { applyEvent } = require('../core/applyEvent.js');
const { createRng } = require('../core/rng.js');
const { createSessionJournal, restoreSessionJournal, stateHash } = require('../core/sessionJournal.js');

// 300턴 결정론 자동 플레이 스크립트(BACKLOG P1.5 합격 시험 축) —
// 성공 이벤트(gold_delta·purchase), RNG 소모 이벤트(day_end), 의도적 실패(unknown_resource)를 섞는다.
function scriptedEvent(turn) {
  if (turn % 10 === 0) return { id: 'day_end', params: {} };
  if (turn % 7 === 0) return { id: 'purchase', params: { resource: 'no-such-resource', qty: 1 } }; // 결정론적 실패
  if (turn % 3 === 0) return { id: 'purchase', params: { resource: 'food', qty: 1 } };
  return { id: 'gold_delta', params: { amount: 100 + turn, reason: `턴 ${turn}` } };
}

const TURNS = 300;

function playJournal(snapshotInterval = 50) {
  const journal = createSessionJournal(schema, 7, { snapshotInterval });
  const verdicts = [];
  for (let turn = 1; turn <= TURNS; turn += 1) verdicts.push(journal.append(scriptedEvent(turn)).ok);
  return { journal, verdicts };
}

test('300턴 자동 플레이가 결정론적이고 브루트포스 재생과 상태가 일치한다', () => {
  const { journal, verdicts } = playJournal();
  assert.equal(journal.length, TURNS);
  assert.ok(verdicts.some((ok) => ok === false)); // 의도적 실패가 실제로 섞였는지
  assert.ok(verdicts.some((ok) => ok === true));

  // 스냅샷 경유 없이 처음부터 순수 재생한 결과와 대조.
  let brute = createState(schema, 7);
  const rng = createRng(7);
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const result = applyEvent(schema, brute, scriptedEvent(turn), rng);
    if (result.log.some((entry) => entry.ok)) brute = result.state;
  }
  assert.equal(journal.head().stateHash, stateHash(brute));
  assert.deepEqual(journal.state, brute);
  assert.equal(journal.head().rng, rng.snapshot());
});

test('stateAt은 임의 시점을 스냅샷+꼬리 재생으로 정확히 복원한다', () => {
  const { journal } = playJournal(50);
  for (const index of [0, 1, 49, 50, 51, 149, 250, TURNS]) {
    let brute = createState(schema, 7);
    const rng = createRng(7);
    for (let turn = 1; turn <= index; turn += 1) {
      const result = applyEvent(schema, brute, scriptedEvent(turn), rng);
      if (result.log.some((entry) => entry.ok)) brute = result.state;
    }
    const at = journal.stateAt(index);
    assert.deepEqual(at.state, brute, `index ${index}`);
    assert.equal(at.rng, rng.snapshot(), `index ${index} rng`);
  }
  assert.throws(() => journal.stateAt(TURNS + 1), RangeError);
  assert.throws(() => journal.stateAt(-1), RangeError);
});

test('백업 → 복구 후 head 해시·사건 판정이 일치하고, 이어서 플레이해도 원본과 같다', () => {
  const { journal } = playJournal();
  const backup = JSON.parse(JSON.stringify(journal.toJSON())); // 직렬화 왕복까지 포함
  const restored = restoreSessionJournal(schema, backup);
  assert.deepEqual(restored.head(), journal.head());
  assert.deepEqual(restored.state, journal.state);

  // 저장→종료→재개 합격 항목: 재개 후 append 결과가 원본에 이어 append한 결과와 동일해야 한다.
  const nextEvents = [{ id: 'day_end', params: {} }, { id: 'purchase', params: { resource: 'drink', qty: 2 } }];
  for (const event of nextEvents) {
    assert.equal(restored.append(event).ok, journal.append(event).ok);
  }
  assert.deepEqual(restored.head(), journal.head());
  assert.deepEqual(restored.state, journal.state);
});

test('타임머신 — truncateTo 후 같은 사건을 다시 넣으면 같은 상태로 재분기한다', () => {
  const { journal } = playJournal();
  const checkpoint = journal.stateAt(200);
  const branch = createSessionJournal(schema, 7);
  for (let turn = 1; turn <= 200; turn += 1) branch.append(scriptedEvent(turn));
  assert.deepEqual(branch.state, checkpoint.state);

  journal.truncateTo(200);
  assert.equal(journal.length, 200);
  assert.deepEqual(journal.state, checkpoint.state);
  assert.equal(journal.head().rng, checkpoint.rng);

  // 같은 미래를 다시 재생하면 같은 결과(결정론), 다른 미래는 다른 분기.
  const replayA = journal.append(scriptedEvent(201));
  const replayB = branch.append(scriptedEvent(201));
  assert.equal(replayA.ok, replayB.ok);
  assert.deepEqual(journal.state, branch.state);
});

test('손상 감지 — 사건 변조·판정 변조·스키마 불일치를 복구가 거부한다', () => {
  const { journal } = playJournal(100);
  const tamperedEvent = journal.toJSON();
  tamperedEvent.events[3].event.params.amount = 999999;
  assert.throws(() => restoreSessionJournal(schema, tamperedEvent), /journal_corrupt/);

  const tamperedVerdict = journal.toJSON();
  const failed = tamperedVerdict.events.find((entry) => entry.ok === false);
  failed.ok = true;
  assert.throws(() => restoreSessionJournal(schema, tamperedVerdict), /journal_corrupt/);

  const otherSchema = JSON.parse(JSON.stringify(schema));
  otherSchema.__mutated = true;
  assert.throws(() => restoreSessionJournal(otherSchema, journal.toJSON()), /journal_schema_mismatch/);
  assert.throws(() => restoreSessionJournal(schema, { contract: 'nope' }), /journal_contract_mismatch/);
});

test('스냅샷 간격이 달라도 최종 상태는 동일하다 (스냅샷은 성능 장치일 뿐)', () => {
  const a = playJournal(10).journal;
  const b = playJournal(300).journal;
  assert.equal(a.head().stateHash, b.head().stateHash);
  assert.ok(a.snapshots().length > b.snapshots().length);
});
