'use strict';

const { runDayEnd } = require('./dayEnd.js');
const { startEncounter, combatAction, enemyAction, enemyTurn, endEncounter } = require('./combat.js');
const { staffMax, tierOf, menuTrade } = require('./selectors.js');
const { poolHeal } = require('./pools.js');
const { resolveCheck } = require('./resolveCheck.js');
const { resolveTrafficWave, generateLodgingQueue, resolveLodgingDecision } = require('./traffic.js');
const {
  clone,
  clamp,
  findById,
  findRoom,
  findMenu,
  scaleById,
  ladderById,
  rankIndex,
  normalizeInt,
  saleConsumes,
} = require('./utils.js');

function applyEvent(schema, state, event, rng) {
  const type = event && event.id;
  const params = (event && event.params) || event || {};
  if (type === 'day_end') {
    const result = runDayEnd(schema, state, rng);
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
    case 'gain_resource':
      return gainResource(schema, next, params, rng, ok, fail);
    case 'resource_delta':
      return resourceDelta(next, params, ok, fail);
    case 'use_item':
      return useItem(schema, next, params, ok, fail);
    case 'buy_item':
      return buyItem(schema, next, params, ok, fail);
    case 'scale_delta':
      return scaleDelta(schema, next, params, ok, fail);
    case 'rep_event':
      return repEvent(schema, next, params, rng, ok, fail);
    case 'exp_gain':
      return expGain(schema, next, params, rng, ok, fail);
    case 'checkin':
      return checkin(schema, next, params, ok, fail);
    case 'checkout':
      return checkout(next, params, ok, fail);
    case 'sale':
      return sale(schema, next, params, ok, fail);
    case 'purchase':
      return purchase(schema, next, params, ok, fail);
    case 'hire':
      return hire(schema, next, params, ok, fail);
    case 'fire':
      return fire(next, params, ok, fail);
    case 'traffic_wave': {
      const result = resolveTrafficWave(schema, next, params.wave);
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
    case 'start_encounter':
      return startEncounter(schema, next, params, rng, ok, fail);
    case 'combat_action':
      return combatAction(schema, next, params, rng, ok, fail);
    case 'enemy_action':
      return enemyAction(schema, next, params, rng, ok, fail);
    case 'enemy_turn':
      return enemyTurn(schema, next, params, rng, ok, fail);
    case 'end_encounter':
      return endEncounter(schema, next, params, rng, ok, fail);
    default:
      return fail('unknown_event', `Unknown event id: ${type}`);
  }
}

function useItem(schema, state, params, ok, fail) {
  if (Object.entries(params).some(([key, value]) => key !== 'itemId' && (['amount', 'heal', 'hp', 'mp', 'sp'].includes(key) || (value !== '' && Number.isFinite(Number(value)))))) return fail('item_number_not_allowed');
  const itemId = params.itemId;
  const item = (schema.resources || []).find((resource) => resource.id === itemId && resource.effect);
  if (!item) return fail('unknown_item', itemId);
  const count = Number((state.resources && state.resources[itemId]) || 0);
  if (count < 1) return fail('out_of_stock', itemId);
  if (state.player && state.player.dead) return fail('player_dead');
  const pool = state.player && state.player.pools && state.player.pools[item.effect.pool];
  if (!pool) return fail('no_pool', item.effect.pool);
  const before = Number(pool.cur);
  if (before >= Number(pool.max)) return fail('pool_full', item.effect.pool);
  const healed = poolHeal(pool, item.effect.amount);
  state.player.pools[item.effect.pool] = healed;
  state.resources[itemId] = count - 1;
  return ok({ itemId, pool: item.effect.pool, amount: healed.cur - before, before, after: healed.cur, remaining: state.resources[itemId] });
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
  const quest = (schema.quests || []).find((entry) => entry && entry.id === questId);
  if (!quest) return fail('unknown_quest', questId);
  if (!quest.repeatable && (state.claimedRewards || []).includes(questId)) return fail('already_claimed', questId);
  const range = schema && schema.rewards && schema.rewards.gold && schema.rewards.gold[quest.rewardTier];
  if (!isRewardRange(range)) return fail('unknown_reward_tier', quest.rewardTier);

  const check = Object.assign({}, quest.check);
  if (check.mode === 'dc' && check.stat) {
    check.mod = Number((state.player && state.player[check.stat]) ?? (state.player && state.player.stats && state.player.stats[check.stat]) ?? 0);
  }
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

function gainResource(schema, state, params, rng, ok, fail) {
  const resource = params.resource || params.resourceId;
  if (!resource || !(state.resources && resource in state.resources)) return fail('unknown_resource', resource);

  const table = (schema && schema.gather) || {};
  const requestedScale = params.scale || 'small';
  const scale = table[requestedScale] ? requestedScale : 'small';
  const range = table[scale];
  if (!isRewardRange(range)) return fail('unknown_gather_scale', scale);

  const qty = rng.int(range[0], range[1]);
  const before = Number(state.resources[resource] || 0);
  state.resources[resource] = before + qty;
  return ok({ resource, qty, scale, before, after: state.resources[resource], reason: params.reason || '' });
}

function resourceDelta(state, params, ok, fail) {
  const resource = params.resource || params.resourceId;
  const amount = normalizeInt(params.amount);
  if (!resource || !(state.resources && resource in state.resources)) return fail('unknown_resource', resource);
  const before = Number(state.resources[resource] || 0);
  state.resources[resource] = Math.max(0, before + amount);
  return ok({ resource, amount, before, after: state.resources[resource], reason: params.reason || '' });
}

function scaleDelta(schema, state, params, ok, fail) {
  const scaleId = params.scale || 'affinity';
  const target = params.target || params.npcId;
  const scale = scaleById(schema, scaleId);
  if (!scale) return fail('unknown_scale', scaleId);
  if (!target || !state.npcs || !state.npcs[target]) return fail('unknown_target', target);

  const counterKey = `${scaleId}DeltaToday`;
  const cap = Number(scale.dailyCapPerTarget || scale.dailyCap || 0);
  const used = Number(state.npcs[target][counterKey] || 0);
  const before = Number(state.npcs[target][scaleId] || scale.default || 0);
  if (cap && used >= cap) {
    return ok({ scale: scaleId, target, before, after: before, delta: 0, capped: true, reason: params.reason || '' });
  }

  const size = params.size || 'S';
  const direction = params.direction === '-' ? '-' : '+';
  const key = direction === '-' ? `${size}-` : size;
  const base = Number(scale.steps && scale.steps[key]);
  if (!Number.isFinite(base)) return fail('unknown_scale_step', key);
  const bonusLimit = Math.abs(Number(scale.charBonus || 0));
  const charBonus = clamp(normalizeInt(params.charBonus, 0), -bonusLimit, bonusLimit);
  const rawDelta = base + charBonus;
  const range = scale.range || [0, 200];
  const after = clamp(before + rawDelta, Number(range[0]), Number(range[1]));
  const fromTier = tierOf(schema, scaleId, before);
  const toTier = tierOf(schema, scaleId, after);

  state.npcs[target][scaleId] = after;
  state.npcs[target][counterKey] = used + 1;

  const entry = { scale: scaleId, target, before, after, delta: after - before, size, direction, charBonus, reason: params.reason || '' };
  if ((fromTier && fromTier.label) !== (toTier && toTier.label)) {
    entry.tierChanged = { from: fromTier || null, to: toTier || null };
  }
  return ok(entry);
}

function repEvent(schema, state, params, rng, ok, fail) {
  const ladder = ladderById(schema, 'reputation');
  const axis = params.axis;
  const category = params.category;
  if (!ladder || !ladder.axes.includes(axis)) return fail('unknown_reputation_axis', axis);
  const table = ladder.categories && ladder.categories[axis];
  const range = table && table[category];
  if (!range) return fail('unknown_reputation_category', `${axis}:${category}`);
  const delta = Array.isArray(range) ? rng.int(range[0], range[1]) : Number(range);
  const current = state.reputation[axis] || { rank: 'E', exp: 0 };
  const before = { rank: current.rank, exp: current.exp };
  let rank = current.rank;
  let exp = Number(current.exp || 0) + delta;
  let changed = null;

  if (delta >= 0) {
    const idx = rankIndex(ladder, rank);
    const next = (ladder.ranks || [])[idx];
    if (next && next.next != null && exp >= Number(next.next)) {
      const promoted = (ladder.ranks || [])[idx + 1];
      if (promoted) {
        changed = { from: rank, to: promoted.id, type: 'promote' };
        rank = promoted.id;
        exp = 0;
      }
    }
  } else {
    while (exp < 0) {
      const idx = rankIndex(ladder, rank);
      if (idx <= 0) {
        rank = (ladder.floor && ladder.floor.rank) || 'E';
        exp = Number((ladder.floor && ladder.floor.exp) || 0);
        break;
      }
      const previous = (ladder.ranks || [])[idx - 1];
      const previousThreshold = Number(previous.next || 0);
      changed = { from: rank, to: previous.id, type: 'demote' };
      rank = previous.id;
      exp = previousThreshold + exp;
    }
  }

  state.reputation[axis] = { rank, exp };
  return ok({ axis, category, delta, before, after: state.reputation[axis], rankChanged: changed, reason: params.reason || '' });
}

function expGain(schema, state, params, rng, ok, fail) {
  const ladder = ladderById(schema, 'player_level');
  if (!ladder) return fail('missing_player_level_ladder');
  const source = ladder.sources && ladder.sources[params.category];
  if (!source) return fail('unknown_exp_category', params.category);
  const amount = Array.isArray(source) ? rng.int(source[0], source[1]) : Number(source.value == null ? source : source.value);
  const before = { level: state.player.level, exp: state.player.exp };
  state.player.exp = Number(state.player.exp || 0) + amount;
  const levelUps = [];
  while (state.player.level <= (ladder.thresholds || []).length) {
    const threshold = Number(ladder.thresholds[state.player.level - 1]);
    if (!threshold || state.player.exp < threshold) break;
    state.player.exp -= threshold;
    state.player.level += 1;
    levelUps.push(state.player.level);
  }
  return ok({ category: params.category, amount, before, after: clone(state.player), levelUps, reason: params.reason || '' });
}

function checkin(schema, state, params, ok, fail) {
  const roomNo = String(params.roomNo);
  const room = findRoom(schema, roomNo);
  const stayDays = normalizeInt(params.stayDays, 1);
  const guestName = params.guestName;
  if (!room) return fail('unknown_room', roomNo);
  if (!guestName) return fail('missing_guestName');
  if (stayDays <= 0) return fail('invalid_stayDays', stayDays);
  if (Number(room.requiresRoomLevel || 1) > Number((state.facilities && state.facilities.room) || 1)) return fail('room_locked', roomNo);
  const current = state.rooms[roomNo] || [];
  if (room.capacity != null && current.length >= Number(room.capacity)) return fail('room_full', roomNo);
  const price = Number(room.pricePerNight || 0) * stayDays;
  state.rooms[roomNo] = current.concat([{ guestName, nightsLeft: stayDays }]);
  state.gold += price;
  return ok({ roomNo, guestName, stayDays, goldDelta: price });
}

function checkout(state, params, ok, fail) {
  const roomNo = String(params.roomNo);
  const guestName = params.guestName;
  const current = state.rooms[roomNo] || [];
  const idx = current.findIndex((guest) => guest.guestName === guestName);
  if (idx < 0) return fail('guest_not_found', `${roomNo}:${guestName}`);
  const remaining = current.slice(0, idx).concat(current.slice(idx + 1));
  if (remaining.length) state.rooms[roomNo] = remaining;
  else delete state.rooms[roomNo];
  return ok({ roomNo, guestName });
}

function sale(schema, state, params, ok, fail) {
  const menu = findMenu(schema, params.menuName);
  const qty = normalizeInt(params.qty, 1);
  if (!menu) return fail('unknown_menu', params.menuName);
  if (menuTrade(menu) !== 'sell') return fail('menu_not_sellable', params.menuName);
  if (qty <= 0 || qty > 999) return fail('invalid_qty', qty); // 상한 999 — 가격 0 아이템·consumes 없는 메뉴의 무제한 수량 악용 방지(감사 지적)
  if (Number(menu.requiresKitchenLevel || 1) > Number((state.facilities && state.facilities.kitchen) || 1)) return fail('menu_locked', params.menuName);
  const consumes = saleConsumes(menu, state);
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

function buyItem(schema, state, params, ok, fail) {
  if (Object.keys(params).some((key) => !['menuName', 'qty'].includes(key))) return fail('item_number_not_allowed');
  const menu = findMenu(schema, params.menuName);
  if (!menu) return fail('unknown_menu', params.menuName);
  if (menuTrade(menu) !== 'buy') return fail('menu_not_buyable', params.menuName);
  const qty = normalizeInt(params.qty, 1);
  if (qty <= 0 || qty > 999) return fail('invalid_qty', qty); // 상한 999 — 가격 0 아이템·consumes 없는 메뉴의 무제한 수량 악용 방지(감사 지적)
  const cost = Number(menu.price || 0) * qty;
  if (Number(state.gold || 0) < cost) return fail('insufficient_gold', params.menuName);
  state.gold = Number(state.gold || 0) - cost;
  if (!state.items || typeof state.items !== 'object') state.items = {};
  state.items[menu.name] = Number(state.items[menu.name] || 0) + qty;
  return ok({ menuName: menu.name, qty, goldDelta: -cost, owned: state.items[menu.name] });
}

function purchase(schema, state, params, ok, fail) {
  const resource = params.resource || params.resourceId;
  const qty = normalizeInt(params.qty, 1);
  const def = (schema.resources || []).find((entry) => entry.id === resource);
  if (!def || resource === 'gold') return fail('unknown_resource', resource);
  if (qty <= 0 || qty > 999) return fail('invalid_qty', qty); // 상한 999 — 가격 0 아이템·consumes 없는 메뉴의 무제한 수량 악용 방지(감사 지적)
  const cost = Number(def.basePrice || 0) * qty;
  if (state.gold < cost) return fail('insufficient_gold', resource);
  state.gold -= cost;
  state.resources[resource] = Number(state.resources[resource] || 0) + qty;
  return ok({ resource, qty, goldDelta: -cost });
}

function hire(schema, state, params, ok, fail) {
  const npcId = params.npcId;
  const wage = normalizeInt(params.dailyWage);
  if (!findById(schema, 'npc', npcId)) return fail('unknown_npc', npcId);
  if ((state.staff || []).some((staff) => staff.npcId === npcId)) return fail('already_hired', npcId);
  if ((state.staff || []).length >= staffMax(schema, state)) return fail('staff_full', npcId);
  state.staff = (state.staff || []).concat([{ npcId, dailyWage: wage }]);
  return ok({ npcId, dailyWage: wage });
}

function fire(state, params, ok, fail) {
  const npcId = params.npcId;
  const before = state.staff || [];
  if (!before.some((staff) => staff.npcId === npcId)) return fail('not_hired', npcId);
  state.staff = before.filter((staff) => staff.npcId !== npcId);
  return ok({ npcId });
}

module.exports = { applyEvent };
