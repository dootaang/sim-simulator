// SPDX-License-Identifier: GPL-3.0-or-later
// C2 — Grounded Hybrid V2. 우선순위:
//   authoritative engine facts > 유효 structured events > knowledgeScope 통과 narrative
//   > lexical sparse prefilter > (필요할 때만) semantic > evidence gate + abstention
// 순수 함수 — retriever(lexical/semantic)를 주입받아 JS 모듈 import 없이 타입체크 가능.
// 개념 참고: LIBRA evidence gate·rollback tombstone, RisuAI Agent recency decay (코드 미복사).
//   출처는 docs/THIRD_PARTY_PROVENANCE.md.

import type { MemoryRecord, RetrievalHit, RetrievalPlan } from './contracts.ts';
import { decideAbstention, DEFAULT_ABSTENTION } from './abstention.ts';
import type { AbstentionConfig } from './abstention.ts';

export interface ScoredId { recordId: string; score: number; evidenceScore?: number; }
export type LexicalSearchFn = (query: string, k: number) => ScoredId[];
export type SemanticSearchFn = (query: string, k: number) => Promise<ScoredId[]>;

export interface GroundedConfig {
  atTurn: number;
  viewerScopes?: string[];               // 이 관찰자가 볼 수 있는 knowledgeScope 집합
  viewerEntityIds?: string[];            // 이 기억을 실제로 아는 인물 id
  sceneId?: string;                      // 현재 장면 id
  queryMode?: 'auto' | 'current' | 'past';
  entityAliases?: Record<string, string[]>; // npcId -> 표기들(NPC disambiguation)
  includeSuperseded?: boolean;           // 롤백된 과거값을 주입 후보에 넣을지(기본 false)
  budgetTokens?: number;
  perKindQuota?: Partial<Record<string, number>>;
  abstention?: AbstentionConfig;
  // evidence gate: 최상위 lexical 점수가 이 값 미만이면 semantic hit을 주입하지 않는다.
  semanticEvidenceFloor?: number;
  topK?: number;
}

const AUTHORITATIVE_KINDS = new Set(['engine-fact', 'relation', 'event']);
// 기본은 공개만(deny-by-default) — 비밀(user)·NPC 전용(entity:*)은 호출부가 명시적으로 열어야
// 노출된다(감사 Major: 기본값에 user가 있으면 public 화자 맥락에 비밀 유출 위험). ADR "안전한 기본값 우선".
const DEFAULT_VIEWER_SCOPES = ['public'];

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

function scopeAllowed(record: MemoryRecord, viewerScopes: string[]): boolean {
  const scope = record.knowledgeScope || 'public';
  if (viewerScopes.includes(scope)) return true;
  // entity:<id> 스코프는 관찰자 스코프에 'entity:<id>'가 있을 때만 통과.
  return false;
}

function knowledgeAllowed(record: MemoryRecord, viewerScopes: string[], viewerEntityIds: string[]): boolean {
  if (!scopeAllowed(record, viewerScopes)) return false;
  const knowledge = record.knowledge;
  if (!knowledge) return true;
  if (knowledge.state === 'forgotten' || knowledge.state === 'hidden') return false;
  if (knowledge.deniedToEntityIds?.some((id) => viewerEntityIds.includes(id))) return false;
  if (knowledge.privacy === 'public' || knowledge.type === 'public-fact') return true;
  const allowed = new Set([...(knowledge.visibleToEntityIds ?? []), ...(knowledge.holderEntityIds ?? [])]);
  if (!allowed.size) return knowledge.privacy == null;
  return viewerEntityIds.some((id) => allowed.has(id));
}

function queryModeOf(query: string, requested: GroundedConfig['queryMode']): 'current' | 'past' {
  if (requested && requested !== 'auto') return requested;
  return /(?:그때|예전|과거|이전|당시|옛날|기억|전에|used to|previously|back then|history)/iu.test(query)
    ? 'past'
    : 'current';
}

function sceneAllowed(record: MemoryRecord, sceneId: string | undefined, mode: 'current' | 'past'): boolean {
  if (!sceneId || mode === 'past') return true;
  if (record.lifecycle?.timeScope !== 'current') return true;
  const recordScene = record.sceneId ?? record.sourceLocator?.sceneId;
  return !recordScene || recordScene === sceneId;
}

function uncertain(record: MemoryRecord): boolean {
  return record.knowledge?.truth === 'contested'
    || record.knowledge?.truth === 'unknown'
    || record.knowledge?.state === 'suspected'
    || record.knowledge?.state === 'uncertain'
    || record.knowledge?.state === 'misunderstood'
    || record.knowledge?.type === 'rumor'
    || record.knowledge?.type === 'inferred';
}

function hitOf(record: MemoryRecord, extra: Partial<RetrievalHit>): RetrievalHit {
  return {
    recordId: record.id,
    score: 0,
    selectedBecause: [],
    sourceMessageIds: record.sourceMessageIds.slice(),
    sourceEventIndexes: record.sourceEventIndexes.slice(),
    ...extra,
  };
}

// 별칭이 질의에 등장하는지. 라틴 별칭은 단어 경계를 요구해 오분류를 막는다
//  (예: "Sera"⊂"several"). 한글은 조사 교착("강한결이","실비아야")으로 뒤 글자가 늘 한글이라
//  스크립트 경계를 쓰면 정상 매칭까지 깨진다 → 한글 고유명은 substring을 유지한다(감사 Major 보완).
function aliasMatches(query: string, alias: string): boolean {
  const q = query.toLowerCase();
  const a = String(alias).toLowerCase();
  if (!a) return false;
  const isLatin = /^[a-z0-9]+$/.test(a);
  if (!isLatin) return q.includes(a); // 한글/혼합 고유명 — substring
  let from = 0;
  for (;;) {
    const idx = q.indexOf(a, from);
    if (idx < 0) return false;
    const before = idx > 0 ? q[idx - 1] : '';
    const after = idx + a.length < q.length ? q[idx + a.length] : '';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true; // 라틴 단어 경계
    from = idx + 1;
  }
}

// 질의가 참조하는 엔티티 id 추출. NPC disambiguation의 기반.
function referencedEntities(query: string, aliases: Record<string, string[]>): Set<string> {
  const found = new Set<string>();
  for (const [id, names] of Object.entries(aliases)) {
    for (const name of names) if (aliasMatches(query, name)) { found.add(id); break; }
  }
  return found;
}

export async function planGroundedHybrid(
  records: MemoryRecord[],
  query: string,
  deps: { lexicalSearch: LexicalSearchFn; semanticSearch?: SemanticSearchFn },
  config: GroundedConfig,
): Promise<RetrievalPlan> {
  const atTurn = config.atTurn;
  const viewerScopes = config.viewerScopes ?? DEFAULT_VIEWER_SCOPES;
  const viewerEntityIds = config.viewerEntityIds ?? viewerScopes
    .filter((scope) => scope.startsWith('entity:'))
    .map((scope) => scope.slice('entity:'.length));
  const aliases = config.entityAliases ?? {};
  const includeSuperseded = config.includeSuperseded === true;
  const topK = config.topK ?? 20;
  const budgetTokens = config.budgetTokens ?? 2000;
  const abstentionCfg = config.abstention ?? DEFAULT_ABSTENTION;
  const evidenceFloor = config.semanticEvidenceFloor ?? 0.05;
  const queryMode = queryModeOf(query, config.queryMode ?? 'auto');
  const byId = new Map(records.map((r) => [r.id, r]));

  // 유효 시점·승인·스코프·롤백 필터를 통과한 주입 가능 집합.
  function injectable(r: MemoryRecord): boolean {
    if (r.createdTurn > atTurn) return false;
    const isPast = r.validToTurn != null && r.validToTurn < atTurn;
    if (r.status !== 'approved' && !(includeSuperseded && queryMode === 'past' && r.status === 'superseded')) return false;
    if (isPast && !(includeSuperseded && queryMode === 'past')) return false; // rollback tombstone
    if (!knowledgeAllowed(r, viewerScopes, viewerEntityIds)) return false;
    if (!sceneAllowed(r, config.sceneId, queryMode)) return false;
    return true;
  }

  // 1) authoritative 현재 사실(폐기값 제외) — 절대 semantic으로 대체하지 않는다.
  const currentFacts = records
    .filter((r) => r.validFromTurn <= atTurn && (r.validToTurn == null || r.validToTurn >= atTurn))
    // superseded는 "지금은 폐기"라는 뜻이다. 조회 시점의 유효구간 안이라면 그 당시 사실로
    // 인정하되, candidate/rejected는 어떤 시점에도 authoritative로 승격하지 않는다.
    .filter((r) => (r.status === 'approved' || r.status === 'superseded') && AUTHORITATIVE_KINDS.has(r.kind))
    .filter((r) => knowledgeAllowed(r, viewerScopes, viewerEntityIds) && sceneAllowed(r, config.sceneId, 'current'))
    .filter((r) => !uncertain(r) && r.knowledge?.truth !== 'false')
    .map((r) => hitOf(r, { selectedBecause: ['authoritative-current'] }));

  const refEntities = referencedEntities(query, aliases);

  // 2) lexical sparse prefilter.
  const lex = deps.lexicalSearch(query, topK * 3).filter((s) => byId.has(s.recordId) && injectable(byId.get(s.recordId)!));
  // 3) semantic — 어휘가 약한 의역도 구할 수 있게 provider가 있으면 검색한다.
  // 실제 주입 여부는 아래 evidence floor와 abstention이 결정한다.
  let sem: ScoredId[] = [];
  let semanticUsed = false;
  if (deps.semanticSearch) {
    sem = (await deps.semanticSearch(query, topK * 3)).filter((s) => byId.has(s.recordId) && injectable(byId.get(s.recordId)!));
    semanticUsed = true;
  }

  // 4) 융합 — 순위 자체가 아니라 실제 근거 강도를 쓴다. 그래야 무관한 검색 결과의
  //    1등이 자동으로 고확신이 되는 문제를 막을 수 있다.
  const score = new Map<string, number>();
  const evidence = new Map<string, number>();
  const because = new Map<string, string[]>();
  const bump = (id: string, s: number, tag: string, evidenceValue?: number) => {
    score.set(id, (score.get(id) || 0) + s);
    if (evidenceValue != null) evidence.set(id, Math.max(evidence.get(id) ?? 0, evidenceValue));
    const list = because.get(id) || []; if (!list.includes(tag)) list.push(tag); because.set(id, list);
  };
  lex.forEach((s) => {
    const ev = Math.max(0, Math.min(1, s.evidenceScore ?? s.score));
    bump(s.recordId, ev * 0.65, 'lexical', ev);
  });
  sem.forEach((s) => {
    const ev = Math.max(0, Math.min(1, s.evidenceScore ?? s.score));
    if (ev >= evidenceFloor) bump(s.recordId, ev * 0.35, 'semantic', ev);
  });
  if (refEntities.size) {
    for (const id of score.keys()) {
      const rec = byId.get(id)!;
      const recEnts = new Set(rec.entities);
      const hasRef = [...refEntities].some((e) => recEnts.has(e));
      const hasOtherRef = [...recEnts].some((e) => !refEntities.has(e) && Object.prototype.hasOwnProperty.call(aliases, e));
      if (hasRef) bump(id, 0.10, 'entity-match');
      else if (hasOtherRef && recEnts.size > 0) bump(id, -0.15, 'other-entity');
    }
  }

  // importance(사용자 고정) 미세 부스트.
  for (const id of score.keys()) {
    const rec = byId.get(id)!;
    if (rec.importance > 0.5) bump(id, 0.02 * rec.importance, 'important');
    if (uncertain(rec)) bump(id, 0, 'requires-uncertain-language');
  }

  const ranked = [...score.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([id, s]) => hitOf(byId.get(id)!, {
      score: Math.max(0, Math.min(1, s)),
      evidenceScore: evidence.get(id) ?? 0,
      selectedBecause: because.get(id) || [],
    }));

  // 5) token budget + per-kind quota. authoritative 현재사실에 이미 든 record는 회상 hit에서
  //    제외해 프롬프트 중복 적재를 막는다(감사 Nit).
  const factIds = new Set(currentFacts.map((h) => h.recordId));
  const perKindQuota = config.perKindQuota ?? {};
  const kindUsed: Record<string, number> = {};
  const hits: RetrievalHit[] = [];
  let tokens = 0;
  for (const hit of ranked) {
    if (hits.length >= topK) break;
    if (factIds.has(hit.recordId)) continue;
    const rec = byId.get(hit.recordId)!;
    const quota = perKindQuota[rec.kind];
    if (quota != null && (kindUsed[rec.kind] || 0) >= quota) continue;
    const t = estimateTokens(rec.text);
    if (tokens + t > budgetTokens && hits.length > 0) break;
    hits.push(hit);
    tokens += t;
    kindUsed[rec.kind] = (kindUsed[rec.kind] || 0) + 1;
  }

  // 6) evidence gate + abstention.
  const decision = decideAbstention(hits, abstentionCfg);
  return {
    hits: decision.abstain ? [] : hits,
    currentFacts,
    abstained: decision.abstain,
    confidence: decision.confidence,
    reason: `${decision.reason}${semanticUsed ? '' : '|lexical-only'}`,
  };
}
