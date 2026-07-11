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

function menuTrade(menu) {
  return menu && menu.trade === 'buy' ? 'buy' : 'sell';
}

function availableManagement(schema, state) {
  if (state && state.combat && state.combat.active) return { sections: [] };
  const sections = [];
  if (schema.traffic) {
    const resolved = state.traffic && state.traffic.day === state.day ? state.traffic.resolved || {} : {};
    const section = { type: 'traffic', id: schema.traffic.id, waves: (schema.traffic.waves || []).map((wave) => ({ id: wave.id, label: wave.label, share: wave.share, resolved: !!resolved[wave.id] })) };
    if (schema.traffic.lodging) {
      const lodging = state.lodging && state.lodging.day === state.day ? state.lodging : null;
      section.lodging = { reviewed: !!(lodging && lodging.reviewed), pending: ((lodging && lodging.requests) || []).filter((item) => item.status === 'pending').map(({ id, label, name, party, stayDays }) => ({ id, label, name, party, stayDays })) };
    }
    sections.push(section);
  }
  const menus = availableMenu(schema, state);
  const sell = menus.filter((item) => menuTrade(item) === 'sell').map((item) => ({ name: item.name, price: Number(item.price || 0), category: item.category }));
  if (sell.length) sections.push({ type: 'sell', items: sell });
  const buy = menus.filter((item) => menuTrade(item) === 'buy').map((item) => ({ name: item.name, price: Number(item.price || 0), category: item.category, affordable: Number(state.gold || 0) >= Number(item.price || 0), owned: Number((state.items && state.items[item.name]) || 0) }));
  if (buy.length) sections.push({ type: 'buy', items: buy });
  const menuNames = new Set(entityList(schema, 'menuItem').map((item) => item.name));
  // label이 없는(undefined) 자원이 menuNames의 undefined와 오매칭돼 제외되지 않게 null 가드(감사 지적).
  const purchase = (schema.resources || []).filter((item) => item.id !== 'gold' && item.basePrice != null && !menuNames.has(item.id) && (item.label == null || !menuNames.has(item.label))).map((item) => ({ id: item.id, ...(item.label == null ? {} : { label: item.label }), basePrice: Number(item.basePrice), affordable: Number(state.gold || 0) >= Number(item.basePrice) }));
  if (purchase.length) sections.push({ type: 'purchase', items: purchase });
  const upgrade = entityList(schema, 'facility').map((item) => {
    const level = Number((state.facilities && state.facilities[item.id]) || 1); // 폴백 1 — upgrade 핸들러와 동일(감사 지적)
    const maxed = level >= Number(item.maxLevel || 0);
    const nextCost = maxed ? null : Number(item.upgradeCosts && item.upgradeCosts[String(level + 1)]);
    return { id: item.id, label: item.label || item.id, level, nextCost: Number.isFinite(nextCost) ? nextCost : null, affordable: !maxed && Number.isFinite(nextCost) && Number(state.gold || 0) >= nextCost, maxed };
  });
  if (upgrade.length) sections.push({ type: 'upgrade', items: upgrade });
  const gatherResources = Object.keys((state && state.resources) || {}).filter((id) => id !== 'gold'); // state null 가드(감사 지적)
  if (schema.gather && gatherResources.length) sections.push({ type: 'gather', resources: gatherResources, scales: ['small', 'large', 'bulk'].filter((id) => Array.isArray(schema.gather[id])).map((id) => ({ id, range: schema.gather[id].slice() })) });
  if (Array.isArray(schema.quests) && schema.quests.length) {
    const claimed = state.claimedRewards || [];
    const rewards = schema.rewards && schema.rewards.gold;
    const items = schema.quests.map((quest) => ({
      id: quest.id,
      name: quest.name || quest.id,
      chance: questChance(quest.check, state),
      reward: Array.isArray(rewards && rewards[quest.rewardTier]) ? rewards[quest.rewardTier].slice() : null,
      done: !quest.repeatable && claimed.includes(quest.id),
    }));
    sections.push({ type: 'quests', items });
  }
  if ((schema.processes || []).some((process) => process.trigger === 'dayEnd')) sections.push({ type: 'day_end' });
  return { sections };
}

function questChance(check, state) {
  if (check && check.mode === 'rate') return Math.max(0, Math.min(100, Number(check.rate) || 0));
  // resolveCheck의 intOr 의미와 정확히 일치시킨다 — `|| 기본값`은 정상 값 0을 왜곡해
  // 화면 확률과 실제 판정이 어긋난다(감사 지적: High).
  const sidesRaw = Math.trunc(Number(check && check.sides));
  const sides = Math.max(1, Number.isFinite(sidesRaw) ? sidesRaw : 20);
  const dcRaw = Math.trunc(Number(check && check.dc));
  const dc = Number.isFinite(dcRaw) ? dcRaw : 10;
  const stat = check && check.stat;
  const mod = stat ? Number((state.player && state.player[stat]) ?? (state.player && state.player.stats && state.player.stats[stat]) ?? 0) : 0;
  let successes = 0;
  for (let roll = 1; roll <= sides; roll += 1) if (roll + mod >= dc) successes += 1;
  return Math.round(successes / sides * 100);
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

function availableActions(schema, state) {
  const combat = state && state.combat;
  if (!combat || !combat.active || combat.cleared || combat.fled) return { active: false };
  const targets = (combat.enemies || []).filter((enemy) => !enemy.dead && Number(enemy.hp && enemy.hp.cur) > 0).map((enemy) => ({
    id: enemy.id,
    name: enemy.name,
    hp: { cur: Number(enemy.hp.cur), max: Number(enemy.hp.max) },
    dead: !!enemy.dead,
  }));
  const pools = (state.player && state.player.pools) || {};
  const skills = Object.entries((schema && schema.skills) || {}).map(([id, skill]) => {
    const pool = skill.pool || 'mp';
    const cost = Number(skill.cost || 0);
    return { type: 'skill', skill: id, name: skill.name || id, pool, cost, power: Number(skill.power || 0), affordable: Number((pools[pool] && pools[pool].cur) || 0) >= cost };
  });
  const fleeRate = schema && schema.combat && schema.combat.fleeRate;
  const items = usableItems(schema, state).map((item) => ({ type: 'item', itemId: item.id, label: item.label, pool: item.pool, amount: item.amount, count: item.count }));
  return { active: true, actions: [{ type: 'attack', targets }, ...skills, ...items, { type: 'defend' }, { type: 'flee', rate: fleeRate == null ? 50 : Number(fleeRate) }] };
}

function usableItems(schema, state) {
  return ((schema && schema.resources) || []).filter((resource) => resource && resource.effect && Number((state.resources && state.resources[resource.id]) || 0) >= 1).map((resource) => ({
    id: resource.id,
    label: resource.label || resource.id,
    pool: resource.effect.pool,
    amount: Number(resource.effect.amount),
    count: Number(state.resources[resource.id]),
  }));
}

function summarize(schema, state) {
  const labels = reputationLabels(schema);
  const facilities = state.facilities || {};
  const resources = state.resources || {};
  const lines = [];
  // 여관형 = 숙박(room)과 메뉴 판매(menuItem)를 둘 다 갖춘 스키마.
  // menuItem만 있는 카드(예: 헌터물의 마정석 판매)는 여관이 아니다.
  const types = new Set((schema.entities || []).map((entry) => entry.type));
  const innLike = types.has('menuItem') && types.has('room');
  if (innLike) {
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
  } else if (Number(state.gold || 0) !== 0 || Object.keys(resources).length > 0) {
    // 자원 수량도 함께 — 골드만 보이면 정산으로 불어난 자원이 상태에 안 나타난다(사용자 피드백).
    const resourceParts = Object.entries(resources).filter(([id]) => id !== 'gold').map(([id, qty]) => `${id} ${formatNumber(qty)}`);
    lines.push(`[자원] 골드 ${formatNumber(state.gold)}원${resourceParts.length ? ` · ${resourceParts.join(' · ')}` : ''}`);
  }
  if (!innLike) {
    const facilityItems = entityList(schema, 'facility');
    if (facilityItems.length) lines.push(`[시설] ${facilityItems.map((item) => `${item.label || item.id} Lv.${Number(facilities[item.id] || 1)}`).join(' · ')}`);
  }

  if (ladderById(schema, 'reputation')) {
    const repParts = Object.entries(state.reputation || {}).map(([axis, rep]) => `${labels[axis] || axis} ${rep.rank}(${rep.exp})`);
    lines.push(`[평판] ${repParts.join(' · ')}`);
  }

  const player = state.player || {};
  if (player.pools) {
    const pools = Object.entries(player.pools).map(([id, pool]) => {
      const value = pool || {};
      return `${String(id).toUpperCase()} ${value.cur}/${value.max}`;
    });
    const stats = [
      ['atk', '공'],
      ['def', '방'],
      ['evade', '회피'],
      ['acc', '명중'],
    ].filter(([id]) => player[id] != null).map(([id, label]) => `${label}${player[id]}`);
    lines.push(`[플레이어] Lv.${player.level} · EXP ${player.exp}${pools.length ? ` · ${pools.join(' · ')}` : ''}${stats.length ? ` · ${stats.join(' ')}` : ''}`);
  }

  const combat = state.combat;
  if (combat && combat.active) {
    const enemies = (combat.enemies || []).map((enemy) => {
      const hp = enemy.hp || {};
      return enemy.dead || Number(hp.cur) <= 0
        ? `${enemy.id} ${enemy.name}(전투불능)`
        : `${enemy.id} ${enemy.name}(HP ${hp.cur}/${hp.max}${combat.intents && combat.intents[enemy.id] === 'heavy' ? ' ⚠강공격' : ''})`;
    });
    lines.push(`[전투] ROUND ${combat.round} · ${enemies.join(' · ')}${combat.guard ? ' · 방어 중' : ''}`);
  }

  const items = Object.entries(state.items || {}).filter(([, qty]) => Number(qty) !== 0);
  if (items.length) lines.push(`[소지품] ${items.map(([name, qty]) => `${name} ×${qty}`).join(' · ')}`);

  return lines.join('\n');
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

module.exports = { staffMax, availableMenu, menuTrade, availableManagement, roomStatus, tierOf, usableItems, availableActions, summarize, npcSummary, rankWeight };
