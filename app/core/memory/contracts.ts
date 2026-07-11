// SPDX-License-Identifier: GPL-3.0-or-later
// M1 — 장기 기억 검색 계층 계약. CLAUDE-TASK-HYPA §5.
// 결정론 원칙: 검색·랭킹은 순수 함수, 임베딩 provider는 교체 지점(fixed ↔ Voyage).

export type MemoryKind =
  | 'engine-fact' | 'event' | 'promise' | 'secret' | 'relation' | 'episode' | 'summary';

// "누가, 언제, 어떤 장면에서 알게 되었는가"를
// Simbot의 구조화 출력과 SessionJournal에 맞게 표현하는 계약이다.
// 모든 필드는 선택값이라 기존 저장 데이터도 그대로 읽을 수 있다.
export interface MemorySourceLocator {
  sourceMessageFingerprint?: string;
  sourcePacketIndex?: number;
  sceneId?: string;
  eventTime?: string;
  observedAt?: string;
  knownAt?: string;
  narrationTime?: string;
  lastConfirmedAt?: string;
}

export type MemoryKnowledgeType =
  | 'experienced' | 'witnessed' | 'heard' | 'inferred' | 'rumor'
  | 'private-thought' | 'public-fact';
export type MemoryKnowledgeState =
  | 'known' | 'suspected' | 'uncertain' | 'misunderstood' | 'forgotten' | 'hidden';
export type MemoryPrivacy = 'public' | 'shared' | 'private' | 'secret' | 'internal';
export type MemoryTruthState = 'true' | 'false' | 'contested' | 'unknown';

export interface MemoryKnowledge {
  type?: MemoryKnowledgeType;
  state?: MemoryKnowledgeState;
  privacy?: MemoryPrivacy;
  truth?: MemoryTruthState;
  visibleToEntityIds?: string[];
  deniedToEntityIds?: string[];
  holderEntityIds?: string[];
  inferredByEntityIds?: string[];
}

export interface MemoryLifecycle {
  state?: 'active' | 'resolved' | 'dormant' | 'superseded' | 'no-longer-true';
  timeScope?: 'current' | 'past' | 'unknown';
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceMessageIds: string[];
  sourceEventIndexes: number[];
  entities: string[];
  createdTurn: number;
  validFromTurn: number;
  validToTurn: number | null;   // null이면 현재까지 유효
  supersedes: string[];         // 이 기록이 대체한 과거 기록 id
  importance: number;           // 0..1, 사용자 고정 기억 등
  // 누가 이 기억을 아는가(C0-4): 'public' 아무나 | 'user' 플레이어 전용(비밀) | 'entity:<npcId>' 특정 NPC
  knowledgeScope: string;
  status: 'candidate' | 'approved' | 'rejected' | 'superseded';
  canonicalAnchors?: string[];
  sceneId?: string;
  sourceLocator?: MemorySourceLocator;
  knowledge?: MemoryKnowledge;
  lifecycle?: MemoryLifecycle;
}

// 검색·주입 결정 계약(C0-1, C2). planner는 abstention 판단을 함께 낼 수 있다.
export interface RetrievalPlan {
  hits: RetrievalHit[];
  currentFacts: RetrievalHit[];
  abstained?: boolean;          // '관련 기억 없음'을 택했는가
  confidence?: number;          // 상위 hit 신뢰도(0..1, uncalibrated)
  reason?: string;
}

// 임베딩 provider — fixed(결정론, 외부 호출 없음) ↔ voyage(실호출)로 교체.
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimension: number;
  // 문서 그룹: 같은 요약/에피소드의 순서 있는 조각들을 한 묶음으로.
  embedDocumentGroups(groups: string[][]): Promise<number[][][]>;
  embedQueries(queries: string[]): Promise<number[][]>;
}

export interface RetrievalHit {
  recordId: string;
  score: number;
  // 정렬용 점수와 별개인 실제 어휘/의미 근거 강도. abstention은 이 값을 본다.
  evidenceScore?: number;
  lexicalScore?: number;
  semanticScore?: number;
  recencyScore?: number;
  importanceScore?: number;
  selectedBecause: string[];
  sourceMessageIds: string[];
  sourceEventIndexes: number[];
}

export interface BenchmarkQuestion {
  queryId: string;
  category: 'current-fact' | 'superseded' | 'promise-secret-relation' | 'paraphrase' | 'npc-disambiguation' | 'negative';
  atTurn: number;
  query: string;
  expectedCurrentFacts: Record<string, string>;
  relevantMessageIds: string[];
  relevantEventIndexes: number[];
  supersededRecordIds: string[];
  forbiddenClaims: string[];
}

export interface CorpusMessage {
  id: string;
  turn: number;
  role: 'user' | 'assistant';
  content: string;
  entities: string[];
}

export interface BenchmarkCorpus {
  contract: 'memory-benchmark-corpus/0.1';
  seed: number;
  messages: CorpusMessage[];
  records: MemoryRecord[];
  questions: BenchmarkQuestion[];
}

export interface RetrievalMetrics {
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  attributionPrecision: number;
  supersededRejectionRate: number;
}

export interface FactMetrics {
  currentFactExactMatch: number;
  supersededAsCurrentCount: number;
  forbiddenClaimCount: number;
  npcConfusionCount: number;
}
