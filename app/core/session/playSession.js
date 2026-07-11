'use strict';

// S2 — 플레이 세션 저장 파일 포맷(내보내기/가져오기)과 검증.
// 원장(journal)의 손상 감지는 engine/core/sessionJournal.restoreSessionJournal이 담당하고,
// 이 계층은 파일 골격(대화·PromptRun 포함)의 형태 검증만 맡는다.
// 결정론 원칙: savedAt 등 시각은 호출자(UI)가 주입한다.

const PLAY_SESSION_CONTRACT = 'play-session/0.1';

function buildPlaySessionExport({ journal, messages, promptRuns, memory, personaBinding, promptPresetBinding, savedAt, title }) {
  if (!journal || journal.contract !== 'session-journal/0.1') throw new TypeError('play_session_journal_required');
  return {
    contract: PLAY_SESSION_CONTRACT,
    title: typeof title === 'string' ? title : '',
    savedAt: Number.isFinite(Number(savedAt)) ? Number(savedAt) : 0,
    journal,
    messages: sanitizeMessages(messages),
    promptRuns: sanitizePromptRuns(promptRuns),
    ...(sanitizeMemory(memory) ? { memory: sanitizeMemory(memory) } : {}),
    ...(sanitizePersonaBinding(personaBinding) ? { personaBinding: sanitizePersonaBinding(personaBinding) } : {}),
    ...(sanitizePromptPresetBinding(promptPresetBinding) ? { promptPresetBinding: sanitizePromptPresetBinding(promptPresetBinding) } : {}),
  };
}

function sanitizePersonaBinding(value) {
  if (!value || typeof value !== 'object' || typeof value.boundPersonaId !== 'string' || !value.snapshot) return null;
  const snapshot = value.snapshot;
  if (!snapshot || snapshot.contract !== 'persona/0.1' || typeof snapshot.id !== 'string' || typeof snapshot.name !== 'string' || typeof snapshot.prompt !== 'string') return null;
  return JSON.parse(JSON.stringify({ boundPersonaId: value.boundPersonaId, snapshot }));
}

function sanitizePromptPresetBinding(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.hash !== 'string' || !value.snapshot) return null;
  return JSON.parse(JSON.stringify({ id: value.id, version: Number.isInteger(value.version) ? value.version : 1, hash: value.hash, snapshot: value.snapshot }));
}

function sanitizeMemory(memory) {
  if (!memory || typeof memory !== 'object' || memory.contract !== 'continuity-memory/0.1' || !Array.isArray(memory.records)) return null;
  if (memory.records.length > 50000) throw new TypeError('play_session_too_large');
  return JSON.parse(JSON.stringify({
    contract: 'continuity-memory/0.1',
    nextId: Number.isInteger(memory.nextId) && memory.nextId > 0 ? memory.nextId : memory.records.length + 1,
    records: memory.records,
    nextPatchId: Number.isInteger(memory.nextPatchId) && memory.nextPatchId > 0 ? memory.nextPatchId : (Array.isArray(memory.patches) ? memory.patches.length + 1 : 1),
    patches: Array.isArray(memory.patches) ? memory.patches.slice(0, 50000) : [],
  }));
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message === 'object' && ['user', 'assistant', 'ledger'].includes(message.role))
    .map((message) => JSON.parse(JSON.stringify({
      role: message.role,
      content: String(message.content == null ? '' : message.content),
      ...(typeof message.id === 'string' && message.id.trim() ? { id: message.id.trim().slice(0, 120) } : {}),
      ...(typeof message.sceneId === 'string' && message.sceneId.trim() ? { sceneId: message.sceneId.trim().slice(0, 120) } : {}),
      ...(Array.isArray(message.chips) ? { chips: message.chips } : {}),
      ...(Array.isArray(message.npcIds) ? { npcIds: message.npcIds } : {}),
    })));
}

function sanitizePromptRuns(promptRuns) {
  if (!Array.isArray(promptRuns)) return [];
  return promptRuns
    .filter((run) => run && typeof run === 'object')
    .map((run, index) => JSON.parse(JSON.stringify({
      index: index + 1,
      promptHash: String(run.promptHash || ''),
      model: String(run.model || ''),
      responseText: String(run.responseText == null ? '' : run.responseText),
      proposedEvents: Array.isArray(run.proposedEvents) ? run.proposedEvents.map((id) => String(id)) : [],
      appliedOk: Number.isFinite(Number(run.appliedOk)) ? Number(run.appliedOk) : 0,
      ...(Array.isArray(run.blocks) ? { blocks: run.blocks.slice(0, 200).map((item) => ({ blockId: String(item && item.blockId || ''), active: item && item.active === true })) } : {}),
      ...(Array.isArray(run.proposedMemory) ? { proposedMemory: run.proposedMemory.slice(0, 20).map((item) => ({ kind: String(item && item.kind || ''), text: String(item && item.text || '').slice(0, 500) })) } : {}),
      ...(Array.isArray(run.memoryDecisions) ? { memoryDecisions: run.memoryDecisions.slice(0, 20).map((item) => ({ recordId: String(item && item.recordId || ''), status: String(item && item.status || ''), reason: String(item && item.reason || '') })) } : {}),
      ...(Array.isArray(run.factRefs) ? { factRefs: run.factRefs.slice(0, 20).map((item) => ({ claim: String(item && item.claim || '').slice(0, 300), refs: Array.isArray(item && item.refs) ? item.refs.slice(0, 12).map(String) : [] })) } : {}),
      ...(Array.isArray(run.factRefVerdicts) ? { factRefVerdicts: run.factRefVerdicts.slice(0, 20).map((item) => ({ claim: String(item && item.claim || '').slice(0, 300), refs: Array.isArray(item && item.refs) ? item.refs.slice(0, 12).map(String) : [], ok: item && item.ok === true, invalidRefs: Array.isArray(item && item.invalidRefs) ? item.invalidRefs.slice(0, 12).map(String) : [] })) } : {}),
      ...(run.proposedContinuityPatch && typeof run.proposedContinuityPatch === 'object' ? { proposedContinuityPatch: sanitizeContinuityPatch(run.proposedContinuityPatch) } : {}),
      ...(run.continuityPatchRecord && typeof run.continuityPatchRecord === 'object' ? { continuityPatchRecord: sanitizeContinuityPatchRecord(run.continuityPatchRecord) } : {}),
    })));
}

function sanitizeContinuityPatch(value) {
  return {
    confirmMemoryIds: Array.isArray(value.confirmMemoryIds) ? value.confirmMemoryIds.slice(0, 20).map(String) : [],
    resolveMemoryIds: Array.isArray(value.resolveMemoryIds) ? value.resolveMemoryIds.slice(0, 20).map(String) : [],
    reason: String(value.reason || '').slice(0, 300),
  };
}

function sanitizeContinuityPatchRecord(value) {
  return {
    id: String(value.id || ''),
    turn: Number.isInteger(value.turn) ? value.turn : 0,
    ...sanitizeContinuityPatch(value),
    status: ['pending', 'applied', 'rejected'].includes(value.status) ? value.status : 'pending',
  };
}

// 가져오기 1차 검증 — 구조가 맞으면 정제된 페이로드를 돌려준다.
// 원장 내용의 진위(해시·판정)는 이후 restoreSessionJournal이 검증한다.
// 가져오기 상한 — 거대 파일의 동기 재생으로 탭이 멈추는 Self-DoS 방지(감사 지적).
const MAX_IMPORT_CHARS = 30 * 1024 * 1024;
const MAX_IMPORT_EVENTS = 50000;

function parsePlaySessionImport(text) {
  const source = String(text);
  if (source.length > MAX_IMPORT_CHARS) throw new TypeError('play_session_too_large');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (_) {
    throw new TypeError('play_session_not_json');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.contract !== PLAY_SESSION_CONTRACT) {
    throw new TypeError('play_session_contract_mismatch');
  }
  if (!parsed.journal || parsed.journal.contract !== 'session-journal/0.1') {
    throw new TypeError('play_session_journal_missing');
  }
  if (Array.isArray(parsed.journal.events) && parsed.journal.events.length > MAX_IMPORT_EVENTS) {
    throw new TypeError('play_session_too_large');
  }
  return {
    contract: PLAY_SESSION_CONTRACT,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    savedAt: Number.isFinite(Number(parsed.savedAt)) ? Number(parsed.savedAt) : 0,
    journal: parsed.journal,
    messages: sanitizeMessages(parsed.messages),
    promptRuns: sanitizePromptRuns(parsed.promptRuns),
    ...(sanitizeMemory(parsed.memory) ? { memory: sanitizeMemory(parsed.memory) } : {}),
    ...(sanitizePersonaBinding(parsed.personaBinding) ? { personaBinding: sanitizePersonaBinding(parsed.personaBinding) } : {}),
    ...(sanitizePromptPresetBinding(parsed.promptPresetBinding) ? { promptPresetBinding: sanitizePromptPresetBinding(parsed.promptPresetBinding) } : {}),
  };
}

module.exports = { PLAY_SESSION_CONTRACT, buildPlaySessionExport, parsePlaySessionImport };
