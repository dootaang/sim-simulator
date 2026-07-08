'use strict';

const { clone, entityList, ladderById, scaleById } = require('./utils.js');

function createState(schema, seed) {
  const initial = clone(schema.initialState || {});
  const state = {
    day: Number(initial.day || 1),
    gold: Number(initial.gold || 0),
    resources: clone(initial.resources || {}),
    facilities: clone(initial.facilities || {}),
    staff: Array.isArray(initial.staff) ? clone(initial.staff) : [],
    rooms: clone(initial.rooms || {}),
    player: clone(initial.player || { level: 1, exp: 0 }),
    reputation: normalizeReputation(schema, initial.reputation || {}),
    npcs: normalizeNpcs(schema, initial.npcs || {}),
    pendingCheckouts: [],
    unpaidWages: Number(initial.unpaidWages || 0),
  };
  if (seed != null) state.seed = seed;
  return state;
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
