'use strict';

// S1 — 커널 세션 원장(append-only 이벤트 로그 + 주기 스냅샷 + 결정론 재현).
// ADR 0001: 이벤트 로그·replay·저장·불러오기는 장르 중립 Kernel의 소유.
// 계약: 같은 (schema, seed, 이벤트 열)이면 항상 같은 상태 — 실패 이벤트도
// 결정론적으로 재현되므로 원장에 그대로 기록한다(RNG는 실패 시 레지스트리가 원복).
// 벽시계·난수 사용 금지 — 시각이 필요한 메타는 호출자가 주입한다.

const { createState } = require('./createState.js');
const { applyEvent } = require('./applyEvent.js');
const { createRng } = require('./rng.js');
const { clone } = require('./utils.js');

const JOURNAL_CONTRACT = 'session-journal/0.1';

// 손상 감지용 해시 — 보안 목적이 아니다(백업 파일이 깨졌는지 확인하는 용도).
function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// 키 정렬 직렬화 — 객체 키 순서와 무관하게 같은 내용이면 같은 해시.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function stateHash(state) {
  return fnv1a(stableStringify(state));
}

function createSessionJournal(schema, seed, options = {}) {
  const snapshotInterval = Math.max(1, Math.trunc(Number(options.snapshotInterval) || 50));
  const normalizedSeed = Number.isFinite(Number(seed)) ? Number(seed) : 42;
  let state = createState(schema, normalizedSeed);
  const rng = createRng(normalizedSeed);
  // events[i] = { index: i+1, event, ok } — index는 1부터. 스냅샷 index는 "그 index까지 적용된 상태".
  const events = [];
  const snapshots = [{ index: 0, state: clone(state), rng: rng.snapshot() }];

  function append(event) {
    const result = applyEvent(schema, state, event, rng);
    const ok = result.log.some((entry) => entry && entry.ok === true);
    if (ok) state = result.state;
    events.push({ index: events.length + 1, event: clone(event), ok });
    if (events.length % snapshotInterval === 0) {
      snapshots.push({ index: events.length, state: clone(state), rng: rng.snapshot() });
    }
    return { ok, entries: result.log };
  }

  function assertIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index > events.length) {
      throw new RangeError(`journal_index_out_of_range:${index}`);
    }
  }

  // index 시점의 상태를 재구성 — 최근 스냅샷에서 꼬리만 재생(타임머신 조회).
  function stateAt(index) {
    assertIndex(index);
    let base = snapshots[0];
    for (const snapshot of snapshots) {
      if (snapshot.index <= index) base = snapshot;
      else break;
    }
    let workState = clone(base.state);
    const workRng = createRng(normalizedSeed);
    workRng.restore(base.rng);
    for (let i = base.index; i < index; i += 1) {
      const result = applyEvent(schema, workState, events[i].event, workRng);
      if (result.log.some((entry) => entry && entry.ok === true)) workState = result.state;
    }
    return { index, state: workState, rng: workRng.snapshot() };
  }

  // index 이후를 잘라내고 그 시점으로 복귀(타임머신 복원). 이후 append는 새 분기.
  function truncateTo(index) {
    assertIndex(index);
    const restored = stateAt(index);
    events.length = index;
    while (snapshots.length > 1 && snapshots[snapshots.length - 1].index > index) snapshots.pop();
    state = restored.state;
    rng.restore(restored.rng);
    return head();
  }

  function head() {
    return { index: events.length, stateHash: stateHash(state), rng: rng.snapshot() };
  }

  // 백업 — 스냅샷은 이벤트에서 재계산 가능하므로 제외해 파일을 가볍게 유지.
  // head의 stateHash·rng가 복구 시 손상 감지 기준이 된다.
  function toJSON() {
    return {
      contract: JOURNAL_CONTRACT,
      schemaHash: fnv1a(stableStringify(schema)),
      seed: normalizedSeed,
      snapshotInterval,
      events: events.map((entry) => ({ index: entry.index, event: clone(entry.event), ok: entry.ok })),
      head: head(),
    };
  }

  return {
    get length() { return events.length; },
    get state() { return state; },
    events: () => events.map((entry) => ({ index: entry.index, event: clone(entry.event), ok: entry.ok })),
    snapshots: () => snapshots.map((snapshot) => ({ index: snapshot.index })),
    append,
    stateAt,
    truncateTo,
    head,
    toJSON,
  };
}

// 백업에서 복구 — 전체 재생 후 head와 대조해 손상을 감지한다.
function restoreSessionJournal(schema, data) {
  if (!data || data.contract !== JOURNAL_CONTRACT) throw new TypeError('journal_contract_mismatch');
  if (data.schemaHash !== fnv1a(stableStringify(schema))) throw new TypeError('journal_schema_mismatch');
  const journal = createSessionJournal(schema, data.seed, { snapshotInterval: data.snapshotInterval });
  const records = Array.isArray(data.events) ? data.events : [];
  for (const record of records) {
    const { ok } = journal.append(record.event);
    if (typeof record.ok === 'boolean' && record.ok !== ok) throw new TypeError(`journal_corrupt:event_${record.index}_verdict`);
  }
  const restoredHead = journal.head();
  const savedHead = data.head || {};
  if (savedHead.stateHash !== restoredHead.stateHash) throw new TypeError('journal_corrupt:state_hash');
  if (Number.isFinite(Number(savedHead.rng)) && Number(savedHead.rng) !== restoredHead.rng) throw new TypeError('journal_corrupt:rng');
  return journal;
}

module.exports = { JOURNAL_CONTRACT, createSessionJournal, restoreSessionJournal, stateHash, stableStringify };
