'use strict';

const { entityList, findRoom, scaleById, ladderById, rankIndex } = require('./utils.js');

function staffMax(schema, state) {
  const level = String((state.facilities && state.facilities.quarters) || 1);
  const table = schema.gates && schema.gates.staffMaxByQuartersLevel;
  return Number((table && table[level]) || 0);
}

function availableMenu(schema, state, category) {
  const kitchen = Number((state.facilities && state.facilities.kitchen) || 1);
  return entityList(schema, 'menuItem').filter((item) => {
    if (category && item.category !== category) return false;
    return Number(item.requiresKitchenLevel || 1) <= kitchen;
  });
}

function roomStatus(schema, state) {
  return entityList(schema, 'room').map((room) => {
    const occupants = (state.rooms && state.rooms[String(room.no)]) || [];
    const capacity = room.capacity == null ? null : Number(room.capacity);
    return {
      no: String(room.no),
      kind: room.kind,
      pricePerNight: room.pricePerNight,
      capacity,
      requiresRoomLevel: room.requiresRoomLevel,
      locked: Number(room.requiresRoomLevel || 1) > Number((state.facilities && state.facilities.room) || 1),
      occupants,
      vacancies: capacity == null ? null : Math.max(0, capacity - occupants.length),
    };
  });
}

function tierOf(schema, scaleId, value) {
  const scale = scaleById(schema, scaleId);
  if (!scale) return null;
  const n = Number(value);
  return (scale.tiers || []).find((tier) => n >= tier.range[0] && n <= tier.range[1]) || null;
}

function summarize(schema, state) {
  const labels = reputationLabels(schema);
  const facilities = state.facilities || {};
  const resources = state.resources || {};
  const lines = [];
  lines.push(`[여관] ${state.day}일차 · 골드 ${formatNumber(state.gold)}원 · 식자재 ${resources.food || 0}인분 · 주류 ${resources.drink || 0}잔 · 시설 주점${facilities.tavern || 0}/주방${facilities.kitchen || 0}/객실${facilities.room || 0}/숙소${facilities.quarters || 0}`);

  const staff = (state.staff || []).map((item) => {
    const npc = entityList(schema, 'npc').find((entry) => entry.id === item.npcId);
    return `${(npc && npc.nameKo) || item.npcId}(일급 ${formatNumber(item.dailyWage)})`;
  });
  lines.push(`[직원] ${staff.length ? staff.join(', ') : '없음'}`);

  const occupied = [];
  for (const status of roomStatus(schema, state)) {
    for (const guest of status.occupants) occupied.push(`${status.no}호 ${guest.guestName}(${guest.nightsLeft}박 남음)`);
  }
  lines.push(`[객실] ${occupied.length ? occupied.join(' · ') + ' · 나머지 공실' : '전 객실 공실'}`);

  const repParts = Object.entries(state.reputation || {}).map(([axis, rep]) => `${labels[axis] || axis} ${rep.rank}(${rep.exp})`);
  lines.push(`[평판] ${repParts.join(' · ')}`);
  return lines.slice(0, 4).join('\n');
}

function npcSummary(schema, state, npcId) {
  const npc = entityList(schema, 'npc').find((entry) => entry.id === npcId);
  const data = state.npcs && state.npcs[npcId];
  if (!npc || !data) return '';
  const tier = tierOf(schema, 'affinity', data.affinity);
  const range = tier ? `${tier.range[0]}~${tier.range[1]}` : '?';
  const forbidden = tier && tier.forbidden && tier.forbidden.length ? `, 금지: ${tier.forbidden.join('/')}` : '';
  return `${npc.nameKo || npc.id}: 호감 ${data.affinity} — ${(tier && tier.label) || '미분류'}(${range})${forbidden}`;
}

function reputationLabels(schema) {
  const ladder = ladderById(schema, 'reputation');
  return (ladder && ladder.axisLabels) || {};
}

function rankWeight(schema, state, axis) {
  const ladder = ladderById(schema, 'reputation');
  if (!ladder || !state.reputation || !state.reputation[axis]) return 0;
  const idx = rankIndex(ladder, state.reputation[axis].rank);
  const max = Math.max(1, (ladder.ranks || []).length - 1);
  return idx < 0 ? 0 : idx / max;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

module.exports = { staffMax, availableMenu, roomStatus, tierOf, summarize, npcSummary, rankWeight };
