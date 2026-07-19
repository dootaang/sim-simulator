# 제3자 코드 출처 (Third-Party Provenance)

이 프로젝트(GPL-3.0-or-later)에 선별 이식한 외부 코드의 출처를 기록한다. ADR 0001 · CLAUDE-TASK-HYPA §9 정책.

## Choice·Dice 모듈 메커니즘

- 출처: `⚖️ Choice Module: Capsule Extension v5.9`, `🎲 Dice Module` (아카라이브 AI채팅 채널 공유본).
- 권한: 제작자가 봇/유틸 편입을 허가했고 배포 글 마지막 줄 한 줄 크레딧을 조건으로 제시했다. 허가 증빙과 결정은 2026-07-10 커밋 `180b581`, `e41e445`에 기록돼 있다.
- 적용: `packages/modules/src/gfl.ts`의 관계 선택 캡슐과 d20/DC 4단계 판정, 기존 `combat.turnbased`의 전투 판정. 원본 Lua의 채팅 편집·DOM 조작·저수준 API는 복사하거나 실행하지 않는다.

## Risu encrypted preset import

- RisuAI (GPL-3.0-or-later) `src/ts/storage/database.svelte.ts`, `src/ts/util.ts`, and `src/ts/rpack/{rpack_js.js,rpack_map.bin}` were used to reproduce the `.risup`/`.risupreset` interoperability contract in `packages/risu/src/preset-file.ts`.
- The imported boundary is limited to RPack byte substitution, DEFLATE, MessagePack, and AES-256-GCM with Risu's preset key. No Risu database or global Svelte state was copied.
- `fflate` (MIT) and `msgpackr` (MIT) provide compression and MessagePack decoding.

## SQLite Wasm

- Package: `@sqlite.org/sqlite-wasm` `3.53.0-build1`
- Repo: https://github.com/sqlite/sqlite-wasm
- License: Apache-2.0
- 사용 범위: 전용 Worker 안의 SQLite OO1 API와 OPFS VFS. `sqlite3.wasm` 및 공식 OPFS async proxy를 빌드 결과에 그대로 배포한다.
- 우리 코드: `apps/web/src/workers/sqlite.worker.ts`, `packages/persistence/src/browser.ts`
- Worker1/Promiser API는 2026-04-15부터 deprecated이므로 사용하지 않고, 공식 권고대로 라이브러리를 자체 Worker 안에서 직접 초기화한다.

## RisuAI

- Repo: https://github.com/kwaroran/RisuAI
- License: GPL-3.0
- 비교 기준 commit: `9d8791ea842404ef3c7e6410c2359a2db7ca4bcd`
- 로컬 조사 클론: `C:\risu` (HEAD `eb7780b`, 위 기준 commit 이후 main)

### 이식/재현 내역

| 날짜 | 원본 파일·함수 | 우리 파일 | 이식 방식 | 변경 내용 |
|---|---|---|---|---|
| 2026-07-12 | `src/ts/process/memory/hypav3.ts` — 점수 결합·RRF·기억 예산 | `packages/memory/src/semantic.ts`, `packages/memory/src/index.ts` | 의미 재현(전체 복사 아님) | 결정론 tie-break, 근거 원장, 승인 상태를 추가 |
| 2026-07-12 | `src/ts/persona.ts` — persona 규격 | `packages/risu/src/index.ts` | 파일 규격 상호운용 재구현 | UI/DB 결합은 가져오지 않음 |
| 2026-07-12 | Risu preset·prompt 구조 | `packages/risu/src/index.ts` | 파일 규격 상호운용 재구현 | 알 수 없는 원본 필드를 보존 |
| 2026-07-12 | `src/ts/process/scripts.ts`, `src/ts/cbs.ts`, `src/ts/process/modules.ts` | `packages/risu/src/lore.ts` | 안전 부분집합 재구현 | 읽기 전용·결정론 경로만 허용하고 실행형 부작용은 차단 |
| 2026-07-12 | `src/ts/process/request/openAI/requests.ts`, `src/ts/process/request/anthropic.ts`, `src/ts/process/request/google.ts` | `packages/session/src/providers/` | 요청 계약 의미 재현(코드 복사 아님) | 프로바이더별 역할·헤더·응답 변환을 우리 `ModelProvider` 계약으로 재구현 |
| 2026-07-12 | `src/ts/process/prompt.ts` (`PromptItem`, `tokenizePreset`), `src/ts/process/index.svelte.ts` (promptTemplate 조립), `src/ts/parser/parser.svelte.ts` (기본 치환 문법), `src/lib/Setting/Pages/PromptSettings.svelte`, `src/lib/UI/PromptDataItem.svelte`, `src/lib/Setting/botpreset.svelte`, `src/ts/storage/database.svelte.ts` (`botPreset`, import/export) | `packages/risu/src/{contracts,compiler,presets,preset-import}.ts`, `apps/web/src/player/{PromptPanel,preset-library}.ts` | 계약·UI 문법 의미 재현 | 프롬프트 순서·innerFormat·depth·range·프리셋 전환/보존을 우리 세션·저장소 계약으로 재구현 |

| 2026-07-12 | `src/lib/Setting/Pages/PersonaSettings.svelte`, `src/lib/Setting/Pages/listedPersona.svelte`, `src/ts/storage/database.svelte.ts` (`personas`, `selectedPersona`, `personaPrompt`) | `apps/web/src/player/{PersonaPanel,persona-library}.ts`, `packages/session/src/index.ts` | 데이터 계약·UX 문법 부분 재구현 | 전역 페르소나 보관함, 카드별 연결, 런타임 전환을 독립 저장소와 세션 API로 구현 |
| 2026-07-12 | `src/lib/SideBars/SideChatList.svelte`, `src/ts/storage/database.svelte.ts` (`firstMessage`, `alternateGreetings`) | `packages/risu/src/card-project.ts`, `packages/session/src/index.ts`, `apps/web/src/player/MessageList.svelte` | 동작 문법 부분 재구현 | 첫 인사를 실제 assistant 메시지로 시드하고 대체 인사를 첫 턴 전에만 전환 |
| 2026-07-12 | `src/ts/process/request/openAI/requests.ts`, `src/ts/process/request/anthropic.ts`, `src/ts/process/request/google.ts`, `src/ts/storage/database.svelte.ts` (generation parameters) | `packages/session/src/providers/`, `apps/web/src/player/PlayerPage.svelte` | 요청 계약 부분 재구현 | 제공자별 지원 파라미터만 전달하고 빈 값은 제공자 기본값으로 보존, maxContext 근사 예산 추가 |

`msgpackr` 1.11.5(MIT)는 Risu preset의 MessagePack 상호운용에 사용한다.

### Slice 7 — UX 패리티

| 날짜 | 원본 | 우리 구현 | 방식 | 범위 |
|---|---|---|---|---|
| 2026-07-12 | RisuAI `src/lib/Setting/Settings.svelte` | `apps/web/src/player/SettingsPanel.svelte` | 레이아웃·탐색 문법 재구현 | 좌측 전역 메뉴와 우측 모델·프롬프트·페르소나·기타 설정 화면 |
| 2026-07-12 | RisuAI `src/ts/parser/parser.svelte.ts`의 `ParseMarkdown`, 채팅 메시지 표시 문법 | `packages/ui/src/markdown.ts`, `apps/web/src/player/MessageList.svelte` | 안전 부분집합 독립 구현 | HTML 선 이스케이프, 마크다운 부분집합, 대사 강조, 표시층 매크로 치환, 인레이 이미지 |
| 2026-07-13 | RisuAI `src/ts/parser/parser.svelte.ts`의 `assetRegex`, `parseAdditionalAssets`, `getAssetSrc`, `getEmoSrc` | `packages/risu/src/asset-macros.ts`, `apps/web/src/player/display-macros.ts` | 안전 부분집합 의미 재현 | 확인된 에셋 문법 중 raw/img/image/asset/emotion만 표시하고, 프롬프트에는 이름만 전달; 실행·자동재생 계열은 원문과 경고로 보존 |
| 2026-07-14 | RisuAI `src/lib/Mobile/{MobileHeader,MobileBody,MobileCharacters}.svelte`, `src/ts/stores.svelte.ts`의 `MobileGUI`, `MobileSideBar` | `apps/web/src/player/{MobileShell,PlayerPage,SidePanel}.svelte` | 모바일 스택 탐색 문법 재구현 | 상단 앱바에서 채팅·전체화면 봇 목록·현재 봇 메뉴를 한 화면씩 전환하고, 데스크톱 사이드 패널을 모바일 전체화면에 재사용; safe-area 및 100dvh 셸 |
| 2026-07-12 | RisuAI `SideChatList.svelte`, 기본 채팅 화면의 중단·메시지 조작 UX | `apps/web/src/player/{InputBar,MessageList,SidePanel}.svelte`, `packages/session/src/index.ts` | 동작 문법 재구현 | 타이핑 표시, AbortSignal 중단, undo/redo, 엔진 영수증 밀도 |

아이콘의 기본 도형과 선 문법은 Lucide 아이콘 세트(ISC License)를 참고해 `packages/ui/src/icons/Icon.svelte`에
인라인 SVG로 재구성했다. 런타임 패키지 의존성은 추가하지 않았으며 ★는 럭키★시뮬레이터 고유 확정 도장이다.

### 명시적으로 가져오지 않은 것

- `hypav3.ts` 전체, Risu DB(`DBState`)·Svelte store·localForage 결합
- LLM 요약 호출 파이프라인(1차 벤치마크는 frozen summary 사용)
- `Math.random()` 기반 기억 선택(기본 경로에서 배제, seed 모드로만 재현)
- Risu UI 트리(`HypaV3Modal` 등)

### 2026-07-14 chat asset rendering parity

- RisuAI (GPL-3.0) `src/ts/parser/parser.svelte.ts` `ParseMarkdown`/`parseAdditionalAssets`: ported the asset resolution -> `editdisplay` -> second asset resolution order to `apps/web/src/player/display-macros.ts`. Reference commit: `64818472fe6491ad9e23533c54ffb16b6b90159c`.
- LogPapa (GPL-3.0-or-later) `core/convert/processImageTags.js` `getImagePatterns`/`processImageTags` and `web/risu-plugin/logpapa-push.js` `RE_EQ_USE`/`collectDisplayRules`/`embedImagesInPlace`: adapted legacy image forms and card/preset/module display-rule collection in `packages/risu/src/asset-macros.ts` and `packages/risu/src/card-regex.ts`. Reference local commit: `696b44b23c51678cbf255152440d0ae181a473ee`.
- Risu/LogPapa DOM access, global database bindings, plugin permissions, and arbitrary script execution were not imported. Existing bounded regex and HTML sanitization remain the security boundary.

## Voyage AI

- Phase C 배선 완료(실측 대기). `packages/memory/src/semantic.ts` — Voyage REST embeddings,
  input_type query/document, 입력 한도(inputs 1000·chunks 16000·tokens 120000), 429 bounded backoff, 캐시.
- 공식 문서 기준 `voyage-context-3`(Risu 재현 기준) / `voyage-context-4`(최신 대안). 실측 전 우열 단정 안 함.
- API 키는 코드·fixture·로그·리포트·세션 export에 기록하지 않음. `VOYAGE_API_KEY` + `--live-voyage` 이중 opt-in.

## 커뮤니티 플러그인 (개념 참고 — 코드 미복사)

원본 위치 `C:\freetalk\리스플러그인분석용`. 파일이 고도로 minify돼 있고 Risu 런타임(pluginStorage/DOM/전역)에
강결합돼 있어 **코드를 복사하지 않고 개념만 참조해 독립 재구현**했다. SHA-256은 원본 갱신 추적용.

| 원본 | 표시 버전 | SHA-256 | 참조한 개념 | 우리 구현(재구현) |
|---|---:|---|---|---|
| `LIBRA World Manager.js` | 5.3.1 | `81FCEB0F…C774D8` | evidence gate off/soft/strict, rollback row tombstone, embedding cache/queue | `packages/memory/src/abstention.ts`(gate), `planner.ts`(rollback 필터·budget/quota), `embedding-cache.ts` |
| `RisuAI Agent v5.3.1.js` | 5.3.1 | `F8117404…10EC6` | recency decay, embedding batch 아이디어 | `packages/memory/src/planner.ts` recency 가중, `semantic.ts` Voyage 배치/캐시 |

- Risu DB·pluginStorage·DOM·API 키 저장·직접 채팅 수정 코드는 가져오지 않음(금지선).
- `risu_agents.js`(1.1.9, `1E1D24D1…770CC`)·`multiagent-full-v0.8.4`(`E5A89828…EA7A4`)는 후속 에이전트 런타임 연구용으로만 기록, 이번 Phase C 미포함.

> 2026-07-13 감사: 위 독립 구현은 모노레포 전환 커밋 `03074d8`에서 삭제된 뒤 축소판만 남았고, 같은 날 현재 경로에 다시 이식했다. 표의 경로는 복구 후 실제 존재하는 파일만 가리킨다.

### Cupcake Provider Manager

- 소스: Cupcake Provider Manager(CPM) v1.35.11, RisuAI 커뮤니티 플러그인 `provider-manager-v1.35.11-프로덕션.js`.
- 라이선스: 원본 파일에 표기 없음.
- 이식 범위: 코드 복사 없이 공식 프로바이더 엔드포인트·인증 헤더·모델 카탈로그와 보조 모델 슬롯 개념을 확인해 `packages/session/src/providers/` 계약으로 독립 구현.
- 제외: CPM 자체 프록시·자동 업데이트·IPC·텔레메트리·RisuAI 플러그인 런타임/DOM/DatabaseSubset 의존부.
- GitHub Copilot 필수 헤더값(`Editor-Version: vscode/1.115.0`, `Editor-Plugin-Version: copilot-chat/0.43.2026040705`, `Copilot-Integration-Id: vscode-chat`, `X-Initiator: user`, `Openai-Intent: conversation-edits`)은 CPM이 실제로 전송하는 기본값과 동일하게 맞췄다. Copilot API가 에디터 신원 헤더를 요구하므로 임의값으로는 요청이 거부된다.
## Risu 런타임 전체 이식 (ADR 0004)

- 기준: RisuAI(GPL-3.0) commit `eb7780b`, 로컬 클론 `C:
isu`. 이식 파일은 업스트림 경로를 미러링해 diff 추적한다.
- `packages/risu/src/port/cbs.ts` ← `src/ts/cbs.ts` **통이식(무수정)** — 원본이 의존성 주입(CBSRegisterArg)으로 설계돼 import 교체만 했다. CBS 함수 170종.
- `packages/risu/src/port/parser.ts` ← `src/ts/parser/parser.svelte.ts`의 CBS 코어 발췌(matcher 배선·blockStartMatcher/blockEndMatcher(#if/#when/#each/#func)·risuChatParser 루프). DB·스토어·플랫폼 전역은 CbsPortEnv 브릿지.
- `packages/risu/src/port/infunctions.ts` ← `src/ts/process/infunctions.ts` 통이식(calcString 등). chatVar는 `chatvar-bridge.ts`로 치환.
- `packages/risu/src/port/triggers.ts` ← `src/ts/process/triggers.ts` **통이식** (트리거 v1 선언형 조건/효과 + v2 코드 효과). DB·스토어·UI 결합은 `trigger-env.ts`(TriggerPortEnv)로 치환. **위험 표면은 헤더에서 무해화**: LLM 호출(`requestChatData`)·이미지 생성(`generateAIImage`)·인레이 저장(`writeInlayImage`)·명령 매크로(`processMultiCommand`)·임베딩(`HypaProcesser`)·Lua(`runScripted`)는 안전 no-op — capability 게이트는 M-D에서 연다.
- `packages/risu/src/trigger-runtime.ts` — 우리 세션 경계 façade. 트리거의 `chat.scriptstate['$key']` ↔ 세션 `cbsVariables` 왕복 동기화. 업스트림 안전 계약 준수: display 모드는 `displayAllowList`의 v2 효과만 실행하고 v1 `setvar`는 차단(렌더가 상태를 바꾸지 못함), display의 변수 변경은 휘발성(`ephemeral`)으로만 반환.
- 유지한 우리 계약: 에셋 매크로는 값이 되지 않고 보존(오버라이드 훅), user/char/screenwidth 등 세션 컨텍스트 값, 미해석 `{{…}}` 소거, 모듈 네임스페이스 정규화 매칭.
- 폐기한 자체 계약: `#if`의 `:else`(업스트림은 #when 전용 — 테스트 갱신).
- `packages/risu/src/port/scripts.ts` ← `src/ts/process/scripts.ts`의 `processScriptFull` 전체 의미론(order/actions 메타, `@@emo`/`@@inject`/`@@move_top`/`@@move_bottom`/`@@repeat_back`, `$n`·끝 개행, 치환 후 CBS 재파싱). DB·Svelte 스토어·Lua·트리거·플러그인·dynamicAssets 결합은 `RisuScriptEnv` 훅으로 치환. 캐시(processScriptCache)는 세션 구조 차이로 미이식(후속 성능 항목).
- 우리 강화(스크립트 수·본문 길이·시간 예산, catastrophic 패턴 스킵, out 위험 태그 정화)는 이식 코드 밖 façade(`card-regex.ts`)에 유지.
- 치환 토큰 의미론을 업스트림 네이티브(`$&`·$```·`$'`·`$<name>`)로 전환 — 기존의 "토큰 문자 보존" 자체 계약은 폐기(테스트 갱신).
- `packages/risu/src/worker/lua.ts` — RisuAI `src/ts/process/scriptings.ts`의 `getChatVar`/`setChatVar` API 이름과
  호출 계약만 참고해 독립 구현했다. 업스트림의 네트워크·LLM·저장소·채팅 편집 API 구현은 복사하지 않고
  명시적 차단 목록으로만 둔다. Lua VM은 wasmoon 1.16.0(MIT, https://github.com/ceifa/wasmoon)을 사용한다.
  제품 배선은 비활성이고 테스트에서만 역량 플래그를 켠다.

## Risu 표시 파이프라인 이식

- `packages/risu/src/card-regex.ts`: LogPapa(GPL-3.0-or-later) `core/convert/cardRegex.js`의 `extractRegexScripts`, `sanitizeRegexOut`, `isCatastrophic`, `buildRegex`, `substituteGroups`, `expandCardRegex`를 TypeScript 계약과 4단계 훅으로 이식했다.
- `packages/risu/src/cbs.ts`: LogPapa(GPL-3.0-or-later) `core/risu/parser.js`의 `calcString`, `evalInline`, `expandBlocks`, `renderRisu`를 최소 CBS 범위로 이식했다. 이 구현의 원전은 RisuAI(GPL-3.0) `src/ts/parser/parser.svelte.ts`의 `assetRegex`, `parseAdditionalAssets`, `risuChatParser`/`matcher`다.
- RisuAI 호출 위치를 따라 `editinput`=사용자 입력, `editoutput`=모델 출력, `editprocess`=요청 전송 전, `editdisplay`=표시 직전으로 매핑했다. Lua와 임의 JavaScript 실행부는 이식하지 않았다.

## 대형 인형 목록 가상화

- 소스: [TanStack Virtual](https://github.com/TanStack/virtual), `@tanstack/svelte-virtual` 3.13.32.
- 라이선스: MIT.
- 적용: `apps/web/src/player/DollPicker.svelte`에서 50명을 넘는 인형 목록은 화면 주변 행만 DOM에 유지한다. 검색·병과·등급·정렬 결과가 바뀌면 Svelte 어댑터의 virtualizer 옵션을 갱신한다.
- 가져오지 않은 것: React/Vue/Solid 어댑터, 예제 UI, 서버 기능. 앱의 카드 마크업·접근성·초상화 지연 로딩은 자체 구현을 유지한다.
- 조사했지만 코드 이식하지 않은 항목: Immich의 점진 이미지 로딩은 계층 설계만 참고했고, Comlink·offthread-image·wa-sqlite는 현행 실측이 이미 합격해 의존성이나 코드를 추가하지 않았다.

## RisuAI iOS/iPadOS 파일 선택 호환

- 소스: [RisuAI](https://github.com/kwaroran/RisuAI) GPL-3.0, 기준 commit `80ad19ce99b78ffff13448304c33fabdeadaca1a`, `src/ts/util.ts`의 공용 파일 선택 관문과 `src/ts/platform.ts`의 iPadOS 데스크톱 위장 판별.
- 적용: `apps/web/src/player/file-picker-accept.ts`와 카드·에셋 모듈·프롬프트 프리셋·편집기 SimPack 입력. iPhone/iPad UA 또는 `MacIntel`+멀티터치를 Apple 터치 파일 선택기로 판별한다.
- 변경: 업스트림의 전역 DB 설정과 동적 `<input>` 생성은 이식하지 않았다. 웹 표준상 모호한 `accept='*'` 대신 iOS/iPadOS에서 `accept` 속성 자체를 생략하고, 선택된 원본 파일명과 바이트는 기존 Lucky 파서가 검증한다. 데스크톱·Android·진짜 Mac의 확장자 필터는 유지한다.
