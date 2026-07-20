import type { EngineJournalData, EngineJournalDataV02, EngineJournalEvent, MemoryArchivePage, MemoryRecord, SealedEngineJournalEpoch, SealedEpochRef } from "@simbot/contracts";
import {
  ContinuityPatchLedger,
  ingestMemoryTurn,
  memoryRecord,
  MemoryLedger,
  planPerspectiveMemory,
  reconcileMemorySources,
  validateFactReferences,
  verifyNarrative,
  type ContinuityPatchInput,
  type ContinuityPatchRecord,
  type EmbeddingProvider,
  type FactReferenceInput,
  type FactReferenceVerdict,
  type MemoryCandidateInput,
  type MemoryDecision,
  type MemoryEvidenceEvent,
  type NarrativeIssue,
  type PerspectiveMemoryTrace,
} from "@simbot/memory";
import { ingestHiddenMemoryPacket, withMemoryCaptureContract } from "./memory-contract.ts";
import type { SessionRepository } from "@simbot/persistence";
import {
  activateLore,
  applyRegexScripts,
  compilePrompt,
  estimateTokens,
  normalizeLoreEntries,
  setActiveRenderContext,
  stripPromptImageMarkup,
  type CardRuntimeSnapshot,
  type CardStateOwnership,
  type AssetMacroAsset,
  type CompiledPrompt,
  type LoreEntry,
  type Persona,
  type PromptPreset,
  type RegexScript,
  type RuntimeWorkerSuccess,
} from "@simbot/risu";
import { buildSpriteCatalog, spriteCommandGuide } from "./sprite-catalog.ts";
import {
  BUTTON_ONLY_EVENTS,
  resolveSpeakerList,
  type ProjectRuntime,
  type SpeakerReference,
} from "@simbot/runtime";
import {
  SessionJournal,
  fnv1a,
  journalIntegrityHash,
  stableHash,
  stableStringify,
} from "./journal.ts";
import {
  CardRuntimeJournal,
  type CardRuntimeJournalData,
} from "./card-runtime-journal.ts";
import { auxProviderFor, type AuxConfig } from "./providers/auxiliary.ts";
export * from "./openai-compatible.ts";
export * from "./journal.ts";
export * from "./card-runtime-journal.ts";
export { maskSecrets } from "./providers/openai.ts"; // 진단 복사본에 키가 새지 않게 — 마스킹 로직은 하나만 존재해야 한다

export { createVoyageProvider } from "@simbot/memory";

// 카드 태그 채널이 dispatch할 수 있는 이벤트의 명시적 허용목록(방어 심층).
// 번역기는 지금 이 8종만 내지만, 번역기가 넓어져도 세션이 조용히 채널을 열어주지 않도록 여기서 고정한다.
// (LLM은 본문 태그를 자유롭게 쓸 수 있으므로 이 채널의 상한이 곧 LLM의 상태 조작 상한이다.)
export const CARD_TAG_EVENTS = new Set<string>([
  "gold_delta",
  "resource_delta",
  "scale_delta",
  "checkin",
  "checkout",
  "day_end",
  "hire",
  "fire",
  "panel_sync",
]);
export interface MessageChip {
  ok: boolean;
  text: string;
  kind?: string;
}
export interface ChatMessage {
  id: string;
  index: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  origin?: "model" | "greeting" | "user" | "engine" | "ledger";
  translation?: string;
  facts?: Record<string, unknown>[];
  chips?: MessageChip[];
  speakers?: SpeakerReference[];
}
export interface MessageOutlineEntry {
  readonly id: string;
  readonly index: number;
  readonly role: ChatMessage["role"];
  readonly origin: NonNullable<ChatMessage["origin"]>;
}
export interface ProposedEvent {
  id: string;
  params?: Record<string, unknown>;
}
export interface NarrativeResponse {
  text: string;
  events?: ProposedEvent[];
  speakers?: Array<{ npcId: string; emotion?: string; focus?: boolean }>;
  memories?: MemoryCandidateInput[];
  factRefs?: FactReferenceInput[];
  continuityPatch?: ContinuityPatchInput;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  model?: string;
  finishReason?: string;
  generationId?: string;
}
export interface PromptRun {
  id: string;
  turn: number;
  kind: "send" | "reroll" | "continue" | "management";
  createdAt: string;
  prompt?: CompiledPrompt;
  promptHash?: string;
  responseText: string;
  proposedEvents: ProposedEvent[];
  logs: Record<string, unknown>[];
  memoryDecisions?: MemoryDecision[];
  factReferenceVerdicts?: FactReferenceVerdict[];
  continuityPatchId?: string;
  memoryTrace?: PerspectiveMemoryTrace;
  stateBefore?: { state: Record<string, unknown>; rng: number };
  stateAfter?: { state: Record<string, unknown>; rng: number };
  stateBeforeHash?: string;
  stateAfterHash?: string;
  issues: NarrativeIssue[];
  provider?: string;
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensEstimated?: boolean;
  finishReason?: string;
  generationId?: string;
}
export interface ModelRequest {
  prompt: CompiledPrompt;
  signal?: AbortSignal;
  format?: "prose" | "json";
  purpose?: "chat" | "management";
}
export interface ModelProvider {
  complete(request: ModelRequest): Promise<NarrativeResponse>;
}
export type SessionActionPhase =
  | "session-start"
  | "background-save-wait-start"
  | "background-save-wait-complete"
  | "base-persist-complete"
  | "checkpoint-complete"
  | "engine-complete"
  | "memory-complete"
  | "prompt-complete"
  | "provider-complete"
  | "receipt-complete"
  | "action-durable"
  | "save-start"
  | "wal-build-complete"
  | "save-complete";
export type SessionActionTrace = (phase: SessionActionPhase, at: number) => void;
function traceAction(trace: SessionActionTrace | undefined, phase: SessionActionPhase) {
  trace?.(phase, performance.now());
}
export interface SessionBindings {
  persona: Persona | null;
  preset: PromptPreset;
}
// 체크포인트는 프리셋 전체(임포트 raw 포함 수십 KB) 대신 참조만 든다 — 본문은 세션의
// presetSnapshots 사전에 1회 보존(성능 수술 파동 1b). preset 인라인은 구형 저장 하위호환.
export interface SessionCheckpointBindings {
  persona: Persona | null;
  preset?: PromptPreset;
  presetRef?: { id: string; version: number };
}
export interface SessionCheckpoint {
  turn: number;
  messageCount: number;
  messages?: ChatMessage[];
  memory: MemoryRecord[];
  memoryArchivePages?: MemoryArchivePage[];
  continuityPatches?: ContinuityPatchRecord[];
  lastLogs: Record<string, unknown>[];
  cbsVariables: Record<string, string>;
  lastSpeakers: SpeakerReference[];
  alternates: AlternateState[];
  ledgerDeltas?: string[];
  ledgerNarrativeQueue?: LedgerNarrativeDelta[];
  journalCursor: number;
  cardRuntimeCursor?: number;
  bindings: SessionCheckpointBindings;
}
export interface SessionHistory {
  undo: SessionCheckpoint[];
  redo: SessionCheckpoint[];
  presetSnapshots?: Record<string, PromptPreset>;
}
export interface SessionSnapshot {
  contract: "simbot-play-session/0.1";
  id: string;
  projectId: string;
  schemaFingerprint?: string;
  turn: number;
  messages: ChatMessage[];
  engine: { state: Record<string, unknown>; rng: number };
  memory: MemoryRecord[];
  memoryArchivePages?: MemoryArchivePage[];
  continuityPatches?: ContinuityPatchRecord[];
  lastLogs: Record<string, unknown>[];
  cbsVariables?: Record<string, string>;
  cardRuntimeJournal?: CardRuntimeJournalData;
  lastSpeakers?: SpeakerReference[];
  alternates?: AlternateState[];
  responseBranches?: ResponseBranchSet[];
  promptRuns?: PromptRun[];
  journal?: EngineJournalData;
  history?: SessionHistory;
  bindings?: SessionBindings;
  ledgerDeltas?: string[];
  ledgerNarrativeQueue?: LedgerNarrativeDelta[];
  integrity?: string;
  // 2 = 섹션 해시 합성(파동 3). 부재 = 구형 전체 직렬화 서명 — restore가 버전별로 검증한다.
  integrityVersion?: number;
  // 파동 4: 디스크 핫 저장은 큰 배열(메시지·저널 이벤트)을 청크 레코드로 내보내고 코어엔 목록만 남긴다.
  // integrity는 '조립된 전체'에 대한 서명이므로 청크 변조·누락은 조립 후 검증에서 잡힌다.
  shardManifest?: SessionShardManifest;
  // 조립 단계가 별도 레코드에서 가져와 붙이는 봉인 본문 — integrity 서명 범위 밖(참조의 sealHash가 본문을 검증).
  sealedEpochBodies?: SealedEngineJournalEpoch[];
  // 디스크 조립 단계에서만 붙는 외부 WAL. 본체 integrity에는 포함하지 않고 자체 hash와 baseIntegrity로 검증한다.
  pendingActionReceipt?: ActionWalReceipt;
}
export const SEALED_EPOCH_CONTRACT = "simbot-sealed-epoch/0.1";
export const SESSION_SHARD_CONTRACT = "simbot-session-shard/0.1";
export const MESSAGE_SHARD_SIZE = 100;
export const JOURNAL_SHARD_SIZE = 200;
export interface SessionShardManifest {
  version: 1;
  messages: { chunkSize: number; total: number; chunks: string[] };
  journalEvents: { chunkSize: number; total: number; chunks: string[] };
}
interface SessionSaveBatch{messages:ChatMessage[];events:EngineJournalEvent[];shell:EngineJournalData;core:SessionSnapshot;epochs:Array<{offset:number;epoch:SealedEngineJournalEpoch}>;messageHashes:string[]|null;journalHashes:string[]|null;walCutoff:number;}
export interface LedgerNarrativeDelta {
  key: string;
  eventId: string;
  count: number;
  firstJournalIndex: number;
  lastJournalIndex: number;
  summaries: string[];
}
export const ACTION_WAL_CONTRACT = "simbot-action-wal/0.1";
export interface ActionWalEntry {
  mode: "ledger" | "narrated";
  events: EngineJournalEvent[];
  expectedJournalCursor: number;
  expectedStateHash: string;
  expectedRng: number;
  expectedLogsHash: string;
  turnAfter: number;
}
export interface ActionWalReceipt {
  contract: typeof ACTION_WAL_CONTRACT;
  sessionId: string;
  baseIntegrity: string;
  mode: "ledger" | "narrated";
  events: EngineJournalEvent[];
  expectedJournalCursor: number;
  expectedStateHash: string;
  expectedRng: number;
  expectedLogsHash: string;
  turnAfter: number;
  actions?: ActionWalEntry[];
  hash: string;
}
function actionWalHash(value: Omit<ActionWalReceipt, "hash">) {
  return stableHash(value);
}
interface SessionShardRecord {
  contract: typeof SESSION_SHARD_CONTRACT;
  sessionId: string;
  kind: "messages" | "journal-events";
  offset: number;
  items: unknown[];
}
export const MAX_SESSION_IMPORT_BYTES = 30 * 1024 * 1024;
export function parseSessionBackup(
  text: string,
  byteLength = new TextEncoder().encode(text).byteLength,
): SessionSnapshot {
  if (byteLength > MAX_SESSION_IMPORT_BYTES)
    throw new Error("session_import_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("session_import_json_invalid");
  }
  const value = (
    raw && typeof raw === "object" && "snapshot" in raw
      ? (raw as { snapshot?: unknown }).snapshot
      : raw
  ) as Partial<SessionSnapshot> | null;
  if (!value || value.contract !== "simbot-play-session/0.1")
    throw new Error("session_import_contract_mismatch");
  return value as SessionSnapshot;
}
// 세션 무결성 — 저장 시 페이로드 해시를 심고 복구 시 재계산해 변조·손상 파일을 거부한다
// (마이그레이션 감사 Critical: 복구가 contract·projectId만 보고 무검증 주입하던 것 보완. 옛 sessionJournal 손상감지 이관).
// 무결성 해시는 복원되는 페이로드 전부를 덮어야 한다. cbsVariables(카드 변수 저장소)가 해시 밖에 있으면
// 저장 파일의 변수만 고쳐 검증을 우회할 수 있다(통합 감사 Critical). 단 구 스냅샷은 이 필드가 없으므로
// '있을 때만' 해시에 포함해 기존 저장분의 해시를 바꾸지 않는다(하위호환).
// integrity v2 — 섹션 해시 합성(파동 3). 커버리지는 v1과 등가(복원되는 전 섹션)이며 계산만 증분화:
// 저장 시 큰 섹션(저널·메시지)은 세션이 유지하는 롤링 체인을 재사용하고, 검증 시엔 전체 재계산으로 대조한다.
export function messagesChainHash(messages: readonly ChatMessage[], seed = "0") {
  let chain = seed;
  for (const message of messages) chain = fnv1a(chain + stableHash(message));
  return chain;
}
export function sessionIntegrityV2(
  snapshot: Omit<SessionSnapshot, "integrity">,
  precomputed: Partial<Record<"journal" | "messages", string>> = {},
): { integrity: string; sections: Record<string, string> } {
  const sections: Record<string, string> = {
    meta: stableHash({
      projectId: snapshot.projectId,
      ...(snapshot.schemaFingerprint ? { schemaFingerprint: snapshot.schemaFingerprint } : {}),
      turn: snapshot.turn,
    }),
    messages: precomputed.messages ?? messagesChainHash(snapshot.messages),
    engine: stableHash(snapshot.engine),
    memory: snapshot.memoryArchivePages
      ? stableHash({active:snapshot.memory,archivePages:snapshot.memoryArchivePages})
      : stableHash(snapshot.memory),
    ...(snapshot.journal ? { journal: precomputed.journal ?? journalIntegrityHash(snapshot.journal) } : {}),
    ...(snapshot.history ? { history: stableHash(snapshot.history) } : {}),
    ...(snapshot.bindings ? { bindings: stableHash(snapshot.bindings) } : {}),
    extras: stableHash({
      ...(snapshot.continuityPatches ? { continuityPatches: snapshot.continuityPatches } : {}),
      ...(snapshot.cbsVariables ? { cbsVariables: snapshot.cbsVariables } : {}),
      ...(snapshot.cardRuntimeJournal ? { cardRuntimeJournal: snapshot.cardRuntimeJournal } : {}),
      ...(snapshot.lastSpeakers ? { lastSpeakers: snapshot.lastSpeakers } : {}),
      ...(snapshot.alternates ? { alternates: snapshot.alternates } : {}),
      ...(snapshot.responseBranches ? { responseBranches: snapshot.responseBranches } : {}),
      ...(snapshot.promptRuns ? { promptRuns: snapshot.promptRuns } : {}),
      ...(snapshot.ledgerDeltas ? { ledgerDeltas: snapshot.ledgerDeltas } : {}),
      ...(snapshot.ledgerNarrativeQueue ? { ledgerNarrativeQueue: snapshot.ledgerNarrativeQueue } : {}),
      lastLogs: snapshot.lastLogs,
    }),
  };
  return { integrity: fnv1a(stableStringify({ v: 2, sections })), sections };
}
export function sessionIntegrity(
  snapshot: Omit<SessionSnapshot, "integrity">,
): string {
  return fnv1a(
    stableStringify({
      projectId: snapshot.projectId,
      ...(snapshot.schemaFingerprint
        ? { schemaFingerprint: snapshot.schemaFingerprint }
        : {}),
      turn: snapshot.turn,
      messages: snapshot.messages,
      engine: snapshot.engine,
      memory: snapshot.memory,
      ...(snapshot.memoryArchivePages ? { memoryArchivePages: snapshot.memoryArchivePages } : {}),
      ...(snapshot.continuityPatches
        ? { continuityPatches: snapshot.continuityPatches }
        : {}),
      ...(snapshot.cbsVariables ? { cbsVariables: snapshot.cbsVariables } : {}),
      ...(snapshot.cardRuntimeJournal
        ? { cardRuntimeJournal: snapshot.cardRuntimeJournal }
        : {}),
      ...(snapshot.lastSpeakers ? { lastSpeakers: snapshot.lastSpeakers } : {}),
      ...(snapshot.alternates ? { alternates: snapshot.alternates } : {}),
      ...(snapshot.responseBranches
        ? { responseBranches: snapshot.responseBranches }
        : {}),
      ...(snapshot.promptRuns ? { promptRuns: snapshot.promptRuns } : {}),
      ...(snapshot.journal ? { journal: snapshot.journal } : {}),
      ...(snapshot.history ? { history: snapshot.history } : {}),
      ...(snapshot.bindings ? { bindings: snapshot.bindings } : {}),
      ...(snapshot.ledgerDeltas ? { ledgerDeltas: snapshot.ledgerDeltas } : {}),
      ...(snapshot.ledgerNarrativeQueue ? { ledgerNarrativeQueue: snapshot.ledgerNarrativeQueue } : {}),
    }),
  );
}
function runtimeSchemaFingerprint(runtime: ProjectRuntime) {
  return fnv1a(stableStringify(runtime.project.schema));
}
const MEMORY_ANCHOR_KEYS = [
  "target",
  "npcId",
  "resource",
  "resourceId",
  "scale",
  "axis",
  "stat",
  "questId",
  "facilityId",
  "roomId",
  "itemId",
  "recipeId",
  "slotId",
  "dollId",
  "echelonId",
  "missionId",
  "locationId",
] as const;
function engineMemoryAnchor(eventId: string, log: Record<string, unknown>) {
  const parts = [eventId];
  for (const key of MEMORY_ANCHOR_KEYS)
    if (
      Object.hasOwn(log, key) &&
      ["string", "number", "boolean"].includes(typeof log[key])
    )
      parts.push(`${key}=${String(log[key])}`);
  return `engine:${parts.join(":")}`;
}
const MAX_LEDGER_NARRATIVE_GROUPS = 24;
const MAX_LEDGER_NARRATIVE_SAMPLES = 3;
function ledgerNarrativeSummary(log: Record<string, unknown>) {
  const text = stableStringify(log);
  return text.length > 600 ? `${text.slice(0, 597)}…` : text;
}
function legacyLedgerQueue(values: readonly string[]): LedgerNarrativeDelta[] {
  return values.slice(-MAX_LEDGER_NARRATIVE_GROUPS).map((summary, index) => ({
    key: `legacy:${index}`,
    eventId: "legacy",
    count: 1,
    firstJournalIndex: -1,
    lastJournalIndex: -1,
    summaries: [summary],
  }));
}
// UI가 건네는 값은 프레임워크 프록시($state 등)일 수 있고 structuredClone은 Proxy를 복제하지 못한다.
// caller 경계에서만 관용적으로 복제한다 — 세션 데이터는 어차피 JSON 직렬화 대상이라 폴백이 안전하다.
function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value === null || typeof value !== "object"
      ? value
      : (JSON.parse(JSON.stringify(value)) as T);
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const unsafeRuntimeKeys = new Set(["__proto__", "constructor", "prototype"]);
function safeRuntimeKey(value: string) {
  return !!value && value.length <= 256 && !unsafeRuntimeKeys.has(value);
}
function presetToggleDefaults(preset:PromptPreset){const defaults:Record<string,string>={};for(const toggle of preset.toggles??[])if(toggle.type!=='decor'){const key=`toggle_${toggle.key}`;if(safeRuntimeKey(key))defaults[key]=toggle.type==='text'?'':'0';}return defaults;}
function activeModules(project: ProjectRuntime["project"]) {
  const declared = object(project.content).activeModules;
  return [
    ...new Set([
      ...(project.moduleIds ?? []),
      ...(Array.isArray(declared) ? declared.map(String) : []),
    ]),
  ];
}
function narrativeCatalog(project: ProjectRuntime["project"], assets: readonly Pick<AssetMacroAsset,"name"|"type"|"mime"|"moduleNamespace">[] = [], allowNsfw = false) {
  const schema = project.schema,
    block = (Array.isArray(schema.entities) ? schema.entities : [])
      .map(object)
      .find((value) => value.type === "npc"),
    npcs = (Array.isArray(block?.instances) ? block.instances : []).map(object),
    aliases = npcs.map((npc) =>
      [
        npc.id,
        npc.nameKo,
        npc.name,
        npc.nameEn,
        ...(Array.isArray(npc.aliases) ? npc.aliases : []),
      ]
        .map(String)
        .filter(Boolean),
    ),
    sprites = buildSpriteCatalog(
      aliases.map((items) => ({ aliases: items })),
      assets,
      {
        allowNsfw,
        flatCommands: Array.isArray(object(project.content).assetCommands)
          ? (object(project.content).assetCommands as unknown[]).map(String)
          : [],
      },
    );
  return {
    npcs: npcs.map(
      (npc, index) =>
        `${String(npc.id ?? `npc-${index}`)} (${String(npc.nameKo ?? npc.name ?? npc.nameEn ?? npc.id ?? "이름 없음")})`,
    ),
    sprites,
  };
}
function compactPromptRuns(runs: PromptRun[]) {
  const kept = runs.slice(-500),
    detailedFrom = Math.max(0, kept.length - 8);
  return kept.map((run, index) => {
    if (index >= detailedFrom) return run;
    const { prompt: _, stateBefore: __, stateAfter: ___, ...summary } = run;
    return summary;
  });
}
export interface PlaySessionOptions {
  id: string;
  runtime: ProjectRuntime;
  provider: ModelProvider;
  providerInfo?: { provider?: string; model?: string };
  preset: PromptPreset;
  persona?: Persona | null;
  maxContext?: number | undefined;
  card: {
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    systemPrompt?: string;
    postHistoryInstructions?: string;
  };
  loreEntries?: unknown[];
  memory?: MemoryLedger;
  embeddingProvider?: EmbeddingProvider;
  aux?: AuxConfig;
  repository?: SessionRepository<SessionSnapshot>;
  historyWindow?: number;
  tagTranslator?: (text: string) => {
    events: Array<{ id: string; params: Record<string, unknown> }>;
    residue: string;
  };
  speakerExtractor?: (
    text: string,
  ) => NonNullable<NarrativeResponse["speakers"]>;
  regexScripts?: RegexScript[];
  defaultVariables?: Record<string, string>;
  assets?: readonly AssetMacroAsset[];
  stateOwnership?: CardStateOwnership;
}
// 대안은 세션의 파생 상태 전부(기억 원장·무대 화자 포함)를 함께 보관해야 한다 — 일부만 되돌리면 기각된 평행세계가 원장에 남는다(감사 계열: restore 메모리 미청소).
export interface AlternateState {
  messages: ChatMessage[];
  engine: { state: Record<string, unknown>; rng: number };
  logs: Record<string, unknown>[];
  memory: MemoryRecord[];
  memoryArchivePages?: MemoryArchivePage[];
  continuityPatches?: ContinuityPatchRecord[];
  speakers: SpeakerReference[];
  promptRuns: PromptRun[];
  ledgerDeltas?: string[];
  ledgerNarrativeQueue?: LedgerNarrativeDelta[];
  journalCursor?: number;
  cardRuntimeCursor?: number;
  turn?: number;
  cbsVariables?: Record<string, string>;
  bindings?: SessionBindings;
}
export interface ResponseBranchSet {
  messageId: string;
  active: number;
  variants: AlternateState[];
}

export class PlaySession {
  readonly id: string;
  readonly runtime: ProjectRuntime;
  readonly memory: MemoryLedger;
  #provider: ModelProvider;
  #providerInfo: NonNullable<PlaySessionOptions["providerInfo"]>;
  #embeddingProvider: EmbeddingProvider | undefined;
  #preset: PromptPreset;
  #persona: Persona | null;
  #maxContext: number | undefined;
  readonly #card: PlaySessionOptions["card"];
  readonly #stateOwnership: CardStateOwnership;
  readonly #lore: LoreEntry[];
  readonly #repository: SessionRepository<SessionSnapshot> | undefined;
  readonly #historyWindow: number;
  readonly #tagTranslator: PlaySessionOptions["tagTranslator"];
  readonly #speakerExtractor: PlaySessionOptions["speakerExtractor"];
  #messages: ChatMessage[] = [];
  #turn = 0;
  #lastLogs: Record<string, unknown>[] = [];
  #lastSpeakers: SpeakerReference[] = [];
  #busy = false;
  #messageSeq = 0;
  #auxSeq = 0;
  #aux: AuxConfig = { enabled: false, slots: {} };
  #checkpoints: SessionCheckpoint[] = [];
  #redoStack: SessionCheckpoint[] = [];
  #presetSnapshots = new Map<string, PromptPreset>();
  #persistedEpochOffsets = new Set<number>();
  // 메시지 섹션 롤링 체인 — append는 O(1) 연장, 그 외 변형은 무효화 후 다음 저장에서 1회 재계산.
  #messagesChain: { count: number; hash: string } | null = null;
  // 파동 4 샤드 상태 — 완결 청크 해시 캐시(append-only 동안 유효). null이면 다음 저장이 전량 재기록.
  #messageShardHashes: string[] | null = null;
  #journalShardHashes: string[] | null = null;
  #persistedIntegrity: string | null = null;
  #backgroundSave: Promise<void> | null = null;
  #backgroundSaveTimer: ReturnType<typeof setTimeout> | null = null;
  #backgroundSaveError: unknown = null;
  #walPresent = false;
  #pendingWalActions: ActionWalEntry[] = [];
  #walTail: Promise<void> = Promise.resolve();
  #alternates: AlternateState[] = [];
  #responseBranches: ResponseBranchSet[] = [];
  #promptRuns: PromptRun[] = [];
  #lastMemoryTrace: PerspectiveMemoryTrace | undefined;
  #narrativeIssues: NarrativeIssue[] = [];
  // 다음 서사 장면에 아직 전달하지 않은 엔진 사실만 둔다. 원본은 저널에 있으므로 같은 사건은
  // 식별 앵커별로 접고 최근 표본만 보존한다 — silent 장기 플레이가 이 배열을 무한히 키우지 않는다.
  #ledgerNarrativeQueue: LedgerNarrativeDelta[] = [];
  #listeners = new Set<() => void>();
  #messageRevision = 0;
  #messageOutlineRevision = -1;
  #messageOutline: readonly MessageOutlineEntry[] = [];
  #regexScripts: RegexScript[];
  #cbsVariables: Record<string, string>;
  #assets: Array<Pick<AssetMacroAsset,"name"|"type"|"mime"|"moduleNamespace">> = [];
  #journal: SessionJournal;
  #cardRuntimeJournal: CardRuntimeJournal;
  #continuityPatches = new ContinuityPatchLedger();
  // 리스처럼 사용자 입력은 즉시 화면에 올라가야 한다 — UI가 응답을 기다리지 않고 갱신하도록 변경을 알린다.
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #engineStateForPrompt() {
    return { ...this.runtime.state, moduleFacts: this.runtime.promptFacts() };
  }
  #notify() {
    for (const listener of this.#listeners) listener();
  }
  #messagesChanged() {
    this.#messageRevision += 1;
    this.#messageOutlineRevision = -1;
  }
  constructor(options: PlaySessionOptions) {
    this.id = options.id;
    this.runtime = options.runtime;
    const rawDispatch = this.runtime.dispatch.bind(this.runtime);
    this.#journal = new SessionJournal(this.runtime, rawDispatch);
    this.runtime.dispatch = (id, params = {}) =>
      this.#journal.append(id, params);
    this.#provider = options.provider;
    this.#providerInfo = clone(options.providerInfo ?? {});
    this.#embeddingProvider = options.embeddingProvider;
    this.#aux = options.aux
      ? clone(options.aux)
      : { enabled: false, slots: {} };
    this.#preset = clone(options.preset);
    this.#rememberPreset(this.#preset);
    this.#persona = options.persona ? clone(options.persona) : null;
    this.#maxContext = options.maxContext;
    this.#card = clone(options.card);
    this.#stateOwnership = options.stateOwnership ?? "card";
    this.#lore = normalizeLoreEntries(options.loreEntries ?? []);
    this.memory = options.memory ?? new MemoryLedger();
    this.#repository = options.repository;
    this.#historyWindow = Math.max(8, options.historyWindow ?? 40);
    this.#tagTranslator = options.tagTranslator;
    this.#speakerExtractor = options.speakerExtractor;
    this.#regexScripts = clone(options.regexScripts ?? []);
    this.#cbsVariables = {...presetToggleDefaults(this.#preset),...clone(options.defaultVariables ?? {})};
    this.setAssets(options.assets ?? []);
    const seed =
      parseInt(fnv1a(`${this.id}:${this.runtime.project.projectId}`), 16) >>> 0;
    this.#cardRuntimeJournal = new CardRuntimeJournal({
      variables: this.#cbsVariables,
      randomState: seed || 1,
      logicalTimeMs: 1_700_000_000_000,
    });
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
  }
  get messages() {
    return this.#messages.map((value) => ({
      ...value,
      origin: value.origin ?? (value.role === "assistant" ? "model" : "user"),
    }));
  }
  get messageCount() {
    return this.#messages.length;
  }
  get messageRevision() {
    return this.#messageRevision;
  }
  get messageOutline(): readonly MessageOutlineEntry[] {
    if (this.#messageOutlineRevision !== this.#messageRevision) {
      this.#messageOutline = Object.freeze(this.#messages.map((value, index) => Object.freeze({
        id: value.id,
        index,
        role: value.role,
        origin: value.origin ?? (value.role === "assistant" ? "model" : "user"),
      })));
      this.#messageOutlineRevision = this.#messageRevision;
    }
    return this.#messageOutline;
  }
  messageAt(index: number): ChatMessage | null {
    const value = this.#messages[index];
    return value ? { ...value, origin: value.origin ?? (value.role === "assistant" ? "model" : "user") } : null;
  }
  messageRange(start: number, count: number): ChatMessage[] {
    const from = Math.max(0, Math.trunc(start)), size = Math.max(0, Math.trunc(count));
    return this.#messages.slice(from, from + size).map((value) => ({
      ...value,
      origin: value.origin ?? (value.role === "assistant" ? "model" : "user"),
    }));
  }
  get turn() {
    return this.#turn;
  }
  get busy() {
    return this.#busy;
  }
  get regexScripts() {
    return clone(this.#regexScripts);
  }
  get cbsVariables() {
    return this.#cbsVariables;
  }
  get lastLogs() {
    return structuredClone(this.#lastLogs);
  }
  get promptRuns() {
    return clone(this.#promptRuns);
  }
  get narrativeIssues() {
    return structuredClone(this.#narrativeIssues);
  }
  get continuityPatches() {
    return this.#continuityPatches.all();
  }
  get rawLastSpeakers() {
    return structuredClone(this.#lastSpeakers);
  }
  get lastSpeakers() {
    return this.resolveSpeakers(this.#lastSpeakers);
  }
  resolveSpeakers(items: readonly SpeakerReference[] = []) {
    return resolveSpeakerList(
      this.runtime.project.schema,
      this.runtime.state,
      items,
    );
  }
  #memoryPerspectives(query: string) {
    const found = new Map<string, string>();
    for (const speaker of this.resolveSpeakers(this.#lastSpeakers))
      found.set(speaker.npcId, speaker.name ?? speaker.npcId);
    const schema = this.runtime.project.schema,
      block = (Array.isArray(schema.entities) ? schema.entities : []).map(object).find((value) => value.type === "npc"),
      npcs = (Array.isArray(block?.instances) ? block.instances : []).map(object),
      normalized = query.normalize("NFKC").toLocaleLowerCase();
    for (const npc of npcs) {
      const id = String(npc.id ?? "");
      if (!id || found.has(id)) continue;
      const aliases = [npc.nameKo, npc.name, npc.nameEn, ...(Array.isArray(npc.aliases) ? npc.aliases : [])].map(String).filter((value) => value.length >= 2);
      if (aliases.some((alias) => normalized.includes(alias.normalize("NFKC").toLocaleLowerCase())))
        found.set(id, aliases[0] ?? id);
    }
    return [...found].slice(0, 4).map(([id, label]) => ({ id, label }));
  }
  #snapshotSpeakers(
    items: readonly SpeakerReference[] = [],
  ): SpeakerReference[] {
    return this.resolveSpeakers(items).map(
      ({ npcId, emotion, outfit, focus }) => ({
        npcId,
        ...(emotion === undefined ? {} : { emotion }),
        ...(outfit === undefined ? {} : { outfit }),
        ...(focus ? { focus: true } : {}),
      }),
    );
  }
  get checkpointDepth() {
    return this.#checkpoints.length;
  }
  get redoDepth() {
    return this.#redoStack.length;
  }
  get alternateCount() {
    const id = this.#lastModelResponseId();
    return id ? this.responseAlternateCount(id) : this.#alternates.length;
  }
  responseAlternateCount(messageId: string) {
    const branch = this.#responseBranches.find(
      (value) => value.messageId === messageId,
    );
    return branch ? Math.max(0, branch.variants.length - 1) : 0;
  }
  responseAlternateIndex(messageId: string) {
    return (
      this.#responseBranches.find((value) => value.messageId === messageId)
        ?.active ?? 0
    );
  }
  canRerollResponse(messageId: string) {
    const index = this.#messages.findIndex(
        (message) => message.id === messageId,
      ),
      message = this.#messages[index];
    return (
      !!message &&
      message.role === "assistant" &&
      message.origin === "model" &&
      index > 0 &&
      this.#messages[index - 1]?.role === "user" &&
      this.#checkpoints.some((value) => value.messageCount === index - 1)
    );
  }
  get eventCount() {
    return this.#journal.length;
  }
  get eventCursor() {
    return this.#journal.cursor;
  }
  get journalSnapshotIndexes() {
    return this.#journal.snapshotIndexes;
  }
  get journal() {
    return this.#journal.toJSON();
  }
  stateAt(index: number) {
    return this.#journal.stateAt(index);
  }
  async truncateTo(index: number) {
    this.#journalShardHashes = null; // 이벤트 배열이 잘리므로 청크 캐시 폐기
    const head = this.#journal.truncateTo(index);
    this.#checkpoints = this.#checkpoints.filter(
      (value) => value.journalCursor <= index,
    );
    this.#redoStack = this.#redoStack.filter(
      (value) => value.journalCursor <= index,
    );
    this.#alternates = this.#alternates.filter(
      (value) => (value.journalCursor ?? 0) <= index,
    );
    this.#responseBranches = this.#responseBranches
      .map((branch) => ({
        ...branch,
        variants: branch.variants.filter(
          (value) => (value.journalCursor ?? 0) <= index,
        ),
      }))
      .filter((branch) => branch.variants.length)
      .map((branch) => ({
        ...branch,
        active: Math.min(branch.active, branch.variants.length - 1),
      }));
    reconcileMemorySources(this.memory, {
      messageIds: this.#messages.map((message) => message.id),
      eventIndexes: this.#journal.activeIndexes(),
      atTurn: this.#turn,
    });
    await this.save();
    this.#notify();
    return head;
  }
  async dispatchEngineEvent(id: string, params: Record<string, unknown> = {}) {
    return this.runLedgerAction(id, params);
  }
  async approveMemory(id: string) {
    this.memory.approve(id);
    await this.save();
    this.#notify();
  }
  async rejectMemory(id: string) {
    this.memory.reject(id);
    await this.save();
    this.#notify();
  }
  async applyContinuityPatch(id: string) {
    this.#continuityPatches.apply(id, this.memory, this.#turn);
    await this.save();
    this.#notify();
  }
  async rejectContinuityPatch(id: string) {
    this.#continuityPatches.reject(id);
    await this.save();
    this.#notify();
  }
  get cardRuntimeRevision() {
    const card = this.#cardRuntimeJournal.state;
    return stableHash({
      turn: this.#turn,
      eventCursor: this.#journal.cursor,
      cardCursor: this.#cardRuntimeJournal.cursor,
      variables: this.#cbsVariables,
      randomState: card.randomState,
      logicalTimeMs: card.logicalTimeMs,
    });
  }
  get engineRevision() {
    const head = this.#journal.head();
    return `${head.stateHash}:${head.rng}`;
  }
  cardRuntimeSnapshot(): CardRuntimeSnapshot {
    const card = this.#cardRuntimeJournal.state;
    return {
      sessionId: this.id,
      cardId: this.runtime.project.projectId,
      revision: this.cardRuntimeRevision,
      variables: clone(this.#cbsVariables),
      randomState: card.randomState,
      logicalTimeMs: card.logicalTimeMs,
      stateOwnership: this.#stateOwnership,
    };
  }
  async applyCardRuntimeTransaction(
    response: RuntimeWorkerSuccess,
    expectedRequestId: string,
  ): Promise<{ applied: true } | { applied: false; reason: string }> {
    if (response.requestId !== expectedRequestId)
      return { applied: false, reason: "request_mismatch" };
    if (response.sessionId !== this.id)
      return { applied: false, reason: "session_mismatch" };
    if (response.cardId !== this.runtime.project.projectId)
      return { applied: false, reason: "card_mismatch" };
    if (response.baseRevision !== this.cardRuntimeRevision)
      return { applied: false, reason: "revision_mismatch" };
    if (response.effects.some((effect) => effect.disposition === "apply"))
      return { applied: false, reason: "effects_unclassified" };
    if (this.#stateOwnership === "engine" && response.patch.length)
      return { applied: false, reason: "engine_owned_state_write" };
    const currentRuntime = this.#cardRuntimeJournal.state;
    if (
      !Number.isInteger(response.randomState) ||
      response.randomState < 0 ||
      response.randomState > 0xffff_ffff
    )
      return { applied: false, reason: "invalid_random_state" };
    if (response.logicalTimeMs !== currentRuntime.logicalTimeMs + 1_000)
      return { applied: false, reason: "invalid_logical_time" };
    const next = clone(this.#cbsVariables);
    for (const patch of response.patch) {
      if (!safeRuntimeKey(patch.key))
        return { applied: false, reason: "unsafe_patch_key" };
      if (patch.op === "set") {
        if (typeof patch.value !== "string")
          return { applied: false, reason: "invalid_patch_value" };
        next[patch.key] = patch.value;
      } else if (patch.op === "delete") delete next[patch.key];
      else return { applied: false, reason: "invalid_patch_op" };
    }
    const committed = this.#cardRuntimeJournal.append(
      response.requestId,
      response.patch,
      response.randomState,
      response.logicalTimeMs,
    );
    this.#cbsVariables = committed.variables;
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
    await this.save();
    this.#notify();
    return { applied: true };
  }
  // 설정 변경 시 세션을 재생성하면 현재 작업 이력이 갈라지므로 provider만 교체한다(감사 #11).
  setProvider(
    provider: ModelProvider,
    providerInfo?: PlaySessionOptions["providerInfo"],
  ) {
    this.#provider = provider;
    if (providerInfo) this.#providerInfo = clone(providerInfo);
  }
  setPreset(preset: PromptPreset) {
    this.#preset = clone(preset);
    this.#rememberPreset(this.#preset);
    const patch=Object.entries(presetToggleDefaults(this.#preset)).filter(([key])=>!(key in this.#cbsVariables)).map(([key,value])=>({op:'set' as const,key,value}));
    if(patch.length){const state=this.#cardRuntimeJournal.state,committed=this.#cardRuntimeJournal.append(`preset-toggle-defaults:${this.#cardRuntimeJournal.cursor+1}`,patch,state.randomState,state.logicalTimeMs);this.#cbsVariables=committed.variables;setActiveRenderContext(this.#regexScripts,this.#cbsVariables);this.#notify();}
  }
  async setPresetToggle(key:string,value:string|number|boolean){const variable=`toggle_${key}`,normalized=typeof value==='boolean'?(value?'1':'0'):String(value);if(!safeRuntimeKey(variable))throw new Error('preset_toggle_key_invalid');if(this.#cbsVariables[variable]===normalized)return;const state=this.#cardRuntimeJournal.state,committed=this.#cardRuntimeJournal.append(`preset-toggle:${variable}:${this.#cardRuntimeJournal.cursor+1}`,[{op:'set',key:variable,value:normalized}],state.randomState,state.logicalTimeMs);this.#cbsVariables=committed.variables;setActiveRenderContext(this.#regexScripts,this.#cbsVariables);await this.save();this.#notify();}
  setRegexScripts(scripts: readonly RegexScript[]) {
    this.#regexScripts = clone([...scripts]);
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
    this.#notify();
  }
  setAssets(assets: readonly AssetMacroAsset[]) {
    this.#assets=assets.map(asset=>({name:asset.name,type:asset.type,mime:asset.mime,...(asset.moduleNamespace?{moduleNamespace:asset.moduleNamespace}:{})}));
  }
  setPersona(persona: Persona | null) {
    this.#persona = persona ? clone(persona) : null;
  }
  setMaxContext(value?: number) {
    this.#maxContext = value;
  }
  setEmbeddingProvider(provider?: EmbeddingProvider) {
    this.#embeddingProvider = provider;
  }
  setAux(aux: AuxConfig) {
    this.#aux = clone(aux);
  }
  async seedGreeting(text: string) {
    if (this.#messages.length || !text.trim()) return;
    this.#append("assistant", text.trim(), "greeting");
    await this.save();
  }
  async replaceGreeting(text: string) {
    if (this.#messages.length !== 1 || this.#messages[0]?.role !== "assistant")
      throw new Error("greeting_locked");
    if (!text.trim()) throw new Error("message_empty");
    this.#messages[0] = { ...this.#messages[0], content: text.trim() };
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.#notify();
    await this.save();
  }
  async summarizeForMemory(text: string) {
    const sourceText = text.trim();
    if (!sourceText) throw new Error("memory_summary_empty");
    const provider = auxProviderFor("memory", this.#aux, this.#provider),
      prompt: CompiledPrompt = {
        messages: [
          {
            role: "system",
            content: "장기 기억으로 보존할 핵심 사실만 짧고 정확하게 요약한다.",
          },
          { role: "user", content: sourceText },
        ],
        assistantPrefill: "",
        trace: [],
        warnings: [],
      },
      response = await provider.complete({ prompt, format: "prose" }),
      summary = response.text.trim();
    if (!summary) throw new Error("memory_summary_empty");
    const id = `aux-memory:${this.#turn}:${++this.#auxSeq}`;
    this.memory.add(
      memoryRecord({
        id,
        text: summary,
        turn: this.#turn,
        status: "candidate",
        evidence: [{ kind: "message", id: `aux-source:${this.#turn}` }],
      }),
    );
    await this.save();
    return summary;
  }
  async translateMessage(id: string, target = "한국어", retranslate = false) {
    const index = this.#messages.findIndex((message) => message.id === id);
    if (index < 0) throw new Error(`message_not_found:${id}`);
    const message = this.#messages[index]!;
    if (message.role !== "assistant")
      throw new Error("translation_assistant_only");
    if (message.translation && !retranslate) return message.translation;
    const provider = auxProviderFor("translation", this.#aux, this.#provider),
      prompt: CompiledPrompt = {
        messages: [
          {
            role: "system",
            content: `다음 채팅 응답을 자연스러운 ${target}로 번역한다. 설명이나 머리말 없이 번역문만 출력한다. HTML 태그, {{...}} 매크로, [ysp_...] 태그, 파일명과 에셋 식별자는 원문 그대로 보존한다.`,
          },
          { role: "user", content: message.content },
        ],
        assistantPrefill: "",
        trace: [],
        warnings: [],
      },
      response = await provider.complete({ prompt, format: "prose" }),
      translation = response.text.trim();
    if (!translation) throw new Error("translation_empty");
    this.#messages[index] = { ...message, translation };
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    await this.save();
    this.#notify();
    return translation;
  }
  async clearMessageTranslation(id: string) {
    const index = this.#messages.findIndex((message) => message.id === id);
    if (index < 0) throw new Error(`message_not_found:${id}`);
    const message = this.#messages[index]!;
    delete message.translation;
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    await this.save();
    this.#notify();
  }
  // 편집·삭제 후 대안은 편집 전 본문을 되살릴 수 있으므로 폐기한다. 삭제 시 잘린 지점 이후를 담은 체크포인트도
  // 함께 버린다 — 남겨두면 되돌리기가 '지운 미래'를 부활시킨다(감사 #3).
  async editMessage(id: string, content: string) {
    if (!content.trim()) throw new Error("message_empty");
    const index = this.#messages.findIndex((message) => message.id === id);
    if (index < 0) throw new Error(`message_not_found:${id}`);
    const { translation: _, ...previous } = this.#messages[index]!;
    this.#messages[index] = { ...previous, content };
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.#alternates = [];
    this.#responseBranches = [];
    await this.save();
    this.#notify();
  }
  // 메시지 편집·삭제는 서사 기록만 바꾸며 엔진 상태와 근거 기억은 사건 경로 밖에서 변경하지 않는다.
  async removeMessage(id: string, cascade = false) {
    const index = this.#messages.findIndex((message) => message.id === id);
    if (index < 0) throw new Error(`message_not_found:${id}`);
    if (cascade) this.#messages = this.#messages.slice(0, index);
    else this.#messages.splice(index, 1);
    this.#messages = this.#messages.map((message, messageIndex) => ({
      ...message,
      index: messageIndex,
    }));
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.#checkpoints = this.#checkpoints.filter(
      (snapshot) => snapshot.messageCount <= index,
    );
    this.#alternates = [];
    const ids = new Set(this.#messages.map((message) => message.id));
    this.#responseBranches = this.#responseBranches.filter((branch) =>
      ids.has(branch.messageId),
    );
    reconcileMemorySources(this.memory, {
      messageIds: this.#messages.map((message) => message.id),
      eventIndexes: this.#journal.activeIndexes(),
      atTurn: this.#turn,
    });
    await this.save();
  }
  async undoTurn() {
    const checkpoint = this.#checkpoints.at(-1);
    if (!checkpoint) throw new Error("no_checkpoint");
    this.#redoStack.push(this.#captureCheckpoint(true));
    this.#checkpoints.pop();
    this.#restoreCheckpoint(checkpoint);
    this.#alternates = [];
    await this.save();
  }
  async redoTurn() {
    const future = this.#redoStack.pop();
    if (!future) throw new Error("no_redo");
    this.#checkpoints.push(this.#captureCheckpoint());
    if (this.#checkpoints.length > 30) this.#checkpoints.shift();
    this.#restoreCheckpoint(future);
    this.#alternates = [];
    await this.save();
  }
  async reroll(signal?: AbortSignal) {
    const id = this.#lastModelResponseId();
    if (!id) throw new Error("no_checkpoint");
    return this.rerollResponse(id, signal);
  }
  async rerollResponse(messageId: string, signal?: AbortSignal) {
    const index = this.#messages.findIndex(
      (message) => message.id === messageId,
    );
    if (!this.canRerollResponse(messageId) || index < 1)
      throw new Error("no_checkpoint");
    const checkpoint = this.#checkpoints.find(
        (value) => value.messageCount === index - 1,
      ),
      input = this.#messages[index - 1]?.content;
    if (!checkpoint || !input) throw new Error("no_checkpoint");
    let branch = this.#responseBranches.find(
      (value) => value.messageId === messageId,
    );
    if (!branch) {
      branch = {
        messageId,
        active: 0,
        variants: [this.#captureResponseState(messageId)],
      };
      this.#responseBranches.push(branch);
    }
    this.#restoreCheckpoint(checkpoint);
    this.#checkpoints = this.#checkpoints.filter(
      (value) => value.messageCount <= checkpoint.messageCount,
    );
    this.#redoStack = [];
    this.#alternates = [];
    const result = await this.#send(input, signal, false),
      generated = this.#messages.at(-1);
    if (!generated || generated.role !== "assistant")
      throw new Error("reroll_response_missing");
    const current =
      this.#responseBranches.find((value) => value.messageId === messageId) ??
      branch;
    current.variants = [
      ...current.variants,
      this.#captureResponseState(generated.id),
    ].slice(-10);
    current.active = current.variants.length - 1;
    current.messageId = generated.id;
    const ids = new Set(this.#messages.map((message) => message.id));
    this.#responseBranches = this.#responseBranches.filter((value) =>
      ids.has(value.messageId),
    );
    this.#syncLegacyAlternates(current);
    await this.save();
    this.#notify();
    return result;
  }
  async showAlternate(index: number) {
    const id = this.#lastModelResponseId();
    if (!id) throw new Error(`alternate_not_found:${index}`);
    return this.showResponseAlternate(id, index);
  }
  async showResponseAlternate(messageId: string, index: number) {
    let branch = this.#responseBranches.find(
      (value) => value.messageId === messageId,
    );
    if (
      !branch &&
      messageId === this.#lastModelResponseId() &&
      this.#alternates.length
    ) {
      branch = {
        messageId,
        active: this.#alternates.length,
        variants: [
          ...clone(this.#alternates),
          this.#captureResponseState(messageId),
        ],
      };
      this.#responseBranches.push(branch);
    }
    const alternate = branch?.variants[index];
    if (!branch || !alternate) throw new Error(`alternate_not_found:${index}`);
    this.#restoreAlternate(alternate);
    branch.active = index;
    const targetIndex = this.#messages.findIndex(
      (message) => message.id === messageId,
    );
    this.#checkpoints = this.#checkpoints.filter(
      (value) => value.messageCount <= Math.max(0, targetIndex - 1),
    );
    this.#redoStack = [];
    const ids = new Set(this.#messages.map((message) => message.id));
    this.#responseBranches = this.#responseBranches.filter((value) =>
      ids.has(value.messageId),
    );
    this.#syncLegacyAlternates(branch);
    await this.save();
    this.#notify();
  }
  async send(content: string, signal?: AbortSignal) {
    return this.#send(
      applyRegexScripts(content, this.#regexScripts, "input"),
      signal,
      true,
    );
  }
  async continueGeneration(signal?: AbortSignal) {
    return this.#send(
      "Continue the last assistant response naturally without repeating it.",
      signal,
      true,
      false,
    );
  }
  async runLedgerAction(id: string, params: Record<string, unknown> = {}, trace?: SessionActionTrace, returnAfterReceipt = false) {
    if (this.#busy) throw new Error("session_busy");
    this.#busy = true;
    this.#notify();
    traceAction(trace, "session-start");
    try {
      traceAction(trace, "background-save-wait-start");
      // 정본이 한 번 생긴 뒤에는 작은 WAL이 다음 행동을 보호한다. 백그라운드 전체 저장을 기다리지 않는다.
      if (!this.#persistedIntegrity) await this.#flushBackgroundSave();
      traceAction(trace, "background-save-wait-complete");
      await this.#ensurePersistedBase();
      traceAction(trace, "base-persist-complete");
      const eventOffset = this.#journal.rawEvents.length;
      this.#pushCheckpoint();
      traceAction(trace, "checkpoint-complete");
      const result = this.runtime.dispatch(id, params),
        logs = clone(result.log as Record<string, unknown>[]);
      traceAction(trace, "engine-complete");
      this.#lastLogs = logs;
      this.#lastSpeakers = [];
      this.#narrativeIssues = [];
      this.#recordEngineFacts(id, logs, this.#journal.cursor);
      for (const log of logs)
        if (log.ok) this.#enqueueLedgerNarrative(id, log, this.#journal.cursor);
      traceAction(trace, "memory-complete");
      this.#append("assistant", "장부에 반영되었습니다.", "ledger", {
        facts: logs,
      });
      this.#turn += 1;
      this.memory.archiveNarrativeMemories(this.#turn);
      traceAction(trace, "receipt-complete");
      traceAction(trace, "save-start");
      const durable = await this.#persistActionReceipt("ledger", eventOffset, logs, this.#turn, trace);
      traceAction(trace, "save-complete");
      if (durable) traceAction(trace, "action-durable");
      if (durable && returnAfterReceipt) this.#queueBackgroundSave();
      else await this.save();
      return result;
    } finally {
      this.#busy = false;
      this.#notify();
    }
  }
  async runManagementTurn(
    id: string,
    params: Record<string, unknown> = {},
    flavorText = "",
    signal?: AbortSignal,
    trace?: SessionActionTrace,
  ) {
    return this.runManagementBatch([{ id, params }], flavorText, signal, trace);
  }
  async runManagementBatch(
    events: Array<{ id: string; params?: Record<string, unknown> }>,
    flavorText = "",
    signal?: AbortSignal,
    trace?: SessionActionTrace,
  ) {
    if (this.#busy) throw new Error("session_busy");
    if (!events.length) throw new Error("management_events_empty");
    this.#busy = true;
    this.#notify();
    traceAction(trace, "session-start");
    const started = Date.now(),
      stateBefore = this.runtime.snapshot();
    try {
      traceAction(trace, "background-save-wait-start");
      if (!this.#persistedIntegrity) await this.#flushBackgroundSave();
      traceAction(trace, "background-save-wait-complete");
      await this.#ensurePersistedBase();
      traceAction(trace, "base-persist-complete");
      const eventOffset = this.#journal.rawEvents.length;
      this.#pushCheckpoint();
      traceAction(trace, "checkpoint-complete");
      const intent = applyRegexScripts(
        flavorText,
        this.#regexScripts,
        "input",
      ).trim();
      if (intent) this.#append("user", intent, "user");
      const logs: Record<string, unknown>[] = [],
        eventEvidence: MemoryEvidenceEvent[] = [];
      for (const event of events) {
        const rows = this.runtime.dispatch(event.id, event.params ?? {})
            .log as Record<string, unknown>[],
          journalIndex = this.#journal.cursor;
        logs.push(...rows);
        this.#recordEngineFacts(event.id, rows, journalIndex);
        eventEvidence.push({
          id: event.id,
          index: journalIndex,
          ok: rows.some((row) => row.ok === true),
          summary: JSON.stringify(rows),
        });
      }
      traceAction(trace, "engine-complete");
      traceAction(trace, "memory-complete");
      this.#lastLogs = clone(logs);
      const durable = await this.#persistActionReceipt("narrated", eventOffset, logs, this.#turn + 1, trace);
      if (durable) {
        traceAction(trace, "action-durable");
        this.#notify();
        // 영수증 확정 뒤 브라우저가 엔진 결과를 먼저 그릴 수 있게 한 태스크 양보한다.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const prompt = withMemoryCaptureContract(this.#managementPrompt(
          events.map((event) => event.id),
          logs,
          intent,
        ), "prose"),
        chips: MessageChip[] = [];
      traceAction(trace, "prompt-complete");
      let response: NarrativeResponse | undefined,
        text = "관리 결과가 반영되었습니다.",
        proposed: ProposedEvent[] = [];
      try {
        response = ingestHiddenMemoryPacket(await this.#provider.complete({
          prompt,
          format: "prose",
          purpose: "management",
          ...(signal ? { signal } : {}),
        }));
        traceAction(trace, "provider-complete");
        if (!response || typeof response.text !== "string")
          throw new Error("model_response_invalid");
        const translated = this.#tagTranslator?.(response.text),
          translatedEvents = translated?.events ?? [];
        proposed = [...(response.events ?? []), ...translatedEvents];
        if (proposed.length)
          chips.push({
            ok: false,
            kind: "system",
            text: `서사화 사건 ${proposed.length}개 무시됨`,
          });
        text = (translated?.residue ?? response.text).trim() || text;
        this.#lastSpeakers = clone(
          response.speakers?.length
            ? response.speakers
            : (this.#speakerExtractor?.(text) ?? []),
        );
      } catch {
        chips.push({
          ok: false,
          kind: "system",
          text: "서사화 API 오류 · 엔진 결과 유지",
        });
        this.#lastSpeakers = [];
      }
      this.#narrativeIssues = verifyNarrative({
        narrative: text,
        evidenceTexts: [
          JSON.stringify(logs),
          JSON.stringify(this.runtime.state),
          intent,
        ],
        hasFailedProposedEvent: logs.some((log) => log.ok === false),
      }).issues;
      const assistant = this.#append("assistant", text, "engine", {
          facts: logs,
          chips,
          speakers: this.rawLastSpeakers,
        }),
        continuity = this.#processContinuity(
          response ?? { text },
          assistant,
          intent ? this.#messages.at(-2) : undefined,
          eventEvidence,
        );
      const inputTokens =
          response?.usage?.inputTokens ??
          prompt.messages.reduce(
            (sum, message) => sum + estimateTokens(message.content),
            0,
          ),
        outputTokens = response?.usage?.outputTokens ?? estimateTokens(text),
        stateAfter = this.runtime.snapshot(),
        run: PromptRun = {
          id: `run:${this.#turn}:${assistant.id}`,
          turn: this.#turn,
          kind: "management",
          createdAt: new Date().toISOString(),
          prompt: clone(prompt),
          promptHash: stableHash(prompt),
          responseText: text,
          proposedEvents: clone(proposed),
          logs: this.lastLogs,
          ...continuity,
          stateBefore: clone(stateBefore),
          stateAfter,
          stateBeforeHash: stableHash(stateBefore),
          stateAfterHash: stableHash(stateAfter),
          issues: this.narrativeIssues,
          durationMs: Date.now() - started,
          inputTokens,
          outputTokens,
          tokensEstimated:
            response?.usage?.inputTokens === undefined ||
            response.usage.outputTokens === undefined,
          ...(this.#providerInfo.provider
            ? { provider: this.#providerInfo.provider }
            : {}),
          ...((response?.model ?? this.#providerInfo.model)
            ? { model: response?.model ?? this.#providerInfo.model }
            : {}),
          ...(response?.finishReason
            ? { finishReason: response.finishReason }
            : {}),
          ...(response?.generationId
            ? { generationId: response.generationId }
            : {}),
        };
      this.#promptRuns = compactPromptRuns([...this.#promptRuns, run]);
      this.#ledgerNarrativeQueue = [];
      this.#turn += 1;
      this.memory.archiveNarrativeMemories(this.#turn);
      traceAction(trace, "receipt-complete");
      traceAction(trace, "save-start");
      await this.save();
      traceAction(trace, "save-complete");
      return { logs: this.lastLogs, response: { ...response, text }, prompt };
    } finally {
      this.#busy = false;
      this.#notify();
    }
  }
  async #send(
    content: string,
    signal: AbortSignal | undefined,
    checkpoint: boolean,
    appendUser = true,
  ) {
    const text = content.trim();
    if (!text) throw new Error("message_empty");
    if (this.#busy) throw new Error("session_busy");
    this.#busy = true;
    const redoBefore = this.#redoStack.slice();
    try {
      if (checkpoint) {
        this.#checkpoints.push(this.#captureCheckpoint());
        if (this.#checkpoints.length > 30) this.#checkpoints.shift();
        this.#redoStack = [];
        this.#alternates = [];
      }
      if (appendUser) this.#append("user", text, "user");
      let prompt!: CompiledPrompt, response!: NarrativeResponse;
      const stateBefore = this.runtime.snapshot(),
        requestStarted = Date.now();
      // 모델 호출 실패 시 user 메시지·체크포인트를 되감는다 — 방치하면 응답 없는 유저 메시지가
      // 다음 턴 체크포인트에 정상인 양 굳는다(감사 #2). 응답 도착 이후의 실패는 여기 대상이 아니다.
      // 카드 태그 번역기가 있는 리스 카드는 산문을 보존하고, SimPack만 구조화 JSON 계약을 사용한다.
      try {
        const responseFormat = this.#tagTranslator ? "prose" : "json";
        prompt = withMemoryCaptureContract(await this.#compile(text, !appendUser, signal), responseFormat);
        response = ingestHiddenMemoryPacket(await this.#provider.complete({
          prompt,
          format: responseFormat,
          ...(signal ? { signal } : {}),
        }));
        if (!response || typeof response.text !== "string")
          throw new Error("model_response_invalid");
      } catch (error) {
        if (appendUser) {
          this.#messages.pop();
          this.#messageSeq -= 1;
          this.#messagesChanged();
        }
        if (checkpoint) {
          this.#checkpoints.pop();
          this.#redoStack = redoBefore;
        }
        throw error;
      }
      this.#lastLogs = [];
      this.#lastSpeakers = structuredClone(
        response.speakers?.length
          ? response.speakers
          : (this.#speakerExtractor?.(response.text) ?? []),
      );
      const eventEvidence: MemoryEvidenceEvent[] = [];
      const record = (eventId: string, logs: Record<string, unknown>[]) => {
        const journalIndex = this.#journal.cursor;
        this.#lastLogs.push(...logs);
        this.#recordEngineFacts(eventId, logs, journalIndex);
        eventEvidence.push({
          id: eventId,
          index: journalIndex,
          ok: logs.some((log) => log.ok === true),
          summary: JSON.stringify(logs),
        });
      };
      const allowed = new Set(this.runtime.allowedModelEventIds());
      for (const event of response.events ?? []) {
        if (!event || !this.runtime.registry.hasEvent(event.id)) {
          this.#lastLogs.push({
            ok: false,
            event: String(event?.id ?? ""),
            reason: "unregistered_model_event",
          });
          continue;
        }
        if (!allowed.has(event.id)) {
          this.#lastLogs.push({
            ok: false,
            event: event.id,
            reason: "model_event_not_allowed",
          });
          continue;
        }
        record(
          event.id,
          this.runtime.dispatch(event.id, event.params ?? {}).log,
        );
      }
      const translated = this.#tagTranslator?.(response.text),
        assistantText = translated?.residue ?? response.text;
      for (const event of translated?.events ?? []) {
        if (BUTTON_ONLY_EVENTS.has(event.id)) {
          this.#lastLogs.push({
            ok: false,
            event: event.id,
            reason: "card_tag_blocked",
          });
          continue;
        }
        if (!CARD_TAG_EVENTS.has(event.id)) {
          this.#lastLogs.push({
            ok: false,
            event: event.id,
            reason: "card_tag_not_allowed",
          });
          continue;
        }
        if (!this.runtime.registry.hasEvent(event.id)) {
          this.#lastLogs.push({
            ok: false,
            event: event.id,
            reason: "card_tag_unregistered",
          });
          continue;
        }
        record(event.id, this.runtime.dispatch(event.id, event.params).log);
      }
      this.#narrativeIssues = verifyNarrative({
        narrative: assistantText,
        evidenceTexts: [
          JSON.stringify(this.#lastLogs),
          JSON.stringify(this.runtime.state),
          text,
        ],
        hasFailedProposedEvent: this.#lastLogs.some((log) => log.ok === false),
      }).issues;
      const assistant = this.#append("assistant", assistantText, "model", {
          speakers: this.rawLastSpeakers,
        }),
        userMessage = appendUser ? this.#messages.at(-2) : undefined,
        continuity = this.#processContinuity(
          response,
          assistant,
          userMessage,
          eventEvidence,
        );
      const reportedUsage = response.usage,
        inputTokens =
          reportedUsage?.inputTokens ??
          prompt.messages.reduce(
            (sum, message) => sum + estimateTokens(message.content),
            estimateTokens(prompt.assistantPrefill),
          ),
        outputTokens =
          reportedUsage?.outputTokens ?? estimateTokens(assistantText),
        tokensEstimated =
          reportedUsage?.inputTokens === undefined ||
          reportedUsage.outputTokens === undefined;
      const stateAfter = this.runtime.snapshot(),
        run: PromptRun = {
          id: `run:${this.#turn}:${assistant.id}`,
          turn: this.#turn,
          kind: !appendUser ? "continue" : checkpoint ? "send" : "reroll",
          createdAt: new Date().toISOString(),
          prompt: clone(prompt),
          promptHash: stableHash(prompt),
          responseText: assistantText,
          proposedEvents: clone(response.events ?? []),
          logs: this.lastLogs,
          ...continuity,
          ...(this.#lastMemoryTrace ? { memoryTrace: clone(this.#lastMemoryTrace) } : {}),
          stateBefore: clone(stateBefore),
          stateAfter,
          stateBeforeHash: stableHash(stateBefore),
          stateAfterHash: stableHash(stateAfter),
          issues: this.narrativeIssues,
          durationMs: Date.now() - requestStarted,
          inputTokens,
          outputTokens,
          tokensEstimated,
          ...(this.#providerInfo.provider
            ? { provider: this.#providerInfo.provider }
            : {}),
          ...((response.model ?? this.#providerInfo.model)
            ? { model: response.model ?? this.#providerInfo.model }
            : {}),
          ...(response.finishReason
            ? { finishReason: response.finishReason }
            : {}),
          ...(response.generationId
            ? { generationId: response.generationId }
            : {}),
        };
      this.#promptRuns = compactPromptRuns([...this.#promptRuns, run]);
      this.#turn += 1;
      this.memory.archiveNarrativeMemories(this.#turn);
      await this.save();
      return {
        response: { ...response, text: assistantText },
        logs: this.lastLogs,
        prompt,
      };
    } finally {
      this.#busy = false;
    }
  }
  static sealedEpochRecordId(sessionId: string, offset: number) {
    return `${sessionId}::sealed-epoch:${offset}`;
  }
  // 봉인 본문은 불변 — 세션당 1회만 기록하고 이후 save에서는 건드리지 않는다(파동 2).
  async #persistSealedEpochs(captured?:Array<{offset:number;epoch:SealedEngineJournalEpoch}>) {
    if (!this.#repository) return;
    const entries=captured??Array.from({length:this.#journal.sealedEpochCount},(_,offset)=>({offset,epoch:this.#journal.sealedEpochAt(offset)})).filter((entry):entry is{offset:number;epoch:SealedEngineJournalEpoch}=>!!entry.epoch);
    for (const {offset,epoch} of entries) {
      if (this.#persistedEpochOffsets.has(offset)) continue;
      await this.#repository.put({
        id: PlaySession.sealedEpochRecordId(this.id, offset),
        schemaHash: this.runtime.project.projectId,
        title: `${this.#card.name} · sealed epoch ${offset}`,
        updatedAt: Date.now(),
        payload: { contract: SEALED_EPOCH_CONTRACT, sessionId: this.id, offset, epoch } as unknown as SessionSnapshot,
      });
      this.#persistedEpochOffsets.add(offset);
    }
  }
  static async #fetchShards(repository: SessionRepository<SessionSnapshot>, sessionId: string, kind: SessionShardRecord["kind"], info: { chunks: string[]; total: number }) {
    const items: unknown[] = [];
    for (let offset = 0; offset < info.chunks.length; offset += 1) {
      const expectedHash = info.chunks[offset]!,
        row = await repository.get(PlaySession.shardRecordId(sessionId, kind, offset, expectedHash))
          ?? await repository.get(PlaySession.shardRecordId(sessionId, kind, offset)), // 구형 고정 ID 하위호환
        record = row?.payload as unknown as SessionShardRecord | undefined;
      if (!record || record.contract !== SESSION_SHARD_CONTRACT || record.kind !== kind || !Array.isArray(record.items))
        throw new Error(`session_corrupt:shard_missing:${kind}:${offset}`);
      if (stableHash(record.items) !== expectedHash) throw new Error(`session_corrupt:shard_hash:${kind}:${offset}`);
      items.push(...record.items);
    }
    if (items.length !== info.total) throw new Error(`session_corrupt:shard_missing:${kind}:total`);
    return items;
  }
  // 디스크 로드용 조립: 샤드 청크(메시지·저널 이벤트)와 봉인 본문 레코드를 합쳐 restore 가능한 형태로
  // 만든다. 조립물의 위·변조는 restore의 integrity v2 전체 재계산이 잡는다(청크 해시는 쓰기 최적화용).
  static async assembleSnapshot(payload: SessionSnapshot, repository: SessionRepository<SessionSnapshot>): Promise<SessionSnapshot> {
    let assembled = payload;
    const manifest = payload.shardManifest;
    if (manifest) {
      const messages = (await PlaySession.#fetchShards(repository, payload.id, "messages", manifest.messages)) as ChatMessage[],
        events = await PlaySession.#fetchShards(repository, payload.id, "journal-events", manifest.journalEvents),
        journal = payload.journal && payload.journal.contract === "simbot-event-journal/0.2"
          ? { ...payload.journal, events: events as EngineJournalDataV02["events"] }
          : payload.journal;
      assembled = { ...payload, messages, ...(journal ? { journal } : {}) };
    }
    const journal = assembled.journal;
    const refs = journal && journal.contract === "simbot-event-journal/0.2" ? journal.sealedEpochRefs ?? [] : [];
    if (refs.length && journal && journal.contract === "simbot-event-journal/0.2" && !journal.sealedEpochs.length) {
      const bodies: SealedEngineJournalEpoch[] = [];
      for (const ref of refs) {
        const row = await repository.get(PlaySession.sealedEpochRecordId(payload.id, ref.offset)),
          record = row?.payload as unknown as { contract?: string; epoch?: SealedEngineJournalEpoch } | undefined;
        if (!record || record.contract !== SEALED_EPOCH_CONTRACT || !record.epoch)
          throw new Error(`journal_corrupt:sealed_epoch_record_${ref.offset}`);
        if (record.epoch.sealHash !== ref.sealHash || record.epoch.sealedIndex !== ref.sealedIndex)
          throw new Error(`journal_corrupt:sealed_epoch_record_${ref.offset}_hash`);
        bodies.push(record.epoch);
      }
      assembled = { ...assembled, sealedEpochBodies: bodies };
    }
    const walRow = await repository.get(PlaySession.actionWalRecordId(payload.id)),
      receipt = walRow?.payload as unknown as ActionWalReceipt | undefined;
    if (receipt) {
      if (receipt.contract !== ACTION_WAL_CONTRACT || receipt.sessionId !== payload.id)
        throw new Error("session_corrupt:action_wal_contract");
      const { hash, ...unsigned } = receipt;
      if (!hash || hash !== actionWalHash(unsigned)) throw new Error("session_corrupt:action_wal_hash");
      assembled = { ...assembled, pendingActionReceipt: clone(receipt) };
    }
    return assembled;
  }
  #effectiveJournal(data: SessionSnapshot): EngineJournalData | undefined {
    const journal = data.journal;
    if (!journal || journal.contract !== "simbot-event-journal/0.2") return journal;
    const refs = journal.sealedEpochRefs ?? [];
    if (!refs.length || journal.sealedEpochs.length) return journal;
    const bodies = data.sealedEpochBodies ?? [];
    if (bodies.length !== refs.length) throw new Error("journal_epoch_bodies_missing");
    for (const [offset, ref] of refs.entries()) {
      const body = bodies[offset];
      if (!body || body.sealHash !== ref.sealHash || body.sealedIndex !== ref.sealedIndex)
        throw new Error(`journal_corrupt:sealed_epoch_record_${ref.offset}_hash`);
    }
    return { ...journal, sealedEpochs: bodies };
  }
  static shardRecordId(sessionId: string, kind: "messages" | "journal-events", offset: number, hash?: string) {
    return `${sessionId}::shard:${kind}:${offset}${hash ? `:${hash}` : ""}`;
  }
  static actionWalRecordId(sessionId: string) { return `${sessionId}::action-wal`; }
  // append-only 배열을 청크로 나눠 바뀐 꼬리만 다시 쓴다. 완결 청크 해시는 캐시를 신뢰한다
  // (배열을 자르는 모든 연산이 캐시를 무효화하므로 — 무효화 지점은 #messagesChain과 동일 + truncateTo).
  async #writeShards(kind: "messages" | "journal-events", items: readonly unknown[], chunkSize: number, previous: string[] | null) {
    const chunkCount = Math.ceil(items.length / chunkSize) || 0, hashes: string[] = [], obsolete: string[] = [];
    for (let offset = 0; offset < chunkCount; offset += 1) {
      const complete = (offset + 1) * chunkSize <= items.length,
        cached = previous?.[offset],
        reusable = !!cached && complete && offset < (previous?.length ?? 0) - 1;
      if (reusable) { hashes.push(cached); continue; }
      const chunk = items.slice(offset * chunkSize, (offset + 1) * chunkSize), hash = stableHash(chunk);
      hashes.push(hash);
      if (cached === hash && complete) continue; // 내용 동일 — 재기록 불필요
      await this.#repository!.put({
        // 내용 해시를 ID에 넣는 copy-on-write: 새 꼬리를 먼저 써도 기존 코어가 가리키는 청크는 변하지 않는다.
        id: PlaySession.shardRecordId(this.id, kind, offset, hash),
        schemaHash: this.runtime.project.projectId,
        title: `${this.#card.name} · ${kind} ${offset}`,
        updatedAt: Date.now(),
        payload: { contract: SESSION_SHARD_CONTRACT, sessionId: this.id, kind, offset, items: chunk } as unknown as SessionSnapshot,
      });
      if (cached && cached !== hash) {
        obsolete.push(PlaySession.shardRecordId(this.id, kind, offset, cached));
        obsolete.push(PlaySession.shardRecordId(this.id, kind, offset));
      }
    }
    for (let orphan = chunkCount; orphan < (previous?.length ?? 0); orphan += 1) {
      obsolete.push(PlaySession.shardRecordId(this.id, kind, orphan, previous![orphan]!));
      obsolete.push(PlaySession.shardRecordId(this.id, kind, orphan));
    }
    return { hashes, obsolete };
  }
  async #ensurePersistedBase() {
    if (this.#repository && !this.#persistedIntegrity) await this.#saveNow();
  }
  #withWalLock<T>(work:()=>Promise<T>){const running=this.#walTail.then(work,work);this.#walTail=running.then(()=>{},()=>{});return running;}
  #walReceipt(actions:ActionWalEntry[],baseIntegrity:string):ActionWalReceipt{const latest=actions.at(-1);if(!latest)throw new Error("action_wal_empty");const unsigned:Omit<ActionWalReceipt,"hash">={contract:ACTION_WAL_CONTRACT,sessionId:this.id,baseIntegrity,mode:latest.mode,events:latest.events,expectedJournalCursor:latest.expectedJournalCursor,expectedStateHash:latest.expectedStateHash,expectedRng:latest.expectedRng,expectedLogsHash:latest.expectedLogsHash,turnAfter:latest.turnAfter,actions};return{...unsigned,hash:actionWalHash(unsigned)};}
  async #putWal(actions:ActionWalEntry[],baseIntegrity:string){const receipt=this.#walReceipt(actions,baseIntegrity);await this.#repository!.put({id:PlaySession.actionWalRecordId(this.id),schemaHash:this.runtime.project.projectId,title:`${this.#card.name} · action receipt`,updatedAt:Date.now(),payload:receipt as unknown as SessionSnapshot});this.#walPresent=true;}
  async #persistActionReceipt(mode: ActionWalReceipt["mode"], eventOffset: number, logs: Record<string, unknown>[], turnAfter: number, trace?: SessionActionTrace) {
    if (!this.#repository || !this.#persistedIntegrity) return false;
    return this.#withWalLock(async()=>{const head=this.#journal.head(),action:ActionWalEntry={mode,events:clone(this.#journal.rawEvents.slice(eventOffset)),expectedJournalCursor:head.index,expectedStateHash:head.stateHash,expectedRng:head.rng,expectedLogsHash:stableHash(logs),turnAfter},actions=[...this.#pendingWalActions,action];traceAction(trace,"wal-build-complete");await this.#putWal(actions,this.#persistedIntegrity!);this.#pendingWalActions=actions;return true;});
  }
  async #flushBackgroundSave() {
    if (this.#backgroundSaveTimer) {
      clearTimeout(this.#backgroundSaveTimer);
      this.#backgroundSaveTimer = null;
    }
    if (this.#backgroundSave) await this.#backgroundSave;
    if (this.#backgroundSaveError) {
      const reason = this.#backgroundSaveError;
      this.#backgroundSaveError = null;
      throw reason;
    }
  }
  #queueBackgroundSave() {
    if (!this.#repository) return;
    if (this.#backgroundSaveTimer) clearTimeout(this.#backgroundSaveTimer);
    this.#backgroundSaveTimer = setTimeout(() => {
      this.#backgroundSaveTimer = null;
      const task = this.#saveNow(), handled = task.catch((reason) => { this.#backgroundSaveError = reason; }),
        queued = handled.finally(() => { if (this.#backgroundSave === queued) this.#backgroundSave = null; });
      this.#backgroundSave = queued;
    }, 750);
  }
  #captureSaveBatch():SessionSaveBatch{const messages=this.messages,events=[...clone(this.#journal.rawEvents)],shell=clone(this.#journal.toPersistedShell()),core=this.#snapshotWith(shell,[]),epochs:Array<{offset:number;epoch:SealedEngineJournalEpoch}>=[];for(let offset=0;offset<this.#journal.sealedEpochCount;offset+=1){const epoch=this.#journal.sealedEpochAt(offset);if(epoch)epochs.push({offset,epoch:clone(epoch)});}return{messages,events,shell,core,epochs,messageHashes:this.#messageShardHashes?[...this.#messageShardHashes]:null,journalHashes:this.#journalShardHashes?[...this.#journalShardHashes]:null,walCutoff:this.#pendingWalActions.length};}
  async #saveNow() {
    if (!this.#repository) return;
    // 비동기 디스크 작업 전에 한 시점의 불변 묶음을 만든다. 이후 엔진 행동은 이 묶음을 바꾸지 않는다.
    const batch=this.#captureSaveBatch();
    await this.#persistSealedEpochs(batch.epochs);
    const messageWrite = await this.#writeShards("messages", batch.messages, MESSAGE_SHARD_SIZE, batch.messageHashes),
      journalWrite = await this.#writeShards("journal-events", batch.events, JOURNAL_SHARD_SIZE, batch.journalHashes);
    const manifest: SessionShardManifest = {
      version: 1,
      messages: { chunkSize: MESSAGE_SHARD_SIZE, total: batch.messages.length, chunks: messageWrite.hashes },
      journalEvents: { chunkSize: JOURNAL_SHARD_SIZE, total: batch.events.length, chunks: journalWrite.hashes },
    };
    await this.#repository.put({id:this.id,schemaHash:this.runtime.project.projectId,title:this.#card.name,updatedAt:Date.now(),payload:{...batch.core,shardManifest:manifest}});
    this.#messageShardHashes=messageWrite.hashes;this.#journalShardHashes=journalWrite.hashes;
    // 새 코어가 새 해시 청크를 가리킨 뒤에만 이전 청크를 정리한다. 중간 종료 시에도 옛 코어는 완전하다.
    for (const id of [...messageWrite.obsolete, ...journalWrite.obsolete]) await this.#repository.delete(id);
    await this.#withWalLock(async()=>{const integrity=batch.core.integrity??null;if(!integrity)throw new Error("session_integrity_missing");const remaining=this.#pendingWalActions.slice(batch.walCutoff);this.#persistedIntegrity=integrity;this.#pendingWalActions=remaining;if(remaining.length)await this.#putWal(remaining,integrity);else if(this.#walPresent){await this.#repository!.delete(PlaySession.actionWalRecordId(this.id));this.#walPresent=false;}});
  }
  async save() {
    await this.#flushBackgroundSave();
    await this.#saveNow();
  }
  snapshot(): SessionSnapshot {
    return this.#snapshotWith(this.#journal.toJSON()); // 내보내기·백업은 자기완결(본문 인라인)
  }
  #ensureMessagesChain(): string {
    if (!this.#messagesChain || this.#messagesChain.count !== this.#messages.length)
      this.#messagesChain = { count: this.#messages.length, hash: messagesChainHash(this.messages) };
    return this.#messagesChain.hash;
  }
  #snapshotWith(journal: EngineJournalData, messages: ChatMessage[] = this.messages): SessionSnapshot {
    const patches = this.continuityPatches,
      base = {
        contract: "simbot-play-session/0.1" as const,
        id: this.id,
        projectId: this.runtime.project.projectId,
        schemaFingerprint: runtimeSchemaFingerprint(this.runtime),
        turn: this.#turn,
        messages,
        engine: this.runtime.snapshot(),
        memory: this.memory.all(),
        ...(this.memory.archivePages().length ? { memoryArchivePages: this.memory.archivePages() } : {}),
        ...(patches.length ? { continuityPatches: patches } : {}),
        lastLogs: this.lastLogs,
        cbsVariables: clone(this.#cbsVariables),
        cardRuntimeJournal: this.#cardRuntimeJournal.toJSON(),
        lastSpeakers: this.rawLastSpeakers,
        journal,
        // 디스크 undo는 최근 5개만(RAM 30개 유지 — 오너 결정 1). 참조된 프리셋 본문은 사전으로 동봉.
        history: this.#persistedHistory(),
        bindings: {
          persona: clone(this.#persona),
          preset: clone(this.#preset),
        },
        ...(this.#ledgerNarrativeQueue.length
          ? { ledgerNarrativeQueue: clone(this.#ledgerNarrativeQueue) }
          : {}),
        ...(this.#alternates.length
          ? { alternates: clone(this.#alternates) }
          : {}),
        ...(this.#responseBranches.length
          ? { responseBranches: clone(this.#responseBranches) }
          : {}),
        ...(this.#promptRuns.length
          ? { promptRuns: clone(this.#promptRuns) }
          : {}),
      };
    // v2 서명: 저널은 클래스가 유지한 롤링 체인, 메시지는 세션 롤링 체인을 재사용해 O(변경분)로 서명한다.
    // 서명은 '논리적 전체'(조립 후 형태)에 대한 것 — 샤딩 코어의 빈 배열은 서명 재료가 아니다.
    const { integrity } = sessionIntegrityV2(base, {
      journal: this.#journal.currentIntegrityHash(),
      messages: this.#ensureMessagesChain(),
    });
    return { ...base, integrityVersion: 2, integrity };
  }
  restore(value: SessionSnapshot) {
    if (
      value.contract !== "simbot-play-session/0.1" ||
      value.projectId !== this.runtime.project.projectId
    )
      throw new Error("session_snapshot_incompatible");
    // 샤딩 코어를 조립 없이 넣으면 integrity 불일치로 오인되므로 명시적 오류를 먼저 낸다(파동 4).
    if (
      value.shardManifest &&
      (value.messages.length !== value.shardManifest.messages.total ||
        (value.journal?.contract === "simbot-event-journal/0.2" && value.journal.events.length !== value.shardManifest.journalEvents.total))
    )
      throw new Error("session_shards_missing");
    // 무결성 해시는 필수 — 해시 필드를 지우는 것만으로 변조 검증을 우회할 수 있으므로(감사 Critical)
    // 누락도 거부한다. v2(섹션 합성)는 전체 재계산으로 대조하고, 버전 없는 구형은 구 알고리즘으로 검증한다.
    if (value.integrityVersion === 2) {
      if (value.integrity !== sessionIntegrityV2(value).integrity)
        throw new Error("session_corrupt:integrity");
    } else if (value.integrity !== sessionIntegrity(value))
      throw new Error("session_corrupt:integrity");
    this.#persistedIntegrity = value.integrity ?? null;
    this.#pendingWalActions = [];
    if (this.#backgroundSaveTimer) { clearTimeout(this.#backgroundSaveTimer); this.#backgroundSaveTimer = null; }
    const currentFingerprint = runtimeSchemaFingerprint(this.runtime),
      compiled = !!this.runtime.project.schema._compiler,
      schemaChanged =
      (value.schemaFingerprint &&
        value.schemaFingerprint !== currentFingerprint) ||
      (compiled && !value.schemaFingerprint) ||
      (!!value.journal && value.journal.schemaHash !== currentFingerprint);
    const data = clone(value); // 프록시일 수 있는 입력을 여기서 한 번 평평하게 만든다(엔진·원장 내부 clone 보호).
    let epochResult: { applied: Array<{ moduleId: string; changed: boolean }>; baseIndex: number } | null = null;
    const journalData = this.#effectiveJournal(data); // 분리 보관된 봉인 본문을 참조 검증 후 합친다(파동 2)
    if (journalData) {
      if (schemaChanged) {
        const migrated = this.runtime.sealMigrations(data.engine.state),
          migratedSnapshot = { state: migrated.state, rng: data.engine.rng };
        this.#journal.adoptForSeal(journalData, data.engine);
        this.#journal.seal(migratedSnapshot, currentFingerprint);
        epochResult = { applied: migrated.applied, baseIndex: this.#journal.baseIndex };
      } else {
        this.#journal.restore(journalData);
        if (stableStringify(this.runtime.snapshot()) !== stableStringify(data.engine))
          throw new Error("session_corrupt:journal_engine");
      }
    } else {
      const snapshot = schemaChanged
        ? (() => {
            const migrated = this.runtime.sealMigrations(data.engine.state);
            epochResult = { applied: migrated.applied, baseIndex: 0 };
            return { state: migrated.state, rng: data.engine.rng };
          })()
        : data.engine;
      this.runtime.restore(snapshot);
      this.#journal.reset(snapshot);
    }
    // 조립을 거쳐 로드된 본문(refs+bodies)만 '이미 영속됨' — 인라인(구형·백업)은 다음 save가 1회 기록한다.
    this.#persistedEpochOffsets = new Set(
      data.sealedEpochBodies && data.journal?.contract === "simbot-event-journal/0.2"
        ? (data.journal.sealedEpochRefs ?? []).map((ref) => ref.offset)
        : [],
    );
    // 샤드 청크 캐시 시딩 — integrity 통과한 매니페스트만 신뢰. 인라인(구형·백업)은 null → 전량 재기록.
    this.#messageShardHashes = data.shardManifest ? [...data.shardManifest.messages.chunks] : null;
    this.#journalShardHashes = data.shardManifest ? [...data.shardManifest.journalEvents.chunks] : null;
    this.#turn = data.turn;
    this.#messages = data.messages.map((message) => ({
      ...message,
      origin:
        message.origin ?? (message.role === "assistant" ? "model" : "user"),
    }));
    this.#messagesChanged();
    this.#messagesChain = null;
    // 위에서 integrity까지 통과한 매니페스트의 청크 해시는 그대로 재사용한다. 여기서 캐시를
    // 버리면 장기 회차를 다시 연 직후 저장할 때 과거 메시지 청크 전부를 재해시·재기록한다.
    // 메시지를 실제로 잘라내거나 분기를 바꾸는 경로는 각자 이 캐시를 명시적으로 폐기한다.
    this.#lastLogs = data.lastLogs;
    this.#lastSpeakers = clone(data.lastSpeakers ?? []);
    this.#alternates = clone(data.alternates ?? []);
    this.#responseBranches = clone(data.responseBranches ?? []);
    this.#promptRuns = compactPromptRuns(clone(data.promptRuns ?? []));
    this.#cbsVariables = clone(data.cbsVariables ?? {});
    if (data.cardRuntimeJournal) {
      this.#cardRuntimeJournal.restore(data.cardRuntimeJournal);
      const cardState = this.#cardRuntimeJournal.state;
      if (
        stableStringify(cardState.variables) !==
        stableStringify(this.#cbsVariables)
      )
        throw new Error("session_corrupt:card_runtime_variables");
    } else {
      const seed =
        parseInt(fnv1a(`${this.id}:${this.runtime.project.projectId}`), 16) >>>
        0;
      this.#cardRuntimeJournal = new CardRuntimeJournal({
        variables: this.#cbsVariables,
        randomState: seed || 1,
        logicalTimeMs: 1_700_000_000_000,
      });
    }
    this.#ledgerNarrativeQueue = data.ledgerNarrativeQueue
      ? clone(data.ledgerNarrativeQueue)
      : legacyLedgerQueue(data.ledgerDeltas ?? []);
    this.#checkpoints = clone(data.history?.undo ?? []).slice(-30);
    this.#redoStack = clone(data.history?.redo ?? []).slice(-30);
    if (epochResult) {
      const boundary = epochResult.baseIndex;
      this.#checkpoints = this.#checkpoints.filter((entry) => entry.journalCursor >= boundary);
      this.#redoStack = this.#redoStack.filter((entry) => entry.journalCursor >= boundary);
      this.#alternates = this.#alternates.filter((entry) => (entry.journalCursor ?? 0) >= boundary);
      this.#responseBranches = this.#responseBranches
        .map((branch) => ({ ...branch, variants: branch.variants.filter((entry) => (entry.journalCursor ?? 0) >= boundary) }))
        .filter((branch) => branch.variants.length > 0);
    }
    if (data.bindings) {
      this.#persona = clone(data.bindings.persona);
      this.#preset = clone(data.bindings.preset);
    }
    // 프리셋 사전 재구성: 복원된 현재 프리셋 + 동봉 사전 + 구형 인라인 체크포인트의 프리셋.
    this.#presetSnapshots = new Map();
    this.#rememberPreset(this.#preset);
    for (const [key, preset] of Object.entries(data.history?.presetSnapshots ?? {}))
      if (!this.#presetSnapshots.has(key)) this.#presetSnapshots.set(key, clone(preset));
    for (const checkpoint of [...this.#checkpoints, ...this.#redoStack])
      if (checkpoint.bindings.preset) this.#rememberPreset(checkpoint.bindings.preset);
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
    this.memory.reset(data.memory,data.memoryArchivePages??[]);
    this.memory.compactEngineFacts(); // 구형 장기 회차도 첫 복원에서 반복 엔진 사실을 즉시 다이어트한다.
    this.#continuityPatches.reset(data.continuityPatches ?? []);
    this.#syncMessageSeq();
    if (data.pendingActionReceipt)
      this.#recoverActionReceipt(data.pendingActionReceipt, value.integrity ?? "", schemaChanged);
    if (epochResult) {
      const diagnostic = {
        kind: "card",
        code: "session_epoch_sealed",
        baseIndex: epochResult.baseIndex,
        migrations: epochResult.applied,
      };
      this.#lastLogs = [...this.#lastLogs, diagnostic];
      this.#append(
        "assistant",
        "엔진이 업데이트되어 이전 기록을 봉인하고 이어갑니다. 되돌리기는 이 지점 이후부터 가능합니다.",
        "engine",
        { facts: [diagnostic], chips: [{ ok: true, kind: "card", text: "이전 기록 봉인·상태 이주 완료" }] },
      );
    }
    const last = this.#lastModelResponseId();
    if (!this.#responseBranches.length && this.#alternates.length && last)
      this.#responseBranches = [
        {
          messageId: last,
          active: this.#alternates.length,
          variants: [
            ...clone(this.#alternates),
            this.#captureResponseState(last),
          ],
        },
      ];
    this.#notify();
  }
  #recoverActionReceipt(receipt: ActionWalReceipt, baseIntegrity: string, schemaChanged: boolean) {
    this.#walPresent = true;
    if (receipt.expectedJournalCursor <= this.#journal.cursor) return; // 코어 저장 뒤 WAL 삭제만 실패한 안전한 잔여물
    if (schemaChanged) throw new Error("session_corrupt:action_wal_schema");
    if (receipt.baseIntegrity !== baseIntegrity) throw new Error("session_corrupt:action_wal_base");
    const actions: ActionWalEntry[] = receipt.actions?.length ? receipt.actions : [{mode:receipt.mode,events:receipt.events,expectedJournalCursor:receipt.expectedJournalCursor,expectedStateHash:receipt.expectedStateHash,expectedRng:receipt.expectedRng,expectedLogsHash:receipt.expectedLogsHash,turnAfter:receipt.turnAfter}];
    for (const action of actions) {
      if (!action.events.length || action.events[0]?.parentIndex !== this.#journal.cursor)
        throw new Error("session_corrupt:action_wal_parent");
      const logs: Record<string, unknown>[] = [];
      this.#pushCheckpoint();
      for (const expected of action.events) {
        const rows = this.runtime.dispatch(expected.event.id, expected.event.params as Record<string, unknown>).log as Record<string, unknown>[],
          actual = this.#journal.rawEvents.at(-1);
        if (!actual || stableHash(actual) !== stableHash(expected))
          throw new Error(`session_corrupt:action_wal_replay:${expected.index}`);
        logs.push(...rows);
        this.#recordEngineFacts(expected.event.id, rows, actual.index);
        if (action.mode === "ledger")
          for (const log of rows) if (log.ok) this.#enqueueLedgerNarrative(expected.event.id, log, actual.index);
      }
      const head = this.#journal.head();
      if (head.index !== action.expectedJournalCursor || head.stateHash !== action.expectedStateHash || head.rng !== action.expectedRng || stableHash(logs) !== action.expectedLogsHash)
        throw new Error("session_corrupt:action_wal_head");
      if (action.turnAfter !== this.#turn + 1) throw new Error("session_corrupt:action_wal_turn");
      this.#lastLogs = clone(logs);
      this.#lastSpeakers = [];
      this.#narrativeIssues = [];
      if (action.mode === "ledger") this.#append("assistant", "장부에 반영되었습니다.", "ledger", { facts: logs });
      else {
        this.#ledgerNarrativeQueue = [];
        this.#append("assistant", "관리 결과가 반영되었습니다.", "engine", {
          facts: logs,
          chips: [{ ok: true, kind: "system", text: "종료 직전 엔진 결과 복구 · 서사만 생략" }],
        });
      }
      this.#turn = action.turnAfter;
    }
    const head = this.#journal.head();
    if (head.index !== receipt.expectedJournalCursor || head.stateHash !== receipt.expectedStateHash || head.rng !== receipt.expectedRng || stableHash(this.#lastLogs) !== receipt.expectedLogsHash)
      throw new Error("session_corrupt:action_wal_head");
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.#journalShardHashes = null;
    // 디스크 코어는 아직 영수증 이전 상태다. 다음 행동 전에 복구 결과를 먼저 전체 저장하게 한다.
    this.#persistedIntegrity = null;
    this.#syncMessageSeq();
  }
  static #presetKey(preset: Pick<PromptPreset, "id" | "version">) {
    return `${preset.id}:${preset.version}`;
  }
  static PERSISTED_UNDO_DEPTH = 5;
  #persistedHistory(): SessionHistory {
    const undo = clone(this.#checkpoints.slice(-PlaySession.PERSISTED_UNDO_DEPTH)),
      redo = clone(this.#redoStack.slice(-PlaySession.PERSISTED_UNDO_DEPTH)),
      currentKey = PlaySession.#presetKey(this.#preset),
      referenced = new Set(
        [...undo, ...redo]
          .map((checkpoint) => checkpoint.bindings.presetRef)
          .filter((ref): ref is { id: string; version: number } => !!ref)
          .map((ref) => PlaySession.#presetKey(ref)),
      ),
      presetSnapshots: Record<string, PromptPreset> = {};
    for (const key of referenced)
      if (key !== currentKey) { // 현재 프리셋은 bindings.preset이 이미 실어 나른다
        const kept = this.#presetSnapshots.get(key);
        if (kept) presetSnapshots[key] = clone(kept);
      }
    return { undo, redo, ...(Object.keys(presetSnapshots).length ? { presetSnapshots } : {}) };
  }
  #rememberPreset(preset: PromptPreset) {
    const key = PlaySession.#presetKey(preset);
    if (!this.#presetSnapshots.has(key)) this.#presetSnapshots.set(key, clone(preset));
    return key;
  }
  #resolveCheckpointPreset(bindings: SessionCheckpointBindings): PromptPreset {
    if (bindings.preset) return clone(bindings.preset); // 구형 체크포인트(프리셋 인라인)
    const key = bindings.presetRef ? PlaySession.#presetKey(bindings.presetRef) : null,
      kept = key ? this.#presetSnapshots.get(key) : null;
    return kept ? clone(kept) : this.#preset; // 사전 누락(이론상 불가) 시 현재 프리셋 유지
  }
  #captureCheckpoint(includeMessages = false): SessionCheckpoint {
    return {
      turn: this.#turn,
      messageCount: this.#messages.length,
      ...(includeMessages ? { messages: this.messages } : {}),
      memory: this.memory.checkpoint(),
      ...(this.memory.archiveCheckpoint().length ? { memoryArchivePages: clone(this.memory.archiveCheckpoint()) } : {}),
      continuityPatches: this.continuityPatches,
      lastLogs: this.lastLogs,
      cbsVariables: clone(this.#cbsVariables),
      lastSpeakers: this.rawLastSpeakers,
      alternates: clone(this.#alternates),
      ledgerNarrativeQueue: clone(this.#ledgerNarrativeQueue),
      journalCursor: this.#journal.cursor,
      cardRuntimeCursor: this.#cardRuntimeJournal.cursor,
      bindings: { persona: clone(this.#persona), presetRef: { id: this.#preset.id, version: this.#preset.version } },
    };
  }
  #restoreCheckpoint(value: SessionCheckpoint) {
    const messages = value.messages
      ? clone(value.messages)
      : this.#messages.slice(0, value.messageCount);
    this.#journal.moveTo(value.journalCursor);
    this.#turn = value.turn;
    this.#messages = messages;
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.memory.reset(value.memory,value.memoryArchivePages??[]);
    this.memory.compactEngineFacts();
    this.#continuityPatches.reset(value.continuityPatches ?? []);
    this.#lastLogs = clone(value.lastLogs);
    if (value.cardRuntimeCursor !== undefined) {
      const card = this.#cardRuntimeJournal.moveTo(value.cardRuntimeCursor);
      if (
        stableStringify(card.variables) !== stableStringify(value.cbsVariables)
      )
        throw new Error("card_runtime_checkpoint_diverged");
      this.#cbsVariables = card.variables;
    } else this.#cbsVariables = clone(value.cbsVariables);
    this.#lastSpeakers = clone(value.lastSpeakers);
    this.#alternates = clone(value.alternates);
    this.#ledgerNarrativeQueue = value.ledgerNarrativeQueue
      ? clone(value.ledgerNarrativeQueue)
      : legacyLedgerQueue(value.ledgerDeltas ?? []);
    this.#persona = clone(value.bindings.persona);
    this.#preset = this.#resolveCheckpointPreset(value.bindings);
    this.#rememberPreset(this.#preset);
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
    this.#syncMessageSeq();
    this.#notify();
  }
  #lastModelResponseId() {
    return [...this.#messages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.origin === "model",
      )?.id;
  }
  #captureResponseState(messageId: string): AlternateState {
    const index = this.#messages.findIndex(
      (message) => message.id === messageId,
    );
    if (index < 0) throw new Error(`message_not_found:${messageId}`);
    const next = this.#checkpoints.find(
        (value) => value.messageCount === index + 1,
      ),
      atHead = index === this.#messages.length - 1,
      turn = atHead ? this.#turn : (next?.turn ?? this.#turn),
      journalCursor = atHead
        ? this.#journal.cursor
        : (next?.journalCursor ?? this.#journal.cursor),
      cardRuntimeCursor = atHead
        ? this.#cardRuntimeJournal.cursor
        : (next?.cardRuntimeCursor ?? this.#cardRuntimeJournal.cursor),
      messages = this.messages.slice(0, index + 1),
      bindings = atHead || !next?.bindings
        ? { persona: clone(this.#persona), preset: clone(this.#preset) }
        : { persona: clone(next.bindings.persona), preset: this.#resolveCheckpointPreset(next.bindings) };
    return {
      messages,
      engine: this.#journal.stateAt(journalCursor),
      logs: atHead ? this.lastLogs : clone(next?.lastLogs ?? []),
      memory: atHead ? this.memory.all() : clone(next?.memory ?? []),
      memoryArchivePages: atHead ? this.memory.archivePages() : clone(next?.memoryArchivePages ?? []),
      continuityPatches: atHead
        ? this.continuityPatches
        : clone(next?.continuityPatches ?? []),
      speakers: atHead ? this.rawLastSpeakers : clone(next?.lastSpeakers ?? []),
      promptRuns: this.promptRuns.filter(
        (run) =>
          messages.some((message) => run.id.endsWith(`:${message.id}`)) ||
          run.turn < turn,
      ),
      ledgerNarrativeQueue: atHead
        ? clone(this.#ledgerNarrativeQueue)
        : clone(next?.ledgerNarrativeQueue ?? legacyLedgerQueue(next?.ledgerDeltas ?? [])),
      journalCursor,
      cardRuntimeCursor,
      turn,
      cbsVariables: atHead
        ? clone(this.#cbsVariables)
        : clone(next?.cbsVariables ?? {}),
      bindings,
    };
  }
  #restoreAlternate(value: AlternateState) {
    this.#messages = clone(value.messages);
    this.#messagesChanged();
    this.#messagesChain = null;
    this.#messageShardHashes = null;
    this.#lastLogs = clone(value.logs);
    this.#lastSpeakers = clone(value.speakers);
    this.#promptRuns = compactPromptRuns(clone(value.promptRuns ?? []));
    this.#ledgerNarrativeQueue = value.ledgerNarrativeQueue
      ? clone(value.ledgerNarrativeQueue)
      : legacyLedgerQueue(value.ledgerDeltas ?? []);
    if (value.journalCursor === undefined) {
      this.runtime.restore(value.engine);
      this.#journal.reset(value.engine);
    } else {
      const engine = this.#journal.stateAt(value.journalCursor);
      if (stableStringify(engine) !== stableStringify(value.engine))
        throw new Error("session_corrupt:alternate_journal");
      this.#journal.moveTo(value.journalCursor);
    }
    this.#turn = value.turn ?? this.#turn;
    this.memory.reset(value.memory,value.memoryArchivePages??[]);
    this.memory.compactEngineFacts();
    this.#continuityPatches.reset(value.continuityPatches ?? []);
    if (value.cardRuntimeCursor !== undefined) {
      const card = this.#cardRuntimeJournal.moveTo(value.cardRuntimeCursor);
      if (
        value.cbsVariables &&
        stableStringify(card.variables) !== stableStringify(value.cbsVariables)
      )
        throw new Error("session_corrupt:alternate_card_runtime");
      this.#cbsVariables = card.variables;
    } else this.#cbsVariables = clone(value.cbsVariables ?? this.#cbsVariables);
    if (value.bindings) {
      this.#persona = clone(value.bindings.persona);
      this.#preset = clone(value.bindings.preset);
    }
    setActiveRenderContext(this.#regexScripts, this.#cbsVariables);
    this.#syncMessageSeq();
  }
  #syncLegacyAlternates(branch: ResponseBranchSet) {
    this.#alternates = branch.variants
      .filter((_, index) => index !== branch.active)
      .map((value) => clone(value));
  }
  #pushCheckpoint() {
    this.#checkpoints.push(this.#captureCheckpoint());
    if (this.#checkpoints.length > 30) this.#checkpoints.shift();
    this.#redoStack = [];
    this.#alternates = [];
  }
  #recordEngineFacts(
    eventId: string,
    logs: Record<string, unknown>[],
    journalIndex = this.#journal.cursor,
  ) {
    for (const [index, log] of logs.entries())
      if (log.ok) {
        const evidenceId = `${this.#turn}:${eventId}:${index}`;
        this.memory.replace(
          memoryRecord({
            id: `engine:${evidenceId}`,
            text: `${eventId} 결과: ${JSON.stringify(log)}`,
            turn: this.#turn,
            status: "approved",
            kind: "engine-fact",
            canonicalAnchors: [engineMemoryAnchor(eventId, log)],
            importance: 5,
            lifecycle: { state: "active", timeScope: "current" },
            evidence: [{ kind: "event", id: String(journalIndex) }],
            sourceEventIndexes: [journalIndex],
          }),
          this.#turn,
        );
        // GFL 관계 리듬은 수치 로그와 함께 사람이 읽을 수 있는 장면 사실도 보존한다.
        // 다음 대화 프롬프트가 외출 장소·트라우마 진전·약속 맥락을 임의로 다시 만들지 않게 한다.
        if (eventId.startsWith("gfl/relation/") && typeof log.narrativeFact === "string") {
          const dollId = String(log.dollId ?? "");
          this.memory.replace(
            memoryRecord({
              id: `gfl-relation:${evidenceId}`,
              text: log.narrativeFact,
              turn: this.#turn,
              status: "approved",
              kind: "relation",
              ...(dollId ? { entities: [dollId] } : {}),
              canonicalAnchors: [`gfl-relation:${eventId}:${dollId || evidenceId}`],
              importance: 6,
              lifecycle: { state: "active", timeScope: "current" },
              evidence: [{ kind: "event", id: String(journalIndex) }],
              sourceEventIndexes: [journalIndex],
            }),
            this.#turn,
          );
        }
        // 티어 통과는 장기 회상 앵커가 된다 — "N일차에 신뢰가 되었다"를 나중에 사람 말로 찾을 수 있게
        // JSON 사실과 별도로 읽을 수 있는 기억을 남긴다. 같은 앵커의 옛 티어 기억은 replace가 폐기한다.
        const tier = log.tierChanged as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (tier?.to?.label) {
          const target = String(log.target ?? ""),
            name = this.resolveSpeakers([{ npcId: target }])[0]?.name ?? target;
          this.memory.replace(
            memoryRecord({
              id: `tier:${evidenceId}`,
              text: `${name}와의 관계가 '${String(tier.to.label)}' 단계가 되었다${tier.from?.label ? ` (이전: ${String(tier.from.label)})` : ""}`,
              turn: this.#turn,
              status: "approved",
              kind: "relation",
              entities: [target],
              canonicalAnchors: [
                `tier:${String(log.scale ?? "affinity")}:${target}`,
              ],
              importance: 7,
              lifecycle: { state: "active", timeScope: "current" },
              evidence: [{ kind: "event", id: String(journalIndex) }],
              sourceEventIndexes: [journalIndex],
            }),
            this.#turn,
          );
        }
      }
  }
  #enqueueLedgerNarrative(eventId: string, log: Record<string, unknown>, journalIndex: number) {
    const key = engineMemoryAnchor(eventId, log), summary = ledgerNarrativeSummary(log),
      existingIndex = this.#ledgerNarrativeQueue.findIndex((value) => value.key === key),
      existing = existingIndex >= 0 ? this.#ledgerNarrativeQueue[existingIndex] : undefined;
    if (existing) {
      const summaries = existing.summaries.includes(summary)
        ? existing.summaries
        : [...existing.summaries, summary].slice(-MAX_LEDGER_NARRATIVE_SAMPLES);
      const next = { ...existing, count: existing.count + 1, lastJournalIndex: journalIndex, summaries };
      this.#ledgerNarrativeQueue.splice(existingIndex, 1);
      this.#ledgerNarrativeQueue.push(next);
    } else {
      this.#ledgerNarrativeQueue.push({ key, eventId, count: 1, firstJournalIndex: journalIndex, lastJournalIndex: journalIndex, summaries: [summary] });
    }
    if (this.#ledgerNarrativeQueue.length > MAX_LEDGER_NARRATIVE_GROUPS)
      this.#ledgerNarrativeQueue.splice(0, this.#ledgerNarrativeQueue.length - MAX_LEDGER_NARRATIVE_GROUPS);
  }
  #sceneId() {
    const state = this.runtime.state as Record<string, unknown>,
      core = state.core as Record<string, unknown> | undefined;
    return String(
      core?.location ??
        state.location ??
        state.sceneId ??
        this.runtime.project.projectId,
    );
  }
  #processContinuity(
    response: NarrativeResponse,
    assistant: ChatMessage,
    userMessage: ChatMessage | undefined,
    events: MemoryEvidenceEvent[],
  ) {
    const factReferenceVerdicts = validateFactReferences(response.factRefs, {
        hasState: true,
        ...(userMessage ? { userMessageId: userMessage.id } : {}),
        events,
      }),
      memoryDecisions = ingestMemoryTurn(this.memory, {
        turn: this.#turn,
        sceneId: this.#sceneId(),
        ...(userMessage
          ? {
              userMessage: { id: userMessage.id, content: userMessage.content },
            }
          : {}),
        assistantMessage: { id: assistant.id, content: assistant.content },
        candidates: response.memories ?? [],
        events,
        userId: this.#persona?.id ?? "user",
      }),
      patch = this.#continuityPatches.propose(
        response.continuityPatch,
        this.#turn,
        this.memory.allStored().map((record) => record.id),
      ),
      invalid = factReferenceVerdicts.filter((verdict) => !verdict.ok);
    if (invalid.length)
      assistant.chips = [
        ...(assistant.chips ?? []),
        {
          ok: false,
          kind: "memory",
          text: `근거 참조 ${invalid.length}건 검토 필요`,
        },
      ];
    return {
      memoryDecisions,
      factReferenceVerdicts,
      ...(patch ? { continuityPatchId: patch.id } : {}),
    };
  }
  #managementPrompt(
    eventIds: string[],
    logs: Record<string, unknown>[],
    flavorText: string,
  ): CompiledPrompt {
    const history =
        flavorText &&
        this.#messages.at(-1)?.role === "user" &&
        this.#messages.at(-1)?.content === flavorText
          ? this.#messages.slice(0, -1)
          : this.#messages,
      recent = history
        .slice(-4)
        .map((message) => ({
          role: message.role,
          content:
            message.origin === "greeting"
              ? stripPromptImageMarkup(message.content)
              : message.content,
        })),
      changes = this.#ledgerNarrativeQueue.length
        ? `\n[직전 현장 장면 이후 장부 변화]\n${this.#ledgerNarrativeQueue.map((value) => `- ${value.eventId}${value.count > 1 ? ` ×${value.count}` : ""}: ${value.summaries.join(" / ")}`).join("\n")}`
        : "",
      persona = this.#persona?.prompt?.trim()
        ? `\n플레이어 페르소나: ${this.#persona.name}\n${this.#persona.prompt}`
        : "",
      catalog = narrativeCatalog(this.runtime.project,this.#assets,this.#cbsVariables.toggle_GFNSFW === "1"),
      // 서사화 경로엔 카드 시스템 프롬프트(이미지 표식 형식을 가르치는)가 실리지 않는다.
      // 스프라이트 가이드는 이름만 주고 형식을 카드에 위임하므로, GFL 네이티브에선 형식을 여기서 직접 준다 —
      // 안 주면 모델이 [M16A1_smug] 같은 대괄호 표기를 지어내 본문에 노출된다.
      gflFormatGuide =
        object(this.runtime.project.content).nativePresentation === "gfl" ||
        this.runtime.project.moduleIds?.includes("genre.gfl")
          ? '이미지 표식은 [|<img="캐릭터_표정">|"대사"|] 형식만 사용한다. [캐릭터_표정]처럼 대괄호 안에 이름만 넣는 표기는 금지한다.'
          : "",
      npcGuide = [
        catalog.npcs.length
          ? `[등장 가능한 NPC]\n${catalog.npcs.join("\n")}`
          : "",
        spriteCommandGuide(catalog.sprites),
        gflFormatGuide,
      ]
        .filter(Boolean)
        .join("\n"),
      stageGuides = [...new Set(logs.map((log) => typeof log.guide === "string" ? log.guide.trim() : "").filter(Boolean))],
      stageGuide = stageGuides.length
        ? `\n[현재 작전 단계의 원본 서사 지시]\n${stageGuides.join("\n")}\n이 지시는 엔진이 확정한 현재 단계에만 적용하며, 지시와 모순되는 전투·사건을 추가하지 않는다.`
        : "",
      context = `[이미 확정·반영된 엔진 결과]\n행동: ${eventIds.join(", ")}\n${JSON.stringify(logs)}${changes}\n\n[현재 엔진 상태]\n${JSON.stringify(this.#engineStateForPrompt())}${flavorText ? `\n\n플레이어의 연출 의도: ${flavorText}` : ""}`;
    return {
      messages: [
        {
          role: "system",
          content: `${this.#card.name}의 관리 결과를 한국어 250자 안팎의 자연스러운 장면으로 서사화한다.${persona}\n엔진 결과의 수치와 성공·실패를 그대로 따른다. 결과를 바꾸거나 새 사건·날짜 진행·거래·재고 변화를 만들지 않는다. JSON 사건을 제안하지 말고 이야기만 쓴다. 이전 메시지의 이미지 태그를 현재 장면의 화자 근거 없이 복사하지 않는다.${stageGuide}${npcGuide ? `\n${npcGuide}\n등장인물 이미지를 쓸 때는 위 NPC와 스프라이트 명령만 사용한다.` : ""}`,
        },
        ...recent,
        { role: "user", content: context },
      ],
      assistantPrefill: "",
      trace: [],
      warnings: catalog.sprites.warnings.map((warning) => ({ ...warning, path: "sprite-catalog" })),
    };
  }
  #syncMessageSeq() {
    this.#messageSeq = this.#messages.reduce(
      (max, message) =>
        Math.max(max, Number(message.id.match(/^m(\d+)$/)?.[1] ?? 0)),
      0,
    );
  }
  #storedSpeakers(items: readonly SpeakerReference[]) {
    const explicitFocus = items.some((item) => item.focus === true);
    return this.#snapshotSpeakers(items).map(
      ({ npcId, emotion, outfit, focus }) => ({
        npcId,
        ...(emotion === undefined ? {} : { emotion }),
        ...(outfit === undefined ? {} : { outfit }),
        ...(explicitFocus && focus ? { focus: true } : {}),
      }),
    );
  }
  #append(
    role: "user" | "assistant",
    content: string,
    origin: ChatMessage["origin"] = role === "assistant" ? "model" : "user",
    extra: Pick<ChatMessage, "facts" | "chips" | "speakers"> = {},
  ) {
    const normalized =
        role === "assistant" && extra.speakers
          ? { ...extra, speakers: this.#storedSpeakers(extra.speakers) }
          : extra,
      message = {
        id: `m${++this.#messageSeq}`,
        index: this.#messages.length,
        role,
        content,
        createdAt: new Date().toISOString(),
        origin,
        ...normalized,
      };
    this.#messages.push(message);
    this.#messagesChanged();
    if (this.#messagesChain && this.#messagesChain.count === this.#messages.length - 1)
      this.#messagesChain = { count: this.#messages.length, hash: fnv1a(this.#messagesChain.hash + stableHash(message)) };
    else { this.#messagesChain = null; this.#messageShardHashes = null; } // append는 청크 캐시를 깨지 않는다 — 체인 이탈 시에만 폐기
    this.#notify();
    return message;
  }
  async #compile(query: string, continuation = false, signal?: AbortSignal) {
    const retrieval = await planPerspectiveMemory(this.memory, query, {
        atTurn: this.#turn,
        provider: this.#embeddingProvider,
        viewer: { userId: this.#persona?.id ?? "user" },
        sceneId: this.#sceneId(),
        limit: 8,
        budgetTokens: 1000,
        perKindQuota: 3,
        signal,
      }, this.#memoryPerspectives(query)),
      memory = retrieval.sections.map((section) => {
        const caution = section.id === "common" ? "" : " — 이 인물만 아는 사실이며 다른 인물의 말이나 생각에 누설하지 않는다";
        return `[${section.label}${caution}]\n${section.records.map((value) => `- ${value.text} [${value.evidence.map((item) => `${item.kind}:${item.id}`).join(", ")}]`).join("\n")}`;
      }).join("\n\n");
    this.#lastMemoryTrace = clone(retrieval.trace);
    let chat = this.#messages
      .slice(-this.#historyWindow)
      .map(({ role, content, origin }) => ({
        role,
        content:
          origin === "greeting" ? stripPromptImageMarkup(content) : content,
      }));
    if (continuation) chat.push({ role: "user" as const, content: query });
    /* maxContext는 한·영 가중 근사 토큰 예산이다. 최신 대화는 항상 남기고 오래된 메시지부터 제거한다. */ if (
      this.#maxContext &&
      this.#maxContext > 0
    )
      while (
        chat.length > 1 &&
        chat.reduce(
          (sum, message) => sum + estimateTokens(message.content),
          0,
        ) > this.#maxContext
      )
        chat.shift();
    const lore = activateLore(this.#lore, chat, {
      seed: this.runtime.snapshot().rng,
      turn: this.#turn,
    }).entries.map(({ content, name }) => ({ content, name }));
    const catalog=narrativeCatalog(this.runtime.project,this.#assets,this.#cbsVariables.toggle_GFNSFW === "1"),nativeGfl=object(this.runtime.project.content).nativePresentation==='gfl',card=nativeGfl?{...this.#card,systemPrompt:`${this.#card.systemPrompt??'{{original}}'}\n${spriteCommandGuide(catalog.sprites)}`} : this.#card;
    const compiled = compilePrompt({
      preset: this.#preset,
      activeModules: activeModules(this.runtime.project),
      assets:this.#assets.map(asset=>({...asset,bytes:null})),
      persona: this.#persona,
      card,
      lore: { entries: lore },
      chat,
      memory,
      variables:this.#cbsVariables,
      engineContext: {
        facts: `다음 JSON은 엔진이 소유한 현재 사실이다. 서사로 수치를 바꾸지 말고 이벤트 결과만 따른다.\n${JSON.stringify(this.#engineStateForPrompt())}`,
        availableActions: `제작자가 LLM에 허용한 이벤트 ID: ${this.runtime.allowedModelEventIds().join(", ") || "(없음)"}. 이 목록 밖 이벤트를 제안하지 않는다. 결정 카드가 있는 경우 본문에 별도 번호 선택지를 만들지 않는다.\n${spriteCommandGuide(catalog.sprites)}`,
        groundedMemory: retrieval.abstained
          ? "관련 근거가 부족하므로 과거 사실을 추측하지 않는다."
          : memory,
      },
    });
    compiled.warnings.push(...catalog.sprites.warnings.map((warning) => ({ ...warning, path: "sprite-catalog" })));
    return compiled;
  }
}

// 체크포인트·redo·대안·사건 원장은 snapshot에 저장되며 무결성 해시로 함께 봉인한다.
export * from "./chat-store.ts";
export * from "./providers/index.ts";
export * from "./sprite-catalog.ts";
export * from "./memory-contract.ts";
