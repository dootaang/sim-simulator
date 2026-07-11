'use strict';

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 판매 1건이 소비하는 재료(공짜 돈 방지). 스키마에 consumes가 없으면
// 카테고리로 추정(요리→food, 주류→drink 1개)해 최소 원가를 강제한다.
// sale 이벤트와 traffic_wave 영업이 같은 규칙을 공유한다(모듈 간 일관성).
function saleConsumes(menu, state) {
  const c = menu.consumes && Object.keys(menu.consumes).length ? menu.consumes : null;
  if (c) return c;
  const cat = String(menu.category || '');
  const res = state.resources || {};
  if (/주류|주점|술|drink|liquor/i.test(cat) && 'drink' in res) return { drink: 1 };
  if (/요리|음식|식사|food|cuisine|dish|meal/i.test(cat) && 'food' in res) return { food: 1 };
  if (/특수|special|재료|material/i.test(cat) && 'material' in res) return { material: 1 };
  return {};
}

function entityList(schema, type) {
  const block = (schema.entities || []).find((entry) => entry.type === type);
  return block && Array.isArray(block.instances) ? block.instances : [];
}

function findEntity(schema, type, predicate) {
  return entityList(schema, type).find(predicate) || null;
}

function findById(schema, type, id) {
  return findEntity(schema, type, (entry) => String(entry.id) === String(id));
}

function findRoom(schema, roomNo) {
  return findEntity(schema, 'room', (entry) => String(entry.no) === String(roomNo));
}

function findMenu(schema, menuName) {
  // 관대 매칭: 컴파일된 스키마의 메뉴명과 LLM이 부르는 이름이 공백·대소문자만
  // 다를 때 sale이 헛되이 실패하는 것을 막는다.
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  const target = norm(menuName);
  return findEntity(schema, 'menuItem', (entry) => entry.name === menuName)
      || findEntity(schema, 'menuItem', (entry) => norm(entry.name) === target);
}

function scaleById(schema, id) {
  return (schema.scales || []).find((scale) => scale.id === id) || null;
}

function ladderById(schema, id) {
  return (schema.ladders || []).find((ladder) => ladder.id === id) || null;
}

function formulaById(schema, id) {
  return (schema.formulas || []).find((formula) => formula.id === id) || null;
}

function rankIndex(ladder, rank) {
  return (ladder.ranks || []).findIndex((item) => item.id === rank);
}

function normalizeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

module.exports = {
  clone,
  clamp,
  entityList,
  findEntity,
  findById,
  findRoom,
  findMenu,
  scaleById,
  ladderById,
  formulaById,
  rankIndex,
  normalizeInt,
  saleConsumes,
};
