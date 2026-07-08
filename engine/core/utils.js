'use strict';

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  return findEntity(schema, 'menuItem', (entry) => entry.name === menuName);
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
};
