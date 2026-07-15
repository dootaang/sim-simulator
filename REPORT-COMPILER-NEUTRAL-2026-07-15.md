# 컴파일러 장르 중립화 완료 보고서 (2026-07-15)

## 사용자에게 보이는 변화

- 얼헌 실카드를 컴파일하면 이제 헌터 화면이 생긴다. `헌터`·`게이트`처럼 서로 다른 헌터 서명이 2개 이상인 카드에는 헌터 협회, 게이트, 파티 화면이 함께 설치된다.
- 세 번째 장르 카드는 장르 특수 코드 없이 통과한다. 등록된 장르 템플릿과 일치하지 않으면 장르 모듈도 설치하지 않고 장르 합성도 실행하지 않는다.
- 여관 카드는 기존과 같은 모듈 순서, `rpg.quests` 제외, 정규화 스키마, 화면 프리셋을 유지한다. 여관 본문에 `헌터`가 한 번 등장하는 것만으로 헌터 화면이 잘못 설치되지 않는다.

## 변경·생성 파일

- `packages/modules/src/genre-templates.ts` (생성): `GenreTemplate` 계약과 여관·헌터 템플릿 레지스트리. 기존 여관 탐지 정규식과 합성 본문을 이식하고 헌터 2개 이상 서명 탐지를 추가했다.
- `packages/modules/src/index.ts`: 장르 템플릿 레지스트리를 패키지 공개 API로 내보낸다.
- `packages/compiler/src/index.ts`: `resolveModules`가 장르 이름 대신 레지스트리를 순회하고 템플릿별 제외 목록을 적용한다. 직접 단위 검증을 위해 `resolveModules`를 export했다.
- `packages/compiler/src/schema-normalize.ts`: 여관 합성 함수와 직접 호출을 삭제하고, 설치된 장르 템플릿의 합성기를 범용 루프로 실행한다.
- `packages/compiler/test/genre-templates.test.ts` (생성): 여관 기존 결과·헌터 2개 서명과 화면·여관의 단일 헌터 언급·제3 장르 무합성을 고정한다.
- `REPORT-COMPILER-NEUTRAL-2026-07-15.md` (생성): 이 보고서.

## 작업지시서와 달리한 점

- 구현 동작은 지시서에서 달리하지 않았다. `compiler-prompt.ts`, `lua-mine`, `schema-patch`, 레거시 `compileCardDraft` 경로는 수정하지 않았고 커밋·푸시도 하지 않았다.
- 완료 조건의 문자열 검색은 시작 시점부터 다른 지시와 충돌한다. `packages/compiler/src/compiler-prompt.ts`의 `여관`, 수정 금지인 `compileCardDraft`의 `genre.inn`·`genre.hunter`·`여관`·`헌터`, 기존 `validateCompiledSemantics`의 `genre.inn`·`여관`이 남아 있어 KNOWN_MODULES 외 검색 결과가 존재한다. 이번 대상이었던 `resolveModules`의 여관 탐지 문자열과 `schema-normalize.ts`의 `synthesizeInn`은 제거했다. 금지된 파일·경로 또는 기존 의미 검증 계약을 바꾸는 방식으로 검색 결과를 숨기지 않았다.
- `pnpm verify`는 모든 타입 검사·단위 테스트·빌드와 Playwright e2e 34개 성공을 두 차례 출력했지만, 34번째 테스트 뒤 Playwright 프로세스가 종료되지 않아 각각 120초와 300초 셸 제한에서 종료 코드 124가 됐다. `CI=1`로 e2e만 다시 실행해도 34개 성공 표시 뒤 같은 종료 지연이 재현됐다.

## 검증 결과

- `corepack pnpm check`: 통과(종료 코드 0) — 전체 타입 검사, 전체 단위 테스트, Vite 빌드가 성공했다.
- `corepack pnpm --filter @simbot/modules typecheck`: 통과.
- `corepack pnpm --filter @simbot/compiler typecheck`: 통과.
- `corepack pnpm --filter @simbot/compiler test`: 통과 — 5개 파일, 15개 테스트. 기존 11개와 신규 4개가 모두 성공했다.
- `node --experimental-transform-types -e "import('./packages/compiler/src/index.ts')"`: 통과(종료 코드 0).
- `corepack pnpm verify`: 테스트 내용은 통과, 명령 종료는 실패(종료 코드 124). 타입 검사 전체 통과, 전체 단위 테스트 통과, Vite 빌드 통과, e2e 34/34 통과 후 종료 정리 지연.
- `packages/compiler/src` 문자열 검색: 실패. 위의 선행·금지 경로 문자열이 KNOWN_MODULES 외에도 검색된다.
- `git diff --check`: 통과.
- 기준 커밋과 이식 후 `synthesizeInn` 함수 본문 문자 대조: 통과 — 3,311자 완전 동일.
