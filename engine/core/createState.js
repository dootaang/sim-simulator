'use strict';

const { clone, entityList, ladderById, scaleById } = require('./utils.js');
const { normalizePool } = require('./pools.js');

function createState(schema, seed) {
  const initial = clone(schema.initialState || {});
  const state = {
    day: Number(initial.day || 1),
    gold: Number(initial.gold || 0),
    resources: clone(initial.resources || {}),
    items: clone(initial.items || {}),
    facilities: clone(initial.facilities || {}),
    staff: Array.isArray(initial.staff) ? clone(initial.staff) : [],
    rooms: clone(initial.rooms || {}),
    player: normalizePlayer(schema, initial.player),
    reputation: normalizeReputation(schema, initial.reputation || {}),
    npcs: normalizeNpcs(schema, initial.npcs || {}),
    pendingCheckouts: [],
    unpaidWages: Number(initial.unpaidWages || 0),
    claimedRewards: Array.isArray(initial.claimedRewards) ? clone(initial.claimedRewards) : [],
    combat: null,
  };
  // Common modules are opt-in by schema section, preserving byte-identical
  // legacy state for cards that do not install those modules.
  if (schema.progression) state.player.statPoints = Number(initial.player && initial.player.statPoints || 0);
  if (schema.equipment) state.equipment = clone(initial.equipment || {});
  if (schema.rpgQuests) state.questProgress = clone(initial.questProgress || {});
  if (schema.party) state.party = clone(initial.party || { members: [], formation: {} });
  if (schema.time) state.clock = clone(initial.clock || { day: state.day, hour: Number(schema.time.startHour || 8), turn: 0 });
  if (schema.locations) state.location = initial.location || (schema.locations[0] && schema.locations[0].id) || null;
  if (schema.factions) state.factions = clone(initial.factions || {});
  if (schema.jobs) state.jobs = clone(initial.jobs || []);
  if (seed != null) state.seed = seed;
  return state;
}

// 스키마 pools(hp/mp/sp 등) 정의가 있으면 player.pools를 {cur,max}로 정규화.
function normalizePlayer(schema, initialPlayer) {
  const player = clone(initialPlayer || { level: 1, exp: 0 });
  const defs = Array.isArray(schema.pools) ? schema.pools : null;
  const src = player.pools && typeof player.pools === 'object' ? player.pools : null;
  if (defs || src) {
    const pools = {};
    const ids = defs ? defs.map((d) => d.id) : Object.keys(src || {});
    for (const id of ids) {
      const raw = (src && src[id]) != null ? src[id] : (defs && (defs.find((d) => d.id === id) || {}).max);
      pools[id] = normalizePool(raw);
    }
    player.pools = pools;
  }
  return player;
}

function normalizeReputation(schema, initial) {
  const ladder = ladderById(schema, 'reputation');
  const out = {};
  for (const axis of (ladder && ladder.axes) || []) {
    const value = initial[axis];
    if (value && typeof value === 'object') {
      out[axis] = { rank: value.rank || 'E', exp: Number(value.exp || 0) };
    } else {
      out[axis] = { rank: 'E', exp: Number(value || 0) };
    }
  }
  return out;
}

function normalizeNpcs(schema, initial) {
  const affinity = scaleById(schema, 'affinity');
  const defaultAffinity = affinity ? Number(affinity.default || 0) : 0;
  const out = {};
  for (const npc of entityList(schema, 'npc')) {
    const current = initial[npc.id] || {};
    out[npc.id] = {
      affinity: Number(current.affinity == null ? defaultAffinity : current.affinity),
      affinityDeltaToday: Number(current.affinityDeltaToday || 0),
    };
  }
  return out;
}

module.exports = { createState };
