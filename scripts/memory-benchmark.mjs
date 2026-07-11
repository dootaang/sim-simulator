// 기억 벤치마크 실행 하버스 — 네 비교군을 고정 코퍼스·고정 임베딩 provider로 측정.
// 외부 API 없음(기본). 결과 JSON + Markdown 리포트를 낸다.
// 실행: cd app && npm run benchmark:memory (tsx가 TypeScript Grounded E를 함께 실행)
//   --live-voyage 는 이번 단계에서 미구현(Phase A/B 범위 밖) — 붙이면 에러로 안내.
//
// 이 스크립트는 CommonJS 모듈(app/core/memory/*)을 require로 불러온다.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planGroundedHybrid } from '../app/core/memory/groundedPlanner.ts';
import { createGroundedLexicalSearch } from '../app/core/memory/groundedLexical.ts';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const corpus = require(join(ROOT, 'app/test/fixtures/memory-benchmark/corpus.json'));
const { questions } = require(join(ROOT, 'app/test/fixtures/memory-benchmark/questions.json'));
const { createFixedEmbeddingProvider } = require(join(ROOT, 'app/core/memory/providers/fixed.js'));
const planner = require(join(ROOT, 'app/core/memory/contextPlanner.js'));
const { buildLexicalIndex } = require(join(ROOT, 'app/core/memory/retrievers/lexical.js'));
const { buildSemanticIndex } = require(join(ROOT, 'app/core/memory/retrievers/semantic.js'));
const { semanticSearch } = require(join(ROOT, 'app/core/memory/retrievers/semantic.js'));
const { evaluate } = require(join(ROOT, 'app/core/memory/benchmark.js'));

if (process.argv.includes('--live-voyage')) {
  console.error('--live-voyage 는 Phase C(Voyage 실호출)에서 구현됩니다. 현재는 고정 provider 벤치마크만 제공합니다.');
  process.exit(2);
}

async function run() {
  const provider = createFixedEmbeddingProvider({ dimension: 256 });
  const lexicalIndex = buildLexicalIndex(corpus.records);
  const semanticIndex = await buildSemanticIndex(corpus.records, provider);

  const groups = {
    'A. recent-only': (q) => planner.planRecentOnly(corpus, q),
    'B. structured+lexical': (q) => planner.planStructuredLexical(corpus, q, lexicalIndex),
    'C. hypa-v3': (q) => planner.planHypaV3(corpus, q, semanticIndex),
    'D. simbot-hybrid': (q) => planner.planSimbotHybrid(corpus, q, lexicalIndex, semanticIndex),
    'E. grounded-continuity': (q) => planGroundedHybrid(corpus.records, q.query, {
      lexicalSearch: createGroundedLexicalSearch(corpus.records),
      semanticSearch: (query, k) => semanticSearch(semanticIndex, query, k),
    }, {
      atTurn: q.atTurn,
      viewerScopes: ['public', 'user', 'entity:silvia', 'entity:mirian', 'entity:iris', 'entity:kang', 'entity:sera'],
      viewerEntityIds: ['user', 'silvia', 'mirian', 'iris', 'kang', 'sera'],
      includeSuperseded: q.category === 'superseded',
      queryMode: q.category === 'superseded' ? 'past' : 'auto',
      topK: 20,
    }),
  };

  const results = {};
  for (const [name, plan] of Object.entries(groups)) {
    const planResults = [];
    for (const q of questions) planResults.push({ question: q, plan: await plan(q) });
    results[name] = evaluate(planResults, corpus);
  }

  const outDir = join(ROOT, 'docs/reports');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'memory-benchmark-results.json'), JSON.stringify({
    schema: 'memory-benchmark-results/0.2',
    provider: provider.modelId,
    note: '고정(결정론) 임베딩 provider 측정. 절대 품질 아님. v0.1과 지표 정의가 달라 값을 직접 섞지 말 것.',
    corpus: { contract: corpus.contract, messages: corpus.messages.length, records: corpus.records.length, questions: questions.length },
    groups: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { retrieval: v.retrieval, facts: v.facts, resources: v.resources }])),
  }, null, 2) + '\n');

  writeFileSync(join(outDir, 'MEMORY-BENCHMARK.md'), renderReport(results, provider));
  console.log('benchmark done → docs/reports/MEMORY-BENCHMARK.md');
  for (const [name, r] of Object.entries(results)) {
    console.log(`${name}: R@5=${fmt(r.retrieval.recallAt5)} MRR=${fmt(r.retrieval.mrr)} nDCG@10=${fmt(r.retrieval.ndcgAt10)} 폐기오노출=${r.facts.supersededAsCurrentCount} 금지문구=${r.facts.forbiddenClaimCount}`);
  }
}

function fmt(v) { return v == null ? 'n/a' : (v * 100).toFixed(1) + '%'; }
function fmtTok(v) { return v == null ? 'n/a' : Math.round(v); }

function renderReport(results, provider) {
  const names = Object.keys(results);
  const row = (label, get) => `| ${label} | ${names.map((n) => get(results[n])).join(' | ')} |`;
  const lines = [];
  lines.push('# 기억 벤치마크 결과 (Phase A~C · schema 0.2)');
  lines.push('');
  lines.push('> 이 표는 **외부 API 없는 고정(결정론) 임베딩 provider**로 측정한 것이다. 목적은 검색 파이프라인·지표가 올바른지, 네 방식의 상대적 강약을 재는 것이다. **절대적 의미 품질이 아니다** — 실제 임베딩 품질은 Voyage 실호출(Phase C, `--live-voyage`)에서 별도 측정한다.');
  lines.push('');
  lines.push(`- provider: \`${provider.modelId}\` (문자 3-gram 해시, ${provider.dimension}차원)`);
  lines.push('- 비교군: A 최근창만 / B 구조화+어휘 / C HypaV3 재현 / D Simbot 하이브리드 / E Grounded Continuity');
  lines.push('');
  lines.push('## 검색 품질');
  lines.push('');
  lines.push(`| 지표 | ${names.join(' | ')} |`);
  lines.push(`|---|${names.map(() => '---').join('|')}|`);
  lines.push(row('Recall@1', (r) => fmt(r.retrieval.recallAt1)));
  lines.push(row('Recall@5', (r) => fmt(r.retrieval.recallAt5)));
  lines.push(row('Recall@10', (r) => fmt(r.retrieval.recallAt10)));
  lines.push(row('MRR', (r) => fmt(r.retrieval.mrr)));
  lines.push(row('nDCG@10', (r) => fmt(r.retrieval.ndcgAt10)));
  lines.push(row('근거 정확도 precision@5 (정답 대비)', (r) => fmt(r.retrieval.attributionPrecision)));
  lines.push(row('출처 보유율(precision 아님·참고)', (r) => fmt(r.retrieval.sourcePresenceRate)));
  lines.push(row('폐기 기억 거부율(현재사실 블록)', (r) => fmt(r.retrieval.supersededRejectionRate)));
  lines.push('');
  lines.push('## 게임 사실 안전성 (낮을수록 좋음, 단 abstention은 높을수록 좋음)');
  lines.push('');
  lines.push(`| 지표 | ${names.join(' | ')} |`);
  lines.push(`|---|${names.map(() => '---').join('|')}|`);
  lines.push(row('현재사실 정확도(current-fact 정답이 현재사실 블록에)', (r) => fmt(r.facts.currentFactExactMatch)));
  lines.push(row('폐기 과거값을 현재 사실로 노출(건)', (r) => String(r.facts.supersededAsCurrentCount)));
  lines.push(row('폐기 기억이 주입후보 top10에 섞인 평균(건)', (r) => (r.facts.meanSupersededInInjection == null ? 'n/a' : r.facts.meanSupersededInInjection.toFixed(2))));
  lines.push(row('NPC 혼동(오답이 top1, 건)', (r) => String(r.facts.npcConfusionCount)));
  lines.push(row('negative에서 abstention 성공률', (r) => fmt(r.facts.negativeAbstentionRate)));
  lines.push(row('답변가능 질문 과잉 abstention률', (r) => fmt(r.facts.overAbstentionRate)));
  lines.push(row('금지 문구 회상(건)', (r) => String(r.facts.forbiddenClaimCount)));
  lines.push('');
  lines.push('## 자원');
  lines.push('');
  lines.push(`| 지표 | ${names.join(' | ')} |`);
  lines.push(`|---|${names.map(() => '---').join('|')}|`);
  lines.push(row('평균 기억 토큰', (r) => fmtTok(r.resources.meanMemoryTokens)));
  lines.push(row('최대 기억 토큰', (r) => fmtTok(r.resources.maxMemoryTokens)));
  lines.push('');
  lines.push('## 카테고리별 Recall@5 (E. grounded-continuity)');
  lines.push('');
  const hybrid = results['E. grounded-continuity'];
  const byCat = {};
  for (const p of hybrid.per) { (byCat[p.category] = byCat[p.category] || []).push(p.recallAt5); }
  lines.push('| 카테고리 | Recall@5 |');
  lines.push('|---|---|');
  for (const [cat, vals] of Object.entries(byCat)) {
    const nums = vals.filter((v) => v != null);
    lines.push(`| ${cat} | ${nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : 'n/a (정답 없음)'} |`);
  }
  lines.push('');
  lines.push('## 해석 주의');
  lines.push('');
  lines.push('- **근거 정확도(top5)** = 상위 5 hit 중 실제 정답 근거인 비율(precision@5). 정답 없는 negative는 제외. (이전 버전은 "출처 필드 존재"만 봐 항상 100%였던 것을 교정.)');
  lines.push('- **폐기 기억 거부율**은 `supersededRecordIds`를 가진 질문(current-fact 20문항)에서 "폐기된 과거값이 현재 사실 블록에 안 들어갔는지"를 측정한다. superseded 카테고리 질문은 정답 자체가 과거값(회상 대상)이라 이 지표의 대상이 아니며, 대신 forbiddenClaims로 "과거를 현재로 단정" 여부를 잡는다.');
  lines.push('- negative 카테고리는 정답 record가 없으므로 Recall 집계에서 제외되고, "금지 문구 회상" 건수로만 평가한다.');
  lines.push('- 고정 provider는 어휘가 겹치는 바꿔 말하기에만 신호를 준다. 진짜 동의어·의역 회수 능력은 Voyage 측정에서 판단한다.');
  lines.push('- authoritative 현재 사실은 구조화 lookup(B·D·E)이 제공한다. E는 candidate/rejected를 제외하며, 나중에 superseded된 사실도 조회 시점의 유효구간 안에서는 당시 사실로 복원한다.');
  lines.push('');
  lines.push('## 권고 (이번 고정 provider 측정 기준)');
  lines.push('');
  lines.push('1. **현재 검색 품질 기준선은 여전히 B(구조화+어휘)다.** Recall@5가 가장 높고 외부 비용·지연이 없다.');
  lines.push('2. **E는 연속성 안전 계약을 처음 얹은 통합 기준선이지, 아직 플레이 기본값이 아니다.** 현재 사실·장면·비밀·롤백 필터는 회귀 테스트를 통과했지만, 이 코퍼스에서 Recall@5가 B보다 낮고 답변 가능한 질문을 과하게 포기한다.');
  lines.push('3. **hard-negative abstention은 아직 미해결이다.** E도 이름과 주제가 매우 비슷한 거짓 질문을 관련 기억으로 오인했다. 단순 점수 임계값만 올리면 정상 질문도 더 많이 버리므로, 다음 단계에서 주장 단위 부정 검증과 정규 앵커 일치를 별도 신호로 추가해야 한다.');
  lines.push('4. **고정 해시 임베딩은 최종 의미 품질 판정 도구가 아니다.** Voyage 실측 전까지 semantic은 opt-in으로 유지하고, 어휘 근거가 없는 semantic 단독 주입의 하한을 별도로 보정한다.');
  lines.push('');
  lines.push('> 요약: **authoritative 사실은 엔진이, 현재 기본 회수는 구조화+어휘가** 감당한다. E의 시간·장면·지식 경계는 유지하되, 검색·abstention 보정이 끝나기 전에는 라이브 프롬프트에 연결하지 않는다.');
  return lines.join('\n') + '\n';
}

run().catch((err) => { console.error(err); process.exit(1); });
