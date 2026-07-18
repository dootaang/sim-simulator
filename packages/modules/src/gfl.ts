import type { ModuleDefinition, RuntimeRecord } from "@simbot/kernel";
import {
  type Context,
  fail,
  list,
  moduleDefinition,
  number,
  ok,
  record,
  rewards,
  scoped,
  string,
} from "./support.ts";

type Doll = RuntimeRecord & {
  id: string;
  name: string;
  class: string;
  grade: number;
  maxHp: number;
  power: number;
  maxMp?: number;
  mood?: number;
};
type FormationRow = "전열" | "중열" | "후열";
const CLASS_COMBAT: Record<string,{aggro:number;damageTaken:number;vsMaxHp?:number;round1?:number;round3plus?:number;hitBuffAlly?:number}> = {
  AR: { aggro: 1, damageTaken: 1 }, SMG: { aggro: 3, damageTaken: .68 }, SG: { aggro: 4, damageTaken: .6 },
  MG: { aggro: 1, damageTaken: 1, round1: 1.4, round3plus: .8 }, RF: { aggro: .5, damageTaken: 1, vsMaxHp: 1.3 },
  HG: { aggro: .5, damageTaken: 1, hitBuffAlly: 1 },
};
const ROW_AGGRO: Record<FormationRow, number> = { 전열: 2.4, 중열: 1, 후열: .4 };
const REAR_DAMAGE_BONUS = 1.38;
export const COMMANDER_EXP_BY_STAR = [10, 15, 20, 30, 40, 55, 70] as const;
export const commanderThreshold = (level: number) => 30 + 20 * (level - 1);
export const COMMANDER_LEVELS = Array.from({ length: 20 }, (_, index) => {
  const level = index + 1;
  let exp = 0;
  for (let current = 1; current < level; current++) exp += commanderThreshold(current);
  return { level, exp, expForNext: level < 20 ? commanderThreshold(level) : null };
});
export function commanderLevel(exp: number) {
  const total = Math.max(0, number(exp));
  let level = 1;
  for (const entry of COMMANDER_LEVELS) if (total >= entry.exp) level = entry.level;
  return level;
}
export const commanderSortieLimit = (level: number) => level >= 12 ? 5 : level >= 4 ? 4 : 3;
export const commanderCheckBonus = (level: number) => level >= 16 ? 2 : level >= 8 ? 1 : 0;
function commanderStatus(value: RuntimeRecord) {
  const player = record(value.player), exp = Math.max(0, number(player.exp)), level = commanderLevel(exp),
    current = COMMANDER_LEVELS[level - 1]!;
  return {
    level,
    exp,
    expIntoLevel: exp - current.exp,
    expForNext: current.expForNext,
    sortieLimit: commanderSortieLimit(level),
    checkBonus: commanderCheckBonus(level),
    title: level >= 20 ? "백전의 지휘관" : null,
  };
}
const FACTION_COUNTER: Record<string,{advantaged:string[];label:string}> = {
  "철혈": { advantaged: ["RF","MG"], label: "기계 장갑 부대 — RF·MG 유리" },
  "E.L.I.D": { advantaged: ["MG","SG","AR"], label: "감염 군집 — MG·SG·AR 유리" },
  "바랴그단": { advantaged: [], label: "적성 인형 부대 — 상성 중립" },
  "패러데우스": { advantaged: ["SG","SMG"], label: "정예 화력 — 방패 병과 가치 상승" },
};
const combatProfile = (className: unknown) => CLASS_COMBAT[string(className)] ?? CLASS_COMBAT.AR!;
// 진형 정원(3열×2). 배치 검증·패딩이 전부 이 상수를 봐야 한다 — 5칸 시절 숫자를 남기면 6번째 칸이 죽는다.
export const FORMATION_SIZE = 6;
export const gflFormationRow = (index: number): FormationRow => index < 2 ? "전열" : index < 4 ? "중열" : "후열";
function factionSummary(value: RuntimeRecord) {
  const factions = list<string>(value.factions), counters = factions.map((name) => FACTION_COUNTER[name]).filter((counter): counter is NonNullable<typeof counter> => Boolean(counter)),
    advantagedClasses = [...new Set(counters.flatMap((counter) => counter.advantaged))];
  return { factions, counterLabel: counters.map((counter) => counter.label).join(" / "), advantagedClasses };
}
const config = (schema: RuntimeRecord) => record(schema.gfl);
const dolls = (schema: RuntimeRecord) => list<Doll>(config(schema).dolls);
const missions = (schema: RuntimeRecord) =>
  list<RuntimeRecord>(config(schema).missions);
const items = (schema: RuntimeRecord) =>
  list<RuntimeRecord>(config(schema).items);
const equipment = (schema: RuntimeRecord) =>
  list<RuntimeRecord>(config(schema).equipment);
const fairies = (schema: RuntimeRecord) =>
  list<RuntimeRecord>(config(schema).fairies);
const state = (value: RuntimeRecord) => record(value.gfl);
const owned = (value: RuntimeRecord) => record(state(value).dolls);
const doll = (schema: RuntimeRecord, id: unknown) =>
  dolls(schema).find((value) => value.id === id);
const mission = (schema: RuntimeRecord, id: unknown) =>
  missions(schema).find((value) => value.id === id);
const echelons = (value: RuntimeRecord) =>
  list<RuntimeRecord>(state(value).echelons);
function acquire(
  c: Parameters<Parameters<typeof scoped>[0]>[0],
  definition: Doll,
  status = "대기",
) {
  const gfl = state(c.state),
    values = record(gfl.dolls);
  if (values[definition.id]) return false;
  const maxMp = number(definition.maxMp, 1000),
    mood = number(definition.mood, 50),
    baseMaxHp = number(definition.maxHp, 1000),
    maxHp = baseMaxHp + MAINTENANCE_HP[facilityLevel(c.state, "base3") - 1]!;
  values[definition.id] = {
    id: definition.id,
    name: definition.name,
    class: definition.class,
    grade: definition.grade,
    hp: { cur: maxHp, max: maxHp },
    mp: { cur: maxMp, max: maxMp },
    baseMaxHp,
    basePower: definition.power,
    power: definition.power,
    mood,
    affinity: 0,
    mod: 0,
    status,
    equipment: [],
  };
  gfl.dolls = values;
  c.state.gfl = gfl;
  return true;
}
function formation(value: RuntimeRecord, echelonId: unknown) {
  return echelons(value).find((entry) => entry.id === echelonId);
}
function power(value: RuntimeRecord, echelon: RuntimeRecord) {
  const values = owned(value);
  return list<unknown>(echelon.slots).reduce<number>(
    (sum, id) => sum + number(record(values[string(id)]).power),
    0,
  );
}
function spend(
  c: Parameters<Parameters<typeof scoped>[0]>[0],
  cost: RuntimeRecord,
) {
  const resources = record(c.state.resources);
  for (const [id, qty] of Object.entries(cost)) {
    const have = id === "gold" ? number(c.state.gold) : number(resources[id]);
    if (have < number(qty)) return id;
  }
  for (const [id, qty] of Object.entries(cost)) {
    if (id === "gold") c.state.gold = number(c.state.gold) - number(qty);
    else resources[id] = number(resources[id]) - number(qty);
  }
  c.state.resources = resources;
  return null;
}
function queue(value: RuntimeRecord, key: string) {
  const gfl = state(value);
  return list<RuntimeRecord>(gfl[key]);
}
const day = (value: RuntimeRecord) =>
  number(value.day, number(record(value.clock).day, 1));
const hireConfig = (schema: RuntimeRecord) => record(config(schema).hire);
const locations = (schema: RuntimeRecord) =>
  list<RuntimeRecord>(schema.locations);
const baseLocation = (value: RuntimeRecord) =>
  string(value.location || state(value).baseLocation || "base-command");
const fieldSortie = (value: RuntimeRecord) => {
  const sortie = record(state(value).sortie);
  return sortie.active && sortie.command === "field" ? sortie : null;
};
const facilityLevel = (value: RuntimeRecord, id: string) =>
  Math.max(1, Math.min(5, number(record(state(value).facilities)[id], 1)));
const TRAINING_BONUS = [10, 15, 20, 30, 50],
  DEFENSE_REDUCTION = [5, 10, 15, 20, 30],
  DEFENSE_POWER = [10, 15, 20, 30, 50],
  MAINTENANCE_HP = [50, 100, 150, 200, 300],
  SUPPLY_DAILY = [300, 600, 1000, 1500, 2500],
  DORM_CAPACITY = [4, 8, 12, 16, 20],
  DORM_HEAL = [10, 20, 30, 40, 100];
function dollCapacity(schema: RuntimeRecord, value: RuntimeRecord) {
  const level = facilityLevel(value, "base5"),
    values = list<number>(hireConfig(schema).capacity);
  return number(values[level - 1], DORM_CAPACITY[level - 1]!);
}
function effectivePower(value: RuntimeRecord, echelon: RuntimeRecord) {
  const raw = power(value, echelon),
    bonus = TRAINING_BONUS[facilityLevel(value, "base1") - 1]!;
  return Math.round(raw * (1 + bonus / 100));
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function dailyState(value: RuntimeRecord) {
  const gfl = state(value), today = day(value);
  let daily = record(gfl.daily);
  if (number(daily.day) !== today) {
    daily = { day: today, sortiesUsed: 0, sortiesCompleted: 0, management: 0, relations: 0, endDay: 0, claimed: [] };
    gfl.daily = daily;
    value.gfl = gfl;
  }
  return daily;
}
function dailyTasks(daily: RuntimeRecord) {
  return [
    { id: "management", label: "기지 업무 2회", progress: Math.min(2, number(daily.management)), target: 2 },
    { id: "relation", label: "인형과 교류 1회", progress: Math.min(1, number(daily.relations)), target: 1 },
    { id: "sortie", label: "작전 1회 수행", progress: Math.min(1, number(daily.sortiesCompleted)), target: 1 },
    { id: "end-day", label: "하루 마감", progress: Math.min(1, number(daily.endDay)), target: 1 },
  ];
}
function markDaily(c: Context, key: "management" | "relations" | "sortiesCompleted" | "endDay", amount = 1) {
  const daily = dailyState(c.state);
  daily[key] = number(daily[key]) + amount;
  const completed = dailyTasks(daily).filter(task => task.progress >= task.target).length,
    claimed = list<number>(daily.claimed), awards: RuntimeRecord[] = [], resources = record(c.state.resources);
  for (const milestone of [2, 4]) if (completed >= milestone && !claimed.includes(milestone)) {
    const gold = milestone === 2 ? 300 : 700, res = milestone === 2 ? 150 : 350;
    c.state.gold = number(c.state.gold) + gold;
    resources.res = number(resources.res) + res;
    claimed.push(milestone); awards.push({ milestone, gold, res });
  }
  daily.claimed = claimed; c.state.resources = resources;
  return awards;
}
function relationDifficulty(value: RuntimeRecord) {
  const id = string(record(state(value).settings).relationDifficulty || "standard");
  return ({ relaxed: { id, gain: 1.5, loss: .5 }, strict: { id, gain: .7, loss: 1.25 }, standard: { id: "standard", gain: 1, loss: 1 } } as Record<string, { id: string; gain: number; loss: number }>)[id] ?? { id: "standard", gain: 1, loss: 1 };
}
function missionUnlocked(schema: RuntimeRecord, value: RuntimeRecord, operation: RuntimeRecord) {
  const completed = new Set(list<string>(state(value).completedMissions)), required = list<string>(operation.requires);
  if (required.length) return required.every(id => completed.has(id));
  const rows = missions(schema), index = rows.findIndex(row => row.id === operation.id), theater = string(operation.theater), previous = rows.slice(0, index).filter(row => string(row.theater) === theater).at(-1);
  return !previous || completed.has(string(previous.id));
}
function missionRisk(formationPower: number, requiredPower: number, commanderBonus = 0) {
  const ratio = formationPower / Math.max(1, requiredPower), baseModifier = clamp(Math.round(10 * Math.log2(Math.max(.1, ratio))), -10, 8),
    modifier = baseModifier + commanderBonus;
  let wins = 0;
  for (let roll = 1; roll <= 20; roll++) if (roll === 20 || (roll !== 1 && roll + modifier >= 8)) wins++;
  const chance = wins * 5, label = chance < 30 ? "극위험" : chance < 60 ? "위험" : chance < 85 ? "보통" : "안정";
  return { ratio: Math.round(ratio * 100), modifier, baseModifier, commanderBonus, chance, chanceLow: Math.max(5, chance - 5), chanceHigh: Math.min(95, chance + 5), label };
}
type RelationChoice = {
  label: string;
  dc: number;
  affinity: number;
  mood: number;
  minTier: number;
  followups: string[];
};
// 관계 선택지 사다리. 티어 문턱은 카드에서 회수한 relation(REL_NAMES/REL_THRES)을 그대로 쓰고,
// 선택지 구성·DC·증감은 Lucky 합성 규칙이다(원본 Choice 캡슐의 %는 LLM 임의값이라 회수 대상이 아님).
// talk/nickname/encourage 3종의 id와 수치는 기존 저장 회차가 재생하는 값이므로 바꾸지 않는다.
const RELATION_CHOICES: Record<string, RelationChoice> = {
  talk: { label: "차분히 대화한다", dc: 8, affinity: 3, mood: 10, minTier: 0, followups: ["nickname", "encourage"] },
  nickname: { label: "서로 부를 별명을 정한다", dc: 10, affinity: 5, mood: 25, minTier: 0, followups: ["encourage"] },
  encourage: { label: "진심으로 격려한다", dc: 12, affinity: 8, mood: 20, minTier: 0, followups: ["ask-past"] },
  "ask-past": { label: "지난 이야기를 묻는다", dc: 10, affinity: 5, mood: 15, minTier: 1, followups: ["confide"] },
  coffee: { label: "함께 커피를 마신다", dc: 9, affinity: 4, mood: 25, minTier: 1, followups: ["walk"] },
  train: { label: "함께 훈련한다", dc: 12, affinity: 7, mood: 15, minTier: 2, followups: ["encourage"] },
  walk: { label: "기지 주변을 함께 걷는다", dc: 11, affinity: 6, mood: 30, minTier: 2, followups: ["confide"] },
  confide: { label: "속마음을 나눈다", dc: 13, affinity: 10, mood: 25, minTier: 3, followups: ["promise"] },
  promise: { label: "소중한 약속을 나눈다", dc: 14, affinity: 12, mood: 30, minTier: 4, followups: [] },
};
// 하루 상한 — 같은 인형에게 4회, 같은 선택지는 2회(2회째는 효과 절반). 격려 연타 파밍 차단.
const RELATION_DAILY_LIMIT = 4,
  RELATION_CHOICE_DAILY_LIMIT = 2;
function relationTierCount(schema: RuntimeRecord) {
  return list<string>(record(config(schema).relation).names).length;
}
// 카드의 티어 수보다 높은 요구치는 마지막 티어로 접는다. relation 설정이 없는 카드는 전부 개방.
function choiceMinTier(schema: RuntimeRecord, choice: RelationChoice) {
  const count = relationTierCount(schema);
  return count ? Math.min(choice.minTier, count - 1) : 0;
}
function relationTierName(schema: RuntimeRecord, index: number) {
  const name = list<string>(record(config(schema).relation).names)[index];
  return typeof name === "string" && name ? name : `${index + 1}단계`;
}
function relationUsage(value: RuntimeRecord, dollId: string) {
  const log = record(state(value).relationLog);
  if (number(log.day) !== day(value)) return { total: 0, choices: {} as RuntimeRecord };
  const entry = record(record(log.dolls)[dollId]);
  return { total: number(entry.total), choices: record(entry.choices) };
}
function markRelationUse(c: Context, dollId: string, choiceId: string) {
  const gfl = state(c.state), today = day(c.state);
  let log = record(gfl.relationLog);
  if (number(log.day) !== today) log = { day: today, dolls: {} };
  const dolls = record(log.dolls), entry = record(dolls[dollId]), choices = record(entry.choices);
  choices[choiceId] = number(choices[choiceId]) + 1;
  entry.total = number(entry.total) + 1;
  entry.choices = choices;
  dolls[dollId] = entry;
  log.dolls = dolls;
  gfl.relationLog = log;
  c.state.gfl = gfl;
}
// 후속 캡슐·대화 세션 상태는 당일에만 유효하다 — 셀렉터와 소비 지점이 같은 검증을 공유한다.
function activeFollowUp(value: RuntimeRecord) {
  const followUp = record(state(value).followUp);
  return string(followUp.dollId) && number(followUp.day) === day(value) ? followUp : null;
}
function activeDialogue(value: RuntimeRecord) {
  const dialogue = record(state(value).dialogue);
  return string(dialogue.dollId) ? dialogue : null;
}
function relationFor(schema: RuntimeRecord, affinity: unknown) {
  const relation = record(config(schema).relation),
    names = list<string>(relation.names),
    thresholds = list<number>(relation.thresholds),
    descriptions = list<string>(relation.descriptions),
    score = number(affinity);
  let index = 0;
  for (let at = 0; at < thresholds.length; at++) if (score >= number(thresholds[at])) index = at;
  return { label: names[index] ?? "첫 만남", description: descriptions[index] ?? "", index };
}
function hireOffers(c: Parameters<Parameters<typeof scoped>[0]>[0]) {
  const gfl = state(c.state),
    pool = dolls(c.schema).filter((value) => !owned(c.state)[value.id]),
    count = Math.min(
      Math.max(1, number(hireConfig(c.schema).dailySlots, 5)),
      pool.length,
    ),
    offers: RuntimeRecord[] = [],
    current = list<RuntimeRecord>(gfl.hireOffers),
    previousIds = new Set(
      (current.length ? current.map((value) => value.id) : list<string>(gfl.hirePreviousOffers))
        .map(string)
        .filter(Boolean),
    ),
    fresh = pool.filter((value) => !previousIds.has(value.id)),
    repeated = pool.filter((value) => previousIds.has(value.id));
  for (let index = 0; index < count; index++) {
    const candidates = fresh.length ? fresh : repeated;
    const picked = candidates.splice(c.rng.int(0, candidates.length - 1), 1)[0]!;
    offers.push({
      id: picked.id,
      name: picked.name,
      class: picked.class,
      grade: picked.grade,
      price: number(picked.price, 5000),
      description: string(picked.description),
      asset: picked.asset,
    });
  }
  gfl.hireOffers = offers;
  gfl.hirePreviousOffers = offers.map((value) => value.id);
  gfl.hireOfferDay = day(c.state);
  c.state.gfl = gfl;
  return offers;
}
function hireDoll(
  c: Parameters<Parameters<typeof scoped>[0]>[0],
  definition: Doll,
  cost: number,
  kind: "offer" | "snipe",
) {
  const gfl = state(c.state),
    today = day(c.state);
  if (gfl.hiredDay === today) return fail(c, "gfl_hire_daily_limit", today);
  if (owned(c.state)[definition.id])
    return fail(c, "gfl_doll_owned", definition.id);
  const capacity = dollCapacity(c.schema, c.state),
    count = Object.keys(owned(c.state)).length;
  if (count >= capacity)
    return fail(c, "gfl_hire_capacity_full", `${count}/${capacity}`);
  const missing = spend(c, { gold: cost });
  if (missing) return fail(c, "gfl_hire_funds_missing", cost);
  acquire(c, definition, "이동 중");
  const unit = record(owned(c.state)[definition.id]);
  unit.arrivalRemaining = Math.max(
    1,
    number(hireConfig(c.schema).arrivalSteps, 1),
  );
  unit.hireKind = kind;
  const next = state(c.state);
  next.hiredDay = today;
  next.hireOffers = list<RuntimeRecord>(next.hireOffers).filter(
    (value) => value.id !== definition.id,
  );
  c.state.gfl = next;
  return ok(c, {
    dollId: definition.id,
    name: definition.name,
    cost,
    kind,
    arrivalRemaining: unit.arrivalRemaining,
    capacity,
  });
}
function facilityCost(definition: RuntimeRecord, level: number) {
  const base = record(definition.cost),
    multiplier = number(definition.costMultiplier, 1.5),
    factor = multiplier ** Math.max(0, level - 1);
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      Math.floor(number(value) * factor),
    ]),
  );
}

type GflCombatant = RuntimeRecord & {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  power: number;
  class?: string;
  row?: FormationRow;
  hpBefore?: number;
  boss?: boolean;
};

function resolveSortie(c: Context) {
  const gfl = state(c.state),
    sortie = record(gfl.sortie),
    operation = mission(c.schema, sortie.missionId),
    entry = formation(c.state, sortie.echelonId);
  if (!sortie.active || !operation || !entry)
    return fail(c, "gfl_sortie_missing");

  const commanderBefore = commanderStatus(c.state),
    tactic = string(c.params.tactic || sortie.tactic || "balanced"),
    risk = missionRisk(number(sortie.power), number(operation.power), commanderBefore.checkBonus),
    missionRoll = c.rng.int(1, 20),
    missionTotal = missionRoll + risk.modifier,
    condition = missionRoll === 20 || (missionRoll !== 1 && missionTotal >= 8) ? missionTotal >= 15 ? "favorable" : "steady" : missionTotal <= 2 ? "disastrous" : "unfavorable",
    conditionHit = condition === "favorable" ? 2 : condition === "unfavorable" ? -2 : condition === "disastrous" ? -4 : 0,
    tacticHit = tactic === "focus" ? 2 : tactic === "cover" ? -2 : 0,
    allyDamageFactor = tactic === "focus" ? 1.15 : tactic === "cover" ? .85 : 1,
    incomingFactor = (tactic === "focus" ? 1.15 : tactic === "cover" ? .7 : 1) * (condition === "favorable" ? .85 : condition === "unfavorable" ? 1.15 : condition === "disastrous" ? 1.3 : 1),
    values = owned(c.state), missionFaction = factionSummary(operation),
    allies: GflCombatant[] = list<unknown>(entry.slots)
      .map((rawId, index) => ({ unit: record(values[string(rawId)]), row: gflFormationRow(index) }))
      .filter(({ unit }) => Object.keys(unit).length > 0)
      .map(({ unit, row }) => {
        const hp = record(unit.hp);
        return {
          id: string(unit.id),
          name: string(unit.name),
          hp: Math.max(0, number(hp.cur)),
          maxHp: Math.max(1, number(hp.max, 1)),
          power: Math.max(1, number(unit.power, 1)),
          grade: number(unit.grade, 1),
          class: string(unit.class), row, hpBefore: Math.max(0, number(hp.cur)),
        };
      });
  if (!allies.some((unit) => unit.hp > 0))
    return fail(c, "gfl_echelon_incapacitated");

  const configured = list<RuntimeRecord>(operation.enemies), bossName = string(operation.boss).trim(),
    enemyCount = configured.length
      ? Math.min(5, configured.length)
      : clamp(
          Math.round(
            number(
              operation.enemyCount,
              Math.ceil(Math.max(1, number(operation.power)) / 1200),
            ),
          ),
          1,
          5,
        ),
    totalEnemyPower = Math.max(100, number(operation.power, 100)),
    enemies: GflCombatant[] = Array.from({ length: enemyCount }, (_, index) => {
      const isBoss = !configured.length && Boolean(bossName) && index === 0, source = configured[index] ?? {},
        unitPower = Math.max(
          20,
          number(source.power, Math.round(isBoss ? totalEnemyPower * .5 : bossName && !configured.length && enemyCount > 1 ? totalEnemyPower * .5 / (enemyCount - 1) : totalEnemyPower / enemyCount)),
        ),
        maxHp = Math.max(80, number(source.hp, Math.round(isBoss ? unitPower * 1.1 : unitPower * .75)));
      return {
        id: string(source.id || (isBoss ? "boss" : `enemy-${index + 1}`)),
        name: string(
          source.name || (isBoss ? bossName :
            (enemyCount === 1
              ? operation.enemy || "적대 세력"
              : `${operation.enemy || "적대 세력"} ${index + 1}`)),
        ),
        hp: maxHp,
        maxHp,
        power: unitPower,
        boss: isBoss,
      };
    }),
    rounds: RuntimeRecord[] = [],
    defenseReduction =
      DEFENSE_REDUCTION[facilityLevel(c.state, "base2") - 1] ?? 0;

  const hgHitBuff = Math.min(2, allies.reduce((sum, ally) => sum + number(combatProfile(ally.class).hitBuffAlly), 0));
  for (let round = 1; round <= 8; round++) {
    const exchanges: RuntimeRecord[] = [];
    for (const ally of allies.filter((unit) => unit.hp > 0)) {
      const target = enemies.find((unit) => unit.hp > 0);
      if (!target) break;
      const profile = combatProfile(ally.class), counter = missionFaction.advantagedClasses.includes(string(ally.class)),
        roundFactor = round === 1 ? number(profile.round1, 1) : round >= 3 ? number(profile.round3plus, 1) : 1,
        rowFactor = ally.row === "후열" && (profile.vsMaxHp || profile.round1) ? REAR_DAMAGE_BONUS : 1,
        maxEnemyHp = Math.max(...enemies.map((unit) => unit.maxHp)), maxHpFactor = profile.vsMaxHp && target.maxHp === maxEnemyHp ? profile.vsMaxHp : 1,
        roll = c.rng.int(1, 20),
        critical = roll === 20,
        hit = roll + number(ally.grade, 1) + conditionHit + tacticHit + hgHitBuff + (counter ? 2 : 0) >= 8,
        dealt = hit
          ? Math.max(
              1,
              Math.round(
                ally.power * 0.24 * (critical ? 1.6 : 1) * allyDamageFactor * roundFactor * rowFactor * maxHpFactor - target.power * 0.02,
              ),
            )
          : 0;
      target.hp = Math.max(0, target.hp - dealt);
      exchanges.push({
        side: "ally",
        actorId: ally.id,
        targetId: target.id,
        roll,
        hit,
        critical,
        damage: dealt,
        targetHp: target.hp,
        counter,
        hitBuff: hgHitBuff,
        roundFactor,
        rowFactor,
        maxHpFactor,
      });
    }
    for (const foe of enemies.filter((unit) => unit.hp > 0)) {
      const living = allies.filter((unit) => unit.hp > 0);
      if (!living.length) break;
      const weights = living.map((unit) => Math.round(combatProfile(unit.class).aggro * ROW_AGGRO[unit.row ?? "후열"] * 100)),
        targetRoll = c.rng.int(1, weights.reduce((sum, weight) => sum + weight, 0));
      let cursor = 0;
      const target = living[weights.findIndex((weight) => (cursor += weight) >= targetRoll)]!,
        roll = c.rng.int(1, 20),
        critical = roll === 20,
        hit = roll >= 8,
        raw = hit
          ? Math.max(
              1,
              Math.round(
                foe.power * 0.16 * (critical ? 1.5 : 1) - target.power * 0.015,
              ),
            )
          : 0,
        damageTaken = target.row === "후열" ? 1 : combatProfile(target.class).damageTaken,
        dealt = Math.max(0, Math.round(raw * damageTaken * (1 - defenseReduction / 100) * incomingFactor));
      target.hp = Math.max(0, target.hp - dealt);
      exchanges.push({
        side: "enemy",
        actorId: foe.id,
        targetId: target.id,
        roll,
        hit,
        critical,
        damage: dealt,
        targetHp: target.hp,
      });
    }
    rounds.push({ round, exchanges });
    if (!enemies.some((unit) => unit.hp > 0) || !allies.some((unit) => unit.hp > 0))
      break;
  }

  const outcome = enemies.every((unit) => unit.hp <= 0) ? "victory" : "defeat";
  for (const ally of allies) {
    const unit = record(values[ally.id]),
      hp = record(unit.hp);
    hp.cur = ally.hp;
    unit.hp = hp;
    unit.status = ally.hp <= 0 ? "대파" : ally.hp < ally.maxHp ? "손상" : "대기";
  }
  let reward = null, rewardRate = 0, commanderExp = { gained: 0, total: commanderBefore.exp, level: commanderBefore.level }, levelUp: RuntimeRecord | null = null;
  if (outcome === "victory") {
    const firstClear = !list<string>(state(c.state).completedMissions).includes(string(operation.id));
    rewardRate = firstClear ? 1 : .35;
    const rawReward = record(operation.rewards), scaledReward = Object.fromEntries(Object.entries(rawReward).map(([key, value]) => [key, Math.floor(number(value) * rewardRate)]));
    rewards(c.state, scaledReward, c);
    reward = scaledReward;
    const stars = clamp(Math.floor(number(operation.stars)), 0, 6),
      bossExp = Math.round(COMMANDER_EXP_BY_STAR[stars]! * (string(operation.boss).trim() ? 1.5 : 1)),
      gained = Math.max(1, Math.round(bossExp * rewardRate)),
      player = record(c.state.player), total = Math.max(0, number(player.exp)) + gained,
      level = commanderLevel(total);
    player.exp = total;
    player.level = level;
    c.state.player = player;
    commanderExp = { gained, total, level };
    if (level > commanderBefore.level) levelUp = { from: commanderBefore.level, to: level };
    const next = state(c.state);
    next.completedMissions = [
      ...new Set([
        ...list<string>(next.completedMissions),
        string(operation.id),
      ]),
    ];
  }
  const allyResults = allies.map(({ id, name, hp, maxHp, hpBefore }) => ({
      id,
      name,
      hp,
      maxHp,
      hpBefore,
    })),
    enemyResults = enemies.map(({ id, name, hp, maxHp, boss }) => ({
      id,
      name,
      hp,
      maxHp,
      boss,
    })),
    next = state(c.state);
  next.lastBattle = {
    missionId: operation.id,
    outcome,
    roundCount: rounds.length,
    rounds,
    allies: allyResults,
    enemies: enemyResults,
    rewards: reward,
    rewardRate,
    tactic,
    missionCheck: { roll: missionRoll, modifier: risk.modifier, commanderBonus: commanderBefore.checkBonus, total: missionTotal, condition, risk },
    commanderExp,
    ...(levelUp ? { levelUp } : {}),
    factionLabel: missionFaction.counterLabel,
  };
  next.sortie = null;
  c.state.gfl = next;
  const dailyAwards = markDaily(c, "sortiesCompleted");
  // 이전 버전에서 이미 범용 전투창을 연 저장본도 새 일괄 전투로 안전하게 빠져나온다.
  c.state.combat = null;
  return ok(c, {
    outcome,
    missionId: operation.id,
    roundCount: rounds.length,
    rounds,
    allies: allyResults,
    enemies: enemyResults,
    rewards: reward,
    rewardRate,
    tactic,
    missionCheck: { roll: missionRoll, modifier: risk.modifier, commanderBonus: commanderBefore.checkBonus, total: missionTotal, condition, risk },
    commanderExp,
    ...(levelUp ? { levelUp } : {}),
    factionLabel: missionFaction.counterLabel,
    dailyAwards,
    llmCallsRequired: 0,
  });
}

export function gflModule(): ModuleDefinition {
  return moduleDefinition(
    "genre.gfl",
    [
      "core.stats",
      "core.inventory",
      "core.time",
      "core.location",
      "rpg.party",
      "core.jobs",
      "core.equipment",
      "rpg.shop",
      "rpg.loot",
      "combat.turnbased",
    ],
    ["gfl"],
    ["gold", "resources", "player", "combat"],
    {
      "gfl/start": scoped((c) => {
        const gfl = state(c.state);
        if (gfl.started) return fail(c, "gfl_already_started");
        const mode = string(c.params.mode || "commander");
        if (!["commander", "doll"].includes(mode))
          return fail(c, "gfl_start_mode_invalid", mode);
        gfl.started = true;
        gfl.mode = mode;
        gfl.commanderName = string(c.params.name || "지휘관");
        gfl.baseLocation = baseLocation(c.state);
        c.state.gfl = gfl;
        // 지휘관 시작 자금은 원본 Lua가 시작 시점에 별도로 지급한다(defaultVariables의 A_gold와 다름 — 실측 10,000).
        const funds = number(config(c.schema).commanderFunds, 0);
        if (mode === "commander" && funds > 0) c.state.gold = funds;
        return ok(c, { mode, starter: null });
      }),
      "gfl/doll/acquire": scoped((c) => {
        const definition = doll(c.schema, c.params.dollId);
        if (!definition) return fail(c, "gfl_unknown_doll", c.params.dollId);
        if (!acquire(c, definition))
          return fail(c, "gfl_doll_owned", definition.id);
        return ok(c, { dollId: definition.id });
      }),
      "gfl/doll/feature": scoped((c) => {
        const id = string(c.params.dollId), gfl = state(c.state);
        if (!owned(c.state)[id]) return fail(c, "gfl_doll_not_owned", id);
        gfl.featuredDollId = id; c.state.gfl = gfl;
        return ok(c, { dollId: id });
      }),
      "gfl/settings/update": scoped((c) => {
        const difficulty = string(c.params.relationDifficulty), gfl = state(c.state), settings = record(gfl.settings);
        if (difficulty && !["relaxed", "standard", "strict"].includes(difficulty)) return fail(c, "gfl_relation_difficulty_invalid", difficulty);
        if (difficulty) settings.relationDifficulty = difficulty;
        gfl.settings = settings; c.state.gfl = gfl;
        return ok(c, { settings });
      }),
      "gfl/hire/refresh": scoped((c) => {
        const gfl = state(c.state),
          today = day(c.state),
          daily = gfl.hireOfferDay !== today;
        if (!daily && gfl.hireRefreshDay === today)
          return fail(c, "gfl_hire_refresh_daily_limit", today);
        const offers = hireOffers(c),
          next = state(c.state);
        if (!daily) next.hireRefreshDay = today;
        c.state.gfl = next;
        return ok(c, { offers, daily, refreshUsed: !daily });
      }),
      "gfl/hire/contract": scoped((c) => {
        const definition = doll(c.schema, c.params.dollId),
          offer = list<RuntimeRecord>(state(c.state).hireOffers).find(
            (value) => value.id === c.params.dollId,
          );
        if (!definition || !offer)
          return fail(c, "gfl_hire_offer_missing", c.params.dollId);
        const result = hireDoll(c, definition, number(definition.price, 5000), "offer");
        if (record(result.log[0]).ok) markDaily(c, "management");
        return result;
      }),
      "gfl/hire/snipe": scoped((c) => {
        const definition = doll(c.schema, c.params.dollId);
        if (!definition) return fail(c, "gfl_unknown_doll", c.params.dollId);
        const result = hireDoll(
          c,
          definition,
          number(definition.price, 5000) +
            number(hireConfig(c.schema).snipePremium, 3000),
          "snipe",
        );
        if (record(result.log[0]).ok) markDaily(c, "management");
        return result;
      }),
      "gfl/hire/tick": scoped((c) => {
        const arrivals = Object.values(owned(c.state)).filter(
          (value) => record(value).status === "이동 중",
        );
        if (!arrivals.length) return fail(c, "gfl_hire_no_arrivals");
        for (const raw of arrivals) {
          const unit = record(raw),
            remaining = Math.max(0, number(unit.arrivalRemaining, 1) - 1);
          unit.arrivalRemaining = remaining;
          if (remaining === 0) unit.status = "대기";
        }
        return ok(c, {
          arrivals: arrivals.map((value) => ({
            dollId: record(value).id,
            status: record(value).status,
            remaining: record(value).arrivalRemaining,
          })),
        });
      }),
      "gfl/echelon/assign": scoped((c) => {
        const gfl = state(c.state),
          entry = formation(c.state, c.params.echelonId),
          id = string(c.params.dollId),
          slot = Math.trunc(number(c.params.slot, -1));
        if (!entry) return fail(c, "gfl_unknown_echelon", c.params.echelonId);
        if (!owned(c.state)[id]) return fail(c, "gfl_doll_not_owned", id);
        if (slot < 0 || slot >= FORMATION_SIZE) return fail(c, "gfl_slot_invalid", slot);
        for (const echelon of echelons(c.state)) {
          const slots = list<unknown>(echelon.slots);
          for (let index = 0; index < slots.length; index++)
            if (slots[index] === id) slots[index] = null;
          echelon.slots = slots;
        }
        const slots = list<unknown>(entry.slots);
        while (slots.length < FORMATION_SIZE) slots.push(null); // 격리 전 5칸 저장도 여기서 6칸으로 승격
        slots[slot] = id;
        entry.slots = slots;
        gfl.echelons = echelons(c.state);
        c.state.gfl = gfl;
        return ok(c, { echelonId: entry.id, slot, dollId: id });
      }),
      "gfl/echelon/remove": scoped((c) => {
        const gfl = state(c.state),
          entry = formation(c.state, c.params.echelonId),
          slot = Math.trunc(number(c.params.slot, -1));
        if (!entry) return fail(c, "gfl_unknown_echelon", c.params.echelonId);
        if (slot < 0 || slot >= FORMATION_SIZE) return fail(c, "gfl_slot_invalid", slot);
        const slots = list<unknown>(entry.slots),
          removed = slots[slot] ?? null;
        slots[slot] = null;
        entry.slots = slots;
        gfl.echelons = echelons(c.state);
        c.state.gfl = gfl;
        return ok(c, { echelonId: entry.id, slot, removed });
      }),
      "gfl/location/move": scoped((c) => {
        const target = string(c.params.locationId),
          destination = locations(c.schema).find(
            (value) => value.id === target,
          ),
          before = baseLocation(c.state),
          sortie = fieldSortie(c.state);
        if (!destination) return fail(c, "gfl_location_unknown", target);
        if (sortie) return fail(c, "gfl_commander_in_field", sortie.missionId);
        {
          const dialogue = activeDialogue(c.state);
          if (dialogue) return fail(c, "gfl_dialogue_active", string(dialogue.name));
        }
        if (before === "base-outside" && target !== "base-hall")
          return fail(c, "gfl_location_return_hall", target);
        if (before === target) return fail(c, "gfl_location_same", target);
        const gfl = state(c.state);
        c.state.location = target;
        gfl.baseLocation = target;
        gfl.currentLocationName = destination.name;
        c.state.gfl = gfl;
        return ok(c, {
          before,
          locationId: target,
          name: destination.name,
          outside: target === "base-outside",
          narrativeFact: `지휘관의 현재 위치는 ${string(destination.name)}이다.`,
        });
      }),
  "gfl/time/advance": scoped((c) => {
        if (fieldSortie(c.state)) return fail(c, "gfl_time_field_locked");
        {
          const dialogue = activeDialogue(c.state);
          if (dialogue) return fail(c, "gfl_dialogue_active", string(dialogue.name));
        }
        const phases = list<string>(config(c.schema).timePhases),
          order = phases.length
            ? phases
            : ["오전", "오후", "저녁", "밤", "심야", "새벽"],
          clock = record(c.state.clock),
          before = string(clock.phase || order[0]),
          index = Math.max(0, order.indexOf(before));
        if (before === "밤" && c.params.settlement !== true) return fail(c, "gfl_night_requires_end_day");
        const
          next = order[(index + 1) % order.length]!,
          newDay = index === order.length - 1;
        clock.phase = next;
        clock.hour = [8, 12, 18, 22, 2, 5][(index + 1) % order.length];
        clock.turn = number(clock.turn) + 1;
        const gfl = state(c.state),
          arrivals: RuntimeRecord[] = [];
        // 시간이 흐르면 "직후"의 분위기는 지나간다 — 후속 캡슐은 시간대 경계를 넘기지 않는다.
        if (gfl.followUp) gfl.followUp = null;
        for (const raw of Object.values(owned(c.state)).filter(
          (value) => record(value).status === "이동 중",
        )) {
          const unit = record(raw);
          unit.arrivalRemaining = Math.max(
            0,
            number(unit.arrivalRemaining, 1) - 1,
          );
          if (unit.arrivalRemaining === 0) {
            unit.status = "대기";
            arrivals.push({ dollId: unit.id, name: unit.name });
          }
        }
        const completed: RuntimeRecord[] = [];
        for (const job of queue(c.state, "manufacturing").filter(
          (value) => value.status === "active",
        )) {
          job.remaining = Math.max(0, number(job.remaining) - 1);
          if (job.remaining === 0) {
            job.status = "complete";
            completed.push(job);
            if (job.kind === "doll") {
              const definition = doll(c.schema, job.resultId);
              if (definition) acquire(c, definition);
            } else {
              const inventory = record(c.state.items);
              inventory[string(job.resultId)] =
                number(inventory[string(job.resultId)]) + 1;
              c.state.items = inventory;
            }
          }
        }
        for (const job of queue(c.state, "repairs").filter(
          (value) => value.status === "active",
        )) {
          job.remaining = Math.max(0, number(job.remaining) - 1);
          if (job.remaining === 0) {
            job.status = "complete";
            completed.push(job);
            const unit = record(owned(c.state)[string(job.dollId)]),
              hp = record(unit.hp);
            hp.cur = hp.max;
            unit.hp = hp;
            unit.status = "대기";
          }
        }
        let daily: RuntimeRecord | null = null;
        if (newDay) {
          const tomorrow = day(c.state) + 1;
          c.state.day = tomorrow;
          clock.day = tomorrow;
          const income = SUPPLY_DAILY[facilityLevel(c.state, "base4") - 1]!,
            resources = record(c.state.resources);
          resources.res = number(resources.res) + income;
          c.state.resources = resources;
          const healRate = DORM_HEAL[facilityLevel(c.state, "base5") - 1]!;
          for (const raw of Object.values(owned(c.state))) {
            const unit = record(raw),
              hp = record(unit.hp);
            hp.cur = Math.min(
              number(hp.max),
              number(hp.cur) + Math.ceil((number(hp.max) * healRate) / 100),
            );
            unit.hp = hp;
            unit.mood = clamp(number(unit.mood) + 10, 0, 1000);
          }
          const raidChance = Math.max(
              0,
              20 - DEFENSE_REDUCTION[facilityLevel(c.state, "base2") - 1]!,
            ),
            raidRoll = c.rng.int(1, 100),
            raid = raidRoll <= raidChance;
          if (raid) {
            const best = Math.max(
                0,
                ...echelons(c.state).map((entry) =>
                  effectivePower(c.state, entry),
                ),
              ),
              defended =
                Math.round(
                  best *
                    (1 +
                      DEFENSE_POWER[facilityLevel(c.state, "base2") - 1]! /
                        100),
                ) >= 1000;
            if (!defended)
              resources.res = Math.max(0, number(resources.res) - 300);
            daily = { income, healRate, raid: true, defended, raidRoll };
          } else daily = { income, healRate, raid: false, raidRoll };
          const previousOffers = list<RuntimeRecord>(gfl.hireOffers).map((value) => string(value.id)).filter(Boolean);
          if (previousOffers.length) gfl.hirePreviousOffers = previousOffers;
          gfl.hireOffers = [];
          gfl.hireOfferDay = null;
          gfl.hireRefreshDay = null;
          gfl.hiredDay = null;
          gfl.daily = { day: tomorrow, sortiesUsed: 0, sortiesCompleted: 0, management: 0, relations: 0, endDay: 0, claimed: [] };
        }
        c.state.clock = clock;
        c.state.gfl = gfl;
    return ok(c, {
          before,
          phase: next,
          day: day(c.state),
          newDay,
          arrivals,
          completed,
      daily,
    });
  }),
  "gfl/time/end-day": scoped((c) => {
    if (fieldSortie(c.state)) return fail(c, "gfl_time_field_locked");
    {
      const dialogue = activeDialogue(c.state);
      if (dialogue) return fail(c, "gfl_dialogue_active", string(dialogue.name));
    }
    const phase = string(record(c.state.clock).phase || "오전");
    if (!["저녁", "밤"].includes(phase)) return fail(c, "gfl_end_day_time_locked", phase);
    const dailyAwards = markDaily(c, "endDay");
    const steps: RuntimeRecord[] = [];
    for (let count = 0; count < 6; count++) {
      const result = c.registry.dispatch(c.schema, c.state, { id: "gfl/time/advance", params: { settlement: true } }, c.rng),
        row = record(result.log[0]);
      if (!row.ok) return result;
      c.state = result.state;
      steps.push(row);
      if (row.newDay) break;
    }
    const settlement = steps.at(-1) ?? {};
    return ok(c, { steps: steps.length, day: settlement.day, phase: settlement.phase, daily: settlement.daily, dailyAwards });
  }),
      "gfl/relation/check": scoped((c) => {
        if (
          ["dc", "modifier", "roll", "affinity", "mood"].some(
            (key) => key in c.params,
          )
        )
          return fail(c, "gfl_check_number_not_allowed");
        const dollId = string(c.params.dollId),
          unit = record(owned(c.state)[dollId]),
          choiceId = string(c.params.choice),
          choice = RELATION_CHOICES[choiceId];
        if (!Object.keys(unit).length)
          return fail(c, "gfl_doll_not_owned", dollId);
        if (!choice)
          return fail(c, "gfl_relation_choice_unknown", c.params.choice);
        const dialogue = activeDialogue(c.state);
        if (dialogue && string(dialogue.dollId) !== dollId)
          return fail(c, "gfl_dialogue_other_doll", string(dialogue.name));
        const beforeTier = relationFor(c.schema, unit.affinity),
          requiredTier = choiceMinTier(c.schema, choice);
        if (beforeTier.index < requiredTier)
          return fail(c, "gfl_relation_tier_locked", relationTierName(c.schema, requiredTier));
        // 게이트는 전부 주사위 전에 — 거부된 시도는 RNG를 소비하지 않는다(M6c 규율).
        const usage = relationUsage(c.state, dollId),
          used = number(usage.choices[choiceId]);
        if (usage.total >= RELATION_DAILY_LIMIT)
          return fail(c, "gfl_relation_exhausted", string(unit.name));
        if (used >= RELATION_CHOICE_DAILY_LIMIT)
          return fail(c, "gfl_relation_choice_exhausted", choice.label);
        // 후속 캡슐 보정은 상태에 기록된 제안만 인정한다 — followup 플래그로 숫자를 주입할 수 없다.
        const pendingFollowUp = activeFollowUp(c.state),
          followOption =
            c.params.followup === true && pendingFollowUp && string(pendingFollowUp.dollId) === dollId
              ? list<RuntimeRecord>(pendingFollowUp.options).find(
                  (option) => string(option.choice) === choiceId,
                )
              : undefined,
          dc = Math.max(2, choice.dc + number(followOption?.dcMod)),
          roll = c.rng.int(1, 20),
          modifier =
            Math.floor(number(unit.affinity) / 50) +
            Math.floor(number(unit.mood) / 100),
          total = roll + modifier,
          success = total >= dc,
          tier = success
            ? roll === 20
              ? "critical_success"
              : "success"
            : roll === 1
              ? "critical_failure"
              : "failure",
          multiplier =
            tier === "critical_success"
              ? 2
              : tier === "critical_failure"
                ? -1
                : tier === "failure"
                  ? 0
                  : 1,
          repeatFactor = used > 0 ? 0.5 : 1,
          difficulty = relationDifficulty(c.state),
          affinityDelta = Math.round(choice.affinity * multiplier * (multiplier < 0 ? difficulty.loss : difficulty.gain) * repeatFactor),
          moodDelta = Math.round(choice.mood * multiplier * repeatFactor);
        unit.affinity = clamp(number(unit.affinity) + affinityDelta, -200, 500);
        unit.mood = clamp(number(unit.mood) + moodDelta, 0, 1000);
        markRelationUse(c, dollId, choiceId);
        const afterTier = relationFor(c.schema, unit.affinity),
          tierChanged =
            afterTier.index > beforeTier.index
              ? {
                  from: { label: beforeTier.label, index: beforeTier.index },
                  to: { label: afterTier.label, index: afterTier.index, description: afterTier.description },
                }
              : null,
          remainingToday = Math.max(0, RELATION_DAILY_LIMIT - (number(usage.total) + 1)),
          followUps =
            remainingToday > 0 && (tier === "success" || tier === "critical_success")
              ? choice.followups
                  .filter((id) => {
                    const next = RELATION_CHOICES[id];
                    if (!next || afterTier.index < choiceMinTier(c.schema, next)) return false;
                    return number(usage.choices[id]) + (id === choiceId ? 1 : 0) < RELATION_CHOICE_DAILY_LIMIT;
                  })
                  .slice(0, 2)
                  .map((id) => {
                    const next = RELATION_CHOICES[id]!,
                      dcMod = tier === "critical_success" ? -2 : -1;
                    return { choice: id, label: next.label, dcMod, dc: Math.max(2, next.dc + dcMod) };
                  })
              : [];
        const result = {
          dollId,
          name: unit.name,
          choice: choiceId,
          label: choice.label,
          mode: "dc",
          sides: 20,
          dc,
          roll,
          modifier,
          total,
          success,
          tier,
          affinityDelta,
          moodDelta,
          affinity: unit.affinity,
          mood: unit.mood,
          difficulty: difficulty.id,
          relation: afterTier.label,
          repeated: used > 0,
          remainingToday,
          ...(followOption ? { followUpBonus: number(followOption.dcMod) } : {}),
          ...(tierChanged ? { tierChanged } : {}),
        };
        const gfl = state(c.state);
        gfl.lastCheck = result;
        // 캡슐은 한 번의 판정 창에만 산다 — 사용 여부와 무관하게 이전 제안은 지우고 새 제안으로 교체.
        gfl.followUp = followUps.length
          ? { dollId, name: unit.name, day: day(c.state), source: choiceId, options: followUps }
          : null;
        c.state.gfl = gfl;
        const dailyAwards = markDaily(c, "relations");
        markDaily(c, "management");
        return ok(c, { ...result, followUps, dailyAwards });
      }),
      "gfl/relation/session/start": scoped((c) => {
        const dollId = string(c.params.dollId),
          unit = record(owned(c.state)[dollId]);
        if (!Object.keys(unit).length)
          return fail(c, "gfl_doll_not_owned", dollId);
        if (fieldSortie(c.state)) return fail(c, "gfl_commander_in_field");
        const dialogue = activeDialogue(c.state);
        if (dialogue) return fail(c, "gfl_dialogue_active", string(dialogue.name));
        const status = string(unit.status);
        if (status === "이동 중") return fail(c, "gfl_doll_in_transit", string(unit.name));
        if (status === "대파") return fail(c, "gfl_doll_incapacitated", string(unit.name));
        const gfl = state(c.state),
          today = day(c.state),
          days = record(gfl.dialogueDays);
        if (number(days[dollId]) === today)
          return fail(c, "gfl_dialogue_daily_limit", string(unit.name));
        gfl.dialogue = {
          dollId,
          name: unit.name,
          day: today,
          startedTurn: number(record(c.state.clock).turn),
        };
        c.state.gfl = gfl;
        const tier = relationFor(c.schema, unit.affinity);
        return ok(c, {
          dollId,
          name: unit.name,
          relation: tier.label,
          narrativeFact: `${string(unit.name)}와의 1:1 대화가 시작됐다. 대화가 끝날 때까지 기지의 시간은 흐르지 않는다.`,
        });
      }),
      "gfl/relation/session/end": scoped((c) => {
        const gfl = state(c.state),
          dialogue = record(gfl.dialogue),
          dollId = string(dialogue.dollId);
        if (!dollId) return fail(c, "gfl_dialogue_missing");
        const unit = record(owned(c.state)[dollId]);
        if (!Object.keys(unit).length) {
          gfl.dialogue = null;
          c.state.gfl = gfl;
          return fail(c, "gfl_doll_not_owned", dollId);
        }
        // 보너스는 엔진 고정값(난이도 배율만 적용) — 대화 길이·내용으로 수치를 흥정할 수 없다.
        const difficulty = relationDifficulty(c.state),
          beforeTier = relationFor(c.schema, unit.affinity),
          affinityDelta = Math.round(2 * difficulty.gain),
          moodDelta = 10;
        unit.affinity = clamp(number(unit.affinity) + affinityDelta, -200, 500);
        unit.mood = clamp(number(unit.mood) + moodDelta, 0, 1000);
        const afterTier = relationFor(c.schema, unit.affinity),
          days = record(gfl.dialogueDays);
        days[dollId] = number(dialogue.day, day(c.state));
        gfl.dialogueDays = days;
        gfl.dialogue = null;
        c.state.gfl = gfl;
        const dailyAwards = markDaily(c, "relations");
        return ok(c, {
          dollId,
          name: unit.name,
          affinityDelta,
          moodDelta,
          affinity: unit.affinity,
          mood: unit.mood,
          relation: afterTier.label,
          ...(afterTier.index > beforeTier.index
            ? {
                tierChanged: {
                  from: { label: beforeTier.label, index: beforeTier.index },
                  to: { label: afterTier.label, index: afterTier.index, description: afterTier.description },
                },
              }
            : {}),
          dailyAwards,
          narrativeFact: `${string(unit.name)}와의 대화를 마무리했다. 기지의 시간이 다시 흐른다.`,
        });
      }),
      "gfl/manufacture/start": scoped((c) => {
        if (baseLocation(c.state) !== "base-maintenance")
          return fail(c, "gfl_maintenance_required");
        const kind = string(c.params.kind || "doll"),
          heavy = c.params.heavy === true,
          definitions =
            kind === "equipment"
              ? list<RuntimeRecord>(config(c.schema).equipment)
              : dolls(c.schema);
        if (!definitions.length)
          return fail(c, "gfl_manufacture_pool_empty", kind);
        const costs = record(
            record(config(c.schema).manufacturing)[heavy ? "heavy" : kind],
          ),
          missing = spend(c, costs);
        if (missing) return fail(c, "gfl_manufacture_cost_missing", missing);
        const result = definitions[c.rng.int(0, definitions.length - 1)]!,
          gfl = state(c.state),
          jobs = queue(c.state, "manufacturing");
        jobs.push({
          id: `mfg:${number(record(c.state.clock).turn)}:${jobs.length}`,
          kind,
          heavy,
          resultId: result.id,
          remaining: heavy ? 3 : 2,
          status: "active",
        });
        gfl.manufacturing = jobs;
        c.state.gfl = gfl;
        const dailyAwards = markDaily(c, "management");
        return ok(c, { job: jobs.at(-1), dailyAwards });
      }),
      "gfl/manufacture/tick": scoped((c) => {
        const gfl = state(c.state),
          jobs = queue(c.state, "manufacturing"),
          job = jobs.find((value) => value.id === c.params.jobId);
        if (!job || job.status !== "active")
          return fail(c, "gfl_manufacture_not_active", c.params.jobId);
        job.remaining = Math.max(0, number(job.remaining) - 1);
        if (job.remaining === 0) {
          job.status = "complete";
          if (job.kind === "doll") {
            const definition = doll(c.schema, job.resultId);
            if (definition) acquire(c, definition);
          } else {
            const items = record(c.state.items);
            items[string(job.resultId)] =
              number(items[string(job.resultId)]) + 1;
            c.state.items = items;
          }
        }
        gfl.manufacturing = jobs;
        c.state.gfl = gfl;
        return ok(c, { job });
      }),
      "gfl/repair/start": scoped((c) => {
        if (baseLocation(c.state) !== "base-maintenance")
          return fail(c, "gfl_maintenance_required");
        const id = string(c.params.dollId),
          unit = record(owned(c.state)[id]),
          hp = record(unit.hp);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", id);
        if (number(hp.cur) >= number(hp.max))
          return fail(c, "gfl_repair_not_needed", id);
        if (
          queue(c.state, "repairs").some(
            (value) => value.dollId === id && value.status === "active",
          )
        )
          return fail(c, "gfl_repair_already_active", id);
        const missing = spend(c, { parts: 1 });
        if (missing) return fail(c, "gfl_repair_cost_missing", missing);
        const gfl = state(c.state),
          repairs = queue(c.state, "repairs");
        unit.status = "수복";
        repairs.push({
          id: `repair:${id}:${number(record(c.state.clock).turn)}`,
          dollId: id,
          remaining: 2,
          status: "active",
        });
        gfl.repairs = repairs;
        c.state.gfl = gfl;
        const dailyAwards = markDaily(c, "management");
        return ok(c, { job: repairs.at(-1), dailyAwards });
      }),
      "gfl/repair/tick": scoped((c) => {
        const gfl = state(c.state),
          repairs = queue(c.state, "repairs"),
          job = repairs.find((value) => value.id === c.params.jobId),
          unit = record(owned(c.state)[string(job?.dollId)]);
        if (!job || job.status !== "active")
          return fail(c, "gfl_repair_not_active", c.params.jobId);
        job.remaining = Math.max(0, number(job.remaining) - 1);
        if (job.remaining === 0) {
          job.status = "complete";
          const hp = record(unit.hp);
          hp.cur = hp.max;
          unit.hp = hp;
          unit.status = "대기";
        }
        gfl.repairs = repairs;
        c.state.gfl = gfl;
        return ok(c, { job });
      }),
      "gfl/sortie/start": scoped((c) => {
        const gfl = state(c.state);
        if (record(gfl.sortie).active) return fail(c, "gfl_sortie_active");
        {
          const dialogue = activeDialogue(c.state);
          if (dialogue) return fail(c, "gfl_dialogue_active", string(dialogue.name));
        }
        const operation = mission(c.schema, c.params.missionId),
          entry = formation(c.state, c.params.echelonId),
          command = string(c.params.command || "field");
        if (!operation)
          return fail(c, "gfl_unknown_mission", c.params.missionId);
        if (!missionUnlocked(c.schema, c.state, operation)) return fail(c, "gfl_mission_locked", c.params.missionId);
        if (!entry) return fail(c, "gfl_unknown_echelon", c.params.echelonId);
        if (!["field", "remote"].includes(command))
          return fail(c, "gfl_sortie_command_invalid", command);
        const members = list<unknown>(entry.slots).filter(Boolean),
      formationPower = effectivePower(c.state, entry), daily = dailyState(c.state);
        if (!members.length) return fail(c, "gfl_echelon_empty");
        const commander = commanderStatus(c.state);
        if (number(daily.sortiesUsed) >= commander.sortieLimit) return fail(c, "gfl_sortie_daily_limit", commander.sortieLimit);
        if (members.every(id => { const hp = record(record(owned(c.state)[string(id)]).hp); return number(hp.cur) <= 0; })) return fail(c, "gfl_echelon_incapacitated");
        const travelCost = Math.max(0, number(operation.travelCost));
        if (travelCost) {
          const missing = spend(c, { gold: travelCost });
          if (missing)
            return fail(c, "gfl_sortie_travel_funds_missing", travelCost);
        }
        gfl.sortie = {
          active: true,
          missionId: operation.id,
          echelonId: entry.id,
          command,
          progress: 0,
          engaged: false,
          power: formationPower,
          returnLocation: baseLocation(c.state),
          travelCost,
          engagementMode: string(c.params.engagementMode || "tactical"),
        };
        daily.sortiesUsed = number(daily.sortiesUsed) + 1;
        c.state.gfl = gfl;
        return ok(c, {
          missionId: operation.id,
          echelonId: entry.id,
          power: formationPower,
          command,
          travelCost,
          risk: missionRisk(formationPower, number(operation.power), commander.checkBonus),
          sortiesRemaining: Math.max(0, commander.sortieLimit - number(daily.sortiesUsed)),
        });
      }),
      // 소녀전선 전투는 범용 플레이어 HP를 빌리지 않는다. 편성된 각 인형과 여러 적을
      // 엔진이 한 이벤트 안에서 끝까지 계산하므로 전투 한 번에 모델 호출을 반복하지 않는다.
      "gfl/sortie/engage": scoped(resolveSortie),
      "gfl/sortie/resolve": scoped(resolveSortie),
      "gfl/sortie/finish": scoped(resolveSortie),
      "gfl/facility/upgrade": scoped((c) => {
        const id = string(c.params.facilityId),
          definition = list<RuntimeRecord>(config(c.schema).facilities).find(
            (value) => value.id === id,
          ),
          gfl = state(c.state),
          facilities = record(gfl.facilities),
          level = number(facilities[id], 1);
        if (!definition) return fail(c, "gfl_unknown_facility", id);
        if (level >= number(definition.maxLevel, 5))
          return fail(c, "gfl_facility_max", id);
        const scaled = facilityCost(definition, level),
          missing = spend(c, scaled);
        if (missing) return fail(c, "gfl_facility_cost_missing", missing);
        facilities[id] = level + 1;
        gfl.facilities = facilities;
        c.state.gfl = gfl;
        if (id === "base3") {
          const bonus = MAINTENANCE_HP[level]!;
          for (const raw of Object.values(owned(c.state))) {
            const unit = record(raw),
              hp = record(unit.hp),
              oldMax = number(hp.max),
              newMax =
                number(unit.baseMaxHp, oldMax - MAINTENANCE_HP[level - 1]!) +
                bonus;
            hp.max = newMax;
            hp.cur = Math.min(
              newMax,
              number(hp.cur) + Math.max(0, newMax - oldMax),
            );
            unit.hp = hp;
          }
        }
        const dailyAwards = markDaily(c, "management");
        return ok(c, {
          facilityId: id,
          before: level,
          after: level + 1,
          cost: scaled,
          currentEffect: list<unknown>(definition.effects)[level] ?? null,
          nextCost:
            level + 1 < number(definition.maxLevel, 5)
              ? facilityCost(definition, level + 1)
              : null,
          dailyAwards,
        });
      }),
      "gfl/mod/upgrade": scoped((c) => {
        if (baseLocation(c.state) !== "base-maintenance")
          return fail(c, "gfl_maintenance_required");
        const id = string(c.params.dollId),
          unit = record(owned(c.state)[id]),
          stage = number(unit.mod);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", id);
        if (stage >= 3) return fail(c, "gfl_mod_max", id);
        const missing = spend(c, {
          cores: (stage + 1) * number(unit.grade, 3),
        });
        if (missing) return fail(c, "gfl_mod_cost_missing", missing);
        // MOD 단계별 전투력 상승은 카드 원본 MOD_POWER 테이블을 스키마로 받는다(컴파일러가 회수). 폴백은 원본 실측값.
        const gains = list<number>(config(c.schema).modPower);
        unit.mod = stage + 1;
        unit.power =
          number(unit.power) + number(gains[stage], [500, 600, 1000][stage]!);
        return ok(c, {
          dollId: id,
          before: stage,
          after: stage + 1,
          power: unit.power,
        });
      }),
      "gfl/shop/buy": scoped((c) => {
        const id = string(c.params.itemId),
          definition = [...items(c.schema), ...equipment(c.schema)].find(
            (value) => value.id === id,
          );
        if (!definition) return fail(c, "gfl_shop_unknown_item", id);
        const quantity = Math.max(1, Math.trunc(number(c.params.quantity, 1))),
          price = Math.max(0, number(definition.price)) * quantity,
          missing = spend(c, { gold: price });
        if (missing) return fail(c, "gfl_shop_funds_missing", missing);
        const inventory = record(c.state.items);
        inventory[id] = number(inventory[id]) + quantity;
        c.state.items = inventory;
        const dailyAwards = markDaily(c, "management");
        return ok(c, { itemId: id, quantity, price, dailyAwards });
      }),
      "gfl/item/use": scoped((c) => {
        const itemId = string(c.params.itemId),
          dollId = string(c.params.dollId),
          definition = items(c.schema).find((value) => value.id === itemId),
          unit = record(owned(c.state)[dollId]),
          inventory = record(c.state.items);
        if (!definition) return fail(c, "gfl_shop_unknown_item", itemId);
        if (string(definition.type) !== "use")
          return fail(c, "gfl_item_not_usable", itemId);
        if (!Object.keys(unit).length)
          return fail(c, "gfl_doll_not_owned", dollId);
        if (number(inventory[itemId]) < 1)
          return fail(c, "gfl_item_not_owned", itemId);
        const effect = record(definition.effect),
          hp = record(unit.hp),
          mp = record(unit.mp);
        if ("hp" in effect)
          hp.cur = clamp(number(hp.cur) + number(effect.hp), 0, number(hp.max));
        if ("mp" in effect)
          mp.cur = clamp(number(mp.cur) + number(effect.mp), 0, number(mp.max));
        if ("mood" in effect)
          unit.mood = clamp(number(unit.mood) + number(effect.mood), 0, 1000);
        if ("aff" in effect)
          unit.affinity = clamp(
            number(unit.affinity) + number(effect.aff),
            -200,
            500,
          );
        unit.hp = hp;
        unit.mp = mp;
        inventory[itemId] = number(inventory[itemId]) - 1;
        c.state.items = inventory;
        return ok(c, {
          itemId,
          dollId,
          effect,
          hp,
          mp,
          mood: unit.mood,
          affinity: unit.affinity,
        });
      }),
      "gfl/item/sell": scoped((c) => {
        const itemId = string(c.params.itemId),
          definition = [...items(c.schema), ...equipment(c.schema)].find(
            (value) => value.id === itemId,
          ),
          inventory = record(c.state.items);
        if (!definition) return fail(c, "gfl_shop_unknown_item", itemId);
        if (number(inventory[itemId]) < 1)
          return fail(c, "gfl_item_not_owned", itemId);
        const price = Math.floor(number(definition.price) / 2);
        inventory[itemId] = number(inventory[itemId]) - 1;
        c.state.items = inventory;
        c.state.gold = number(c.state.gold) + price;
        return ok(c, { itemId, price });
      }),
      "gfl/equipment/equip": scoped((c) => {
        const dollId = string(c.params.dollId),
          equipmentId = string(c.params.equipmentId),
          unit = record(owned(c.state)[dollId]),
          definition = equipment(c.schema).find(
            (value) => value.id === equipmentId,
          ),
          inventory = record(c.state.items);
        if (!Object.keys(unit).length)
          return fail(c, "gfl_doll_not_owned", dollId);
        if (!definition) return fail(c, "gfl_unknown_equipment", equipmentId);
        if (number(inventory[equipmentId]) < 1)
          return fail(c, "gfl_equipment_not_owned", equipmentId);
        const banned = list<string>(definition.ban),
          only = list<string>(definition.only),
          klass = string(unit.class);
        if (banned.includes(klass) || (only.length && !only.includes(klass)))
          return fail(c, "gfl_equipment_class_restricted", klass);
        const equipped = list<string>(unit.equipment);
        if (equipped.length >= 2)
          return fail(c, "gfl_equipment_slots_full", dollId);
        inventory[equipmentId] = number(inventory[equipmentId]) - 1;
        equipped.push(equipmentId);
        unit.equipment = equipped;
        unit.power = number(unit.power) + Math.max(0, number(definition.power));
        c.state.items = inventory;
        return ok(c, { dollId, equipmentId, power: unit.power });
      }),
      "gfl/equipment/unequip": scoped((c) => {
        const dollId = string(c.params.dollId),
          equipmentId = string(c.params.equipmentId),
          unit = record(owned(c.state)[dollId]),
          definition = equipment(c.schema).find(
            (value) => value.id === equipmentId,
          ),
          inventory = record(c.state.items);
        if (!Object.keys(unit).length)
          return fail(c, "gfl_doll_not_owned", dollId);
        if (!definition) return fail(c, "gfl_unknown_equipment", equipmentId);
        const equipped = list<string>(unit.equipment),
          index = equipped.indexOf(equipmentId);
        if (index < 0)
          return fail(c, "gfl_equipment_not_equipped", equipmentId);
        equipped.splice(index, 1);
        unit.equipment = equipped;
        unit.power = Math.max(
          0,
          number(unit.power) - Math.max(0, number(definition.power)),
        );
        inventory[equipmentId] = number(inventory[equipmentId]) + 1;
        c.state.items = inventory;
        return ok(c, { dollId, equipmentId, power: unit.power });
      }),
      "gfl/doll/dismantle": scoped((c) => {
        if (baseLocation(c.state) !== "base-maintenance")
          return fail(c, "gfl_maintenance_required");
        const id = string(c.params.dollId),
          gfl = state(c.state),
          values = record(gfl.dolls),
          unit = record(values[id]);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", id);
        if (
          echelons(c.state).some((entry) =>
            list<unknown>(entry.slots).includes(id),
          )
        )
          return fail(c, "gfl_doll_in_echelon", id);
        if (
          queue(c.state, "repairs").some(
            (entry) => entry.dollId === id && entry.status === "active",
          )
        )
          return fail(c, "gfl_doll_in_repair", id);
        delete values[id];
        gfl.dolls = values;
        c.state.gfl = gfl;
        const resource = record(c.state.resources),
          cores = Math.max(1, Math.floor(number(unit.grade) / 2));
        resource.cores = number(resource.cores) + cores;
        resource.parts = number(resource.parts) + 1;
        c.state.resources = resource;
        return ok(c, { dollId: id, cores, parts: 1 });
      }),
      "gfl/fairy/acquire": scoped((c) => {
        const id = string(c.params.fairyId),
          definition = fairies(c.schema).find((value) => value.id === id),
          gfl = state(c.state),
          values = record(gfl.fairies);
        if (!definition) return fail(c, "gfl_unknown_fairy", id);
        if (values[id]) return fail(c, "gfl_fairy_owned", id);
        const missing = spend(c, { gold: 1000, res: 500 });
        if (missing) return fail(c, "gfl_fairy_cost_missing", missing);
        values[id] = {
          ...definition,
          level: 1,
          power: Math.max(100, number(definition.power, 300)),
        };
        gfl.fairies = values;
        c.state.gfl = gfl;
        return ok(c, { fairyId: id });
      }),
      "gfl/fairy/assign": scoped((c) => {
        const id = string(c.params.fairyId),
          entry = formation(c.state, c.params.echelonId),
          gfl = state(c.state);
        if (!entry) return fail(c, "gfl_unknown_echelon", c.params.echelonId);
        if (!record(gfl.fairies)[id]) return fail(c, "gfl_fairy_not_owned", id);
        for (const echelon of echelons(c.state))
          if (echelon.fairyId === id) echelon.fairyId = null;
        entry.fairyId = id;
        gfl.echelons = echelons(c.state);
        c.state.gfl = gfl;
        return ok(c, { echelonId: entry.id, fairyId: id });
      }),
    },
    {
      "gfl/status": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          gfl = state(value),
          sortie = record(gfl.sortie),
          locationId = baseLocation(value),
          location = locations(schema).find((entry) => entry.id === locationId);
        return {
          started: !!gfl.started,
          mode: gfl.mode ?? null,
          day: value.day ?? record(value.clock).day ?? 1,
          phase: record(value.clock).phase ?? "오전",
          time: record(value.clock).hour ?? 8,
          funds: value.gold ?? 0,
          resources: record(value.resources).res ?? 0,
          parts: record(value.resources).parts ?? 0,
          dolls: Object.keys(record(gfl.dolls)).length,
          locationId,
          locationName: location?.name ?? locationId,
          effectiveLocation:
            sortie.active && sortie.command === "field"
              ? {
                  id: `mission:${sortie.missionId}`,
                  name: `작전 현장 · ${sortie.missionId}`,
                }
              : { id: locationId, name: location?.name ?? locationId },
          sortie: sortie.active ? sortie : null,
          lastCheck: gfl.lastCheck ?? null,
          lastBattle: gfl.lastBattle ?? null,
          featuredDollId: gfl.featuredDollId ?? null,
          followUp: activeFollowUp(value),
          dialogue: activeDialogue(value),
          settings: { relationDifficulty: relationDifficulty(value).id },
          commander: commanderStatus(value),
        };
      },
      "gfl/relation/options": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          today = day(value),
          days = record(state(value).dialogueDays),
          entries = Object.values(owned(value)).map((raw) => {
            const unit = record(raw),
              dollId = string(unit.id),
              tier = relationFor(schema, unit.affinity),
              usage = relationUsage(value, dollId),
              choices = Object.entries(RELATION_CHOICES)
                .map(([id, choice]) => {
                  const requiredTier = choiceMinTier(schema, choice),
                    used = number(usage.choices[id]),
                    reason =
                      tier.index < requiredTier
                        ? "tier_locked"
                        : usage.total >= RELATION_DAILY_LIMIT
                          ? "exhausted"
                          : used >= RELATION_CHOICE_DAILY_LIMIT
                            ? "choice_exhausted"
                            : null;
                  return {
                    id,
                    label: choice.label,
                    dc: choice.dc,
                    affinity: choice.affinity,
                    mood: choice.mood,
                    minTier: requiredTier,
                    requiredTierLabel: relationTierName(schema, requiredTier),
                    used,
                    maxUses: RELATION_CHOICE_DAILY_LIMIT,
                    available: !reason,
                    reason,
                  };
                })
                .sort((a, b) => a.minTier - b.minTier || a.dc - b.dc);
            return [
              dollId,
              {
                tier: { label: tier.label, index: tier.index },
                remaining: Math.max(0, RELATION_DAILY_LIMIT - usage.total),
                dialogueUsed: number(days[dollId]) === today,
                choices,
              },
            ] as const;
          });
        return {
          dolls: Object.fromEntries(entries),
          followUp: activeFollowUp(value),
          dialogue: activeDialogue(value),
          limits: { daily: RELATION_DAILY_LIMIT, perChoice: RELATION_CHOICE_DAILY_LIMIT },
        };
      },
      "gfl/locations": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          currentId = baseLocation(value),
          sortie = fieldSortie(value);
        return {
          currentId,
          locked: Boolean(sortie),
          locations: locations(schema).map((entry) => ({
            ...entry,
            current: entry.id === currentId,
            reachable:
              !sortie &&
              (currentId !== "base-outside" || entry.id === "base-hall"),
          })),
        };
      },
  "gfl/dolls": (...args) => {
    const schema = record(args[0]);
    return Object.values(owned(record(args[1]))).map((raw) => {
      const unit = record(raw);
      return { ...unit, relation: relationFor(schema, unit.affinity) };
    });
  },
      "gfl/echelons": (...args) =>
        echelons(record(args[1])).map((entry) => ({
          ...entry,
          slots: list<unknown>(entry.slots).map((id, index) => ({ id, row: gflFormationRow(index) })),
          rawPower: power(record(args[1]), entry),
          power: effectivePower(record(args[1]), entry),
          trainingBonus:
            TRAINING_BONUS[facilityLevel(record(args[1]), "base1") - 1],
        })),
      "gfl/missions": (...args) =>
        missions(record(args[0])).map((value) => ({
          ...value,
          ...factionSummary(value),
          completed: list<string>(
            state(record(args[1])).completedMissions,
          ).includes(string(value.id)),
          unlocked: missionUnlocked(record(args[0]), record(args[1]), value),
        })),
      "gfl/daily": (...args) => {
        const value = record(args[1]), daily = dailyState(value), tasks = dailyTasks(daily),
          completed = tasks.filter(task => task.progress >= task.target).length,
          claimed = list<number>(daily.claimed), sortieLimit = commanderStatus(value).sortieLimit;
        return {
          day: number(daily.day),
          sortiesUsed: number(daily.sortiesUsed),
          sortieLimit,
          sortiesRemaining: Math.max(0, sortieLimit - number(daily.sortiesUsed)),
          tasks,
          completed,
          claimed,
          milestones: [
            { target: 2, gold: 300, res: 150, claimed: claimed.includes(2) },
            { target: 4, gold: 700, res: 350, claimed: claimed.includes(4) },
          ],
        };
      },
      "gfl/theaters": (...args) =>
        list<RuntimeRecord>(config(record(args[0])).theaters),
      "gfl/queues": (...args) => ({
        manufacturing: queue(record(args[1]), "manufacturing"),
        repairs: queue(record(args[1]), "repairs"),
      }),
      "gfl/hire": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          gfl = state(value),
          today = day(value),
          capacity = dollCapacity(schema, value);
        return {
          offers: list<RuntimeRecord>(gfl.hireOffers),
          available: dolls(schema)
            .filter((entry) => !owned(value)[entry.id])
            .map((entry) => ({
              id: entry.id,
              name: entry.name,
              class: entry.class,
              grade: entry.grade,
              price: number(entry.price, 5000),
              snipePrice:
                number(entry.price, 5000) +
                number(hireConfig(schema).snipePremium, 3000),
              description: entry.description,
              asset: entry.asset,
            })),
          capacity,
          count: Object.keys(owned(value)).length,
          hiredToday: gfl.hiredDay === today,
          canRefresh: gfl.hireRefreshDay !== today,
          offerDay: gfl.hireOfferDay ?? null,
          arrivals: Object.values(owned(value)).filter(
            (entry) => record(entry).status === "이동 중",
          ),
        };
      },
      "gfl/facilities": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          levels = record(state(value).facilities);
        return list<RuntimeRecord>(config(schema).facilities).map(
          (definition) => {
            const level = number(levels[string(definition.id)], 1),
              maxLevel = number(definition.maxLevel, 5);
            return {
              ...definition,
              level,
              maxLevel,
              cost: level < maxLevel ? facilityCost(definition, level) : null,
              currentEffect:
                list<unknown>(definition.effects)[level - 1] ?? null,
              nextEffect:
                level < maxLevel
                  ? (list<unknown>(definition.effects)[level] ?? null)
                  : null,
            };
          },
        );
      },
      "gfl/shop": (...args) => {
        const schema = record(args[0]),
          value = record(args[1]),
          inventory = record(value.items);
        return {
          catalog: [...items(schema), ...equipment(schema)].map((entry) => ({
            ...entry,
            owned: number(inventory[string(entry.id)]),
            kind: equipment(schema).some((item) => item.id === entry.id)
              ? "equipment"
              : "item",
          })),
          fairyCatalog: fairies(schema),
          fairies: Object.values(record(state(value).fairies)),
        };
      },
    },
    (schema, value) => {
      const gfl = state(value),
        locationId = baseLocation(value),
        location = locations(schema).find((entry) => entry.id === locationId),
        clock = record(value.clock),
        units = Object.values(owned(value)).map((raw) => {
          const unit = record(raw);
          return {
            id: unit.id,
            name: unit.name,
        mood: unit.mood,
        affinity: unit.affinity,
        relation: relationFor(schema, unit.affinity).label,
        status: unit.status,
          };
        });
      return {
        commander: {
          locationId,
          locationName: location?.name ?? gfl.currentLocationName ?? locationId,
          fieldMission: fieldSortie(value)?.missionId ?? null,
        },
        time: {
          day: day(value),
          phase: clock.phase ?? "오전",
          hour: clock.hour ?? 8,
        },
        resources: {
          funds: value.gold ?? 0,
          supplies: record(value.resources).res ?? 0,
        },
        dolls: units,
        operation: record(gfl.sortie).active
          ? {
              status: "교전 대기",
              missionId: record(gfl.sortie).missionId,
              instruction:
                "아직 승패가 확정되지 않았다. 사용자가 채팅 아래 '빠른 교전 시작' 버튼을 누르기 전에는 전투 결과·피해·보상을 서사로 확정하지 않는다.",
            }
          : gfl.lastBattle ?? null,
        ...(() => {
          const dialogue = activeDialogue(value);
          if (!dialogue) return {};
          const unit = record(owned(value)[string(dialogue.dollId)]),
            name = string(unit.name || dialogue.name),
            tier = relationFor(schema, unit.affinity);
          return {
            dialogue: {
              with: name,
              relation: tier.label,
              ...(tier.description ? { relationNote: tier.description } : {}),
              rule: `시간이 멈춘 1:1 대화 장면이다. ${name}와의 대화에만 집중하고, 다른 인형의 등장·작전 진행·시간 경과·수치 변화를 서술하지 않는다. 보너스는 대화를 마무리할 때 엔진이 확정한다.`,
            },
          };
        })(),
        rule: "위치·시간·자원·관계·전투 결과는 엔진 확정값이다. [[aff=...]]·[[mood=...]] 같은 AI 제안 태그로 바꾸지 말고, 판정 로그의 실제 증감만 서술한다.",
      };
    },
  );
}
