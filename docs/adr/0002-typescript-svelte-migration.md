# ADR 0002: TypeScript·Svelte 전면 마이그레이션

- 상태: 승인
- 결정일: 2026-07-12
- 적용 범위: 저장소 구조, 빌드, Kernel, 런타임, 웹 UI, 데스크톱

## 결정

플랫폼을 pnpm workspace 기반 모노레포로 전환한다. 외부 계약과 결정론 런타임은 TypeScript strict로, 웹 플레이어와 편집기는 Svelte 5와 Vite로 구현한다. 브라우저 저장은 Worker 내부 SQLite WASM·OPFS를 유지하고 데스크톱 배포는 웹 전환 후 Tauri 2 셸로 제공한다.

최종 목표는 구형 CommonJS·수동 DOM UI를 제거하는 것이지만, 전환 중에는 신구 구현에 같은 입력을 넣어 상태·로그·RNG·저장 바이트를 비교한다. 동등성이 확인되기 전에는 구형 구현을 삭제하지 않는다.

## 계층

1. `packages/contracts`: JSON Schema와 TypeScript 계약
2. `packages/kernel`: 장르 중립 결정론 실행기
3. `packages/modules`: 조합 가능한 런타임 모듈
4. `packages/card`, `risu-compat`, `simpack`: 외부 형식 경계
5. `packages/runtime`, `memory`, `persistence`: 장기 세션 실행
6. `packages/ui`: 디자인 토큰과 UI primitive
7. `apps/web`: Svelte 플레이어·편집기
8. `apps/desktop`: Tauri 네이티브 셸

## UI 구조 원칙

`Theme tokens → UI primitive → Widget → Layout → Screen declaration` 순으로 의존한다. 엔진과 selector는 DOM, 위치, 색상, 모바일 표현을 알지 못한다. 기존 `playView.js`를 하나의 거대한 Svelte 컴포넌트로 번역하지 않는다.

## 금지

- 동등성 테스트 없는 빅뱅 교체
- 외부 입력에 `any` 사용
- Kernel의 장르명 분기
- UI에서 엔진 내부 상태 직접 변경
- migration 없는 저장 형식 변경
- UI 스레드에서 대형 압축 해제·SQLite·대규모 replay 실행
- Tauri 도입을 이유로 결정론 엔진을 Rust로 이중 구현

## 품질 게이트

각 큰 단계는 `pnpm check`, 기준선 비교, `git diff --check`를 통과한 뒤 커밋·푸시한다. 용사여관, 범용 전투, Alternate Hunters V2, 교차 장르, 300턴 장기기억 fixture는 전체 전환 동안 유지한다.
