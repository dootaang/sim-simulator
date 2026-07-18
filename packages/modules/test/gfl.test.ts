import { describe, expect, it } from "vitest";
import { createRng, createState } from "@simbot/kernel";
import { createCoreRegistry, gflModule } from "../src/index.ts";
import { COMMANDER_EXP_BY_STAR, commanderLevel, gflFormationRow } from "../src/gfl.ts";

const schema = {
  initialState: {
    day: 1,
    gold: 5000,
    resources: { res: 3000, parts: 3, cores: 9 },
    items: {},
    player: {
      level: 1,
      exp: 0,
      pools: { hp: { cur: 1000, max: 1000 }, mp: { cur: 1000, max: 1000 } },
    },
    clock: { day: 1, hour: 8, turn: 0 },
    location: "base-command",
    gfl: {
      started: false,
      baseLocation: "base-command",
      dolls: {},
      echelons: [
        { id: "e1", name: "제1제대", slots: [null, null, null, null, null] },
      ],
      facilities: { base1: 1, base2: 1, base3: 1, base4: 1, base5: 1 },
      hireOffers: [],
      hirePreviousOffers: [],
      hireOfferDay: null,
      hireRefreshDay: null,
      hiredDay: null,
      manufacturing: [],
      repairs: [],
      completedMissions: [],
      sortie: null,
    },
  },
  resources: [
    { id: "res", basePrice: 1 },
    { id: "parts", basePrice: 1 },
    { id: "cores", basePrice: 1 },
  ],
  gather: { small: [1, 1] },
  party: { maxSize: 5, roles: ["slot1"] },
  time: { hoursPerStep: 4 },
  jobs: [],
  locations: [
    { id: "base-hall", name: "복도" },
    { id: "base-command", name: "지휘관실" },
    { id: "base-maintenance", name: "정비실" },
    { id: "base-outside", name: "기지 외부" },
  ],
  combat: {
    d: 20,
    minDamage: 1,
    critMult: 2,
    guardMult: 0.5,
    fleeRate: 50,
    heavyRate: 0,
    heavyMult: 1.5,
    heavyAcc: 0,
    defeatReviveRatio: 0.2,
    expTable: { E: [1, 1] },
    lootGold: { E: [1, 1] },
  },
  skills: {},
  gfl: {
    dolls: [
      {
        id: "m4a1",
        name: "M4A1",
        class: "AR",
        grade: 5,
        maxHp: 1000,
        power: 1000,
        maxMp: 1600,
        mood: 90,
        price: 700,
      },
      {
        id: "ump45",
        name: "UMP45",
        class: "SMG",
        grade: 4,
        maxHp: 900,
        power: 900,
        price: 400,
        description: "404 소대장",
      },
    ],
    items: [{ id: "ration", name: "전투식량", price: 50, drop: 100 }, { id: "ring", name: "서약반지", price: 10_000, drop: 0 }, { id: "core-item", name: "코어", price: 2000, drop: 0 }],
    equipment: [
      { id: "scope", name: "옵티컬", price: 100, power: 50, ban: ["SG"] },
    ],
    fairies: [{ id: "command", name: "지휘요정", power: 300 }],
    missions: [
      {
        id: "alpha",
        name: "ALPHA",
        power: 800,
        enemy: "철혈",
        rank: "E",
        rewards: { gold: 500, parts: 1 },
      },
    ],
    facilities: [
      {
        id: "base1",
        name: "훈련 시설",
        maxLevel: 5,
        cost: { gold: 100, res: 50 },
        costMultiplier: 1.5,
      },
      {
        id: "base5",
        name: "인형 숙소",
        maxLevel: 5,
        cost: { gold: 80, res: 40 },
        costMultiplier: 1.5,
      },
    ],
    hire: {
      dailySlots: 5,
      snipePremium: 300,
      capacity: [3, 6, 9, 12, 15],
      arrivalSteps: 1,
    },
    modPower: [111, 222, 333],
    commanderFunds: 10000,
    manufacturing: {
      doll: { gold: 100, res: 100 },
      equipment: { gold: 100, res: 100 },
      heavy: { gold: 500, res: 500 },
      pools: { equipment: ["scope"], heavy: ["scope"] },
    },
    progression: {
      byStar: { 0: 3, 1: 5, 2: 7, 3: 8, 4: 9, 5: 10, 6: 11 },
      missionTypes: [
        { key: "recon", name: "🔍 정찰 임무", stepMod: -1, hint: "교전 최소화" },
        { key: "sweep", name: "⚔️ 소탕 임무", stepMod: 0, hint: "표준" },
        { key: "annihil", name: "💥 섬멸 임무", stepMod: 1, hint: "완전 섬멸" },
      ],
      eventGuides: { battle: "교전 지시", boss: "보스 지시", recon: "정찰 지시", other: "돌발 지시", mystery: "미확인 지시" },
    },
    encounters: { pool: ["m4a1", "ump45"], ban: [] },
    documents: [
      { id: "doc0", year: "1908", code: "A-0", title: "시작 기록", body: "첫 줄<br>둘째 줄" },
      { id: "doc1", year: "2030", code: "A-1", title: "두 번째 기록", body: "작전 두 번" },
      { id: "doc2", year: "2045", code: "A-2", title: "세 번째 기록", body: "작전 네 번" },
    ],
    bosses: [
      { id: "scarecrow", name: "Scarecrow", class: "BOSS", grade: 6, maxHp: 1800, maxMp: 1600, power: 1000, mood: 90 },
      { id: "gebbennu", name: "Gebbennu", class: "BOSS", grade: 6, maxHp: 2800, maxMp: 2400, power: 1600, mood: 97 },
    ],
    noRecruit: ["gebbennu"],
  },
};
function runtime(source: any = schema, seed: unknown = 7) {
  const registry = createCoreRegistry().register(gflModule()),
    rng = createRng(seed);
  let state = createState(source, seed);
  return {
    schema: source,
    get state() {
      return state;
    },
    dispatch(id: string, params: Record<string, unknown> = {}) {
      const result = registry.dispatch(source, state, { id, params }, rng);
      if (result.log.some((row) => row.ok)) state = result.state;
      return result;
    },
    select(id: string) {
      return registry.select(id, source, state);
    },
    snapshot() {
      return { state: structuredClone(state), rng: rng.snapshot() };
    },
  };
}

function sortieGame(options: { stars?: number; boss?: string; exp?: number; seed?: unknown; enemyPower?: number } = {}) {
  const source: any = structuredClone(schema);
  source.initialState.player.exp = options.exp ?? 0;
  source.initialState.player.level = commanderLevel(options.exp ?? 0);
  source.gfl.dolls[0].power = options.enemyPower ? 1 : 10_000;
  source.gfl.dolls[0].maxHp = options.enemyPower ? 1 : 10_000;
  source.gfl.missions[0] = {
    ...source.gfl.missions[0],
    stars: options.stars ?? 0,
    power: options.enemyPower ?? 100,
    enemies: [{ id: "target", name: "표적", power: options.enemyPower ?? 20, hp: options.enemyPower ?? 80 }],
    ...(options.boss ? { boss: options.boss } : {}),
  };
  const game = runtime(source, options.seed ?? 7);
  game.dispatch("gfl/start", { mode: "commander" });
  game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
  game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
  return game;
}
function playNextStage(game: ReturnType<typeof runtime>) {
  const sortie = (game.state.gfl as any).sortie;
  if (!sortie) return null;
  const type = sortie.stages?.[sortie.current]?.type;
  return game.dispatch(type === "battle" || type === "boss" ? "gfl/sortie/resolve" : "gfl/sortie/stage").log[0] as any;
}
function completeOperation(game: ReturnType<typeof runtime>) {
  let result: any = null;
  while ((game.state.gfl as any).sortie?.active) result = playNextStage(game);
  return result;
}
function reachCombat(game: ReturnType<typeof runtime>) {
  while ((game.state.gfl as any).sortie?.active) {
    const sortie = (game.state.gfl as any).sortie;
    const type = sortie.stages?.[sortie.current]?.type;
    if (type === "battle" || type === "boss") return game.dispatch("gfl/sortie/resolve").log[0] as any;
    game.dispatch("gfl/sortie/stage");
  }
  return null;
}
describe("Girls Frontline native module", () => {
  it("applies deterministic class, row, faction, and boss combat composition rules", () => {
    const source: any = structuredClone(schema);
    source.initialState.gfl.echelons[0].slots = [null, null, null, null, null];
    source.gfl.dolls = [
      { id:"sg",name:"SG",class:"SG",grade:1,maxHp:1200,power:180 },
      { id:"smg",name:"SMG",class:"SMG",grade:1,maxHp:1000,power:180 },
      { id:"hg",name:"HG",class:"HG",grade:1,maxHp:800,power:180 },
      { id:"ar",name:"AR",class:"AR",grade:1,maxHp:800,power:180 },
      { id:"mg",name:"MG",class:"MG",grade:1,maxHp:800,power:180 },
      { id:"rf",name:"RF",class:"RF",grade:1,maxHp:800,power:180 },
    ];
    source.gfl.missions[0] = { id:"alpha",name:"ALPHA",power:1800,enemy:"철혈",enemyCount:3,factions:["철혈"],boss:"Scarecrow",rewards:{} };
    const fight = () => { const game=runtime(structuredClone(source),91); game.dispatch("gfl/start",{mode:"commander"}); for(const [slot,unit] of source.gfl.dolls.slice(0,5).entries()){game.dispatch("gfl/doll/acquire",{dollId:unit.id});game.dispatch("gfl/echelon/assign",{echelonId:"e1",slot,dollId:unit.id});} game.dispatch("gfl/sortie/start",{missionId:"alpha",echelonId:"e1"}); return reachCombat(game); };
    const first=fight(), second=fight(), allies=first.rounds.flatMap((round:any)=>round.exchanges.filter((row:any)=>row.side==="ally"));
    expect(first).toEqual(second); // 가중 타겟팅도 같은 시드면 같은 결과
    expect(allies.some((row:any)=>row.hitBuff===1)).toBe(true);
    expect(allies.some((row:any)=>row.actorId==="mg"&&row.roundFactor===1.56)).toBe(true); // 밸런스 검산 −20% 범위, 기본 1.4는 보존
    expect(allies.some((row:any)=>row.actorId==="mg"&&row.rowFactor===1.38)).toBe(true);
    expect(allies.some((row:any)=>row.actorId==="mg"&&row.counter===true)).toBe(true);
    expect(first.factionLabel).toContain("RF·MG 유리");
    expect(first.enemies[0]).toMatchObject({id:"scarecrow",name:"Scarecrow",maxHp:1800,power:1000,boss:true});
    expect(first.allies.every((unit:any)=>typeof unit.hpBefore==="number")).toBe(true);
    expect(gflFormationRow(0)).toBe("전열"); expect(gflFormationRow(2)).toBe("중열"); expect(gflFormationRow(4)).toBe("후열");
  });
  it("applies the RF maximum-HP target multiplier", () => {
    const source:any=structuredClone(schema); source.gfl.dolls=[{id:"rf",name:"RF",class:"RF",grade:5,maxHp:900,power:200}]; source.gfl.missions[0].enemies=[{id:"large",power:100,hp:1000},{id:"small",power:100,hp:200}];
    const game=runtime(source,4); game.dispatch("gfl/start",{mode:"commander"}); game.dispatch("gfl/doll/acquire",{dollId:"rf"}); game.dispatch("gfl/echelon/assign",{echelonId:"e1",slot:4,dollId:"rf"}); game.dispatch("gfl/sortie/start",{missionId:"alpha",echelonId:"e1"}); const battle=reachCombat(game);
    expect(battle.rounds[0].exchanges.find((row:any)=>row.side==="ally")).toMatchObject({actorId:"rf",maxHpFactor:1.3,rowFactor:1.38});
  });
  it("runs start, echelon, sortie, combat settlement, repair and manufacturing deterministically", () => {
    const game = runtime();
    expect(
      game.dispatch("gfl/start", { mode: "commander" }).log[0],
    ).toMatchObject({ ok: true, starter: null });
    expect(game.select("gfl/dolls")).toEqual([]);
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(
      game.dispatch("gfl/echelon/assign", {
        echelonId: "e1",
        slot: 0,
        dollId: "m4a1",
      }).log[0]?.ok,
    ).toBe(true);
    expect(
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" })
        .log[0]?.ok,
    ).toBe(true);
    expect(completeOperation(game)).toMatchObject({
      ok: true,
      outcome: "victory",
      missionId: "alpha",
      llmCallsRequired: 0,
    });
    expect((game.select("combat/console") as any).present).toBe(false);
    expect(game.state.gold).toBeGreaterThan(5000);
    expect(
      game.dispatch("gfl/location/move", { locationId: "base-maintenance" })
        .log[0]?.ok,
    ).toBe(true);
    const manufactured = game.dispatch("gfl/manufacture/start", {
      kind: "doll",
    }).log[0] as any;
    expect(manufactured.ok).toBe(true);
    game.dispatch("gfl/manufacture/tick", { jobId: manufactured.job.id });
    game.dispatch("gfl/manufacture/tick", { jobId: manufactured.job.id });
    expect(
      (game.select("gfl/dolls") as unknown[]).length,
    ).toBeGreaterThanOrEqual(1);
  });
  it('일반·중형 장비 제조가 회수한 서로 다른 풀에서 결과를 한 번만 추첨한다', () => {
    for (const heavy of [false, true]) {
      const game = runtime(structuredClone(schema), heavy ? 92 : 91); game.dispatch('gfl/start', { mode: 'commander' });
      game.dispatch('gfl/location/move', { locationId: 'base-maintenance' });
      const before = game.snapshot().rng, result = game.dispatch('gfl/manufacture/start', { kind: 'equipment', heavy }).log[0] as any,
        expected = createRng(0); expected.restore(before); expected.int(0, 0);
      expect(result).toMatchObject({ ok: true, pool: heavy ? 'heavy' : 'equipment', poolFallback: false, job: { kind: 'equipment', heavy, resultId: 'scope' } });
      expect(game.snapshot().rng).toBe(expected.snapshot());
    }
    const fallbackSource: any = structuredClone(schema); fallbackSource.gfl.manufacturing.pools = { equipment: [], heavy: [] };
    const fallback = runtime(fallbackSource); fallback.dispatch('gfl/start', { mode: 'commander' }); fallback.dispatch('gfl/location/move', { locationId: 'base-maintenance' });
    expect(fallback.dispatch('gfl/manufacture/start', { kind: 'equipment' }).log[0]).toMatchObject({ ok: true, poolFallback: true, job: { resultId: 'scope' } });
  });
  it("resolves multiple dolls against multiple enemies with doll HP and no generic player HP", () => {
    const source: any = structuredClone(schema);
    source.gfl.missions[0]!.enemies = [
      { id: "jaeger-1", name: "예거 1", power: 350, hp: 300 },
      { id: "jaeger-2", name: "예거 2", power: 350, hp: 300 },
    ];
    const game = runtime(source);
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    game.dispatch("gfl/doll/acquire", { dollId: "ump45" });
    game.dispatch("gfl/echelon/assign", {
      echelonId: "e1",
      slot: 0,
      dollId: "m4a1",
    });
    game.dispatch("gfl/echelon/assign", {
      echelonId: "e1",
      slot: 1,
      dollId: "ump45",
    });
    game.dispatch("gfl/sortie/start", {
      missionId: "alpha",
      echelonId: "e1",
    });
    const playerHpBefore = structuredClone((game.state.player as any).pools.hp);
    const battle = completeOperation(game) as any;
    expect(battle).toMatchObject({ ok: true, outcome: "victory" });
    expect(battle.roundCount).toBeLessThanOrEqual(8);
    expect(battle.allies).toHaveLength(2);
    expect(battle.enemies).toHaveLength(2);
    expect(battle.enemies.every((enemy: any) => enemy.hp === 0)).toBe(true);
    expect((game.state.player as any).pools.hp).toEqual(playerHpBefore);
    completeOperation(game);
    expect((game.state.gfl as any).sortie).toBeNull();
  });
  it("rejects an empty echelon and insufficient resources without changing state", () => {
    const game = runtime();
    game.dispatch("gfl/start", { mode: "commander" });
    const before = game.snapshot();
    expect(
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" })
        .log[0],
    ).toMatchObject({ ok: false, reason: "gfl_echelon_empty" });
    expect(game.snapshot()).toEqual(before);
  });
  it("supports shop equipment and fairy management through engine-owned state", () => {
    const game = runtime();
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(
      game.dispatch("gfl/shop/buy", { itemId: "scope" }).log[0],
    ).toMatchObject({ ok: true, price: 100 });
    expect(
      game.dispatch("gfl/equipment/equip", {
        dollId: "m4a1",
        equipmentId: "scope",
      }).log[0],
    ).toMatchObject({ ok: true, power: 1050 });
    expect(
      game.dispatch("gfl/fairy/acquire", { fairyId: "command" }).log[0],
    ).toMatchObject({ ok: true });
    expect(
      game.dispatch("gfl/fairy/assign", { fairyId: "command", echelonId: "e1" })
        .log[0],
    ).toMatchObject({ ok: true });
    expect(game.select("gfl/shop")).toMatchObject({
      catalog: expect.arrayContaining([
        expect.objectContaining({ id: "ration", owned: 0 }),
        expect.objectContaining({ id: "scope", owned: 0 }),
      ]),
      fairies: [{ id: "command", level: 1 }],
    });
  });
  it("preserves daily doll hiring, dorm capacity, arrival delay and snipe pricing", () => {
    const game = runtime();
    game.dispatch("gfl/start", { mode: "commander" });
    expect(game.dispatch("gfl/hire/refresh").log[0]).toMatchObject({
      ok: true,
      daily: true,
      offers: [
        { id: "m4a1", price: 700 },
        { id: "ump45", price: 400 },
      ],
    });
    expect(
      game.dispatch("gfl/hire/contract", { dollId: "ump45" }).log[0],
    ).toMatchObject({ ok: true, cost: 400, arrivalRemaining: 1, capacity: 3 });
    expect(game.select("gfl/hire")).toMatchObject({
      count: 1,
      capacity: 3,
      hiredToday: true,
      arrivals: [{ id: "ump45", status: "이동 중" }],
    });
    expect(
      game.dispatch("gfl/hire/snipe", { dollId: "m4a1" }).log[0],
    ).toMatchObject({ ok: false, reason: "gfl_hire_daily_limit" });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({
      ok: true,
      arrivals: [{ dollId: "ump45", name: "UMP45" }],
    });
    expect(game.select("gfl/dolls")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ump45", status: "대기" }),
      ]),
    );
  });
  it("rerolls a fresh doll slate and avoids yesterday's slate when the pool is large enough", () => {
    const source: any = structuredClone(schema);
    source.gfl.dolls = Array.from({ length: 15 }, (_, index) => ({
      id: `doll-${index}`,
      name: `DOLL-${index}`,
      class: index % 2 ? "AR" : "SMG",
      grade: 3,
      maxHp: 800,
      power: 800,
      price: 500,
    }));
    const game = runtime(source);
    game.dispatch("gfl/start", { mode: "commander" });
    const first = game.dispatch("gfl/hire/refresh").log[0]!.offers as Array<{ id: string }>;
    const second = game.dispatch("gfl/hire/refresh").log[0]!.offers as Array<{ id: string }>;
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(second.every((offer) => !first.some((previous) => previous.id === offer.id))).toBe(true);
    const mutable = game.state as any;
    mutable.day = 2;
    mutable.clock.day = 2;
    mutable.gfl.hireOffers = [];
    mutable.gfl.hireOfferDay = null;
    mutable.gfl.hireRefreshDay = null;
    const nextDay = game.dispatch("gfl/hire/refresh").log[0]!.offers as Array<{ id: string }>;
    expect(nextDay.every((offer) => !second.some((previous) => previous.id === offer.id))).toBe(true);
    const anotherChat = runtime(source, "another-chat");
    anotherChat.dispatch("gfl/start", { mode: "commander" });
    const anotherFirst = anotherChat.dispatch("gfl/hire/refresh").log[0]!.offers as Array<{ id: string }>;
    expect(anotherFirst.map((offer) => offer.id)).not.toEqual(first.map((offer) => offer.id));
  });
  it("uses the card original 1.5x facility cost progression", () => {
    const game = runtime();
    const first = game.dispatch("gfl/facility/upgrade", {
      facilityId: "base1",
    });
    expect(first.log[0]).toMatchObject({
      ok: true,
      cost: { gold: 100, res: 50 },
      nextCost: { gold: 150, res: 75 },
    });
    const second = game.dispatch("gfl/facility/upgrade", {
      facilityId: "base1",
    });
    expect(second.log[0]).toMatchObject({
      ok: true,
      cost: { gold: 150, res: 75 },
      nextCost: { gold: 225, res: 112 },
    });
    expect(game.select("gfl/facilities")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "base1",
          name: "훈련 시설",
          level: 3,
          cost: { gold: 225, res: 112 },
        }),
      ]),
    );
  });
  it("replays 300 native management actions without state drift", () => {
    const left = runtime(),
      right = runtime();
    for (const game of [left, right]) {
      game.dispatch("gfl/start", { mode: "commander" });
      game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    }
    for (let turn = 0; turn < 300; turn++) {
      const id = turn % 2 === 0 ? "gfl/echelon/assign" : "gfl/echelon/remove",
        params =
          turn % 2 === 0
            ? { echelonId: "e1", slot: 0, dollId: "m4a1" }
            : { echelonId: "e1", slot: 0 };
      expect(left.dispatch(id, params).log[0]?.ok).toBe(true);
      expect(right.dispatch(id, params).log[0]?.ok).toBe(true);
    }
    expect(left.snapshot()).toEqual(right.snapshot());
  });
  it("원본 회수값을 쓴다 — 지휘관 시작 자금·MOD_POWER 테이블·인형별 MP/기분", () => {
    const game = runtime();
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(game.state.gold).toBe(10000); // commanderFunds (원본 Lua의 지휘관 시작 자금)
    const m4 = (game.select("gfl/dolls") as any[]).find(
      (value) => value.id === "m4a1",
    );
    expect(m4.mp).toEqual({ cur: 1600, max: 1600 });
    expect(m4.mood).toBe(90); // 카드 실능력치 전달
    const before = m4.power as number;
    game.dispatch("gfl/location/move", { locationId: "base-maintenance" });
    expect(
      game.dispatch("gfl/mod/upgrade", { dollId: "m4a1" }).log[0],
    ).toMatchObject({ ok: true, power: before + 111 }); // schema modPower[0]
  });
  it("제조 난수와 저장·복원이 결정론적이다 — 같은 시드는 같은 상태, JSON 왕복 후에도 동일", () => {
    const runs = [runtime(), runtime()].map((game) => {
      game.dispatch("gfl/start", { mode: "commander" });
      game.dispatch("gfl/location/move", { locationId: "base-maintenance" });
      const started = game.dispatch("gfl/manufacture/start", { kind: "doll" })
        .log[0] as any;
      expect(started.ok).toBe(true);
      game.dispatch("gfl/manufacture/tick", { jobId: started.job.id });
      game.dispatch("gfl/manufacture/tick", { jobId: started.job.id });
      game.dispatch("gfl/facility/upgrade", { facilityId: "base1" });
      return game.snapshot();
    });
    expect(runs[0]).toEqual(runs[1]); // 같은 시드·이벤트 → 같은 상태(G2 합의)
    const revived = JSON.parse(JSON.stringify(runs[0]!.state));
    expect(revived).toEqual(runs[0]!.state); // 세이브 직렬화 왕복에 소실 없음
  });
  it("지휘관 위치·정비실 제한·현장/원격 지휘를 원본 규칙대로 구분한다", () => {
    const game = runtime();
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(
      game.dispatch("gfl/manufacture/start", { kind: "doll" }).log[0],
    ).toMatchObject({ ok: false, reason: "gfl_maintenance_required" });
    expect(
      game.dispatch("gfl/location/move", { locationId: "base-maintenance" })
        .log[0],
    ).toMatchObject({ ok: true, name: "정비실" });
    expect(game.select("gfl/status")).toMatchObject({
      locationId: "base-maintenance",
      locationName: "정비실",
    });
    game.dispatch("gfl/echelon/assign", {
      echelonId: "e1",
      slot: 0,
      dollId: "m4a1",
    });
    expect(
      game.dispatch("gfl/sortie/start", {
        missionId: "alpha",
        echelonId: "e1",
        command: "field",
      }).log[0],
    ).toMatchObject({ ok: true, command: "field" });
    expect(
      game.dispatch("gfl/location/move", { locationId: "base-command" }).log[0],
    ).toMatchObject({ ok: false, reason: "gfl_commander_in_field" });
    expect(game.select("gfl/locations")).toMatchObject({
      currentId: "base-maintenance",
      locked: true,
    });
    const remote = runtime();
    remote.dispatch("gfl/start", { mode: "commander" });
    remote.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    remote.dispatch("gfl/echelon/assign", {
      echelonId: "e1",
      slot: 0,
      dollId: "m4a1",
    });
    expect(
      remote.dispatch("gfl/sortie/start", {
        missionId: "alpha",
        echelonId: "e1",
        command: "remote",
      }).log[0],
    ).toMatchObject({ ok: true, command: "remote" });
    expect(
      remote.dispatch("gfl/location/move", { locationId: "base-hall" }).log[0]
        ?.ok,
    ).toBe(true);
  });
  it("하루를 여섯 시간대로 넘기며 보급·도착·회복을 한 번만 정산한다", () => {
    const source = structuredClone(schema) as any;
    source.gfl.timePhases = ["오전", "오후", "저녁", "밤", "심야", "새벽"];
    source.gfl.hire.capacity = [4, 8, 12, 16, 20];
    source.initialState.clock.phase = "오전";
    source.initialState.gfl.facilities = { base1: 1, base2: 1, base3: 1, base4: 1, base5: 1 };
    const game = runtime(source);
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const before = Number((game.state.resources as any).res);
    for (let step = 0; step < 3; step++) expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: true, newDay: false });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: true, before: "밤", phase: "심야" });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: true, before: "심야", phase: "새벽" });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: false, reason: "gfl_dawn_requires_end_day" });
    const endDay = game.dispatch("gfl/time/end-day").log[0] as any;
    expect(endDay).toMatchObject({ ok: true, day: 2, phase: "오전", daily: { income: 300 }, raid: { resourceDelta: expect.any(Number) } });
    expect(Number((game.state.resources as any).res)).toBe(before + 300 + endDay.raid.resourceDelta);
    expect(game.select("gfl/status")).toMatchObject({ day: 2, phase: "오전", time: 8 });
    expect(game.select("gfl/hire")).toMatchObject({ capacity: 4 });
  });
  it("Choice 캡슐을 Dice d20 판정으로 해결하고 AI가 숫자를 주입하지 못하게 한다", () => {
    const game = runtime();game.dispatch("gfl/start", { mode: "commander" });game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "nickname", dc: 1 }).log[0]).toMatchObject({ ok: false, reason: "gfl_check_number_not_allowed" });
    const result = game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "nickname" }).log[0] as any;
    expect(result).toMatchObject({ ok: true, mode: "dc", sides: 20, dc: 10, label: "서로 부를 별명을 정한다" });
    expect(["critical_success", "success", "failure", "critical_failure"]).toContain(result.tier);
    expect(game.select("gfl/status")).toMatchObject({ lastCheck: { roll: result.roll, affinity: result.affinity, mood: result.mood } });
  });
  it("카드 물품 효과·판매와 장비 해제를 실제 인형 상태와 재고에 반영한다", () => {
    const source = structuredClone(schema) as any;source.gfl.items=[{id:"cake",name:"케이크",price:300,type:"use",description:"호감 선물",effect:{hp:50,mood:30,aff:25}}];source.items=source.gfl.items;
    const game=runtime(source);game.dispatch("gfl/start",{mode:"commander"});game.dispatch("gfl/doll/acquire",{dollId:"m4a1"});game.dispatch("gfl/shop/buy",{itemId:"cake"});
    expect(game.dispatch("gfl/item/use",{itemId:"cake",dollId:"m4a1"}).log[0]).toMatchObject({ok:true,effect:{hp:50,mood:30,aff:25},affinity:25});
    game.dispatch("gfl/shop/buy",{itemId:"scope"});game.dispatch("gfl/equipment/equip",{dollId:"m4a1",equipmentId:"scope"});expect(game.dispatch("gfl/equipment/unequip",{dollId:"m4a1",equipmentId:"scope"}).log[0]).toMatchObject({ok:true,power:1000});
  });
  it("요구 전투력 미달도 출격시키고 d20 위험도를 반환한다", () => {
    const source = structuredClone(schema) as any; source.gfl.missions[0].power = 5000;
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", engagementMode: "tactical" }).log[0]).toMatchObject({ ok: true, power: 1100, risk: { ratio: 22, label: "극위험" }, sortiesRemaining: 2 });
  });
  it("별점·임무 유형으로 단계 수를 정하고 시작 때 시퀀스와 RNG를 한 번에 봉인한다", () => {
    const first = sortieGame({ stars: 4, boss: "Scarecrow", seed: 2026 });
    const before = first.snapshot().rng;
    const started = first.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", missionType: "annihil" }).log[0] as any;
    expect(started.stages).toHaveLength(10); // 4★ 기본 9 + 섬멸 1
    expect(started.stages.at(-1)).toEqual({ type: "boss" });
    expect(started.stages.some((stage: any) => stage.type === "battle")).toBe(true);
    const expected = createRng(0); expected.restore(before);
    for (let index = 0; index < 10; index++) expected.int(1, 100);
    expect(first.snapshot().rng).toBe(expected.snapshot());
    const second = sortieGame({ stars: 4, boss: "Scarecrow", seed: 2026 });
    expect(second.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", missionType: "annihil" }).log[0]).toMatchObject({ stages: started.stages });
    const recon = sortieGame({ stars: 0 });
    expect(recon.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", missionType: "recon" }).log[0]).toMatchObject({ stages: expect.arrayContaining([expect.any(Object)]) });
    expect(((recon.state.gfl as any).sortie.stages as any[])).toHaveLength(2);
    const invalid = sortieGame();
    expect(invalid.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", missionType: "escort" }).log[0]).toMatchObject({ ok: false, reason: "gfl_sortie_mission_type_invalid" });
  });
  it('첫 보스 격파만 구속 영입으로 이어지고 원본 능력치·금지·중복·정원·MOD 규칙을 지킨다', () => {
    const game = sortieGame({ boss: 'Scarecrow', seed: 31 });
    const mission = (game.schema.gfl as any).missions[0]; delete mission.enemies;
    game.dispatch('gfl/sortie/start', { missionId: 'alpha', echelonId: 'e1' });
    (game.state.gfl as any).sortie.stages = [{ type: 'boss' }];
    const victory = game.dispatch('gfl/sortie/resolve').log[0] as any;
    expect(victory).toMatchObject({ ok: true, operationComplete: true, enemies: [expect.objectContaining({ id: 'scarecrow', name: 'Scarecrow', maxHp: 1800, power: 1000, boss: true })] });
    expect(game.select('gfl/status')).toMatchObject({ defeatedBosses: ['scarecrow'], bossRecruit: { bossId: 'scarecrow', name: 'Scarecrow' } });
    const recruited = game.dispatch('gfl/boss/recruit').log[0] as any;
    expect(recruited).toMatchObject({ ok: true, bossId: 'scarecrow', class: 'BOSS', grade: 6, maxHp: 1800, power: 1000 });
    expect((game.state.gfl as any).dolls.scarecrow).toMatchObject({ class: 'BOSS', grade: 6, baseMaxHp: 1800, basePower: 1000, mood: 90, affinity: 0, mod: 0 });
    (game.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' };
    expect(game.dispatch('gfl/boss/recruit').log[0]).toMatchObject({ ok: false, reason: 'gfl_doll_owned' });
    game.state.location = 'base-maintenance'; (game.state.gfl as any).baseLocation = 'base-maintenance';
    expect(game.dispatch('gfl/mod/upgrade', { dollId: 'scarecrow' }).log[0]).toMatchObject({ ok: false, reason: 'gfl_boss_mod_forbidden' });

    const forbidden = sortieGame(); (forbidden.state.gfl as any).bossRecruit = { bossId: 'gebbennu', name: 'Gebbennu' };
    (forbidden.state.gfl as any).defeatedBosses = ['gebbennu'];
    expect(forbidden.dispatch('gfl/boss/recruit').log[0]).toMatchObject({ ok: false, reason: 'gfl_boss_no_recruit' });
    const unearned = sortieGame(); (unearned.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' };
    expect(unearned.dispatch('gfl/boss/recruit').log[0]).toMatchObject({ ok: false, reason: 'gfl_boss_not_defeated' });
    const full = sortieGame(); (full.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' }; (full.state.gfl as any).defeatedBosses = ['scarecrow'];
    (full.state.gfl as any).dolls.extra1 = { id: 'extra1' }; (full.state.gfl as any).dolls.extra2 = { id: 'extra2' };
    expect(full.dispatch('gfl/boss/recruit').log[0]).toMatchObject({ ok: false, reason: 'gfl_hire_capacity_full' });
  });
  it('영입 보스가 BOSS 전투 프로필로 제대 교전에 참여한다', () => {
    const game = sortieGame(); (game.state.gfl as any).defeatedBosses = ['scarecrow']; (game.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' };
    game.dispatch('gfl/boss/recruit'); game.dispatch('gfl/echelon/assign', { echelonId: 'e1', slot: 0, dollId: 'scarecrow' });
    game.dispatch('gfl/sortie/start', { missionId: 'alpha', echelonId: 'e1' });
    const battle = reachCombat(game);
    expect(battle.rounds.flatMap((round: any) => round.exchanges)).toEqual(expect.arrayContaining([expect.objectContaining({ side: 'ally', actorId: 'scarecrow' })]));
  });
  it('작전 완료 누계로 기록실 문서를 두 번마다 한 장씩 해금한다', () => {
    const game = sortieGame();
    expect(game.select('gfl/documents')).toMatchObject({ completed: 0, unlockedCount: 1, documents: [{ id: 'doc0', unlocked: true }, { id: 'doc1', unlocked: false }, { id: 'doc2', unlocked: false }] });
    game.dispatch('gfl/sortie/start', { missionId: 'alpha', echelonId: 'e1' });
    expect(completeOperation(game).docUnlocked).toBeNull();
    const unit = (game.state.gfl as any).dolls.m4a1; unit.hp.cur = unit.hp.max;
    game.dispatch('gfl/sortie/start', { missionId: 'alpha', echelonId: 'e1' });
    expect(completeOperation(game).docUnlocked).toMatchObject({ id: 'doc1', title: '두 번째 기록' });
    expect(game.select('gfl/documents')).toMatchObject({ completed: 2, unlockedCount: 2, documents: [{ unlocked: true }, { unlocked: true }, { unlocked: false }] });
    expect(game.select('gfl/unlockedDocs')).toEqual({ count: 2, ids: ['doc0', 'doc1'] });
  });
  it('하루 마감 습격·사회 정산은 발생 여부와 무관하게 RNG 13회(습격 2+사회 11)를 고정 소비한다', () => {
    const seedFor = (predicate: (raid: number, defense: number) => boolean) => {
      for (let seed = 1; seed < 10_000; seed++) { const rng = createRng(seed), raid = rng.int(1, 100), defense = rng.int(1, 20); if (predicate(raid, defense)) return seed; }
      throw new Error('seed not found');
    };
    const successSeed = seedFor((raid, defense) => raid <= 15 && defense === 20), failSeed = seedFor((raid, defense) => raid <= 15 && defense !== 20), noneSeed = seedFor((raid) => raid > 15);
    const make = (seed: number, level = 1, occupied = true) => {
      const source: any = structuredClone(schema); source.initialState.clock.phase = '저녁'; source.initialState.gfl.facilities.base2 = level;
      const game = runtime(source, seed); game.dispatch('gfl/start', { mode: 'commander' });
      if (occupied) { game.dispatch('gfl/doll/acquire', { dollId: 'm4a1' }); game.dispatch('gfl/echelon/assign', { echelonId: 'e1', slot: 0, dollId: 'm4a1' }); }
      return game;
    };
    // 사회 정산(태만·항명·뜬소문·감사·암시장 제안)이 11회를 추가로 항상 소비한다 — 습격 2회와 함께 13회 고정.
    const socialDraws = (rng: ReturnType<typeof createRng>) => {
      for (let count = 0; count < 7; count++) rng.int(1, count === 0 || count === 2 || count === 4 ? 100 : 1000);
      rng.int(1, 20); rng.int(1, 1000); rng.int(1, 1000); rng.int(1, 1000);
    };
    const success = make(successSeed), beforeSuccess = success.snapshot().rng, successLog = success.dispatch('gfl/time/end-day').log[0] as any,
      expectedSuccess = createRng(0); expectedSuccess.restore(beforeSuccess); expectedSuccess.int(1, 100); expectedSuccess.int(1, 20); socialDraws(expectedSuccess);
    expect(successLog.raid).toMatchObject({ occurred: true, chance: 15, success: true, resourceDelta: 100 }); expect(success.snapshot().rng).toBe(expectedSuccess.snapshot());
    const fail = make(failSeed, 1, false), failLog = fail.dispatch('gfl/time/end-day').log[0] as any;
    expect(failLog.raid).toMatchObject({ occurred: true, chance: 15, success: false, defensePower: 0, resourceDelta: expect.any(Number) }); expect(failLog.raid.resourceDelta).toBeLessThan(0);
    const none = make(noneSeed, 5), beforeNone = none.snapshot().rng, noneLog = none.dispatch('gfl/time/end-day').log[0] as any,
      expectedNone = createRng(0); expectedNone.restore(beforeNone); expectedNone.int(1, 100); expectedNone.int(1, 20); socialDraws(expectedNone);
    expect(noneLog.raid).toMatchObject({ occurred: false, chance: 3, success: false, resourceDelta: 0 }); expect(none.snapshot().rng).toBe(expectedNone.snapshot());
  });
  it('원본 인형 분해 보상과 합성 장비 해체 환급을 확인 절차 뒤에만 지급한다', () => {
    const game = runtime(structuredClone(schema), 81); game.dispatch('gfl/start', { mode: 'commander' });
    game.dispatch('gfl/doll/acquire', { dollId: 'm4a1' }); game.dispatch('gfl/echelon/assign', { echelonId: 'e1', slot: 0, dollId: 'm4a1' });
    (game.state.gfl as any).featuredDollId = 'm4a1'; (game.state.gfl as any).repairs = [{ id: 'r1', dollId: 'm4a1', status: 'active' }];
    expect(game.dispatch('gfl/doll/dismiss', { dollId: 'm4a1' }).log[0]).toMatchObject({ ok: false, reason: 'gfl_dismiss_confirmation_required' });
    const dismissed = game.dispatch('gfl/doll/dismiss', { dollId: 'm4a1', confirm: true }).log[0] as any;
    expect(dismissed).toMatchObject({ ok: true, reward: { coreId: 'core-item', cores: 1, res: expect.any(Number) } });
    expect(dismissed.reward.res).toBeGreaterThanOrEqual(500); expect(dismissed.reward.res).toBeLessThanOrEqual(2000);
    expect((game.state.items as any)['core-item']).toBe(1); expect((game.state.gfl as any).echelons[0].slots).not.toContain('m4a1'); expect((game.state.gfl as any).repairs).toEqual([]); expect((game.state.gfl as any).featuredDollId).toBeNull();
    game.dispatch('gfl/shop/buy', { itemId: 'scope' }); const parts = (game.state.resources as any).parts;
    expect(game.dispatch('gfl/equipment/scrap', { equipmentId: 'scope' }).log[0]).toMatchObject({ ok: false, reason: 'gfl_scrap_confirmation_required' });
    expect(game.dispatch('gfl/equipment/scrap', { equipmentId: 'scope', confirm: true }).log[0]).toMatchObject({ ok: true, reward: { parts: 30 } });
    expect((game.state.resources as any).parts).toBe(parts + 30);
  });
  it('분해한 보스의 격파 기록은 남지만 다시 영입할 수 없다', () => {
    const game = sortieGame(); (game.state.gfl as any).defeatedBosses = ['scarecrow']; (game.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' };
    game.dispatch('gfl/boss/recruit'); expect(game.dispatch('gfl/doll/dismiss', { dollId: 'scarecrow', confirm: true }).log[0]).toMatchObject({ ok: true, boss: true });
    expect((game.state.gfl as any).defeatedBosses).toContain('scarecrow'); expect((game.state.gfl as any).dismissedBosses).toContain('scarecrow');
    (game.state.gfl as any).bossRecruit = { bossId: 'scarecrow', name: 'Scarecrow' };
    expect(game.dispatch('gfl/boss/recruit').log[0]).toMatchObject({ ok: false, reason: 'gfl_boss_dismissed' });
  });
  it("정찰 명중 보정은 다음 전투 한 번만 쓰고 단계별 HP·루팅은 작전 끝까지 이어진다", () => {
    const game = sortieGame({ seed: 44 });
    game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    const sortie = (game.state.gfl as any).sortie;
    sortie.stages = [{ type: "recon" }, { type: "battle" }, { type: "battle" }]; sortie.current = 0;
    expect(game.dispatch("gfl/sortie/stage").log[0]).toMatchObject({ stageType: "recon", guide: "정찰 지시", scouted: true, current: 1, total: 3 });
    const first = game.dispatch("gfl/sortie/resolve").log[0] as any;
    expect(first.operationComplete).toBe(false);
    expect(first.rounds.flatMap((round: any) => round.exchanges).find((row: any) => row.side === "ally")).toMatchObject({ scoutedHit: 1 });
    expect(first.loot).toEqual([expect.objectContaining({ id: "ration", qty: 1 })]);
    expect((game.state.items as any).ration).toBe(1);
    const hpAfterFirst = (game.state.gfl as any).dolls.m4a1.hp.cur;
    const final = game.dispatch("gfl/sortie/resolve").log[0] as any;
    expect(final.rounds.flatMap((round: any) => round.exchanges).find((row: any) => row.side === "ally")).toMatchObject({ scoutedHit: 0 });
    expect(final.operationComplete).toBe(true);
    expect((game.state.gfl as any).dolls.m4a1.hp.cur).toBeLessThanOrEqual(hpAfterFirst);
    expect((game.state.items as any).ration).toBe(2);
    expect((game.state.gfl as any).completedMissions).toEqual(["alpha"]);
  });
  it("mystery는 무발견도 판정 1회를 소비하고 발견 시 모든 아이템을 독립 굴림하며 퇴각해도 전리품을 보존한다", () => {
    const game = sortieGame({ seed: 77 });
    game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    const sortie = (game.state.gfl as any).sortie;
    sortie.stages = [{ type: "mystery" }, { type: "battle" }]; sortie.current = 0;
    const before = game.snapshot().rng, result = game.dispatch("gfl/sortie/stage").log[0] as any,
      expected = createRng(0); expected.restore(before); expected.int(1, 100); expected.int(1, 1);
    if (result.branch === "loot") for (const _item of schema.gfl.items) expected.int(1, 100);
    expect(game.snapshot().rng).toBe(expected.snapshot());
    expect(result).toMatchObject({ stageType: "mystery", guide: "미확인 지시", loot: expect.any(Array) });
    const inventoryBefore = structuredClone(game.state.items);
    expect(game.dispatch("gfl/sortie/retreat").log[0]).toMatchObject({ ok: true, lootKept: true, completed: false });
    expect(game.state.items).toEqual(inventoryBefore);
    expect((game.state.gfl as any).completedMissions).toEqual([]);
  });
  it("mystery 3분기는 사건·대상 RNG 2회를 항상 소비하고 보유·ban 인형을 조우 풀에서 제외한다", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 200 && seen.size < 3; seed++) {
      const game = sortieGame({ seed }); game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
      const sortie = (game.state.gfl as any).sortie; sortie.stages = [{ type: "mystery" }, { type: "battle" }]; sortie.current = 0;
      const before = game.snapshot().rng, result = game.dispatch("gfl/sortie/stage").log[0] as any;
      if (seen.has(result.branch)) continue;
      seen.add(result.branch);
      const expected = createRng(0); expected.restore(before); expected.int(1, 100); expected.int(1, 1);
      if (result.branch === "loot") for (const _item of schema.gfl.items) expected.int(1, 100);
      expect(game.snapshot().rng).toBe(expected.snapshot());
      if (result.branch === "encounter") expect(result.encounter).toEqual({ dollId: "ump45", name: "UMP45" }); // 보유 M4A1 제외
    }
    expect(seen).toEqual(new Set(["loot", "encounter", "none"]));

    const bannedSource: any = structuredClone(schema); bannedSource.gfl.encounters.ban = ["ump45"];
    const banned = runtime(bannedSource, 3); banned.dispatch("gfl/start", { mode: "commander" }); banned.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); banned.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" }); banned.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    const bannedSortie = (banned.state.gfl as any).sortie; bannedSortie.stages = [{ type: "mystery" }, { type: "battle" }]; bannedSortie.current = 0;
    for (let tries = 0; tries < 20; tries++) { const log = banned.dispatch("gfl/sortie/stage").log[0] as any; if (log.branch === "encounter") throw new Error("banned encounter"); bannedSortie.current = 0; bannedSortie.stages[0].completed = false; }
  });
  it("야전 조우는 상태 근거·숙소 정원·작전당 1명 상한을 지키고 영입 후 퇴각해도 인형을 보존한다", () => {
    expect(sortieGame().dispatch("gfl/encounter/recruit").log[0]).toMatchObject({ ok: false, reason: "gfl_encounter_missing" });
    let encounterGame: ReturnType<typeof sortieGame> | null = null;
    for (let seed = 1; seed < 200 && !encounterGame; seed++) {
      const game = sortieGame({ seed }); game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
      const sortie = (game.state.gfl as any).sortie; sortie.stages = [{ type: "mystery" }, { type: "battle" }]; sortie.current = 0;
      if ((game.dispatch("gfl/sortie/stage").log[0] as any).branch === "encounter") encounterGame = game;
    }
    expect(encounterGame).not.toBeNull();
    const joined = encounterGame!.dispatch("gfl/encounter/recruit").log[0] as any;
    expect(joined).toMatchObject({ ok: true, dollId: "ump45", status: "대기", count: 2 });
    expect((encounterGame!.state.gfl as any).dolls.ump45).toMatchObject({ name: "UMP45", status: "대기", power: 900 });
    (encounterGame!.state.gfl as any).sortie.encounter = { dollId: "ump45", name: "UMP45" };
    expect(encounterGame!.dispatch("gfl/encounter/recruit").log[0]).toMatchObject({ ok: false, reason: "gfl_encounter_limit" });
    expect(encounterGame!.dispatch("gfl/sortie/retreat").log[0]).toMatchObject({ ok: true, lootKept: true });
    expect((encounterGame!.state.gfl as any).dolls.ump45).toBeTruthy();

    const full = sortieGame(); full.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    (full.state.gfl as any).dolls.extra1 = { id: "extra1" }; (full.state.gfl as any).dolls.extra2 = { id: "extra2" };
    (full.state.gfl as any).sortie.encounter = { dollId: "ump45", name: "UMP45" };
    expect(full.dispatch("gfl/encounter/recruit").log[0]).toMatchObject({ ok: false, reason: "gfl_hire_capacity_full" });
  });
  it("정찰 임무도 원본 규칙대로 최소 한 번의 battle 단계를 보장한다", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const game = sortieGame({ seed });
      const start = game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", missionType: "recon" }).log[0] as any;
      expect(start.stages.some((stage: any) => stage.type === "battle")).toBe(true);
    }
  });
  it("같은 전선의 작전 지역을 이전 지역 클리어 순서로 개방한다", () => {
    const source = structuredClone(schema) as any; source.gfl.missions[0].theater = "front"; source.gfl.missions.push({ id: "beta", name: "BETA", theater: "front", power: 100, enemy: "철혈", rewards: {} });
    const game = runtime(source); expect(game.select("gfl/missions")).toMatchObject([{ id: "alpha", unlocked: true }, { id: "beta", unlocked: false }]);
    (game.state.gfl as any).completedMissions = ["alpha"]; expect(game.select("gfl/missions")).toMatchObject([{ id: "alpha", unlocked: true }, { id: "beta", unlocked: true }]);
  });
  it("대표 인형·관계 난이도·일일 작전 제한을 엔진 상태로 저장한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    expect(game.dispatch("gfl/doll/feature", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: true }); expect(game.dispatch("gfl/settings/update", { relationDifficulty: "strict" }).log[0]).toMatchObject({ ok: true });
    expect(game.select("gfl/status")).toMatchObject({ featuredDollId: "m4a1", settings: { relationDifficulty: "strict" } });
    for (let count = 0; count < 3; count++) { game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }); completeOperation(game); const unit=(game.state.gfl as any).dolls.m4a1; unit.hp.cur=unit.hp.max; }
    expect(game.select("gfl/daily")).toMatchObject({ sortiesUsed: 3, sortiesRemaining: 0, sortieLimit: 3 }); expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_sortie_daily_limit" });
  });
  it("관계 선택지를 티어·일일 사용량 기반으로 제시하고 잠금 사유를 밝힌다", () => {
    const source = structuredClone(schema) as any;
    source.gfl.relation = { names: ["첫 만남", "신뢰", "친밀", "연인", "가족"], thresholds: [0, 50, 150, 300, 450], descriptions: ["", "서로를 알아간다", "", "", ""] };
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const entry = (game.select("gfl/relation/options") as any).dolls.m4a1;
    expect(entry.tier).toMatchObject({ index: 0, label: "첫 만남" });
    const byId = Object.fromEntries(entry.choices.map((choice: any) => [choice.id, choice]));
    expect(byId.talk).toMatchObject({ available: true, dc: 8 });
    expect(byId.nickname).toMatchObject({ available: true });
    expect(byId["ask-past"]).toMatchObject({ available: false, reason: "tier_locked", requiredTierLabel: "신뢰" });
    (game.state.gfl as any).dolls.m4a1.affinity = 60;
    const after = (game.select("gfl/relation/options") as any).dolls.m4a1;
    const afterById = Object.fromEntries(after.choices.map((choice: any) => [choice.id, choice]));
    expect(after.tier.index).toBe(1);
    expect(afterById["ask-past"].available).toBe(true);
    expect(afterById.train).toMatchObject({ available: false, reason: "tier_locked" });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "train" }).log[0]).toMatchObject({ ok: false, reason: "gfl_relation_tier_locked", detail: "친밀" });
  });
  it("실카드 11티어는 중립 기준으로 선택지를 해금하고 중복 400 문턱에서 서약을 유지한다", () => {
    const source = structuredClone(schema) as any;
    source.gfl.relation = {
      names: ["적대", "경계", "불편", "첫 만남", "익숙해짐", "호감을 가짐", "신뢰", "소중히 여김", "사랑", "서약", "???"],
      thresholds: [-150, -80, -20, 0, 20, 50, 80, 120, 150, 400, 400],
      descriptions: Array(11).fill(""),
    };
    const game = runtime(source);
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const expected: Array<[number, string[], string]> = [
      [-100, ["talk"], "적대"],
      [0, ["talk", "nickname", "encourage"], "첫 만남"],
      [25, ["talk", "nickname", "encourage", "ask-past", "coffee"], "익숙해짐"],
      [55, ["talk", "nickname", "encourage", "ask-past", "coffee", "train", "walk"], "호감을 가짐"],
      [85, ["talk", "nickname", "encourage", "ask-past", "coffee", "train", "walk", "confide"], "신뢰"],
      [150, ["talk", "nickname", "encourage", "ask-past", "coffee", "train", "walk", "confide", "promise"], "사랑"],
      [400, ["talk", "nickname", "encourage", "ask-past", "coffee", "train", "walk", "confide", "promise"], "서약"],
    ];
    for (const [affinity, ids, label] of expected) {
      (game.state.gfl as any).dolls.m4a1.affinity = affinity;
      const entry = (game.select("gfl/relation/options") as any).dolls.m4a1;
      expect(entry.tier.label).toBe(label);
      const available = entry.choices.filter((choice: any) => choice.available).map((choice: any) => choice.id);
      expect(available).toEqual(expect.arrayContaining(ids));
      expect(available).toHaveLength(ids.length);
    }
  });
  it("relation 설정이 없는 카드는 관계 선택지 9종을 전부 개방한다", () => {
    const source = structuredClone(schema) as any;
    delete source.gfl.relation;
    const game = runtime(source);
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const choices = (game.select("gfl/relation/options") as any).dolls.m4a1.choices;
    expect(choices).toHaveLength(9);
    expect(choices.every((choice: any) => choice.available)).toBe(true);
  });
  it("같은 선택지 반복은 효과가 절반이 되고 하루 상한을 넘으면 거부한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 490; unit.mood = 1000; // 보정 +19 → 어떤 굴림도 성공
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0]).toMatchObject({ ok: true, repeated: false });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0]).toMatchObject({ ok: true, repeated: true });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0]).toMatchObject({ ok: false, reason: "gfl_relation_choice_exhausted" });
    game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "nickname" });
    game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "encourage" });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "nickname" }).log[0]).toMatchObject({ ok: false, reason: "gfl_relation_exhausted" });
    expect((game.select("gfl/relation/options") as any).dolls.m4a1.remaining).toBe(0);
  });
  it("성공한 판정은 후속 캡슐을 남기고 소비하면 DC 보정이 적용된다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 490; unit.mood = 1000;
    const first = game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0] as any;
    expect(first.followUps.length).toBeGreaterThan(0);
    const followUp = (game.select("gfl/status") as any).followUp;
    expect(followUp).toMatchObject({ dollId: "m4a1", source: "talk" });
    const offered = followUp.options[0];
    expect(offered.dc).toBeLessThan(10); // nickname 기본 DC 10에서 보정
    const second = game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: offered.choice, followup: true }).log[0] as any;
    expect(second).toMatchObject({ ok: true, dc: offered.dc, followUpBonus: offered.dcMod });
    game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "coffee" });
    expect((game.select("gfl/status") as any).followUp).not.toBeNull();
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: true });
    expect((game.select("gfl/status") as any).followUp).toBeNull(); // 시간대가 넘어가면 캡슐 소멸
  });
  it("판정으로 관계 단계가 오르면 tierChanged를 남긴다", () => {
    const source = structuredClone(schema) as any;
    source.gfl.relation = { names: ["첫 만남", "신뢰"], thresholds: [0, 50], descriptions: ["", "서로를 믿는다"] };
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 49; unit.mood = 1000; // 항상 성공, +3 이상이면 승급
    const result = game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0] as any;
    expect(result.tierChanged).toMatchObject({ from: { index: 0 }, to: { index: 1, label: "신뢰", description: "서로를 믿는다" } });
    expect((game.select("gfl/status") as any).lastCheck.tierChanged.to.label).toBe("신뢰");
  });
  it("1:1 대화 세션은 시간을 잠그고 마무리 보너스를 하루 1회 확정한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/doll/acquire", { dollId: "ump45" });
    expect(game.dispatch("gfl/relation/session/end").log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_missing" });
    expect(game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, name: "M4A1" });
    expect((game.select("gfl/status") as any).dialogue).toMatchObject({ dollId: "m4a1" });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_active" });
    expect(game.dispatch("gfl/location/move", { locationId: "base-hall" }).log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_active" });
    expect(game.dispatch("gfl/relation/session/start", { dollId: "ump45" }).log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_active" });
    expect(game.dispatch("gfl/relation/check", { dollId: "ump45", choice: "talk" }).log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_other_doll" });
    const before = Number((game.state.gfl as any).dolls.m4a1.affinity);
    expect(game.dispatch("gfl/relation/session/end").log[0]).toMatchObject({ ok: true, affinityDelta: 2, moodDelta: 10 });
    expect(Number((game.state.gfl as any).dolls.m4a1.affinity)).toBe(before + 2);
    expect(game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_dialogue_daily_limit" });
    expect((game.select("gfl/relation/options") as any).dolls.m4a1.dialogueUsed).toBe(true);
    expect(game.dispatch("gfl/relation/session/start", { dollId: "ump45" }).log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/relation/session/end").log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/time/advance").log[0]).toMatchObject({ ok: true });
  });
  it("별점별 지휘 EXP 표와 보스·재클리어 배율을 결정론적으로 적용한다", () => {
    expect(COMMANDER_EXP_BY_STAR).toEqual([10, 15, 20, 30, 40, 55, 70]);
    for (const [stars, expected] of COMMANDER_EXP_BY_STAR.entries()) {
      const game = sortieGame({ stars });
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
      expect(completeOperation(game).commanderExp.gained).toBe(expected);
    }
    const boss = sortieGame({ stars: 3, boss: "Scarecrow" });
    boss.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(completeOperation(boss).commanderExp.gained).toBe(45);
    boss.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(completeOperation(boss).commanderExp.gained).toBe(16);
    const minimum = sortieGame({ stars: 0 });
    (minimum.state.gfl as any).completedMissions = ["alpha"];
    minimum.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(completeOperation(minimum).commanderExp.gained).toBe(4);
  });
  it("29 EXP 경계와 한 번에 여러 레벨 상승을 전투 로그에 남긴다", () => {
    const boundary = sortieGame({ exp: 29, stars: 0 });
    boundary.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(completeOperation(boundary)).toMatchObject({ commanderExp: { gained: 10, total: 39, level: 2 }, levelUp: { from: 1, to: 2 } });
    const multi = sortieGame({ exp: 29, stars: 6, boss: "Scarecrow" });
    multi.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(completeOperation(multi)).toMatchObject({ commanderExp: { gained: 105, total: 134, level: 3 }, levelUp: { from: 1, to: 3 } });
  });
  it("Lv4·12에서 일일 작전 상한을 4·5회로 해금하고 다음 출격을 막는다", () => {
    for (const [exp, limit] of [[150, 4], [1430, 5]] as const) {
      const game = sortieGame({ exp });
      expect(game.select("gfl/daily")).toMatchObject({ sortieLimit: limit, sortiesRemaining: limit });
      for (let index = 0; index < limit; index++) {
        expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: true, sortiesRemaining: limit - index - 1 });
        (game.state.gfl as any).sortie = null;
      }
      expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_sortie_daily_limit", detail: String(limit) });
    }
  });
  it("Lv8·16 지휘 보정을 브리핑과 실제 판정에 똑같이 반영한다", () => {
    for (const [exp, bonus] of [[630, 1], [2550, 2]] as const) {
      const game = sortieGame({ exp });
      const start = game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0] as any;
      expect(start.risk.commanderBonus).toBe(bonus);
      const battle = reachCombat(game);
      expect(battle.missionCheck.commanderBonus).toBe(bonus);
      expect(battle.missionCheck.total).toBe(battle.missionCheck.roll + battle.missionCheck.modifier);
    }
  });
  it("패배는 EXP를 주지 않고 Lv20은 초과 EXP를 보존하며 칭호만 표시한다", () => {
    const defeat = sortieGame({ exp: 29, stars: 6, enemyPower: 100_000, seed: 11 });
    defeat.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(reachCombat(defeat)).toMatchObject({ outcome: "defeat", commanderExp: { gained: 0, total: 29, level: 1 } });
    const capped = sortieGame({ exp: 5000 });
    expect(capped.select("gfl/status")).toMatchObject({ commander: { level: 20, exp: 5000, expIntoLevel: 1010, expForNext: null, sortieLimit: 5, checkBonus: 2, title: "백전의 지휘관" } });
  });
  it("6번째 제대 칸에 배치·해제할 수 있고 구 5칸 상태도 6칸으로 승격한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect(game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 5, dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, slot: 5 });
    const slots = (game.state.gfl as any).echelons[0].slots as unknown[];
    expect(slots.length).toBe(6); // 테스트 스키마의 5칸 구상태가 배치 시점에 6칸으로 승격
    expect(slots[5]).toBe("m4a1");
    expect(game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 6, dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_slot_invalid" });
    expect(game.dispatch("gfl/echelon/remove", { echelonId: "e1", slot: 5 }).log[0]).toMatchObject({ ok: true, removed: "m4a1" });
  });
  it("seal 이주는 5칸 제대를 6칸으로 패딩하고 두 번 적용해도 같은 상태다", () => {
    const old = structuredClone(schema.initialState) as any;
    old.gfl.echelons[0].slots = ["m4a1", null, null, null, null];
    const registry = createCoreRegistry().register(gflModule()), first = registry.sealMigrations(schema, old),
      second = registry.sealMigrations(schema, first.state);
    expect((first.state.gfl as any).echelons[0].slots).toEqual(["m4a1", null, null, null, null, null]);
    expect(first.applied).toContainEqual({ moduleId: "genre.gfl", changed: true });
    expect(second.state).toEqual(first.state);
    expect(second.applied).toContainEqual({ moduleId: "genre.gfl", changed: false });
    expect((old.gfl as any).echelons[0].slots).toHaveLength(5);
  });
  it("군수지원은 출발 때 RNG 1회로 보상을 봉인하고 완료 뒤 수동 수령한다", () => {
    const game = runtime(structuredClone(schema), 20260718); game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    const before = game.snapshot().rng, started = game.dispatch("gfl/logistics/dispatch", { echelonId: "e1", duration: 2 }).log[0] as any,
      expected = createRng(0); expected.restore(before); expected.int(90, 110);
    expect(started).toMatchObject({ ok: true, job: { echelonId: "e1", duration: 2, remaining: 2, status: "active", reward: { gold: expect.any(Number), res: expect.any(Number) } } });
    expect(game.snapshot().rng).toBe(expected.snapshot());
    expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_echelon_logistics_active" });
    const reward = structuredClone(started.job.reward), funds = Number(game.state.gold), res = Number((game.state.resources as any).res);
    game.dispatch("gfl/time/advance"); game.dispatch("gfl/time/advance");
    expect(game.select("gfl/logistics")).toEqual([expect.objectContaining({ status: "complete", remaining: 0, reward })]);
    expect(game.state.gold).toBe(funds); expect((game.state.resources as any).res).toBe(res);
    expect(game.dispatch("gfl/logistics/collect", { jobId: started.job.id }).log[0]).toMatchObject({ ok: true, reward });
    expect(game.state.gold).toBe(funds + reward.gold); expect((game.state.resources as any).res).toBe(res + reward.res);
    expect(game.select("gfl/logistics")).toEqual([]);
  });
  it("군수 거부 조건은 RNG를 쓰지 않고 2·4·6 외 시간은 받지 않는다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" });
    const before = game.snapshot().rng;
    expect(game.dispatch("gfl/logistics/dispatch", { echelonId: "e1", duration: 3 }).log[0]).toMatchObject({ ok: false, reason: "gfl_logistics_duration_invalid" });
    expect(game.snapshot().rng).toBe(before);
    expect(game.dispatch("gfl/logistics/dispatch", { echelonId: "e1", duration: 2 }).log[0]).toMatchObject({ ok: false, reason: "gfl_echelon_empty" });
    expect(game.snapshot().rng).toBe(before);
  });
  it("심야·새벽은 HG 조명과 동일한 위험 보정을 실제 전투에 쓰고 부품을 두 배 지급한다", () => {
    const game = sortieGame({ stars: 0 }); (game.state.clock as any).phase = "심야";
    const started = game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0] as any;
    expect(started).toMatchObject({ night: { night: true, phase: "심야", modifier: -3, hgCount: 0 }, risk: { fieldModifier: -3 } });
    const finished = completeOperation(game);
    expect(finished).toMatchObject({ outcome: "victory", night: true, nightHitModifier: -3, rewards: { parts: 2 } });
    expect(finished.missionCheck.modifier).toBe(finished.missionCheck.risk.baseModifier + finished.missionCheck.commanderBonus - 3);

    const source: any = structuredClone(schema); source.gfl.dolls.push({ id: "hg", name: "HG", class: "HG", grade: 3, maxHp: 1000, power: 1000 });
    const lit = runtime(source); lit.dispatch("gfl/start", { mode: "commander" }); lit.dispatch("gfl/doll/acquire", { dollId: "hg" }); lit.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "hg" }); (lit.state.clock as any).phase = "새벽";
    expect(lit.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ night: { night: true, modifier: -1, hgCount: 1 }, risk: { fieldModifier: -1 } });
  });
  it("사랑 단계의 반지는 서약을 맺고 이후 기분 30 하한·최종 전투력 5%를 유지한다", () => {
    const source: any = structuredClone(schema); source.gfl.relation = { names: ["첫 만남", "사랑", "서약"], thresholds: [0, 150, 400], descriptions: ["", "", ""] };
    source.gfl.items = [{ id: "ring", name: "서약반지", type: "use", effect: { aff: 500 }, price: 10000 }, { id: "shock", name: "충격", type: "use", effect: { mood: -100 }, price: 0 }];
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 150; (game.state.items as any).ring = 1; (game.state.items as any).shock = 1;
    expect((game.select("gfl/echelons") as any)[0].power).toBe(1100);
    expect(game.dispatch("gfl/item/use", { itemId: "ring", dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, oathApplied: true, oathed: true });
    expect((game.select("gfl/echelons") as any)[0].power).toBe(1155);
    expect(game.dispatch("gfl/item/use", { itemId: "shock", dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, mood: 30, oathed: true });
  });
  it("사랑 미만의 반지는 기존 호감 효과만 적용하고 서약하지 않는다", () => {
    const source: any = structuredClone(schema); source.gfl.relation = { names: ["첫 만남", "사랑", "서약"], thresholds: [0, 150, 400], descriptions: ["", "", ""] };
    source.gfl.items = [{ id: "ring", name: "서약반지", type: "use", effect: { aff: 500 }, price: 10000 }];
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); (game.state.items as any).ring = 1;
    expect(game.dispatch("gfl/item/use", { itemId: "ring", dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, oathApplied: false, oathed: false, affinity: 500 });
  });
  it("긴급 수복은 부품 2개만 더 쓰고 RNG 없이 즉시 완료한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/location/move", { locationId: "base-maintenance" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.hp.cur = 1;
    const repair = game.dispatch("gfl/repair/start", { dollId: "m4a1" }).log[0] as any, before = game.snapshot().rng;
    expect(game.dispatch("gfl/repair/rush", { jobId: repair.job.id }).log[0]).toMatchObject({ ok: true, job: { status: "complete", remaining: 0 }, cost: { parts: 2 } });
    expect(game.snapshot().rng).toBe(before); expect((game.state.resources as any).parts).toBe(0); const repaired = (game.state.gfl as any).dolls.m4a1; expect(repaired.hp.cur).toBe(repaired.hp.max);
  });
  it("30일 표준 운용에서 군수지원 수입은 총수입 40% 이하다", () => {
    const game = runtime(structuredClone(schema), 30); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    let logisticsIncome = 0;
    for (let day = 0; day < 30; day++) {
      const job = (game.dispatch("gfl/logistics/dispatch", { echelonId: "e1", duration: 6 }).log[0] as any).job;
      for (let phase = 0; phase < 6; phase++) game.dispatch("gfl/time/advance", { settlement: true });
      logisticsIncome += Number(job.reward.gold) + Number(job.reward.res); game.dispatch("gfl/logistics/collect", { jobId: job.id });
    }
    const supplyIncome = 30 * 300, routineSortieIncome = 500 + 29 * Math.floor(500 * .35), totalIncome = logisticsIncome + supplyIncome + routineSortieIncome,
      share = logisticsIncome / totalIncome;
    expect(share).toBeLessThanOrEqual(.4);
  });
  it("병과 전투 성향에서 권장 열과 세력 배지를 셀렉터로 노출한다", () => {
    const guide = runtime().select("gfl/formation/guide");
    expect(guide).toMatchObject({ SG: "전열", SMG: "전열", AR: "중열", HG: "중열", MG: "후열", RF: "후열", factions: { 철혈: "⚙", 바랴그단: "🎯", "E.L.I.D": "☣", 패러데우스: "⬡" } });
  });
  it("오토런은 수동 단계 진행과 같은 시드에서 완전히 같은 결과를 낸다", () => {
    const run = (mode: "auto" | "manual") => {
      const source: any = structuredClone(schema);
      source.gfl.missions[0] = { ...source.gfl.missions[0], stars: 1, power: 100, enemies: [{ id: "t", name: "표적", power: 20, hp: 60 }] };
      source.gfl.dolls[0].power = 10_000; source.gfl.dolls[0].maxHp = 10_000;
      const game = runtime(source, 4242);
      game.dispatch("gfl/start", { mode: "commander" });
      game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
      game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", engagementMode: "quick", missionType: "sweep" });
      if (mode === "auto") expect((game.dispatch("gfl/sortie/auto").log[0] as any).ok).toBe(true);
      else for (let step = 0; step < 14; step++) {
        const gfl = game.state.gfl as any, sortie = gfl.sortie;
        if (!sortie?.active || sortie.encounter?.dollId || gfl.prisoner?.active) break;
        if (sortie.stages[Math.min(sortie.current, sortie.stages.length - 1)].type === "boss") break;
        if (!(game.dispatch("gfl/sortie/stage").log[0] as any).ok) break;
      }
      return game.snapshot();
    };
    const auto = run("auto"), manual = run("manual");
    expect(JSON.stringify(auto.state)).toBe(JSON.stringify(manual.state)); // 수치 재구현 없음의 증명
    expect(auto.rng).toBe(manual.rng);
  });
  it("오토런은 quick 전용이고 보스 직전에 멈추며 잘못된 서사 설정을 거부한다", () => {
    const tactical = (() => {
      const source: any = structuredClone(schema);
      source.gfl.missions[0] = { ...source.gfl.missions[0], stars: 0 };
      const game = runtime(source, 7);
      game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
      game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", engagementMode: "tactical" });
      return game.dispatch("gfl/sortie/auto").log[0] as any;
    })();
    expect(tactical).toMatchObject({ ok: false, reason: "gfl_auto_tactical" });
    let bossStop: any = null;
    for (let seed = 1; seed < 60 && !bossStop; seed++) {
      const source: any = structuredClone(schema);
      source.gfl.missions[0] = { ...source.gfl.missions[0], stars: 0, power: 100, boss: "Scarecrow" };
      source.gfl.dolls[0].power = 10_000; source.gfl.dolls[0].maxHp = 10_000;
      const game = runtime(source, seed);
      game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
      game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", engagementMode: "quick" });
      const log = game.dispatch("gfl/sortie/auto").log[0] as any;
      if (log.ok && log.stopReason === "boss") {
        const sortie = (game.state.gfl as any).sortie;
        expect(sortie.active).toBe(true);
        expect(sortie.stages[sortie.current].type).toBe("boss"); // 보스는 자동으로 넘지 않는다
        bossStop = log;
      }
    }
    expect(bossStop).not.toBeNull();
    const settings = runtime();
    settings.dispatch("gfl/start", { mode: "commander" });
    expect(settings.dispatch("gfl/settings/update", { stageNarration: "nope" }).log[0]).toMatchObject({ ok: false, reason: "gfl_stage_narration_invalid" });
    expect(settings.dispatch("gfl/settings/update", { stageNarration: "each" }).log[0]).toMatchObject({ ok: true });
    expect((settings.select("gfl/status") as any).settings.stageNarration).toBe("each");
  });
  it("근무 배치가 적성 효과·훈련 보너스·기분 소모·수면 절반을 만든다", () => {
    const source: any = structuredClone(schema);
    source.initialState.clock.phase = "저녁";
    const game = runtime(source, 5);
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); // AR — base1(훈련) 적성
    expect(game.dispatch("gfl/crew/assign", { facilityId: "base9", dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_crew_facility_invalid" });
    expect(game.dispatch("gfl/crew/assign", { facilityId: "base1", dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, aptitude: true });
    expect(game.dispatch("gfl/crew/assign", { facilityId: "base4", dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_crew_already_assigned" });
    expect((game.select("gfl/crew") as any[]).find((row) => row.facilityId === "base1")).toMatchObject({ effect: 1.5, slacked: false });
    game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    expect((game.select("gfl/echelons") as any[])[0].power).toBe(Math.round(1000 * 1.13)); // 10%p + 1.5×2%p
    const before = Number((game.state.gfl as any).dolls.m4a1.mood);
    game.dispatch("gfl/time/advance"); // 저녁→밤: 근무 피로 −2(적성)
    expect(Number((game.state.gfl as any).dolls.m4a1.mood)).toBe(before - 2);
    const beforeEnd = Number((game.state.gfl as any).dolls.m4a1.mood);
    game.dispatch("gfl/time/end-day"); // 밤→심야→새벽→오전(3회 −2) + 수면 회복 절반(+5)
    expect(Number((game.state.gfl as any).dolls.m4a1.mood)).toBe(beforeEnd - 6 + 5);
    expect(game.dispatch("gfl/crew/remove", { facilityId: "base1", dollId: "m4a1" }).log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/crew/remove", { facilityId: "base1", dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_crew_not_assigned" });
  });
  it("불만도가 태만·항명을 낳고 관계 성공이 항명을 푼다", () => {
    const seedFor = () => {
      for (let seed = 1; seed < 30000; seed++) {
        const rng = createRng(seed);
        rng.int(1, 100); rng.int(1, 20); // 습격 2회
        const slack = rng.int(1, 100); rng.int(1, 1000);
        const mutiny = rng.int(1, 100);
        if (slack <= 50 && mutiny <= 20) return seed;
      }
      throw new Error("seed not found");
    };
    const source: any = structuredClone(schema);
    source.initialState.clock.phase = "저녁";
    const game = runtime(source, seedFor());
    game.dispatch("gfl/start", { mode: "commander" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    game.dispatch("gfl/doll/acquire", { dollId: "ump45" });
    game.dispatch("gfl/crew/assign", { facilityId: "base1", dollId: "m4a1" });
    (game.state.gfl as any).dissatisfaction = 100;
    const log = game.dispatch("gfl/time/end-day").log[0] as any;
    expect(log.social.dissatisfaction).toBeGreaterThanOrEqual(90);
    expect(log.social.slack).toMatchObject({ facilityId: "base1", dollId: "m4a1" });
    expect((game.select("gfl/crew") as any[]).find((row) => row.facilityId === "base1")).toMatchObject({ slacked: true, effect: 0 });
    expect(log.social.mutiny).toBeDefined();
    const mutineer = String(log.social.mutiny.dollId);
    game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: mutineer });
    expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_doll_refusal" });
    const unit = (game.state.gfl as any).dolls[mutineer];
    unit.affinity = 490; unit.mood = 1000; // 보정 +19 — 항상 성공
    expect(game.dispatch("gfl/relation/check", { dollId: mutineer, choice: "talk" }).log[0]).toMatchObject({ ok: true });
    expect((game.state.gfl as any).dolls[mutineer].refusal).toBe(false);
    expect(game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }).log[0]).toMatchObject({ ok: true });
  });
  it("가공 라인과 시설 특화가 산출·수복을 바꾼다", () => {
    const source: any = structuredClone(schema);
    source.initialState.clock.phase = "저녁";
    source.initialState.gfl.facilities = { base1: 1, base2: 1, base3: 5, base4: 5, base5: 1 };
    const game = runtime(source, 9);
    game.dispatch("gfl/start", { mode: "commander" });
    expect(game.dispatch("gfl/facility/specialize", { facilityId: "base1", branch: "assault" }).log[0]).toMatchObject({ ok: false, reason: "gfl_specialize_level_required" });
    expect(game.dispatch("gfl/facility/specialize", { facilityId: "base4", branch: "materiel" }).log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/facility/specialize", { facilityId: "base4", branch: "finance" }).log[0]).toMatchObject({ ok: false, reason: "gfl_specialize_already" });
    expect(game.dispatch("gfl/refinery/start", { recipe: "nope" }).log[0]).toMatchObject({ ok: false, reason: "gfl_refinery_recipe_invalid" });
    expect(game.dispatch("gfl/refinery/start", { recipe: "parts" }).log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/refinery/start", { recipe: "parts" }).log[0]).toMatchObject({ ok: true });
    expect(game.dispatch("gfl/refinery/start", { recipe: "parts" }).log[0]).toMatchObject({ ok: false, reason: "gfl_refinery_slots_full" });
    const partsBefore = Number((game.state.resources as any).parts);
    game.dispatch("gfl/time/advance"); game.dispatch("gfl/time/advance");
    const refinery = game.select("gfl/refinery") as any;
    expect(refinery.jobs[0].status).toBe("complete");
    expect(game.dispatch("gfl/refinery/collect", { jobId: refinery.jobs[0].id }).log[0]).toMatchObject({ ok: true });
    expect(Number((game.state.resources as any).parts)).toBe(partsBefore + 20);
    const endLog = game.dispatch("gfl/time/end-day").log[0] as any;
    expect(endLog.daily.income).toBe(Math.round(2500 * 1.15)); // 물자 특화 +15%
    game.dispatch("gfl/facility/specialize", { facilityId: "base3", branch: "rapid" });
    game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const hurt = (game.state.gfl as any).dolls.m4a1; hurt.hp.cur = 100;
    game.dispatch("gfl/location/move", { locationId: "base-maintenance" });
    const job = (game.dispatch("gfl/repair/start", { dollId: "m4a1" }).log[0] as any).job;
    expect(job.remaining).toBe(1); // 고속 정비 −1
  });
  it("뜬소문 수위 옵션과 암시장 감사가 결정론으로 작동한다", () => {
    const gossipSeed = (() => {
      for (let seed = 1; seed < 30000; seed++) {
        const rng = createRng(seed);
        rng.int(1, 100); rng.int(1, 20);
        const slack = rng.int(1, 100); rng.int(1, 1000);
        const mutiny = rng.int(1, 100); rng.int(1, 1000); rng.int(1, 1000);
        void mutiny;
        const rolled = createRng(seed); rolled.int(1, 100); rolled.int(1, 20);
        const s2 = rolled.int(1, 100); rolled.int(1, 1000); const m2 = rolled.int(1, 100); rolled.int(1, 1000); rolled.int(1, 1000);
        void s2; void m2;
        const again = createRng(seed); again.int(1, 100); again.int(1, 20);
        const slackRoll = again.int(1, 100); again.int(1, 1000); const mutinyRoll = again.int(1, 100);
        const gossipRoll = again.int(1, 100);
        if (slackRoll > 60 && mutinyRoll > 30 && gossipRoll <= 25) return seed;
      }
      throw new Error("seed not found");
    })();
    const make = (mode: "off" | "mild" | "full") => {
      const source: any = structuredClone(schema);
      source.initialState.clock.phase = "저녁";
      const game = runtime(source, gossipSeed);
      game.dispatch("gfl/start", { mode: "commander" });
      game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
      game.dispatch("gfl/doll/acquire", { dollId: "ump45" });
      game.dispatch("gfl/settings/update", { gossip: mode });
      (game.state.gfl as any).dissatisfaction = 100;
      return { game, log: game.dispatch("gfl/time/end-day").log[0] as any };
    };
    const off = make("off");
    expect(off.log.social.gossip).toBeUndefined();
    const mild = make("mild");
    expect(mild.log.social.gossip.mode).toBe("mild");
    const full = make("full");
    const first = String(full.log.social.gossip.targets[0].dollId);
    expect(Number((full.game.state.gfl as any).dolls[first].affinity)).toBe(-5);
    // 암시장 — 6일차 마감 → 7일차 브로커 제안 3종, 구매로 의심도 상승
    const marketSource: any = structuredClone(schema);
    marketSource.initialState.day = 6; marketSource.initialState.clock.day = 6; marketSource.initialState.clock.phase = "저녁";
    const market = runtime(marketSource, 11);
    market.dispatch("gfl/start", { mode: "commander" });
    market.dispatch("gfl/time/end-day");
    const offers = ((market.state.gfl as any).market?.offers ?? []) as any[];
    expect(offers).toHaveLength(3);
    const goldBefore = Number(market.state.gold);
    expect(market.dispatch("gfl/market/buy", { offerId: offers[0].id }).log[0]).toMatchObject({ ok: true });
    expect(Number(market.state.gold)).toBe(goldBefore - Number(offers[0].price));
    expect(market.dispatch("gfl/market/buy", { offerId: offers[0].id }).log[0]).toMatchObject({ ok: false, reason: "gfl_market_offer_sold" });
    expect(Number((market.state.gfl as any).market.suspicion)).toBe(Math.ceil(Number(offers[0].price) / 1000));
    // 감사 적발 — 의심도 30, auditRoll<12 시드 탐색(습격2+사회 7회 뒤 8번째가 d20)
    const auditSeed = (() => {
      for (let seed = 1; seed < 30000; seed++) {
        const rng = createRng(seed);
        rng.int(1, 100); rng.int(1, 20);
        rng.int(1, 100); rng.int(1, 1000); rng.int(1, 100); rng.int(1, 1000); rng.int(1, 1000);
        if (rng.int(1, 20) < 12) return seed;
      }
      throw new Error("seed not found");
    })();
    const auditSource: any = structuredClone(schema);
    auditSource.initialState.clock.phase = "저녁";
    const audit = runtime(auditSource, auditSeed);
    audit.dispatch("gfl/start", { mode: "commander" });
    (audit.state.gfl as any).market = { day: 1, offers: [], suspicion: 30, purchased: [] };
    const auditGold = Number(audit.state.gold);
    const auditLog = audit.dispatch("gfl/time/end-day").log[0] as any;
    expect(auditLog.social.audit).toMatchObject({ caught: true, seized: Math.floor(auditGold * .2) });
    expect(Number((audit.state.gfl as any).market.suspicion)).toBe(0);
  });

  it("지휘 게이지를 단계마다 충전하고 예약 개입 3종과 부족·중복 검증을 적용한다", () => {
    const make = (type: string) => {
      const game = sortieGame({ seed: 91 });
      game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1", engagementMode: "quick" });
      const sortie = (game.state.gfl as any).sortie;
      sortie.stages = [{ type: "battle" }, { type: "battle" }]; sortie.current = 0; sortie.command = 100;
      const result = game.dispatch("gfl/sortie/engage", { intervention: { round: 1, type } }).log[0] as any;
      return { game, result };
    };
    for (const type of ["focus", "brace", "barrage"]) {
      const { result } = make(type);
      expect(result).toMatchObject({ ok: true, intervention: { round: 1, type }, command: 34 });
      expect(result.rounds[0].exchanges.some((entry: any) => entry.intervention === type)).toBe(true);
    }
    const { game } = make("brace");
    expect(game.dispatch("gfl/sortie/engage", { intervention: { round: 1, type: "focus" } }).log[0]).toMatchObject({ ok: false, reason: "gfl_intervention_command_missing" });
  });

  it("병과 스킬은 MP가 있을 때 단계당 한 번 자동 발동하고 명중 지원 합계를 +5로 제한하며 전훈을 누적한다", () => {
    const source: any = structuredClone(schema);
    source.gfl.dolls = [
      { id: "ar", name: "AR", class: "AR", grade: 5, maxHp: 3000, maxMp: 500, power: 500 },
      { id: "hg", name: "HG", class: "HG", grade: 5, maxHp: 3000, maxMp: 500, power: 300 },
    ];
    source.gfl.missions[0] = { ...source.gfl.missions[0], power: 1200, factions: ["철혈"], enemies: [{ id: "tank", name: "표적", power: 500, hp: 4000 }] };
    const game = runtime(source, 14); game.dispatch("gfl/start", { mode: "commander" });
    for (const [slot, id] of ["ar", "hg"].entries()) { game.dispatch("gfl/doll/acquire", { dollId: id }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot, dollId: id }); }
    game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    const battle = reachCombat(game), skills = battle.skills as any[];
    expect(skills.filter((entry) => entry.dollId === "ar")).toHaveLength(1);
    expect(skills.filter((entry) => entry.dollId === "hg")).toHaveLength(1);
    expect((game.state.gfl as any).dolls.ar.mp.cur).toBe(260);
    expect(battle.rounds.flatMap((entry: any) => entry.exchanges).filter((entry: any) => entry.actorId === "ar" && entry.round === 2).length).toBeLessThanOrEqual(2);
    expect(Math.max(...battle.rounds.flatMap((entry: any) => entry.exchanges).map((entry: any) => entry.supportHit ?? 0))).toBeLessThanOrEqual(5);
    expect((game.state.gfl as any).dolls.ar.records).toMatchObject({ kills: expect.any(Number), crits: expect.any(Number), guarded: 0 });
  });

  it("intel 공개는 적 실데이터를 바꾸지 않고 HG·정찰·심문으로 0/1/2 단계만 연다", () => {
    const source: any = structuredClone(schema);
    source.gfl.dolls.push({ id: "hg", name: "HG", class: "HG", grade: 3, maxHp: 1000, power: 1000 });
    source.gfl.missions[0].enemies = [{ id: "secret", name: "비밀 적", class: "AR", power: 300, hp: 777 }];
    const game = runtime(source, 2); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "hg" }); game.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "hg" });
    game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" });
    expect(game.select("gfl/sortie/intel")).toMatchObject({ level: 1, enemies: [{ name: "비밀 적", class: "AR" }] });
    expect((game.select("gfl/sortie/intel") as any).enemies[0].hp).toBeUndefined();
    const sortie = (game.state.gfl as any).sortie; sortie.stages = [{ type: "recon" }, { type: "battle" }]; sortie.current = 0;
    game.dispatch("gfl/sortie/stage");
    expect(game.select("gfl/sortie/intel")).toMatchObject({ level: 2, enemies: [{ hp: 777 }] });
    expect(source.gfl.missions[0].enemies[0].hp).toBe(777);
  });

  it("포로 심문은 성공 시 정찰, 실패 시 다음 교전 매복을 확정하고 포로를 소멸시킨다", () => {
    const play = (seed: number) => { const game = sortieGame({ enemyPower: 600, seed }); game.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }); (game.state.gfl as any).prisoner = { active: true }; return { game, result: game.dispatch("gfl/sortie/interrogate").log[0] as any }; };
    const success = play(1); expect(success.result.success).toBe(true); expect((success.game.state.gfl as any).sortie).toMatchObject({ intel: 2, scouted: true });
    const failureSeed = Array.from({ length: 100 }, (_, index) => index + 1).find((seed) => (play(seed).result as any).success === false)!;
    const failure = play(failureSeed); expect(failure.result).toMatchObject({ success: false, ambush: true }); expect((failure.game.state.gfl as any).prisoner).toBeNull();
  });

  it("병과 취향은 DC를 보정하고 선호 행동 첫 성공 뒤에만 상세와 ♥를 공개한다", () => {
    const game = runtime(); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 490; unit.mood = 1000;
    let options = (game.select("gfl/relation/options") as any).dolls.m4a1;
    expect(options).toMatchObject({ preferenceKnown: false, preference: null, preferenceHint: "?" });
    expect(options.choices.find((entry: any) => entry.id === "train")).toMatchObject({ dc: 10 });
    expect(options.choices.find((entry: any) => entry.id === "coffee")).toMatchObject({ dc: 11 });
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "train" }).log[0]).toMatchObject({ ok: true, dc: 10, preferenceMod: -2, preferenceRevealed: true });
    options = (game.select("gfl/relation/options") as any).dolls.m4a1;
    expect(options.preference).toEqual({ preferred: "train", disliked: "coffee" });
    expect(options.choices.find((entry: any) => entry.id === "train").label).toContain("♥");
  });

  it("계약 7일 기념일은 여러 인형에게 동시에 열리고 그날 관계 효과를 1.5배로 만든다", () => {
    const source: any = structuredClone(schema); source.initialState.day = 7; source.initialState.clock = { day: 7, hour: 20, turn: 0, phase: "저녁" };
    const game = runtime(source); game.dispatch("gfl/start", { mode: "commander" });
    for (const id of ["m4a1", "ump45"]) { game.dispatch("gfl/doll/acquire", { dollId: id }); (game.state.gfl as any).dolls[id].hiredDay = 1; }
    const end = game.dispatch("gfl/time/end-day").log[0] as any;
    expect(end.anniversaries).toHaveLength(2); expect(end.anniversaries.map((entry: any) => entry.days)).toEqual([7, 7]);
    const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 490; unit.mood = 1000;
    expect(game.dispatch("gfl/relation/check", { dollId: "m4a1", choice: "talk" }).log[0]).toMatchObject({ ok: true, affinityDelta: 5, moodDelta: 15 });
  });

  it("외출은 신뢰·대기 조건과 일일 제한을 지키며 시간대 한 칸을 비용으로 쓴다", () => {
    const source: any = structuredClone(schema); source.gfl.relation = { names: ["적대", "경계", "중립", "호의", "친밀", "애착"], thresholds: [-100, -30, 0, 20, 50, 80], descriptions: [] };
    const game = runtime(source, 11); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    const unit = (game.state.gfl as any).dolls.m4a1;
    expect(game.dispatch("gfl/relation/outing", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_relation_tier_locked" });
    unit.affinity = 80; (game.state.gfl as any).promises = [{ dollId: "m4a1", type: "anniversary", deadline: 7, fulfilled: false }]; const beforeTurn = Number((game.state.clock as any).turn), outing = game.dispatch("gfl/relation/outing", { dollId: "m4a1" }).log[0] as any;
    expect(outing).toMatchObject({ ok: true, affinityDelta: 4, moodDelta: 20, timeAdvanced: true }); expect(["시장 거리", "강변 방벽", "옛 카페"]).toContain(outing.place);
    expect(Number((game.state.clock as any).turn)).toBe(beforeTurn + 1);
    expect((game.state.gfl as any).promises[0].fulfilled).toBe(false);
    expect(game.dispatch("gfl/relation/outing", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: false, reason: "gfl_outing_daily_limit" });
  });

  it("트라우마 치유는 실패 보너스를 막고 성공 3회 뒤 조건 명중 +1 훈장을 남긴다", () => {
    const source: any = structuredClone(schema); source.gfl.relation = { names: ["중립", "호의", "신뢰", "사랑", "서약"], thresholds: [0, 20, 50, 100, 200], descriptions: [] };
    const make = (seed: number) => { const game = runtime(source, seed); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); const unit = (game.state.gfl as any).dolls.m4a1; unit.affinity = 490; unit.trauma = "철혈 공포"; unit.traumaProgress = 0; game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }); return game; };
    const failed = Array.from({ length: 100 }, (_, i) => make(i + 1)).find((game) => (game.dispatch("gfl/relation/heal-trauma", { dollId: "m4a1" }).log[0] as any).success === false)!;
    expect(failed.dispatch("gfl/relation/session/end").log[0]).toMatchObject({ ok: true, affinityDelta: 0, moodDelta: 0 });
    const healed = make(20260719); let last: any; for (let count = 0; count < 30 && (healed.state.gfl as any).dolls.m4a1.trauma; count++) last = healed.dispatch("gfl/relation/heal-trauma", { dollId: "m4a1" }).log[0];
    expect(last).toMatchObject({ success: true, progress: 3, medal: "철혈 공포" }); expect((healed.state.gfl as any).dolls.m4a1).toMatchObject({ trauma: null, overcomeMedal: "철혈 공포" });
  });

  it("전투 후보는 야간·보스·철혈 우선순위로 트라우마 하나만 확정하고 해당 조건 명중을 바꾼다", () => {
    const tag = (candidate: any, options: any = {}) => { const game=sortieGame(options); (game.state.gfl as any).dolls.m4a1.traumaCandidate=candidate; if(candidate.night)(game.state.clock as any).phase="심야"; game.dispatch("gfl/sortie/start",{missionId:"alpha",echelonId:"e1"}); reachCombat(game); return (game.state.gfl as any).dolls.m4a1.trauma; };
    expect(tag({cause:"panic",night:true,boss:true})).toBe("야간 공포"); expect(tag({cause:"panic",boss:true},{boss:"Scarecrow"})).toBe("포화 공포"); expect(tag({cause:"panic"})).toBe("철혈 공포");
    const hit = (key: "trauma"|"overcomeMedal") => { const game=sortieGame({seed:42}); (game.state.gfl as any).dolls.m4a1[key]="철혈 공포"; game.dispatch("gfl/sortie/start",{missionId:"alpha",echelonId:"e1"}); return reachCombat(game).rounds.flatMap((row:any)=>row.exchanges).find((row:any)=>row.actorId==="m4a1").traumaHit; };
    expect(hit("trauma")).toBe(-2); expect(hit("overcomeMedal")).toBe(1);
  });

  it("약속은 세 종류를 엔진에서 요청하고 상한에서도 RNG를 고정하며 이행·위반 영수증을 정산한다", () => {
    const requested = new Set<string>();
    for (let seed = 1; seed <= 300 && requested.size < 3; seed++) { const game = runtime(schema, seed); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }); const row = game.dispatch("gfl/relation/session/end").log[0] as any; if (row.promiseRequested) requested.add(row.promiseRequested.type); }
    expect([...requested].sort()).toEqual(["anniversary", "repair", "sortie"]);
    const capped = runtime(schema, 77), open = runtime(schema, 77);
    for (const game of [capped, open]) { game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); }
    (capped.state.gfl as any).promises = [{}, {}, {}]; (open.state.gfl as any).promises = [{}, {}];
    for (const game of [capped, open]) { game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }); game.dispatch("gfl/relation/session/end"); }
    expect(capped.snapshot().rng).toEqual(open.snapshot().rng); expect((capped.state.gfl as any).promiseRequest).toBeFalsy();
    const settle = runtime(); settle.dispatch("gfl/start", { mode: "commander" }); settle.dispatch("gfl/doll/acquire", { dollId: "m4a1" }); settle.dispatch("gfl/echelon/assign", { echelonId: "e1", slot: 0, dollId: "m4a1" });
    (settle.state.gfl as any).promises = [{ dollId: "m4a1", name: "M4A1", type: "sortie", deadline: 2, fulfilled: false }, { dollId: "ump45", name: "UMP45", type: "anniversary", deadline: 1, fulfilled: false }];
    settle.dispatch("gfl/sortie/start", { missionId: "alpha", echelonId: "e1" }); (settle.state.gfl as any).sortie = null; (settle.state.clock as any).phase = "저녁";
    const receipts = (settle.dispatch("gfl/time/end-day").log[0] as any).promiseReceipts;
    expect(receipts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "sortie", fulfilled: true, affinityDelta: 5 }), expect.objectContaining({ type: "anniversary", fulfilled: false, dissatisfactionDelta: 3 })]));
    const repair=runtime(); repair.dispatch("gfl/start",{mode:"commander"}); repair.dispatch("gfl/doll/acquire",{dollId:"m4a1"}); const damaged=(repair.state.gfl as any).dolls.m4a1; damaged.hp.cur=400; (repair.state.gfl as any).promiseRequest={dollId:"m4a1",name:"M4A1",type:"repair",deadline:null,triggered:false};
    expect(repair.dispatch("gfl/relation/promise/accept").log[0]).toMatchObject({ok:true,promise:{triggered:true,deadline:2}}); repair.dispatch("gfl/location/move",{locationId:"base-maintenance"}); repair.dispatch("gfl/repair/start",{dollId:"m4a1"}); expect((repair.state.gfl as any).promises[0].fulfilled).toBe(true);
    const anniversary=runtime(); anniversary.dispatch("gfl/start",{mode:"commander"}); anniversary.dispatch("gfl/doll/acquire",{dollId:"m4a1"}); (anniversary.state.gfl as any).anniversaries=[{dollId:"m4a1",days:7,day:1}]; (anniversary.state.gfl as any).promises=[{dollId:"m4a1",type:"anniversary",deadline:1,fulfilled:false}]; anniversary.dispatch("gfl/relation/anniversary",{dollId:"m4a1"}); expect((anniversary.state.gfl as any).promises[0].fulfilled).toBe(true);
    const deadline=runtime(); deadline.dispatch("gfl/start",{mode:"commander"}); deadline.dispatch("gfl/doll/acquire",{dollId:"m4a1"}); (deadline.state.gfl as any).promises=[{dollId:"m4a1",type:"sortie",deadline:2,fulfilled:false}]; (deadline.state.clock as any).phase="저녁"; expect((deadline.dispatch("gfl/time/end-day").log[0] as any).promiseReceipts).toHaveLength(0); expect((deadline.state.gfl as any).promises).toHaveLength(1);
  });

  it("질투 3모드는 같은 RNG를 쓰고 mild/full 효과와 연속 난입 금지를 지킨다", () => {
    const source: any = structuredClone(schema); source.initialState.day = 10; source.initialState.clock.day = 10; source.gfl.relation = { names: ["중립", "호의", "친밀", "신뢰", "사랑"], thresholds: [0, 20, 40, 60, 100], descriptions: [] };
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((candidate) => { const game = runtime(source, candidate); game.dispatch("gfl/start", { mode: "commander" }); for (const id of ["m4a1", "ump45"]) { game.dispatch("gfl/doll/acquire", { dollId: id }); const unit=(game.state.gfl as any).dolls[id]; unit.affinity=100; unit.hiredDay=1; } return Number((game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }).log[0] as any).intruder?.dollId?.length) > 0; })!;
    const run = (mode: string) => { const game = runtime(source, seed); game.dispatch("gfl/start", { mode: "commander" }); for (const id of ["m4a1", "ump45"]) { game.dispatch("gfl/doll/acquire", { dollId: id }); const unit=(game.state.gfl as any).dolls[id]; unit.affinity=100; unit.hiredDay=1; } game.dispatch("gfl/settings/update", { jealousy: mode }); const before={...((game.state.gfl as any).dolls.ump45)}; const result=game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }).log[0] as any; return { game,result,before,rng:game.snapshot().rng }; };
    const off=run("off"), mild=run("mild"), full=run("full"); expect(off.rng).toEqual(mild.rng); expect(mild.rng).toEqual(full.rng); expect(off.result.intruder).toBeNull();
    expect((mild.game.state.gfl as any).dolls.ump45.mood).toBe(Number(mild.before.mood)-10); expect((full.game.state.gfl as any).dolls.ump45.affinity).toBe(Number(full.before.affinity)-3);
    mild.game.dispatch("gfl/relation/session/end"); (mild.game.state as any).day += 1; (mild.game.state.clock as any).day += 1;
    expect(mild.game.dispatch("gfl/relation/session/start", { dollId: "m4a1" }).log[0]).toMatchObject({ ok: true, intruder: null });
  });

  it("비밀 취미는 발견 전 숨고 발견 후 전용 DC7 캡슐을 열며 사용자 호칭은 한 번만 저장되어 판정 +1을 준다", () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((candidate) => { const probe=runtime(schema,candidate); probe.dispatch("gfl/start",{mode:"commander"}); probe.dispatch("gfl/doll/acquire",{dollId:"m4a1"}); return (probe.dispatch("gfl/relation/session/start",{dollId:"m4a1"}).log[0] as any).hobbyDiscovered===true; })!;
    const game = runtime(schema, seed); game.dispatch("gfl/start", { mode: "commander" }); game.dispatch("gfl/doll/acquire", { dollId: "m4a1" });
    expect((game.select("gfl/dolls") as any[])[0].secretHobby).toBeUndefined(); expect(game.dispatch("gfl/relation/session/start",{dollId:"m4a1"}).log[0]).toMatchObject({hobbyDiscovered:true});
    expect((game.select("gfl/relation/options") as any).dolls.m4a1.choices.find((entry:any)=>entry.id==="hobby")).toMatchObject({ dc:7 });
    const criticalSeed=Array.from({length:200},(_,i)=>i+1).find((candidate)=>{const probe=runtime(schema,candidate);probe.dispatch("gfl/start",{mode:"commander"});probe.dispatch("gfl/doll/acquire",{dollId:"m4a1"});const doll=(probe.state.gfl as any).dolls.m4a1;doll.affinity=490;doll.mood=1000;return (probe.dispatch("gfl/relation/check",{dollId:"m4a1",choice:"talk"}).log[0] as any).tier==="critical_success";})!;
    const named=runtime(schema,criticalSeed); named.dispatch("gfl/start",{mode:"commander"}); named.dispatch("gfl/doll/acquire",{dollId:"m4a1"}); const candidate=(named.state.gfl as any).dolls.m4a1;candidate.affinity=490;candidate.mood=1000;expect(named.dispatch("gfl/relation/check",{dollId:"m4a1",choice:"talk"}).log[0]).toMatchObject({tier:"critical_success"}); expect((named.select("gfl/relation/options") as any).dolls.m4a1.callsignEligible).toBe(true);
    expect(named.dispatch("gfl/relation/callsign",{dollId:"m4a1",callsign:"별빛"}).log[0]).toMatchObject({ok:true,callsign:"별빛"}); expect(named.dispatch("gfl/relation/callsign",{dollId:"m4a1",callsign:"다른 이름"}).log[0]).toMatchObject({ok:false,reason:"gfl_callsign_locked"});
    const renamed=(named.state.gfl as any).dolls.m4a1; renamed.affinity=100; renamed.mood=100; const checked=named.dispatch("gfl/relation/check",{dollId:"m4a1",choice:"nickname"}).log[0] as any; expect(checked.modifier).toBe(4);
  });
});
