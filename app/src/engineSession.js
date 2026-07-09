const defaultSchema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../../engine/core/createState.js');
const { applyEvent } = require('../../engine/core/applyEvent.js');
const { createRng } = require('../../engine/core/rng.js');

let activeSchema = defaultSchema;
let seedValue = 42;
let engineState = createState(activeSchema, seedValue);
let rng = createRng(seedValue);
let logs = [];
let eventCount = 0;

export const eventTypes = [
  'checkin',
  'checkout',
  'sale',
  'purchase',
  'hire',
  'fire',
  'scale_delta',
  'rep_event',
  'exp_gain',
  'reward',
  'gold_delta',
  'resource_delta',
  'day_end',
];

export function getSchema() {
  return activeSchema;
}

export function setActiveSchema(schema) {
  activeSchema = schema || defaultSchema;
  return resetSession(getSeed());
}

export function getEngineState() {
  return engineState;
}

export function getSeed() {
  return seedValue;
}

export function getLogs() {
  return logs;
}

export function getEventCount() {
  return eventCount;
}

export function resetSession(seed) {
  seedValue = Number.isFinite(Number(seed)) ? Number(seed) : 42;
  engineState = createState(activeSchema, seedValue);
  rng = createRng(seedValue);
  logs = [];
  eventCount = 0;
  return engineState;
}

export function runEvent(event) {
  const result = applyEvent(activeSchema, engineState, event, rng);
  if (result.log.some((entry) => entry.ok)) engineState = result.state;
  eventCount += 1;
  const item = { event, entries: result.log, index: logs.length + 1 };
  logs.unshift(item);
  return item;
}

export function summarizeEvent(type, entry, formatMoney) {
  if (entry.ok && type === 'reward') return `reward 쨌 ${entry.tier} 쨌 gold +${formatMoney(entry.goldDelta)}`;
  if (!entry.ok) return `${type} 실패: ${entry.reason || '알 수 없음'}${entry.detail ? ` (${entry.detail})` : ''}`;
  if (type === 'scale_delta') return entry.capped ? `${entry.target} capped · ${entry.before} -> ${entry.after}` : `${entry.target} ${entry.before} -> ${entry.after}`;
  if (type === 'rep_event') return `${entry.axis}/${entry.category} ${entry.before.rank}(${entry.before.exp}) -> ${entry.after.rank}(${entry.after.exp}), delta ${entry.delta}`;
  if (type === 'day_end') return `하루 마감 · ${entry.report.day}일차 정산`;
  if (type === 'sale') {
    const cost = entry.consumed ? Object.entries(entry.consumed).map(([r, n]) => ` · ${r} -${n}`).join('') : '';
    return `sale · ${entry.menuName || ''} · gold +${formatMoney(entry.goldDelta)}${cost}`;
  }
  if (entry.goldDelta != null) return `${type} · gold ${entry.goldDelta >= 0 ? '+' : ''}${formatMoney(entry.goldDelta)}`;
  return `${type} 실행`;
}
