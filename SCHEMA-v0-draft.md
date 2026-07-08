# 표준 게임 스키마 v0 — 초안 (용사여관 수동 스키마화 실험)

> 2026-07-08 지휘자 작성. M1 관문 실험: "용사여관 룰북을 손으로 스키마화할 수 있는가?" — **결론: 가능. 카드의 시스템 전체가 6개 반복 패턴으로 환원된다.**
> 이 문서는 사용자 검수용 초안이다. §5 미해결 질문에 답이 정해지면 v0 확정 → 엔진 v0 스펙(Codex 지시서)으로 넘어간다.

---

## 1. 용사여관 룰북 해부 결과 (실측)

로어북 63개 중 게임 룰을 담은 것은 [변수계산] 16개 + 정산 관련 [용사여관] 항목들. 상시활성 14개 ≈ 16k 토큰이 매 턴 프롬프트에 실린다. 룰의 실체는:

**상태 변수 (원본은 Lua 변수 + LLM 태그로 갱신):**
- 플레이어: level/exp, HP(=VIT×10)/MP(=INT×10), CHA(0~100+), player_pop(0~200), gold
- 여관: lv_tavern/lv_kitchen/lv_forge/lv_room (1~4), inv_food/inv_drink/inv_material(수량), inv_equip(이름 목록), staff_count/max, 객실 11개(호수·타입·단가·점유)
- 평판 6축: rep_village/advent/mage/noble/under/merchant — 각각 EXP + E~S 랭크 (승급 문턱 100/300/800/2,000/5,000, 승급 시 EXP 리셋, 음수면 강등)
- NPC별: affinity(0~200, 기본 50)/lewd(0~200)/pop(0~200)/sex(횟수)
- 포로 슬롯 4개: {id, 이름, 클래스, 랭크, obedience(0~200), lewd, pop, sex}

**이벤트 태그 어휘 (소문자 ysp_* = 상태 델타 / 대문자 YSP_* = 표시·요약 전용):**
`ysp_exp` `ysp_hp` `ysp_mp` `ysp_gold` `ysp_rep_축` `ysp_affinity` `ysp_lewd` `ysp_pop` `ysp_sex` `ysp_player_pop` `ysp_food` `ysp_drink` `ysp_material` `ysp_equip_add/remove` `ysp_hire/fire` `ysp_capture/release` `ysp_captive_스탯` `ysp_checkin/checkout` `ysp_sale` / `YSP_DUNGEON_ENTER/CLEAR/FAIL` `YSP_QUEST_CLEAR` `YSP_SETTLE_START/END`

**원본 구조의 본질**: "계산기는 있는데 계산은 LLM이 한다" — 룰북 산문이 LLM에게 수치 판단(정산 견적, 노예 가격 공식, 평판 델타 범위)을 시키고, Lua는 태그를 파싱해 기록만 한다. 우리 엔진은 이 방향을 뒤집는다: **엔진이 계산하고, LLM은 서사와 '무슨 일이 일어났는가'의 판정만 한다.**

## 2. 발견된 반복 패턴 6개 → 스키마 기본 요소

| # | 패턴 | 용사여관 사례 | 스키마 요소 |
|---|---|---|---|
| P1 | **티어 스케일**: 0~200 유계 수치 + 구간별 행동 밴드(서술 + 금지행동 + 최소문턱) | affinity, lewd, pop, obedience, player CHA/pop — 전부 동일 구조 | `scales` |
| P2 | **랭크 사다리**: EXP 누적 → 문턱 승급, 리셋·강등 규칙 | 플레이어 레벨, 평판 6축, 던전/의뢰/장비 등급 E~S | `ladders` |
| P3 | **델타 이벤트**: 고정 스텝 값(+1/+2/+3/+5, -2/-5/-10/-50) + 사유 문자열 + 일일 상한 | 모든 ysp_* 태그 | `events` |
| P4 | **레벨 게이트**: 시설 레벨이 콘텐츠 개방·용량을 결정 | lv_tavern→의뢰 종류/등급, lv_forge→제작 등급, 포로 슬롯 수, 객실 잠금 | `gates` (actions/entities의 조건) |
| P5 | **체크리스트 액션**: 순서 있는 전제조건 → 통과 시에만 효과 발생 | 고용 H1~H4, 포획 C1~C4, 관계 Q1~Q3, 방배정 룰 | `actions` |
| P6 | **정기 프로세스**: 시간 경과 트리거 → 공식 기반 일괄 계산 | 일일 정산(시설Lv·직원·평판 기반 매출 견적), 일급 자동 차감, 체크아웃 도래 | `processes` + `formulas` |

이 6개면 용사여관의 룰 전부가 표현된다. 카드 고유 명사(메뉴, 객실, NPC)는 전부 `entities` 인스턴스 데이터로 내려간다 — **스키마 구조 자체는 카드 비종속** (BACKLOG §2 장기 비전 제약 충족).

## 3. 스키마 v0 구조 정의

```jsonc
{
  "meta": { "id": "yongsa-inn", "title": "용사여관", "schemaVersion": "0.1" },

  "resources": [   // 소모성 수치 자원
    { "id": "gold", "unit": "원", "min": 0 },
    { "id": "food", "unit": "인분", "min": 0, "basePrice": 3000 },
    { "id": "drink", "unit": "잔", "min": 0, "basePrice": 5000 },
    { "id": "material", "unit": "개", "min": 0, "basePrice": 5000 }
  ],

  "scales": [      // P1: 유계 수치 + 티어 밴드
    {
      "id": "affinity", "owner": "npc", "range": [0, 200], "default": 50,
      "steps": { "up": [1, 2, 3, 5], "down": [-2, -5, -10, -50] }, "dailyCap": 1,
      "tiers": [
        { "range": [0, 20], "label": "증오", "brief": "적대·방해 가능", "forbidden": ["우호 행동", "협조"] },
        { "range": [51, 80], "label": "중립", "brief": "계산적 관계", "forbidden": ["고백", "신체 접촉", "감정 표현"] },
        { "range": [111, 150], "label": "신뢰", "brief": "비밀 공유, 위험 의뢰 수락" }
        // ... 원본 9티어 전부 이 형태로
      ],
      "actionMinimums": { "고백": 151, "신체 접촉": 151, "적극적 친밀": 170 }
    }
    // lewd, pop(npc), obedience(captive), player_cha, player_pop — 동일 구조
  ],

  "ladders": [     // P2: 랭크 사다리
    {
      "id": "player_level", "currency": "exp",
      "sources": { "잡일": 1, "메뉴 개발": [5, 10], "C급 클리어": [30, 60] }  // 엔진이 지급 판정
    },
    {
      "id": "reputation", "axes": ["village", "advent", "mage", "noble", "under", "merchant"],
      "ranks": [ { "id": "E", "next": 100 }, { "id": "D", "next": 300 }, { "id": "C", "next": 800 },
                 { "id": "B", "next": 2000 }, { "id": "A", "next": 5000 }, { "id": "S" } ],
      "onPromote": "reset", "onNegative": "demote", "floor": "E"
    }
  ],

  "entities": [    // 카드 고유 데이터는 전부 여기 (인스턴스 = 임포트 시 추출)
    { "type": "npc", "fields": ["id", "name", "class", "rank", "spriteSet", "scaleValues"],
      "instances": [ { "id": "silvia", "name": "실비아", "class": "레인저", "rank": "D" } /* ...27명 */ ] },
    { "type": "room", "fields": ["no", "kind", "pricePerNight", "capacity", "requiresLevel"],
      "instances": [ { "no": 101, "kind": "다인실", "pricePerNight": 30000, "capacity": null } /* ...11실 */ ] },
    { "type": "menuItem", "fields": ["name", "category", "price", "consumes"],
      "instances": [ { "name": "고기 스튜", "category": "요리", "price": 10000, "consumes": { "food": 1 } } ] },
    { "type": "facility", "instances": [ { "id": "tavern", "level": 1, "max": 4 }, { "id": "forge", "level": 1, "max": 4 } ] }
  ],

  "actions": [     // P5: 체크리스트 전제 → 효과. gate는 P4.
    {
      "id": "hire_staff",
      "preconditions": ["user_proposed", "wage_agreed", "staff_count < staff_max"],
      "effects": [ { "event": "staff_add", "params": ["npcId", "wage"] } ]
    },
    {
      "id": "accept_quest",
      "gate": { "facility": "tavern", "byLevel": { "1": [], "2": ["dungeon", "subjugation", "escort", "rescue", "gather", "info"],
                "3": ["+broker", "+smuggle", "+vice"], "4": ["+slave", "+assassination"] } },
      "rankGate": { "2": "E~D", "3": "E~B", "4": "E~A+" }
    },
    {
      "id": "craft",
      "gate": { "facility": "forge", "byLevel": { "1": "E~D", "2": "~C", "3": "~B", "4": "~S" } },
      "cost": { "byGrade": { "E": 2, "D": 5, "C": 15, "B": 25, "A": 50, "S": 100 }, "resource": "material",
                "repairFactor": 0.33, "reinforceFactor": 0.5 }
    }
    // checkin/checkout, capture/release, cook, purchase, dungeon_run ...
  ],

  "formulas": [    // P6: 엔진이 계산하는 공식 (원본은 LLM에게 시켰던 것)
    { "id": "hp_max", "expr": "vit * 10" },
    { "id": "mp_max", "expr": "int * 10" },
    { "id": "captive_price", "expr": "base(rank) * obedienceMult(obedience) * (1 + bonuses)" },
    { "id": "daily_revenue", "expr": "customers(lv_tavern, staffPop, rep, events) -> sum(menu.price * qty)",
      "baseline": { "1": { "cap": 15, "customers": [8, 15] }, "2": { "cap": 30, "customers": [15, 30] },
                    "3": { "cap": 50, "customers": [25, 50] }, "4": { "cap": 80, "customers": [40, 80] } } }
  ],

  "processes": [   // P6: 시간 트리거
    { "trigger": "dayEnd", "steps": ["settle_revenue", "deduct_wages", "consume_stock", "checkout_due"] }
  ],

  "events": [      // P3: LLM→엔진 인터페이스. LLM은 "무슨 일이 있었나"만 보고, 수치는 엔진이 결정.
    { "id": "exp_gain", "params": { "category": "enum(잡일|이벤트|클리어...)", "reason": "string" } },
    { "id": "scale_delta", "params": { "scale": "affinity|lewd|...", "target": "npcId", "size": "S|M|L|XL", "direction": "+|-", "reason": "string" } }
    // 원본과 결정적 차이: LLM이 ±N 숫자를 정하지 않는다. 크기 분류(S/M/L/XL)만 하면 엔진이 스텝 값을 적용.
  ]
}
```

## 4. 엔진/LLM 경계 (B안 원칙의 구체화)

| | 원본 (용사여관 + Lua) | 우리 엔진 v0 |
|---|---|---|
| 수치 계산 | LLM (룰북 산문 읽고 암산) | **엔진** (formulas) |
| 상태 저장 | Lua 변수 (LLM 태그 파싱) | **엔진** (스키마 상태) |
| 발동 판정 | LLM (룰북 전체 상시 주입) | **엔진** (actions 전제조건 체크) |
| 사건 판정 | LLM | LLM — 단, **분류만** (events: 무슨 카테고리, 어느 크기) |
| 서사 | LLM | LLM (장면 + 발동 로어북 + 상태 요약 몇 줄만 주입) |
| 티어 행동 규범 | 상시 로어북 5개 ≈ 6k 토큰 | **현재 티어의 밴드 1개만** 주입 (예: "실비아: 신뢰(111~150) — 금지: 고백, 신체접촉") |

토큰 효과 추정: 상시 16k → 상태 요약 + 현재 티어 밴드 + 발동 로어북 ≈ 2~4k. BACKLOG §1의 목표치와 일치.

## 5. 미해결 질문 (사용자 결정 필요)

1. **크기 분류 방식**: LLM이 `±N`을 직접 뱉는 원본 방식 vs 크기(S/M/L/XL)만 분류하고 엔진이 수치화 (§3 events 제안). 후자가 수치 붕괴에 강하지만 원본 카드의 손맛과 달라질 수 있음.
2. **성인 요소 스케일**(lewd/obedience/sex)의 v0 포함 여부: 구조상 affinity와 동일해서 비용은 없음. 포함하되 카드에 없으면 비활성? *(스키마는 중립, 인스턴스가 결정하는 쪽을 추천)*
3. **v0 범위**: 위 전부 vs 최소 코어(gold/식자재/정산/평판/affinity + 방배정)부터. M1 정의("스탯·호감도·골드·시간")대로면 **최소 코어 + 시간(dayEnd)** 추천. 던전·포로·대장간은 M3 모듈로.
4. **랜덤성**: 원본은 LLM 재량(고객 수 8~15명 등). 엔진 v0에서 시드 있는 RNG로 결정론화? *(골든 테스트 가능해지므로 추천)*
5. **엔티티 추출의 자동화 수준**: NPC 27명·객실 11개·메뉴 목록을 M2 임포트 컴파일러 전까지는 손으로 인스턴스 JSON 작성 (용사여관 1장 한정). 이 실험을 여기서 계속할지.

## 6. 다음 단계 (검수 통과 시)

1. §5 답 반영 → SCHEMA-v0 확정판
2. 용사여관 최소 코어 인스턴스 JSON 수작업 완성 (실험 완료 판정)
3. 엔진 v0 스펙 작성 → Codex 지시서 (순수 코어: `applyEvent(state, event) -> state'`, UI 없이 골든 테스트 먼저 — Pro2 방법론)
4. M0 앱에 "엔진" 탭 추가는 엔진 코어 검증 후
