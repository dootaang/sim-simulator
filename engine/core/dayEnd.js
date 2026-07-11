'use strict';

const { clone, formulaById, findMenu, entityList } = require('./utils.js');
const { availableMenu, rankWeight } = require('./selectors.js');
const { poolHeal } = require('./pools.js');

function runDayEnd(schema, state, rng) {
  const next = clone(state);
  const report = {
    day: state.day,
    customers: 0,
    sales: [],
    grossGold: 0,
    foodUsed: 0,
    drinkUsed: 0,
    turnedAway: 0,
    wagesDue: 0,
    wagesPaid: 0,
    unpaidWagesPaid: 0,
    unpaidWagesAdded: 0,
    unpaidWagesBefore: Number(state.unpaidWages || 0),
    unpaidWagesAfter: Number(state.unpaidWages || 0),
    checkouts: [],
  };

  settleRevenue(schema, next, rng, report);
  deductWages(next, report);
  checkoutDue(next, report);
  runSettlement(schema, next, rng, report);
  advanceDay(next);
  return { state: next, report };
}

function runSettlement(schema, state, rng, report) {
  if (!Array.isArray(schema.settlement)) return;
  report.settlement = [];
  for (const step of schema.settlement) {
    if (!step) continue;
    if (step.type === 'facility_yield') runFacilityYield(schema, state, rng, report, step);
    else if (step.type === 'pool_recover') runPoolRecover(state, report, step);
    else if (step.type === 'upkeep') runUpkeep(state, report, step);
  }
}

function levelValue(perLevel, level) {
  if (!perLevel || typeof perLevel !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(perLevel, String(level))) return perLevel[String(level)];
  const key = Object.keys(perLevel).map(Number).filter((n) => Number.isFinite(n) && n <= level).sort((a, b) => b - a)[0];
  return key == null ? undefined : perLevel[String(key)];
}

function runFacilityYield(schema, state, rng, report, step) {
  const level = Number((state.facilities && state.facilities[step.facility]) || 1);
  const value = levelValue(step.perLevel, level);
  const base = { type: step.type, facility: step.facility, level };
  if (value == null) return report.settlement.push({ ...base, skipped: 'no_level_entry' });
  const amount = Array.isArray(value) ? rng.int(value[0], value[1]) : Number(value);
  if (step.resource) {
    const declared = (schema.resources || []).some((resource) => resource && resource.id === step.resource);
    const existing = state.resources && Object.prototype.hasOwnProperty.call(state.resources, step.resource);
    if (!declared && !existing) return report.settlement.push({ ...base, resource: step.resource, skipped: 'unknown_resource' });
    if (!state.resources) state.resources = {};
    state.resources[step.resource] = Number(state.resources[step.resource] || 0) + amount;
    report.settlement.push({ ...base, resource: step.resource, amount });
  } else if (step.gold === true) {
    state.gold = Number(state.gold || 0) + amount;
    report.settlement.push({ ...base, gold: true, amount });
  }
}

function runPoolRecover(state, report, step) {
  const pools = state.player && state.player.pools;
  const results = [];
  for (const id of step.pools || []) {
    if (!pools || !pools[id]) continue;
    const before = Number(pools[id].cur || 0);
    const level = Number((state.facilities && state.facilities[step.facility]) || 1);
    const byLevel = levelValue(step.perLevel, level);
    const amount = byLevel != null ? Number(byLevel) : step.amount != null ? Number(step.amount) : Math.floor(Number(pools[id].max || 0) * Number(step.ratio || 0));
    pools[id] = poolHeal(pools[id], amount);
    results.push({ id, healed: pools[id].cur - before, cur: pools[id].cur, max: pools[id].max });
  }
  report.settlement.push({ type: step.type, pools: results });
}

function runUpkeep(state, report, step) {
  const gold = Number(step.gold || 0);
  const paid = Math.min(Number(state.gold || 0), gold);
  state.gold = Number(state.gold || 0) - paid;
  report.settlement.push({ type: step.type, gold, paid, shortfall: gold - paid });
}

function settleRevenue(schema, state, rng, report) {
  // Automatic settlement models the hours the player did not manually run:
  // stock-limited food/drink sales are the economy's main income channel.
  const daily = formulaById(schema, 'daily_revenue');
  const level = String((state.facilities && state.facilities.tavern) || 1);
  const baseline = daily && daily.baseline && daily.baseline[level];
  if (!baseline) return;

  const range = baseline.customers || [0, 0];
  const baseCustomers = rng.int(range[0], range[1]);
  const staffBonus = Math.min(0.25, (state.staff || []).length * 0.05);
  const repBonus = (rankWeight(schema, state, 'village') + rankWeight(schema, state, 'advent')) * 0.2;
  const customers = Math.min(Number(baseline.cap || baseCustomers), Math.max(0, Math.round(baseCustomers * (1 + staffBonus + repBonus))));
  report.customers = customers;

  const foodMenus = availableMenu(schema, state, '요리');
  const drinkMenus = availableMenu(schema, state, '주류');
  for (let i = 0; i < customers; i++) {
    const foodSold = sellRandomMenu(state, rng, foodMenus, 'food', report);
    const drinkSold = sellRandomMenu(state, rng, drinkMenus, 'drink', report);
    if (!foodSold || !drinkSold) report.turnedAway += 1;
  }
}

function sellRandomMenu(state, rng, menus, resource, report) {
  if (!menus.length || Number((state.resources && state.resources[resource]) || 0) <= 0) return false;
  const menu = menus[rng.int(0, menus.length - 1)];
  const consumes = Number((menu.consumes && menu.consumes[resource]) || 0);
  if (consumes <= 0) return false;
  if (Number(state.resources[resource] || 0) < consumes) return false;
  state.resources[resource] -= consumes;
  state.gold += Number(menu.price || 0);
  report.grossGold += Number(menu.price || 0);
  if (resource === 'food') report.foodUsed += consumes;
  if (resource === 'drink') report.drinkUsed += consumes;
  addSale(report.sales, menu.name, 1, Number(menu.price || 0));
  return true;
}

function addSale(sales, menuName, qty, price) {
  const existing = sales.find((row) => row.menuName === menuName);
  if (existing) {
    existing.qty += qty;
    existing.price += price;
  } else {
    sales.push({ menuName, qty, price });
  }
}

function deductWages(state, report) {
  repayUnpaidWages(state, report);
  const due = (state.staff || []).reduce((sum, staff) => sum + Number(staff.dailyWage || 0), 0);
  const paid = Math.min(Number(state.gold || 0), due);
  state.gold -= paid;
  state.unpaidWages = Number(state.unpaidWages || 0) + (due - paid);
  report.wagesDue = due;
  report.wagesPaid = paid;
  report.unpaidWagesAdded = due - paid;
  report.unpaidWagesAfter = Number(state.unpaidWages || 0);
}

function repayUnpaidWages(state, report) {
  const unpaid = Number(state.unpaidWages || 0);
  if (unpaid <= 0) return;
  const paid = Math.min(Number(state.gold || 0), unpaid);
  state.gold -= paid;
  state.unpaidWages = unpaid - paid;
  report.unpaidWagesPaid = paid;
}

function checkoutDue(state, report) {
  const out = {};
  const checkouts = [];
  for (const [roomNo, occupants] of Object.entries(state.rooms || {})) {
    const remaining = [];
    for (const guest of occupants || []) {
      const updated = { guestName: guest.guestName, nightsLeft: Number(guest.nightsLeft || 0) - 1 };
      if (updated.nightsLeft <= 0) checkouts.push({ roomNo, guestName: updated.guestName });
      else remaining.push(updated);
    }
    if (remaining.length) out[roomNo] = remaining;
  }
  state.rooms = out;
  state.pendingCheckouts = checkouts;
  report.checkouts = checkouts;
}

function advanceDay(state) {
  state.day = Number(state.day || 1) + 1;
  for (const npc of Object.values(state.npcs || {})) npc.affinityDeltaToday = 0;
}

module.exports = { runDayEnd, runSettlement };
