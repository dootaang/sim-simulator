'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorySessionStore, STORE_CONTRACT } = require('../core/session/memoryStore.js');

const meta = () => ({ id: 's1', title: '여관 1회차', schemaHash: 'abcd1234', seed: 7, createdAt: 1760000000000 });

test('세션 생성·목록·조회 — 저장소는 주입된 메타를 그대로 보존하고 사본을 반환한다', () => {
  const store = createMemorySessionStore();
  const created = store.createSession(meta());
  assert.deepEqual(created, meta());
  created.title = '변조';
  assert.equal(store.listSessions()[0].title, '여관 1회차'); // 반환 사본 변조가 내부에 새지 않음
  assert.equal(store.getSession('없음'), null);
  assert.throws(() => store.createSession(meta()), /duplicate_session/);
});

test('append-only — 메시지·엔진 사건·프롬프트 런은 연속 index만 허용한다', () => {
  const store = createMemorySessionStore();
  store.createSession(meta());
  store.appendMessage('s1', { index: 1, role: 'user', content: '안녕' });
  assert.throws(() => store.appendMessage('s1', { index: 3, role: 'user', content: '건너뜀' }), /message_index_not_sequential/);
  store.appendEngineEvent('s1', { index: 1, event: { id: 'gold_delta', params: { amount: 10 } }, ok: true });
  assert.throws(() => store.appendEngineEvent('s1', { index: 1, event: { id: 'gold_delta' }, ok: true }), /engine_event_index_not_sequential/);
  store.recordPromptRun('s1', {
    index: 1, promptHash: 'h1', model: 'gemini-2.5-flash',
    blocks: [{ blockId: 'main', active: true }],
    responseText: '서사', proposedEvents: [{ id: 'sale', params: { menuName: '스튜', qty: 1 } }],
    appliedEventIndexes: [1], rejectedReasons: [],
  });
  assert.throws(() => store.recordPromptRun('s1', { index: 5, promptHash: 'h2', model: 'm', responseText: '', proposedEvents: [], appliedEventIndexes: [] }), /prompt_run_index_not_sequential/);
});

test('스냅샷은 index 정렬 보관·같은 index 덮어쓰기 허용', () => {
  const store = createMemorySessionStore();
  store.createSession(meta());
  store.saveSnapshot('s1', { index: 50, stateHash: 'h50', state: { day: 5 }, rng: 123 });
  store.saveSnapshot('s1', { index: 0, stateHash: 'h0', state: { day: 1 }, rng: 1 });
  store.saveSnapshot('s1', { index: 50, stateHash: 'h50b', state: { day: 5, gold: 1 }, rng: 456 });
  const exported = store.exportSession('s1');
  assert.deepEqual(exported.snapshots.map((s) => s.index), [0, 50]);
  assert.equal(exported.snapshots[1].stateHash, 'h50b');
});

test('내보내기 → 새 저장소 가져오기 왕복이 무손실이고 계약 위반은 거부한다', () => {
  const store = createMemorySessionStore();
  store.createSession(meta());
  store.appendMessage('s1', { index: 1, role: 'user', content: '안녕' });
  store.appendMessage('s1', { index: 2, role: 'assistant', content: '어서 와.', npcIds: ['silvia'] });
  store.appendEngineEvent('s1', { index: 1, event: { id: 'checkin', params: { roomNo: '101', guestName: 'A', stayDays: 1 } }, ok: true });
  store.saveSnapshot('s1', { index: 1, stateHash: 'h1', state: { day: 1 }, rng: 42 });
  const exported = store.exportSession('s1');
  assert.equal(exported.contract, STORE_CONTRACT);

  const other = createMemorySessionStore();
  other.importSession(exported);
  assert.deepEqual(other.exportSession('s1'), exported);
  assert.throws(() => other.importSession(exported), /duplicate_session/);
  assert.throws(() => other.importSession({ contract: 'nope' }), /session_export_contract_mismatch/);
});

test('삭제 후에는 접근이 거부된다', () => {
  const store = createMemorySessionStore();
  store.createSession(meta());
  store.deleteSession('s1');
  assert.equal(store.getSession('s1'), null);
  assert.throws(() => store.appendMessage('s1', { index: 1, role: 'user', content: 'x' }), /unknown_session/);
});
