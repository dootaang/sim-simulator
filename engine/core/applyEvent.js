'use strict';

const { runDayEnd } = require('./dayEnd.js');
const { staffMax, tierOf } = require('./selectors.js');
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
    case 'resource_delta':
      return resourceDelta(next, params, ok, fail);
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
  if (qty <= 0) return fail('invalid_qty', qty);
  if (Number(menu.requiresKitchenLevel || 1) > Number((state.facilities && state.facilities.kitchen) || 1)) return fail('menu_locked', params.menuName);
  for (const [resource, amount] of Object.entries(menu.consumes || {})) {
    if (Number((state.resources && state.resources[resource]) || 0) < Number(amount) * qty) {
      return fail('insufficient_stock', resource);
    }
  }
  for (const [resource, amount] of Object.entries(menu.consumes || {})) {
    state.resources[resource] -= Number(amount) * qty;
  }
  const goldDelta = Number(menu.price || 0) * qty;
  state.gold += goldDelta;
  return ok({ menuName: menu.name, qty, goldDelta });
}

function purchase(schema, state, params, ok, fail) {
  const resource = params.resource || params.resourceId;
  const qty = normalizeInt(params.qty, 1);
  const def = (schema.resources || []).find((entry) => entry.id === resource);
  if (!def || resource === 'gold') return fail('unknown_resource', resource);
  if (qty <= 0) return fail('invalid_qty', qty);
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
