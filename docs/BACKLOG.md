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
- [ ] 모든 LLM 요청에 prompt hash, 사용 블록, 모델, 응답, 제안 사건, 적용/거부 결과 기록 (`PromptRunRecord` 계약만 확정 — 플레이 경로 연결 남음)
- [x] 사건 index 단위 체크포인트(`stateAt`)와 time machine 복원(`truncateTo`) — 커널 완성, 턴·날짜 단위 UI는 남음
- [ ] 브라우저 SQLite WASM + OPFS Worker 저장 어댑터 (SessionStore 계약에 꽂는 구조 확정됨)
- [ ] Tauri 데스크톱 네이티브 SQLite 저장 어댑터
- [x] 내보내기 가능한 단일 세션 백업과 손상 복구 검사 (원장 `toJSON`/`restoreSessionJournal` — head 해시·판정·스키마 지문 대조)

### 기억 계층

- [ ] 엔진 현재 사실: 돈·HP·관계·퀘스트·위치 등 절대 요약하지 않는 authoritative state
- [ ] 사건 원장: 누가 언제 무엇을 했고 어떤 state diff가 났는지 구조화 저장
- [ ] 서사 기억: 약속·비밀·관계 변화·미해결 갈등을 근거 message/event id와 함께 저장
- [ ] 원본 지식: 카드·로어·프롬프트·모듈을 세션 기억과 분리
- [ ] 최근 대화 + 관련 사건 + 관련 로어를 합치는 deterministic context planner
- [ ] 요약을 다시 요약하며 왜곡하지 않도록 원문 근거 링크와 재생성 지원
- [ ] 1차 검색은 SQLite FTS5/trigram; 임베딩 검색은 필요성이 입증된 뒤 선택 도입

### 환각 방지 계약

- [ ] LLM 출력 계약: `narrative`, `speakers`, `proposedEvents`, `memoryCandidates`, `factRefs`
- [ ] 서사에 나온 돈·아이템·선택지·NPC·퀘스트를 engine facts와 대조
- [ ] 존재하지 않는 사건은 적용하지 않고 실패 이유를 대화 칩과 로그에 표시
- [ ] 실제 선택지는 selector가 만들며 LLM은 결정 카드 밖의 가짜 선택지를 나열하지 않음
- [ ] memory candidate는 자동 사실 승격 금지; 엔진 사건 또는 사용자 승인과 근거 필요
- [ ] 세션 건강 패널: 현재 턴, 저장 크기, prompt 토큰 구성, 기억 적중, 미해결 충돌, 마지막 snapshot

### 장기 부하 합격 시험

- [x] 300턴 결정론 자동 플레이 fixture (`engine/test/sessionJournal.test.js` — 성공·RNG 소모·의도적 실패 혼합)
- [x] 저장→종료→재개 후 state hash·RNG·선택지 일치 (state·RNG 동일 검증 — 선택지는 상태의 순수 함수라 동치)
- [ ] 50/100/250/300턴에서 prompt 크기가 전체 대화 길이에 선형 증가하지 않음
- [ ] 초반 약속·관계·퀘스트를 250턴 뒤 근거와 함께 회수
- [ ] 300턴 동안 잔고·인벤토리·위치·사망 상태의 서사/엔진 불일치 0건
- [ ] Playwright 장기 세션·재개·오프라인 저장 E2E

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
