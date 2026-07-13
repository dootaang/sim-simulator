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
- Risumari: `rpaddict/risumari` main, commit `84a2ce39ad8434494738abf311aa0a0d893aa682` (2026-05-26). 제작자에게 커뮤니티 댓글로 사용 허가를 받았다. 정식 공개 글에 원 공유 글 링크와 크레딧을 남기는 조건이며 코드 내부 주석 표기는 요구되지 않는다.
- RisuAI 코드는 GPL 출처·commit·수정 내역을 기록한 뒤 선별 이식할 수 있다.
- Risumari는 허가 범위 안에서 아이디어와 필요한 코드를 선별 적용할 수 있다. 출시는 공개 글 크레딧 의무를 확인하며, 코드 안에 불필요한 제작자명 주석을 추가하지 않는다.

## P0 — 사실 기준과 가져오기 진단

- [x] `얼헌`의 정식 명칭을 `Alternate Hunters V2`로 확정
- [x] 기존 hunter combat fixture를 얼헌 구현이 아닌 generic 커널 샘플로 분리
- [x] 카드 MRI 진단 결과 계약 도입
- [x] 내장 `module.risum`, 카드 Lua, 정규식, HTML, 초기 변수 탐지
- [x] 컴파일 입력 포함·누락 항목과 글자 수 공개
- [x] 카드 유형을 대화형·선언형 시뮬·스크립트 보조형·에셋 팩으로 분류
- [ ] 규칙 충돌을 원문 위치와 함께 보고
- [x] 외부 source ref·additional asset·내장 모듈 의존성 1차 탐지
- [x] 외부 에셋 팩을 ZIP 목차 지문·namespace로 카드에 실제 연결하고 화면 단위 지연 읽기
- [ ] 외부 에셋 팩 원본 전체 바이트 해시를 스트리밍 계산해 무결성 검증에 사용 (현재는 중앙 목차 SHA-256)

완료 기준: Alternate Hunters V2를 넣었을 때 내장 모듈, Lua, 로어 누락, 기능 토글, 에셋 명명법을 컴파일 전에 확인할 수 있다.

### P0.1 — LLM 엔진 컴파일 복원 (2026-07-13 완료)

- [x] 카드 규칙을 정확한 배열형 런타임 계약으로 요청하고 JSON 실패를 최대 3회 자동 교정
- [x] 객체 맵, 시설 ID, 자원 한국어명, 메뉴 원가, 초기 상태를 승인 전에 정규화
- [x] 여관의 영업·숙박·사건·직원 정원·주점 2레벨 의뢰 게시판을 공식 장르 템플릿으로 합성
- [x] 스키마 모양뿐 아니라 여관 시설·객실·메뉴·영업 규칙의 실재 여부를 의미 검증
- [x] 컴파일 요약, 가정, 카드 실값 교정, 미연결 채굴값, 제외 로어, 모델 원문, JSON 수정·재검증 화면
- [x] 승인한 스키마 지문과 저장 회차를 묶어 다른 컴파일 결과의 상태가 섞이지 않도록 차단
- [x] 선언형 화면을 실제 플레이에 설치하고 여관 경영 화면에서 영업·숙박·구매·증축·고용·의뢰 실행
- [x] 로컬 실물 용사여관 카나리아 명령 추가: `pnpm --filter @simbot/web canary:compiler -- <card.charx>`

다음 합격선: 같은 파이프라인에 DOMINIUM을 넣고 장르 전용 Svelte 코드를 추가하지 않은 채 두 번째 시뮬 화면을 조립한다.

## P0.5 — RisuAI 상호운용 기반

목표는 RisuAI 내부 데이터베이스를 복제하는 것이 아니라, Risu 파일과 실행 의미를 안정된 호환 계층으로 감싸는 것이다. Risu가 내부 구조를 바꾸더라도 SimPack과 저장 세션은 깨지지 않아야 한다.

### A. 손실 없는 호환 봉투

- [x] `RisuCompatibilityEnvelope` 도입: `sourceFormat`, `sourceVersion`, `raw`, `normalized`, `unsupported`, `provenance`
- [x] CCv2/CCv3 JSON, PNG 카드, CharX/CharX-JPEG 가져오기와 무편집 원본 바이트 내보내기 왕복
- [x] CharX의 `card.json`, `module.risum`, `assets/`, `x_meta/` 및 알 수 없는 파일 보존
- [x] `.risum` 모듈 읽기와 `.risup`/`.risupreset` 프리셋 가져오기·내보내기 (모듈 편집 내보내기는 후속)
- [x] 알 수 없는 Risu 확장 필드를 삭제하지 않고 raw extension bag에 보존
- [x] 원본 → import → export 결과의 SHA-256 동일성을 검증하는 golden round-trip 계약
- [x] 호환성 보고서에 `완전 지원`, `보존만`, `안전 변환`, `저하`, `실행 금지`를 필드별 표시

### B. 페르소나를 1급 데이터로

- [x] `Persona` 계약: id, 이름, 설명 프롬프트, 아이콘, 메모, 내장 모듈, 출처
- [x] 여러 페르소나 보관·선택·복제·Risu PNG 페르소나 import/export
- [x] 채팅별 persona 선택과 시작 시점 persona snapshot 저장 — `SessionSnapshot.bindings`가 페르소나 원문과 프리셋을 세션에 고정
- [x] 플레이 도중 페르소나를 수정해도 과거 세션의 사실이 소급 변경되지 않도록 버전·snapshot 분리
- [x] `{{user}}`, 사용자 이름, 페르소나 설명, 아이콘을 프롬프트·세션·내보내기에 동일하게 연결
- [x] 페르소나 내장 모듈을 일반 모듈과 같은 권한·출처 검사에 통과시키는 공통 resolver 계약 (실행 코드는 차단)

### C. Risu 호환 프롬프트 컴파일러

- [x] Risu `PromptItem` 호환 블록: plain/main, jailbreak, description, persona, lorebook, chat range, author note, memory, cache(보존·trace), post-everything, assistant prefill
- [x] 블록 순서, role, `innerFormat`, `{{slot}}`, 조건, 변수 치환을 보존하는 prompt preset 모델
- [x] 카드 system prompt의 `{{original}}`, post-history instructions, depth prompt와 로어 위치 주입 지원
- [x] Risu 모드에서는 같은 입력으로 같은 메시지 배열을 만드는 golden prompt parity test
- [x] `프롬프트 검사기`: 실제 API에 보낼 블록의 출처·토큰·활성 이유를 플레이 토큰 미터에서 확인
- [x] `프롬프트 비교기`: Risu 원문 trace와 SimPack 추가 블록을 나란히 검증
- [x] 엔진 사실, 실제 선택지, 관련 NPC, 장기 기억은 별도 고정 슬롯에만 추가하고 Risu 원문 블록을 몰래 수정하지 않음
- [x] 프롬프트 preset을 세션에 version/hash로 고정하여 편집 후 기존 세션 재현성을 보존

### D. 로어·CBS·정규식·모듈 호환

- [ ] Risu 로어북의 key/secondary key, constant/selective, 확률, 순서, 폴더, scan depth, recursion, position/depth를 보존 — key/secondary/constant/selective/order/depth의 기본 경로만 대체됐고 확률·대소문자·폴더·재귀 활성화는 유실
- [ ] 카드·전역·채팅·모듈·페르소나 로어를 명시적인 우선순위로 합성 — 현행 플레이는 카드 로어 중심이며 옛 source 합성·우선순위 회귀 테스트가 유실
- [x] 안전한 읽기 전용 CBS 부분집합을 버전 계약과 테스트로 구현; 미지원 매크로는 원문과 경고로 표시
- [x] 정규식 단계를 `editinput`, `editrequest`, `editoutput`, `editdisplay`로 분리하고 안전 검사 후 실행
- [ ] RisuModule의 lorebook, regex, trigger, assets, namespace, toggle, background embedding을 normalized model로 매핑 — lore/regex/assets/variables는 남았으나 trigger·toggle·background 계약은 동등성 미증명
- [ ] 모듈 결합 위치를 전역·프리셋·캐릭터·채팅·페르소나로 구분하고 namespace 중복 제거 규칙 정의 — 카드별 에셋 모듈 바인딩은 복구됐으나 옛 embedded 계층까지 포함한 resolver 패리티는 미증명
- [x] Lua, CJS, low-level trigger, MCP는 기본 실행 금지; 정적 분석·권한 화면·격리 런타임 없이는 보존만

### E. 호환 등급 합격선

1. **왕복 호환**: 모르는 필드와 에셋을 잃지 않는다.
2. **프롬프트 호환**: 같은 카드·페르소나·프리셋·대화로 의미상 같은 요청을 만든다.
3. **표현 호환**: 감정, 배경, 그룹 화자, 안전한 정규식/CBS 결과가 맞는다.
4. **결정론 강화**: 위 호환을 유지하면서 수치·선택지·진행 사실은 엔진이 소유한다.

완료 기준: 대표 CharX + Risum + Risup + Persona 묶음을 RisuAI와 우리 앱에 각각 넣었을 때, 프롬프트 검사기의 블록·순서·역할이 일치하고 왕복 후 미지원 데이터도 사라지지 않는다.

### 현재 구현 상태 — C1 완료 (2026-07-12)

- [x] 새 호환 경계부터 TypeScript strict 계약을 사용하고 기존 JavaScript와 공존
- [x] `RisuCompatibilityEnvelope`, `Persona`, `PromptPreset`, provenance 타입 확정
- [ ] 범용 `ModuleBinding` 계약 확정 (현재 구현은 에셋 전용 `boundModuleIds`만 제공)
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

## P0.9 — Risu형 플레이 표면·통합 편집기 (2026-07-13 완료)

제품 표면은 “별도 제작기 + 별도 플레이어”가 아니라 **Risu와 익숙한 플레이 화면 안에서 카드·스크립트·시뮬레이션을 편집하는 럭키 시뮬레이터**로 고정한다. Risu 기능을 그대로 약속하는 클론이 아니라, 카드 이사 비용을 낮추고 엔진이 사실을 소유하는 강화 플레이어다.

### 이번 세션에서 완료

- [x] `CardDocument` 도입: 카드의 알려진 필드를 폼으로 편집하면서 알 수 없는 확장 필드를 보존
- [x] 제목·설명·성격·시나리오·첫 메시지·대체 인사·로어북·에셋·정규식·배경·고급 JSON 편집
- [x] 플레이 화면의 `봇 편집` 안에 기존 시뮬레이션 제작 도구 통합, 별도 제작기 라우트 제거
- [x] JSON·PNG·CharX 카드 재포장 및 추가 에셋 바이트 보존, 동명 에셋 경로 충돌 방지
- [x] 카드 전환 시 불필요한 썸네일 재생성 제거, 파싱 결과 LRU와 에셋 URL 지연 생성
- [x] 입력창 왼쪽의 중복 `계속 생성` 버튼 제거, 마지막 AI 메시지 작업줄로 이동
- [x] Risu형 번역 sidecar, 이전/다음 대안, 끝에서 리롤, 토큰·모델·처리시간·프롬프트 메타데이터
- [x] 제공자가 실제 usage를 주지 않으면 `≈` 추정 토큰으로 명시
- [x] 본문 이미지 최대 너비 설정
- [x] `editrequest`를 실제 프롬프트 요청 처리 단계에 연결
- [x] `backgroundHTML`을 iframe이 아닌 현재 카드 채팅 표면에 범위 제한해 적용
- [x] 배경 CBS의 `screen_width`와 배경·미디어 에셋 매크로를 먼저 처리하여 원문 노출 방지
- [x] 용사여관·Alternate Hunters V2 실물 배경에서 잔여 CBS 0건 확인
- [x] 카드명 옆 작은 연필을 텍스트가 있는 `봇 편집` 버튼으로 변경하고 탭 이름을 `스크립트`로 통일
- [x] 내장 모듈의 트리거 스크립트를 읽고 JSON으로 편집·재포장

관련 커밋:

- `80297d1` — 손실 없는 통합 봇카드 편집기
- `6b00117` — Risu형 채팅 조작·번역·메타데이터와 안전 배경 기반
- `217d83f` — 카드 포맷별 추가 에셋 보존
- `ee02010` — iframe 백색 배경/CBS 노출 수정, 스크립트 편집 동선과 트리거 보존

### 반드시 정직하게 표시할 현재 한계

- [ ] 트리거 스크립트는 **보존·원본 JSON 편집만** 지원한다. 임의 Lua/JavaScript를 실행하지 않으며, 안전한 엔진 이벤트로 바꾸는 시각 편집기가 필요하다.
- [ ] Risu 정규식의 기본 4단계는 연결됐지만 `<inject>`, `<move_top>`, `<repeat_back>`, `<cbs>` 같은 고급 플래그 전체 의미는 아직 아니다.
- [ ] `backgroundHTML`의 CSS와 CBS는 적용되지만, 카드 상태창의 클릭 동작이 Risu trigger/button 계약에 의존하면 아직 완전 작동하지 않는다.
- [ ] 독립 `.risum`에 **새 바이너리 에셋을 추가**하는 재포장은 미완성이다. 기존 에셋과 모듈 원본은 보존된다.
- [ ] 응답 usage를 제공자별로 아직 모두 파싱하지 않아 토큰 표시는 대개 정직한 추정치다.
- [ ] `@scope` 기반 카드 CSS 범위 제한은 최신 Chromium/Tauri 기준이다. 다른 브라우저 폴백 시험이 필요하다.
- [ ] 이번 수정은 자동검증과 실물 정적 프로브까지 완료했지만, 실제 브라우저에서 두 대형 카드를 다시 임포트한 수동 시각 회귀는 다음 세션 첫 작업이다.

### 다음 작업 권장 순서

1. 용사여관과 Alternate Hunters V2 수동 스모크: 흰 배경 없음, CBS 노출 없음, 첫 이미지 크기, `봇 편집 → 스크립트` 저장·재실행 확인
2. Risu 트리거의 안전 부분집합을 분석해 `조건 → 엔진 이벤트/화면 행동` 노코드 편집기로 변환
3. 고급 정규식 플래그 골든 테스트와 Risu 동등 실행 범위 확대
4. 상태창 버튼과 CBS 변수 변경을 엔진 영수증·체크포인트에 연결
5. 제공자별 usage/finish reason/generation id 파싱과 스트리밍 메타데이터
6. DOMINIUM 카나리아로 카드명 전용 코드 없이 두 번째 시뮬 표면 증명

## P1 — SimPack v0.2

- [x] 원본 카드와 출처
- [x] Risu 호환 봉투와 raw payload
- [x] 페르소나 라이브러리와 세션 바인딩 — 세션 시작 시점 snapshot을 백업·복원
- [x] 프롬프트 preset·블록 순서·버전 hash
- [x] 카드·프리셋·캐릭터·채팅·페르소나별 모듈 바인딩
- [x] 콘텐츠(캐릭터·로어·장소·아이템)
- [x] 설치 모듈과 버전
- [x] 초기 상태와 규칙
- [x] 화면 목록과 내비게이션
- [x] 에셋 팩과 canonical 매핑
- [x] 프로젝트 옵션과 기능 토글
- [x] provenance·confidence·evidence
- [x] 미해결 충돌과 미지원 기능
- [x] 저장 데이터 migration 계약

완료 기준: 편집기와 플레이어가 동일한 SimPack 문서를 읽고, 앱 소스 수정 없이 프로젝트를 교체한다.

### 구현 완료 — SimPack v0.2 (2026-07-12)

- `.simpack`은 ZIP 컨테이너이며 `manifest.json`과 `blobs/`를 담는다. 모든 blob은 표준 SHA-256·크기와 대조한다.
- 경로 탈출, 파일 수·크기 초과, 누락·변조 blob, 알 수 없는 contract를 가져오기 전에 거부한다.
- `simpack/0.1` 평면 문서는 migration history를 남기며 0.2 구조로 이주한다.
- 카드 개요에서 현재 프로젝트를 내보내고, 시작 화면에 `.simpack`을 드롭하면 포함된 runtime schema·원본 카드·로어·페르소나·프롬프트로 바로 플레이한다.
- 제작자와 플레이어는 `selectSimPackRuntime` 하나를 공유한다. 프로젝트 교체에 앱 소스 수정이 필요하지 않다.

## P1.5 — 수백 턴 장기 세션 기반

목표는 수백만 토큰을 매번 LLM에 다시 보내는 것이 아니다. 전체 원문과 모든 엔진 사건은 로컬에 영구 보존하되, 매 턴에는 현재 판단에 필요한 근거만 검증 가능하게 조립한다.

### 저장·재현

- [x] `SessionStore` 계약: 현재 snapshot에 message, append-only engine event, 주기 snapshot, prompt run, undo/redo 이력을 함께 저장. 미사용 `SessionBundle`은 실제 `EngineJournalData` 계약으로 교체
- [x] append-only 엔진 이벤트 로그 + 주기적 snapshot — 성공·실패 사건, 부모 사건 index, 상태 해시·RNG·판정·로그를 저장하고 전체 재생으로 검증
- [ ] 모든 LLM 요청에 prompt hash, 모델, 응답, 제안 사건, 적용 수 기록 — 채팅 LLM의 상세 `PromptRun`은 기록하지만 최근 8개만 저장하며, 유실된 현장·일괄·장부 서사화 경로는 기록되지 않음
- [x] 사건 index 단위 체크포인트(`stateAt`)와 time machine 복원(`truncateTo`) — 분기 사건열과 최근 30턴 undo/redo를 저장·재개
- [x] 브라우저 SQLite WASM + OPFS Worker 저장 어댑터 (`@sqlite.org/sqlite-wasm` 직접 Worker + IndexedDB 안전 폴백)
- [ ] Tauri 데스크톱 네이티브 SQLite 저장 어댑터
- [x] 내보내기 가능한 단일 세션 백업과 손상 복구 검사 — 사건 전체 재생, 영속 undo/redo, 대안, 세션 고정 페르소나/프리셋, 30MB import 상한 포함

### 기억 계층

- [x] 엔진 현재 사실: 돈·HP·관계·퀘스트·위치 등 절대 요약하지 않는 authoritative state
- [x] 사건 원장: 사건 id·params·성공/실패·결과 로그·부모 index·상태 hash·RNG를 구조화 저장
- [x] 서사 기억: 약속·비밀·관계 변화·미해결 갈등을 근거 message/event id와 함께 저장
- [x] 원본 지식: 카드·로어·프롬프트·모듈을 세션 기억과 분리
- [x] 최근 대화 + 관련 사건 + 관련 로어를 합치는 deterministic context planner
- [ ] 요약을 다시 요약하며 왜곡하지 않도록 원문 근거 링크와 재생성 지원
- [ ] 1차 검색은 SQLite FTS5/trigram; 임베딩 검색은 필요성이 입증된 뒤 선택 도입

### 환각 방지 계약

- [ ] LLM 출력 계약: 현행은 `text`, `events`, `speakers`, `memories[].text`까지만 연결. `factRefs`·`continuityPatch` 계약과 검토 흐름은 유실
- [ ] 서사에 나온 돈·아이템·선택지·NPC·퀘스트를 engine facts와 대조
- [x] 존재하지 않는 사건은 적용하지 않고 실패 이유를 대화 칩과 로그에 표시
- [x] 실제 선택지는 selector가 만들며 LLM은 결정 카드 밖의 가짜 선택지를 나열하지 않음
- [x] memory candidate는 자동 사실 승격 금지; 엔진 사건 또는 사용자 승인과 근거 필요
- [ ] 세션 건강 패널: 현재 턴, 저장 크기, prompt 토큰 구성, 기억 적중, 미해결 충돌, 마지막 snapshot

### 장기 부하 합격 시험

- [x] 300사건 결정론 원장 fixture — 성공·실패 혼합, 50사건 주기 snapshot, 임의 시점 복원, 저장 전체 재생·손상 검출
- [x] 저장→종료→재개 후 state hash·RNG·선택지 일치 (state·RNG 동일 검증 — 선택지는 상태의 순수 함수라 동치)
- [ ] 50/100/250/300턴에서 prompt 크기가 전체 대화 길이에 선형 증가하지 않음
- [x] 초반 약속을 300턴 뒤 원문 message id와 함께 회수하는 결정론 fixture
- [ ] 300턴 동안 잔고·인벤토리·위치·사망 상태의 서사/엔진 불일치 0건
- [ ] Playwright 장기 세션·재개·오프라인 저장 E2E

### 현재 구현 감사 — WP1 사건 원장·영속 이력 복구 완료 (2026-07-14)

- [x] 300개 **엔진 사건**의 원장·스냅샷·재생·분기·손상 감지 — `packages/session/test/journal.test.ts`
- [x] 플레이 화면의 수동 세션 JSON 내보내기/가져오기와 이어하기 — 사건 원장·영속 undo/redo·세션 고정 페르소나/프리셋 포함
- [ ] LLM 호출 경로 전체의 prompt hash·모델·응답·제안 사건·적용 수 기록 — 일반 채팅은 최근 8건만, 관리 행동 서사화 경로는 유실
- [ ] 300턴 **LLM 대화**에서 프롬프트 크기와 기억 회수 품질 검증
- [ ] 브라우저 종료 후 자동 복구되는 영구 저장소(OPFS/SQLite) — 구현·헤더·RPC 검증 완료, 실제 브라우저 새로고침 E2E 대기
- [x] `SessionStore` 기준 구현을 실제 플레이 저장 경로에 통합
- [x] PromptRun 500건 감사 보존: 모델·응답·제안 사건·판정 로그·prompt/state hash는 500건, 화면에서 펼치는 전체 prompt/state는 최근 8건 보존
- [ ] 원장의 사건별 before/after state diff와 메시지·사건 상호 참조
- [x] 서사 기억 추출·승인·검색·근거 회수

“장기 세션”과 “장기 기억”을 구분한다. 현재 완성된 것은 전자의 결정론적 원장 단면이다. 후자는 아래 벤치마크를 통과한 검색 계층을 추가해야 한다.

### M1 — HypaMemory V3 / Voyage 기억 벤치마크

- [x] 300턴 대화형 고정 corpus와 질문 정답지 작성: 현재 사실, 최신값 우선, 약속·비밀, 의미 바꿔 말하기, NPC 구분, 무관 기억 배제
- [x] 비교 기준 A: 최근 대화 창만 사용
- [x] 비교 기준 B: 구조화 사실 + 키워드/FTS 검색
- [x] 비교 기준 C: Risu HypaMemory V3 방식(중요·최근·유사 기억, frozen summary·seed 격리)
- [x] 비교 기준 D: 벤치마크 fixture의 엔진 사실·사건 근거 + 어휘 + 선택형 semantic retrieval (프로덕션 append-only 사건 원장 완료를 뜻하지 않음)
- [x] 외부 API 없는 고정 임베딩 provider와 Phase A/B 결정론 보고서(JSON + Markdown)
- [x] **C0 벤치마크 보정**: 관련 없음(abstention), 최근 3개 메시지 질의, current fact exact match, NPC 혼동, 비밀 지식 범위, 롤백 기억, 근거 보유율/정답 근거 적중률 분리
- [x] **C1 선 구현**: `VoyageEmbeddingProvider`를 TypeScript strict로 작성하고 mock fetch로 배치·캐시·429 backoff·취소·키 마스킹·장애 폴백 검증
- [x] **C2 비교 기준 E — Grounded Hybrid V2**: authoritative facts + typed memory + lexical prefilter + 선택형 semantic + evidence/knowledge/rollback gate + abstention
- [ ] `voyage-context-3`를 Risu 재현 기준, `voyage-context-4`를 최신 대안으로 측정하는 BYOK `--live-voyage` 명령 제공
- [ ] 실제 채팅·API 환경이 준비되면 Recall@K·MRR/nDCG·오탐·NPC/비밀 누출·p50/p95·API 토큰/비용 실측. **실측 부재는 C0~C2 구현의 blocker가 아님.**
- [x] semantic memory는 키가 빈 기본 상태에서는 비활성. 사용자가 설정에 Voyage 키를 직접 넣는 것이 명시적 opt-in이며, 실패·키 없음·낮은 신뢰도일 때 구조화+어휘로 fail-open
- [x] 커뮤니티 플러그인/RisuAI 코드 선별 이식 시 원본 파일·버전·SHA-256·함수·우리 변경 내용을 provenance 문서에 기록

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

### M1.1 — 연속성 기억 안전 계약 (2026-07-13 복구 진행)

- [x] 기억에 장면·시간 출처, 지식 보유자/차단 대상, 사실·소문·추론, 생명주기 꼬리표 추가
- [x] 현재 장면 격리, 비밀 deny 우선, 불확실 기억의 authoritative 승격 금지
- [x] 현재 질문에서는 폐기 기억 차단, 과거 질문에서는 명시적 요청에 한해 당시 기억 회수
- [x] 순위가 아닌 실제 어휘 근거 강도를 쓰는 결정론 검색기와 abstention 연결
- [ ] 현재 TS 구현의 핵심 회귀 테스트는 복구했으나, 삭제 전 비교 기준 E 전체를 현재 코드로 재현·재측정
- [x] TypeScript 테스트를 기본 `npm test`와 배포 CI에 포함
- [ ] LLM 구조화 출력의 `memoryCandidates`/`continuityPatch`를 새 계약과 검토 UI에 실제 연결 (`memories[].text` 후보만 현재 연결)
- [ ] 같은 NPC의 없었던 사건 hard-negative를 주장 단위로 차단하는 보정
- [ ] 현재 장면 cohort와 플레이어 지식 범위를 실제 플레이 세션에서 공급 (계약·필터는 복구, 세션 공급은 미완료)
- [ ] Voyage 실측 후 semantic 단독 후보 하한을 보정; 그 전까지 라이브 기본값은 구조화+어휘(B)

1차 벤치마크 결과: E의 현재 사실 정확도 100%, 폐기값 현재 오노출 0건. 다만 고정 semantic 비교의
Recall@5는 28%로 B(53%)보다 낮고 hard-negative를 거르지 못했다. 따라서 semantic은 기본 비활성으로
두고, 아래 M1.2의 더 엄격한 lexical gate만 실제 플레이에 연결했다.

### M1.2 — 실제 플레이 기억 파이프라인 (2026-07-14 부분 복구 확인)

- 자유 대화·자동 장면·전투 시작 전에 승인된 관련 기억을 검색해 별도 프롬프트 블록으로 주입
- 사용자 메시지와 성공한 엔진 사건만 자동 승인 근거로 인정; LLM 단독 기억은 검토 대기
- 기억 후보의 승인·거절은 복구됐지만 `continuityPatch` 확정·해결 제안은 미연결
- `factRefs` 대조·메시지 칩·PromptRun 판정 trace는 유실
- 실패 사건 서술과 근거 없는 숫자를 검사하는 verifier는 복구됐지만 모든 플레이 경로 연결은 재검증 필요
- 메시지 id와 기억 원장은 저장하지만 사건 원장·판정 trace·상태 변경 제안은 세션 백업에서 유실
- 현재 snapshot으로 되돌릴 때 미래 기억은 제거되지만 사건 근거 단위 자동 폐기는 사건 원장 복구 뒤 다시 연결해야 함
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

- [x] `screens[]`와 화면 내비게이션
- [x] 탭·모달·오버레이·선택 상태
- [x] selector 기반 데이터 연결
- [x] event 기반 버튼 연결
- [x] 허용 목록 조건식
- [x] 데스크톱·모바일 배치
- [x] 기본 위젯: 카드 목록, 상세 패널, 표, 슬롯, 게이지, 퀘스트, 인벤토리, 지도 노드, 달력, 제작 대기열, 전투 HUD

구현: `core/screens/runtime.js`가 화면 정규화, own-property selector 경로, 허용 AST(`all/any/not/eq/ne/gt/gte/lt/lte/truthy/includes`), event params 연결을 담당한다. `declarativeScreenView.js`는 프로젝트 id별 화면·모달·선택 상태를 보관하고 공통 위젯만 렌더링한다. 화면에 chat/sidebar가 없으면 기존 안전 플레이 셸을 자동으로 붙여 빈 화면을 막는다. 프로젝트 이름을 검사하는 분기는 없다.

금지: `playView.js`에 Alternate Hunters, 소녀전선, Belladonna 전용 분기를 추가하지 않는다.

## P3 — 공통 런타임 모듈

우선순위 1:

- [x] `core.progression`: 레벨·EXP·스탯 포인트
- [x] `core.equipment`: 무기·방어구·장신구 슬롯
- [x] `rpg.quests`: 목표·진행도·보상·실패
- [x] `rpg.party`: 동료·역할·편성
- [x] `core.time`: 날짜·시간 경과
- [x] `core.location`: 장소·이동

우선순위 2:

- [x] `rpg.loot`
- [x] `rpg.shop`
- [x] `rpg.crafting`
- [x] `core.factions`
- [x] `core.jobs`: 제조·수복·건설처럼 시간이 걸리는 작업

11개 모듈은 `engine/core/modules/commonRpg.js`에 독립 module definition으로 등록되어 namespaced event와 selector를 제공한다. 스키마 섹션이 없는 기존 카드는 새 상태 키를 만들지 않아 용사여관·범용 전투 golden hash가 그대로 유지된다. 실패·악성 동적 키는 registry가 상태와 RNG를 함께 되돌린다.

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

- [x] 상태창 예시값을 실제 초기 상태로 오인하지 않음
- [x] 헌터 등급과 레벨을 별도로 관리
- [x] 상태창은 보조 LLM이 아니라 엔진 selector로 생성
- [x] 실제 선택지만 결정 카드에 표시
- [x] NPC 감정 스프라이트를 canonical ID로 표시
- [x] 관련 NPC 로어만 동적으로 주입
- [x] 기능 토글 지원
- [x] 앱 소스에 얼헌 전용 분기 없음

구현: `genre.hunter`가 등록·객관식 등급 평가·게이트 수락/클리어/협회 정산·길드 가입을 담당한다. `examples/alternate-hunters-v2/project.json`은 실제 카드의 헌터/게이트/길드/마정석 축을 SimPack 데이터와 선언형 화면으로 조립한다. 레벨과 협회 등급은 별도 상태이며 화면은 `engine:` selector 연결만 사용한다.

## P6 — 교차 장르 검증

- [x] 루미나 마을: 엔진이 거의 없는 카드의 대화·로어 중심 저하 없는 실행
- [x] 소녀전선 축소 루프: 인형 보유 → 제대 편성 → 임무 → 보상 → 수복
- [x] Belladonna 축소 루프: 주간 계획 → 학사 사건 → 스탯·호감 변화 → 다음 주
- [x] 용사여관: 기존 경영·숙박 회귀 유지

구현: `examples/cross-genre/fixtures.json`과 교차 장르 테스트가 대화 전용 저하 없는 실행, 제대·임무·수복, 주간 계획·학사 사건 루프를 검증한다. 새 장르 전용 앱 분기 없이 공통 모듈만 조합하며, 기존 golden 테스트가 용사여관 회귀를 계속 고정한다.

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

구현 상태: [x] 첫 폼 편집기 MVP. 기본 정보, Risu 프리셋 선택·원본 보기, 로어 일괄 편집, 모듈 활성화, 초기 상태 검증, canonical 에셋 확인, 화면 프리셋, 라이브 플레이테스트, SimPack 저장을 하나의 제작 작업공간으로 연결했다. 위험한 Lua 실행과 자동 승인은 계속 차단한다. Risu 원본 형식으로의 편집 내보내기와 고급 prompt/state diff는 후속 정밀 편집 단계다.

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
- 허가 범위를 넘거나 출처 확인 없이 Risumari 코드를 통째로 복사하는 방식

## MVP 이전 금지

- RisuAI 전체 Lua 실행 및 CBS 무검증 완전 실행
- 소녀전선 전체 일괄 재현
- 무제한 HTML·DOM 접근
- 범용 타일맵 제작기
- 공개 마켓플레이스·결제
- 장르별 플레이 뷰 복제
- 누락·추정을 숨긴 자동 승인
