import type { ParsedCard } from "@simbot/card";
import { screenPresetsFor } from "@simbot/modules";
import { extractRegexScripts } from "@simbot/risu";
import { buildCompilerPrompt } from "./compiler-prompt.ts";
import { diagnoseCard } from "./diagnosis.ts";
import { mineCard } from "./lua-mine.ts";
import { extractTextPanels } from "./text-panels.ts";
import type { CompileResult } from "./index.ts";

type Row = Record<string, unknown>;
export const GFL_TEMPLATE_VERSION = "1.6.0";
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const table = (value: unknown) => record(value);
const number = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value: unknown) =>
  typeof value === "string" ? value : String(value ?? "");
const id = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "") || "entry";
function reward(value: unknown) {
  const source = text(value),
    out: Row = {};
  for (const [label, key] of [
    ["자금", "gold"],
    ["자원", "res"],
    ["부품", "parts"],
    ["코어", "cores"],
  ] as const) {
    const match = new RegExp(`${label}\\s*\\+?\\s*([\\d,]+)`).exec(source);
    if (match) out[key] = Number(match[1]!.replace(/,/g, ""));
  }
  return Object.keys(out).length ? out : { gold: 300, parts: 100 };
}
function gflSignature(parsed: ParsedCard, mined: ReturnType<typeof mineCard>) {
  const source = JSON.stringify(parsed.card),
    tables = mined.tables;
  return (
    /소녀전선|girls.?frontline/i.test(source) &&
    Object.keys(table(tables.DOLL_CLASS)).length >= 20 &&
    Object.keys(table(tables.MISSION_DATA)).length >= 3 &&
    mined.luaSize > 10_000
  );
}
// 인형 실능력치는 카드 defaultVariables의 '<이름>a=["최대HP","최대MP","전투력",?,"기분","성격"]' 줄에 실린다
// (원본 Lua가 획득 시 t[1]·t[2]·t[3]·t[5]를 읽는 계약 — 실측: M4A1a=["1500","1600","1250","-5","90",…]).
// 수치를 발명하지 않는다: 카드에 있으면 그 값을, 없으면 원본 Lua 자신의 폴백(1000/1000/500/50)을 쓴다.
function dollStatLines(parsed: ParsedCard) {
  const data = record(record(parsed.card).data ?? parsed.card),
    risu = record(record(data.extensions).risuai),
    source = text(risu.defaultVariables);
  const out = new Map<string, string[]>();
  for (const line of source.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim(),
      value = line.slice(eq + 1).trim();
    if (!key.endsWith("a") || !value.startsWith("[")) continue;
    try {
      const parsedValue = JSON.parse(value);
      if (Array.isArray(parsedValue))
        out.set(key.slice(0, -1), parsedValue.map(text));
    } catch {
      /* 배열이 아니면 인형 스탯 줄이 아니다 */
    }
  }
  return out;
}
function dollContractLines(parsed: ParsedCard) {
  const data = record(record(parsed.card).data ?? parsed.card),
    risu = record(record(data.extensions).risuai),
    source = text(risu.defaultVariables);
  const out = new Map<string, string[]>();
  for (const line of source.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim(),
      value = line.slice(eq + 1).trim();
    if (!key.endsWith("d") || !value.startsWith("[")) continue;
    try {
      const parsedValue = JSON.parse(value);
      if (Array.isArray(parsedValue))
        out.set(key.slice(0, -1), parsedValue.map(text));
    } catch {
      /* 배열이 아니면 고용 정보 줄이 아니다 */
    }
  }
  return out;
}
const DOLL_FALLBACK = { maxHp: 1000, maxMp: 1000, power: 500, mood: 50 };
function dollRows(parsed: ParsedCard, mined: ReturnType<typeof mineCard>) {
  const classes = table(mined.tables.DOLL_CLASS),
    grades = table(mined.tables.DOLL_GRADE),
    stats = dollStatLines(parsed),
    contracts = dollContractLines(parsed);
  let recovered = 0, normalizedMg3 = 0;
  const rows = Object.entries(classes).map(([name, value]) => {
    const grade = Math.max(1, Math.min(6, number(grades[name], 3))),
      row = stats.get(name),
      contract = contracts.get(name);
    if (row) recovered += 1;
    const rawClass = text(value || "AR"), className = rawClass === "MG3" ? "MG" : rawClass;
    if (rawClass === "MG3") normalizedMg3 += 1;
    return {
      id: id(name),
      name,
      class: className,
      grade,
      maxHp: number(row?.[0], DOLL_FALLBACK.maxHp),
      maxMp: number(row?.[1], DOLL_FALLBACK.maxMp),
      power: number(row?.[2], DOLL_FALLBACK.power),
      mood: number(row?.[4], DOLL_FALLBACK.mood),
      price: number(contract?.[0], 5000),
      description: text(contract?.[1]),
      asset: name,
    };
  });
  return { rows, recovered, normalizedMg3, unknownClasses: [...new Set(rows.map((row) => row.class).filter((value) => !["AR","SMG","RF","HG","MG","SG"].includes(value)))] };
}
function itemRows(mined: ReturnType<typeof mineCard>) {
  return Object.entries(table(mined.tables.ITEM_DATA)).map(([name, value]) => {
    const row = record(value);
    const grade = number(row.price) + number(row.power) * 3;
    const drop = Number.isFinite(Number(row.drop))
      ? number(row.drop)
      : grade >= 8000 ? 3 : grade >= 3000 ? 10 : grade >= 1000 ? 30 : grade >= 300 ? 60 : 85;
    return {
      id: id(name),
      name,
      price: number(row.price),
      type: text(row.type),
      description: text(row.desc),
      effect: record(row.effect),
      drop,
      asset: name,
    };
  });
}
function documentRows(mined: ReturnType<typeof mineCard>) {
  return (Array.isArray(mined.tables.DOC_DATA) ? mined.tables.DOC_DATA : []).map((value) => {
    const row = record(value);
    return { id: text(row.id), year: text(row.year), code: text(row.code), title: text(row.title), body: text(row.body) };
  });
}
function kalinaShop(mined: ReturnType<typeof mineCard>, catalog: Array<{ id: string; name: string; price: number }>) {
  const rows = (Array.isArray(mined.tables.KALINA_SHOP_ITEMS) ? mined.tables.KALINA_SHOP_ITEMS : []).map(record),
    byName = new Map(catalog.map((item) => [item.name, item])),
    missingRows = rows.filter((row) => !byName.has(text(row.id))),
    mismatches = rows.flatMap((row) => {
      const item = byName.get(text(row.id));
      return item && number(row.price) !== item.price ? [{ name: text(row.id), itemPrice: item.price, shopPrice: number(row.price) }] : [];
    });
  return {
    added: missingRows.map((row) => ({ id: id(text(row.id)), name: text(row.id), price: number(row.price), type: "use", description: text(row.desc), effect: {}, drop: 0, asset: text(row.id) })),
    comparison: { source: rows.length, matched: rows.length - missingRows.length, missing: missingRows.map((row) => text(row.id)), priceMismatches: mismatches },
  };
}

function progression(mined: ReturnType<typeof mineCard>) {
  const byStar = Object.fromEntries(
    Object.entries(table(mined.tables.PROG_BY_STAR)).map(([key, value]) => [key, number(value)]),
  );
  const missionTypes = (Array.isArray(mined.tables.MISSION_TYPES) ? mined.tables.MISSION_TYPES : [])
    .map((value) => record(value))
    .map((value) => ({
      key: text(value.key),
      name: text(value.name),
      stepMod: number(value.step_mod),
      hint: text(value.hint),
    }));
  const eventGuides = Object.fromEntries(
    Object.entries(table(mined.tables.EV_GUIDE)).map(([key, value]) => [key, text(value)]),
  );
  return { byStar, missionTypes, eventGuides };
}
function encounters(mined: ReturnType<typeof mineCard>, dolls: Array<{ id: string; name: string }>) {
  const byName = new Map(dolls.map((doll) => [doll.name, doll.id])),
    poolNames = (Array.isArray(mined.tables.ENCOUNTER_POOL) ? mined.tables.ENCOUNTER_POOL : []).map(text),
    rawBan = mined.tables.ENCOUNTER_BAN,
    banNames = Array.isArray(rawBan)
      ? rawBan.map(text)
      : Object.entries(table(rawBan)).filter(([, value]) => Boolean(value)).map(([name]) => name),
    missing = [...new Set([...poolNames, ...banNames].filter((name) => !byName.has(name)))];
  return {
    value: {
      pool: poolNames.flatMap((name) => byName.has(name) ? [byName.get(name)!] : []),
      ban: banNames.flatMap((name) => byName.has(name) ? [byName.get(name)!] : []),
    },
    missing,
  };
}
function namedPool(raw: unknown, rows: Array<{ id: string; name: string }>) {
  const byName = new Map(rows.map((row) => [row.name, row.id])),
    names = (Array.isArray(raw) ? raw : []).map(text),
    missing = [...new Set(names.filter((name) => !byName.has(name)))];
  return { ids: names.flatMap((name) => byName.has(name) ? [byName.get(name)!] : []), missing };
}
function bossRows(parsed: ParsedCard, mined: ReturnType<typeof mineCard>) {
  const names = (Array.isArray(mined.tables.BOSS_LIST) ? mined.tables.BOSS_LIST : []).map(text),
    stats = dollStatLines(parsed), rawNoRecruit = mined.tables.NO_RECRUIT_BOSSES,
    noRecruitNames = Array.isArray(rawNoRecruit) ? rawNoRecruit.map(text) : Object.keys(table(rawNoRecruit)),
    missingStats: string[] = [];
  const rows = names.map((name) => {
    const row = stats.get(name);
    if (!row) missingStats.push(name);
    return {
      id: id(name), name, class: "BOSS", grade: 6,
      maxHp: number(row?.[0], DOLL_FALLBACK.maxHp), maxMp: number(row?.[1], DOLL_FALLBACK.maxMp),
      power: number(row?.[2], DOLL_FALLBACK.power), mood: number(row?.[4], DOLL_FALLBACK.mood), asset: name,
    };
  });
  const noRecruit = namedPool(noRecruitNames, rows);
  return { rows, noRecruit: noRecruit.ids, missing: [...new Set([...missingStats, ...noRecruit.missing])] };
}
function classList(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .flatMap((entry) => text(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function equipmentRows(mined: ReturnType<typeof mineCard>) {
  return Object.entries(table(mined.tables.EQUIP_DATA)).map(([name, value]) => {
    const row = record(value);
    return {
      id: id(name),
      name,
      price: number(row.price),
      hp: number(row.hp),
      power: number(row.power),
      description: text(row.desc),
      effect: text(row.etc),
      ban: classList(row.ban),
      only: classList(row.only),
      asset: name,
    };
  });
}
function missionTheater(key: string) {
  if (/^W/.test(key)) return "east-europe";
  if (/^(?:S\d+A|TAURUSA|SATALA|S07A|HADLA)$/.test(key)) return "east-china";
  return "red-orange";
}
function missionRows(mined: ReturnType<typeof mineCard>) {
  const east = table(mined.tables.EAST_FRONT_MISSIONS);
  return Object.entries(table(mined.tables.MISSION_DATA)).map(
    ([key, value]) => {
      const row = record(value), isEast = Boolean(east[key]), enemy = text(row.enemy), factions: string[] = [];
      for (const match of enemy.matchAll(/철혈|바랴그단|패러데우스|E\.?L\.?I\.?D|감염체/g)) {
        const faction = /E\.?L\.?I\.?D|감염체/.test(match[0]) ? "E.L.I.D" : match[0];
        if (!factions.includes(faction)) factions.push(faction);
      }
      const boss = text(row.boss).trim();
      const difficulty = text(row.diff);
      return {
        id: id(key),
        code: key,
        name: text(row.name || key),
        theater: missionTheater(key),
        difficulty,
        stars: (difficulty.match(/★/g) ?? []).length,
        enemy,
        factions,
        ...(boss ? { boss } : {}),
        power: number(row.power, 800),
        description: text(row.desc),
        rewards: reward(row.reward),
        rank: "E",
        east: isEast,
        travelCost: isEast ? 500 : 0,
      };
    },
  );
}
function facilities(mined: ReturnType<typeof mineCard>) {
  const effects = table(mined.tables.base_ab_data),
    costs = table(mined.tables.base_defaults),
    labels = ["훈련 시설", "방위 시설", "정비 시설", "보급소", "인형 숙소"];
  return Array.from({ length: 5 }, (_, index) => {
    const key = `base${index + 1}`,
      cost = record(costs[key]);
    return {
      id: key,
      name: labels[index],
      maxLevel: 5,
      cost: { gold: number(cost.gold, 4000), res: number(cost.res, 2000) },
      costMultiplier: 1.5,
      effects: Array.isArray(effects[key]) ? effects[key] : [],
    };
  });
}
function gflSchema(parsed: ParsedCard, mined: ReturnType<typeof mineCard>) {
  const { rows: dolls, recovered, normalizedMg3, unknownClasses } = dollRows(parsed, mined),
    baseItems = itemRows(mined), kalina = kalinaShop(mined, baseItems), items = [...baseItems, ...kalina.added],
    equipment = equipmentRows(mined),
    missions = missionRows(mined),
    defaults = mined.defaultVars.numbers,
    encounterData = encounters(mined, dolls), bossData = bossRows(parsed, mined),
    normalEquipment = namedPool(mined.tables.MFG_EQ_POOL_NORMAL, equipment),
    heavyEquipment = namedPool(mined.tables.MFG_EQ_POOL_HEAVY, equipment);
  return {
    recovered, normalizedMg3, unknownClasses, encounterMissing: encounterData.missing,
    bossMissing: bossData.missing,
    manufacturingMissing: [...new Set([...normalEquipment.missing, ...heavyEquipment.missing])],
    schema: {
      meta: {
        id: "girls-frontline-ember",
        title: parsed.name,
        template: "genre.gfl",
        templateVersion: GFL_TEMPLATE_VERSION,
      },
      resources: [
        { id: "res", label: "자원", basePrice: 1 },
        { id: "parts", label: "부품", basePrice: 10 },
        { id: "cores", label: "코어", basePrice: 2000 },
      ],
      gather: { small: [20, 50], medium: [50, 100], large: [100, 200] },
      entities: [
        {
          type: "npc",
          instances: dolls.map((value) => ({
            id: value.id,
            name: value.name,
            class: value.class,
            grade: value.grade,
            asset: value.asset,
          })),
        },
      ],
      locations: [
        { id: "base-hall", name: "복도" },
        { id: "base-command", name: "지휘관실" },
        { id: "base-operation", name: "작전실" },
        { id: "base-maintenance", name: "정비실" },
        { id: "base-training", name: "훈련장" },
        { id: "base-warehouse", name: "물자창고" },
        { id: "base-dormitory", name: "인형숙소" },
        { id: "base-cafeteria", name: "카페테리아" },
        { id: "base-outside", name: "기지 외부" },
      ].map((location) => ({
        ...location,
        links:
          location.id === "base-outside"
            ? ["base-hall"]
            : [
                "base-hall",
                "base-command",
                "base-operation",
                "base-maintenance",
                "base-training",
                "base-warehouse",
                "base-dormitory",
                "base-cafeteria",
                "base-outside",
              ].filter((id) => id !== location.id),
      })),
      party: {
        maxSize: 5,
        roles: ["slot1", "slot2", "slot3", "slot4", "slot5"],
      },
      time: { startHour: 8, hoursPerStep: 4 },
      combat: {
        d: 20,
        minDamage: 1,
        critMult: 2,
        guardMult: 0.5,
        fleeRate: 45,
        heavyRate: 30,
        heavyMult: 1.5,
        heavyAcc: -2,
        defeatReviveRatio: 0.2,
        expTable: { default: [10, 20], E: [10, 20], D: [20, 40] },
        lootGold: { default: [50, 100], E: [50, 100], D: [100, 200] },
      },
      skills: {
        focused_fire: {
          name: "집중 사격",
          pool: "mp",
          cost: 100,
          power: 20,
          acc: 3,
        },
      },
      jobs: [],
      equipment,
      items,
      gfl: {
        dolls,
        items,
        equipment,
        missions,
        theaters: [
          {
            id: "red-orange",
            name: "레드·오렌지 작전구역",
            description: "S09 주변과 철혈·바랴그단 전선",
          },
          {
            id: "east-europe",
            name: "동유럽 전선",
            description: "패러데우스 점령 구역",
          },
          {
            id: "east-china",
            name: "화동 전선",
            description: "북란도와 E.L.I.D 감염 구역",
          },
        ],
        facilities: facilities(mined),
        hire: {
          dailySlots: 5,
          snipePremium: 3000,
          capacity: [4, 8, 12, 16, 20],
          arrivalSteps: 1,
        },
        timePhases: ["오전", "오후", "저녁", "밤", "심야", "새벽"],
        progression: progression(mined),
        encounters: encounterData.value,
        documents: documentRows(mined),
        kalinaComparison: kalina.comparison,
        bosses: bossData.rows,
        noRecruit: bossData.noRecruit,
        relation: {
          names: table(mined.tables).REL_NAMES ?? mined.tables.REL_NAMES,
          thresholds: mined.tables.REL_THRES,
          descriptions: mined.tables.REL_TI,
        },
        modPower: [1, 2, 3].map((stage) =>
          number(
            table(mined.tables.MOD_POWER)[stage],
            [500, 600, 1000][stage - 1]!,
          ),
        ),
        commanderFunds: 10_000,
        manufacturing: {
          doll: { gold: 500, res: 300 },
          equipment: { gold: 300, res: 200 },
          heavy: { gold: 1500, res: 1000, cores: 1 },
          pools: { equipment: normalEquipment.ids, heavy: heavyEquipment.ids },
        },
        fairies: Object.entries(table(mined.tables.FAIRY_DATA)).map(
          ([name, value]) => ({ id: id(name), name, ...record(value) }),
        ),
      },
      initialState: {
        day: number(defaults.A_day, 1),
        gold: number(defaults.A_gold, 5000),
        resources: { res: number(defaults.A_res, 3000), parts: 5, cores: 3 },
        items: {},
        player: {
          level: 1,
          exp: 0,
          pools: { hp: { cur: 1000, max: 1000 }, mp: { cur: 1000, max: 1000 } },
          atk: 20,
          def: 5,
          acc: 5,
          evade: 10,
        },
        clock: {
          day: number(defaults.A_day, 1),
          hour: 8,
          turn: 0,
          phase: "오전",
        },
        location: "base-command",
        party: { members: [], formation: {} },
        jobs: [],
        gfl: {
          started: false,
          mode: null,
          baseLocation: "base-command",
          currentLocationName: "지휘관실",
          dolls: {},
          echelons: [
            {
              id: "echelon-1",
              name: "제1제대",
              slots: [null, null, null, null, null, null],
              fairyId: null,
            },
            {
              id: "echelon-2",
              name: "제2제대",
              slots: [null, null, null, null, null, null],
              fairyId: null,
            },
            {
              id: "echelon-3",
              name: "제3제대",
              slots: [null, null, null, null, null, null],
              fairyId: null,
            },
          ],
          facilities: { base1: 1, base2: 1, base3: 1, base4: 1, base5: 1 },
          hireOffers: [],
          hirePreviousOffers: [],
          hireOfferDay: null,
          hireRefreshDay: null,
          hiredDay: null,
          fairies: {},
          manufacturing: [],
          repairs: [],
          completedMissions: [],
          sortiesCompletedTotal: 0,
          dismissedBosses: [],
          defeatedBosses: [],
          bossRecruit: null,
          sortie: null,
          lastCheck: null,
          lastBattle: null,
          featuredDollId: null,
          settings: { relationDifficulty: "standard" },
          daily: {
            day: number(defaults.A_day, 1),
            sortiesUsed: 0,
            sortiesCompleted: 0,
            management: 0,
            relations: 0,
            endDay: 0,
            claimed: [],
          },
        },
      },
    },
  };
}

export function compileKnownCard(parsed: ParsedCard): CompileResult | null {
  const mined = mineCard(parsed);
  if (!gflSignature(parsed, mined)) return null;
  const prompt = buildCompilerPrompt(parsed, mined),
    textPanels = extractTextPanels(extractRegexScripts(parsed)),
    diagnosis = { ...diagnoseCard(parsed, mined, prompt.coverage), textPanels },
    { recovered, normalizedMg3, unknownClasses, encounterMissing, bossMissing, manufacturingMissing, schema } = gflSchema(parsed, mined),
    moduleIds = ["genre.gfl"],
    presets = screenPresetsFor(moduleIds, schema);
  const dollCount = (schema.gfl as { dolls: unknown[] }).dolls.length,
    fallbackCount = dollCount - recovered;
  // 컴파일 결과는 초안이다(ADR 0001 헌법 2): 어떤 값이 원본 회수이고 어떤 값이 Lucky 합성인지 숨기지 않는다.
  const issues: CompileResult["issues"] = [
    {
      level: "warn",
      path: "runtime",
      message:
        "원본 저수준 Lua를 실행하지 않고 검증된 소녀전선 Lucky 템플릿으로 변환했습니다.",
      source: "template",
    },
    ...(fallbackCount > 0
      ? [
          {
            level: "warn" as const,
            path: "gfl.dolls",
            message: `인형 ${fallbackCount}/${dollCount}명은 카드에 능력치 배열이 없어 원본 Lua 폴백(HP 1000 · MP 1000 · 전투력 500 · 기분 50)을 사용했습니다.`,
            source: "template" as const,
          },
        ]
      : []),
    ...(normalizedMg3 ? [{ level: "warn" as const, path: "gfl.dolls", message: `병과 오타 정규화(MG3→MG) ${normalizedMg3}건`, source: "template" as const }] : []),
    ...unknownClasses.map((className) => ({ level: "warn" as const, path: "gfl.dolls", message: `미지 병과 ${className} — 전투에서 AR 프로필로 폴백`, source: "template" as const })),
    ...encounterMissing.map((name) => ({ level: "warn" as const, path: "gfl.encounters", message: `조우 풀 이름을 인형 카탈로그에 매핑하지 못함: ${name}`, source: "template" as const })),
    ...bossMissing.map((name) => ({ level: "warn" as const, path: "gfl.bosses", message: `보스 능력치 또는 영입 금지 목록을 연결하지 못함: ${name}`, source: "template" as const })),
    ...manufacturingMissing.map((name) => ({ level: "warn" as const, path: "gfl.manufacturing.pools", message: `제조 장비 풀을 장비 카탈로그에 연결하지 못함: ${name}`, source: "template" as const })),
    {
      level: "warn",
      path: "combat",
      message:
        "전투 판정(d20·치명타·전리품 범위)은 원본에 대응 수치가 없어 Lucky 공용 규칙으로 합성했습니다.",
      source: "template",
    },
    {
      level: "warn",
      path: "gfl.progression",
      message:
        "단계 수·임무 유형·서사 지침과 아이템 drop%는 원본에서 회수했습니다. 단계 타입 가중치·정찰 보정·돌발 자원·미확인 발견률·소모전 보정은 Lucky 규칙입니다.",
      source: "template",
    },
    {
      level: "warn",
      path: "gfl.manufacturing",
      message:
        "인형 고용은 원본의 일일 목록·숙소 정원·저격 추가금 규칙을 사용하지만, 별도 제조 비용은 Lucky 규칙입니다(인형 500/300 · 장비 300/200 · 중형 1500/1000/코어1).",
      source: "template",
    },
  ];
  return {
    compilerVersion: "0.2",
    schema,
    moduleIds,
    screens: presets.screens,
    navigation: presets.navigation,
    patches: [],
    unmatchedMinedValues: [],
    issues,
    warnings: [
      "소녀전선 잔불 인증 변환판을 자동 적용했습니다.",
      "AI 상태 태그는 게임 상태를 직접 변경하지 않습니다.",
      `인형 ${recovered}/${dollCount}명의 능력치(HP·MP·전투력·기분)를 카드 defaultVariables에서 회수했습니다.`,
      "MOD 개조 전투력과 지휘관 시작 자금 10,000은 원본 Lua에서 회수했습니다.",
      "작전 단계 수 7개·임무 유형 3종·단계 지침 5종과 아이템 drop%를 원본 Lua에서 회수했습니다.",
      `무소속 인형 조우 풀 ${(schema.gfl as { encounters: { pool: unknown[] } }).encounters.pool.length}명을 원본 Lua에서 회수했습니다.`,
      `보스 ${(schema.gfl as { bosses: unknown[] }).bosses.length}명과 영입 금지 ${(schema.gfl as { noRecruit: unknown[] }).noRecruit.length}명, 장비 제조 일반 ${((schema.gfl as { manufacturing: { pools: { equipment: unknown[] } } }).manufacturing.pools.equipment).length}종·중형 ${((schema.gfl as { manufacturing: { pools: { heavy: unknown[] } } }).manufacturing.pools.heavy).length}종을 원본 Lua에서 회수했습니다.`,
    ],
    attempts: [],
    diagnosis,
    rulebookUsed: prompt.coverage.rulebookText,
  };
}
