# 시뮬봇 플랫폼 설계 기준

이 문서는 [ADR 0001](adr/0001-product-identity-and-platform-boundaries.md)의 결정을 구현 단계에서 해석하기 위한 살아 있는 설계 문서다. 제품 정체성이나 금지선을 변경하려면 먼저 새 ADR을 작성한다.

## 제품 루프

```text
카드 가져오기
  → 결정론 추출
  → AI 초안 제안
  → 출처·경고·차이 검수
  → 폼/블록 편집
  → 라이브 플레이테스트
  → SimPack 저장·공유
  → 플레이어 런타임
```

단순 대화 카드도 엔진 없이 즉시 플레이할 수 있어야 한다. 제작자는 이후 “시뮬 프로젝트로 승격”하여 상태, 규칙과 화면 초안을 추가할 수 있다.

## 목표 구조

```text
┌──────────────── Editor / Player Shell ────────────────┐
│ 카드·로어·프롬프트 │ 규칙 편집 │ 화면 편집 │ 플레이 │
└──────────────────────────┬─────────────────────────────┘
                           │ Project / SimPack
┌──────────────────────────▼─────────────────────────────┐
│ Declarative Screens                                      │
│ stage │ chat │ hud │ actions │ sidebar │ timeline      │
└──────────────────────────┬─────────────────────────────┘
                           │ selector view-models
┌──────────────────────────▼─────────────────────────────┐
│ Runtime Modules                                          │
│ stats │ relations │ inventory │ quests │ combat │ inn.* │
└──────────────────────────┬─────────────────────────────┘
                           │ commands / events
┌──────────────────────────▼─────────────────────────────┐
│ Deterministic Kernel                                     │
│ state │ RNG │ dispatch │ validation │ log/replay │ save │
└─────────────────────────────────────────────────────────┘
```

## 모듈 계약 초안

```js
registerModule({
  id: "combat.turnbased",
  version: "1.0.0",
  dependencies: ["core.stats", "core.inventory"],
  stateAccess: {
    owns: ["combat"],
    reads: ["player.*"],
    writes: ["player.*", "gold"]
  },
  initialState,
  events: {
    "combat/start": startEncounter,
    "combat/action": applyCombatAction
  },
  selectors: {
    "combat/hud": selectCombatHud,
    "combat/actions": selectAvailableCombatActions
  },
  processes,
  promptFacts,
  migrations
})
```

규칙:

- 이벤트와 selector는 namespace를 가진다.
- 모듈은 다른 모듈의 상태를 직접 변경하지 않는다.
- 전환 기간의 교차 변경은 `stateAccess.writes`에 실제 경로를 빠짐없이 선언하고, `owns`는 한 모듈만 가질 수 있다.
- 화면은 raw state가 아니라 selector view-model을 읽는다.
- 기존 이벤트 ID는 한동안 compatibility alias로 유지한다.
- 모듈 버전별 migration과 contract test를 필수로 둔다.
- Kernel은 모듈에 상태 복제본을 전달하고 실패·예외·계약 위반 시 상태와 RNG 위치를 함께 되돌린다.

## 화면 계약 초안

```json
{
  "id": "play",
  "layout": "chat-stage-sidebar",
  "regions": {
    "stage": [
      { "widget": "speaker-stage", "source": "scene/speakers", "props": { "max": 3 } }
    ],
    "hud": [
      { "widget": "stat-strip", "source": "player/summary" }
    ],
    "actions": [
      { "widget": "action-group", "source": "combat/actions" }
    ]
  }
}
```

초기 위젯 레지스트리는 `speaker-stage`, `chat`, `stat-strip`, `gauge`, `entity-card`, `action-group`, `decision-card`, `quest-board`, `inventory-grid`, `facility-grid`, `map-nodes`, `combat-hud`, `timeline` 정도로 제한한다.

현재 구현은 위 목록에 `table`, `slot-grid`, `detail-panel`, `calendar`, `crafting-queue`, `sidebar`를 더한 고정 레지스트리를 사용한다. 위젯은 raw 프로젝트 코드를 실행하지 않고 selector 결과와 정적 props만 받으며, 버튼은 엔진 event 관문을 그대로 통과한다.

조건 표현은 임의 JavaScript가 아닌 허용 목록 기반 AST를 사용한다. `and`, `or`, `not`, `eq`, `gte`, `add`, `mul`, `min`, `max`, `hasTag`와 허가된 selector 참조부터 시작한다. 숙박 배정이나 전투 계산처럼 복잡한 알고리즘은 코드 모듈에 두고 제작자는 숫자와 테이블을 편집한다.

## 편집기 정보 구조

초기 편집기는 다섯 영역을 제공한다.

1. **세계·프롬프트**: 시스템 프롬프트, 시작 장면, 로어북, 시간·장소 규칙
2. **캐릭터**: 성격·말투, 관계 수치, 역할, 감정·의상·배경 에셋
3. **상태**: 자원, 스탯, 플래그, 인벤토리, 시설과 초기값
4. **규칙**: 조건→사건→효과, 행동 노출 조건, 정기 process
5. **화면**: 레이아웃 프리셋, 위젯 배치, 데이터 연결, 데스크톱·모바일 미리보기

기본 모드는 폼·템플릿·안전한 블록을 제공하고, 고급 모드에서 JSON과 제한 표현식을 노출한다. AI가 자연어 지시를 규칙으로 바꿀 때는 적용 전 구조화된 diff를 보여준다.

## 컴파일러 출력 계약

각 값은 가능한 경우 다음 provenance를 가진다.

- `source`: 원문, Lua, 표준 카드 필드, 기본 합성, AI 추정, 사용자 수정
- `confidence`: 확실함, 검토 권장, 확인 필요
- `evidence`: 원본 위치 또는 규칙 식별자
- `updatedBy`: compiler, validator, user

검증기는 오류를 숨겨서 고치지 않는다. 안전한 기본값을 합성했더라도 무엇을 왜 합성했는지 편집기에서 확인할 수 있어야 한다.

## Card MRI 진단 계약

컴파일러는 카드를 곧바로 최종 엔진 스키마로 만들지 않는다. 먼저 결정론적 스캐너가 `card-diagnosis/0.1` 보고서를 만든다.

최소 필드:

```json
{
  "contract": "card-diagnosis/0.1",
  "card": { "name": "", "format": "charx", "spec": "chara_card_v3", "source": "" },
  "classification": "narrative-card|prose-sim|declarative-sim|script-assisted-sim|asset-pack",
  "content": { "loreEntries": 0, "loreChars": 0, "alternateGreetings": 0 },
  "runtime": {
    "embeddedModule": null,
    "luaChars": 0,
    "defaultVariableLines": 0,
    "featureFlags": [],
    "macros": [],
    "htmlChars": 0
  },
  "assets": { "count": 0, "media": {}, "naming": {} },
  "dependencies": { "sourceRefs": [], "additionalAssets": 0, "embeddedModules": [] },
  "capabilities": [],
  "suggestedModules": [],
  "compilerCoverage": { "totalEntries": 0, "includedEntries": 0, "omittedEntries": 0, "omitted": [] },
  "issues": []
}
```

규칙:

- 보고서는 LLM 호출 없이 재현 가능해야 한다.
- 내장 `module.risum`과 카드 표면의 스크립트를 함께 검사한다.
- 컴파일 입력 선택과 진단 보고서는 동일한 coverage 함수를 사용한다.
- `script-assisted-sim`은 자동 변환 완료를 뜻하지 않는다. 임의 Lua·HTML은 미지원 또는 변환 대상으로 명시한다.
- 기능 탐지는 초안이며, 근거가 된 로어 항목을 함께 보존한다.
- 제외된 항목, 충돌, 외부 의존성을 숨기지 않는다.

## SimPack v0.2 계약 방향

SimPack은 카드 원본과 엔진 스키마 사이의 제작·공유 단위다. 한 파일에 장르별 필드를 계속 추가하지 않고 다음 문서를 묶는다.

```text
SimPack
├─ manifest: id, title, version, engine range, permissions
├─ sources: 원본 카드·모듈·해시·라이선스
├─ content: characters, lore, locations, items, scenarios
├─ modules: id, version, config, migration
├─ initialState
├─ rules
├─ screens: routes, regions, widgets, navigation
├─ assets: packs, canonical entity mapping, variants
├─ options: 제작자가 노출한 기능 토글
├─ provenance: source, confidence, evidence, updatedBy
└─ unresolved: 충돌, 미지원 기능, 제작자 질문
```

SimPack v0.2의 실행 계약은 `schema/simpack.v0.2.json`, TypeScript 계약은 `packages/contracts`, 컨테이너·migration·무결성 구현은 `packages/simpack`이 소유한다. 편집기와 플레이어는 `packages/runtime`의 동일한 선택 결과를 소비한다. 장르별 폼은 이 공통 문서의 `content`, `runtime`, `screens`를 편집할 뿐 별도 저장 형식을 만들지 않는다.

## 필수 제작자 도구

- **규칙 설명기**: 버튼이 비활성인 이유와 충족하지 못한 조건 표시
- **이벤트 타임라인**: seed, 이벤트, 전후 상태 diff, 실패 코드 표시
- **replay**: 보고된 플레이 세션을 같은 결과로 재생
- **서사 진실 패널**: LLM에 전달된 실제 상태·선택지·NPC·수치 확인
- **경제 검사기**: 여러 날 자동 실행으로 무한 수익, 재고 고갈, 진행 정체 탐지
- **호환성 보고서**: 카드·로어·CBS·에셋별 지원·변환·저하·미지원 구분

## 점진적 마이그레이션

빅뱅 재작성은 하지 않는다.

1. 용사여관과 generic 전투 커널 상태·로그를 golden fixture로 고정한다. generic 전투 fixture를 Alternate Hunters V2 구현으로 간주하지 않는다.
2. 현재 이벤트와 selector 앞에 registry facade를 씌워 legacy module로 등록한다.
3. scales/pools/stats/inventory/combat부터 독립 모듈로 옮긴다.
4. quests/facilities/staffing을 옮기고, 마지막으로 inn.traffic/lodging/mail을 분리한다.
5. 기존 플레이 뷰 옆에 feature flag 기반 선언형 renderer를 추가한다.
6. Alternate Hunters V2 대표 루프를 선언형 화면으로 재현한다.
7. 그다음 용사여관 화면을 재현해 동등성을 검증한다.
8. 두 프로젝트가 통과한 뒤 편집기와 패키징을 연결한다.

각 단계는 기존 테스트와 저장 데이터를 보존한다. migration 없는 상태 구조 변경과, 새 장르를 위해 Kernel에 전용 분기를 추가하는 변경은 허용하지 않는다.

### 현재 도입 상태

- 2026-07-11: `ModuleRegistry`와 `legacy.monolith` facade를 도입했다.
- 모든 기존 이벤트는 동작을 바꾸지 않은 채 registry를 통해 기존 처리기로 전달된다.
- 앱의 엔진 콘솔은 지원 이벤트 목록을 registry에서 읽으므로 이벤트 목록의 이중 관리가 제거됐다.
- registry는 이벤트, selector, process의 소유권·중복·의존성을 검사한다.
- 2026-07-11: `core.stats`, `core.inventory`, `combat.turnbased`를 실제 독립 모듈로 추출했다.
  - `core.stats`: 관계 스케일·배율·평판·경험치와 tier selector
  - `core.inventory`: 자원 증감·아이템 사용·구매와 inventory selector
  - `combat.turnbased`: 전투 시작·행동·적 턴·종료와 combat action selector
- 세 모듈만 설치한 registry에서도 각 기능이 동작하며, 여관 기능은 설치되지 않는 contract test를 둔다.
- 의뢰의 조우 시작은 아직 `legacy.monolith`에서 전투 코어를 직접 호출하는 임시 호환 다리다. 의뢰 모듈을 추출할 때 registry event 계약으로 교체한다.
- 남은 `legacy.monolith`는 경영·숙박·직원·의뢰·하루 마감 기능을 소유한다.
- 2026-07-11 감사 보정:
  - registry가 상태 복제와 모듈 결과 검증을 강제한다. 실패·예외·계약 위반은 원본 상태를 보존한다.
  - 기본 RNG는 snapshot/restore를 제공하며 실패한 이벤트의 RNG 소비를 되돌린다.
  - 모듈별 `stateAccess.owns/reads/writes`를 기록하고 동일 경로의 중복 소유를 차단한다.
  - 전투 모듈의 `player.*`, `gold`, `pendingQuest.cleared` 직접 변경은 전환기 교차 쓰기로 명시한다. 의뢰·지갑 모듈 추출 시 결과 이벤트로 교체한다.
  - 용사여관과 generic 전투 커널 대표 이벤트 흐름을 전체 상태·로그 SHA-256 및 핵심 요약 golden fixture로 고정한다.
  - 화자 무대는 응답마다 교체되고, 무대·말풍선은 같은 canonical NPC 목록을 사용한다.

## 확장과 보안

확장을 한 종류의 `plugin`으로 뭉개지 않는다.

- Content pack: 데이터와 에셋만 포함
- Template: 모듈 조합과 기본 설정
- Runtime module: 버전이 지정된 코드 확장
- Theme / compatibility adapter: 외형과 외부 포맷 변환

초기 공개 편집기는 Content pack과 Template 조합만 허용한다. 코드 실행을 도입한다면 네트워크, 저장소, 프롬프트, 엔진 이벤트와 UI 접근을 capability로 분리하고 기본 거부한다. 임의 DOM 접근은 허용하지 않는다.

## 품질 게이트

새 장르를 지원했다는 말은 다음을 모두 만족할 때만 사용한다.

- 앱 소스 수정 없이 대표 게임 루프가 동작한다.
- 저장 후 다시 열어도 같은 모듈과 화면이 복원된다.
- 같은 seed와 이벤트 로그가 같은 결과를 만든다.
- 화면의 모든 행동이 엔진의 허용된 이벤트로 연결된다.
- 지원하지 않는 가져오기 필드가 조용히 사라지지 않는다.
- 플레이어가 보는 서사와 엔진의 실제 상태가 모순되지 않는다.
