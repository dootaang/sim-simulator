# 시뮬봇 플랫폼 백로그

이 문서는 [ADR 0001](adr/0001-product-identity-and-platform-boundaries.md)과 [DESIGN](DESIGN.md)을 실제 작업 순서로 풀어 쓴다. 우선순위는 사용자 카드 표본인 용사여관, Alternate Hunters V2(얼헌), 소녀전선: 잔불, Belladonna Academy, 루미나 마을의 교차 분석을 기준으로 한다.

## 현재 결론

제품은 카드를 하나의 여관형 스키마로 바꾸는 단일 컴파일러가 아니다.

> 카드를 진단하고, 원본 근거와 미지원 기능을 보여준 뒤, 모듈·화면·에셋으로 SimPack을 조립하는 노코드 시뮬 메이커 + 플레이어 런타임.

지원 수준은 다음 네 단계로 구분한다.

1. 대화 호환: 카드·시작 장면·로어북으로 채팅
2. 시각 호환: 배경·스프라이트·감정·음악 연결
3. 시뮬 변환: 상태·선택지·퀘스트·시간·경제를 엔진 규칙으로 변환
4. 네이티브 SimPack: 제작자가 규칙과 화면을 검수한 완성 프로젝트

## 실행 순서 갱신 (2026-07-12)

현재 코드의 모듈 분리는 계속하되, 새 카드·편집기 기능을 더 붙이기 전에 다음 기반을 먼저 고정한다.

1. **Risu 호환 경계**: Risu 파일을 손실 없이 보존하고, 페르소나·프롬프트·모듈이 어디에 결합되는지 계약으로 확정
2. **SimPack 공통 모델**: Risu 원본과 우리 결정론 시뮬 데이터를 함께 담는 제작 단위 확정
3. **장기 세션 저장소**: 수백 턴의 전체 기록은 로컬에 보존하고, 매 요청에는 필요한 사실만 조립
4. **선언형 화면·모듈**: 카드마다 앱 코드를 고치지 않는 런타임 완성
5. **Alternate Hunters V2 무코드 수직 단면**: 위 기반의 실제 합격 시험
6. **폼 편집기**: 위 계약을 사람이 쉽게 다듬는 제작 화면

기술 전환은 빅뱅 재작성이 아니라 새 경계부터 `TypeScript strict`로 만들고, 화면은 Svelte 5 + Vite로 점진 이주한다. 웹은 Worker 안의 SQLite WASM + OPFS, 데스크톱은 Tauri 2 + 네이티브 SQLite를 기본 후보로 둔다.

## 외부 조사 기준

- RisuAI: `kwaroran/Risuai` main, commit `9d8791ea842404ef3c7e6410c2359a2db7ca4bcd` (2026-07-10), GPL-3.0
- Risumari: `rpaddict/risumari` main, commit `84a2ce39ad8434494738abf311aa0a0d893aa682` (2026-05-26), 저장소에 명시적 라이선스 없음
- RisuAI 코드는 GPL 출처·commit·수정 내역을 기록한 뒤 선별 이식할 수 있다.
- Risumari는 라이선스가 명시되거나 저작자 허가를 받기 전까지 **아이디어와 관찰만 참고하며 코드를 복사하지 않는다.**

## P0 — 사실 기준과 가져오기 진단

- [x] `얼헌`의 정식 명칭을 `Alternate Hunters V2`로 확정
- [x] 기존 hunter combat fixture를 얼헌 구현이 아닌 generic 커널 샘플로 분리
- [x] 카드 MRI 진단 결과 계약 도입
- [x] 내장 `module.risum`, 카드 Lua, 정규식, HTML, 초기 변수 탐지
- [x] 컴파일 입력 포함·누락 항목과 글자 수 공개
- [x] 카드 유형을 대화형·선언형 시뮬·스크립트 보조형·에셋 팩으로 분류
- [ ] 규칙 충돌을 원문 위치와 함께 보고
- [x] 외부 source ref·additional asset·내장 모듈 의존성 1차 탐지
- [ ] 외부 에셋 팩을 해시·namespace로 실제 연결

완료 기준: Alternate Hunters V2를 넣었을 때 내장 모듈, Lua, 로어 누락, 기능 토글, 에셋 명명법을 컴파일 전에 확인할 수 있다.

## P0.5 — RisuAI 상호운용 기반

목표는 RisuAI 내부 데이터베이스를 복제하는 것이 아니라, Risu 파일과 실행 의미를 안정된 호환 계층으로 감싸는 것이다. Risu가 내부 구조를 바꾸더라도 SimPack과 저장 세션은 깨지지 않아야 한다.

### A. 손실 없는 호환 봉투

- [x] `RisuCompatibilityEnvelope` 도입: `sourceFormat`, `sourceVersion`, `raw`, `normalized`, `unsupported`, `provenance`
- [ ] CCv2/CCv3 JSON, PNG 카드, CharX/CharX-JPEG 가져오기·내보내기 왕복
- [ ] CharX의 `card.json`, `module.risum`, `assets/`, `x_meta/` 및 알 수 없는 파일 보존
- [ ] `.risum` 모듈과 `.risup`/`.risupreset` 프리셋 가져오기·내보내기
- [ ] 알 수 없는 Risu 확장 필드를 삭제하지 않고 raw extension bag에 보존
- [ ] 원본 → import → export 결과의 구조·에셋 해시를 검증하는 golden round-trip corpus
- [x] 호환성 보고서에 `완전 지원`, `보존만`, `안전 변환`, `저하`, `실행 금지`를 필드별 표시

### B. 페르소나를 1급 데이터로

- [x] `Persona` 계약: id, 이름, 설명 프롬프트, 아이콘, 메모, 내장 모듈, 출처
- [ ] 여러 페르소나 보관·선택·복제·Risu PNG 페르소나 import/export
- [ ] 채팅별 `boundPersonaId`와 시작 시점 persona snapshot 저장
- [ ] 플레이 도중 페르소나를 수정해도 과거 세션의 사실이 소급 변경되지 않도록 버전·snapshot 분리
- [ ] `{{user}}`, 사용자 이름, 페르소나 설명, 아이콘을 프롬프트·화면·내보내기에 동일하게 연결
- [ ] 페르소나 내장 모듈을 일반 모듈과 같은 권한·출처 검사에 통과시킴

### C. Risu 호환 프롬프트 컴파일러

- [ ] Risu `PromptItem` 호환 블록: plain/main, jailbreak, description, persona, lorebook, chat range, author note, memory, cache, post-everything, assistant prefill
- [ ] 블록 순서, role, `innerFormat`, `{{slot}}`, 조건, 변수 치환을 보존하는 prompt preset 모델
- [ ] 카드 system prompt의 `{{original}}`, post-history instructions, depth prompt와 로어 위치 주입 지원
- [ ] Risu 모드에서는 Risu와 같은 입력으로 같은 메시지 배열을 만드는 golden prompt parity test
- [ ] `프롬프트 검사기`: 실제 API에 보낼 메시지, 각 블록의 출처·토큰·활성 이유를 사람이 확인
- [ ] `프롬프트 비교기`: Risu 호환 결과와 SimPack 강화 결과를 나란히 diff
- [ ] 엔진 사실, 실제 선택지, 관련 NPC, 장기 기억은 별도 고정 슬롯에만 추가하고 Risu 원문 블록을 몰래 수정하지 않음
- [ ] 프롬프트 preset을 세션에 version/hash로 고정하여 편집 후 기존 세션 재현성을 보존

### D. 로어·CBS·정규식·모듈 호환

- [ ] Risu 로어북의 key/secondary key, constant/selective, 확률, 순서, 폴더, scan depth, recursion, position/depth를 보존
- [ ] 카드·전역·채팅·모듈 로어를 명시적인 우선순위로 합성
- [ ] 안전한 CBS 부분집합을 버전 계약과 테스트로 구현; 미지원 매크로는 조용히 무시하지 않고 표시
- [ ] 정규식 단계를 `editinput`, `editrequest`, `editoutput`, `editdisplay`로 분리하고 실행 순서 표시
- [ ] RisuModule의 lorebook, regex, trigger, assets, namespace, toggle, background embedding을 normalized model로 매핑
- [ ] 모듈 결합 위치를 전역·프리셋·캐릭터·채팅·페르소나로 구분하고 중복 제거 규칙 정의
- [ ] Lua, CJS, low-level trigger, MCP는 기본 실행 금지; 정적 분석·권한 화면·격리 런타임 없이는 보존만

### E. 호환 등급 합격선

1. **왕복 호환**: 모르는 필드와 에셋을 잃지 않는다.
2. **프롬프트 호환**: 같은 카드·페르소나·프리셋·대화로 의미상 같은 요청을 만든다.
3. **표현 호환**: 감정, 배경, 그룹 화자, 안전한 정규식/CBS 결과가 맞는다.
4. **결정론 강화**: 위 호환을 유지하면서 수치·선택지·진행 사실은 엔진이 소유한다.

완료 기준: 대표 CharX + Risum + Risup + Persona 묶음을 RisuAI와 우리 앱에 각각 넣었을 때, 프롬프트 검사기의 블록·순서·역할이 일치하고 왕복 후 미지원 데이터도 사라지지 않는다.

### 현재 구현 상태 — C1 완료 (2026-07-12)

- [x] 새 호환 경계부터 TypeScript strict 계약을 사용하고 기존 JavaScript와 공존
- [x] `RisuCompatibilityEnvelope`, `Persona`, `PromptPreset`, `ModuleBinding`, provenance 타입 확정
- [x] 런타임 구조 검사와 JSON Schema 3종 추가
- [x] 기존 CharX·PNG·JSON·Risum 파서를 호환 봉투에 연결
- [x] 원본 바이트 참조와 CharX/PNG/Risum 컨테이너 항목 색인
- [x] 카드 MRI에 지원·안전 변환·원본 보존·저하·실행 차단 표시
- [x] 구형 PNG의 표준 assets 밖 에셋 청크와 CharX 내장 모듈을 “보존됨·상세 연결 대기”로 공개
- [x] Alternate Hunters V2, 용사여관, 소녀전선: 잔불, Belladonna Academy, 루미나 마을 실물 파싱 검증

C1은 **가져오기 봉투와 계약의 완성**이며 왕복 내보내기 완성은 아니다. `sourceBytes`는 현재 런타임 `Uint8Array` 참조이므로 SimPack 직렬화 시 별도 바이너리 패키징이 필요하다. 페르소나와 프롬프트도 계약만 있고 편집·실행은 아직 없다.

### 다음 작업 — C2 Risu Prompt Parity

1. Risu 호환 프롬프트를 순수 함수로 조립하고 각 결과 메시지에 블록·원문 경로·토큰 근거를 남긴다.
2. Risu 원본 블록과 SimPack의 `engineFacts`, `availableActions`, `groundedMemory` 블록을 분리한다.
3. 순서·role·chat range·`innerFormat`·`{{slot}}`·`{{original}}`·assistant prefill을 golden test로 고정한다.
4. 전체 CBS·Lua 실행은 포함하지 않는다. 필요한 변수 치환은 안전한 최소 부분집합만 명시적으로 구현한다.
5. 같은 입력의 Risu 호환 요청과 SimPack 강화 요청을 비교할 수 있는 prompt trace를 먼저 만들고, UI 검사기는 그 trace 위에 얹는다.

## P1 — SimPack v0.2

- [ ] 원본 카드와 출처
- [ ] Risu 호환 봉투와 raw payload
- [ ] 페르소나 라이브러리와 세션 바인딩
- [ ] 프롬프트 preset·블록 순서·버전 hash
- [ ] 카드·프리셋·캐릭터·채팅·페르소나별 모듈 바인딩
- [ ] 콘텐츠(캐릭터·로어·장소·아이템)
- [ ] 설치 모듈과 버전
- [ ] 초기 상태와 규칙
- [ ] 화면 목록과 내비게이션
- [ ] 에셋 팩과 canonical 매핑
- [ ] 프로젝트 옵션과 기능 토글
- [ ] provenance·confidence·evidence
- [ ] 미해결 충돌과 미지원 기능
- [ ] 저장 데이터 migration 계약

완료 기준: 편집기와 플레이어가 동일한 SimPack 문서를 읽고, 앱 소스 수정 없이 프로젝트를 교체한다.

## P1.5 — 수백 턴 장기 세션 기반

목표는 수백만 토큰을 매번 LLM에 다시 보내는 것이 아니다. 전체 원문과 모든 엔진 사건은 로컬에 영구 보존하되, 매 턴에는 현재 판단에 필요한 근거만 검증 가능하게 조립한다.

### 저장·재현

- [x] `SessionStore` 계약: session, message, engine event, snapshot, prompt run (`app/core/session/contracts.ts` + 인메모리 기준 구현 — memory record·asset reference는 기억 계층에서 확장)
- [x] append-only 엔진 이벤트 로그 + 주기적 snapshot (`engine/core/sessionJournal.js` — schema migration 계약은 미포함, SimPack 버전 계약과 함께)
- [x] 모든 LLM 요청에 prompt hash, 모델, 응답, 제안 사건, 적용 수 기록 — 플레이 경로 6개 호출부 전부 연결 (사용 블록 상세는 C2 trace를 플레이 경로에 연결할 때)
- [x] 사건 index 단위 체크포인트(`stateAt`)와 time machine 복원(`truncateTo`) — 커널 완성, 턴·날짜 단위 UI는 남음
- [x] 브라우저 SQLite WASM + OPFS Worker 저장 어댑터 (`@sqlite.org/sqlite-wasm` 직접 Worker + IndexedDB 안전 폴백)
- [ ] Tauri 데스크톱 네이티브 SQLite 저장 어댑터
- [x] 내보내기 가능한 단일 세션 백업과 손상 복구 검사 (원장 `toJSON`/`restoreSessionJournal` — head 해시·판정·스키마 지문 대조. **플레이 UI 연결됨**: 설정 패널 세션 내보내기/가져오기 — 대화+엔진 사건+PromptRun을 한 파일로, 이어하기 지원)

### 기억 계층

- [x] 엔진 현재 사실: 돈·HP·관계·퀘스트·위치 등 절대 요약하지 않는 authoritative state
- [x] 사건 원장: 누가 언제 무엇을 했고 어떤 state diff가 났는지 구조화 저장
- [x] 서사 기억: 약속·비밀·관계 변화·미해결 갈등을 근거 message/event id와 함께 저장
- [x] 원본 지식: 카드·로어·프롬프트·모듈을 세션 기억과 분리
- [x] 최근 대화 + 관련 사건 + 관련 로어를 합치는 deterministic context planner
- [ ] 요약을 다시 요약하며 왜곡하지 않도록 원문 근거 링크와 재생성 지원
- [ ] 1차 검색은 SQLite FTS5/trigram; 임베딩 검색은 필요성이 입증된 뒤 선택 도입

### 환각 방지 계약

- [x] LLM 출력 계약: `narrative`, `speakers`, `proposedEvents`, `memoryCandidates`, `factRefs`, `continuityPatch`
- [ ] 서사에 나온 돈·아이템·선택지·NPC·퀘스트를 engine facts와 대조
- [x] 존재하지 않는 사건은 적용하지 않고 실패 이유를 대화 칩과 로그에 표시
- [x] 실제 선택지는 selector가 만들며 LLM은 결정 카드 밖의 가짜 선택지를 나열하지 않음
- [x] memory candidate는 자동 사실 승격 금지; 엔진 사건 또는 사용자 승인과 근거 필요
- [ ] 세션 건강 패널: 현재 턴, 저장 크기, prompt 토큰 구성, 기억 적중, 미해결 충돌, 마지막 snapshot

### 장기 부하 합격 시험

- [x] 300턴 결정론 자동 플레이 fixture (`engine/test/sessionJournal.test.js` — 성공·RNG 소모·의도적 실패 혼합)
- [x] 저장→종료→재개 후 state hash·RNG·선택지 일치 (state·RNG 동일 검증 — 선택지는 상태의 순수 함수라 동치)
- [ ] 50/100/250/300턴에서 prompt 크기가 전체 대화 길이에 선형 증가하지 않음
- [x] 초반 약속을 300턴 뒤 원문 message id와 함께 회수하는 결정론 fixture
- [ ] 300턴 동안 잔고·인벤토리·위치·사망 상태의 서사/엔진 불일치 0건
- [ ] Playwright 장기 세션·재개·오프라인 저장 E2E

### 현재 구현 감사 — S1/S2 완료, 기억 검색은 미착수 (2026-07-12)

- [x] 300개 **엔진 사건**의 원장·스냅샷·재생·분기·손상 감지
- [x] 플레이 화면의 수동 세션 JSON 내보내기/가져오기와 이어하기
- [x] LLM 호출 경로 6곳의 prompt hash·모델·응답·제안 사건·적용 수 기록
- [ ] 300턴 **LLM 대화**에서 프롬프트 크기와 기억 회수 품질 검증
- [ ] 브라우저 종료 후 자동 복구되는 영구 저장소(OPFS/SQLite) — 구현·헤더·RPC 검증 완료, 실제 브라우저 새로고침 E2E 대기
- [ ] `SessionStore` 기준 구현을 실제 플레이 저장 경로에 통합
- [ ] PromptRun 전체 계약 보존: 현재 플레이 export는 사건 params·거부 이유·C2 trace를 축약하고 최근 500건만 유지
- [ ] 원장의 사건별 before/after state diff와 메시지·사건 상호 참조
- [x] 서사 기억 추출·승인·검색·근거 회수

“장기 세션”과 “장기 기억”을 구분한다. 현재 완성된 것은 전자의 결정론적 원장 단면이다. 후자는 아래 벤치마크를 통과한 검색 계층을 추가해야 한다.

### M1 — HypaMemory V3 / Voyage 기억 벤치마크

- [x] 300턴 대화형 고정 corpus와 질문 정답지 작성: 현재 사실, 최신값 우선, 약속·비밀, 의미 바꿔 말하기, NPC 구분, 무관 기억 배제
- [x] 비교 기준 A: 최근 대화 창만 사용
- [x] 비교 기준 B: 구조화 사실 + 키워드/FTS 검색
- [x] 비교 기준 C: Risu HypaMemory V3 방식(중요·최근·유사 기억, frozen summary·seed 격리)
- [x] 비교 기준 D: 우리 hybrid(엔진 사실 + 사건 원장 + 어휘 + 선택형 semantic retrieval)
- [x] 외부 API 없는 고정 임베딩 provider와 Phase A/B 결정론 보고서(JSON + Markdown)
- [x] **C0 벤치마크 보정**: 관련 없음(abstention), 최근 3개 메시지 질의, current fact exact match, NPC 혼동, 비밀 지식 범위, 롤백 기억, 근거 보유율/정답 근거 적중률 분리
- [x] **C1 선 구현**: `VoyageEmbeddingProvider`를 TypeScript strict로 작성하고 mock fetch로 배치·캐시·429 backoff·취소·키 마스킹·장애 폴백 검증
- [x] **C2 비교 기준 E — Grounded Hybrid V2**: authoritative facts + typed memory + lexical prefilter + 선택형 semantic + evidence/knowledge/rollback gate + abstention
- [ ] `voyage-context-3`를 Risu 재현 기준, `voyage-context-4`를 최신 대안으로 측정하는 BYOK `--live-voyage` 명령 제공
- [ ] 실제 채팅·API 환경이 준비되면 Recall@K·MRR/nDCG·오탐·NPC/비밀 누출·p50/p95·API 토큰/비용 실측. **실측 부재는 C0~C2 구현의 blocker가 아님.**
- [ ] semantic memory는 실측 전 기본 비활성. 실험 플래그에서는 사용할 수 있으나 실패·키 없음·낮은 신뢰도일 때 구조화+어휘로 fail-open
- [ ] 커뮤니티 플러그인/RisuAI 코드 선별 이식 시 원본 파일·버전·SHA-256·함수·우리 변경 내용을 provenance 문서에 기록

Phase C 구현 원칙:

1. 새 런타임·도메인 구현은 `.ts`로 작성하고 실제 테스트가 그 TS 구현을 실행해야 한다. 타입 선언만 `.ts`, 실행 로직은 새 `.js`로 추가하는 방식은 금지한다.
2. Voyage의 커뮤니티 실사용은 선 구현의 근거로 인정하되, 우리 앱의 기본 활성화와 임계값 확정은 추후 실측으로 결정한다.
3. 임베딩 결과는 엔진 현재 사실을 덮어쓰지 못하고, 모든 주입 기억은 message id 또는 engine event index 근거를 가진다.
4. API 키가 없어도 전체 CI·빌드·고정 provider 벤치마크가 통과해야 한다.

통과 권고선:

1. authoritative 현재 사실 질문 100% 정답, 폐기된 과거값을 현재값으로 답한 사례 0건
2. hybrid의 의미 검색 Recall@5가 HypaMemory V3 기준보다 2%p 이상 낮지 않을 것
3. 모든 검색 결과가 원본 message id 또는 engine event index를 가질 것
4. 같은 corpus·설정·고정 provider로 결과와 순위가 재현될 것
5. Voyage 실측 전에는 기본 기능으로 켜지 않으며, 추후 이득이 FTS 대비 작으면 opt-in으로 유지할 것

### M1.1 — 연속성 기억 안전 계약 (2026-07-12 1차 완료)

- [x] 기억에 장면·시간 출처, 지식 보유자/차단 대상, 사실·소문·추론, 생명주기 꼬리표 추가
- [x] 현재 장면 격리, 비밀 deny 우선, 불확실 기억의 authoritative 승격 금지
- [x] 현재 질문에서는 폐기 기억 차단, 과거 질문에서는 명시적 요청에 한해 당시 기억 회수
- [x] 순위가 아닌 실제 어휘 근거 강도를 쓰는 결정론 검색기와 abstention 연결
- [x] 연속성 기억 핵심 회귀 테스트 7개 및 비교 기준 E를 고정 벤치마크에 추가
- [x] TypeScript 테스트를 기본 `npm test`와 배포 CI에 포함
- [x] LLM 구조화 출력의 `memoryCandidates`/`continuityPatch`를 새 계약과 검토 UI에 실제 연결
- [x] 라이브 lexical gate에서 같은 NPC의 없었던 사건 hard-negative 회상 차단. 고정 semantic 비교 기준 E의 임계 보정은 계속 필요
- [x] 현재 장면 cohort와 플레이어 지식 범위를 실제 플레이 세션에서 공급
- [ ] Voyage 실측 후 semantic 단독 후보 하한을 보정; 그 전까지 라이브 기본값은 구조화+어휘(B)

1차 벤치마크 결과: E의 현재 사실 정확도 100%, 폐기값 현재 오노출 0건. 다만 고정 semantic 비교의
Recall@5는 28%로 B(53%)보다 낮고 hard-negative를 거르지 못했다. 따라서 semantic은 기본 비활성으로
두고, 아래 M1.2의 더 엄격한 lexical gate만 실제 플레이에 연결했다.

### M1.2 — 실제 플레이 기억 파이프라인 (2026-07-12 완료)

- 자유 대화·자동 장면·전투 시작 전에 승인된 관련 기억을 검색해 별도 프롬프트 블록으로 주입
- 사용자 메시지와 성공한 엔진 사건만 자동 승인 근거로 인정; LLM 단독 기억은 검토 대기
- 기억 후보와 확정·해결 제안을 플레이 사이드 패널에서 승인·거절
- `factRefs`를 현재 상태·사용자 메시지·성공 사건과 대조해 근거 없는 참조를 칩과 PromptRun에 기록
- 실패한 사건을 성공처럼 쓴 서사는 안전 문구로 교체하고, 근거에 없는 숫자가 든 문장은 표시 전에 제거
- 메시지 id·기억 원장·판정 trace·상태 변경 제안을 세션 백업에 함께 저장하고 복원
- 원문 메시지와 사건이 되돌리기로 모두 사라지면 파생 기억을 자동 폐기
- 300턴 뒤 3턴의 약속을 message id와 함께 회수하며 주입은 top 8·4,000자 미만으로 제한하는 fixture 통과

남은 한계: 현재 장면은 `core.location`이 없는 프로젝트에서는 프로젝트 기본 장면으로 묶인다. NPC 전용
기억은 안전을 위해 플레이어 대화 프롬프트에 주입하지 않으며, NPC 관점별 프롬프트는 공통 화자/장소
모듈 이후 확장한다. semantic 검색은 실측 전 기본 비활성이다.

### S3 — 브라우저 자동 저장·복구 (구현 완료, 브라우저 E2E 대기)

- 공식 SQLite Wasm을 자체 module Worker에서 직접 실행하고 OPFS DB `/simbot-sessions.sqlite3` 사용
- 세션 payload를 SQLite transaction으로 원자 저장하고 payload hash를 복구 때 재검증
- OPFS/교차 출처 격리를 쓸 수 없는 환경은 IndexedDB로 자동 폴백; 둘 다 불가능할 때만 비영구 memory 모드
- 스키마 해시별 최신 세션을 플레이 진입 때 자동 복구하고, 상태 변화 후 750ms debounce 자동 저장
- 탭 숨김·페이지 종료 때 마지막 저장 요청, 동시 저장은 직렬화하고 중복 payload는 hash로 건너뜀
- Firebase와 로컬 preview에 COOP/COEP 및 WASM MIME 헤더 적용
- Worker RPC·memory 기준 구현·빌드 산출물·HTTP 헤더 자동 검증 완료
- [ ] 실제 Chromium에서 backend가 `sqlite-opfs`인지 확인하고 새로고침·브라우저 종료 후 자동 복구 E2E
- [ ] 저장 중 강제 종료/손상 row/용량 부족 시 IndexedDB 전환 및 마지막 정상 snapshot 복구 E2E

## P2 — 다중 화면 선언 런타임

- [ ] `screens[]`와 화면 내비게이션
- [ ] 탭·모달·오버레이·선택 상태
- [ ] selector 기반 데이터 연결
- [ ] event 기반 버튼 연결
- [ ] 허용 목록 조건식
- [ ] 데스크톱·모바일 배치
- [ ] 기본 위젯: 카드 목록, 상세 패널, 표, 슬롯, 게이지, 퀘스트, 인벤토리, 지도 노드, 달력, 제작 대기열, 전투 HUD

금지: `playView.js`에 Alternate Hunters, 소녀전선, Belladonna 전용 분기를 추가하지 않는다.

## P3 — 공통 런타임 모듈

우선순위 1:

- [ ] `core.progression`: 레벨·EXP·스탯 포인트
- [ ] `core.equipment`: 무기·방어구·장신구 슬롯
- [ ] `rpg.quests`: 목표·진행도·보상·실패
- [ ] `rpg.party`: 동료·역할·편성
- [ ] `core.time`: 날짜·시간 경과
- [ ] `core.location`: 장소·이동

우선순위 2:

- [ ] `rpg.loot`
- [ ] `rpg.shop`
- [ ] `rpg.crafting`
- [ ] `core.factions`
- [ ] `core.jobs`: 제조·수복·건설처럼 시간이 걸리는 작업

## P4 — 범용 에셋 매퍼

- [ ] 로어북 canonical NPC 목록 우선 추출
- [ ] 가장 긴 NPC 이름을 에셋 접두사로 매칭
- [ ] `.`, `_`, `&`, 공백 명명법 지원
- [ ] 감정·의상·자세·배경·시간대·음악 분류
- [ ] 대소문자·별칭·오타 정규화
- [ ] 에셋 정리 마법사와 일괄 승인
- [ ] 대형 에셋 팩 지연 로딩·해시·중복 제거

## P5 — Alternate Hunters V2 수직 단면

대표 루프:

```text
신규 헌터 등록
→ 프로필과 초기 상태 확정
→ 협회 등급 평가
→ 단말기에서 게이트 선택
→ 파티 구성
→ 던전 조우·전투
→ 전리품과 마정석 획득
→ 협회 정산
→ EXP·재화·장비·퀘스트 갱신
```

필요 모듈:

- 공통: stats, progression, inventory, equipment, party, quests, combat, time, location, loot
- 장르: `hunter.gates`, `hunter.ranks`, `hunter.assessment`, `hunter.guilds`
- 선택: `hunter.alter-store`, `hunter.factions`

완료 기준:

- [ ] 상태창 예시값을 실제 초기 상태로 오인하지 않음
- [ ] 헌터 등급과 레벨을 별도로 관리
- [ ] 상태창은 보조 LLM이 아니라 엔진 selector로 생성
- [ ] 실제 선택지만 결정 카드에 표시
- [ ] NPC 감정 스프라이트를 canonical ID로 표시
- [ ] 관련 NPC 로어만 동적으로 주입
- [ ] 기능 토글 지원
- [ ] 앱 소스에 얼헌 전용 분기 없음

## P6 — 교차 장르 검증

- [ ] 루미나 마을: 엔진이 거의 없는 카드의 대화·로어 중심 저하 없는 실행
- [ ] 소녀전선 축소 루프: 인형 보유 → 제대 편성 → 임무 → 보상 → 수복
- [ ] Belladonna 축소 루프: 주간 계획 → 학사 사건 → 스탯·호감 변화 → 다음 주
- [ ] 용사여관: 기존 경영·숙박 회귀 유지

## P7 — 편집기 MVP

1. 카드·CharX·Risum·Risup·Persona 진단
2. 손실 없는 원본/정규화 데이터 전환 보기
3. 충돌 해결과 미지원 기능 결정
4. Risu 호환 프롬프트 순서·role·조건 편집 및 실제 요청 미리보기
5. 로어북 폴더·일괄 편집·활성화 시뮬레이션
6. 모듈 선택·결합 범위·권한 편집
7. 초기값·규칙 편집
8. 에셋 분류·미리보기·canonical NPC 연결
9. 화면 프리셋 선택
10. 라이브 플레이테스트와 prompt/state diff
11. SimPack 및 Risu 형식 저장·불러오기

Risumari에서 아이디어로 채택할 UX:

- 바이너리 카드/모듈/프리셋을 폴더 프로젝트로 풀고 다시 조립하는 작업 방식
- 긴 프롬프트·설명·시나리오를 개별 Markdown 파일로 분리하고 manifest로 원래 필드에 연결
- 폼 편집과 원본 JSON/파일 트리를 함께 제공
- 로어북 폴더 트리, 다중 선택, 일괄 키 편집, 드래그 정렬
- 에셋 폴더·미리보기·대량 추가와 외부 편집 변경 감지
- 프롬프트 블록을 순서대로 편집하고 실제 표시 결과를 옆에서 미리보기

그대로 채택하지 않을 것:

- Electron, 단일 거대 renderer 파일, 앱 내부의 별도 카드 모델
- 안전 경계 없는 Lua 미리보기
- Risu 내부 필드 일부만 골라 변환하는 live sync를 완전 호환으로 간주하는 것
- 라이선스가 없는 Risumari 코드의 직접 복사

## MVP 이전 금지

- RisuAI 전체 Lua 실행 및 CBS 무검증 완전 실행
- 소녀전선 전체 일괄 재현
- 무제한 HTML·DOM 접근
- 범용 타일맵 제작기
- 공개 마켓플레이스·결제
- 장르별 플레이 뷰 복제
- 누락·추정을 숨긴 자동 승인
