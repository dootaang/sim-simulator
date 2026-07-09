'use strict';

const { clone, formulaById, findMenu, entityList } = require('./utils.js');
const { availableMenu, rankWeight } = require('./selectors.js');

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
  advanceDay(next);
  return { state: next, report };
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

module.exports = { runDayEnd };
