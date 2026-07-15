# 프롬프트 다이어트 D3 완료 보고서 (2026-07-15)

## 사용자에게 보이는 변화

- Anthropic 키로 플레이하면 두 번째 턴부터 카드 원문이 캐시로 처리돼 입력 비용이 크게 줄고, 토큰 표시가 추정치가 아닌 Anthropic 응답의 실측값으로 바뀐다.
- 대화 내용과 프롬프트 순서는 바뀌지 않는다. 캐시에는 매 턴 같은 카드 설명·페르소나·기본 지시만 안정 구간으로 전달하고, 로어·메모리·엔진 사실처럼 매 턴 달라질 수 있는 내용은 휘발 구간으로 전달한다.
- `messageMeta`가 없는 구형 호출은 요청 본문까지 기존 방식과 완전히 동일하게 유지한다.

## 변경 파일

- `packages/risu/src/contracts.ts`
  - `CompiledPrompt`에 선택 필드 `messageMeta?: Array<{blockType:string}>`를 추가했다.
- `packages/risu/src/compiler.ts`
  - 일반 블록, chat, authornote 삽입, `postEverything` 배열 확장, 연속 역할 병합 경로에서 `messages`와 `messageMeta`를 같은 인덱스로 push/splice/merge한다.
  - 기존 `messages` 내용·순서와 기존 trace 필드는 변경하지 않았다.
- `packages/session/src/providers/anthropic.ts`
  - system 메시지를 안정 구간(`plain`, `jailbreak`, `cot`, `description`, `persona`)과 휘발 구간(그 외 블록)으로 분리한다.
  - 안정 구간 텍스트 블록에만 `cache_control:{type:'ephemeral'}`을 둔다.
  - 안정 블록이 없거나 `messageMeta`가 없으면 기존 단일 문자열 system 형식을 유지한다.
  - 안정/휘발 순서가 섞인 비표준 입력은 기존 바이트 순서를 지키기 위해 단일 문자열 형식으로 안전하게 폴백한다.
  - Anthropic `usage`의 입력·출력·캐시 읽기·캐시 생성 토큰을 `NarrativeResponse.usage`로 반환한다. `inputTokens`는 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, `outputTokens`는 `output_tokens`다.
- `packages/risu/test/message-meta.test.ts`
  - emit, chat, authornote splice, `postEverything`, 연속 역할 병합 뒤 메타데이터 인덱스 정렬을 검증한다.
- `packages/session/test/anthropic.test.ts`
  - mock fetch로 안정/휘발 분리와 캐시 마커 위치, 두 구간 재결합 불변 계약, 메타 없는 구형 요청 본문의 바이트 동일성, usage 파싱을 검증한다.
- `REPORT-PROMPT-DIET-D3-2026-07-15.md`
  - 본 완료 보고서다.

## 기대값 갱신

- 기존 테스트 기대값은 갱신하지 않았다.
- 프롬프트 파리티 골든 테스트는 기존 `messages`, assistant prefill, warnings 기대값을 그대로 사용해 통과했다. 따라서 기존 메시지 내용과 순서가 유지됐다.
- `CompiledPrompt` 전체를 해시하는 새 실행의 `promptHash`는 의도적으로 추가된 `messageMeta` 때문에 이전 코드가 만든 값과 달라질 수 있다. 저장된 기대 해시를 가진 테스트는 없어서 수정한 기대값은 없다.

## Vertex 판단

- `packages/session/src/providers/vertex.ts`는 Google Vertex의 `generateContent` 경로로 Gemini 모델만 제공하며 Anthropic/Claude 요청 형식을 사용하지 않는다. 작업지시서 조건에 따라 변경하지 않았다.

## 검증 결과

- `pnpm verify`: 성공, 종료 코드 0, 총 75.9초.
- 타입 검사: 14개 대상 워크스페이스 전부 통과. Svelte 검사도 0 errors, 0 warnings.
- 단위 테스트: 전 워크스페이스 통과. 관련 패키지는 Risu 109개, Session 107개 테스트 통과.
- 신규 테스트: Risu `message-meta.test.ts` 2개, Session `anthropic.test.ts` 4개 통과.
- 빌드: 웹 프로덕션 빌드 성공(446 modules transformed).
- e2e: `Running 34 tests using 1 worker`, `34 passed (27.1s)`.
- `git diff --check`: 통과.

## 작업지시서 대비 이탈

- 없음.
- 사용자 지시대로 git commit/push, 다른 프로바이더·세션 로직·프리셋·모듈·문서 수정, 카드명 분기, 스크린샷 생성은 하지 않았다.
