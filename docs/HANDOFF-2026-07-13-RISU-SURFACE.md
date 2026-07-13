# Handoff — Risu형 플레이 표면과 통합 카드 편집기

기준 시점: 2026-07-13  
기준 브랜치: `main`  
기준 커밋: `ee02010`  
원격 상태: `origin/main`에 푸시 완료

## 1. 제품 정체성

제품명은 **럭키 시뮬레이터**다.

> 리스에서 수백 턴 굴리기 불편한 시뮬봇을 익숙한 환경으로 가져와, 엔진이 상태·선택지·기억 근거를 소유한 채 오래 플레이하는 Risu 호환 강화 플레이어.

중요한 구분:

- Risu 클론 자체가 목적이 아니다.
- 카드·프롬프트·페르소나·로어·에셋·안전한 CBS/정규식은 최대한 이사 비용 없이 사용한다.
- Lua/JavaScript를 그대로 실행하지 않는다.
- 돈·수치·객실·퀘스트·선택지 같은 사실은 LLM이 아니라 결정론 엔진이 소유한다.
- 제작 도구는 별도 앱처럼 분리하지 않고 플레이 화면의 `봇 편집` 안에 둔다.

설계 우선순위는 다음 문서 순서다.

1. `docs/adr/0001-product-identity-and-platform-boundaries.md`
2. `docs/adr/0002-lucky-simulator-risu-compatible-player.md`
3. `docs/DESIGN.md`
4. `docs/ROADMAP.md`
5. `docs/BACKLOG.md`

루트의 오래된 `BACKLOG.md`와 과거 SPEC은 역사 자료다. 충돌하면 위 문서가 우선이다.

## 2. 이번 세션에서 연결한 사용자 경험

### 플레이 표면

- 앱을 열면 플레이어가 첫 화면이다.
- 왼쪽에는 카드와 채팅 목록, 설정·컴파일·시뮬레이션 진입이 있다.
- 모바일 드로어에도 카드·채팅·설정·봇 편집이 있다.
- 별도 `/editor` 표면은 제거했다.

### 채팅 작업줄

- 메시지 편집·삭제·복사
- 번역 sidecar 표시/숨김
- 이전 응답/다음 응답 전환
- 마지막 대안에서 다음 화살표를 누르면 리롤
- `계속 생성`은 입력창 왼쪽이 아니라 마지막 AI 메시지 작업줄에 위치
- 토큰, 프로바이더, 모델, 처리 시간, 생성 시각, 종료 이유, 생성 ID, 실제 프롬프트 확인
- 제공자가 usage를 주지 않으면 `≈` 추정 토큰으로 표시

### 카드 편집

PC에서는 왼쪽 카드명 옆 `봇 편집`, 모바일에서는 메뉴의 `봇 편집`으로 연다.

탭:

1. 기본 정보
2. 첫 메시지/대체 인사
3. 로어북
4. 에셋
5. 스크립트
6. 고급 원본 JSON
7. 시뮬레이션

`스크립트` 탭에는 다음이 있다.

- 백그라운드 임베딩 HTML/CSS
- 정규식 4단계: input/output/request/display
- 내장 모듈 트리거 원본 JSON 편집

트리거는 저장·왕복만 된다. 실행된다고 오해하지 말 것.

## 3. 핵심 구현 위치

### 손실 없는 카드 문서와 재포장

- `packages/card/src/document.ts`
  - `CardDocument`, draft, 원본 보존
  - 로어·에셋·정규식·트리거 읽기
- `packages/card/src/repack.ts`
  - JSON, PNG, CharX, JPEG polyglot, RISUM 재포장
  - 알 수 없는 필드와 다른 ZIP entry 보존
- `packages/card/test/document.test.ts`
  - unknown field, CharX entry, JSON/PNG 추가 에셋, 트리거 왕복

### Risu 표현 호환

- `packages/risu/src/cbs.ts`
  - 안전 CBS 부분집합
  - `screen_width`, 에셋 매크로 보존
- `packages/risu/src/card-regex.ts`
  - input/output/process(display request 포함)/display
- `packages/risu/src/card-project.ts`
  - 카드·모듈의 배경, 변수, 정규식, 인사 런타임 프로필
- `apps/web/src/player/display-macros.ts`
  - 정규식 → CBS → 에셋 → 마크다운/HTML 정화 순서

### 배경 렌더링 — 최근 회귀 수정 지점

- `apps/web/src/player/BackgroundSurface.svelte`
- `apps/web/src/player/background-render.ts`
- `apps/web/src/player/background-render.test.ts`

중요:

- Risu의 `backgroundHTML`은 벽지 이미지가 아니라 채팅 CSS/상태창 스킨이다.
- iframe으로 렌더하면 흰 iframe이 채팅을 덮고 카드 CSS가 메시지 이미지에 적용되지 않는다.
- 현재는 CBS를 먼저 계산하고, 위험 태그·외부 URL을 제거한 뒤 `@scope (.lucky-card-surface)`로 현재 카드 채팅 영역에만 CSS를 적용한다.
- 용사여관 배경 CBS는 원래 0개, Alternate Hunters V2는 172개였고 처리 후 둘 다 잔여 0개를 실물 정적 프로브로 확인했다.

### 플레이 UI

- `apps/web/src/player/PlayerPage.svelte`: 전체 배선
- `apps/web/src/player/BotEditorPanel.svelte`: 통합 카드·스크립트·시뮬레이션 편집기
- `apps/web/src/player/MessageList.svelte`: 번역·대안·리롤·토큰·메타데이터
- `apps/web/src/player/InputBar.svelte`: 우측 보내기/중단만 유지
- `apps/web/src/player/SidePanel.svelte`: 명시적 `봇 편집` 진입
- `apps/web/src/player/SettingsPanel.svelte`: 이미지 크기와 모델/보조 모델

### 세션

- `packages/session/src/index.ts`
  - 번역 sidecar
  - 응답별 `PromptRun` 메타데이터
  - 체크포인트·대안·기억·화자 복원
  - 300턴 bounded prompt 저장

## 4. 이번 세션 관련 커밋

- `80297d1 feat: integrate lossless bot card editor`
- `6b00117 feat: complete Risu chat parity surface`
- `217d83f fix: preserve added card assets across formats`
- `ee02010 fix: render Risu card backgrounds without iframe`

그 직전 주요 기반:

- `8b2d00f` Risu raw 이미지 에셋 렌더
- `8464b5f` 페르소나 격자와 카드 정렬
- `a1a0111` 컴파일 진단과 도킹 시뮬레이션
- `0390ba7` 암호화 `.risup` 프리셋 import
- `90777b8` 언어별 첫 메시지·썸네일·감정 스프라이트 보정

## 5. 검증 상태

마지막 실행: `pnpm check`

- TypeScript/Svelte 검사: 오류 0, Svelte 경고 0
- 자동 테스트: 총 258개 통과
- 세션 300턴 장기 회귀 통과
- 웹 프로덕션 빌드 성공
- git worktree clean

추가 실물 정적 프로브:

- `C:\freetalk\용사여관.charx`
- `C:\freetalk\Alternate Hunters V2.charx`
- 두 카드 모두 배경 처리 뒤 `{{...}}` 잔여 0
- iframe 사용 0, 범위 제한 CSS 생성 확인

주의: 최신 배경 수정 뒤 실제 브라우저에서 대형 카드 두 장을 다시 임포트하는 수동 시각 테스트는 아직 하지 않았다. 다음 세션 첫 작업으로 둔다.

## 6. 알려진 한계와 함정

### 트리거

- module `trigger`를 읽고 JSON으로 편집·저장한다.
- 실행하지 않는다.
- 안전한 트리거 부분집합을 엔진 이벤트로 옮기는 설계가 필요하다.
- “트리거 편집 가능”과 “트리거 실행 가능”을 UI·문서에서 혼동하지 말 것.

### 정규식

- 기본 4단계는 작동한다.
- Risu 고급 flags 전체는 아니다: `<inject>`, `<move_top>`, `<move_bottom>`, `<repeat_back>`, `<order n>`, `<cbs>` 등.
- 정규식 시간·길이·횟수 제한과 위험 HTML 제거를 약화하지 말 것.

### 배경/상태창

- CSS와 CBS는 처리한다.
- trigger/button 매크로가 필요한 상태창 클릭 동작은 아직 완전하지 않다.
- 임의 DOM API나 script 실행으로 해결하지 말 것. 엔진 이벤트/안전 버튼 계약으로 연결한다.
- CSS `@scope`는 최신 Chromium/Tauri 기준이다. 비 Chromium 브라우저 폴백 시험 필요.

### 에셋

- JSON/PNG/CharX 추가 에셋은 보존된다.
- 독립 RISUM에 새 바이너리 asset stream을 추가하는 재포장은 미완성이다.
- 모듈 유래 에셋을 카드 에셋처럼 무심코 삭제·재배열하지 말 것.

### 토큰 정보

- UI와 세션 계약은 실제 usage를 받을 수 있다.
- 현재 제공자 adapter 다수가 usage/finish reason/id를 채우지 않아 대개 추정치다.

### 라이선스·크레딧

- 프로젝트는 GPL-3.0-or-later.
- Risu 이식은 `docs/THIRD_PARTY_PROVENANCE.md` 정책을 따른다.
- Risumari 제작자 허가는 커뮤니티 댓글로 받았다. 정식 공개 글에 원 공유 글 링크와 크레딧을 남긴다.
- Risumari/하야쿠 관련 제작자명 주석을 코드 내부에 추가할 필요는 없다.

## 7. 다음 작업자가 바로 할 일

### 1순위 — 실제 화면 스모크

용사여관과 Alternate Hunters V2를 새로 임포트하여 확인:

1. 채팅 배경이 흰색으로 덮이지 않는다.
2. `{{screen_width}}`, `{{#if ...}}` 같은 CBS 원문이 보이지 않는다.
3. `rp-image-card` 이미지 크기가 카드 CSS와 사용자 최대 너비 설정 사이에서 합리적이다.
4. PC 카드명 옆 `봇 편집`, 모바일 메뉴의 `봇 편집`이 보인다.
5. `스크립트` 탭에서 배경·정규식·트리거가 읽히고 저장 후 재개방해도 유지된다.
6. 기존 채팅·엔진 세션이 카드 편집 때문에 소실되지 않는다.

### 2순위 — 트리거 안전 편집기

- Risu trigger v1/v2 실제 구조를 대표 카드에서 목록화
- 안전 조건/효과와 실행 금지 효과를 호환성 여권에 분리
- 폼/블록 UI로 `조건 → 엔진 이벤트 → 사실 영수증 → 체크포인트` 연결
- 원본 JSON은 항상 보존하고, 변환은 별도 normalized layer에 둔다

### 3순위 — 표현 패리티

- 고급 regex flags 골든 테스트
- 상태창 버튼의 안전 CBS 변수 변경
- provider별 실제 usage/finish metadata
- 브라우저별 scoped CSS 폴백

### 그다음 — 북극성

DOMINIUM을 앱 코드 수정 없이 두 번째 카나리아로 연결한다. 카드명 전용 Svelte 분기를 추가하면 실패다.

## 8. 작업 규율

- 큰 작업이 끝날 때 `pnpm check` 후 커밋하고 `origin/main`에 푸시한다.
- 사용자 변경과 무관한 dirty 파일을 덮지 않는다.
- 설명은 비코더가 이해할 수 있는 한국어로 결과→이유→영향 순서로 한다.
- 카드 Lua/JS는 실행하지 않는다.
- `BUTTON_ONLY_EVENTS`, `sessionIntegrity`, 비밀 마스킹, own-property selector 같은 보안 척추를 우회하지 않는다.
- 기능 수보다 디싱크 0과 원본 무손실을 우선한다.
