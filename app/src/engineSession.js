const defaultSchema = require('../../schema/yongsa-inn.v0.json');
const { getDefaultModuleRegistry, getRegisteredEventIds } = require('../../engine/core/applyEvent.js');
const { createSessionJournal, restoreSessionJournal, stateHash } = require('../../engine/core/sessionJournal.js');
const { buildPlaySessionExport } = require('../core/session/playSession.js');
import { createContinuityMemoryStore, formatGroundedMemory, restoreContinuityMemoryStore, validateFactReferences } from '../core/memory/continuityStore.ts';

let activeSchema = defaultSchema;
let seedValue = 42;
// S2: 세션의 단일 진실은 커널 원장 — 모든 이벤트(버튼·LLM·엔진 탭)가 runEvent 관문으로
// 원장에 기록되어 저장/이어하기·타임머신·손상 감지를 공짜로 얻는다.
let journal = createSessionJournal(activeSchema, seedValue);
let engineState = journal.state;
let logs = [];
let eventCount = 0;
let promptRuns = [];
let continuityMemory = createContinuityMemoryStore();

export function getEventTypes() {
  return getRegisteredEventIds();
}

export function selectEngine(id, ...args) {
  return getDefaultModuleRegistry().select(id, ...args);
}

// 버튼 전용 인텐트 — LLM 어휘에 노출하지 않으며(prompt.js), LLM 자유 텍스트 응답의
// events 배열로 흉내 내도 플레이 화면이 실행하지 않는다(감사 지적: 치트 채널 차단).
export const buttonOnlyEvents = new Set([
  'traffic_wave',
  'incident_choice',
  'lodging_review',
  'lodging_accept',
  'lodging_reject',
  'mail_check',
  'mail_open',
  'purchase_batch',
  'set_scale_mult',
  'set_outfit',
]);

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

// 세션 세대 번호 — 스키마 승인·엔진 리셋마다 증가한다. 플레이 화면이 카드 파일이 같아도
// 세션이 갈렸음을 감지해 대화·무대 등 UI 상태를 함께 리셋하는 근거(감사 지적: 시간선 오염).
let sessionEpoch = 0;

export function getSessionEpoch() {
  return sessionEpoch;
}

export function resetSession(seed) {
  seedValue = Number.isFinite(Number(seed)) ? Number(seed) : 42;
  journal = createSessionJournal(activeSchema, seedValue);
  engineState = journal.state;
  logs = [];
  eventCount = 0;
  promptRuns = [];
  continuityMemory = createContinuityMemoryStore();
  sessionEpoch += 1;
  return engineState;
}

export function runEvent(event) {
  const { entries } = journal.append(event);
  engineState = journal.state;
  eventCount += 1;
  const item = { event, entries, index: eventCount };
  logs.unshift(item);
  return item;
}

// ── S2: 세션 저장/이어하기 ─────────────────────────────────────────────

export function recordPromptRun(run) {
  promptRuns.push(run);
  // 수백 턴에서 응답 원문 누적으로 메모리가 선형 증가 — 최근 500건만 유지(감사 지적).
  if (promptRuns.length > 500) promptRuns.splice(0, promptRuns.length - 500);
}

export function getPromptRuns() {
  return promptRuns;
}

export function ingestMemoryTurn(input) {
  return continuityMemory.ingestTurn(input);
}

export async function retrieveGroundedMemory(query, config) {
  const result = await continuityMemory.retrieve(query, config);
  return { ...result, text: formatGroundedMemory(result.plan, result.records) };
}

export function getMemoryRecords(status) {
  return continuityMemory.list(status);
}

export function approveMemory(recordId, turn) {
  return continuityMemory.approve(recordId, turn);
}

export function rejectMemory(recordId) {
  return continuityMemory.reject(recordId);
}

export function proposeContinuityPatch(patch, turn) {
  return continuityMemory.proposePatch(patch, turn);
}

export function getContinuityPatches(status) {
  return continuityMemory.listPatches(status);
}

export function applyContinuityPatch(patchId, turn) {
  return continuityMemory.applyPatch(patchId, turn);
}

export function rejectContinuityPatch(patchId) {
  return continuityMemory.rejectPatch(patchId);
}

export function validateMemoryFactRefs(factRefs, context) {
  return validateFactReferences(factRefs, context);
}

// 프롬프트 해시 — 원장과 같은 안정 직렬화+FNV(손상·중복 감지용, 보안용 아님).
export function hashPromptPayload(value) {
  return stateHash(value);
}

export function exportPlaySession({ messages, personaBinding, promptPresetBinding, savedAt, title } = {}) {
  return buildPlaySessionExport({ journal: journal.toJSON(), messages, promptRuns, memory: continuityMemory.toJSON(), personaBinding, promptPresetBinding, savedAt, title });
}

// 가져오기 — 스키마 지문·손상 검증은 restoreSessionJournal이 수행(불일치 시 throw).
// 성공 시 세션 epoch가 올라가므로 플레이 화면은 대화·무대를 함께 교체해야 한다.
export function importPlaySession(payload) {
  const restored = restoreSessionJournal(activeSchema, payload.journal);
  journal = restored;
  seedValue = Number(payload.journal.seed);
  engineState = journal.state;
  logs = [];
  eventCount = journal.length;
  promptRuns = Array.isArray(payload.promptRuns) ? payload.promptRuns.slice() : [];
  continuityMemory = payload.memory ? restoreContinuityMemoryStore(payload.memory) : createContinuityMemoryStore();
  continuityMemory.reconcileSources({
    messageIds: (payload.messages || []).map((message) => message && message.id).filter(Boolean),
    eventIndexes: ((payload.journal && payload.journal.events) || []).map((record) => record && record.index).filter(Number.isInteger),
    atTurn: (payload.messages || []).filter((message) => message && message.role === 'user').length,
  });
  sessionEpoch += 1;
  return engineState;
}

export function summarizeEvent(type, entry, formatMoney) {
  if (entry.ok && type === 'traffic_wave' && entry.skipped) return `${entry.label} 영업 건너뜀`;
  if (entry.ok && entry.awaitingChoice && entry.incident) return `⚠ ${entry.incident.label} 발생 — 대응을 선택하세요`;
  if (entry.ok && type === 'incident_choice' && entry.incidentId) {
    let text = `${entry.label} · ${entry.choiceLabel}${entry.goldDelta != null ? ` · ${entry.goldDelta >= 0 ? '+' : ''}${formatMoney(entry.goldDelta)}` : ''}`;
    for (const [npcId, delta] of Object.entries(entry.affinityDeltas || {})) text += ` · 호감 ${npcId} ${delta >= 0 ? '+' : ''}${delta}`;
    return text;
  }
  if (entry.ok && type === 'mail_check') return entry.arrived ? `편지 ${entry.arrived}통 도착` : '새 편지 없음';
  if (entry.ok && type === 'mail_open') return entry.type === 'reward'
    ? `${entry.axis} 감사 선물 개봉 · +${formatMoney(entry.goldDelta)}`
    : `${entry.axis} 의뢰 편지 개봉`;
  if (entry.ok && type === 'lodging_review') return `숙박 문의 ${entry.count}건 도착`;
  if (entry.ok && type === 'lodging_accept') return `${entry.name} 일행 ${entry.party}명 · ${entry.roomNo}호 ${entry.stayDays}박 · 선불 +${formatMoney(entry.goldDelta)}`;
  if (entry.ok && type === 'lodging_reject') return `${entry.name} 문의 거절`;
  if (entry.ok && type === 'traffic_wave' && entry.wave) return `${entry.label} · 손님 ${entry.customers}명 · 매출 +${formatMoney(entry.revenue)}`;
  if (entry.ok && type === 'traffic_wave' && entry.text) return entry.text;
  if (entry.ok && type === 'attempt_quest') return entry.success
    ? `⚖ ${entry.name} 🎲${entry.roll}${entry.tier === 'critical_success' ? ' 크리티컬' : ''} 성공 · +${formatMoney(entry.goldDelta)}`
    : `⚖ ${entry.name} 🎲${entry.roll} 실패`;
  if (entry.ok && type === 'buy_item') return `🛒 ${entry.menuName} ×${entry.qty} · -${formatMoney(-entry.goldDelta)} (보유 ${entry.owned})`;
  if (entry.ok && type === 'purchase_batch') return `재료 일괄 구매 ${entry.items.length}종 · -${formatMoney(-entry.goldDelta)}`;
  if (entry.ok && type === 'set_wage') return `${entry.npcId} 일급 ${formatMoney(entry.before)}→${formatMoney(entry.dailyWage)}`;
  if (entry.ok && type === 'set_scale_mult') return `⚖ ${entry.scale} 배율 ×${entry.mult}`;
  if (entry.ok && type === 'set_outfit') return `👗 ${entry.npcId} 의상 변경`;
  if (entry.ok && type === 'use_item') {
    const def = ((activeSchema && activeSchema.resources) || []).find((resource) => resource.id === entry.itemId);
    return `🧪 ${(def && def.label) || entry.itemId} · ${String(entry.pool).toUpperCase()} +${entry.amount} (남은 ${entry.remaining})`;
  }
  if (entry.ok && type === 'reward') return `reward · ${entry.tier} · gold +${formatMoney(entry.goldDelta)}`;
  if (entry.ok && type === 'upgrade') return `upgrade · ${entry.facility} Lv.${entry.level} · gold ${entry.goldDelta >= 0 ? '+' : ''}${formatMoney(entry.goldDelta)}`;
  if (entry.ok && type === 'gain_resource') return `gain · ${entry.resource} +${entry.qty} (${entry.scale})`;
  if (!entry.ok && type === 'attempt_quest' && entry.reason === 'already_attempted_today') return '⚖ 오늘 이미 처리한 의뢰 — 내일 게시판 갱신 후 가능';
  if (!entry.ok) return `${type} 실패: ${entry.reason || '알 수 없음'}${entry.detail ? ` (${entry.detail})` : ''}`;
  if (type === 'start_encounter') return `전투 시작 · 적 ${(entry.enemies || []).length}`;
  if (type === 'combat_action') {
    if (entry.action === 'defend') return '방어 태세';
    if (entry.action === 'flee') return `도주 ${entry.fled ? '성공' : '실패'} 🎲${entry.check.rand}`;
    return `${entry.skill || '공격'} · ${entry.target} 🎲${entry.roll} ${entry.hit ? (entry.tier === 'critical_success' ? '크리티컬' : '명중') : '빗나감'} · 피해 ${entry.damage}${entry.cleared ? ' · 전멸' : ''}`;
  }
  if (type === 'enemy_action') return `${entry.enemyId} 반격 · ${entry.hit ? `피해 ${entry.damage}` : '회피'}${entry.playerDead ? ' · 플레이어 전투불능' : ''}`;
  if (type === 'end_encounter') return `전투 종료(${entry.outcome}) · EXP +${entry.expGained} · 골드 +${formatMoney(entry.goldGained)}${entry.levelUps && entry.levelUps.length ? ` · Lv.${entry.levelUps.join(',')}` : ''}`;
  if (type === 'scale_delta') return entry.capped ? `${entry.target} capped · ${entry.before} -> ${entry.after}` : `${entry.target} ${entry.before} -> ${entry.after}`;
  if (type === 'rep_event') return `${entry.axis}/${entry.category} ${entry.before.rank}(${entry.before.exp}) -> ${entry.after.rank}(${entry.after.exp}), delta ${entry.delta}`;
  if (type === 'day_end') {
    let text = `하루 마감 · ${entry.report.day}일차 정산`;
    const healedByPool = {}; // 복수 스텝의 같은 풀 회복을 합산 표기(감사 지적: HP +10 · HP +20 중복 나열 방지)
    for (const step of entry.report.settlement || []) {
      if (step.amount != null && !step.skipped) text += ` · ${step.resource || (step.gold ? '골드' : '')} +${step.amount}`;
      else if (Array.isArray(step.pools)) for (const pool of step.pools) healedByPool[pool.id] = (healedByPool[pool.id] || 0) + Number(pool.healed || 0);
      else if (step.type === 'upkeep') text += ` · 유지비 -${step.paid}`;
    }
    // 0 회복(가득 찬 풀)은 표기 생략 — "HP +0" 노이즈가 서사로 오염됨(사용자 피드백).
    for (const [id, healed] of Object.entries(healedByPool)) if (healed > 0) text += ` · ${String(id).toUpperCase()} +${healed}`;
    return text;
  }
  if (type === 'sale') {
    const cost = entry.consumed ? Object.entries(entry.consumed).map(([r, n]) => ` · ${r} -${n}`).join('') : '';
    return `sale · ${entry.menuName || ''} · gold +${formatMoney(entry.goldDelta)}${cost}`;
  }
  if (entry.goldDelta != null) return `${type} · gold ${entry.goldDelta >= 0 ? '+' : ''}${formatMoney(entry.goldDelta)}`;
  return `${type} 실행`;
}

export function summarizeEventItem(type, entry, formatMoney) {
  return { text: summarizeEvent(type, entry, formatMoney), kind: eventKind(type, entry) };
}

function eventKind(type, entry) {
  if (!entry || !entry.ok) return 'system';
  if (['set_scale_mult', 'set_outfit'].includes(type)) return 'info';
  if (type === 'traffic_wave' && entry.skipped) return 'info';
  if (['start_encounter', 'combat_action', 'enemy_action', 'enemy_turn', 'end_encounter'].includes(type)) return 'combat';
  if (['use_item'].includes(type)) return 'pool';
  if (['attempt_quest'].includes(type)) return 'quest';
  if (['day_end'].includes(type)) return 'settlement';
  if (type === 'mail_open' && entry.type === 'reward') return 'resource';
  if ((type === 'incident_choice' || entry.awaitingChoice) && entry.goldDelta != null) return 'resource';
  if (type === 'incident_choice' || entry.awaitingChoice) return 'info';
  if (['traffic_wave', 'lodging_accept', 'buy_item', 'reward', 'upgrade', 'gain_resource', 'gold_delta', 'resource_delta', 'sale', 'purchase', 'purchase_batch', 'set_wage'].includes(type)) return 'resource';
  return 'info';
}
