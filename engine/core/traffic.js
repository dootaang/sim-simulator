'use strict';

const { deriveRng } = require('./rng.js');
const { saleConsumes } = require('./utils.js');

function resolveTrafficWave(schema, state, waveId) {
  if (state.combat && state.combat.active) return { ok: false, reason: 'in_combat' };
  const traffic = schema && schema.traffic;
  if (!traffic) return { ok: false, reason: 'traffic_not_configured' };
  const wave = (traffic.waves || []).find((entry) => entry.id === waveId);
  if (!wave) return { ok: false, reason: 'unknown_wave', detail: waveId };
  const resolved = state.traffic && state.traffic.day === state.day ? { ...(state.traffic.resolved || {}) } : {};
  if (resolved[waveId]) return { ok: false, reason: 'wave_already_resolved', detail: waveId };

  const base = traffic.base || [];
  const rawLevel = Number((state.facilities && state.facilities[traffic.capacityFacility]) || 1);
  const level = Math.max(1, Math.min(base.length, Math.round(rawLevel)));
  const range = base[level - 1];
  const share = Number(wave.share);
  const rng = deriveRng(state.seed ?? 0, `traffic/${state.day}/${traffic.id}/${waveId}`);
  let potential = rng.int(Math.round(Number(range[0]) * share), Math.round(Number(range[1]) * share));
  let multiplier = 1;
  for (const modifier of traffic.modifiers || []) {
    if (modifier.type === 'ladder_rank') {
      const rank = state.reputation && state.reputation[modifier.axis] && state.reputation[modifier.axis].rank;
      multiplier *= 1 + Number(modifier.perRank || 0) * Math.max(0, ['E', 'D', 'C', 'B', 'A', 'S'].indexOf(rank));
    } else if (modifier.type === 'staff') {
      multiplier *= 1 + Math.min(Number(modifier.perStaff || 0) * (Array.isArray(state.staff) ? state.staff.length : 0), Number(modifier.max || 0));
    } else if (modifier.type === 'facility_level') {
      const modifierLevel = Number((state.facilities && state.facilities[modifier.facility]) || 1);
      multiplier *= 1 + Number(modifier.perLevel || 0) * (modifierLevel - 1);
    }
  }
  potential = Math.round(potential * multiplier);
  const cap = Math.round(Number(traffic.capacity[level - 1]) * share);
  const accepted = Math.min(potential, cap);
  const lostCapacity = potential - accepted;
  let served = 0;
  let revenue = 0;
  const sales = [];
  // sells 미지정/미존재 엔티티는 판매 풀이 빈 것으로 취급(크래시 금지 — 검증기 미경유 사용 대비).
  const sellsEntityType = traffic.sells && traffic.sells.entity;
  const entity = sellsEntityType ? (schema.entities || []).find((entry) => entry.type === sellsEntityType) : null;
  const instances = (entity && entity.instances) || [];
  const kitchenLevel = Number((state.facilities && state.facilities.kitchen) || 1);
  // sale 이벤트와 동일한 소비 규칙(saleConsumes) — consumes 없는 메뉴도 카테고리 최소 원가 강제(공짜 돈 방지).
  const canSell = (item) => Number(item.requiresKitchenLevel || 1) <= kitchenLevel
    && Object.entries(saleConsumes(item, state)).every(([id, qty]) => Number((state.resources && state.resources[id]) || 0) >= Number(qty));
  // 가격 0 이하/비수치는 가중치 1로 고정 — 1/sqrt가 Infinity/NaN이 되어 롤이 붕괴하는 것 방지.
  const weightOf = (item) => { const price = Number(item.price); return price > 0 ? 1 / Math.sqrt(price) : 1; };
  for (; served < accepted; served += 1) {
    const candidates = instances.filter(canSell);
    if (!candidates.length) break;
    const weights = candidates.map(weightOf);
    const target = rng.next() * weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = 0;
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i += 1) {
      cursor += weights[i];
      if (target < cursor) { chosen = candidates[i]; break; }
    }
    for (const [id, qty] of Object.entries(saleConsumes(chosen, state))) state.resources[id] = Math.max(0, Number(state.resources[id] || 0) - Number(qty));
    const price = Number(chosen.price || 0);
    state.gold = Number(state.gold || 0) + price;
    revenue += price;
    let sale = sales.find((entry) => entry.name === chosen.name);
    if (!sale) { sale = { name: chosen.name, qty: 0, subtotal: 0 }; sales.push(sale); }
    sale.qty += 1;
    sale.subtotal += price;
  }
  const lostStockout = accepted - served;
  resolved[waveId] = true;
  state.traffic = { day: state.day, resolved };
  // 놓친 추정 매출 = 놓친 손님 × 이번 파동 평균 객단가 (표기 전용 — gold에 더하지 않는다).
  const avgTicket = served > 0 ? Math.round(revenue / served) : 0;
  const entries = [{ ok: true, wave: waveId, label: wave.label, potential, customers: accepted, served, revenue, sales }];
  if (lostCapacity > 0) entries.push({ ok: true, kindHint: 'loss', lostCapacity, revenue_opportunity: lostCapacity * avgTicket, text: `만석으로 ${lostCapacity}명 돌려보냄` });
  if (lostStockout > 0) entries.push({ ok: true, kindHint: 'loss', lostStockout, revenue_opportunity: lostStockout * avgTicket, text: `재고 부족으로 ${lostStockout}명 놓침` });
  return { ok: true, entries };
}

// 26건 초과 시에도 알파벳 유지: A..Z, AA, AB… (엑셀 열 방식)
function guestSuffix(index) {
  let n = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return suffix;
}

function weightedPick(rng, items, weightOf) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(weightOf(item) || 0)), 0);
  let target = rng.next() * total;
  for (const item of items) {
    target -= Math.max(0, Number(weightOf(item) || 0));
    if (target < 0) return item;
  }
  return items[items.length - 1];
}

function generateLodgingQueue(schema, state) {
  if (state.combat && state.combat.active) return { ok: false, reason: 'in_combat' };
  const traffic = schema && schema.traffic;
  const lodging = traffic && traffic.lodging;
  if (!lodging) return { ok: false, reason: 'lodging_not_configured' };
  if (state.lodging && state.lodging.day === state.day && state.lodging.reviewed) return { ok: false, reason: 'already_reviewed' };
  const base = lodging.base || [];
  const roomLevel = Math.max(1, Math.min(base.length, Math.round(Number((state.facilities && state.facilities.room) || 1))));
  const range = base[roomLevel - 1] || [0, 0];
  const rankOrder = ['E', 'D', 'C', 'B', 'A', 'S'];
  const eligible = (lodging.segments || []).filter((segment) => {
    const requires = segment.requires || {};
    if (Number(requires.roomLevel || 1) > roomLevel) return false;
    if (!requires.ladderRank) return true;
    const requirement = requires.ladderRank;
    const current = state[requirement.ladder] && state[requirement.ladder][requirement.axis];
    const rank = current && typeof current === 'object' ? current.rank : current;
    // 미기록/알 수 없는 랭크는 최저 랭크 E로 간주 — 초기 상태에서 E 요구 세그먼트가 배제되지 않도록.
    const rankValue = Math.max(0, rankOrder.indexOf(rank));
    return rankValue >= rankOrder.indexOf(requirement.rank);
  });
  const rng = deriveRng(state.seed ?? 0, `lodging/${state.day}/${traffic.id}`);
  const count = rng.int(range[0], range[1]);
  const requests = [];
  for (let index = 0; index < count && eligible.length; index += 1) {
    const segment = weightedPick(rng, eligible, (item) => item.weight);
    // party/stay 결손 스키마 방어(검증기 미경유 사용 대비) — NaN 인원·NaN 숙박일 금지.
    const partyRange = Array.isArray(segment.party) && segment.party.length >= 2 ? segment.party : [1, 1];
    const party = Math.max(1, rng.int(Number(partyRange[0]) || 1, Number(partyRange[1]) || 1));
    const stays = Object.keys(segment.stay || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const stayDays = Number(weightedPick(rng, stays, (days) => segment.stay[String(days)])) || 1;
    const suffix = guestSuffix(index);
    requests.push({ id: `req_${state.day}_${index + 1}`, segment: segment.id, label: segment.label, name: `${segment.label} ${suffix}`, party, stayDays, status: 'pending' });
  }
  state.lodging = { day: state.day, reviewed: true, requests };
  return { ok: true, count: requests.length, requests };
}

function resolveLodgingDecision(schema, state, requestId, decision) {
  if (state.combat && state.combat.active) return { ok: false, reason: 'in_combat' };
  const request = state.lodging && state.lodging.day === state.day && (state.lodging.requests || []).find((item) => item.id === requestId);
  if (!request || request.status !== 'pending') return { ok: false, reason: 'request_not_pending', detail: requestId };
  if (decision === 'reject') {
    request.status = 'rejected';
    return { ok: true, name: request.name };
  }
  const lodging = schema.traffic && schema.traffic.lodging;
  const entity = lodging && (schema.entities || []).find((item) => item.type === lodging.roomsEntity);
  const roomLevel = Number((state.facilities && state.facilities.room) || 1);
  const candidates = ((entity && entity.instances) || []).map((room, index) => ({ room, index })).filter(({ room }) => {
    if (Number(room.requiresRoomLevel || 1) > roomLevel) return false;
    const occupied = (state.rooms && state.rooms[String(room.no)] || []).length;
    return room.capacity == null || Number(room.capacity) - occupied >= request.party;
  }).sort((a, b) => Number(a.room.pricePerNight || 0) - Number(b.room.pricePerNight || 0) || a.index - b.index);
  if (!candidates.length) return { ok: false, reason: 'no_room_available' };
  const room = candidates[0].room;
  const roomNo = String(room.no);
  const current = state.rooms[roomNo] || [];
  const occupants = [];
  // 투숙 정체성은 일차를 포함해 유일화 — 다른 날 같은 세그먼트/접미사 손님과 이름이 겹치면
  // 이름 기반 checkout이 엉뚱한 투숙객을 내보낸다(감사 지적).
  for (let k = 1; k <= request.party; k += 1) {
    const member = request.party > 1 ? ` ${k}번` : '';
    occupants.push({ guestName: `${state.day}일차 ${request.name}${member}`, nightsLeft: request.stayDays });
  }
  state.rooms[roomNo] = current.concat(occupants);
  const goldDelta = Number(room.pricePerNight || 0) * request.stayDays * request.party;
  state.gold = Number(state.gold || 0) + goldDelta;
  request.status = 'accepted';
  return { ok: true, name: request.name, roomNo, party: request.party, stayDays: request.stayDays, goldDelta };
}

module.exports = { resolveTrafficWave, generateLodgingQueue, resolveLodgingDecision };
