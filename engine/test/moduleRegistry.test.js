'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ModuleRegistry } = require('../core/moduleRegistry.js');
const { applyEvent, getDefaultModuleRegistry, getRegisteredEventIds } = require('../core/applyEvent.js');
const { LEGACY_EVENT_IDS } = require('../core/modules/legacy.js');
const { createRng } = require('../core/rng.js');

test('a new module can handle a namespaced event without changing the central dispatcher', () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'test.counter',
    version: '1.0.0',
    events: {
      'test/increment': ({ state, params }) => ({
        state: { ...state, count: Number(state.count || 0) + Number(params.amount || 1) },
        log: [{ ok: true, event: 'test/increment' }],
      }),
    },
  });
  const before = Object.freeze({ count: 2 });
  const result = registry.dispatch({}, before, { id: 'test/increment', params: { amount: 3 } }, {});
  assert.equal(result.state.count, 5);
  assert.equal(before.count, 2);
  assert.equal(registry.eventOwner('test/increment'), 'test.counter');
});

test('registry rejects missing dependencies and duplicate ownership before changing routes', () => {
  const registry = new ModuleRegistry();
  assert.throws(() => registry.register({ id: 'needs.base', version: '1', dependencies: ['base'], events: {} }), /missing_module_dependency/);
  registry.register({ id: 'base', version: '1', events: { 'base/run': () => ({ state: {}, log: [] }) } });
  assert.throws(() => registry.register({ id: 'duplicate', version: '1', events: { 'base/run': () => ({ state: {}, log: [] }) } }), /duplicate_event/);
  assert.deepEqual(registry.listModules().map((module) => module.id), ['base']);
});

test('registry records state access and rejects duplicate exact owners', () => {
  const registry = new ModuleRegistry();
  registry.register({ id: 'wallet', version: '1', stateAccess: { owns: ['gold'], reads: ['day'], writes: [] } });
  assert.equal(registry.stateOwner('gold'), 'wallet');
  assert.throws(() => registry.register({ id: 'other', version: '1', stateAccess: { owns: ['gold'] } }), /duplicate_state_owner/);
  assert.deepEqual(registry.getModule('wallet').stateAccess, { owns: ['gold'], reads: ['day'], writes: [] });
});

test('unknown events preserve the old failure shape and original state object', () => {
  const state = Object.freeze({ marker: true });
  const registry = new ModuleRegistry();
  const result = registry.dispatch({}, state, { id: 'missing/event', params: {} }, {});
  assert.equal(result.state, state);
  assert.deepEqual(result.log, [{ ok: false, event: 'missing/event', reason: 'unknown_event', detail: 'Unknown event id: missing/event' }]);
  assert.deepEqual(applyEvent({}, state, { id: 'missing/event', params: {} }, {}).log, result.log);
});

test('default engine gives extracted features to their modules and leaves the rest in legacy', () => {
  const registry = getDefaultModuleRegistry();
  assert.deepEqual(registry.listModules().map((module) => module.id), ['core.stats', 'core.inventory', 'core.progression', 'core.equipment', 'rpg.quests', 'rpg.party', 'core.time', 'core.location', 'rpg.loot', 'rpg.shop', 'rpg.crafting', 'core.factions', 'core.jobs', 'combat.turnbased', 'legacy.monolith']);
  assert.equal(new Set(getRegisteredEventIds()).size, getRegisteredEventIds().length);
  for (const id of ['scale_delta', 'set_scale_mult', 'rep_event', 'exp_gain']) assert.equal(registry.eventOwner(id), 'core.stats');
  for (const id of ['gain_resource', 'resource_delta', 'use_item', 'buy_item', 'purchase', 'purchase_batch']) assert.equal(registry.eventOwner(id), 'core.inventory');
  for (const id of ['start_encounter', 'combat_action', 'enemy_action', 'enemy_turn', 'end_encounter']) assert.equal(registry.eventOwner(id), 'combat.turnbased');
  for (const id of LEGACY_EVENT_IDS) assert.equal(registry.eventOwner(id), 'legacy.monolith');
  assert.equal(registry.selectorOwner('stats/tier'), 'core.stats');
  assert.equal(registry.selectorOwner('inventory/usable-items'), 'core.inventory');
  assert.equal(registry.selectorOwner('combat/available-actions'), 'combat.turnbased');
});

test('selector and process routes use the same module boundary', () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'test.views',
    version: '1',
    selectors: { 'test/summary': (value) => `값 ${value}` },
    processes: { 'test/tick': (value) => value + 1 },
  });
  assert.equal(registry.select('test/summary', 4), '값 4');
  assert.equal(registry.runProcess('test/tick', 4), 5);
  assert.deepEqual(registry.selectorIds(), ['test/summary']);
  assert.deepEqual(registry.processIds(), ['test/tick']);
});

test('registry rolls back state mutations, rng use, exceptions, and malformed results', () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'test.unsafe', version: '1', events: {
      'test/fail': ({ state, rng }) => { state.gold = 0; rng.int(1, 100); return { state, log: [{ ok: false, event: 'test/fail', reason: 'nope' }] }; },
      'test/throw': ({ state, rng }) => { state.gold = 0; rng.int(1, 100); throw new Error('boom'); },
      'test/malformed': ({ state, rng }) => { state.gold = 0; rng.int(1, 100); return null; },
      'test/empty-log': ({ state, rng }) => { state.gold = 0; rng.int(1, 100); return { state, log: [] }; },
      'test/success': ({ state, rng }) => { state.gold += rng.int(1, 100); return { state, log: [{ ok: true, event: 'test/success' }] }; },
    },
  });
  for (const id of ['test/fail', 'test/throw', 'test/malformed', 'test/empty-log']) {
    const state = Object.freeze({ gold: 100 });
    const actualRng = createRng(77);
    const untouchedRng = createRng(77);
    const result = registry.dispatch({}, state, { id, params: {} }, actualRng);
    assert.equal(result.state, state);
    assert.equal(state.gold, 100);
    assert.equal(actualRng.int(1, 100), untouchedRng.int(1, 100));
    assert.equal(result.log[0].ok, false);
  }
  const successState = Object.freeze({ gold: 100 });
  const result = registry.dispatch({}, successState, { id: 'test/success', params: {} }, createRng(77));
  assert.equal(result.log[0].ok, true);
  assert.notEqual(result.state, successState);
  assert.ok(result.state.gold > 100);
});
