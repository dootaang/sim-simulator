import type {
  EngineJournalData,
  EngineJournalDataV02,
  EngineJournalEvent,
  SealedEngineJournalEpoch,
  SealedEpochRef,
} from "@simbot/contracts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ProjectRuntime } from "@simbot/runtime";

type RuntimeRecord = Record<string, unknown>;
type DispatchResult = ReturnType<ProjectRuntime["dispatch"]>;
export type RuntimeSnapshot = { state: RuntimeRecord; rng: number };
type RawDispatch = (id: string, params?: RuntimeRecord) => DispatchResult;

function clone<T>(value: T): T {
  return structuredClone(value);
}
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entry = value as RuntimeRecord,
    keys = Object.keys(entry).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(entry[key])}`).join(",")}}`;
}
export function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function stableHash(value: unknown) {
  return fnv1a(stableStringify(value));
}
export function sha256Stable(value: unknown) {
  return bytesToHex(sha256(new TextEncoder().encode(stableStringify(value))));
}
function stateHash(snapshot: RuntimeSnapshot) {
  return stableHash(snapshot.state);
}
// integrity v2의 저널 섹션 — 이벤트 배열은 롤링 체인으로 접어 저장 시 O(1), 검증 시 1회 O(n)이다(파동 3).
export function journalEventsChain(events: readonly EngineJournalEvent[], seed = "0") {
  let chain = seed;
  for (const event of events) chain = fnv1a(chain + stableHash(event));
  return chain;
}
export function journalIntegrityHash(data: EngineJournalData, eventsChain = journalEventsChain(data.events)) {
  const sealed =
    data.contract === "simbot-event-journal/0.2"
      ? (data.sealedEpochRefs?.length
          ? data.sealedEpochRefs.map((ref) => ({ sealedIndex: ref.sealedIndex, sealHash: ref.sealHash }))
          : data.sealedEpochs.map((epoch) => ({ sealedIndex: epoch.sealedIndex, sealHash: epoch.sealHash })))
      : [];
  return stableHash({
    contract: data.contract,
    schemaHash: data.schemaHash,
    baseIndex: data.contract === "simbot-event-journal/0.2" ? data.baseIndex : 0,
    initialDigest: stableHash(data.initial),
    snapshotInterval: data.snapshotInterval,
    cursor: data.cursor,
    head: data.head,
    eventsChain,
    sealed,
  });
}
function jsonRecord(value: RuntimeRecord) {
  return value as EngineJournalData["initial"]["state"];
}
function epochPayload(epoch: Omit<SealedEngineJournalEpoch, "sealHash">) {
  return epoch;
}
function verifiedSealedEpochs(data: EngineJournalData) {
  if (data.contract === "simbot-event-journal/0.1")
    return { epochs: [] as SealedEngineJournalEpoch[], baseIndex: 0 };
  if (!Array.isArray(data.sealedEpochs) || !Number.isInteger(data.baseIndex) || data.baseIndex < 0)
    throw new Error("journal_corrupt:epoch_contract");
  const epochs: SealedEngineJournalEpoch[] = [];
  let previousIndex = 0;
  for (let offset = 0; offset < data.sealedEpochs.length; offset++) {
    const epoch = data.sealedEpochs[offset];
    if (!epoch || !Number.isInteger(epoch.sealedIndex) || epoch.sealedIndex < previousIndex || epoch.head.index !== epoch.sealedIndex)
      throw new Error(`journal_corrupt:sealed_epoch_${offset + 1}_index`);
    if (!epoch.initial?.state || !Number.isFinite(epoch.initial.rng) || typeof epoch.schemaHash !== "string")
      throw new Error(`journal_corrupt:sealed_epoch_${offset + 1}_initial`);
    for (let eventOffset = 0; eventOffset < epoch.events.length; eventOffset++) {
      const event = epoch.events[eventOffset], expected = previousIndex + eventOffset + 1;
      if (!event || event.index !== expected || !Number.isInteger(event.parentIndex) || event.parentIndex < previousIndex || event.parentIndex >= event.index)
        throw new Error(`journal_corrupt:sealed_epoch_${offset + 1}_event_${expected}`);
    }
    if (previousIndex + epoch.events.length !== epoch.sealedIndex)
      throw new Error(`journal_corrupt:sealed_epoch_${offset + 1}_length`);
    const { sealHash, ...payload } = epoch;
    if (!sealHash || sealHash !== sha256Stable(epochPayload(payload)))
      throw new Error(`journal_corrupt:sealed_epoch_${offset + 1}_hash`);
    epochs.push(clone(epoch));
    previousIndex = epoch.sealedIndex;
  }
  if (data.baseIndex !== previousIndex) throw new Error("journal_corrupt:epoch_base");
  return { epochs, baseIndex: data.baseIndex };
}

export class SessionJournal {
  readonly #runtime: ProjectRuntime;
  readonly #rawDispatch: RawDispatch;
  readonly #targetSchemaHash: string;
  #schemaHash: string;
  #initial: RuntimeSnapshot;
  // 발산 감시는 기대 '스냅샷'이 아니라 기대 해시+RNG 위치만 있으면 된다 — 전체 클론·이중 해시 제거(성능 수술 파동 1a).
  #expectedHash: string;
  #expectedRng: number;
  #events: EngineJournalEvent[] = [];
  #eventsChain = journalEventsChain([]);
  #initialDigest = "";
  #sealedEpochs: SealedEngineJournalEpoch[] = [];
  #baseIndex = 0;
  #snapshots = new Map<number, RuntimeSnapshot>();
  #cursor = 0;
  #snapshotInterval: number;

  constructor(runtime: ProjectRuntime, rawDispatch: RawDispatch, snapshotInterval = 50) {
    this.#runtime = runtime;
    this.#rawDispatch = rawDispatch;
    this.#targetSchemaHash = stableHash(runtime.project.schema);
    this.#schemaHash = this.#targetSchemaHash;
    this.#initial = runtime.snapshot();
    this.#initialDigest = stableHash(this.#initial);
    this.#expectedHash = stateHash(this.#initial);
    this.#expectedRng = this.#initial.rng;
    this.#snapshotInterval = Math.max(1, Math.trunc(snapshotInterval) || 50);
    this.#snapshots.set(0, clone(this.#initial));
  }
  get length() { return this.#baseIndex + this.#events.length; }
  get cursor() { return this.#cursor; }
  get baseIndex() { return this.#baseIndex; }
  get schemaHash() { return this.#schemaHash; }
  get events() { return clone(this.#events); }
  get snapshotIndexes() { return [...this.#snapshots.keys()].sort((a, b) => a - b); }
  activeIndexes(index = this.#cursor) {
    this.#assertIndex(index);
    const out = this.#sealedEpochs.flatMap((epoch) => epoch.events.map((event) => event.index));
    let cursor = index;
    while (cursor > this.#baseIndex) {
      out.push(cursor);
      cursor = this.#eventAt(cursor).parentIndex;
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }
  sealedEvents(from = 1, to = this.#baseIndex) {
    return clone(this.#sealedEpochs.flatMap((epoch) => epoch.events).filter((event) => event.index >= from && event.index <= to));
  }
  append(id: string, params: RuntimeRecord = {}): DispatchResult {
    const actual = this.#runtime.snapshot();
    if (stateHash(actual) !== this.#expectedHash || actual.rng !== this.#expectedRng) throw new Error("journal_runtime_diverged");
    const result = this.#rawDispatch(id, params),
      snapshot = this.#runtime.snapshot(),
      ok = result.log.some((entry) => entry.ok === true),
      index = this.#baseIndex + this.#events.length + 1,
      record: EngineJournalEvent = {
        index,
        parentIndex: this.#cursor,
        event: { id, params: jsonRecord(clone(params)) },
        ok,
        log: clone(result.log) as EngineJournalEvent["log"],
        stateHash: stateHash(snapshot),
        rng: snapshot.rng,
      };
    this.#events.push(record);
    this.#eventsChain = fnv1a(this.#eventsChain + stableHash(record)); // 롤링 체인 확장(O(이벤트 1))
    this.#cursor = index;
    this.#expectedHash = record.stateHash;
    this.#expectedRng = snapshot.rng;
    if ((index - this.#baseIndex) % this.#snapshotInterval === 0) this.#snapshots.set(index, clone(snapshot));
    return result;
  }
  stateAt(index: number): RuntimeSnapshot {
    this.#assertIndex(index);
    const chain: EngineJournalEvent[] = [];
    let cursor = index;
    while (!this.#snapshots.has(cursor)) {
      const record = this.#eventAt(cursor);
      chain.unshift(record);
      cursor = record.parentIndex;
    }
    const runtime = this.#replayRuntime(), base = this.#snapshots.get(cursor);
    if (!base) throw new Error(`journal_corrupt:snapshot_${cursor}_missing`);
    runtime.restore(base);
    for (const record of chain) runtime.dispatch(record.event.id, record.event.params as RuntimeRecord);
    return runtime.snapshot();
  }
  moveTo(index: number) {
    const snapshot = this.stateAt(index);
    this.#cursor = index;
    this.#expectedHash = stateHash(snapshot);
    this.#expectedRng = snapshot.rng;
    this.#runtime.restore(snapshot);
    return this.head();
  }
  truncateTo(index: number) {
    this.#assertIndex(index);
    this.#events = this.#events.slice(0, index - this.#baseIndex);
    this.#eventsChain = journalEventsChain(this.#events);
    for (const key of [...this.#snapshots.keys()]) if (key > index) this.#snapshots.delete(key);
    return this.moveTo(index);
  }
  head() {
    // 커서 이동·append마다 유지되는 기대 해시가 곧 머리의 상태 해시다 — save마다 전체 상태를
    // 다시 문자열화하지 않는다(파동 3). 외부 변조는 다음 append의 발산 감시가 잡는다.
    return { index: this.#cursor, stateHash: this.#expectedHash, rng: this.#expectedRng };
  }
  reset(snapshot: RuntimeSnapshot) {
    this.#schemaHash = this.#targetSchemaHash;
    this.#initial = clone(snapshot);
    this.#initialDigest = stableHash(this.#initial);
    this.#expectedHash = stateHash(snapshot);
    this.#expectedRng = snapshot.rng;
    this.#events = [];
    this.#eventsChain = journalEventsChain([]);
    this.#sealedEpochs = [];
    this.#baseIndex = 0;
    this.#snapshots = new Map([[0, clone(snapshot)]]);
    this.#cursor = 0;
    this.#runtime.restore(snapshot);
  }
  seal(migratedInitial: RuntimeSnapshot, newSchemaHash: string) {
    const head = this.head(), events = this.#events.slice(0, Math.max(0, head.index - this.#baseIndex)),
      payload: Omit<SealedEngineJournalEpoch, "sealHash"> = {
        schemaHash: this.#schemaHash,
        initial: { state: jsonRecord(clone(this.#initial.state)), rng: this.#initial.rng },
        events: clone(events),
        head,
        sealedIndex: head.index,
      },
      epoch: SealedEngineJournalEpoch = { ...payload, sealHash: sha256Stable(epochPayload(payload)) };
    this.#sealedEpochs.push(epoch);
    this.#baseIndex = head.index;
    this.#schemaHash = newSchemaHash;
    this.#initial = clone(migratedInitial);
    this.#initialDigest = stableHash(this.#initial);
    this.#expectedHash = stateHash(migratedInitial);
    this.#expectedRng = migratedInitial.rng;
    this.#events = [];
    this.#eventsChain = journalEventsChain([]);
    this.#cursor = this.#baseIndex;
    this.#snapshots = new Map([[this.#baseIndex, clone(migratedInitial)]]);
    this.#runtime.restore(migratedInitial);
    return clone(epoch);
  }
  #dataCore() {
    return {
      contract: "simbot-event-journal/0.2" as const,
      schemaHash: this.#schemaHash,
      baseIndex: this.#baseIndex,
      initial: { state: jsonRecord(clone(this.#initial.state)), rng: this.#initial.rng },
      snapshotInterval: this.#snapshotInterval,
      events: clone(this.#events),
      cursor: this.#cursor,
      head: this.head(),
    };
  }
  sealedEpochRefs(): SealedEpochRef[] {
    return this.#sealedEpochs.map((epoch, offset) => ({ offset, sealedIndex: epoch.sealedIndex, sealHash: epoch.sealHash, schemaHash: epoch.schemaHash }));
  }
  get sealedEpochCount() { return this.#sealedEpochs.length; }
  // 영속용 읽기 전용 뷰 — 클론 없이 내보내므로 호출자는 절대 변형하지 말 것(봉인 본문은 불변).
  sealedEpochAt(offset: number): SealedEngineJournalEpoch | undefined { return this.#sealedEpochs[offset]; }
  // 저장 시점의 저널 섹션 해시 — 롤링 체인·캐시 다이제스트로 O(1). 순수 검증 함수와 동일 재료·동일 결과.
  currentIntegrityHash() {
    return stableHash({
      contract: "simbot-event-journal/0.2" as const,
      schemaHash: this.#schemaHash,
      baseIndex: this.#baseIndex,
      initialDigest: this.#initialDigest,
      snapshotInterval: this.#snapshotInterval,
      cursor: this.#cursor,
      head: this.head(),
      eventsChain: this.#eventsChain,
      sealed: this.#sealedEpochs.map((epoch) => ({ sealedIndex: epoch.sealedIndex, sealHash: epoch.sealHash })),
    });
  }
  // 디스크 핫 저장용: 봉인 본문 없이 참조만 — 본문은 sealed-epoch 레코드가 1회 보관한다(파동 2).
  toPersistedJSON(): EngineJournalDataV02 {
    return { ...this.#dataCore(), sealedEpochs: [], ...(this.#sealedEpochs.length ? { sealedEpochRefs: this.sealedEpochRefs() } : {}) };
  }
  toJSON(): EngineJournalDataV02 {
    return {
      ...this.#dataCore(),
      sealedEpochs: clone(this.#sealedEpochs),
    };
  }
  restore(data: EngineJournalData) {
    const normalized = this.#validateShape(data);
    if (data.schemaHash !== this.#targetSchemaHash) throw new Error("journal_schema_mismatch");
    const runtime = this.#replayRuntime(), states = new Map<number, RuntimeSnapshot>(),
      initial = { state: clone(data.initial.state) as RuntimeRecord, rng: data.initial.rng };
    states.set(normalized.baseIndex, initial);
    for (const record of data.events) {
      const parent = states.get(record.parentIndex);
      if (!parent) throw new Error(`journal_corrupt:event_${record.index}_parent`);
      runtime.restore(parent);
      const result = runtime.dispatch(record.event.id, record.event.params as RuntimeRecord),
        ok = result.log.some((entry) => entry.ok === true), snapshot = runtime.snapshot();
      if (record.ok !== ok) throw new Error(`journal_corrupt:event_${record.index}_verdict`);
      if (stableHash(result.log) !== stableHash(record.log)) throw new Error(`journal_corrupt:event_${record.index}_log`);
      if (record.stateHash !== stateHash(snapshot)) throw new Error(`journal_corrupt:event_${record.index}_state`);
      if (record.rng !== snapshot.rng) throw new Error(`journal_corrupt:event_${record.index}_rng`);
      states.set(record.index, snapshot);
    }
    const current = states.get(data.cursor);
    if (!current) throw new Error("journal_cursor_missing");
    if (data.head.stateHash !== stateHash(current) || data.head.rng !== current.rng) throw new Error("journal_corrupt:head");
    this.#adopt(data, normalized, initial, current, states);
  }
  adoptForSeal(data: EngineJournalData, trustedHead: RuntimeSnapshot) {
    const normalized = this.#validateShape(data);
    if (data.head.stateHash !== stateHash(trustedHead) || data.head.rng !== trustedHead.rng)
      throw new Error("journal_corrupt:trusted_head");
    const initial = { state: clone(data.initial.state) as RuntimeRecord, rng: data.initial.rng };
    this.#schemaHash = data.schemaHash;
    this.#sealedEpochs = normalized.epochs;
    this.#baseIndex = normalized.baseIndex;
    this.#initial = initial;
    this.#initialDigest = stableHash(this.#initial);
    this.#expectedHash = data.head.stateHash;
    this.#expectedRng = trustedHead.rng;
    this.#events = clone(data.events) as EngineJournalEvent[];
    this.#eventsChain = journalEventsChain(this.#events);
    this.#snapshotInterval = Math.max(1, Math.trunc(data.snapshotInterval) || 50);
    this.#snapshots = new Map([[this.#baseIndex, clone(initial)]]);
    this.#cursor = data.cursor;
    this.#runtime.restore(trustedHead);
  }
  #validateShape(data: EngineJournalData) {
    if (!data || (data.contract !== "simbot-event-journal/0.1" && data.contract !== "simbot-event-journal/0.2"))
      throw new Error("journal_contract_mismatch");
    if (!data.initial || !Number.isFinite(data.initial.rng) || !data.initial.state) throw new Error("journal_initial_invalid");
    const normalized = verifiedSealedEpochs(data), max = normalized.baseIndex + data.events.length;
    for (let offset = 0; offset < data.events.length; offset++) {
      const record = data.events[offset], expected = normalized.baseIndex + offset + 1;
      if (!record || record.index !== expected || !Number.isInteger(record.parentIndex) || record.parentIndex < normalized.baseIndex || record.parentIndex >= record.index)
        throw new Error(`journal_corrupt:event_${expected}_index`);
    }
    if (!Number.isInteger(data.cursor) || data.cursor < normalized.baseIndex || data.cursor > max)
      throw new Error("journal_cursor_invalid");
    if (data.head.index !== data.cursor) throw new Error("journal_corrupt:head");
    return normalized;
  }
  #adopt(data: EngineJournalData, normalized: ReturnType<typeof verifiedSealedEpochs>, initial: RuntimeSnapshot, current: RuntimeSnapshot, states: Map<number, RuntimeSnapshot>) {
    this.#schemaHash = data.schemaHash;
    this.#sealedEpochs = normalized.epochs;
    this.#baseIndex = normalized.baseIndex;
    this.#initial = initial;
    this.#initialDigest = stableHash(this.#initial);
    this.#expectedHash = stateHash(current);
    this.#expectedRng = current.rng;
    this.#events = clone(data.events) as EngineJournalEvent[];
    this.#eventsChain = journalEventsChain(this.#events);
    this.#snapshotInterval = Math.max(1, Math.trunc(data.snapshotInterval) || 50);
    this.#snapshots = new Map([[this.#baseIndex, clone(initial)]]);
    for (const [index, snapshot] of states)
      if (index !== this.#baseIndex && (index - this.#baseIndex) % this.#snapshotInterval === 0) this.#snapshots.set(index, clone(snapshot));
    this.#cursor = data.cursor;
    this.#runtime.restore(current);
  }
  #assertIndex(index: number) {
    if (Number.isInteger(index) && index < this.#baseIndex) throw new Error(`epoch_sealed:${index}`);
    if (!Number.isInteger(index) || index > this.#baseIndex + this.#events.length)
      throw new RangeError(`journal_index_out_of_range:${index}`);
  }
  #eventAt(index: number) {
    const record = this.#events[index - this.#baseIndex - 1];
    if (!record) throw new Error(`journal_corrupt:event_${index}_missing`);
    return record;
  }
  #replayRuntime() {
    return new ProjectRuntime(this.#runtime.project, 1, this.#runtime.registry);
  }
}
