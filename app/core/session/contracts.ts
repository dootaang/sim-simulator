// SPDX-License-Identifier: GPL-3.0-or-later
// S1 — 장기 세션 저장소 계약 (BACKLOG P1.5).
// 어댑터 교체 지점: 인메모리(memoryStore.js) ↔ 브라우저 SQLite WASM+OPFS ↔ Tauri 네이티브 SQLite.
// 결정론 원칙: 저장 계층은 벽시계·난수를 만들지 않는다 — 모든 시각/식별 메타는 호출자가 주입한다.

export interface SessionMeta {
  id: string;
  title: string;
  /** sessionJournal.stableStringify 기반 스키마 해시 — 다른 스키마의 세션을 잘못 열지 않기 위한 지문. */
  schemaHash: string;
  seed: number;
  /** 호출자가 주입하는 생성 시각(epoch ms). 저장소는 생성하지 않는다. */
  createdAt: number;
}

export interface ChatMessageRecord {
  index: number;
  role: 'user' | 'assistant' | 'ledger';
  content: string;
  chips?: unknown[];
  npcIds?: string[];
}

export interface EngineEventRecord {
  index: number;
  event: { id: string; params?: Record<string, unknown> };
  ok: boolean;
}

/** 모든 LLM 요청의 재현 기록 — 무엇이 들어가 무엇이 나왔고 무엇이 적용/거부됐는가. */
export interface PromptRunRecord {
  index: number;
  promptHash: string;
  model: string;
  /** C2 trace 요약 — 블록 id·활성 여부. 전체 trace는 크기상 선택 저장. */
  blocks?: Array<{ blockId: string; active: boolean }>;
  responseText: string;
  proposedEvents: Array<{ id: string; params?: Record<string, unknown> }>;
  appliedEventIndexes: number[];
  rejectedReasons?: string[];
}

export interface SnapshotRecord {
  index: number;
  stateHash: string;
  state: unknown;
  rng: number;
}

export interface SessionExport {
  contract: 'session-store/0.1';
  meta: SessionMeta;
  messages: ChatMessageRecord[];
  engineEvents: EngineEventRecord[];
  promptRuns: PromptRunRecord[];
  snapshots: SnapshotRecord[];
}

export interface SessionStore {
  createSession(meta: SessionMeta): SessionMeta;
  listSessions(): SessionMeta[];
  getSession(sessionId: string): SessionExport | null;
  appendMessage(sessionId: string, message: ChatMessageRecord): void;
  appendEngineEvent(sessionId: string, record: EngineEventRecord): void;
  recordPromptRun(sessionId: string, run: PromptRunRecord): void;
  saveSnapshot(sessionId: string, snapshot: SnapshotRecord): void;
  exportSession(sessionId: string): SessionExport;
  importSession(payload: SessionExport): SessionMeta;
  deleteSession(sessionId: string): void;
}
