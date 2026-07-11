'use strict';

const { runDayEnd } = require('./dayEnd.js');
const { startEncounter } = require('./combat.js');
const { staffMax, menuTrade } = require('./selectors.js');
const { resolveCheck } = require('./resolveCheck.js');
const { rollQuestEncounter } = require('./questEncounter.js');
const { activeQuests } = require('./quests.js');
const { rollTrafficIncident, resolveIncidentChoice, generateLodgingQueue, resolveLodgingDecision, checkMail, openMail } = require('./traffic.js');
const { ModuleRegistry } = require('./moduleRegistry.js');
const { createLegacyModule } = require('./modules/legacy.js');
const { createStatsModule } = require('./modules/stats.js');
const { createInventoryModule } = require('./modules/inventory.js');
const { createCombatModule } = require('./modules/combat.js');
const { createProgressionModule, createEquipmentModule, createQuestModule, createPartyModule, createTimeModule, createLocationModule, createLootModule, createShopModule, createCraftingModule, createFactionsModule, createJobsModule } = require('./modules/commonRpg.js');
const {
  clone,
  findById,
  findRoom,
  findMenu,
  normalizeInt,
  safeOwnKey,
  safeStateKey,
  saleConsumes,
} = require('./utils.js');

function applyLegacyEvent(schema, state, event, rng) {
  const type = event && event.id;
  const params = (event && event.params) || event || {};
  if (type === 'day_end') {
    const result = runDayEnd(schema, state, rng);
    if (result.state.pendingQuest && result.state.pendingQuest.day !== result.state.day) delete result.state.pendingQuest;
    if (result.state.questAttempts && result.state.questAttempts.day !== result.state.day) delete result.state.questAttempts;
    for (const scale of (schema && schema.scales) || []) {
      if (!scale || !scale.steps) continue;
      for (const npc of Object.values(result.state.npcs || {})) npc[`${scale.id}DeltaToday`] = 0;
    }
    return { state: result.state, log: [{ ok: true, event: type, report: result.report }] };
  }

  const next = clone(state);
  const log = [];
  const fail = (reason, detail) => ({ state, log: [{ ok: false, event: type, reason, detail }] });
  const ok = (entry) => {
    log.push(Object.assign({ ok: true, event: type }, entry || {}));
    return { state: next, log };
  };

  switch (type) {
    case 'gold_delta':
      return goldDelta(next, params, ok);
    case 'upgrade':
      return upgrade(schema, next, params, ok, fail);
    case 'reward':
      return reward(schema, next, params, rng, ok, fail);
    case 'attempt_quest':
      return attemptQuest(schema, next, params, rng, ok, fail);
    case 'set_outfit':
      return setOutfit(next, params, ok, fail);
    case 'checkin':
      return checkin(schema, next, params, ok, fail);
    case 'checkout':
      return checkout(next, params, ok, fail);
    case 'sale':
      return sale(schema, next, params, ok, fail);
    case 'hire':
      return hire(schema, next, params, ok, fail);
    case 'set_wage':
      return setWage(next, params, ok, fail);
    case 'fire':
      return fire(next, params, ok, fail);
    case 'traffic_wave': {
      const result = rollTrafficIncident(schema, next, params.wave, params.skip === true);
      if (!result.ok) return fail(result.reason, result.detail);
      for (const entry of result.entries) log.push(Object.assign({ event: type }, entry));
      return { state: next, log };
    }
    case 'incident_choice': {
      const result = resolveIncidentChoice(schema, next, params.choice);
      if (!result.ok) return fail(result.reason, result.detail);
      for (const entry of result.entries) log.push(Object.assign({ event: type }, entry));
      return { state: next, log };
    }
    case 'lodging_review': {
      const result = generateLodgingQueue(schema, next);
      return result.ok ? ok(result) : fail(result.reason, result.detail);
    }
    case 'lodging_accept':
    case 'lodging_reject': {
      const result = resolveLodgingDecision(schema, next, params.requestId, type === 'lodging_accept' ? 'accept' : 'reject');
      return result.ok ? ok(result) : fail(result.reason, result.detail);
    }
    case 'mail_check': {
      const result = checkMail(schema, next);
      return result.ok ? ok(result) : fail(result.reason, result.detail);
    }
    case 'mail_open': {
      const result = openMail(schema, next, params.mailId);
      return result.ok ? ok(result) : fail(result.reason, result.detail);
    }
    default:
      return fail('unknown_event', `Unknown event id: ${type}`);
  }
}

function goldDelta(state, params, ok) {
  const amount = normalizeInt(params.amount);
  const before = state.gold;
  state.gold = Math.max(0, Number(state.gold || 0) + amount);
  return ok({ amount, before, after: state.gold, reason: params.reason || '' });
}

function reward(schema, state, params, rng, ok, fail) {
  const questId = params.questId;
  if (questId == null || String(questId).trim() === '') return fail('missing_questId');
  const normalizedQuestId = String(questId);
  if ((state.claimedRewards || []).includes(normalizedQuestId)) return fail('already_claimed', normalizedQuestId);
  const tier = params.tier;
  const range = schema && schema.rewards && schema.rewards.gold && schema.rewards.gold[tier];
  if (!isRewardRange(range)) return fail('unknown_reward_tier', tier);
  if ('amount' in params || 'goldDelta' in params) return fail('reward_amount_not_allowed');

  const amount = rng.int(range[0], range[1]);
  const before = state.gold;
  state.gold = Number(state.gold || 0) + amount;
  state.claimedRewards = (state.claimedRewards || []).concat([normalizedQuestId]);
  return ok({ questId: normalizedQuestId, tier, goldDelta: amount, before, after: state.gold, reason: params.reason || '' });
}

function attemptQuest(schema, state, params, rng, ok, fail) {
  if (['amount', 'gold', 'goldDelta', 'roll', 'tier'].some((key) => key in params)) return fail('quest_number_not_allowed');
  // 전투 중 의뢰 수행 금지 — 콘솔은 숨기지만 자유 텍스트·수동 트리거 경로까지 엔진이 차단(감사 지적).
  if (state.combat && state.combat.active) return fail('in_combat');
  const questId = params.questId == null ? '' : String(params.questId);
  const quest = activeQuests(schema, state).find((entry) => entry && entry.id === questId);
  if (!quest) return fail('unknown_quest', questId);
  if (!quest.repeatable && (state.claimedRewards || []).includes(questId)) return fail('already_claimed', questId);
  if (state.questAttempts && state.questAttempts.day === state.day && (state.questAttempts.ids || []).includes(questId)) return fail('already_attempted_today', questId);
  const range = schema && schema.rewards && schema.rewards.gold && schema.rewards.gold[quest.rewardTier];
  if (!isRewardRange(range)) return fail('unknown_reward_tier', quest.rewardTier);

  if (state.pendingQuest && state.pendingQuest.day !== state.day) delete state.pendingQuest;
  if (state.pendingQuest && state.pendingQuest.questId === questId && state.pendingQuest.cleared) {
    delete state.pendingQuest;
  } else {
    const encounter = rollQuestEncounter(schema, state, quest);
    if (encounter) {
      const started = startEncounter(schema, state, { enemies: encounter.enemies }, rng, (entry) => ({ state, log: [Object.assign({ ok: true, event: 'start_encounter' }, entry)] }), fail);
      if (!started.log[0].ok) return started;
      // 이 전투가 어느 의뢰의 조우인지 태깅 — 무관한 전투 승리로 의뢰 판정이 열리는 누수 방지.
      if (state.combat) state.combat.questId = questId;
      state.pendingQuest = { questId, day: state.day };
      return ok({ questId, name: quest.name || questId, encounter: encounter.encounter.id, enemies: started.log[0].enemies, text: `${quest.name || questId} 수행 중 ${encounter.encounter.name} 조우!` });
    }
  }

  const check = Object.assign({}, quest.check);
  if (check.mode === 'dc' && check.stat) {
    check.mod = Number((state.player && state.player[check.stat]) ?? (state.player && state.player.stats && state.player.stats[check.stat]) ?? 0);
  }
  if (!(state.questAttempts && state.questAttempts.day === state.day && Array.isArray(state.questAttempts.ids))) state.questAttempts = { day: state.day, ids: [] };
  if (!state.questAttempts.ids.includes(questId)) state.questAttempts.ids.push(questId);
  const result = resolveCheck(rng, check);
  const base = { questId, name: quest.name || questId, roll: result.rand, tier: result.tier, success: result.success };
  if (!result.success) return ok(base);

  const goldDelta = rng.int(range[0], range[1]);
  state.gold = Number(state.gold || 0) + goldDelta;
  if (!quest.repeatable) state.claimedRewards = (state.claimedRewards || []).concat([questId]);
  return ok(Object.assign(base, { goldDelta, claimed: !quest.repeatable }));
}

function isRewardRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const min = Number(range[0]);
  const max = Number(range[1]);
  return Number.isFinite(min) && Number.isFinite(max) && max >= min;
}

function upgrade(schema, state, params, ok, fail) {
  if (state.combat && state.combat.active) return fail('in_combat');
  const facility = params.facility || params.facilityId;
  const def = findById(schema, 'facility', facility);
  if (!def) return fail('unknown_facility', facility);
  // 폴백 1: 다른 셀렉터(availableMenu·roomStatus 등)와 동일 — 미기재 시설은 1레벨 취급(감사 지적: 0이면 Lv.0→1 이중 청구 노출).
  const current = Number((state.facilities && state.facilities[facility]) || 1);
  if (current >= Number(def.maxLevel || 0)) return fail('max_level', facility);
  const level = current + 1;
  const cost = def.upgradeCosts && def.upgradeCosts[String(level)];
  if (!Number.isFinite(Number(cost))) return fail('no_upgrade_cost', facility);
  if (Number(state.gold || 0) < Number(cost)) return fail('insufficient_gold', facility);

  state.gold = Number(state.gold || 0) - Number(cost);
  state.facilities[facility] = level;
  return ok({ facility, level, goldDelta: -Number(cost) });
}

function setOutfit(state, params, ok, fail) {
  const npcId = params.npcId;
  // safeOwnKey — '__proto__' 류 키가 프로토타입 체인을 타고 존재 검사를 우회하는 오염 차단(감사 Critical).
  if (!safeOwnKey(state.npcs, npcId)) return fail('unknown_target', npcId);
  const outfit = normalizeInt(params.outfit);
  if (outfit < 0 || outfit > 9) return fail('invalid_outfit', params.outfit);
  const before = state.npcs[npcId].outfit;
  state.npcs[npcId].outfit = outfit;
  return ok({ npcId, before, outfit });
}

function checkin(schema, state, params, ok, fail) {
  const roomNo = String(params.roomNo);
  const room = findRoom(schema, roomNo);
  const stayDays = normalizeInt(params.stayDays, 1);
  const guestName = params.guestName;
  if (!room || !safeStateKey(roomNo)) return fail('unknown_room', roomNo);
  if (!guestName) return fail('missing_guestName');
  if (stayDays <= 0) return fail('invalid_stayDays', stayDays);
  if (Number(room.requiresRoomLevel || 1) > Number((state.facilities && state.facilities.room) || 1)) return fail('room_locked', roomNo);
  const current = safeOwnKey(state.rooms, roomNo) ? state.rooms[roomNo] : [];
  if (room.capacity != null && current.length >= Number(room.capacity)) return fail('room_full', roomNo);
  const price = Number(room.pricePerNight || 0) * stayDays;
  state.rooms[roomNo] = current.concat([{ guestName, nightsLeft: stayDays }]);
  state.gold += price;
  return ok({ roomNo, guestName, stayDays, goldDelta: price });
}

function checkout(state, params, ok, fail) {
  const roomNo = String(params.roomNo);
  const guestName = params.guestName;
  const current = safeOwnKey(state.rooms, roomNo) ? state.rooms[roomNo] : [];
  const idx = current.findIndex((guest) => guest.guestName === guestName);
  if (idx < 0) return fail('guest_not_found', `${roomNo}:${guestName}`);
  const remaining = current.slice(0, idx).concat(current.slice(idx + 1));
  if (remaining.length) state.rooms[roomNo] = remaining;
  else delete state.rooms[roomNo];
  return ok({ roomNo, guestName });
}

function sale(schema, state, params, ok, fail) {
  // 전투 중 경영 거래 금지 — 콘솔은 숨기지만 자유 텍스트 경로까지 엔진이 차단(감사 지적, attempt_quest와 동일 원칙).
  if (state.combat && state.combat.active) return fail('in_combat');
  const menu = findMenu(schema, params.menuName);
  const qty = normalizeInt(params.qty, 1);
  if (!menu) return fail('unknown_menu', params.menuName);
  if (menuTrade(menu) !== 'sell') return fail('menu_not_sellable', params.menuName);
  if (qty <= 0 || qty > 999) return fail('invalid_qty', qty); // 상한 999 — 가격 0 아이템·consumes 없는 메뉴의 무제한 수량 악용 방지(감사 지적)
  if (Number(menu.requiresKitchenLevel || 1) > Number((state.facilities && state.facilities.kitchen) || 1)) return fail('menu_locked', params.menuName);
  const consumes = saleConsumes(menu, state);
  if (!Object.keys(consumes).length) return fail('missing_consumption_rule', params.menuName);
  for (const [resource, amount] of Object.entries(consumes)) {
    if (Number((state.resources && state.resources[resource]) || 0) < Number(amount) * qty) {
      return fail('insufficient_stock', resource);
    }
  }
  const consumed = {};
  for (const [resource, amount] of Object.entries(consumes)) {
    const used = Number(amount) * qty;
    state.resources[resource] -= used;
    consumed[resource] = used;
  }
  const goldDelta = Number(menu.price || 0) * qty;
  state.gold += goldDelta;
  return ok({ menuName: menu.name, qty, goldDelta, consumed });
}

function hire(schema, state, params, ok, fail) {
  const npcId = params.npcId;
  const wage = normalizeInt(params.dailyWage);
  if (!findById(schema, 'npc', npcId)) return fail('unknown_npc', npcId);
  if (wage < 0) return fail('invalid_wage', wage);
  if ((state.staff || []).some((staff) => staff.npcId === npcId)) return fail('already_hired', npcId);
  if ((state.staff || []).length >= staffMax(schema, state)) return fail('staff_full', npcId);
  state.staff = (state.staff || []).concat([{ npcId, dailyWage: wage }]);
  return ok({ npcId, dailyWage: wage });
}

function setWage(state, params, ok, fail) {
  const npcId = params.npcId;
  const wage = normalizeInt(params.dailyWage);
  if (wage < 0) return fail('invalid_wage', wage);
  const staff = (state.staff || []).find((item) => item.npcId === npcId);
  if (!staff) return fail('not_hired', npcId);
  const before = Number(staff.dailyWage || 0);
  staff.dailyWage = wage;
  return ok({ npcId, before, dailyWage: wage });
}

function fire(state, params, ok, fail) {
  const npcId = params.npcId;
  const before = state.staff || [];
  if (!before.some((staff) => staff.npcId === npcId)) return fail('not_hired', npcId);
  state.staff = before.filter((staff) => staff.npcId !== npcId);
  return ok({ npcId });
}

const defaultModuleRegistry = new ModuleRegistry();
defaultModuleRegistry.register(createStatsModule());
defaultModuleRegistry.register(createInventoryModule());
defaultModuleRegistry.register(createProgressionModule());
defaultModuleRegistry.register(createEquipmentModule());
defaultModuleRegistry.register(createQuestModule());
defaultModuleRegistry.register(createPartyModule());
defaultModuleRegistry.register(createTimeModule());
defaultModuleRegistry.register(createLocationModule());
defaultModuleRegistry.register(createLootModule());
defaultModuleRegistry.register(createShopModule());
defaultModuleRegistry.register(createCraftingModule());
defaultModuleRegistry.register(createFactionsModule());
defaultModuleRegistry.register(createJobsModule());
defaultModuleRegistry.register(createCombatModule());
defaultModuleRegistry.register(createLegacyModule(applyLegacyEvent));

function applyEvent(schema, state, event, rng) {
  return defaultModuleRegistry.dispatch(schema, state, event, rng);
}

function getDefaultModuleRegistry() {
  return defaultModuleRegistry;
}

function getRegisteredEventIds() {
  return defaultModuleRegistry.eventIds();
}

module.exports = { applyEvent, getDefaultModuleRegistry, getRegisteredEventIds };
