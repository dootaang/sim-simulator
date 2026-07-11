// Phase C 오프라인 검증 — 실제 .ts provider/planner/gate를 실행한다(선언만 검사 아님).
// 외부 네트워크 호출 0 — fetch를 mock으로 주입. Node 24 네이티브 타입 스트리핑으로 실행:
//   node --test test/memoryPhaseC.test.ts  (package.json의 test:phasec)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createVoyageProvider, maskSecrets, VOYAGE_LIMITS, VoyageError } from '../core/memory/providers/voyage.ts';
import { createEmbeddingCache, fnv1a } from '../core/memory/embeddingCache.ts';
import { decideAbstention, DEFAULT_ABSTENTION } from '../core/memory/abstention.ts';
import { planGroundedHybrid } from '../core/memory/groundedPlanner.ts';
import { createGroundedLexicalSearch } from '../core/memory/groundedLexical.ts';
import type { MemoryRecord } from '../core/memory/contracts.ts';

const require = createRequire(import.meta.url);
const corpus = require('./fixtures/memory-benchmark/corpus.json');
const { buildLexicalIndex, lexicalSearch } = require('../core/memory/retrievers/lexical.js');

// ── mock fetch: 결정론 가짜 임베딩(요청 그룹 수만큼 벡터 반환) ──
function mockFetch(capture: { bodies: string[]; calls: number }, opts: { failTimes?: number; status?: number } = {}) {
  let n = 0;
  return async (_url: string, init: { body: string }) => {
    capture.calls += 1;
    capture.bodies.push(init.body);
    if (opts.failTimes && n < opts.failTimes) { n += 1; return { ok: false, status: opts.status ?? 429, json: async () => ({}), text: async () => 'rate limited' }; }
    const parsed = JSON.parse(init.body) as { inputs: string[][] };
    const data = parsed.inputs.map((group) => ({ embeddings: group.map((chunk) => [chunk.length % 7, (chunk.length * 3) % 5, 1]) }));
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
  };
}
const noSleep = async () => {};
let clock = 0;
const now = () => (clock += 5);

test('voyage provider: document/query 직렬화와 input_type이 계약대로다', async () => {
  const cap = { bodies: [] as string[], calls: 0 };
  const p = createVoyageProvider({ apiKey: 'pa-secret-key-123456', fetchImpl: mockFetch(cap), sleep: noSleep, now });
  const docs = await p.embedDocumentGroups([['첫 조각', '둘째 조각'], ['다른 그룹']]);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].length, 2);
  const q = await p.embedQueries(['질의1', '질의2']);
  assert.equal(q.length, 2);
  const docBody = JSON.parse(cap.bodies[0]);
  assert.equal(docBody.input_type, 'document');
  const qBody = JSON.parse(cap.bodies[1]);
  assert.equal(qBody.input_type, 'query');
  assert.deepEqual(qBody.inputs, [['질의1'], ['질의2']]); // query는 각각 한 묶음
});

test('voyage provider: 캐시가 동일 입력 재호출을 막고 통계를 집계한다', async () => {
  const cap = { bodies: [] as string[], calls: 0 };
  const cache = createEmbeddingCache();
  const p = createVoyageProvider({ apiKey: 'pa-x', fetchImpl: mockFetch(cap), sleep: noSleep, now, cache });
  await p.embedDocumentGroups([['같은 텍스트']]);
  await p.embedDocumentGroups([['같은 텍스트']]); // 캐시 히트 → 네트워크 호출 없음
  assert.equal(cap.calls, 1);
  assert.ok(p.stats().cacheHits >= 1);
  assert.ok(p.stats().inputTokensEstimate > 0);
});

test('voyage provider: 429는 bounded backoff로 재시도하고 최대치 초과 시 실패한다', async () => {
  const cap = { bodies: [] as string[], calls: 0 };
  const okAfter = createVoyageProvider({ apiKey: 'pa-x', fetchImpl: mockFetch(cap, { failTimes: 2, status: 429 }), sleep: noSleep, now, maxRetries: 4 });
  const r = await okAfter.embedQueries(['q']);
  assert.equal(r.length, 1);
  assert.equal(okAfter.stats().retries, 2);

  const cap2 = { bodies: [] as string[], calls: 0 };
  const exhaust = createVoyageProvider({ apiKey: 'pa-x', fetchImpl: mockFetch(cap2, { failTimes: 9, status: 429 }), sleep: noSleep, now, maxRetries: 2 });
  await assert.rejects(() => exhaust.embedQueries(['q']), /voyage_retry_exhausted/);
});

test('voyage provider: 입력 한도를 초과하면 네트워크 전에 거부한다', async () => {
  const cap = { bodies: [] as string[], calls: 0 };
  const p = createVoyageProvider({ apiKey: 'pa-x', fetchImpl: mockFetch(cap), sleep: noSleep, now });
  const tooMany = Array.from({ length: VOYAGE_LIMITS.maxInputs + 1 }, () => ['x']);
  await assert.rejects(() => p.embedDocumentGroups(tooMany), VoyageError);
  assert.equal(cap.calls, 0); // 호출 자체가 없어야
});

test('voyage provider: 오류 메시지에 API 키가 노출되지 않는다', async () => {
  const key = 'pa-super-secret-abcdef';
  const failing = async () => { throw new Error(`connect fail with header authorization: Bearer ${key}`); };
  const p = createVoyageProvider({ apiKey: key, fetchImpl: failing as never, sleep: noSleep, now });
  await assert.rejects(() => p.embedQueries(['q']), (err: Error) => {
    assert.ok(!err.message.includes(key), '키가 에러에 노출됨');
    return true;
  });
  assert.equal(maskSecrets(`x ${key} y`, key).includes(key), false);
});

test('abstention: gate off는 절대 abstain 안 하고, soft는 저신뢰에서 abstain', () => {
  const hits = [{ recordId: 'a', score: 0.02, selectedBecause: [], sourceMessageIds: [], sourceEventIndexes: [] }];
  assert.equal(decideAbstention(hits, { gate: 'off', minConfidence: 0.15, calibrated: false }).abstain, false);
  assert.equal(decideAbstention(hits, DEFAULT_ABSTENTION).abstain, true);
  assert.equal(decideAbstention([], DEFAULT_ABSTENTION).abstain, true);
  assert.equal(DEFAULT_ABSTENTION.calibrated, false); // 실측 전 uncalibrated 표시
});

test('embeddingCache: 문맥 포함 결정론 키 + 히트/미스 통계', () => {
  const c = createEmbeddingCache();
  const k = c.key('voyage-context-3', 1024, 'document', 'ctx1', '텍스트');
  assert.equal(c.get(k), undefined);
  c.set(k, [1, 2, 3]);
  assert.deepEqual(c.get(k), [1, 2, 3]);
  assert.notEqual(k, c.key('voyage-context-3', 1024, 'document', 'ctx2', '텍스트')); // 문맥이 다르면 키가 다름
  assert.equal(fnv1a('a') === fnv1a('a'), true);
});

// ── Grounded Hybrid V2 (C2) — fixed lexical, semantic 없음/있음 결정론 ──
function lexFn(index: unknown) {
  return (query: string, k: number) => lexicalSearch(index, query, k).map((s: { recordId: string; score: number }) => ({ recordId: s.recordId, score: s.score }));
}
const ALIASES = { silvia: ['실비아', 'Silvia'], mirian: ['미리안', 'Mirian'], kang: ['강한결', 'Kang'], iris: ['아이리스', 'Iris'], sera: ['세라', 'Sera'] };

test('grounded: semantic provider 없어도 lexical-only로 fail-open 동작', async () => {
  const index = buildLexicalIndex(corpus.records);
  // 공개 현재사실(위치)을 묻는 질의 — semantic 없이도 lexical만으로 결과가 나와야(fail-open).
  const plan = await planGroundedHybrid(corpus.records, '강한결은 지금 어디 있어?', { lexicalSearch: lexFn(index) }, { atTurn: 329, entityAliases: ALIASES, abstention: { gate: 'off', minConfidence: 0.15, calibrated: false } });
  assert.ok(plan.reason!.includes('lexical-only'));
  // 위치 같은 현재사실은 authoritative 블록으로, 나머지 회상은 hits로 — 둘 중 하나엔 결과가 있어야.
  assert.ok(plan.currentFacts.length + plan.hits.length > 0);
});

test('grounded: 롤백된(폐기) 기억은 기본적으로 주입 후보에서 제외된다', async () => {
  const index = buildLexicalIndex(corpus.records);
  const plan = await planGroundedHybrid(corpus.records, '골드가 얼마였지?', { lexicalSearch: lexFn(index) }, { atTurn: 329, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  for (const hit of plan.hits) {
    const rec = corpus.records.find((r: { id: string }) => r.id === hit.recordId);
    assert.ok(rec.validToTurn == null || rec.validToTurn >= 329, `폐기 기억 ${hit.recordId} 주입됨`);
  }
});

test('grounded: 기본은 deny-by-default(public만) — viewer 스코프 없으면 비밀(user)이 주입 안 됨', async () => {
  const index = buildLexicalIndex(corpus.records);
  // viewerScopes 생략 → 기본 public만. secret(user)·promise(entity:*)는 통과 못 함(감사 Major: 기본값 비밀 차단).
  const dflt = await planGroundedHybrid(corpus.records, '강한결 이중 등록 비밀', { lexicalSearch: lexFn(index) },
    { atTurn: 329, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  for (const hit of dflt.hits) {
    const rec = corpus.records.find((r: { id: string }) => r.id === hit.recordId);
    assert.notEqual(rec.knowledgeScope, 'user');
  }
  // user 스코프를 명시하면 비밀이 보인다.
  const withUser = await planGroundedHybrid(corpus.records, '강한결 이중 등록 비밀', { lexicalSearch: lexFn(index) },
    { atTurn: 329, viewerScopes: ['public', 'user'], abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.ok(withUser.hits.some((h) => corpus.records.find((r: { id: string }) => r.id === h.recordId).knowledgeScope === 'user'));
});

test('grounded: 라틴 별칭은 단어 경계, 한글 고유명은 substring으로 참조 판정(감사 Major 보완)', async () => {
  const index = buildLexicalIndex(corpus.records);
  // 한글 조사 교착도 정상 매칭돼야: "강한결이" 안의 "강한결" 인식.
  const kang = await planGroundedHybrid(corpus.records, '강한결이 나한테 한 약속', { lexicalSearch: lexFn(index) },
    { atTurn: 329, entityAliases: ALIASES, viewerScopes: ['public', 'user', 'entity:kang'], abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  const top = corpus.records.find((r: { id: string }) => r.id === kang.hits[0].recordId);
  assert.ok(top.entities.includes('kang'), '강한결 참조가 entity 부스트로 상위에 와야');
});

test('voyage 캐시: 배치 순서가 바뀌어도 같은 내용은 캐시 히트(감사 Major)', async () => {
  const cap = { bodies: [] as string[], calls: 0 };
  const cache = createEmbeddingCache();
  const p = createVoyageProvider({ apiKey: 'pa-x', fetchImpl: mockFetch(cap), sleep: noSleep, now, cache });
  await p.embedDocumentGroups([['A'], ['B']]);
  await p.embedDocumentGroups([['B'], ['A']]); // 순서만 뒤바뀜 → 전부 캐시 히트여야
  assert.equal(cap.calls, 1);
});

test('grounded: 결정론 — 같은 입력 두 번이 동일 결과', async () => {
  const index = buildLexicalIndex(corpus.records);
  const args = ['미리안이 도와주기로 한 일', { lexicalSearch: lexFn(index) }, { atTurn: 329, entityAliases: ALIASES }] as const;
  const a = await planGroundedHybrid(corpus.records, ...args);
  const b = await planGroundedHybrid(corpus.records, ...args);
  assert.deepEqual(a.hits.map((h) => h.recordId), b.hits.map((h) => h.recordId));
});

function memory(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'text'>): MemoryRecord {
  return {
    kind: 'episode',
    sourceMessageIds: [`msg-${overrides.id}`],
    sourceEventIndexes: [],
    entities: [],
    createdTurn: 1,
    validFromTurn: 1,
    validToTurn: null,
    supersedes: [],
    importance: 0.5,
    knowledgeScope: 'public',
    status: 'approved',
    ...overrides,
  };
}

test('continuity contract: 현재 장면 기억은 다른 장면의 현재 질문에 섞이지 않는다', async () => {
  const records = [
    memory({ id: 'inn-now', text: '실비아는 여관 홀에서 접시를 닦고 있다', sceneId: 'inn', lifecycle: { timeScope: 'current' } }),
    memory({ id: 'guild-now', text: '실비아는 길드 접수대 앞에 서 있다', sceneId: 'guild', lifecycle: { timeScope: 'current' } }),
  ];
  const plan = await planGroundedHybrid(records, '실비아는 지금 어디에 있어?',
    { lexicalSearch: createGroundedLexicalSearch(records) },
    { atTurn: 10, sceneId: 'inn', abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.ok(plan.hits.some((hit) => hit.recordId === 'inn-now'));
  assert.ok(!plan.hits.some((hit) => hit.recordId === 'guild-now'));
});

test('continuity contract: 비밀은 보유자에게만 보이고 denied 목록이 우선한다', async () => {
  const records = [memory({
    id: 'silvia-secret',
    text: '실비아는 지하 금고 열쇠를 화분 아래 숨겼다',
    knowledgeScope: 'entity:silvia',
    knowledge: { privacy: 'secret', holderEntityIds: ['silvia'], deniedToEntityIds: ['owner'], truth: 'true' },
  })];
  const search = createGroundedLexicalSearch(records);
  const owner = await planGroundedHybrid(records, '금고 열쇠를 어디 숨겼지?', { lexicalSearch: search },
    { atTurn: 10, viewerScopes: ['public', 'entity:silvia'], viewerEntityIds: ['owner'], abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(owner.hits.length, 0);
  const silvia = await planGroundedHybrid(records, '금고 열쇠를 어디 숨겼지?', { lexicalSearch: search },
    { atTurn: 10, viewerScopes: ['public', 'entity:silvia'], viewerEntityIds: ['silvia'], abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(silvia.hits[0]?.recordId, 'silvia-secret');
});

test('continuity contract: 소문과 추론은 authoritative 사실로 승격되지 않는다', async () => {
  const records = [memory({
    id: 'rumor', kind: 'event', text: '상인이 사실은 왕족이라는 소문',
    knowledge: { type: 'rumor', state: 'uncertain', truth: 'contested', privacy: 'public' },
  })];
  const plan = await planGroundedHybrid(records, '상인의 정체는?', { lexicalSearch: createGroundedLexicalSearch(records) },
    { atTurn: 10, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(plan.currentFacts.length, 0);
  assert.ok(plan.hits[0]?.selectedBecause.includes('requires-uncertain-language'));
});

test('continuity contract: 폐기 기억은 과거 질문에서 명시적으로 요청할 때만 회수한다', async () => {
  const records = [memory({ id: 'old-room', text: '실비아는 예전에 101호를 썼다', validToTurn: 4, status: 'superseded', lifecycle: { state: 'superseded', timeScope: 'past' } })];
  const search = createGroundedLexicalSearch(records);
  const current = await planGroundedHybrid(records, '실비아의 방은 지금 어디야?', { lexicalSearch: search },
    { atTurn: 10, includeSuperseded: true, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(current.hits.length, 0);
  const past = await planGroundedHybrid(records, '실비아가 예전에 쓰던 방을 기억해?', { lexicalSearch: search },
    { atTurn: 10, includeSuperseded: true, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(past.hits[0]?.recordId, 'old-room');
});

test('continuity lexical: 무관한 질문은 낮은 근거로 abstain한다', async () => {
  const records = [memory({ id: 'egg-price', text: '삶은 달걀 가격은 오천 원이다', canonicalAnchors: ['삶은 달걀'] })];
  const plan = await planGroundedHybrid(records, '달의 뒷면에 사는 용의 생일은?',
    { lexicalSearch: createGroundedLexicalSearch(records) }, { atTurn: 10 });
  assert.equal(plan.abstained, true);
  assert.equal(plan.hits.length, 0);
});

test('grounded: 승인 전 candidate는 authoritative 현재 사실이 될 수 없다', async () => {
  const records = [memory({ id: 'candidate-fact', kind: 'engine-fact', text: '금고에는 백만 원이 있다', status: 'candidate' })];
  const plan = await planGroundedHybrid(records, '금고 잔액은?', { lexicalSearch: createGroundedLexicalSearch(records) },
    { atTurn: 10, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(plan.currentFacts.length, 0);
  assert.equal(plan.hits.length, 0);
});

test('grounded: 나중에 폐기된 사실도 조회 시점에 유효했다면 당시 사실로 복원한다', async () => {
  const records = [memory({ id: 'past-valid', kind: 'event', text: '7턴의 실비아 위치는 지하 수로', status: 'superseded', validFromTurn: 7, validToTurn: 64 })];
  const plan = await planGroundedHybrid(records, '7턴의 실비아 위치는?', { lexicalSearch: createGroundedLexicalSearch(records) },
    { atTurn: 7, abstention: { gate: 'off', minConfidence: 0, calibrated: false } });
  assert.equal(plan.currentFacts[0]?.recordId, 'past-valid');
});
