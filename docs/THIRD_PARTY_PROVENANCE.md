# 제3자 코드 출처 (Third-Party Provenance)

이 프로젝트(GPL-3.0-or-later)에 선별 이식한 외부 코드의 출처를 기록한다. ADR 0001 · CLAUDE-TASK-HYPA §9 정책.

## SQLite Wasm

- Package: `@sqlite.org/sqlite-wasm` `3.53.0-build1`
- Repo: https://github.com/sqlite/sqlite-wasm
- License: Apache-2.0
- 사용 범위: 전용 Worker 안의 SQLite OO1 API와 OPFS VFS. `sqlite3.wasm` 및 공식 OPFS async proxy를 빌드 결과에 그대로 배포한다.
- 우리 코드: `app/src/persistence/sqliteWorker.ts`, `app/core/session/browserPersistence.ts`
- Worker1/Promiser API는 2026-04-15부터 deprecated이므로 사용하지 않고, 공식 권고대로 라이브러리를 자체 Worker 안에서 직접 초기화한다.

## RisuAI

- Repo: https://github.com/kwaroran/RisuAI
- License: GPL-3.0
- 비교 기준 commit: `9d8791ea842404ef3c7e6410c2359a2db7ca4bcd`
- 로컬 조사 클론: `C:\risu` (HEAD `eb7780b`, 위 기준 commit 이후 main)

### 이식/재현 내역

| 날짜 | 원본 파일·함수 | 우리 파일 | 이식 방식 | 변경 내용 |
|---|---|---|---|---|
| 2026-07-12 | `src/ts/process/memory/hypav3.ts` — `simpleCC` | `app/core/memory/ranking.js` — `weightedScoreCombination` | 의미 재현(전체 복사 아님) | 제네릭→id 문자열 키, Map 순회를 결정론 정렬로 안정화 |
| 2026-07-12 | `src/ts/process/memory/hypav3.ts` — `simpleRRF` | `app/core/memory/ranking.js` — `reciprocalRankFusion` | 의미 재현 | k 기본값 60 동일, tie-break에 id 사전순 추가(결정론) |
| 2026-07-12 | `src/ts/process/memory/hypav3.ts` — `childToParentRRF` | `app/core/memory/ranking.js` — `childToParentRRF` | 의미 재현 | 동일 알고리즘, 부모 키를 문자열로 |
| 2026-07-12 | `src/ts/process/memory/hypav3.ts` — `normalizeScores` | `app/core/memory/ranking.js` — `normalizeScores` | 의미 재현 | min==max 분기 동일 |
| 2026-07-12 | `hypav3.ts` 예산 선택(L500~820) — recent/similar/random 비율, 20% 기억 예산 | `app/core/memory/contextPlanner.js` — `planHypaV3` | 의미 재현 | 무작위 선택을 `Math.random` 대신 seed 기반으로 격리(결정론 재현 요구), frozen summary 사용 |

### 명시적으로 가져오지 않은 것

- `hypav3.ts` 전체, Risu DB(`DBState`)·Svelte store·localForage 결합
- LLM 요약 호출 파이프라인(1차 벤치마크는 frozen summary 사용)
- `Math.random()` 기반 기억 선택(기본 경로에서 배제, seed 모드로만 재현)
- Risu UI 트리(`HypaV3Modal` 등)

## Voyage AI

- Phase C 배선 완료(실측 대기). `app/core/memory/providers/voyage.ts` — REST `POST /v1/contextualizedembeddings`,
  input_type query/document, 입력 한도(inputs 1000·chunks 16000·tokens 120000), 429 bounded backoff, 캐시.
- 공식 문서 기준 `voyage-context-3`(Risu 재현 기준) / `voyage-context-4`(최신 대안). 실측 전 우열 단정 안 함.
- API 키는 코드·fixture·로그·리포트·세션 export에 기록하지 않음. `VOYAGE_API_KEY` + `--live-voyage` 이중 opt-in.

## 커뮤니티 플러그인 (개념 참고 — 코드 미복사)

원본 위치 `C:\freetalk\리스플러그인분석용`. 파일이 고도로 minify돼 있고 Risu 런타임(pluginStorage/DOM/전역)에
강결합돼 있어 **코드를 복사하지 않고 개념만 참조해 독립 재구현**했다. SHA-256은 원본 갱신 추적용.

| 원본 | 표시 버전 | SHA-256 | 참조한 개념 | 우리 구현(재구현) |
|---|---:|---|---|---|
| `LIBRA World Manager.js` | 5.3.1 | `81FCEB0F…C774D8` | evidence gate off/soft/strict, rollback row tombstone, embedding cache/queue | `abstention.ts`(gate), `groundedPlanner.ts`(rollback 필터·budget/quota), `embeddingCache.ts` |
| `RisuAI Agent v5.3.1.js` | 5.3.1 | `F8117404…10EC6` | recency decay, embedding batch 아이디어 | `groundedPlanner.ts` recency 가중, `voyage.ts` 배치/캐시 |

- Risu DB·pluginStorage·DOM·API 키 저장·직접 채팅 수정 코드는 가져오지 않음(금지선).
- `risu_agents.js`(1.1.9, `1E1D24D1…770CC`)·`multiagent-full-v0.8.4`(`E5A89828…EA7A4`)는 후속 에이전트 런타임 연구용으로만 기록, 이번 Phase C 미포함.
