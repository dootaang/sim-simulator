'use strict';

// S1 — SessionStore 계약의 인메모리 구현(계약 기준 구현체이자 테스트 기준).
// SQLite WASM+OPFS/Tauri 어댑터는 이 계약을 그대로 대체한다(contracts.ts 참조).
// 저장소는 시각·난수를 만들지 않는다 — meta.createdAt 등은 호출자 주입 값 그대로 보존.

const STORE_CONTRACT = 'session-store/0.1';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name}_required`);
}

function assertAppendOnlyIndex(list, index, name) {
  const expected = list.length ? list[list.length - 1].index + 1 : 1;
  if (!Number.isInteger(index) || index !== expected) {
    throw new RangeError(`${name}_index_not_sequential:expected_${expected}_got_${index}`);
  }
}

function createMemorySessionStore() {
  const sessions = new Map(); // id → { meta, messages, engineEvents, promptRuns, snapshots }

  function mustGet(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new RangeError(`unknown_session:${sessionId}`);
    return session;
  }

  function snapshotOf(session) {
    return JSON.parse(JSON.stringify({
      contract: STORE_CONTRACT,
      meta: session.meta,
      messages: session.messages,
      engineEvents: session.engineEvents,
      promptRuns: session.promptRuns,
      snapshots: session.snapshots,
    }));
  }

  return {
    createSession(meta) {
      assertNonEmptyString(meta && meta.id, 'session_id');
      if (sessions.has(meta.id)) throw new RangeError(`duplicate_session:${meta.id}`);
      const stored = JSON.parse(JSON.stringify(meta));
      sessions.set(meta.id, { meta: stored, messages: [], engineEvents: [], promptRuns: [], snapshots: [] });
      return JSON.parse(JSON.stringify(stored));
    },
    listSessions() {
      return Array.from(sessions.values()).map((session) => JSON.parse(JSON.stringify(session.meta)));
    },
    getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? snapshotOf(session) : null;
    },
    appendMessage(sessionId, message) {
      const session = mustGet(sessionId);
      assertAppendOnlyIndex(session.messages, message && message.index, 'message');
      session.messages.push(JSON.parse(JSON.stringify(message)));
    },
    appendEngineEvent(sessionId, record) {
      const session = mustGet(sessionId);
      assertAppendOnlyIndex(session.engineEvents, record && record.index, 'engine_event');
      session.engineEvents.push(JSON.parse(JSON.stringify(record)));
    },
    recordPromptRun(sessionId, run) {
      const session = mustGet(sessionId);
      assertAppendOnlyIndex(session.promptRuns, run && run.index, 'prompt_run');
      session.promptRuns.push(JSON.parse(JSON.stringify(run)));
    },
    saveSnapshot(sessionId, snapshot) {
      const session = mustGet(sessionId);
      if (!Number.isInteger(snapshot && snapshot.index) || snapshot.index < 0) throw new RangeError('snapshot_index_invalid');
      // 스냅샷은 같은 index 재저장(덮어쓰기)을 허용 — 최신 상태 갱신 용도.
      const existing = session.snapshots.findIndex((entry) => entry.index === snapshot.index);
      const stored = JSON.parse(JSON.stringify(snapshot));
      if (existing >= 0) session.snapshots[existing] = stored;
      else {
        session.snapshots.push(stored);
        session.snapshots.sort((a, b) => a.index - b.index);
      }
    },
    exportSession(sessionId) {
      return snapshotOf(mustGet(sessionId));
    },
    importSession(payload) {
      if (!payload || payload.contract !== STORE_CONTRACT) throw new TypeError('session_export_contract_mismatch');
      assertNonEmptyString(payload.meta && payload.meta.id, 'session_id');
      if (sessions.has(payload.meta.id)) throw new RangeError(`duplicate_session:${payload.meta.id}`);
      const clone = JSON.parse(JSON.stringify(payload));
      sessions.set(clone.meta.id, {
        meta: clone.meta,
        messages: clone.messages || [],
        engineEvents: clone.engineEvents || [],
        promptRuns: clone.promptRuns || [],
        snapshots: clone.snapshots || [],
      });
      return JSON.parse(JSON.stringify(clone.meta));
    },
    deleteSession(sessionId) {
      mustGet(sessionId);
      sessions.delete(sessionId);
    },
  };
}

module.exports = { STORE_CONTRACT, createMemorySessionStore };
