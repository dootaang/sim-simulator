'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../core/createState.js');
const { applyEvent } = require('../core/applyEvent.js');

function run(source, state, id, params, rng = { int() { throw new Error('unexpected rng use'); } }) {
  return applyEvent(source, state, { id, params }, rng);
}

test('set_scale_mult clamps, rounds, rejects invalid input, and consumes no RNG', () => {
  const state = createState(schema);
  let rngCalls = 0;
  const rng = { int() { rngCalls += 1; return 1; }, next() { rngCalls += 1; return 0; } };
  const low = run(schema, state, 'set_scale_mult', { scale: 'affinity', mult: 0.4 }, rng);
  assert.deepEqual(low.log[0], { ok: true, event: 'set_scale_mult', scale: 'affinity', before: 1, mult: 0.5 });
  const high = run(schema, low.state, 'set_scale_mult', { scale: 'affinity', mult: 3.54 }, rng);
  assert.equal(high.state.scaleMults.affinity, 3);
  assert.equal(high.log[0].before, 0.5);
  assert.equal(run(schema, state, 'set_scale_mult', { scale: 'missing', mult: 1 }, rng).log[0].reason, 'unknown_scale');
  assert.equal(run(schema, state, 'set_scale_mult', { scale: 'affinity', mult: 'nope' }, rng).log[0].reason, 'invalid_mult');
  assert.equal(rngCalls, 0);
});

test('scale_delta applies positive and negative multipliers with floor rounding', () => {
  let state = createState(schema);
  state.scaleMults = { affinity: 2 };
  let result = run(schema, state, 'scale_delta', { scale: 'affinity', target: 'silvia', size: 'S', direction: '+' });
  assert.equal(result.log[0].delta, 2);
  state = createState(schema); state.scaleMults = { affinity: 2 };
  result = run(schema, state, 'scale_delta', { scale: 'affinity', target: 'silvia', size: 'S', direction: '-' });
  assert.equal(result.log[0].delta, -4);
  state = createState(schema);
  result = run(schema, state, 'scale_delta', { scale: 'affinity', target: 'silvia', size: 'S', direction: '+' });
  assert.equal(result.log[0].delta, 1);
});

test('set_outfit records before and rejects unknown targets and out-of-range outfits without RNG', () => {
  const state = createState(schema);
  const first = run(schema, state, 'set_outfit', { npcId: 'silvia', outfit: 2 });
  assert.equal(first.state.npcs.silvia.outfit, 2);
  assert.equal(first.log[0].before, undefined);
  const second = run(schema, first.state, 'set_outfit', { npcId: 'silvia', outfit: 4 });
  assert.equal(second.log[0].before, 2);
  assert.equal(run(schema, state, 'set_outfit', { npcId: 'missing', outfit: 0 }).log[0].reason, 'unknown_target');
  assert.equal(run(schema, state, 'set_outfit', { npcId: 'silvia', outfit: 10 }).log[0].reason, 'invalid_outfit');
});

function incidentSchema(effect) {
  const source = JSON.parse(JSON.stringify(schema));
  source.traffic.incidents = { chance: 100, deck: [{
    id: 'affinity_event', label: '호감 사건', weight: 1,
    choices: [{ id: 'choose', label: '선택', effects: { affinity: effect } }],
  }] };
  return source;
}

function pendingState(source) {
  const state = createState(source, 7);
  state.pendingIncident = { day: state.day, waveId: 'lunch', incidentId: 'affinity_event' };
  return state;
}

test('incident affinity applies to all staff, respects caps, clamps range, and increments counters', () => {
  const source = incidentSchema({ size: 'L', direction: '+', target: 'staff' });
  const state = pendingState(source);
  state.staff = [{ npcId: 'silvia' }, { npcId: 'mierian' }];
  state.npcs.silvia.affinityDeltaToday = 1;
  state.npcs.mierian.affinity = 199;
  state.scaleMults = { affinity: 2 };
  const result = run(source, state, 'incident_choice', { choice: 'choose' });
  assert.deepEqual(result.log[0].affinityDeltas, { silvia: 0, mierian: 1 });
  assert.equal(result.state.npcs.silvia.affinityDeltaToday, 1);
  assert.equal(result.state.npcs.mierian.affinityDeltaToday, 1);
  assert.equal(result.state.npcs.mierian.affinity, 200);
});

test('incident affinity supports a direct target and negative steps without RNG', () => {
  const source = incidentSchema({ size: 'S', direction: '-', target: 'silvia' });
  const state = pendingState(source);
  state.scaleMults = { affinity: 2 };
  const result = run(source, state, 'incident_choice', { choice: 'choose' });
  assert.deepEqual(result.log[0].affinityDeltas, { silvia: -4 });
  assert.equal(result.state.npcs.silvia.affinity, 46);
  assert.equal(result.state.npcs.silvia.affinityDeltaToday, 1);
});

test('day_end resets daily delta counters for every stepped scale', () => {
  const source = JSON.parse(JSON.stringify(schema));
  source.scales.push({ id: 'lewd', owner: 'npc', range: [0, 200], default: 0, steps: { S: 1 } });
  const state = createState(source);
  for (const npc of Object.values(state.npcs)) {
    npc.affinityDeltaToday = 1;
    npc.lewdDeltaToday = 3;
  }
  const result = run(source, state, 'day_end', {} , { int: () => 1 });
  for (const npc of Object.values(result.state.npcs)) {
    assert.equal(npc.affinityDeltaToday, 0);
    assert.equal(npc.lewdDeltaToday, 0);
  }
});
