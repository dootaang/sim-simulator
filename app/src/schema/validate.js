'use strict';

const REQUIRED_TOP_LEVEL = ['meta', 'resources', 'scales', 'ladders', 'entities', 'events'];
const ENTITY_FIELDS = {
  room: ['no', 'kind', 'pricePerNight', 'capacity', 'requiresRoomLevel'],
  menuItem: ['name', 'category', 'grade', 'price', 'requiresKitchenLevel', 'consumes'],
  npc: ['id', 'nameKo', 'nameEn', 'class', 'group'],
  facility: ['id', 'label', 'maxLevel'],
};
// 선택 필드: 없으면 기본값으로 정규화(경고). requiresKitchenLevel은 여관 전용 게이트라
// 상점형 카드(trade:buy)엔 무의미 — 엔진도 || 1 기본값을 쓴다(소전 실측: 에러 19개로 승인 잠김).
const ENTITY_OPTIONAL_DEFAULTS = {
  menuItem: { category: '', grade: '', consumes: {}, requiresKitchenLevel: 1 },
};
const ROOM_ALIASES = { number: 'no', roomNo: 'no', price: 'pricePerNight' };
const NPC_ALIASES = { name: 'nameKo' };

function validateSchema(obj) {
  const issues = [];
  const schema = clone(obj || {});

  normalizeAliases(schema, issues);
  normalizeFacilityIds(schema, issues);
  normalizeMenuTrade(schema, issues);
  normalizePlayerPools(schema, issues);
  normalizeCombatHpPool(schema, issues);
  validateTop(schema, issues);
  validateResources(schema, issues);
  validateScales(schema, issues);
  validatePools(schema, issues);
  validateCombat(schema, issues);
  validateSkills(schema, issues);
  validateLadders(schema, issues);
  validateEntities(schema, issues);
  synthesizeStaffing(schema, issues);
  validateFormulas(schema, issues);
  validateProcesses(schema, issues);
  validateRewards(schema, issues);
  // 조우 풀 합성·검증이 의뢰 검증보다 먼저 — 미지정 encounterChance 기본치 부여가 풀 존재를 본다.
  synthesizeEncounterModule(schema, issues);
  validateEncounters(schema, issues);
  validateQuests(schema, issues);
  validateGather(schema, issues);
  validateSettlement(schema, issues);
  // 합성이 검증보다 먼저 — 합성된 traffic도 반드시 validateTraffic의 클램프·정규화를 거친다.
  synthesizeTrafficModule(schema, issues);
  validateTraffic(schema, issues);
  synthesizeQuestBoard(schema, issues);
  validateEvents(schema, issues);

  return { schema, issues };
}

// 컴파일러(LLM)는 원본 카드 변수명(lv_room 등)을 시설 id로 내는 경우가 많다.
// 엔진의 레벨 게이트는 room/kitchen 등 표준 id를 쓰므로 lv_ 접두사를 정규화한다.
function normalizeFacilityIds(schema, issues) {
  const entity = findEntity(schema, 'facility');
  const instances = entity && Array.isArray(entity.instances) ? entity.instances : [];
  if (!instances.length) return;
  const taken = new Set(instances.map((item) => item && item.id));
  const renames = {};
  for (const instance of instances) {
    if (!instance || typeof instance.id !== 'string') continue;
    const match = /^lv_(.+)$/.exec(instance.id);
    if (!match) continue;
    if (taken.has(match[1])) {
      warn(issues, 'entities.facility', `Facility id ${instance.id} not normalized: ${match[1]} already exists.`);
      continue;
    }
    renames[instance.id] = match[1];
    instance.id = match[1];
    taken.add(match[1]);
  }
  const renamed = Object.keys(renames);
  if (!renamed.length) return;
  warn(issues, 'entities.facility', `Facility ids normalized: ${renamed.map((id) => `${id}→${renames[id]}`).join(', ')}.`);
  // 시설 id를 참조하는 곳들도 함께 재명명.
  const initial = schema.initialState && schema.initialState.facilities;
  if (isObject(initial)) {
    for (const [from, to] of Object.entries(renames)) {
      if (from in initial) { initial[to] = initial[from]; delete initial[from]; }
    }
  }
  for (const block of asArray(schema.settlement)) {
    if (isObject(block) && renames[block.facility]) block.facility = renames[block.facility];
  }
  if (isObject(schema.traffic)) {
    if (renames[schema.traffic.capacityFacility]) schema.traffic.capacityFacility = renames[schema.traffic.capacityFacility];
    for (const modifier of asArray(schema.traffic.modifiers)) {
      if (isObject(modifier) && renames[modifier.facility]) modifier.facility = renames[modifier.facility];
    }
  }
  if (isObject(schema.staffing) && renames[schema.staffing.facility]) schema.staffing.facility = renames[schema.staffing.facility];
  if (isObject(schema.questBoard) && renames[schema.questBoard.facility]) schema.questBoard.facility = renames[schema.questBoard.facility];
}

function synthesizeStaffing(schema, issues) {
  if (isObject(schema.staffing)) return;
  const npcs = findEntity(schema, 'npc');
  const facilities = findEntity(schema, 'facility');
  if (!npcs || !Array.isArray(npcs.instances) || !npcs.instances.length || !facilities || !Array.isArray(facilities.instances)) return;
  const facility = facilities.instances.find((item) => item && /quarter|숙소|기숙/i.test(`${item.id || ''} ${item.label || ''}`));
  if (!facility) return;
  const max = Math.max(1, Math.trunc(Number(facility.maxLevel) || 1));
  const legacy = schema.gates && schema.gates.staffMaxByQuartersLevel;
  const capacityByLevel = {};
  for (let level = 1; level <= max; level += 1) capacityByLevel[String(level)] = Math.max(1, Math.trunc(Number(legacy && legacy[String(level)]) || level));
  schema.staffing = { facility: facility.id, capacityByLevel };
  warn(issues, 'staffing', `직원 숙소 '${facility.id}'를 고용 정원 시설로 자동 연결했습니다.`);
}

function synthesizeQuestBoard(schema, issues) {
  if (schema.questBoard != null || !Array.isArray(schema.quests) || !schema.quests.length || !schema.traffic) return;
  const facilities = findEntity(schema, 'facility');
  const list = facilities && Array.isArray(facilities.instances) ? facilities.instances : [];
  const tavern = list.find((item) => item && /tavern|주점|홀/i.test(`${item.id || ''} ${item.label || ''}`));
  if (!tavern) return;
  schema.questBoard = { facility: tavern.id, unlockLevel: 2, size: 3, refresh: 'daily' };
  warn(issues, 'questBoard', `의뢰 게시판을 '${tavern.id}' Lv.2에 해금하고 하루 3종으로 자동 구성했습니다.`);
}

// 관리형(여관형: 판매 메뉴 + 객실) 스키마인데 컴파일러가 traffic 모듈을 내지 않았다면
// 스키마 자체 데이터(기준표 formula·평판 축·시설)로 기본 영업 모듈을 결정론 합성한다.
// LLM에게 모듈 문법을 가르치는 대신 후패치로 채우는 기존 원칙(채굴값 강제 적용과 동일 계열).
function synthesizeTrafficModule(schema, issues) {
  if (schema.traffic != null) return;
  const menuEntity = findEntity(schema, 'menuItem');
  const roomEntity = findEntity(schema, 'room');
  const facilityEntity = findEntity(schema, 'facility');
  const menus = menuEntity && Array.isArray(menuEntity.instances) ? menuEntity.instances : [];
  const rooms = roomEntity && Array.isArray(roomEntity.instances) ? roomEntity.instances : [];
  const facilities = facilityEntity && Array.isArray(facilityEntity.instances) ? facilityEntity.instances : [];
  if (!menus.length || !rooms.length || !facilities.length) return;

  const findFacility = (pattern) => facilities.find((item) => item && pattern.test(`${item.id} ${item.label || ''}`));
  const tavern = findFacility(/tavern|hall|주점|홀/i) || facilities[0];
  const kitchen = findFacility(/kitchen|주방/i);

  // 기준표: 컴파일러가 낸 baseline formula(cap/customers)를 흡수, 없으면 표준 기본값.
  let base = [[8, 15], [15, 30], [25, 50], [40, 80]];
  let capacity = [15, 30, 50, 80];
  const formula = asArray(schema.formulas).find((item) => isObject(item) && isObject(item.baseline));
  if (formula) {
    const levels = Object.keys(formula.baseline).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const bases = [];
    const caps = [];
    for (const level of levels) {
      const row = formula.baseline[String(level)];
      if (!isObject(row) || !Array.isArray(row.customers) || row.customers.length < 2) continue;
      const low = Number(row.customers[0]);
      const high = Number(row.customers[1]);
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
      bases.push([low, high]);
      caps.push(Number.isFinite(Number(row.cap)) ? Number(row.cap) : high);
    }
    if (bases.length) { base = bases; capacity = caps; }
  }

  const repLadder = asArray(schema.ladders).find((ladder) => isObject(ladder) && ladder.id === 'reputation');
  const axes = repLadder && Array.isArray(repLadder.axes) ? repLadder.axes.filter((axis) => typeof axis === 'string') : [];
  const villageAxis = axes.find((axis) => /village|마을/i.test(axis)) || axes[0] || null;
  const nobleAxis = axes.find((axis) => /noble|royal|귀족|왕실/i.test(axis)) || null;

  const modifiers = [{ type: 'staff', perStaff: 0.08, max: 0.32 }];
  if (repLadder && villageAxis) modifiers.unshift({
    type: 'ladder_rank', ladder: 'reputation', axis: villageAxis,
    multipliers: { E: 0.6, D: 0.75, C: 0.9, B: 1, A: 1.15, S: 1.3 },
  });
  if (kitchen) modifiers.push({ type: 'facility_level', facility: kitchen.id, perLevel: 0.05 });

  const segments = [
    { id: 'traveler', label: '여행자', weight: 4, party: [1, 2], stay: { '1': 0.6, '2': 0.3, '3': 0.1 } },
    { id: 'adventurer', label: '모험가 일행', weight: 3, party: [2, 4], stay: { '1': 0.4, '2': 0.4, '3': 0.2 } },
    { id: 'merchant', label: '상인', weight: 2, party: [1, 2], stay: { '2': 0.5, '3': 0.3, '5': 0.2 } },
  ];
  if (repLadder && nobleAxis) {
    segments.push({ id: 'noble', label: '귀족', weight: 1, party: [1, 3], stay: { '1': 0.5, '2': 0.5 }, requires: { roomLevel: 3, ladderRank: { ladder: 'reputation', axis: nobleAxis, rank: 'C' } } });
  }

  const deck = [
    { id: 'drunk_brawl', label: '진상 취객', desc: '만취한 손님이 홀에서 행패를 부린다.', weight: 4, choices: [
      { id: 'subdue', label: '직접 제압한다', effects: { waveMultiplier: 0.9 } },
      { id: 'appease', label: '술값을 물어 달랜다', effects: { gold: [-15000, -5000] } },
      { id: 'ignore', label: '방치한다', effects: { waveMultiplier: 0.7 } },
    ] },
    { id: 'petty_thief', label: '좀도둑', desc: '손님 하나가 계산대 근처를 서성인다.', weight: 3, choices: [
      { id: 'chase', label: '쫓아가 붙잡는다', effects: { gold: [-5000, 25000] } },
      { id: 'guard', label: '계산대만 지킨다', effects: { waveMultiplier: 0.95 } },
    ] },
    { id: 'kitchen_fire', label: '주방 사고', desc: '주방에서 불길이 치솟는다.', weight: 2, choices: [
      { id: 'repair', label: '즉시 수리한다', effects: { gold: [-30000, -10000] } },
      { id: 'endure', label: '임시로 버틴다', effects: { resources: { food: -2 }, waveMultiplier: 0.85 } },
    ] },
  ];
  if (repLadder && nobleAxis) {
    deck.splice(1, 0, { id: 'noble_visit', label: '귀족의 깜짝 방문', desc: '고위 귀족 일행이 예고 없이 들어선다.', weight: 2,
      requires: { ladderRank: { ladder: 'reputation', axis: nobleAxis, rank: 'C' } },
      choices: [
        { id: 'feast', label: '최고급으로 접대한다', effects: { resources: { food: -3, drink: -2 }, gold: [80000, 150000] } },
        { id: 'decline', label: '정중히 평범하게 응대', effects: {} },
      ] });
  }

  const roomFacility = findFacility(/room|객실/i); // '직원 숙소'(quarters) 오매칭 방지 — 숙소는 제외
  const traffic = {
    id: 'auto_service',
    capacityFacility: tavern.id,
    base,
    capacity,
    waves: [
      { id: 'lunch', label: '점심 영업', share: 0.4 },
      { id: 'evening', label: '저녁 영업', share: 0.6 },
    ],
    modifiers,
    sells: { entity: 'menuItem' },
    lodging: { roomsEntity: 'room', base: [[1, 2], [1, 3], [2, 4], [3, 6]], segments },
    incidents: { chance: 35, deck },
  };
  // 엔진의 주방/객실 레벨 게이트는 기본 id(kitchen/room)를 쓴다 — 임의 시설명 카드는 명시 바인딩.
  if (kitchen) traffic.kitchenFacility = kitchen.id;
  if (roomFacility) traffic.lodging.roomFacility = roomFacility.id;
  if (repLadder && axes.length) {
    traffic.mail = {
      ladder: 'reputation',
      chances: { reward: { C: 5, B: 7, A: 10, S: 15 }, quest: { C: 2, B: 4, A: 7, S: 12 } },
      labels: { reward: '감사 선물', quest: '의뢰 편지' },
      reward: { gold: [30000, 80000] },
    };
  }
  schema.traffic = traffic;
  warn(issues, 'traffic', '컴파일 결과에 영업 모듈이 없어 기본 traffic(파동 영업·숙박·우편·사건)을 자동 구성했습니다.');
}

function synthesizeEncounterModule(schema, issues) {
  if (schema.encounters != null || !schema.combat || !schema.pools) return;
  schema.encounters = { pool: [
    { id: 'goblin_pack', name: '고블린 무리', rank: 'E', count: [2, 3] },
    { id: 'wild_wolf', name: '들개 떼', rank: 'E', count: [1, 2] },
    { id: 'bandit', name: '산적', rank: 'D', count: [1, 2] },
  ] };
  warn(issues, 'encounters', '전투 스키마에 기본 조우 풀을 자동 구성했습니다.');
}

function validateEncounters(schema, issues) {
  if (schema.encounters == null) return;
  if (!isObject(schema.encounters) || !Array.isArray(schema.encounters.pool)) {
    warn(issues, 'encounters', 'encounters.pool must be an array; removed.'); delete schema.encounters; return;
  }
  schema.encounters.pool = schema.encounters.pool.map((raw, index) => {
    if (!isObject(raw)) { warn(issues, `encounters.pool[${index}]`, 'Invalid encounter removed.'); return null; }
    const rank = ['E','D','C','B','A','S'].includes(raw.rank) ? raw.rank : 'E';
    let count = isRange(raw.count) ? raw.count.map((v) => Math.max(1, Math.trunc(Number(v)) || 1)) : [1, 1];
    if (count[1] < count[0]) count = [count[1], count[0]];
    if (rank !== raw.rank || !isRange(raw.count)) warn(issues, `encounters.pool[${index}]`, 'rank/count normalized.');
    return { id: String(raw.id || `encounter_${index + 1}`), name: String(raw.name || raw.id || `적 ${index + 1}`), rank, count };
  }).filter(Boolean);
}

// requires.ladderRank 게이트 정합: 사다리 id가 스키마에 존재하고 rank가 E..S 안이어야 한다.
// (axis는 사다리 정의 형식이 카드마다 달라 여기서 검증하지 않는다 — 엔진은 미기록 축을 E로 간주)
function validLadderRankGate(schema, requires) {
  const gate = isObject(requires) ? requires.ladderRank : null;
  if (gate == null) return true;
  if (!isObject(gate)) return false;
  if (!asArray(schema.ladders).some((ladder) => ladder && ladder.id === gate.ladder)) return false;
  return ['E', 'D', 'C', 'B', 'A', 'S'].includes(gate.rank);
}

function validateTraffic(schema, issues) {
  if (schema.traffic == null) return;
  if (!isObject(schema.traffic)) {
    warn(issues, 'traffic', 'traffic must be an object; removed.');
    delete schema.traffic;
    return;
  }
  const traffic = schema.traffic;
  const facilities = asArray(findEntity(schema, 'facility') && findEntity(schema, 'facility').instances);
  if (!facilities.some((facility) => facility && facility.id === traffic.capacityFacility)) {
    warn(issues, 'traffic.capacityFacility', 'Unknown capacity facility; traffic module removed.');
    delete schema.traffic;
    return;
  }
  const sellsEntity = isObject(traffic.sells) ? traffic.sells.entity : null;
  if (!sellsEntity || !findEntity(schema, sellsEntity)) {
    warn(issues, 'traffic.sells', 'Missing or unknown sells entity; traffic module removed.');
    delete schema.traffic;
    return;
  }
  // 시설 바인딩(선택): 존재하지 않는 시설을 가리키면 제거 — 엔진이 기본 id로 폴백한다.
  if (traffic.kitchenFacility != null && !facilities.some((facility) => facility && facility.id === traffic.kitchenFacility)) {
    warn(issues, 'traffic.kitchenFacility', 'Unknown kitchen facility binding removed; engine falls back to "kitchen".');
    delete traffic.kitchenFacility;
  }
  if (isObject(traffic.lodging) && traffic.lodging.roomFacility != null && !facilities.some((facility) => facility && facility.id === traffic.lodging.roomFacility)) {
    warn(issues, 'traffic.lodging.roomFacility', 'Unknown room facility binding removed; engine falls back to "room".');
    delete traffic.lodging.roomFacility;
  }
  if (!Array.isArray(traffic.base) || !traffic.base.length || !Array.isArray(traffic.capacity) || !traffic.capacity.length) {
    warn(issues, 'traffic', 'base and capacity must be non-empty arrays; traffic module removed.');
    delete schema.traffic;
    return;
  }
  traffic.base = traffic.base.map((range, index) => {
    if (Number.isFinite(Number(range))) {
      const value = Number(range);
      warn(issues, `traffic.base[${index}]`, 'Numeric base normalized to [n,n].');
      return [value, value];
    }
    if (isRange(range) && range.every((value) => Number.isFinite(Number(value)))) return range.map(Number);
    warn(issues, `traffic.base[${index}]`, 'Invalid base range normalized to [0,0].');
    return [0, 0];
  });
  traffic.capacity = traffic.capacity.map((value, index) => {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
    warn(issues, `traffic.capacity[${index}]`, 'Invalid capacity normalized to 0.');
    return 0;
  });
  if (!Array.isArray(traffic.waves) || !traffic.waves.length) {
    traffic.waves = [{ id: 'day', label: '영업', share: 1 }];
    warn(issues, 'traffic.waves', 'Empty waves normalized to one daily wave.');
  }
  traffic.waves = traffic.waves.filter(isObject).map((wave, index) => ({
    id: typeof wave.id === 'string' && wave.id ? wave.id : `wave_${index + 1}`,
    label: typeof wave.label === 'string' && wave.label ? wave.label : '영업',
    share: Number.isFinite(Number(wave.share)) && Number(wave.share) > 0 ? Number(wave.share) : 1,
  }));
  const shareSum = traffic.waves.reduce((sum, wave) => sum + wave.share, 0);
  if (shareSum < 0.5 || shareSum > 1.5) {
    traffic.waves.forEach((wave) => { wave.share /= shareSum; });
    warn(issues, 'traffic.waves', 'Wave shares normalized to a total of 1.');
  }
  const knownModifiers = new Set(['ladder_rank', 'staff', 'facility_level']);
  traffic.modifiers = asArray(traffic.modifiers).filter((modifier, index) => {
    if (isObject(modifier) && knownModifiers.has(modifier.type)) return true;
    warn(issues, `traffic.modifiers[${index}]`, 'Unknown traffic modifier removed.');
    return false;
  });
  if (traffic.incidents != null) {
    if (!isObject(traffic.incidents) || !Array.isArray(traffic.incidents.deck) || !traffic.incidents.deck.length) {
      warn(issues, 'traffic.incidents', 'Empty incident deck; incidents removed.');
      delete traffic.incidents;
    } else {
      const rawChance = Number(traffic.incidents.chance);
      const chance = Number.isFinite(rawChance) ? Math.max(0, Math.min(100, rawChance)) : 0;
      if (chance !== rawChance) warn(issues, 'traffic.incidents.chance', 'Incident chance normalized to 0..100.');
      traffic.incidents.chance = chance;
      traffic.incidents.deck = traffic.incidents.deck.filter((card, cardIndex) => {
        if (!isObject(card) || !Array.isArray(card.choices) || !card.choices.length) {
          warn(issues, `traffic.incidents.deck[${cardIndex}].choices`, 'Card with empty choices removed.');
          return false;
        }
        // 잘못 구성된 해금 게이트는 카드를 제거 — 오타 사다리는 조용한 영구 미해금,
        // 존재하지 않는 랭크는 무조건 해금이 되므로 어느 쪽도 두면 안 된다(감사 지적).
        if (!validLadderRankGate(schema, card.requires)) {
          warn(issues, `traffic.incidents.deck[${cardIndex}].requires`, 'Invalid ladderRank gate; card removed.');
          return false;
        }
        card.choices = card.choices.filter(isObject).map((choice, choiceIndex) => {
          const effects = isObject(choice.effects) ? choice.effects : {};
          for (const key of Object.keys(effects)) if (!['gold', 'resources', 'waveMultiplier', 'affinity'].includes(key)) {
            delete effects[key];
            warn(issues, `traffic.incidents.deck[${cardIndex}].choices[${choiceIndex}].effects.${key}`, 'Unknown incident effect removed.');
          }
          if (effects.gold != null) {
            if (Number.isFinite(Number(effects.gold))) effects.gold = [Number(effects.gold), Number(effects.gold)];
            else if (Array.isArray(effects.gold) && effects.gold.length >= 2 && effects.gold.every((value) => Number.isFinite(Number(value)))) effects.gold = [Math.min(Number(effects.gold[0]), Number(effects.gold[1])), Math.max(Number(effects.gold[0]), Number(effects.gold[1]))];
            else { delete effects.gold; warn(issues, `traffic.incidents.deck[${cardIndex}].choices[${choiceIndex}].effects.gold`, 'Invalid gold effect removed.'); }
          }
          if (effects.waveMultiplier != null) {
            const raw = Number(effects.waveMultiplier);
            effects.waveMultiplier = Number.isFinite(raw) ? Math.max(0.1, Math.min(2, raw)) : 1;
            if (effects.waveMultiplier !== raw) warn(issues, `traffic.incidents.deck[${cardIndex}].choices[${choiceIndex}].effects.waveMultiplier`, 'Wave multiplier normalized to 0.1..2.');
          }
          if (Object.prototype.hasOwnProperty.call(effects, 'affinity')) {
            const path = `traffic.incidents.deck[${cardIndex}].choices[${choiceIndex}].effects.affinity`;
            const affinityScale = asArray(schema.scales).find((scale) => scale && scale.id === 'affinity');
            if (!isObject(effects.affinity)) {
              delete effects.affinity;
              warn(issues, path, 'Invalid affinity effect removed.');
            } else if (!affinityScale) {
              delete effects.affinity;
              warn(issues, path, 'Affinity effect removed because the affinity scale is missing.');
            } else {
              const affinity = effects.affinity;
              if (!['S', 'M', 'L', 'XL'].includes(affinity.size)) {
                affinity.size = 'S';
                warn(issues, `${path}.size`, 'Affinity size normalized to S.');
              }
              if (!['+', '-'].includes(affinity.direction)) {
                affinity.direction = '+';
                warn(issues, `${path}.direction`, 'Affinity direction normalized to +.');
              }
              if (typeof affinity.target !== 'string' || !affinity.target.trim()) {
                affinity.target = 'staff';
                warn(issues, `${path}.target`, 'Affinity target normalized to staff.');
              }
            }
          }
          choice.effects = effects;
          return choice;
        });
        return true;
      });
      if (!traffic.incidents.deck.length) { warn(issues, 'traffic.incidents.deck', 'No valid incident cards; incidents removed.'); delete traffic.incidents; }
    }
  }
  if (traffic.mail != null) {
    const mail = traffic.mail;
    const ladderExists = isObject(mail) && asArray(schema.ladders).some((ladder) => ladder && ladder.id === mail.ladder);
    if (!ladderExists) {
      warn(issues, 'traffic.mail.ladder', 'Unknown mail ladder; mail block removed.');
      delete traffic.mail;
    } else {
      if (!isObject(mail.chances)) {
        if (mail.chances != null) warn(issues, 'traffic.mail.chances', 'Invalid chances normalized to empty tables.');
        mail.chances = {};
      }
      for (const type of ['reward', 'quest']) {
        if (!isObject(mail.chances[type])) {
          if (mail.chances[type] != null) warn(issues, `traffic.mail.chances.${type}`, 'Invalid chance table normalized to empty.');
          mail.chances[type] = {};
        }
        const table = mail.chances[type];
        for (const [rank, raw] of Object.entries(table)) {
          const number = Number(raw);
          const normalized = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
          if (normalized !== number) warn(issues, `traffic.mail.chances.${type}.${rank}`, 'Mail chance normalized to 0..100.');
          table[rank] = normalized;
        }
      }
      const rawGold = isObject(mail.reward) ? mail.reward.gold : undefined;
      if (Number.isFinite(Number(rawGold))) {
        const value = Math.max(0, Number(rawGold));
        mail.reward.gold = [value, value];
        warn(issues, 'traffic.mail.reward.gold', 'Numeric mail reward normalized to [n,n].');
      } else if (Array.isArray(rawGold) && rawGold.length >= 2 && rawGold.every((value) => Number.isFinite(Number(value)))) {
        const values = [Number(rawGold[0]), Number(rawGold[1])];
        // 보상 편지가 골드를 빼앗으면 안 된다 — 음수는 0으로 클램프(악성 스키마 방어).
        const low = Math.max(0, Math.min(...values));
        const high = Math.max(0, Math.max(...values));
        mail.reward.gold = [low, high];
        if (values[0] > values[1]) warn(issues, 'traffic.mail.reward.gold', 'Mail reward range reordered to [min,max].');
        if (Math.min(...values) < 0) warn(issues, 'traffic.mail.reward.gold', 'Negative mail reward clamped to 0.');
      } else {
        mail.reward = isObject(mail.reward) ? mail.reward : {};
        mail.reward.gold = [0, 0];
        warn(issues, 'traffic.mail.reward.gold', 'Invalid mail reward normalized to [0,0].');
      }
    }
  }
  if (traffic.lodging != null) {
    const lodging = traffic.lodging;
    if (!isObject(lodging) || !lodging.roomsEntity || !findEntity(schema, lodging.roomsEntity)) {
      warn(issues, 'traffic.lodging', 'Missing or unknown rooms entity; lodging block removed.');
      delete traffic.lodging;
      return;
    }
    lodging.base = asArray(lodging.base).map((range, index) => {
      if (Number.isFinite(Number(range))) {
        const value = Number(range);
        warn(issues, `traffic.lodging.base[${index}]`, 'Numeric base normalized to [n,n].');
        return [value, value];
      }
      if (isRange(range) && range.every((value) => Number.isFinite(Number(value)))) return range.map(Number);
      warn(issues, `traffic.lodging.base[${index}]`, 'Invalid base range normalized to [0,0].');
      return [0, 0];
    });
    if (!Array.isArray(lodging.segments) || !lodging.segments.filter(isObject).length) {
      lodging.segments = [{ id: 'guest', label: '손님', weight: 1, party: [1, 2], stay: { '1': 1 } }];
      warn(issues, 'traffic.lodging.segments', 'Empty segments normalized to a default guest segment.');
    } else lodging.segments = lodging.segments.filter(isObject);
    // 잘못된 해금 게이트 세그먼트 제거 — incidents와 동일 원칙(감사 지적).
    lodging.segments = lodging.segments.filter((segment, index) => {
      if (validLadderRankGate(schema, segment.requires)) return true;
      warn(issues, `traffic.lodging.segments[${index}].requires`, 'Invalid ladderRank gate; segment removed.');
      return false;
    });
    if (!lodging.segments.length) {
      lodging.segments = [{ id: 'guest', label: '손님', weight: 1, party: [1, 2], stay: { '1': 1 } }];
      warn(issues, 'traffic.lodging.segments', 'All segments invalid; normalized to a default guest segment.');
    }
    lodging.segments = lodging.segments.map((segment, index) => {
      if (!(Number(segment.weight) > 0)) {
        segment.weight = 1;
        warn(issues, `traffic.lodging.segments[${index}].weight`, 'Non-positive weight normalized to 1.');
      } else segment.weight = Number(segment.weight);
      const stay = isObject(segment.stay) ? segment.stay : {};
      const sum = Object.keys(stay).reduce((total, key) => total + Math.max(0, Number(stay[key]) || 0), 0);
      if (sum <= 0) {
        segment.stay = { '1': 1 };
        warn(issues, `traffic.lodging.segments[${index}].stay`, 'Zero-sum stay distribution normalized to one night.');
      }
      const party = Array.isArray(segment.party) && segment.party.length >= 2 && segment.party.every((value) => Number.isFinite(Number(value)) && Number(value) >= 1);
      if (!party) {
        segment.party = [1, 2];
        warn(issues, `traffic.lodging.segments[${index}].party`, 'Invalid party range normalized to [1,2].');
      } else segment.party = [Number(segment.party[0]), Number(segment.party[1])];
      return segment;
    });
  }
}

function normalizeMenuTrade(schema, issues) {
  const menu = findEntity(schema, 'menuItem');
  if (!menu) return;
  for (const [index, instance] of asArray(menu.instances).entries()) {
    if (isObject(instance) && instance.trade != null && !['sell', 'buy'].includes(instance.trade)) {
      delete instance.trade;
      warn(issues, `entities.menuItem.instances[${index}].trade`, 'trade must be sell or buy; removed so default sell applies.');
    }
  }
}

const POOL_ALIASES = { hp: 'hp', mp: 'mp', sp: 'sp', stamina: 'sp', mana: 'mp' };

function normalizePlayerPools(schema, issues) {
  if (!isObject(schema) || schema.pools != null || !Array.isArray(schema.scales)) return;
  const promoted = [];
  const remaining = [];
  for (const scale of schema.scales) {
    const alias = isObject(scale) && scale.owner === 'player'
      ? POOL_ALIASES[String(scale.id || '').toLowerCase()]
      : null;
    if (!alias) {
      remaining.push(scale);
      continue;
    }
    const fallback = isRange(scale.range) ? Number(scale.range[1]) : NaN;
    const preferred = Number(scale.default);
    const max = Number.isFinite(preferred) && preferred > 0 ? preferred : fallback;
    if (!Number.isFinite(max) || max <= 0) {
      remaining.push(scale);
      continue;
    }
    promoted.push({ id: alias, label: String(scale.label || alias.toUpperCase()), max: Math.trunc(max) });
  }
  if (!promoted.length) return;
  schema.pools = promoted;
  schema.scales = remaining;
  if (!isObject(schema.initialState)) schema.initialState = {};
  if (!isObject(schema.initialState.player)) schema.initialState.player = {};
  if (!isObject(schema.initialState.player.pools)) schema.initialState.player.pools = {};
  for (const pool of promoted) {
    if (!isObject(schema.initialState.player.pools[pool.id])) {
      schema.initialState.player.pools[pool.id] = { cur: pool.max, max: pool.max };
    }
  }
  warn(issues, 'pools', `player 자원 ${promoted.map((pool) => pool.id).join(', ')}을 scales에서 pools로 승격했습니다.`);
}

function normalizeCombatHpPool(schema, issues) {
  if (!isObject(schema) || (schema.combat == null && schema.skills == null) || !Array.isArray(schema.pools)) return;
  if (schema.pools.some((pool) => isObject(pool) && pool.id === 'hp')) return;

  const candidates = schema.pools.filter((pool) => isObject(pool) && typeof pool.id === 'string' && pool.id.endsWith('_hp'));
  if (candidates.length === 1) {
    const oldId = candidates[0].id;
    candidates[0].id = 'hp';
    // 참조 일관성: 리네임을 스킬 소모 풀·소모품 효과 풀까지 따라가게 한다 — 안 하면 이후 검증이
    // 옛 id를 무효 취급해 스킬 풀을 mp로 리셋하거나 포션 효과를 삭제한다(감사 지적: Critical).
    for (const skill of Object.values(isObject(schema.skills) ? schema.skills : {})) {
      if (isObject(skill) && skill.pool === oldId) skill.pool = 'hp';
    }
    for (const resource of Array.isArray(schema.resources) ? schema.resources : []) {
      if (isObject(resource) && isObject(resource.effect) && resource.effect.pool === oldId) resource.effect.pool = 'hp';
    }
    // 초기 상태 이관: player.pools 경로가 없거나 옛 키가 없어도 hp 초기값을 보장한다(감사 지적: Major).
    if (!isObject(schema.initialState)) schema.initialState = {};
    if (!isObject(schema.initialState.player)) schema.initialState.player = {};
    if (!isObject(schema.initialState.player.pools)) schema.initialState.player.pools = {};
    const statePools = schema.initialState.player.pools;
    if (Object.prototype.hasOwnProperty.call(statePools, oldId)) {
      statePools.hp = statePools[oldId];
      delete statePools[oldId];
    } else if (!isObject(statePools.hp)) {
      const max = Number(candidates[0].max);
      if (Number.isFinite(max) && max > 0) statePools.hp = { cur: max, max };
    }
    warn(issues, 'pools', `플레이어 생명 풀 '${oldId}'를 'hp'로 정규화했습니다(엔진 전투는 hp id를 사용).`);
    return;
  }

  warn(issues, 'pools', "pools에 'hp' 풀이 없습니다. 전투 시작이 거부됩니다 — 생명 풀 id를 'hp'로 바꾸세요(섹션 편집기에서 pools와 initialState.player.pools 수정).");
}

function validatePools(schema, issues) {
  if (schema.pools == null) return;
  if (!Array.isArray(schema.pools)) return error(issues, 'pools', 'pools must be an array.');
  const ids = new Set();
  schema.pools.forEach((pool, index) => {
    const path = `pools[${index}]`;
    if (!isObject(pool)) return error(issues, path, 'Pool must be an object.');
    if (typeof pool.id !== 'string' || !pool.id.trim()) error(issues, `${path}.id`, 'Pool id must be a non-empty string.');
    else duplicate(ids, pool.id, `${path}.id`, issues);
    if (!Number.isInteger(Number(pool.max)) || Number(pool.max) <= 0) error(issues, `${path}.max`, 'Pool max must be a positive integer.');
  });
  const statePools = schema.initialState && schema.initialState.player && schema.initialState.player.pools;
  if (!isObject(statePools)) return;
  for (const pool of schema.pools) {
    if (!isObject(pool) || !isObject(statePools[pool.id])) continue;
    const statePool = statePools[pool.id];
    const declaredMax = Number(pool.max);
    let max = Number(statePool.max);
    let cur = Number(statePool.cur);
    if (!Number.isFinite(max) || max <= 0) max = declaredMax;
    if (!Number.isFinite(cur)) cur = max;
    const nextMax = Math.max(0, max);
    const nextCur = Math.min(nextMax, Math.max(0, cur));
    if (nextMax !== Number(statePool.max) || nextCur !== Number(statePool.cur)) {
      warn(issues, `initialState.player.pools.${pool.id}`, 'Pool cur/max was clamped to a valid range.');
    }
    statePool.max = nextMax;
    statePool.cur = nextCur;
  }
}

function validateCombat(schema, issues) {
  if (schema.combat == null) return;
  if (!isObject(schema.combat)) {
    warn(issues, 'combat', 'combat must be an object; removed.');
    delete schema.combat;
    return;
  }
  const integerFields = ['d', 'minDamage', 'fleeRate'];
  const numberFields = ['critMult', 'guardMult'];
  for (const key of integerFields.concat(numberFields)) {
    if (schema.combat[key] == null) continue;
    const value = Number(schema.combat[key]);
    const valid = Number.isFinite(value) && value > 0 && (!integerFields.includes(key) || Number.isInteger(value));
    if (!valid) {
      warn(issues, `combat.${key}`, 'Invalid combat value removed; engine default will apply.');
      delete schema.combat[key];
    } else {
      schema.combat[key] = value;
    }
  }
  for (const tableName of ['expTable', 'lootGold']) {
    const table = schema.combat[tableName];
    if (table == null) continue;
    if (!isObject(table)) {
      warn(issues, `combat.${tableName}`, 'Combat reward table must be an object; removed.');
      delete schema.combat[tableName];
      continue;
    }
    for (const [key, range] of Object.entries(table)) {
      const valid = isRange(range) && range.every((value) => Number.isInteger(Number(value))) && Number(range[0]) <= Number(range[1]);
      if (!valid) {
        warn(issues, `combat.${tableName}.${key}`, 'Invalid integer [min,max] pair removed.');
        delete table[key];
      } else {
        table[key] = range.map(Number);
      }
    }
  }
}

function validateSkills(schema, issues) {
  if (schema.skills == null) return;
  if (!isObject(schema.skills)) {
    warn(issues, 'skills', 'skills must be an object; normalized to {}.');
    schema.skills = {};
    return;
  }
  for (const [id, skillValue] of Object.entries(schema.skills)) {
    const path = `skills.${id}`;
    if (!isObject(skillValue)) {
      warn(issues, path, 'Skill must be an object; normalized.');
      schema.skills[id] = {};
    }
    const skill = schema.skills[id];
    for (const key of ['cost', 'power', 'acc']) {
      const value = Number(skill[key]);
      if (!Number.isInteger(value)) {
        warn(issues, `${path}.${key}`, 'Skill value must be an integer; defaulted to 0.');
        skill[key] = 0;
      } else skill[key] = value;
    }
    if (Math.abs(skill.acc) > 15) {
      warn(issues, `${path}.acc`, 'acc는 d20 보정(-15~+15)이어야 함. %로 보임 → 0으로 재설정');
      skill.acc = 0;
    }
    if (!['mp', 'sp', 'hp'].includes(skill.pool)) {
      warn(issues, `${path}.pool`, 'Skill pool must be mp, sp, or hp; defaulted to mp.');
      skill.pool = 'mp';
    }
  }
}

function normalizeAliases(schema, issues) {
  const room = findEntity(schema, 'room');
  if (room) {
    room.fields = normalizeFieldList(room.fields, ROOM_ALIASES, 'entities.room.fields', issues);
    for (const [index, instance] of asArray(room.instances).entries()) {
      normalizeObjectFields(instance, ROOM_ALIASES, `entities.room.instances[${index}]`, issues);
    }
  }

  const npc = findEntity(schema, 'npc');
  if (npc) {
    npc.fields = normalizeFieldList(npc.fields, NPC_ALIASES, 'entities.npc.fields', issues);
    for (const [index, instance] of asArray(npc.instances).entries()) {
      normalizeObjectFields(instance, NPC_ALIASES, `entities.npc.instances[${index}]`, issues);
    }
  }
}

function validateTop(schema, issues) {
  if (!isObject(schema)) {
    error(issues, '$', 'Schema must be a JSON object.');
    return;
  }
  for (const key of REQUIRED_TOP_LEVEL) {
    if (schema[key] == null) error(issues, key, 'Required top-level field is missing.');
  }
  if (!isObject(schema.meta)) error(issues, 'meta', 'meta must be an object.');
  else {
    for (const key of ['id', 'title', 'schemaVersion']) requireField(schema.meta, key, `meta.${key}`, issues);
  }
}

function validateResources(schema, issues) {
  if (!requireArray(schema.resources, 'resources', issues)) return;
  const ids = new Set();
  schema.resources.forEach((resource, index) => {
    const path = `resources[${index}]`;
    if (!isObject(resource)) return error(issues, path, 'Resource must be an object.');
    for (const key of ['id', 'unit', 'min']) requireField(resource, key, `${path}.${key}`, issues);
    duplicate(ids, resource.id, `${path}.id`, issues);
    if (resource.label == null) {
      const labels = { gold: '골드', food: '식자재', drink: '주류', material: '재료' };
      if (labels[resource.id]) resource.label = labels[resource.id];
    }
    if (resource.effect != null) {
      const effect = resource.effect;
      const validPool = isObject(effect) && ['hp', 'mp', 'sp'].includes(effect.pool);
      const amount = isObject(effect) ? Number(effect.amount) : NaN;
      if (!validPool || !Number.isInteger(amount) || amount <= 0) {
        warn(issues, `${path}.effect`, 'Effect must have pool hp, mp, or sp and a positive integer amount; removed.');
        delete resource.effect;
      } else {
        effect.amount = amount;
      }
    }
  });
}

function validateScales(schema, issues) {
  if (!requireArray(schema.scales, 'scales', issues)) return;
  const ids = new Set();
  schema.scales.forEach((scale, index) => {
    const path = `scales[${index}]`;
    if (!isObject(scale)) return error(issues, path, 'Scale must be an object.');
    // 필수: id·owner·range·default. steps·tiers는 스케일 종류에 따라 선택
    // (호감도류=델타 스텝+티어밴드 / HP·스탯류=풀/포인트, steps·tiers 없음).
    for (const key of ['id', 'owner', 'range', 'default']) {
      requireField(scale, key, `${path}.${key}`, issues);
    }
    // actionMinimums는 선택 — 호감도류엔 있지만 인기도 등엔 없다. 있으면 객체여야.
    if (scale.actionMinimums != null && !isObject(scale.actionMinimums)) {
      warn(issues, `${path}.actionMinimums`, 'actionMinimums가 있으면 객체여야 합니다.');
    }
    duplicate(ids, scale.id, `${path}.id`, issues);
    validateRange(scale.range, `${path}.range`, issues, 'error');
    if (isRange(scale.range) && Number(scale.range[0]) >= Number(scale.range[1])) {
      warn(issues, `${path}.range`, 'Scale range should ascend.');
    }
    // steps 선택 — 있으면 8개가 다 있어야 델타(scale_delta) 동작. 부분 누락은 경고, 없거나 빈 객체면 풀 스케일로 통과.
    if (scale.steps != null) {
      if (!isObject(scale.steps)) {
        warn(issues, `${path}.steps`, 'steps가 있으면 객체여야 합니다.');
      } else {
        const stepKeys = ['S', 'M', 'L', 'XL', 'S-', 'M-', 'L-', 'XL-'];
        const present = stepKeys.filter((k) => scale.steps[k] != null);
        if (present.length > 0 && present.length < stepKeys.length) {
          for (const k of stepKeys) {
            if (scale.steps[k] == null) warn(issues, `${path}.steps.${k}`, '델타 스케일이면 S/M/L/XL 스텝이 모두 필요합니다(HP·스탯 같은 풀 스케일이면 steps를 비워두세요).');
          }
        }
      }
    }
    // tiers 선택 — 풀/스탯 스케일엔 티어밴드가 없다. 있을 때만 검증.
    if (scale.tiers == null) return;
    if (!requireArray(scale.tiers, `${path}.tiers`, issues)) return;
    // LLM 형태 변주 관용: 상한 없는 티어("신뢰 100+")를 숫자 하나로 내는 경우가 있다(소전 실측).
    // 숫자 range를 [n, 다음 티어 시작-1]로, 마지막 티어는 스케일 상한으로 정규화한다.
    scale.tiers.forEach((tier, tierIndex) => {
      if (!isObject(tier) || typeof tier.range !== 'number' || !Number.isFinite(tier.range)) return;
      const start = Math.trunc(tier.range);
      const nextTier = scale.tiers[tierIndex + 1];
      const nextStart = isObject(nextTier)
        ? (typeof nextTier.range === 'number' ? Math.trunc(nextTier.range) : (isRange(nextTier.range) ? Number(nextTier.range[0]) : NaN))
        : NaN;
      const scaleMax = isRange(scale.range) ? Number(scale.range[1]) : NaN;
      const end = Number.isFinite(nextStart) && nextStart > start ? nextStart - 1 : (Number.isFinite(scaleMax) && scaleMax >= start ? scaleMax : start);
      tier.range = [start, end];
      warn(issues, `${path}.tiers[${tierIndex}].range`, `숫자 range ${start}을(를) [${start}, ${end}]로 정규화했습니다.`);
    });
    scale.tiers.forEach((tier, tierIndex) => {
      const tierPath = `${path}.tiers[${tierIndex}]`;
      if (!isObject(tier)) return error(issues, tierPath, 'Tier must be an object.');
      for (const key of ['range', 'label', 'brief']) requireField(tier, key, `${tierPath}.${key}`, issues);
      validateRange(tier.range, `${tierPath}.range`, issues, 'error');
      if (isRange(scale.range) && isRange(tier.range)) {
        if (Number(tier.range[0]) < Number(scale.range[0]) || Number(tier.range[1]) > Number(scale.range[1])) {
          warn(issues, `${tierPath}.range`, 'Tier range falls outside scale range.');
        }
      }
      // forbidden 선택 — NPC 행동 규범용 필드라 플레이어 스탯 티어(예: 헌터 STR 랭크 서술)엔
      // 없는 게 정상. 없거나 모양이 다르면 빈 배열로 정규화하고 경고만 남긴다.
      if (tier.forbidden == null) {
        tier.forbidden = [];
        warn(issues, `${tierPath}.forbidden`, 'forbidden missing; defaulted to [] (player-stat tiers have no behavior norms).');
      } else if (!Array.isArray(tier.forbidden)) {
        tier.forbidden = [];
        warn(issues, `${tierPath}.forbidden`, 'forbidden was not an array; normalized to [].');
      }
    });
  });
}

function validateLadders(schema, issues) {
  if (!requireArray(schema.ladders, 'ladders', issues)) return;
  const ids = new Set();
  schema.ladders.forEach((ladder, index) => {
    const path = `ladders[${index}]`;
    if (!isObject(ladder)) return error(issues, path, 'Ladder must be an object.');
    requireField(ladder, 'id', `${path}.id`, issues);
    duplicate(ids, ladder.id, `${path}.id`, issues);
    if (ladder.id === 'player_level') {
      for (const key of ['currency', 'sources']) requireField(ladder, key, `${path}.${key}`, issues);
      // thresholds는 선택 — 룰북에 레벨 문턱이 없으면 null이 정상(엔진은 thresholds||[]로 처리).
      // null/없으면 검수에서 채우도록 경고만, 있으면 배열이어야.
      if (ladder.thresholds == null) warn(issues, `${path}.thresholds`, '레벨업 문턱이 미정입니다 — 검수에서 채우거나, 비워두면 레벨업이 비활성됩니다.');
      else if (requireArray(ladder.thresholds, `${path}.thresholds`, issues)) {
        const normalized = [];
        for (const value of ladder.thresholds) {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0 && (!normalized.length || n > normalized[normalized.length - 1])) normalized.push(n);
        }
        if (normalized.length !== ladder.thresholds.length || normalized.some((value, i) => value !== ladder.thresholds[i])) {
          warn(issues, `${path}.thresholds`, '0 이하·비정상·비증가 레벨 문턱을 제거했습니다.');
          ladder.thresholds = normalized;
        }
      }
      if (!isObject(ladder.sources)) error(issues, `${path}.sources`, 'sources must be an object.');
    }
    if (ladder.id === 'reputation') {
      for (const key of ['axes', 'axisLabels', 'ranks', 'onPromote', 'onNegative', 'categories']) {
        requireField(ladder, key, `${path}.${key}`, issues);
      }
      requireArray(ladder.axes, `${path}.axes`, issues);
      if (!isObject(ladder.axisLabels)) error(issues, `${path}.axisLabels`, 'axisLabels must be an object.');
      if (!isObject(ladder.categories)) error(issues, `${path}.categories`, 'categories must be an object.');
      if (requireArray(ladder.ranks, `${path}.ranks`, issues)) validateRanks(ladder.ranks, `${path}.ranks`, issues);
    }
  });
}

function validateEntities(schema, issues) {
  if (!requireArray(schema.entities, 'entities', issues)) return;
  const types = new Set();
  schema.entities.forEach((entity, index) => {
    const path = `entities[${index}]`;
    if (!isObject(entity)) return error(issues, path, 'Entity block must be an object.');
    for (const key of ['type', 'fields', 'instances']) requireField(entity, key, `${path}.${key}`, issues);
    duplicate(types, entity.type, `${path}.type`, issues);
    requireArray(entity.fields, `${path}.fields`, issues);
    requireArray(entity.instances, `${path}.instances`, issues);

    const required = ENTITY_FIELDS[entity.type];
    if (!required) return;
    const optionalDefaults = ENTITY_OPTIONAL_DEFAULTS[entity.type] || {};
    const fieldSet = new Set(asArray(entity.fields));
    const missingOptionalFields = [];
    for (const field of required) {
      if (fieldSet.has(field)) continue;
      if (field in optionalDefaults) {
        if (Array.isArray(entity.fields)) entity.fields.push(field);
        missingOptionalFields.push(field);
        continue;
      }
      error(issues, `${path}.fields`, `Missing canonical field ${field}.`);
    }
    if (missingOptionalFields.length) {
      warn(issues, `${path}.fields`, `${missingOptionalFields.join(', ')} 누락 — 기본값으로 정규화했습니다(선택 필드).`);
    }
    asArray(entity.instances).forEach((instance, instanceIndex) => {
      const itemPath = `${path}.instances[${instanceIndex}]`;
      if (!isObject(instance)) return error(issues, itemPath, 'Entity instance must be an object.');
      for (const field of required) {
        if (field in instance) continue;
        if (field in optionalDefaults) {
          instance[field] = clone(optionalDefaults[field]);
          continue;
        }
        error(issues, `${itemPath}.${field}`, `Missing required field ${field}.`);
      }
      if (entity.type === 'facility' && instance.upgradeCosts != null) {
        validateUpgradeCosts(instance.upgradeCosts, `${itemPath}.upgradeCosts`, issues);
      }
    });
  });
}

function validateFormulas(schema, issues) {
  if (schema.formulas == null) return;
  if (!requireArray(schema.formulas, 'formulas', issues)) return;
  schema.formulas.forEach((formula, index) => {
    if (!isObject(formula)) return error(issues, `formulas[${index}]`, 'Formula must be an object.');
    requireField(formula, 'id', `formulas[${index}].id`, issues);
  });
}

function validateProcesses(schema, issues) {
  if (schema.processes == null) return;
  if (!requireArray(schema.processes, 'processes', issues)) return;
  schema.processes.forEach((process, index) => {
    const path = `processes[${index}]`;
    if (!isObject(process)) return error(issues, path, 'Process must be an object.');
    for (const key of ['trigger', 'steps']) requireField(process, key, `${path}.${key}`, issues);
    if (requireArray(process.steps, `${path}.steps`, issues)) {
      process.steps.forEach((step, stepIndex) => {
        if (!isObject(step)) return error(issues, `${path}.steps[${stepIndex}]`, 'Process step must be an object.');
        requireField(step, 'id', `${path}.steps[${stepIndex}].id`, issues);
      });
    }
  });
}

function validateRewards(schema, issues) {
  if (schema.rewards == null) return;
  if (!isObject(schema.rewards)) return warn(issues, 'rewards', 'rewards must be an object when present.');
  if (!isObject(schema.rewards.gold)) return warn(issues, 'rewards.gold', 'rewards.gold must be an object when present.');

  for (const [tier, range] of Object.entries(schema.rewards.gold)) {
    const path = `rewards.gold.${tier}`;
    if (!isRange(range)) {
      warn(issues, path, 'Reward range must be an array of length 2.');
      continue;
    }
    const min = Number(range[0]);
    const max = Number(range[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      warn(issues, path, 'Reward range values should be numeric.');
    } else if (min > max) {
      warn(issues, path, 'Reward range should ascend.');
    }
  }
}

function validateQuests(schema, issues) {
  if (schema.quests == null) return;
  if (!Array.isArray(schema.quests)) {
    warn(issues, 'quests', 'quests must be an array; removed.');
    delete schema.quests;
    return;
  }
  const seen = new Set();
  const normalized = [];
  schema.quests.forEach((raw, index) => {
    const path = `quests[${index}]`;
    if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id.trim()) {
      warn(issues, `${path}.id`, 'Quest id must be a non-empty string; removed.');
      return;
    }
    const id = raw.id.trim();
    if (seen.has(id)) {
      warn(issues, `${path}.id`, `Duplicate quest id ${id}; removed.`);
      return;
    }
    seen.add(id);
    if (typeof raw.rewardTier !== 'string' || !raw.rewardTier.trim()) {
      warn(issues, `${path}.rewardTier`, 'Quest rewardTier must be a non-empty string; removed.');
      return;
    }
    const rewardTier = raw.rewardTier.trim();
    let check;
    if (isObject(raw.check) && raw.check.mode === 'rate') {
      const value = Math.trunc(Number(raw.check.rate));
      check = { mode: 'rate', rate: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50 };
      if (!Number.isFinite(value)) warn(issues, `${path}.check.rate`, 'Invalid rate normalized to 50.');
      else if (value !== Number(raw.check.rate) || value < 0 || value > 100) warn(issues, `${path}.check.rate`, 'Rate normalized to an integer from 0 to 100.');
    } else if (isObject(raw.check) && raw.check.mode === 'dc') {
      const dc = Math.trunc(Number(raw.check.dc));
      const sides = Math.trunc(Number(raw.check.sides));
      check = { mode: 'dc', dc: Number.isFinite(dc) ? dc : 10, sides: Number.isFinite(sides) && sides > 0 ? sides : 20 };
      if (typeof raw.check.stat === 'string' && raw.check.stat.trim()) check.stat = raw.check.stat.trim();
      // 생략(undefined)은 기본값의 정상 경로 — 잘못된 값이 "있을 때만" 경고(감사 지적: 오발 경고).
      const dcInvalid = raw.check.dc != null && !Number.isFinite(dc);
      const sidesInvalid = raw.check.sides != null && !(Number.isFinite(sides) && sides > 0);
      if (dcInvalid || sidesInvalid) warn(issues, `${path}.check`, 'Invalid dc/sides normalized to defaults.');
      else if ((raw.check.dc != null && dc !== Number(raw.check.dc)) || (raw.check.sides != null && sides !== Number(raw.check.sides))) warn(issues, `${path}.check`, 'dc/sides normalized to integers.');
    } else {
      check = { mode: 'rate', rate: 50 };
      warn(issues, `${path}.check`, 'Invalid or missing check normalized to rate 50.');
    }
    if (!isObject(schema.rewards) || !isObject(schema.rewards.gold) || !(rewardTier in schema.rewards.gold)) {
      warn(issues, `${path}.rewardTier`, `Unknown rewards.gold key ${rewardTier}; attempt will be rejected.`);
    }
    const chanceRaw = Math.trunc(Number(raw.encounterChance));
    let encounterChance = raw.encounterChance == null ? 0 : (Number.isFinite(chanceRaw) ? Math.max(0, Math.min(100, chanceRaw)) : 0);
    if (raw.encounterChance != null && (encounterChance !== Number(raw.encounterChance))) warn(issues, `${path}.encounterChance`, 'Encounter chance normalized to an integer from 0 to 100.');
    // 컴파일러(LLM)는 encounterChance를 모른다 — 전투·조우 풀이 있는 스키마에서 미지정 의뢰는
    // 이름 휴리스틱으로 기본치 부여(없으면 연쇄가 실플레이에서 영원히 죽는다).
    if (raw.encounterChance == null && schema.combat && isObject(schema.encounters) && Array.isArray(schema.encounters.pool) && schema.encounters.pool.length) {
      const label = `${id} ${typeof raw.name === 'string' ? raw.name : ''}`;
      encounterChance = /던전|토벌|현상|호위|구출|dungeon|bounty|subjugat|escort|rescue/i.test(label) ? 35
        : /채집|정보|gather|intel/i.test(label) ? 15 : 25;
      warn(issues, `${path}.encounterChance`, `Default encounter chance ${encounterChance} assigned (combat schema with encounter pool).`);
    }
    normalized.push({ id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id, check, rewardTier, repeatable: Boolean(raw.repeatable), encounterChance, ...(isObject(raw.requires) ? { requires: clone(raw.requires) } : {}) });
  });
  schema.quests = normalized;
}

function validateGather(schema, issues) {
  if (schema.gather == null) return;
  if (!isObject(schema.gather)) return error(issues, 'gather', 'gather must be an object when present.');
  for (const scale of ['small', 'large', 'bulk']) {
    const path = `gather.${scale}`;
    const range = schema.gather[scale];
    if (!isRange(range)) {
      error(issues, path, 'Gather range must be an array of length 2.');
      continue;
    }
    validateAscendingIntegerRange(range, path, issues);
  }
}

function validateSettlement(schema, issues) {
  if (schema.settlement == null) return;
  if (!Array.isArray(schema.settlement)) {
    warn(issues, 'settlement', 'settlement must be an array; removed.');
    delete schema.settlement;
    return;
  }
  const normalized = [];
  schema.settlement.forEach((step, index) => {
    const path = `settlement[${index}]`;
    if (!isObject(step) || !['facility_yield', 'pool_recover', 'upkeep'].includes(step.type)) {
      warn(issues, path, 'Unknown or invalid settlement step removed.');
      return;
    }
    if (step.type === 'facility_yield') {
      if (!isObject(step.perLevel) || !normalizePerLevel(step.perLevel, `${path}.perLevel`, issues)) {
        warn(issues, path, 'facility_yield requires a non-empty perLevel table; removed.');
        return;
      }
      const resource = typeof step.resource === 'string' && step.resource.trim();
      if (!!resource === (step.gold === true)) {
        warn(issues, path, 'facility_yield requires exactly one of resource or gold:true; removed.');
        return;
      }
      if (resource) {
        step.resource = step.resource.trim();
        // 정적 단계에서도 미선언 자원을 미리 경고(감사 지적 — 런타임은 이미 스킵 방어됨).
        if (!(schema.resources || []).some((r) => isObject(r) && r.id === step.resource)) {
          warn(issues, `${path}.resource`, `'${step.resource}'는 schema.resources에 선언되지 않았습니다 — 정산 시 스킵됩니다.`);
        }
      }
      normalized.push(step);
      return;
    }
    if (step.type === 'pool_recover') {
      if (!Array.isArray(step.pools) || !step.pools.length || step.pools.some((id) => typeof id !== 'string' || !id.trim())) {
        warn(issues, `${path}.pools`, 'pool_recover requires a non-empty string array; removed.');
        return;
      }
      step.pools = step.pools.map((id) => id.trim());
      // 범위 금지(allowRanges=false) — pool_recover는 rng 미소비 계약(감사 지적).
      if (step.perLevel != null && (!isObject(step.perLevel) || !normalizePerLevel(step.perLevel, `${path}.perLevel`, issues, false, false))) delete step.perLevel;
      if (step.ratio != null) {
        const ratio = Number(step.ratio);
        if (!Number.isFinite(ratio)) delete step.ratio;
        else {
          step.ratio = Math.min(1, Math.max(0, ratio));
          if (step.ratio !== ratio) warn(issues, `${path}.ratio`, 'ratio was clamped to 0..1.');
        }
      }
      if (step.amount != null) {
        const amount = Number(step.amount);
        if (!Number.isFinite(amount)) delete step.amount;
        else step.amount = Math.max(0, Math.trunc(amount));
      }
      normalized.push(step);
      return;
    }
    const gold = Number(step.gold);
    if (!Number.isFinite(gold) || Math.trunc(gold) <= 0) {
      warn(issues, `${path}.gold`, 'upkeep gold must be a positive integer; removed.');
      return;
    }
    step.gold = Math.trunc(gold);
    normalized.push(step);
  });
  schema.settlement = normalized;
}

function normalizePerLevel(table, path, issues, requireNonEmpty = true, allowRanges = true) {
  for (const [key, raw] of Object.entries(table)) {
    const level = Number(key);
    let value;
    if (Number.isInteger(level) && level > 0 && Number.isFinite(Number(raw)) && !Array.isArray(raw)) value = Math.trunc(Number(raw));
    // pool_recover는 rng를 소비하지 않으므로 범위 값을 받지 않는다(감사 지적: NaN→무음 무효 방지).
    else if (allowRanges && Number.isInteger(level) && level > 0 && isRange(raw) && raw.every((n) => Number.isFinite(Number(n))) && Number(raw[0]) <= Number(raw[1])) value = raw.map((n) => Math.trunc(Number(n)));
    if (value == null) {
      warn(issues, `${path}.${key}`, 'Invalid perLevel entry removed.');
      delete table[key];
      continue;
    }
    // 키 정규화: "01" 같은 표기를 "1"로(감사 지적: 레벨 조회·폴백 실패 방지).
    const canonical = String(level);
    if (canonical !== key) delete table[key];
    table[canonical] = value;
  }
  return !requireNonEmpty || Object.keys(table).length > 0;
}

function validateUpgradeCosts(costs, path, issues) {
  if (!isObject(costs)) return error(issues, path, 'upgradeCosts must be an object when present.');
  for (const [level, cost] of Object.entries(costs)) {
    const numericLevel = Number(level);
    const numericCost = Number(cost);
    if (!Number.isInteger(numericLevel) || numericLevel <= 1) {
      error(issues, `${path}.${level}`, 'Upgrade cost level keys must be integer levels greater than 1.');
    }
    if (!Number.isInteger(numericCost) || numericCost <= 0) {
      error(issues, `${path}.${level}`, 'Upgrade cost values must be positive integers.');
    }
  }
}

function validateEvents(schema, issues) {
  if (!requireArray(schema.events, 'events', issues)) return;
  const ids = new Set();
  schema.events.forEach((event, index) => {
    const path = `events[${index}]`;
    if (!isObject(event)) return error(issues, path, 'Event must be an object.');
    for (const key of ['id', 'params']) requireField(event, key, `${path}.${key}`, issues);
    duplicate(ids, event.id, `${path}.id`, issues);
    if (!isObject(event.params)) error(issues, `${path}.params`, 'params must be an object.');
  });
}

function validateRanks(ranks, path, issues) {
  let last = -Infinity;
  ranks.forEach((rank, index) => {
    const rankPath = `${path}[${index}]`;
    if (!isObject(rank)) return error(issues, rankPath, 'Rank must be an object.');
    for (const key of ['id', 'next']) requireField(rank, key, `${rankPath}.${key}`, issues);
    if (rank.next != null) {
      const next = Number(rank.next);
      if (!Number.isFinite(next)) warn(issues, `${rankPath}.next`, 'Rank next should be numeric or null.');
      else if (next <= last) warn(issues, `${rankPath}.next`, 'Rank next thresholds should ascend.');
      else last = next;
    }
  });
}

function normalizeFieldList(fields, aliases, path, issues) {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field) => {
    if (aliases[field]) {
      warn(issues, path, `Normalized field ${field} -> ${aliases[field]}.`);
      return aliases[field];
    }
    return field;
  });
}

function normalizeObjectFields(obj, aliases, path, issues) {
  if (!isObject(obj)) return;
  for (const [from, to] of Object.entries(aliases)) {
    if (from in obj && !(to in obj)) {
      obj[to] = obj[from];
      delete obj[from];
      warn(issues, `${path}.${from}`, `Normalized field ${from} -> ${to}.`);
    }
  }
}

function validateRange(value, path, issues, level) {
  if (!isRange(value)) {
    (level === 'warn' ? warn : error)(issues, path, 'Range must be an array of length 2.');
  }
}

function validateAscendingIntegerRange(range, path, issues) {
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    error(issues, path, 'Range values must be integers.');
  } else if (min > max) {
    error(issues, path, 'Range must ascend.');
  }
}

function requireArray(value, path, issues) {
  if (!Array.isArray(value)) {
    error(issues, path, 'Must be an array.');
    return false;
  }
  return true;
}

function requireField(obj, key, path, issues) {
  if (!obj || !(key in obj)) error(issues, path, 'Required field is missing.');
}

function duplicate(set, value, path, issues) {
  if (value == null || value === '') return;
  if (set.has(value)) warn(issues, path, `Duplicate id/type ${value}.`);
  set.add(value);
}

function findEntity(schema, type) {
  return asArray(schema && schema.entities).find((entry) => entry && entry.type === type);
}

function isRange(value) {
  return Array.isArray(value) && value.length === 2;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function error(issues, path, msg) {
  issues.push({ level: 'error', path, msg });
}

function warn(issues, path, msg) {
  issues.push({ level: 'warn', path, msg });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { validateSchema };
