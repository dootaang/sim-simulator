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
type CombatSkill = { cost: number; round: number; effect: string };
const CLASS_COMBAT: Record<string,{aggro:number;damageTaken:number;vsMaxHp?:number;round1?:number;round3plus?:number;hitBuffAlly?:number;illumination?:number;skill?:CombatSkill}> = {
  AR: { aggro: 1, damageTaken: 1, skill: { cost: 240, round: 2, effect: "double_attack" } },
  SMG: { aggro: 3, damageTaken: .68, skill: { cost: 180, round: 1, effect: "draw_fire" } },
  SG: { aggro: 4, damageTaken: .6, skill: { cost: 180, round: 1, effect: "fortify" } },
  MG: { aggro: 1, damageTaken: 1, round1: 1.4, round3plus: .8, skill: { cost: 240, round: 1, effect: "opening_barrage" } },
  RF: { aggro: .5, damageTaken: 1, vsMaxHp: 1.3, skill: { cost: 300, round: 2, effect: "sure_critical" } },
  HG: { aggro: .5, damageTaken: 1, hitBuffAlly: 1, illumination: 2, skill: { cost: 180, round: 1, effect: "command_buff" } },
  BOSS: { aggro: 1.5, damageTaken: .9 },
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
const FACTION_COUNTER: Record<string,{advantaged:string[];label:string;badge:string}> = {
  "철혈": { advantaged: ["RF","MG"], label: "기계 장갑 부대 — RF·MG 유리", badge: "⚙" },
  "E.L.I.D": { advantaged: ["MG","SG","AR"], label: "감염 군집 — MG·SG·AR 유리", badge: "☣" },
  "바랴그단": { advantaged: [], label: "적성 인형 부대 — 상성 중립", badge: "🎯" },
  "패러데우스": { advantaged: ["SG","SMG"], label: "정예 화력 — 방패 병과 가치 상승", badge: "⬡" },
};
const FORMATION_GUIDE = Object.fromEntries(Object.entries(CLASS_COMBAT).filter(([name]) => name !== "BOSS").map(([name, profile]) => [name,
  profile.damageTaken < 1 ? "전열" : profile.round1 || profile.round3plus || profile.vsMaxHp ? "후열" : "중열",
])) as Record<string,FormationRow>;
const combatProfile = (className: unknown) => CLASS_COMBAT[string(className)] ?? CLASS_COMBAT.AR!;
// 진형 정원(3열×2). 배치 검증·패딩이 전부 이 상수를 봐야 한다 — 5칸 시절 숫자를 남기면 6번째 칸이 죽는다.
export const FORMATION_SIZE = 6;
export function gflSealMigration(value: RuntimeRecord) {
  const gfl = record(value.gfl);
  for (const raw of list<RuntimeRecord>(gfl.echelons)) {
    if (!Array.isArray(raw.slots) || raw.slots.length >= FORMATION_SIZE) continue;
    const slots = [...raw.slots];
    while (slots.length < FORMATION_SIZE) slots.push(null);
    raw.slots = slots;
  }
  return value;
}
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
const documents = (schema: RuntimeRecord) => list<RuntimeRecord>(config(schema).documents);
const bosses = (schema: RuntimeRecord) => list<Doll>(config(schema).bosses);
const boss = (schema: RuntimeRecord, value: unknown) =>
  bosses(schema).find((entry) => entry.id === value || entry.name === value);
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
    records: { kills: 0, crits: 0, guarded: 0 },
    hiredDay: day(c.state),
    secretHobby: SECRET_HOBBIES[stableIndex(`${definition.id}:${day(c.state)}`, SECRET_HOBBIES.length)],
    ...(definition.squad ? { squad: definition.squad } : {}),
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
    (sum, id) => {
      const unit = record(values[string(id)]), base = number(unit.power);
      return sum + base * (unit.oathed === true ? 1.05 : 1);
    },
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
  return sortie.active && string(sortie.deploymentCommand || sortie.command) === "field" ? sortie : null;
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
// ── 기지 근무(5차) ── 시설별 슬롯 2·병과 적성. 효과·소모 수치는 Lucky 합성(GIRLS-FRONTLINE.md 기재).
const CREW_FACILITIES: Record<string, { aptitude: string[]; effectLabel: string }> = {
  base1: { aptitude: ["AR", "RF"], effectLabel: "제대 훈련 보너스 +2%p/인" },
  base2: { aptitude: ["SG", "MG"], effectLabel: "습격 확률 −2%p·방어 +5%/인" },
  base3: { aptitude: ["SMG"], effectLabel: "수복 시작 단계 −1/인" },
  base4: { aptitude: ["HG"], effectLabel: "일일 산출 +8%/인" },
};
const CREW_SLOTS = 2, CREW_LOW_MOOD = 20;
// 불만도 — 게이지 존재·시작 0·단계 문턱과 문구는 카드 회수(A_diss/A_diss_t 체인 실측),
// 증감 규칙은 합성(원본은 LLM 태그 [[diss=..]] 제안이었고 Lucky는 그 태그를 차단한다).
const DISS_TIERS = [
  { max: 0, label: "기본 상태", text: "매우 통상적인 상태며 만족하고 있습니다." },
  { max: 25, label: "사소한 불만", text: "사소한 불만이 돌고 있지만, 통제 가능한 수준입니다." },
  { max: 50, label: "경계 상태", text: "인형들의 불만이 누적되어 분위기가 험악해지고 있습니다." },
  { max: 75, label: "위험 상태", text: "명령 불복종이 발생할 수 있을 정도로 불만이 팽배합니다." },
  { max: 100, label: "통제 불능", text: "언제 폭동이나 집단 파업이 발생해도 이상하지 않은 최고조의 불만 상태입니다!!" },
] as const;
const REFINERY_RECIPES: Record<string, { label: string; cost: Record<string, number>; yield: Record<string, number>; duration: number }> = {
  parts: { label: "부품 가공", cost: { res: 200 }, yield: { parts: 20 }, duration: 2 },
  cores: { label: "코어 정련", cost: { parts: 30 }, yield: { cores: 1 }, duration: 4 },
};
const FACILITY_BRANCHES: Record<string, Array<{ id: string; label: string; desc: string }>> = {
  base1: [
    { id: "assault", label: "강습 교리", desc: "제대 훈련 보너스 +5%p" },
    { id: "guard", label: "수비 교리", desc: "습격 방어 작전능력 +10%" },
  ],
  base2: [
    { id: "intercept", label: "요격 체계", desc: "습격 확률 −5%p" },
    { id: "bulwark", label: "철벽 체계", desc: "습격 피해 절반" },
  ],
  base3: [
    { id: "rapid", label: "고속 정비", desc: "수복 시작 단계 −1" },
    { id: "precision", label: "정밀 정비", desc: "수복 3회마다 부품 무료" },
  ],
  base4: [
    { id: "finance", label: "재정 특화", desc: "일일 산출의 15%를 자금으로 추가" },
    { id: "materiel", label: "물자 특화", desc: "일일 자원 산출 +15%" },
  ],
};
function crewMap(value: RuntimeRecord) {
  return record(state(value).crew);
}
function crewWorkers(value: RuntimeRecord, facilityId: string) {
  return list<string>(crewMap(value)[facilityId]).filter((id) => Object.keys(record(owned(value)[id])).length > 0);
}
function crewFacilityOf(value: RuntimeRecord, dollId: string) {
  for (const facilityId of Object.keys(CREW_FACILITIES)) if (crewWorkers(value, facilityId).includes(dollId)) return facilityId;
  return null;
}
function specializationOf(value: RuntimeRecord, facilityId: string) {
  return string(record(state(value).specializations)[facilityId]) || null;
}
// 근무 효과 배율: 기분<20이면 절반, 적성 일치 1.5배, 같은 소대 동료가 같은 시설이면 +20%.
// 태만 사건이 찍힌 날은 그 시설 효과가 통째로 0이다.
function crewEffect(value: RuntimeRecord, facilityId: string) {
  const spec = CREW_FACILITIES[facilityId];
  if (!spec) return 0;
  if (number(record(state(value).facilitySlack)[facilityId]) === day(value)) return 0;
  const workers = crewWorkers(value, facilityId);
  let total = 0;
  for (const id of workers) {
    const unit = record(owned(value)[id]);
    let factor = spec.aptitude.includes(string(unit.class)) ? 1.5 : 1;
    if (number(unit.mood) < CREW_LOW_MOOD) factor *= 0.5;
    const squad = string(unit.squad);
    if (squad && workers.some((other) => other !== id && string(record(owned(value)[other]).squad) === squad)) factor *= 1.2;
    total += factor;
  }
  return total;
}
function dissatisfaction(value: RuntimeRecord) {
  return clamp(number(state(value).dissatisfaction), 0, 100);
}
function dissTier(value: RuntimeRecord) {
  const score = dissatisfaction(value);
  return DISS_TIERS.find((tier) => score <= tier.max) ?? DISS_TIERS[DISS_TIERS.length - 1]!;
}
function refineryJobs(value: RuntimeRecord) {
  return list<RuntimeRecord>(state(value).refinery);
}
function dollCapacity(schema: RuntimeRecord, value: RuntimeRecord) {
  const level = facilityLevel(value, "base5"),
    values = list<number>(hireConfig(schema).capacity);
  return number(values[level - 1], DORM_CAPACITY[level - 1]!);
}
function effectivePower(value: RuntimeRecord, echelon: RuntimeRecord) {
  const raw = power(value, echelon),
    bonus = TRAINING_BONUS[facilityLevel(value, "base1") - 1]!
      + crewEffect(value, "base1") * 2
      + (specializationOf(value, "base1") === "assault" ? 5 : 0);
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
function missionRisk(formationPower: number, requiredPower: number, commanderBonus = 0, fieldModifier = 0) {
  const ratio = formationPower / Math.max(1, requiredPower), baseModifier = clamp(Math.round(10 * Math.log2(Math.max(.1, ratio))), -10, 8),
    modifier = baseModifier + commanderBonus + fieldModifier;
  let wins = 0;
  for (let roll = 1; roll <= 20; roll++) if (roll === 20 || (roll !== 1 && roll + modifier >= 8)) wins++;
  const chance = wins * 5, label = chance < 30 ? "극위험" : chance < 60 ? "위험" : chance < 85 ? "보통" : "안정";
  return { ratio: Math.round(ratio * 100), modifier, baseModifier, commanderBonus, fieldModifier, chance, chanceLow: Math.max(5, chance - 5), chanceHigh: Math.min(95, chance + 5), label };
}

function logistics(value: RuntimeRecord) {
  return queue(value, "logistics");
}
function echelonLogistics(value: RuntimeRecord, echelonId: unknown) {
  return logistics(value).find((job) => job.echelonId === echelonId && (job.status === "active" || job.status === "complete"));
}
function nightSortie(value: RuntimeRecord, entry: RuntimeRecord) {
  const phase = string(record(value.clock).phase), night = phase === "심야" || phase === "새벽",
    values = owned(value), illumination = Math.min(4, list<unknown>(entry.slots).reduce<number>((sum, id) => {
      const unit = record(values[string(id)]);
      return sum + number(combatProfile(unit.class).illumination);
    }, 0));
  return { night, phase, illumination, hgCount: illumination / 2, modifier: night ? -3 + illumination : 0 };
}
function moodClamp(unit: RuntimeRecord, value: number) {
  return clamp(value, unit.oathed === true ? 30 : 0, 1000);
}
function loveTierIndex(schema: RuntimeRecord) {
  const names = list<string>(record(config(schema).relation).names), named = names.indexOf("사랑");
  return named >= 0 ? named : clamp(relationFor(schema, 0).index + 5, 0, Math.max(0, names.length - 1));
}
function resolveDailyRaid(c: Context) {
  const defenseLevel = facilityLevel(c.state, "base2"),
    chance = Math.max(2, Math.round(18 - defenseLevel * 3 - crewEffect(c.state, "base2") * 2 - (specializationOf(c.state, "base2") === "intercept" ? 5 : 0))),
    raidRoll = c.rng.int(1, 100), defenseRoll = c.rng.int(1, 20), occurred = raidRoll <= chance,
    completed = list<string>(state(c.state).completedMissions), recentId = completed.at(-1), recent = mission(c.schema, recentId),
    enemyPower = recent ? Math.max(1, Math.round(number(recent.power) * .6)) : 500,
    first = echelons(c.state)[0], rawDefense = first ? effectivePower(c.state, first) : 0,
    defensePower = Math.round(rawDefense * (1 + DEFENSE_POWER[defenseLevel - 1]! / 100 + crewEffect(c.state, "base2") * .05)
      * (specializationOf(c.state, "base1") === "guard" ? 1.1 : 1)),
    risk = missionRisk(defensePower, enemyPower), success = occurred && (defenseRoll === 20 || (defenseRoll !== 1 && defenseRoll + risk.modifier >= 8)),
    resources = record(c.state.resources);
  let delta = 0, loss = 0;
  if (occurred && success) { delta = 100; resources.res = number(resources.res) + delta; }
  else if (occurred) {
    loss = Math.min(500, Math.floor(number(resources.res) * .1));
    if (specializationOf(c.state, "base2") === "bulwark") loss = Math.ceil(loss / 2);
    delta = -loss; resources.res = Math.max(0, number(resources.res) - loss);
    if (first) for (const id of list<unknown>(first.slots).map(string).filter(Boolean)) {
      const unit = record(owned(c.state)[id]), hp = record(unit.hp);
      if (!Object.keys(unit).length) continue;
      hp.cur = Math.max(0, number(hp.cur) - Math.ceil(number(hp.max) * .15)); unit.hp = hp;
      if (number(hp.cur) <= 0) unit.status = "대파"; else if (number(hp.cur) < number(hp.max)) unit.status = "손상";
    }
  }
  c.state.resources = resources;
  return { occurred, chance, raidRoll, defenseRoll, success, defensePower, enemyPower, missionId: recentId ?? null, modifier: risk.modifier, resourceDelta: delta, loss };
}
// 하루 마감의 기지 사회 정산 — 불만도 증감(합성 규칙·회수 문턱), 태만·항명·뜬소문·암시장 감사.
// RNG 규율: 문턱 미달이어도 모든 굴림을 소비한다(사건 유무가 소비 횟수를 바꾸지 않는다).
function resolveBaseSocial(c: Context, raid: RuntimeRecord, defeats: number) {
  const gfl = state(c.state), dolls = Object.values(owned(c.state)).map(record);
  const lowMood = dolls.filter((unit) => number(unit.mood) < CREW_LOW_MOOD).length,
    avgMood = dolls.length ? dolls.reduce((sum, unit) => sum + number(unit.mood), 0) / dolls.length : 100,
    oathed = dolls.filter((unit) => unit.oathed === true).length,
    raidLoss = number(raid.loss) > 0 ? 5 : 0;
  let diss = dissatisfaction(c.state) + lowMood * 2 + raidLoss + defeats * 3;
  if (avgMood >= 60) diss -= 5;
  diss = clamp(diss - oathed, 0, 100);
  gfl.dissatisfaction = diss;
  const slackRoll = c.rng.int(1, 100), slackPick = c.rng.int(1, 1000),
    mutinyRoll = c.rng.int(1, 100), mutinyPick = c.rng.int(1, 1000),
    gossipRoll = c.rng.int(1, 100), gossipPickA = c.rng.int(1, 1000), gossipPickB = c.rng.int(1, 1000),
    auditRoll = c.rng.int(1, 20), offerRolls = [c.rng.int(1, 1000), c.rng.int(1, 1000), c.rng.int(1, 1000)];
  const social: RuntimeRecord = { dissatisfaction: diss, dissTier: dissTier(c.state).label };
  const workers = Object.keys(CREW_FACILITIES)
    .flatMap((facilityId) => crewWorkers(c.state, facilityId).map((dollId) => ({ facilityId, dollId })))
    .filter((entry) => entry.dollId !== string(gfl.lastSlacker));
  if (diss >= 50 && slackRoll <= diss - 40 && workers.length) {
    const pick = workers[(slackPick - 1) % workers.length]!,
      facilitySlack = record(gfl.facilitySlack);
    facilitySlack[pick.facilityId] = day(c.state);
    gfl.facilitySlack = facilitySlack;
    gfl.lastSlacker = pick.dollId;
    social.slack = { ...pick, name: record(owned(c.state)[pick.dollId]).name };
  }
  const mutinyCandidates = dolls.filter((unit) => string(unit.status) !== "대파" && unit.refusal !== true && string(unit.id) !== string(gfl.lastMutineer));
  if (diss >= 80 && mutinyRoll <= diss - 70 && mutinyCandidates.length) {
    const unit = mutinyCandidates[(mutinyPick - 1) % mutinyCandidates.length]!;
    unit.refusal = true;
    gfl.lastMutineer = unit.id;
    social.mutiny = { dollId: unit.id, name: unit.name };
  }
  const gossipMode = string(record(gfl.settings).gossip || "mild"),
    gossipCandidates = dolls.filter((unit) => string(unit.id) !== string(gfl.lastGossipTarget));
  if (gossipMode !== "off" && diss >= 50 && gossipRoll <= 25 && gossipCandidates.length >= 2) {
    const first = gossipCandidates[(gossipPickA - 1) % gossipCandidates.length]!,
      rest = gossipCandidates.filter((unit) => unit !== first),
      second = rest[(gossipPickB - 1) % rest.length]!;
    first.mood = moodClamp(first, number(first.mood) - 10);
    second.mood = moodClamp(second, number(second.mood) - 10);
    if (gossipMode === "full") first.affinity = clamp(number(first.affinity) - 5, -200, 500);
    gfl.lastGossipTarget = first.id;
    social.gossip = { mode: gossipMode, targets: [{ dollId: first.id, name: first.name }, { dollId: second.id, name: second.name }] };
  }
  const today = day(c.state), market = record(gfl.market);
  let suspicion = number(market.suspicion);
  if (today % 7 === 0) {
    suspicion = Math.max(0, suspicion - 2);
    const pool: RuntimeRecord[] = [
      ...items(c.schema).map((entry): RuntimeRecord => ({ ...record(entry), kind: "item" })),
      ...equipment(c.schema).map((entry): RuntimeRecord => ({ ...record(entry), kind: "equipment" })),
    ].filter((entry) => number(entry.price) > 0);
    if (pool.length) {
      const offers = offerRolls.map((roll, index) => {
        const entry = pool[(roll - 1 + index * 7) % pool.length]!;
        return { id: `offer-${today}-${index}`, itemId: string(entry.id), kind: entry.kind, name: entry.name, price: Math.max(1, Math.floor(number(entry.price) * .6)) };
      });
      gfl.market = { day: today, offers, suspicion, purchased: [] };
      social.market = { day: today, offers: offers.length };
    }
  } else if (Object.keys(market).length) {
    market.suspicion = suspicion;
    gfl.market = market;
  }
  if (suspicion >= 20) {
    if (auditRoll < 12) {
      const seized = Math.floor(number(c.state.gold) * .2);
      c.state.gold = number(c.state.gold) - seized;
      gfl.dissatisfaction = clamp(number(gfl.dissatisfaction) + 10, 0, 100);
      const audited = record(gfl.market);
      audited.suspicion = 0;
      gfl.market = audited;
      social.audit = { caught: true, seized };
    } else social.audit = { caught: false };
  }
  c.state.gfl = gfl;
  return social;
}
type RelationChoice = {
  label: string;
  dc: number;
  affinity: number;
  mood: number;
  tierOffset: number;
  followups: string[];
};
const CLASS_PREFERENCES: Record<string,{preferred:string;disliked:string}> = {
  AR: { preferred: "train", disliked: "coffee" }, SMG: { preferred: "walk", disliked: "ask-past" },
  RF: { preferred: "talk", disliked: "train" }, HG: { preferred: "coffee", disliked: "walk" },
  MG: { preferred: "encourage", disliked: "confide" }, SG: { preferred: "train", disliked: "coffee" },
};
const SECRET_HOBBIES = ["모형 수집","몰래 낮잠","매운맛 중독","낡은 음반 감상","별자리 관측","화분 돌보기","퍼즐 맞추기","수제 과자","고전 영화","기계 시계 수리","길고양이 돌보기","손편지 쓰기"] as const;
const OUTING_PLACES = ["시장 거리","강변 방벽","옛 카페"] as const;
const PROMISE_TYPES = ["sortie","repair","anniversary"] as const;
function stableIndex(value: string, size: number) { let hash = 2166136261; for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return Math.abs(hash) % Math.max(1, size); }
function preferenceOf(unit: RuntimeRecord) { return CLASS_PREFERENCES[string(unit.class)] ?? { preferred: "talk", disliked: "train" }; }
function markInteraction(value: RuntimeRecord, dollId: string) { const gfl = state(value), rows = record(gfl.lastInteractions); rows[dollId] = day(value); gfl.lastInteractions = rows; }
function fulfillPromise(value: RuntimeRecord, dollId: string, type: string) { const promise = list<RuntimeRecord>(state(value).promises).find((entry) => entry.dollId === dollId && entry.type === type && entry.fulfilled !== true); if (promise) promise.fulfilled = true; }
function confirmTrauma(unit: RuntimeRecord) {
  const candidate = record(unit.traumaCandidate); if (!Object.keys(candidate).length || unit.trauma) return;
  unit.trauma = candidate.night === true ? "야간 공포" : candidate.boss === true ? "포화 공포" : "철혈 공포";
  unit.traumaProgress = 0; unit.traumaCandidate = null;
}
// 관계 선택지 사다리. 티어 문턱은 카드에서 회수한 relation(REL_NAMES/REL_THRES)을 그대로 쓰고,
// 선택지 구성·DC·증감은 Lucky 합성 규칙이다(원본 Choice 캡슐의 %는 LLM 임의값이라 회수 대상이 아님).
// talk/nickname/encourage 3종의 id와 수치는 기존 저장 회차가 재생하는 값이므로 바꾸지 않는다.
const RELATION_CHOICES: Record<string, RelationChoice> = {
  talk: { label: "차분히 대화한다", dc: 8, affinity: 3, mood: 10, tierOffset: -3, followups: ["nickname", "encourage"] },
  nickname: { label: "서로 부를 별명을 정한다", dc: 10, affinity: 5, mood: 25, tierOffset: 0, followups: ["encourage"] },
  encourage: { label: "진심으로 격려한다", dc: 12, affinity: 8, mood: 20, tierOffset: 0, followups: ["ask-past"] },
  "ask-past": { label: "지난 이야기를 묻는다", dc: 10, affinity: 5, mood: 15, tierOffset: 1, followups: ["confide"] },
  coffee: { label: "함께 커피를 마신다", dc: 9, affinity: 4, mood: 25, tierOffset: 1, followups: ["walk"] },
  train: { label: "함께 훈련한다", dc: 12, affinity: 7, mood: 15, tierOffset: 2, followups: ["encourage"] },
  walk: { label: "기지 주변을 함께 걷는다", dc: 11, affinity: 6, mood: 30, tierOffset: 2, followups: ["confide"] },
  confide: { label: "속마음을 나눈다", dc: 13, affinity: 10, mood: 25, tierOffset: 3, followups: ["promise"] },
  promise: { label: "소중한 약속을 나눈다", dc: 14, affinity: 12, mood: 30, tierOffset: 5, followups: [] },
  hobby: { label: "취미를 함께한다", dc: 7, affinity: 6, mood: 15, tierOffset: 0, followups: [] },
};
// 하루 상한 — 같은 인형에게 4회, 같은 선택지는 2회(2회째는 효과 절반). 격려 연타 파밍 차단.
const RELATION_DAILY_LIMIT = 4,
  RELATION_CHOICE_DAILY_LIMIT = 2;
function relationTierCount(schema: RuntimeRecord) {
  return list<string>(record(config(schema).relation).names).length;
}
// 카드의 티어 수보다 높은 요구치는 마지막 티어로 접는다. relation 설정이 없는 카드는 전부 개방.
function choiceRequiredTier(schema: RuntimeRecord, choice: RelationChoice) {
  const count = relationTierCount(schema);
  if (!count) return 0;
  const neutral = relationFor(schema, 0).index;
  return clamp(neutral + choice.tierOffset, 0, count - 1);
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
  for (let at = 0; at < thresholds.length; at++) {
    if (at > 0 && number(thresholds[at]) === number(thresholds[at - 1])) continue;
    if (score >= number(thresholds[at])) index = at;
  }
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

type OperationStageType = "battle" | "boss" | "recon" | "other" | "mystery";
const OPERATION_STAGE_WEIGHTS: Record<string, ReadonlyArray<readonly [OperationStageType, number]>> = {
  // 다단계 HP 소모전을 500시드로 검산해 원본 제안 45에서 허용 범위 하한인 25로 조정했다.
  sweep: [["battle", 25], ["recon", 20], ["other", 25], ["mystery", 30]],
  recon: [["battle", 15], ["recon", 40], ["other", 15], ["mystery", 30]],
  annihil: [["battle", 60], ["recon", 5], ["other", 10], ["mystery", 25]],
};
const DEFAULT_PROGRESS_BY_STAR = [3, 5, 7, 8, 9, 10, 11] as const;
const DEFAULT_EVENT_GUIDES: Record<OperationStageType, string> = {
  battle: "교전 상황. 이 단계는 반드시 실제 전투가 벌어져야 하며 우회·회피는 불가하다. 적과의 전투를 서술하라.",
  boss: "보스 교전. 지역 보스와의 결전을 서술하라.",
  recon: "정찰 상황. 전투 없이 지형·적정 탐색, 잠입, 관찰을 서술하라. 교전을 넣지 마라.",
  other: "돌발 상황. 민간인 구호, 지형 장애물, 보급 문제 등 비전투 이벤트를 서술하라. 교전을 넣지 마라.",
  mystery: "정체불명 상황. 무언가를 발견하거나 인기척을 감지한다. 교전으로 단정하지 말고 긴장감 있게 서술하라.",
};
function progressionConfig(schema: RuntimeRecord) {
  return record(config(schema).progression);
}
function stageGuide(schema: RuntimeRecord, type: OperationStageType) {
  return string(record(progressionConfig(schema).eventGuides)[type] || DEFAULT_EVENT_GUIDES[type]);
}
function operationStages(c: Context, operation: RuntimeRecord, missionType: string) {
  const progression = progressionConfig(c.schema), stars = clamp(Math.floor(number(operation.stars)), 0, 6),
    byStar = record(progression.byStar), missionTypes = list<RuntimeRecord>(progression.missionTypes),
    type = missionTypes.find((value) => value.key === missionType),
    stepMod = type ? number(type.stepMod) : missionType === "recon" ? -1 : missionType === "annihil" ? 1 : 0,
    count = Math.max(2, number(byStar[String(stars)], DEFAULT_PROGRESS_BY_STAR[stars]!) + stepMod),
    weights = OPERATION_STAGE_WEIGHTS[missionType]!, stages: RuntimeRecord[] = [];
  for (let index = 0; index < count; index++) {
    const roll = c.rng.int(1, 100);
    let cursor = 0;
    const selected = weights.find(([, weight]) => (cursor += weight) >= roll)?.[0] ?? "mystery";
    stages.push({ type: selected });
  }
  stages[count - 1] = { type: string(operation.boss).trim() ? "boss" : "battle" };
  if (!stages.slice(0, -1).some((value) => value.type === "battle"))
    stages[count - 2] = { type: "battle" };
  return stages;
}
function rollOperationLoot(c: Context) {
  const inventory = record(c.state.items), loot: RuntimeRecord[] = [];
  for (const item of items(c.schema)) {
    const roll = c.rng.int(1, 100), drop = Math.max(0, number(item.drop));
    if (roll <= drop) {
      inventory[string(item.id)] = number(inventory[string(item.id)]) + 1;
      loot.push({ id: item.id, name: item.name, qty: 1, roll, drop });
    }
  }
  c.state.items = inventory;
  return loot;
}
function availableEncounterDolls(c: Context) {
  const encounters = record(config(c.schema).encounters), banned = new Set(list<string>(encounters.ban)), values = owned(c.state);
  return list<string>(encounters.pool)
    .filter((id) => !banned.has(id) && !values[id])
    .flatMap((id) => { const definition = doll(c.schema, id); return definition ? [definition] : []; });
}

function resolveOperationStage(c: Context) {
  const gfl = state(c.state), sortie = record(gfl.sortie), stages = list<RuntimeRecord>(sortie.stages);
  if (!sortie.active || !stages.length) return fail(c, "gfl_sortie_missing");
  if (record(sortie.encounter).dollId) sortie.encounter = null;
  if (record(gfl.prisoner).active) gfl.prisoner = null;
  const current = clamp(number(sortie.current), 0, stages.length - 1), stage = record(stages[current]),
    type = string(stage.type) as OperationStageType, guide = stageGuide(c.schema, type);
  if (type === "battle" || type === "boss") {
    if (string(sortie.engagementMode) !== "quick") return fail(c, "gfl_sortie_tactic_required", type);
    return resolveSortie(c);
  }
  const effects: Record<string, () => RuntimeRecord> = {
    recon: () => { sortie.scouted = true; sortie.intel = Math.min(2, number(sortie.intel) + 1); return { scouted: true, intel: sortie.intel }; },
    other: () => {
      const roll = c.rng.int(1, 100), found = roll <= 40,
        amount = found ? 50 + Math.floor((roll - 1) * 100 / 39) : 0,
        resources = record(c.state.resources);
      if (found) resources.res = number(resources.res) + amount;
      c.state.resources = resources;
      return { roll, found, resource: found ? { id: "res", qty: amount } : null };
    },
    mystery: () => {
      const roll = c.rng.int(1, 100), pool = availableEncounterDolls(c), targetRoll = c.rng.int(1, Math.max(1, pool.length));
      if (roll <= 40) return { roll, targetRoll, branch: "loot", found: true, loot: rollOperationLoot(c) };
      if (roll <= 65 && pool.length && !sortie.encounterRecruited) {
        const target = pool[targetRoll - 1]!;
        sortie.encounter = { dollId: target.id, name: target.name };
        return { roll, targetRoll, branch: "encounter", found: true, encounter: sortie.encounter, loot: [] };
      }
      return { roll, targetRoll, branch: "none", found: false, loot: [] };
    },
  };
  const result = effects[type]?.() ?? {};
  stage.completed = true; stage.result = result; sortie.current = current + 1;
  sortie.command = Math.min(100, number(sortie.command) + 34);
  sortie.lastStage = { index: current, stageType: type, guide, ...result };
  gfl.sortie = sortie; c.state.gfl = gfl;
  return ok(c, { stageIndex: current, stageType: type, guide, current: sortie.current, total: stages.length, command: sortie.command, ...result });
}

function recruitEncounter(c: Context) {
  const gfl = state(c.state), sortie = record(gfl.sortie), encounter = record(sortie.encounter), definition = doll(c.schema, encounter.dollId);
  if (!sortie.active || !definition) return fail(c, "gfl_encounter_missing");
  if (sortie.encounterRecruited) return fail(c, "gfl_encounter_limit");
  const capacity = dollCapacity(c.schema, c.state), count = Object.keys(owned(c.state)).length;
  if (count >= capacity) return fail(c, "gfl_hire_capacity_full", capacity);
  if (!acquire(c, definition)) return fail(c, "gfl_doll_owned", definition.id);
  const next = state(c.state), nextSortie = record(next.sortie);
  nextSortie.encounter = null; nextSortie.encounterRecruited = true; next.sortie = nextSortie; c.state.gfl = next;
  return ok(c, { dollId: definition.id, name: definition.name, status: "대기", capacity, count: count + 1 });
}

function skipEncounter(c: Context) {
  const gfl = state(c.state), sortie = record(gfl.sortie), encounter = record(sortie.encounter);
  if (!sortie.active || !encounter.dollId) return fail(c, "gfl_encounter_missing");
  sortie.encounter = null; gfl.sortie = sortie; c.state.gfl = gfl;
  return ok(c, { dollId: encounter.dollId, skipped: true });
}

function retreatOperation(c: Context) {
  const gfl = state(c.state), sortie = record(gfl.sortie);
  if (!sortie.active) return fail(c, "gfl_sortie_missing");
  const result = { missionId: sortie.missionId, current: sortie.current, lootKept: true, completed: false };
  gfl.sortie = null; c.state.gfl = gfl; c.state.combat = null;
  return ok(c, result);
}

function resolveSortie(c: Context) {
  const gfl = state(c.state),
    sortie = record(gfl.sortie),
    operation = mission(c.schema, sortie.missionId),
    entry = formation(c.state, sortie.echelonId);
  if (!sortie.active || !operation || !entry)
    return fail(c, "gfl_sortie_missing");
  const stages = list<RuntimeRecord>(sortie.stages), currentStageIndex = clamp(number(sortie.current), 0, Math.max(0, stages.length - 1)),
    currentStage = record(stages[currentStageIndex]), stageType = string(currentStage.type || "battle") as OperationStageType;
  if (stages.length && stageType !== "battle" && stageType !== "boss") return fail(c, "gfl_sortie_stage_not_combat", stageType);
  if (record(gfl.prisoner).active) gfl.prisoner = null;
  const requestedIntervention = record(c.params.intervention);
  let intervention: RuntimeRecord | null = null;
  if (Object.keys(requestedIntervention).length) {
    const round = Math.floor(number(requestedIntervention.round)), type = string(requestedIntervention.type);
    if (round < 1 || round > 8 || !["focus", "brace", "barrage"].includes(type)) return fail(c, "gfl_intervention_invalid");
    if (record(sortie.intervention).type) return fail(c, "gfl_intervention_duplicate");
    if (number(sortie.command) < 100) return fail(c, "gfl_intervention_command_missing", number(sortie.command));
    intervention = { round, type };
    sortie.command = number(sortie.command) - 100;
    sortie.intervention = intervention;
  }

  const commanderBefore = commanderStatus(c.state),
    tactic = string(c.params.tactic || sortie.tactic || "balanced"),
    risk = missionRisk(number(sortie.power), number(operation.power), commanderBefore.checkBonus, number(sortie.nightHitModifier)),
    missionRoll = c.rng.int(1, 20),
    missionTotal = missionRoll + risk.modifier,
    condition = missionRoll === 20 || (missionRoll !== 1 && missionTotal >= 8) ? missionTotal >= 15 ? "favorable" : "steady" : missionTotal <= 2 ? "disastrous" : "unfavorable",
    conditionHit = condition === "favorable" ? 2 : condition === "unfavorable" ? -2 : condition === "disastrous" ? -4 : 0,
    tacticHit = (tactic === "focus" ? 2 : tactic === "cover" ? -2 : 0) + (sortie.scouted ? 1 : 0) + number(sortie.nightHitModifier),
    allyDamageFactor = tactic === "focus" ? 1.15 : tactic === "cover" ? .85 : 1,
    incomingFactor = (tactic === "focus" ? 1.15 : tactic === "cover" ? .7 : 1) * (condition === "favorable" ? .85 : condition === "unfavorable" ? 1.15 : condition === "disastrous" ? 1.3 : 1) * (stages.length ? .8 : 1),
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
          power: Math.max(1, number(unit.power, 1) * (unit.oathed === true ? 1.05 : 1)),
          grade: number(unit.grade, 1),
          class: string(unit.class), row, hpBefore: Math.max(0, number(hp.cur)),
        };
      });
  if (!allies.some((unit) => unit.hp > 0))
    return fail(c, "gfl_echelon_incapacitated");

  const configured = list<RuntimeRecord>(operation.enemies), bossName = string(operation.boss).trim(),
    bossDefinition = boss(c.schema, bossName),
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
    stageEncounterScale = stages.length >= 7 ? .9 : 1,
    totalEnemyPower = Math.max(100, number(operation.power, 100) * stageEncounterScale),
    enemies: GflCombatant[] = Array.from({ length: enemyCount }, (_, index) => {
      const isBoss = !configured.length && Boolean(bossName) && index === 0, source = configured[index] ?? {},
        unitPower = Math.max(
          20,
          isBoss && bossDefinition ? number(bossDefinition.power) : source.power === undefined ? Math.round(isBoss ? totalEnemyPower * .5 : bossName && !configured.length && enemyCount > 1 ? totalEnemyPower * .5 / (enemyCount - 1) : totalEnemyPower / enemyCount) : number(source.power) * stageEncounterScale,
        ),
        maxHp = Math.max(80, isBoss && bossDefinition ? number(bossDefinition.maxHp) : source.hp === undefined ? Math.round(isBoss ? unitPower * 1.1 : unitPower * .75) : number(source.hp) * stageEncounterScale);
      return {
        id: string(source.id || (isBoss ? bossDefinition?.id || "boss" : `enemy-${index + 1}`)),
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

  const hgHitBuff = Math.min(2, allies.reduce((sum, ally) => sum + number(combatProfile(ally.class).hitBuffAlly), 0)),
    skillUses: RuntimeRecord[] = [], panicChecks: RuntimeRecord[] = [];
  let panicTriggered = false;
  for (let round = 1; round <= 8; round++) {
    const exchanges: RuntimeRecord[] = [];
    const activeSkills = new Map<string, CombatSkill>();
    for (const ally of allies.filter((unit) => unit.hp > 0)) {
      if (sortie.ambush === true && round === 1) {
        exchanges.push({ side: "ally", actorId: ally.id, targetId: null, hit: false, damage: 0, ambush: true });
        continue;
      }
      const profile = combatProfile(ally.class), skill = profile.skill, unit = record(values[ally.id]), mp = record(unit.mp);
      if (!skill || skill.round !== round || number(mp.cur) < skill.cost) continue;
      mp.cur = number(mp.cur) - skill.cost; unit.mp = mp; activeSkills.set(ally.id, skill);
      const entry = { dollId: ally.id, name: ally.name, class: ally.class, round, cost: skill.cost, effect: skill.effect };
      skillUses.push(entry);
    }
    const hgSkillBuff = [...activeSkills.entries()].some(([id, skill]) => string(record(values[id]).class) === "HG" && skill.effect === "command_buff") ? 1 : 0;
    for (const ally of allies.filter((unit) => unit.hp > 0)) {
      const panic = record(record(ally).panic);
      if (number(panic.round) === round && panic.skip === true) {
        exchanges.push({ side: "ally", actorId: ally.id, targetId: null, hit: false, damage: 0, panic: "skip" });
        continue;
      }
      const attacks = activeSkills.get(ally.id)?.effect === "double_attack" ? 2 : 1;
      for (let attack = 0; attack < attacks; attack++) {
        const livingEnemies = enemies.filter((unit) => unit.hp > 0), target = intervention?.type === "focus" && number(intervention.round) === round
          ? [...livingEnemies].sort((a, b) => a.hp - b.hp)[0] : livingEnemies[0];
        if (!target) break;
        const profile = combatProfile(ally.class), skill = activeSkills.get(ally.id), counter = missionFaction.advantagedClasses.includes(string(ally.class)),
          roundFactor = round === 1 ? (skill?.effect === "opening_barrage" ? 1.56 : number(profile.round1, 1)) : round >= 3 ? number(profile.round3plus, 1) : 1,
          rowFactor = ally.row === "후열" && (profile.vsMaxHp || profile.round1) ? REAR_DAMAGE_BONUS : 1,
          maxEnemyHp = Math.max(...enemies.map((unit) => unit.maxHp)), maxHpFactor = profile.vsMaxHp && target.maxHp === maxEnemyHp ? profile.vsMaxHp : 1,
          roll = c.rng.int(1, 20), sureCritical = skill?.effect === "sure_critical",
          critical = sureCritical || roll === 20,
          supportHit = Math.min(5, hgHitBuff + hgSkillBuff + (counter ? 2 : 0) + (sortie.scouted ? 1 : 0)),
          panicHit = number(panic.round) === round ? -2 : 0,
          trauma = string(record(values[ally.id]).trauma), fearCondition = sortie.night === true ? "야간 공포" : stageType === "boss" ? "포화 공포" : missionFaction.factions.includes("철혈") || string(operation.enemy).includes("철혈") ? "철혈 공포" : "",
          traumaApplies = Boolean(fearCondition) && trauma === fearCondition,
          medalHit = Boolean(fearCondition) && string(record(values[ally.id]).overcomeMedal) === fearCondition ? 1 : 0,
          traumaHit = traumaApplies ? -2 : medalHit,
          hit = sureCritical || roll + number(ally.grade, 1) + conditionHit + tacticHit + supportHit + panicHit + traumaHit >= 8,
          skillFactor = skill?.effect === "double_attack" && attack === 1 || skill?.effect === "sure_critical" ? .8 : 1,
          dealt = hit ? Math.max(1, Math.round(ally.power * 0.24 * (critical ? 1.6 : 1) * allyDamageFactor * roundFactor * rowFactor * maxHpFactor * skillFactor - target.power * 0.02)) : 0,
          before = target.hp;
        target.hp = Math.max(0, target.hp - dealt);
        exchanges.push({ side: "ally", actorId: ally.id, targetId: target.id, roll, hit, critical, damage: dealt, targetHp: target.hp, kill: before > 0 && target.hp <= 0,
          counter, hitBuff: hgHitBuff + hgSkillBuff, supportHit, scoutedHit: sortie.scouted ? 1 : 0, panic: panicHit ? "hit-2" : null, traumaHit,
          roundFactor, rowFactor, maxHpFactor, skill: skill ? skill.effect : null, intervention: intervention && number(intervention.round) === round ? intervention.type : null });
      }
    }
    for (const foe of enemies.filter((unit) => unit.hp > 0)) {
      const living = allies.filter((unit) => unit.hp > 0);
      if (!living.length) break;
      const weights = living.map((unit) => Math.round(combatProfile(unit.class).aggro * (activeSkills.get(unit.id)?.effect === "draw_fire" ? 2 : 1) * ROW_AGGRO[unit.row ?? "후열"] * 100)),
        targetRoll = c.rng.int(1, weights.reduce((sum, weight) => sum + weight, 0));
      let cursor = 0;
      const target = living[weights.findIndex((weight) => (cursor += weight) >= targetRoll)]!,
        roll = c.rng.int(1, 20),
        critical = roll === 20,
        hit = roll + (intervention?.type === "barrage" && number(intervention.round) === round ? -3 : 0) >= 8,
        raw = hit
          ? Math.max(
              1,
              Math.round(
                foe.power * 0.16 * (critical ? 1.5 : 1) - target.power * 0.015,
              ),
            )
          : 0,
        skillReduction = activeSkills.get(target.id)?.effect === "draw_fire" ? .08 : activeSkills.get(target.id)?.effect === "fortify" ? .12 : 0,
        damageTaken = (target.row === "후열" ? 1 : combatProfile(target.class).damageTaken) - skillReduction,
        brace = intervention?.type === "brace" && number(intervention.round) === round ? .5 : 1,
        dealt = Math.max(0, Math.round(raw * damageTaken * (1 - defenseReduction / 100) * incomingFactor * brace));
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
        intervention: brace < 1 ? "brace" : intervention?.type === "barrage" && number(intervention.round) === round ? "barrage" : null,
      });
    }
    if (!panicTriggered && allies.some((unit) => unit.hp > 0 && unit.hp / unit.maxHp < .25 && number(unit.hpBefore) / unit.maxHp >= .25)) {
      panicTriggered = true;
      for (const ally of allies.filter((unit) => unit.hp > 0)) {
        const unit = record(values[ally.id]), roll = c.rng.int(1, 20), total = roll + Math.floor(number(unit.mood) / 100) + (unit.squad ? 1 : 0), success = total >= 8;
        const check = { dollId: ally.id, round, roll, total, success, criticalFailure: roll === 1 }; panicChecks.push(check);
        if (!success || roll === 1) (ally as RuntimeRecord).panic = { round: round + 1, skip: roll === 1 };
        if (roll === 1) unit.traumaCandidate = { cause: "panic", night: sortie.night === true, boss: stageType === "boss" };
      }
    }
    rounds.push({ round, exchanges, skills: skillUses.filter((entry) => entry.round === round), panic: panicChecks.filter((entry) => number(entry.round, round) === round) });
    if (!enemies.some((unit) => unit.hp > 0) || !allies.some((unit) => unit.hp > 0))
      break;
  }

  const outcome = enemies.every((unit) => unit.hp <= 0) ? "victory" : "defeat";
  for (const ally of allies) {
    const unit = record(values[ally.id]),
      hp = record(unit.hp), records = record(unit.records), allyExchanges = rounds.flatMap((entry) => list<RuntimeRecord>(entry.exchanges)).filter((entry) => entry.side === "ally" && entry.actorId === ally.id),
      guarded = rounds.flatMap((entry) => list<RuntimeRecord>(entry.exchanges)).filter((entry) => entry.side === "enemy" && entry.targetId === ally.id).reduce((sum, entry) => sum + number(entry.damage), 0);
    hp.cur = ally.hp;
    unit.hp = hp;
    records.kills = number(records.kills) + allyExchanges.filter((entry) => entry.kill === true).length;
    records.crits = number(records.crits) + allyExchanges.filter((entry) => entry.critical === true).length;
    records.guarded = number(records.guarded) + (["SG", "SMG"].includes(string(unit.class)) ? guarded : 0);
    unit.records = records;
    unit.status = ally.hp <= 0 ? "대파" : ally.hp < ally.maxHp ? "손상" : "대기";
    if (ally.hp <= 0) unit.traumaCandidate = { cause: "incapacitated", night: sortie.night === true, boss: stageType === "boss" };
    else if (outcome === "defeat") unit.traumaCandidate = { cause: "defeat", night: sortie.night === true, boss: stageType === "boss" };
    for (const promise of list<RuntimeRecord>(state(c.state).promises)) {
      if (promise.dollId === ally.id && promise.type === "repair" && promise.fulfilled !== true && promise.triggered !== true && ally.hp < ally.maxHp * .5) {
        promise.triggered = true;
        promise.triggeredDay = day(c.state);
        promise.deadline = day(c.state) + 1;
      }
    }
    confirmTrauma(unit);
  }
  const captureRoll = outcome === "victory" && stageType !== "boss" ? c.rng.int(1, 100) : null,
    prisoner = captureRoll !== null && captureRoll <= 20,
    loot = outcome === "victory" ? rollOperationLoot(c) : [],
    operationComplete = outcome === "victory" && (!stages.length || currentStageIndex >= stages.length - 1);
  if (outcome === "defeat") {
    const daily = dailyState(c.state);
    daily.defeats = number(daily.defeats) + 1; // 불만도 정산 입력(하루 마감에서 소비)
  }
  let reward = null, rewardRate = 0, commanderExp = { gained: 0, total: commanderBefore.exp, level: commanderBefore.level }, levelUp: RuntimeRecord | null = null, docUnlocked: RuntimeRecord | null = null;
  if (operationComplete) {
    const firstClear = !list<string>(state(c.state).completedMissions).includes(string(operation.id));
    rewardRate = firstClear ? 1 : .35;
    const rawReward = record(operation.rewards), scaledReward = Object.fromEntries(Object.entries(rawReward).map(([key, value]) => [key, Math.floor(number(value) * rewardRate * (key === "parts" && sortie.night === true ? 2 : 1))]));
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
    const completedBefore = number(next.sortiesCompletedTotal), completedAfter = completedBefore + 1;
    next.sortiesCompletedTotal = completedAfter;
    const unlockedBefore = Math.min(documents(c.schema).length, Math.floor(completedBefore / 2) + 1),
      unlockedAfter = Math.min(documents(c.schema).length, Math.floor(completedAfter / 2) + 1);
    if (unlockedAfter > unlockedBefore) docUnlocked = documents(c.schema)[unlockedAfter - 1] ?? null;
    if (firstClear && bossDefinition) {
      next.defeatedBosses = [...new Set([...list<string>(next.defeatedBosses), bossDefinition.id])];
      if (!list<string>(config(c.schema).noRecruit).includes(bossDefinition.id) && !owned(c.state)[bossDefinition.id])
        next.bossRecruit = { bossId: bossDefinition.id, name: bossDefinition.name };
    }
  }
  const allyResults = allies.map(({ id, name, hp, maxHp, hpBefore }) => ({
      id,
      name,
      hp,
      maxHp,
      hpBefore,
    })),
    enemyResults = enemies.map(({ id, name, hp, maxHp, power, boss }) => ({
      id,
      name,
      hp,
      maxHp,
      power,
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
    stageIndex: currentStageIndex,
    stageType,
    guide: stageGuide(c.schema, stageType),
    loot,
    operationComplete,
    docUnlocked,
    night: sortie.night === true,
    nightHitModifier: number(sortie.nightHitModifier),
    nightHg: number(sortie.nightHg),
    intervention,
    skills: skillUses,
    panic: panicChecks,
    captureRoll,
    prisoner,
  };
  if (prisoner) next.prisoner = { active: true, missionId: operation.id, capturedAt: currentStageIndex };
  if (outcome === "defeat" || operationComplete || !stages.length) next.sortie = null;
  else {
    currentStage.completed = true;
    currentStage.result = { outcome, loot, captureRoll, prisoner };
    sortie.current = currentStageIndex + 1;
    sortie.scouted = false;
    sortie.ambush = false;
    sortie.command = Math.min(100, number(sortie.command) + 34);
    sortie.intervention = null;
    sortie.lastStage = { index: currentStageIndex, stageType, guide: stageGuide(c.schema, stageType), outcome, loot };
    next.sortie = sortie;
  }
  c.state.gfl = next;
  const dailyAwards = operationComplete ? markDaily(c, "sortiesCompleted") : [];
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
    stageIndex: currentStageIndex,
    stageType,
    guide: stageGuide(c.schema, stageType),
    loot,
    operationComplete,
    docUnlocked,
    night: sortie.night === true,
    nightHitModifier: number(sortie.nightHitModifier),
    nightHg: number(sortie.nightHg),
    intervention,
    skills: skillUses,
    panic: panicChecks,
    captureRoll,
    prisoner,
    command: next.sortie ? number(record(next.sortie).command) : 0,
    current: next.sortie ? number(record(next.sortie).current) : stages.length,
    total: stages.length || 1,
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
        const difficulty = string(c.params.relationDifficulty), gossip = string(c.params.gossip), jealousy = string(c.params.jealousy), stageNarration = string(c.params.stageNarration), gfl = state(c.state), settings = record(gfl.settings);
        if (difficulty && !["relaxed", "standard", "strict"].includes(difficulty)) return fail(c, "gfl_relation_difficulty_invalid", difficulty);
        if (gossip && !["off", "mild", "full"].includes(gossip)) return fail(c, "gfl_gossip_mode_invalid", gossip);
        if (jealousy && !["off", "mild", "full"].includes(jealousy)) return fail(c, "gfl_jealousy_mode_invalid", jealousy);
        if (stageNarration && !["auto", "each"].includes(stageNarration)) return fail(c, "gfl_stage_narration_invalid", stageNarration);
        if (difficulty) settings.relationDifficulty = difficulty;
        if (gossip) settings.gossip = gossip;
        if (jealousy) settings.jealousy = jealousy;
        if (stageNarration) settings.stageNarration = stageNarration;
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
        if (echelonLogistics(c.state, entry.id)) return fail(c, "gfl_echelon_logistics_active", entry.id);
        const current = echelons(c.state).find((echelon) => list<unknown>(echelon.slots).includes(id));
        if (current && echelonLogistics(c.state, current.id)) return fail(c, "gfl_echelon_logistics_active", current.id);
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
        if (echelonLogistics(c.state, entry.id)) return fail(c, "gfl_echelon_logistics_active", entry.id);
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
  "gfl/logistics/dispatch": scoped((c) => {
    const echelonId = string(c.params.echelonId), entry = formation(c.state, echelonId), duration = Math.trunc(number(c.params.duration));
    if (!entry) return fail(c, "gfl_unknown_echelon", echelonId);
    if (![2, 4, 6].includes(duration)) return fail(c, "gfl_logistics_duration_invalid", duration);
    const members = list<unknown>(entry.slots).map(string).filter(Boolean), activeSortie = record(state(c.state).sortie);
    if (!members.length) return fail(c, "gfl_echelon_empty");
    if (activeSortie.active && activeSortie.echelonId === echelonId) return fail(c, "gfl_echelon_sortie_active", echelonId);
    if (echelonLogistics(c.state, echelonId)) return fail(c, "gfl_logistics_active", echelonId);
    if (members.every((id) => number(record(record(owned(c.state)[id]).hp).cur) <= 0)) return fail(c, "gfl_echelon_incapacitated");
    const formationPower = effectivePower(c.state, entry), rewardRoll = c.rng.int(90, 110),
      gold = Math.min(2000, Math.floor(formationPower * .03 * duration * rewardRoll / 100)),
      res = Math.min(1200, Math.floor(formationPower * .03 * duration * .6 * rewardRoll / 100)),
      jobs = logistics(c.state), job = {
        id: `logistics:${number(record(c.state.clock).turn)}:${jobs.length}`,
        echelonId, duration, remaining: duration, status: "active", rewardRoll,
        reward: { gold, res }, power: formationPower,
      };
    jobs.push(job); state(c.state).logistics = jobs;
    return ok(c, { job });
  }),
  "gfl/logistics/collect": scoped((c) => {
    const jobs = logistics(c.state), job = jobs.find((entry) => entry.id === c.params.jobId);
    if (!job || job.status !== "complete") return fail(c, "gfl_logistics_not_complete", c.params.jobId);
    const reward = record(job.reward), resources = record(c.state.resources);
    c.state.gold = number(c.state.gold) + number(reward.gold);
    resources.res = number(resources.res) + number(reward.res); c.state.resources = resources;
    state(c.state).logistics = jobs.filter((entry) => entry.id !== job.id);
    return ok(c, { jobId: job.id, echelonId: job.echelonId, reward });
  }),
  "gfl/crew/assign": scoped((c) => {
    const facilityId = string(c.params.facilityId), dollId = string(c.params.dollId),
      spec = CREW_FACILITIES[facilityId], unit = record(owned(c.state)[dollId]);
    if (!spec) return fail(c, "gfl_crew_facility_invalid", facilityId);
    if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", dollId);
    const status = string(unit.status);
    if (status === "이동 중") return fail(c, "gfl_doll_in_transit", string(unit.name));
    if (status === "대파") return fail(c, "gfl_doll_incapacitated", string(unit.name));
    if (status === "수복") return fail(c, "gfl_crew_doll_repairing", string(unit.name));
    if (crewFacilityOf(c.state, dollId)) return fail(c, "gfl_crew_already_assigned", string(unit.name));
    const home = echelons(c.state).find((entry) => list<unknown>(entry.slots).map(string).includes(dollId)),
      activeSortie = record(state(c.state).sortie);
    if (home && echelonLogistics(c.state, string(home.id))) return fail(c, "gfl_crew_doll_dispatched", string(unit.name));
    if (home && activeSortie.active && activeSortie.echelonId === home.id) return fail(c, "gfl_crew_doll_sortie", string(unit.name));
    const workers = crewWorkers(c.state, facilityId);
    if (workers.length >= CREW_SLOTS) return fail(c, "gfl_crew_slots_full", facilityId);
    const gfl = state(c.state), crew = record(gfl.crew);
    crew[facilityId] = [...workers, dollId];
    gfl.crew = crew;
    c.state.gfl = gfl;
    const dailyAwards = markDaily(c, "management");
    return ok(c, { facilityId, dollId, name: unit.name, aptitude: spec.aptitude.includes(string(unit.class)), dailyAwards });
  }),
  "gfl/crew/remove": scoped((c) => {
    const facilityId = string(c.params.facilityId), dollId = string(c.params.dollId),
      workers = crewWorkers(c.state, facilityId);
    if (!workers.includes(dollId)) return fail(c, "gfl_crew_not_assigned", dollId);
    const gfl = state(c.state), crew = record(gfl.crew);
    crew[facilityId] = workers.filter((id) => id !== dollId);
    gfl.crew = crew;
    c.state.gfl = gfl;
    return ok(c, { facilityId, dollId, name: record(owned(c.state)[dollId]).name });
  }),
  "gfl/refinery/start": scoped((c) => {
    const recipeId = string(c.params.recipe), recipe = REFINERY_RECIPES[recipeId];
    if (!recipe) return fail(c, "gfl_refinery_recipe_invalid", recipeId);
    const slots = facilityLevel(c.state, "base4") >= 3 ? 2 : 1,
      active = refineryJobs(c.state).filter((job) => job.status === "active");
    if (active.length >= slots) return fail(c, "gfl_refinery_slots_full", slots);
    const missing = spend(c, recipe.cost);
    if (missing) return fail(c, "gfl_refinery_cost_missing", missing);
    const gfl = state(c.state), jobs = refineryJobs(c.state);
    jobs.push({
      id: `refine:${number(record(c.state.clock).turn)}:${jobs.length}`,
      recipe: recipeId, label: recipe.label, remaining: recipe.duration, status: "active", yield: recipe.yield,
    });
    gfl.refinery = jobs;
    c.state.gfl = gfl;
    const dailyAwards = markDaily(c, "management");
    return ok(c, { job: jobs.at(-1), dailyAwards });
  }),
  "gfl/refinery/collect": scoped((c) => {
    const jobs = refineryJobs(c.state), job = jobs.find((entry) => entry.id === c.params.jobId);
    if (!job || job.status !== "complete") return fail(c, "gfl_refinery_not_complete", c.params.jobId);
    rewards(c.state, record(job.yield), c);
    state(c.state).refinery = jobs.filter((entry) => entry.id !== job.id);
    return ok(c, { jobId: job.id, recipe: job.recipe, yield: job.yield });
  }),
  "gfl/facility/specialize": scoped((c) => {
    const facilityId = string(c.params.facilityId), branchId = string(c.params.branch),
      branches = FACILITY_BRANCHES[facilityId], branch = branches?.find((entry) => entry.id === branchId);
    if (!branches) return fail(c, "gfl_specialize_facility_invalid", facilityId);
    if (!branch) return fail(c, "gfl_specialize_branch_invalid", branchId);
    if (facilityLevel(c.state, facilityId) < 5) return fail(c, "gfl_specialize_level_required", facilityId);
    if (specializationOf(c.state, facilityId)) return fail(c, "gfl_specialize_already", facilityId);
    const gfl = state(c.state), specializations = record(gfl.specializations);
    specializations[facilityId] = branchId;
    gfl.specializations = specializations;
    c.state.gfl = gfl;
    return ok(c, { facilityId, branch: branchId, label: branch.label });
  }),
  "gfl/market/buy": scoped((c) => {
    const gfl = state(c.state), market = record(gfl.market),
      offers = list<RuntimeRecord>(market.offers), offer = offers.find((entry) => entry.id === c.params.offerId),
      purchased = list<string>(market.purchased);
    if (!offer) return fail(c, "gfl_market_offer_missing", c.params.offerId);
    if (purchased.includes(string(offer.id))) return fail(c, "gfl_market_offer_sold", string(offer.name));
    const missing = spend(c, { gold: number(offer.price) });
    if (missing) return fail(c, "gfl_market_funds_missing", number(offer.price));
    const inventory = record(c.state.items);
    inventory[string(offer.itemId)] = number(inventory[string(offer.itemId)]) + 1;
    c.state.items = inventory;
    market.purchased = [...purchased, string(offer.id)];
    market.suspicion = number(market.suspicion) + Math.ceil(number(offer.price) / 1000);
    gfl.market = market;
    c.state.gfl = gfl;
    return ok(c, { offerId: offer.id, itemId: offer.itemId, name: offer.name, price: offer.price, suspicion: market.suspicion });
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
        if (before === "새벽" && c.params.settlement !== true) return fail(c, "gfl_dawn_requires_end_day");
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
        // 근무자는 시간대마다 지친다(적성 −2, 그 외 −3) — 숙소 로테이션을 강제하는 기분 경제.
        for (const [facilityId, spec] of Object.entries(CREW_FACILITIES))
          for (const id of crewWorkers(c.state, facilityId)) {
            const unit = record(owned(c.state)[id]);
            unit.mood = moodClamp(unit, number(unit.mood) - (spec.aptitude.includes(string(unit.class)) ? 2 : 3));
          }
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
        for (const job of logistics(c.state).filter((value) => value.status === "active")) {
          job.remaining = Math.max(0, number(job.remaining) - 1);
          if (job.remaining === 0) {
            job.status = "complete";
            completed.push(job);
          }
        }
        for (const job of refineryJobs(c.state).filter((value) => value.status === "active")) {
          job.remaining = Math.max(0, number(job.remaining) - 1);
          if (job.remaining === 0) {
            job.status = "complete";
            completed.push(job);
          }
        }
        let daily: RuntimeRecord | null = null;
        if (newDay) {
          const tomorrow = day(c.state) + 1;
          c.state.day = tomorrow;
          clock.day = tomorrow;
          const baseIncome = SUPPLY_DAILY[facilityLevel(c.state, "base4") - 1]!,
            income = Math.round(baseIncome * (1 + crewEffect(c.state, "base4") * .08 + (specializationOf(c.state, "base4") === "materiel" ? .15 : 0))),
            resources = record(c.state.resources);
          resources.res = number(resources.res) + income;
          c.state.resources = resources;
          if (specializationOf(c.state, "base4") === "finance")
            c.state.gold = number(c.state.gold) + Math.round(income * .15);
          const healRate = DORM_HEAL[facilityLevel(c.state, "base5") - 1]!;
          for (const raw of Object.values(owned(c.state))) {
            const unit = record(raw),
              hp = record(unit.hp);
            hp.cur = Math.min(
              number(hp.max),
              number(hp.cur) + Math.ceil((number(hp.max) * healRate) / 100),
            );
            unit.hp = hp;
            // 근무 중인 인형은 수면 회복이 절반 — 쉬는 것과 일하는 것은 달라야 한다.
            unit.mood = moodClamp(unit, number(unit.mood) + (crewFacilityOf(c.state, string(unit.id)) ? 5 : 10));
          }
          daily = { income, healRate };
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
    if (!["저녁", "밤", "심야", "새벽"].includes(phase)) return fail(c, "gfl_end_day_time_locked", phase);
    const dailyAwards = markDaily(c, "endDay");
    // 하루 마감의 advance 스텝이 daily를 리셋하므로 당일 패배 수는 지금 캡처한다.
    const defeatsToday = number(record(state(c.state).daily).defeats);
    const steps: RuntimeRecord[] = [];
    for (let count = 0; count < 6; count++) {
      const result = c.registry.dispatch(c.schema, c.state, { id: "gfl/time/advance", params: { settlement: true } }, c.rng),
        row = record(result.log[0]);
      if (!row.ok) return result;
      c.state = result.state;
      steps.push(row);
      if (row.newDay) break;
    }
    const settlement = steps.at(-1) ?? {}, gfl = state(c.state), today = day(c.state), anniversaries: RuntimeRecord[] = [];
    for (const raw of Object.values(owned(c.state))) {
      const unit = record(raw), hired = number(unit.hiredDay), elapsed = hired > 0 ? today - hired : 0;
      if ([7, 30, 100].includes(elapsed)) { unit.anniversaryDay = today; anniversaries.push({ dollId: unit.id, name: unit.name, days: elapsed, day: today, viewed: false }); }
      else if (number(unit.anniversaryDay) !== today) unit.anniversaryDay = null;
    }
    gfl.anniversaries = anniversaries;
    const receipts: RuntimeRecord[] = [], remaining: RuntimeRecord[] = [];
    for (const promise of list<RuntimeRecord>(gfl.promises)) {
      if (promise.type === "repair" && promise.triggered !== true && promise.fulfilled !== true) { remaining.push(promise); continue; }
      if (promise.fulfilled !== true && number(promise.deadline) >= today) { remaining.push(promise); continue; }
      const unit = record(owned(c.state)[string(promise.dollId)]), fulfilled = promise.fulfilled === true;
      if (Object.keys(unit).length) {
        unit.affinity = clamp(number(unit.affinity) + (fulfilled ? 5 : -8), -200, 500);
        unit.mood = moodClamp(unit, number(unit.mood) + (fulfilled ? 15 : -20));
      }
      if (!fulfilled) gfl.dissatisfaction = clamp(number(gfl.dissatisfaction) + 3, 0, 100);
      receipts.push({ dollId: promise.dollId, name: promise.name, type: promise.type, fulfilled, affinityDelta: fulfilled ? 5 : -8, moodDelta: fulfilled ? 15 : -20, dissatisfactionDelta: fulfilled ? 0 : 3 });
    }
    gfl.promises = remaining; gfl.promiseReceipts = receipts; c.state.gfl = gfl;
    const raid = resolveDailyRaid(c), social = resolveBaseSocial(c, record(raid), defeatsToday);
    return ok(c, { steps: steps.length, day: settlement.day, phase: settlement.phase, daily: settlement.daily, raid, social, anniversaries, promiseReceipts: receipts, dailyAwards });
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
        if (choiceId === "hobby" && unit.hobbyKnown !== true) return fail(c, "gfl_relation_hobby_locked", dollId);
        const dialogue = activeDialogue(c.state);
        if (dialogue && string(dialogue.dollId) !== dollId)
          return fail(c, "gfl_dialogue_other_doll", string(dialogue.name));
        const beforeTier = relationFor(c.schema, unit.affinity),
          requiredTier = choiceRequiredTier(c.schema, choice);
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
          preference = preferenceOf(unit), preferenceMod = choiceId === preference.preferred ? -2 : choiceId === preference.disliked ? 2 : 0,
          dc = Math.max(2, choice.dc + number(followOption?.dcMod) + preferenceMod),
          roll = c.rng.int(1, 20),
          modifier =
            Math.floor(number(unit.affinity) / 50) +
            Math.floor(number(unit.mood) / 100) + (unit.callsign ? 1 : 0),
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
          anniversaryFactor = number(unit.anniversaryDay) === day(c.state) ? 1.5 : 1,
          affinityDelta = Math.round(choice.affinity * multiplier * (multiplier < 0 ? difficulty.loss : difficulty.gain) * repeatFactor * anniversaryFactor),
          moodDelta = Math.round(choice.mood * multiplier * repeatFactor * anniversaryFactor);
        unit.affinity = clamp(number(unit.affinity) + affinityDelta, -200, 500);
        unit.mood = moodClamp(unit, number(unit.mood) + moodDelta);
        markRelationUse(c, dollId, choiceId);
        // 항명 해소 — 마음이 풀리면 총을 든다.
        if (success && unit.refusal === true) unit.refusal = false;
        if (success && choiceId === preference.preferred) unit.preferenceKnown = true;
        if (tier === "critical_success" && !unit.callsign) unit.callsignEligible = true;
        markInteraction(c.state, dollId);
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
                    if (!next || afterTier.index < choiceRequiredTier(c.schema, next)) return false;
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
          preferenceMod,
          preferenceRevealed: unit.preferenceKnown === true,
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
        const jealousyRoll = c.rng.int(1, 100), hobbyRoll = c.rng.int(1, 100), settings = record(gfl.settings), jealousy = string(settings.jealousy || "mild"),
          neutral = relationFor(c.schema, 0).index, interactions = record(gfl.lastInteractions),
          candidates = Object.values(owned(c.state)).map(record).filter((other) => string(other.id) !== dollId && string(other.id) !== string(gfl.lastJealousTarget) && relationFor(c.schema, other.affinity).index >= neutral + 3 && number(interactions[string(other.id)], number(other.hiredDay)) <= today - 3),
          intruder = jealousyRoll <= 25 && candidates.length ? candidates[(jealousyRoll - 1) % candidates.length]! : null;
        if (hobbyRoll <= 15) unit.hobbyKnown = true;
        if (intruder && jealousy !== "off") {
          intruder.mood = moodClamp(intruder, number(intruder.mood) - 10);
          if (jealousy === "full") intruder.affinity = clamp(number(intruder.affinity) - 3, -200, 500);
          gfl.lastJealousTarget = intruder.id;
        }
        gfl.dialogue = {
          dollId,
          name: unit.name,
          day: today,
          startedTurn: number(record(c.state.clock).turn),
          jealousyRoll,
          hobbyRoll,
          hobbyDiscovered: hobbyRoll <= 15,
          ...(intruder && jealousy !== "off" ? { intruder: { dollId: intruder.id, name: intruder.name, mode: jealousy } } : {}),
        };
        markInteraction(c.state, dollId);
        c.state.gfl = gfl;
        const tier = relationFor(c.schema, unit.affinity);
        return ok(c, {
          dollId,
          name: unit.name,
          relation: tier.label,
          hobbyDiscovered: hobbyRoll <= 15,
          intruder: intruder && jealousy !== "off" ? { dollId: intruder.id, name: intruder.name, mode: jealousy } : null,
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
          dialogueFactor = dialogue.noBonus === true ? 0 : Object.keys(record(dialogue.intruder)).length ? .5 : 1,
          anniversaryFactor = number(unit.anniversaryDay) === day(c.state) ? 1.5 : 1,
          affinityDelta = Math.round(2 * difficulty.gain * dialogueFactor * anniversaryFactor),
          moodDelta = Math.round(10 * dialogueFactor * anniversaryFactor),
          promiseRoll = c.rng.int(1, 100);
        unit.affinity = clamp(number(unit.affinity) + affinityDelta, -200, 500);
        unit.mood = moodClamp(unit, number(unit.mood) + moodDelta);
        const afterTier = relationFor(c.schema, unit.affinity),
          days = record(gfl.dialogueDays);
        days[dollId] = number(dialogue.day, day(c.state));
        gfl.dialogueDays = days;
        gfl.dialogue = null;
        const promises = list<RuntimeRecord>(gfl.promises);
        if (promiseRoll <= 40 && promises.length < 3) {
          const type = PROMISE_TYPES[stableIndex(`${dollId}:${day(c.state)}:${promiseRoll}`, PROMISE_TYPES.length)]!;
          const hired = number(unit.hiredDay), nextAnniversary = [7, 30, 100].map((days) => hired + days).find((at) => hired > 0 && at >= day(c.state));
          gfl.promiseRequest = { dollId, name: unit.name, type, deadline: type === "sortie" ? day(c.state) + 3 : type === "repair" ? null : nextAnniversary ?? day(c.state) + 100, requestedDay: day(c.state), ...(type === "repair" ? { triggered: false } : {}) };
        }
        c.state.gfl = gfl;
        const dailyAwards = markDaily(c, "relations");
        return ok(c, {
          dollId,
          name: unit.name,
          affinityDelta,
          moodDelta,
          promiseRoll,
          promiseRequested: gfl.promiseRequest ?? null,
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
      "gfl/relation/outing": scoped((c) => {
        const dollId = string(c.params.dollId), unit = record(owned(c.state)[dollId]), gfl = state(c.state), today = day(c.state);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", dollId);
        if (fieldSortie(c.state)) return fail(c, "gfl_commander_in_field");
        if (activeDialogue(c.state)) return fail(c, "gfl_dialogue_active");
        if (string(unit.status) !== "대기") return fail(c, "gfl_outing_doll_unavailable", string(unit.status));
        if (relationFor(c.schema, unit.affinity).index < relationFor(c.schema, 0).index + 3) return fail(c, "gfl_relation_tier_locked", "신뢰");
        const outingDays = record(gfl.outingDays); if (number(outingDays[dollId]) === today) return fail(c, "gfl_outing_daily_limit", dollId);
        if (string(record(c.state.clock).phase) === "새벽") return fail(c, "gfl_dawn_requires_end_day");
        const jealousyRoll = c.rng.int(1, 100), hobbyRoll = c.rng.int(1, 100), jealousy = string(record(gfl.settings).jealousy || "mild"), interactions = record(gfl.lastInteractions), neutral = relationFor(c.schema, 0).index,
          candidates = Object.values(owned(c.state)).map(record).filter((other) => string(other.id) !== dollId && string(other.id) !== string(gfl.lastJealousTarget) && relationFor(c.schema, other.affinity).index >= neutral + 3 && number(interactions[string(other.id)], number(other.hiredDay)) <= today - 3),
          intruderId = jealousyRoll <= 25 && candidates.length ? string(candidates[(jealousyRoll - 1) % candidates.length]!.id) : "";
        const advance = c.registry.dispatch(c.schema, c.state, { id: "gfl/time/advance", params: {} }, c.rng), row = record(advance.log[0]);
        if (!row.ok) return advance;
        c.state = advance.state;
        const next = state(c.state), nextUnit = record(owned(c.state)[dollId]), intruder = record(owned(c.state)[intruderId]), difficulty = relationDifficulty(c.state), anniversaryFactor = number(nextUnit.anniversaryDay) === day(c.state) ? 1.5 : 1,
          jealousyFactor = intruderId && jealousy !== "off" ? .5 : 1,
          affinityDelta = Math.round(4 * difficulty.gain * anniversaryFactor * jealousyFactor), moodDelta = Math.round(20 * anniversaryFactor * jealousyFactor), place = OUTING_PLACES[stableIndex(`${dollId}:${today}`, OUTING_PLACES.length)]!;
        nextUnit.affinity = clamp(number(nextUnit.affinity) + affinityDelta, -200, 500); nextUnit.mood = moodClamp(nextUnit, number(nextUnit.mood) + moodDelta);
        if (hobbyRoll <= 15) nextUnit.hobbyKnown = true;
        if (intruderId && jealousy !== "off") { intruder.mood = moodClamp(intruder, number(intruder.mood) - 10); if (jealousy === "full") intruder.affinity = clamp(number(intruder.affinity) - 3, -200, 500); next.lastJealousTarget = intruderId; }
        const nextOutings = record(next.outingDays); nextOutings[dollId] = today; next.outingDays = nextOutings; c.state.gfl = next;
        markInteraction(c.state, dollId);
        if (number(nextUnit.anniversaryDay) === day(c.state)) fulfillPromise(c.state, dollId, "anniversary");
        return ok(c, { dollId, name: nextUnit.name, place, affinityDelta, moodDelta, timeAdvanced: true, phase: row.phase, jealousyRoll, hobbyRoll, hobbyDiscovered: hobbyRoll <= 15,
          intruder: intruderId && jealousy !== "off" ? { dollId: intruderId, name: intruder.name, mode: jealousy } : null, narrativeFact: `${string(nextUnit.name)}와 ${place}로 외출했다. 기지 시간대가 한 칸 흘렀다.` });
      }),
      "gfl/relation/heal-trauma": scoped((c) => {
        const dialogue = activeDialogue(c.state), dollId = string(c.params.dollId || dialogue?.dollId), unit = record(owned(c.state)[dollId]);
        if (!dialogue || string(dialogue.dollId) !== dollId) return fail(c, "gfl_dialogue_missing");
        if (!unit.trauma) return fail(c, "gfl_trauma_missing", dollId);
        const roll = c.rng.int(1, 20), modifier = relationFor(c.schema, unit.affinity).index, total = roll + modifier, success = total >= 12;
        if (success) unit.traumaProgress = Math.min(3, number(unit.traumaProgress) + 1);
        else { const active = record(state(c.state).dialogue); active.noBonus = true; state(c.state).dialogue = active; }
        let medal = null; if (number(unit.traumaProgress) >= 3) { medal = string(unit.trauma); unit.overcomeMedal = medal; unit.trauma = null; unit.traumaProgress = 3; }
        return ok(c, { dollId, name: unit.name, roll, modifier, total, success, progress: unit.traumaProgress, medal, noSessionBonus: !success, narrativeFact: `${string(unit.name)}의 트라우마 치유 ${success ? "진전" : "휴식"}: ${number(unit.traumaProgress)}/3.` });
      }),
      "gfl/relation/callsign": scoped((c) => {
        const dollId = string(c.params.dollId), callsign = string(c.params.callsign).trim(), unit = record(owned(c.state)[dollId]);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", dollId);
        if (!unit.callsignEligible || unit.callsign) return fail(c, "gfl_callsign_locked", dollId);
        if (!callsign || [...callsign].length > 20) return fail(c, "gfl_callsign_invalid");
        unit.callsign = callsign; unit.callsignEligible = false; return ok(c, { dollId, name: unit.name, callsign });
      }),
      "gfl/relation/promise/accept": scoped((c) => {
        const gfl = state(c.state), request = record(gfl.promiseRequest), promises = list<RuntimeRecord>(gfl.promises);
        if (!request.dollId) return fail(c, "gfl_promise_request_missing"); if (promises.length >= 3) return fail(c, "gfl_promise_limit", 3);
        const accepted: RuntimeRecord = { ...request, acceptedDay: day(c.state), fulfilled: false };
        if (accepted.type === "repair") {
          const unit = record(owned(c.state)[string(accepted.dollId)]), hp = record(unit.hp);
          if (number(hp.max) > 0 && number(hp.cur) < number(hp.max) * .5) { accepted.triggered = true; accepted.triggeredDay = day(c.state); accepted.deadline = day(c.state) + 1; }
        }
        promises.push(accepted); gfl.promises = promises; gfl.promiseRequest = null; c.state.gfl = gfl; return ok(c, { promise: accepted });
      }),
      "gfl/relation/promise/decline": scoped((c) => { const gfl = state(c.state); if (!record(gfl.promiseRequest).dollId) return fail(c, "gfl_promise_request_missing"); gfl.promiseRequest = null; c.state.gfl = gfl; return ok(c, { declined: true }); }),
      "gfl/relation/anniversary": scoped((c) => {
        const dollId = string(c.params.dollId), unit = record(owned(c.state)[dollId]), gfl = state(c.state), anniversaries = list<RuntimeRecord>(gfl.anniversaries), entry = anniversaries.find((row) => row.dollId === dollId);
        if (!entry) return fail(c, "gfl_anniversary_missing", dollId); entry.viewed = true; fulfillPromise(c.state, dollId, "anniversary");
        return ok(c, { dollId, name: unit.name, days: entry.days, narrativeFact: `${string(unit.name)}와 함께한 지 ${number(entry.days)}일이 되는 특별한 장면이다.` });
      }),
      "gfl/manufacture/start": scoped((c) => {
        if (baseLocation(c.state) !== "base-maintenance")
          return fail(c, "gfl_maintenance_required");
        const kind = string(c.params.kind || "doll"),
          heavy = c.params.heavy === true,
          allEquipment = equipment(c.schema),
          poolIds = kind === "equipment" ? list<string>(record(record(config(c.schema).manufacturing).pools)[heavy ? "heavy" : "equipment"]) : [],
          pooledEquipment = poolIds.flatMap((id) => allEquipment.filter((entry) => entry.id === id)),
          poolFallback = kind === "equipment" && pooledEquipment.length === 0,
          definitions = kind === "equipment" ? (poolFallback ? allEquipment : pooledEquipment) : dolls(c.schema);
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
        return ok(c, { job: jobs.at(-1), dailyAwards, poolFallback, pool: kind === "equipment" ? (heavy ? "heavy" : "equipment") : "doll" });
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
        const gfl0 = state(c.state),
          precision = specializationOf(c.state, "base3") === "precision",
          repairCount = number(gfl0.repairCount),
          freeRepair = precision && repairCount > 0 && repairCount % 3 === 2; // 3회마다(3·6·…번째) 무료
        if (!freeRepair) {
          const missing = spend(c, { parts: 1 });
          if (missing) return fail(c, "gfl_repair_cost_missing", missing);
        }
        const gfl = state(c.state),
          repairs = queue(c.state, "repairs"),
          // 정비 근무·고속 정비가 수복 시작 단계를 줄인다(최소 1).
          remaining = Math.max(1, 2 - Math.floor(crewEffect(c.state, "base3")) - (specializationOf(c.state, "base3") === "rapid" ? 1 : 0));
        gfl.repairCount = repairCount + 1;
        unit.status = "수복";
        repairs.push({
          id: `repair:${id}:${number(record(c.state.clock).turn)}`,
          dollId: id,
          remaining,
          status: "active",
          ...(freeRepair ? { free: true } : {}),
        });
        gfl.repairs = repairs;
        c.state.gfl = gfl;
        if (number(hp.cur) < number(hp.max) * .5) fulfillPromise(c.state, id, "repair");
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
      "gfl/repair/rush": scoped((c) => {
        const gfl = state(c.state), repairs = queue(c.state, "repairs"),
          job = repairs.find((value) => value.id === c.params.jobId), unit = record(owned(c.state)[string(job?.dollId)]);
        if (!job || job.status !== "active") return fail(c, "gfl_repair_not_active", c.params.jobId);
        const missing = spend(c, { parts: 2 });
        if (missing) return fail(c, "gfl_repair_rush_cost_missing", missing);
        job.remaining = 0; job.status = "complete";
        const hp = record(unit.hp); hp.cur = hp.max; unit.hp = hp; unit.status = "대기";
        gfl.repairs = repairs; c.state.gfl = gfl;
        return ok(c, { job, cost: { parts: 2 } });
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
          command = string(c.params.command || "field"),
          missionType = string(c.params.missionType || "sweep");
        if (!operation)
          return fail(c, "gfl_unknown_mission", c.params.missionId);
        if (!missionUnlocked(c.schema, c.state, operation)) return fail(c, "gfl_mission_locked", c.params.missionId);
        if (!entry) return fail(c, "gfl_unknown_echelon", c.params.echelonId);
        if (echelonLogistics(c.state, entry.id)) return fail(c, "gfl_echelon_logistics_active", entry.id);
        if (!["field", "remote"].includes(command))
          return fail(c, "gfl_sortie_command_invalid", command);
        if (!OPERATION_STAGE_WEIGHTS[missionType])
          return fail(c, "gfl_sortie_mission_type_invalid", missionType);
        const members = list<unknown>(entry.slots).filter(Boolean),
      formationPower = effectivePower(c.state, entry), daily = dailyState(c.state);
        if (!members.length) return fail(c, "gfl_echelon_empty");
        const commander = commanderStatus(c.state);
        if (number(daily.sortiesUsed) >= commander.sortieLimit) return fail(c, "gfl_sortie_daily_limit", commander.sortieLimit);
        if (members.every(id => { const hp = record(record(owned(c.state)[string(id)]).hp); return number(hp.cur) <= 0; })) return fail(c, "gfl_echelon_incapacitated");
        // 항명 중인 인형은 출격을 거부한다 — 관계 행동 성공으로만 풀린다(불만도 시스템).
        const refusing = members.map((id) => record(owned(c.state)[string(id)])).find((unit) => unit.refusal === true);
        if (refusing) return fail(c, "gfl_doll_refusal", string(refusing.name));
        const travelCost = Math.max(0, number(operation.travelCost));
        if (travelCost) {
          const missing = spend(c, { gold: travelCost });
          if (missing)
            return fail(c, "gfl_sortie_travel_funds_missing", travelCost);
        }
        const stages = operationStages(c, operation, missionType), night = nightSortie(c.state, entry),
          intel = members.some((id) => string(record(owned(c.state)[string(id)]).class) === "HG") ? 1 : 0;
        gfl.sortie = {
          active: true,
          missionId: operation.id,
          echelonId: entry.id,
          command: 0,
          deploymentCommand: command,
          progress: 0,
          engaged: false,
          power: formationPower,
          returnLocation: baseLocation(c.state),
          travelCost,
          engagementMode: string(c.params.engagementMode || "tactical"),
          missionType,
          stages,
          current: 0,
          scouted: false,
          intel,
          night: night.night,
          nightPhase: night.phase,
          nightHitModifier: night.modifier,
          nightHg: night.hgCount,
        };
        daily.sortiesUsed = number(daily.sortiesUsed) + 1;
        c.state.gfl = gfl;
        for (const member of members.map(string)) fulfillPromise(c.state, member, "sortie");
        return ok(c, {
          missionId: operation.id,
          echelonId: entry.id,
          power: formationPower,
          command,
          missionType,
          stages,
          current: 0,
          travelCost,
          night,
          intel,
          risk: missionRisk(formationPower, number(operation.power), commander.checkBonus, night.modifier),
          sortiesRemaining: Math.max(0, commander.sortieLimit - number(daily.sortiesUsed)),
        });
      }),
      // 소녀전선 전투는 범용 플레이어 HP를 빌리지 않는다. 편성된 각 인형과 여러 적을
      // 엔진이 한 이벤트 안에서 끝까지 계산하므로 전투 한 번에 모델 호출을 반복하지 않는다.
      "gfl/sortie/engage": scoped(resolveSortie),
      "gfl/sortie/resolve": scoped(resolveSortie),
      "gfl/sortie/finish": scoped(resolveSortie),
      "gfl/sortie/stage": scoped(resolveOperationStage),
      // 오토런 — quick 작전을 "결정이 필요한 지점"까지 기존 단계 이벤트 재사용으로 연속 해소한다.
      // 수치·판정을 재구현하지 않으므로 같은 시드에서 수동 단계 진행과 결과가 완전히 같다(테스트 계약).
      "gfl/sortie/auto": scoped((c) => {
        const first = record(state(c.state).sortie);
        if (!first.active) return fail(c, "gfl_sortie_missing");
        if (string(first.engagementMode) !== "quick") return fail(c, "gfl_auto_tactical");
        const steps: RuntimeRecord[] = [];
        let stopReason = "complete";
        for (let guard = 0; guard < 14; guard++) {
          const gfl = state(c.state), sortie = record(gfl.sortie);
          if (!sortie.active) {
            stopReason = string(record(steps.at(-1)).outcome) === "defeat" ? "defeat" : "complete";
            break;
          }
          if (record(sortie.encounter).dollId) { stopReason = "encounter"; break; }
          if (record(gfl.prisoner).active) { stopReason = "prisoner"; break; }
          const stages = list<RuntimeRecord>(sortie.stages),
            current = clamp(number(sortie.current), 0, Math.max(0, stages.length - 1));
          if (string(record(stages[current]).type) === "boss") { stopReason = "boss"; break; }
          const result = c.registry.dispatch(c.schema, c.state, { id: "gfl/sortie/stage", params: {} }, c.rng),
            row = record(result.log[0]);
          if (!row.ok) return result;
          c.state = result.state;
          steps.push(row);
        }
        const reasonText: Record<string, string> = {
          complete: "작전 완료", defeat: "작전 실패로 종료", boss: "보스 교전 직전 정지",
          encounter: "무소속 인형 발견 — 결정 대기", prisoner: "포로 발생 — 결정 대기",
        };
        return ok(c, {
          steps, stopReason, stepCount: steps.length,
          narrativeFact: `작전을 ${steps.length}개 단계 연속으로 진행했다 (${reasonText[stopReason] ?? stopReason}). 각 단계의 결과와 지침은 steps 배열의 엔진 확정값을 따른다.`,
        });
      }),
      "gfl/sortie/retreat": scoped(retreatOperation),
      "gfl/sortie/interrogate": scoped((c) => {
        const gfl = state(c.state), prisoner = record(gfl.prisoner);
        if (!prisoner.active) return fail(c, "gfl_prisoner_missing");
        const roll = c.rng.int(1, 20), modifier = commanderStatus(c.state).checkBonus, total = roll + modifier, success = total >= 12,
          sortie = record(gfl.sortie);
        if (success && sortie.active) { sortie.scouted = true; sortie.intel = 2; }
        if (!success && sortie.active) sortie.ambush = true;
        gfl.prisoner = null; if (sortie.active) gfl.sortie = sortie; c.state.gfl = gfl;
        return ok(c, { roll, modifier, total, success, scouted: success, intel: success ? 2 : number(sortie.intel), ambush: !success,
          narrativeFact: success ? "심문으로 다음 교전의 적 정보를 확보했다." : "심문이 실패해 다음 교전에서 적이 1라운드 선제한다." });
      }),
      "gfl/sortie/prisoner/release": scoped((c) => {
        const gfl = state(c.state); if (!record(gfl.prisoner).active) return fail(c, "gfl_prisoner_missing");
        gfl.prisoner = null; c.state.gfl = gfl; return ok(c, { released: true });
      }),
      "gfl/encounter/recruit": scoped(recruitEncounter),
      "gfl/encounter/skip": scoped(skipEncounter),
      "gfl/boss/recruit": scoped((c) => {
        const gfl = state(c.state), pending = record(gfl.bossRecruit), definition = boss(c.schema, pending.bossId),
          id = string(pending.bossId);
        if (!definition || !id) return fail(c, "gfl_boss_recruit_missing");
        if (!list<string>(gfl.defeatedBosses).includes(id)) return fail(c, "gfl_boss_not_defeated", id);
        if (list<string>(gfl.dismissedBosses).includes(id)) return fail(c, "gfl_boss_dismissed", id);
        if (list<string>(config(c.schema).noRecruit).includes(id)) return fail(c, "gfl_boss_no_recruit", id);
        if (owned(c.state)[id]) return fail(c, "gfl_doll_owned", id);
        const capacity = dollCapacity(c.schema, c.state), count = Object.keys(owned(c.state)).length;
        if (count >= capacity) return fail(c, "gfl_hire_capacity_full", `${count}/${capacity}`);
        acquire(c, definition);
        state(c.state).bossRecruit = null;
        return ok(c, { bossId: id, name: definition.name, class: "BOSS", grade: 6, power: definition.power, maxHp: definition.maxHp, capacity, count: count + 1 });
      }),
      "gfl/boss/dismiss": scoped((c) => {
        const gfl = state(c.state), pending = record(gfl.bossRecruit);
        if (!pending.bossId) return fail(c, "gfl_boss_recruit_missing");
        gfl.bossRecruit = null; c.state.gfl = gfl;
        return ok(c, { bossId: pending.bossId, dismissed: true });
      }),
      "gfl/doll/dismiss": scoped((c) => {
        const id = string(c.params.dollId), gfl = state(c.state), values = owned(c.state), unit = record(values[id]);
        if (c.params.confirm !== true) return fail(c, "gfl_dismiss_confirmation_required", id);
        if (!Object.keys(unit).length) return fail(c, "gfl_doll_not_owned", id);
        for (const entry of echelons(c.state)) {
          entry.slots = list<unknown>(entry.slots).map((slot) => slot === id ? null : slot);
        }
        gfl.echelons = echelons(c.state);
        gfl.repairs = queue(c.state, "repairs").filter((job) => job.dollId !== id);
        if (gfl.featuredDollId === id) gfl.featuredDollId = null;
        if (string(unit.class) === "BOSS") gfl.dismissedBosses = [...new Set([...list<string>(gfl.dismissedBosses), id])];
        delete values[id]; gfl.dolls = values;
        const core = items(c.schema).find((item) => item.name === "코어"), coreId = string(core?.id), inventory = record(c.state.items), bonus = c.rng.int(500, 2000), resources = record(c.state.resources);
        if (coreId) inventory[coreId] = number(inventory[coreId]) + 1;
        else resources.cores = number(resources.cores) + 1;
        resources.res = number(resources.res) + bonus;
        c.state.items = inventory; c.state.resources = resources; c.state.gfl = gfl;
        return ok(c, { dollId: id, name: unit.name, reward: { coreId: coreId || "cores", cores: 1, res: bonus }, boss: string(unit.class) === "BOSS" });
      }),
      "gfl/equipment/scrap": scoped((c) => {
        const id = string(c.params.equipmentId), definition = equipment(c.schema).find((item) => item.id === id), inventory = record(c.state.items);
        if (c.params.confirm !== true) return fail(c, "gfl_scrap_confirmation_required", id);
        if (!definition) return fail(c, "gfl_unknown_equipment", id);
        if (number(inventory[id]) < 1) return fail(c, "gfl_equipment_not_owned", id);
        const parts = Math.floor(number(definition.price) * .3), resources = record(c.state.resources);
        inventory[id] = number(inventory[id]) - 1; resources.parts = number(resources.parts) + parts;
        c.state.items = inventory; c.state.resources = resources;
        return ok(c, { equipmentId: id, name: definition.name, reward: { parts } });
      }),
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
        if (string(unit.class) === "BOSS") return fail(c, "gfl_boss_mod_forbidden", id);
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
        const effect = record(definition.effect), beforeTier = relationFor(c.schema, unit.affinity),
          oathEligible = string(definition.name) === "서약반지" && unit.oathed !== true && beforeTier.index >= loveTierIndex(c.schema),
          hp = record(unit.hp),
          mp = record(unit.mp);
        if ("hp" in effect)
          hp.cur = clamp(number(hp.cur) + number(effect.hp), 0, number(hp.max));
        if ("mp" in effect)
          mp.cur = clamp(number(mp.cur) + number(effect.mp), 0, number(mp.max));
        if ("mood" in effect)
          unit.mood = moodClamp(unit, number(unit.mood) + number(effect.mood));
        if ("aff" in effect)
          unit.affinity = clamp(
            number(unit.affinity) + number(effect.aff),
            -200,
            500,
          );
        unit.hp = hp;
        unit.mp = mp;
        if (oathEligible) {
          unit.oathed = true;
          unit.mood = moodClamp(unit, number(unit.mood));
        }
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
          oathed: unit.oathed === true,
          oathApplied: oathEligible,
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
            sortie.active && string(sortie.deploymentCommand || sortie.command) === "field"
              ? {
                  id: `mission:${sortie.missionId}`,
                  name: `작전 현장 · ${sortie.missionId}`,
                }
              : { id: locationId, name: location?.name ?? locationId },
          sortie: sortie.active ? sortie : null,
          logistics: logistics(value),
          bossRecruit: gfl.bossRecruit ?? null,
          defeatedBosses: list<string>(gfl.defeatedBosses),
          missionTypes: list<RuntimeRecord>(progressionConfig(schema).missionTypes),
          lastCheck: gfl.lastCheck ?? null,
          lastBattle: gfl.lastBattle ?? null,
          featuredDollId: gfl.featuredDollId ?? null,
          followUp: activeFollowUp(value),
          dialogue: activeDialogue(value),
          prisoner: gfl.prisoner ?? null,
          promiseRequest: gfl.promiseRequest ?? null,
          promises: list<RuntimeRecord>(gfl.promises),
          promiseReceipts: list<RuntimeRecord>(gfl.promiseReceipts),
          anniversaries: list<RuntimeRecord>(gfl.anniversaries),
          settings: { relationDifficulty: relationDifficulty(value).id, gossip: string(record(gfl.settings).gossip || "mild"), jealousy: string(record(gfl.settings).jealousy || "mild"), stageNarration: string(record(gfl.settings).stageNarration || "auto") },
          commander: commanderStatus(value),
          dissatisfaction: { value: dissatisfaction(value), ...dissTier(value) },
          market: gfl.market ?? null,
        };
      },
      "gfl/crew": (...args) => {
        const value = record(args[1]);
        return Object.entries(CREW_FACILITIES).map(([facilityId, spec]) => ({
          facilityId,
          aptitude: spec.aptitude,
          effectLabel: spec.effectLabel,
          slots: CREW_SLOTS,
          slacked: number(record(state(value).facilitySlack)[facilityId]) === day(value),
          effect: Math.round(crewEffect(value, facilityId) * 100) / 100,
          workers: crewWorkers(value, facilityId).map((dollId) => {
            const unit = record(owned(value)[dollId]);
            return { dollId, name: unit.name, class: unit.class, mood: unit.mood, aptitude: spec.aptitude.includes(string(unit.class)) };
          }),
        }));
      },
      "gfl/refinery": (...args) => {
        const value = record(args[1]);
        return {
          slots: facilityLevel(value, "base4") >= 3 ? 2 : 1,
          recipes: Object.entries(REFINERY_RECIPES).map(([id, recipe]) => ({ id, ...recipe })),
          jobs: refineryJobs(value),
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
                .filter(([id]) => id !== "hobby" || unit.hobbyKnown === true)
                .map(([id, choice]) => {
                  const requiredTier = choiceRequiredTier(schema, choice),
                    used = number(usage.choices[id]),
                    preference = preferenceOf(unit), preferenceMod = id === preference.preferred ? -2 : id === preference.disliked ? 2 : 0,
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
                    label: `${choice.label}${unit.preferenceKnown === true && id === preference.preferred ? " ♥" : ""}`,
                    dc: choice.dc + preferenceMod,
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
                outingUsed: number(record(state(value).outingDays)[dollId]) === today,
                outingAvailable: tier.index >= relationFor(schema, 0).index + 3 && string(unit.status) === "대기" && !fieldSortie(value) && !activeDialogue(value) && number(record(state(value).outingDays)[dollId]) !== today,
                preferenceKnown: unit.preferenceKnown === true,
                preference: unit.preferenceKnown === true ? preferenceOf(unit) : null,
                preferenceHint: unit.preferenceKnown === true ? RELATION_CHOICES[preferenceOf(unit).preferred]?.label : "?",
                callsignEligible: unit.callsignEligible === true && !unit.callsign,
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
      "gfl/formation/guide": () => ({
        ...FORMATION_GUIDE,
        factions: Object.fromEntries(Object.entries(FACTION_COUNTER).map(([name, value]) => [name, value.badge])),
      }),
      "gfl/sortie/intel": (...args) => {
        const schema = record(args[0]), value = record(args[1]), sortie = record(state(value).sortie), level = clamp(number(sortie.intel), 0, 2), operation = mission(schema, sortie.missionId);
        if (!sortie.active || !operation) return { level: 0, enemies: [], estimate: null };
        const configured = list<RuntimeRecord>(operation.enemies), count = configured.length || clamp(Math.round(number(operation.enemyCount, Math.ceil(Math.max(1, number(operation.power)) / 1200))), 1, 5),
          estimate = { count, minPower: Math.max(100, Math.floor(number(operation.power) * .8 / 100) * 100), maxPower: Math.ceil(number(operation.power) * 1.2 / 100) * 100 },
          enemies = level < 1 ? [] : Array.from({ length: count }, (_, index) => {
            const source = configured[index] ?? {}, isBoss = index === 0 && Boolean(string(operation.boss));
            return { name: string(source.name || (isBoss ? operation.boss : `${operation.enemy || "적대 세력"} ${index + 1}`)), class: string(source.class || (isBoss ? "BOSS" : "미상")), ...(level >= 2 ? { hp: number(source.hp, Math.round(number(source.power, number(operation.power) / count) * (isBoss ? 1.1 : .75))) } : {}) };
          });
        return { level, estimate, enemies };
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
      const unit = record(raw), { secretHobby, ...visible } = unit;
      return { ...visible, ...(unit.hobbyKnown === true ? { secretHobby } : {}), oathed: unit.oathed === true, relation: relationFor(schema, unit.affinity) };
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
      "gfl/documents": (...args) => {
        const schema = record(args[0]), completed = number(state(record(args[1])).sortiesCompletedTotal), rows = documents(schema),
          unlockedCount = Math.min(rows.length, Math.floor(completed / 2) + 1);
        return { completed, unlockedCount, documents: rows.map((entry, index) => ({ ...entry, unlocked: index < unlockedCount })) };
      },
      "gfl/unlockedDocs": (...args) => {
        const schema = record(args[0]), completed = number(state(record(args[1])).sortiesCompletedTotal), rows = documents(schema),
          count = Math.min(rows.length, Math.floor(completed / 2) + 1);
        return { count, ids: rows.slice(0, count).map((entry) => string(entry.id)) };
      },
      "gfl/queues": (...args) => ({
        manufacturing: queue(record(args[1]), "manufacturing"),
        repairs: queue(record(args[1]), "repairs"),
      }),
      "gfl/logistics": (...args) => {
        const value = record(args[1]);
        return logistics(value).map((job) => {
          const entry = formation(value, job.echelonId);
          return { ...job, echelonName: entry?.name ?? job.echelonId };
        });
      },
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
            const facilityId = string(definition.id);
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
              specialization: specializationOf(value, facilityId),
              branches: level >= maxLevel && !specializationOf(value, facilityId) ? FACILITY_BRANCHES[facilityId] ?? [] : [],
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
        }), ace = Object.values(owned(value)).map(record).sort((a, b) => number(record(b.records).kills) - number(record(a.records).kills))[0],
        aceKills = ace ? number(record(ace.records).kills) : 0;
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
        ...(ace && aceKills > 0 ? { unitAce: { dollId: ace.id, name: ace.name, kills: aceKills, title: "부대 에이스" } } : {}),
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
              ...(unit.preferenceKnown === true ? { preference: preferenceOf(unit) } : {}),
              ...(unit.hobbyKnown === true ? { secretHobby: unit.secretHobby } : {}),
              ...(unit.callsign ? { callsign: unit.callsign } : {}),
              ...(unit.trauma ? { trauma: unit.trauma, traumaProgress: number(unit.traumaProgress) } : {}),
              promises: list<RuntimeRecord>(gfl.promises).filter((entry) => entry.dollId === unit.id),
              intrusion: dialogue.intruder ?? null,
              rule: `시간이 멈춘 1:1 대화 장면이다. ${name}와의 대화에만 집중하고, 다른 인형의 등장·작전 진행·시간 경과·수치 변화를 서술하지 않는다. 보너스는 대화를 마무리할 때 엔진이 확정한다.`,
            },
          };
        })(),
        base: {
          dissatisfaction: { value: dissatisfaction(value), label: dissTier(value).label, note: dissTier(value).text },
          crew: Object.keys(CREW_FACILITIES)
            .map((facilityId) => ({ facilityId, workers: crewWorkers(value, facilityId).map((id) => string(record(owned(value)[id]).name)) }))
            .filter((entry) => entry.workers.length),
        },
        rule: "위치·시간·자원·관계·전투 결과는 엔진 확정값이다. [[aff=...]]·[[mood=...]]·[[diss=...]] 같은 AI 제안 태그로 바꾸지 말고, 판정 로그의 실제 증감만 서술한다.",
      };
    },
    { seal: gflSealMigration },
  );
}
