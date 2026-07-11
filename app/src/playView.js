const { summarize, npcSummary, availableActions, availableManagement, roomStatus, staffMax } = require('../../engine/core/selectors.js');
const { estimateTokens, estimateLorebookTokens } = require('../core/lorebook/tokens.js');
const { buildPrompt, buildNarrationPrompt, parseAssistantResponse } = require('./llm/prompt.js');
const { resolveSpeaker, resolveSpeakerList } = require('./speakerResolver.js');
const { PROVIDERS, callProvider } = require('./llm/providers.js');
const { providerConfig, loadSettings, saveSettings, registerCustomOrigin, readKey, keyName, defaultModel } = require('./llm/byokSettings.js');
const { el, button, field, row, notice, hiddenBase, namedInput, namedTextarea, namedSelect, appendOption, copyFallback: fallbackCopy } = require('./ui/dom.js');
import { applyContinuityPatch, approveMemory, buttonOnlyEvents, exportPlaySession, getContinuityPatches, getEngineState, getEventCount, getMemoryRecords, getSchema, getSessionEpoch, hashPromptPayload, importPlaySession, ingestMemoryTurn, proposeContinuityPatch, recordPromptRun, rejectContinuityPatch, rejectMemory, retrieveGroundedMemory, runEvent, summarizeEvent, summarizeEventItem, validateMemoryFactRefs } from './engineSession.js';
const { parsePlaySessionImport } = require('../core/session/playSession.js');
import { buildNpcClusters, preferredEmotion, selectAsset } from './npcGallery.js';
import { verifyNarrative } from '../core/memory/narrativeVerifier.ts';
import { createBrowserPlaySessionPersistence } from '../core/session/browserPersistence.ts';
import { exportRisuPersonaPng, importRisuPersonaPng } from '../core/compat/personaPng.ts';
import { applyRegexStage, normalizeRegexScripts } from '../core/compat/regexPipeline.js';
import { importRisuPreset } from '../core/compat/risuPreset.ts';
import { createCompatibilityLibrary } from '../core/compat/browserLibrary.ts';

let messages = [];
let busy = false;
let settings = loadSettings();
let lastPrompt = null;
let selectedTarget = null;
let fastCombatLog = [];
let mobileSheetOpen = false;
let sheetKeyHandler = null;
let sheetWasOpen = false;
let activeRender = null;
let sessionCardKey = null;
let character = null;
let npcGroups = [];
let stage = [];
let mgmtConsoleOpen = false;
let lodgingSelection = new Set();
let lodgingSelectionDay = null;
let ledgerDeltas = [];
let purchaseDraft = {};
let messageSerial = 0;
let conversationTurn = 0;
let persistence = null;
let persistenceSchemaHash = '';
let persistenceReady = false;
let persistenceStatus = '자동 저장 준비 중';
let persistenceGeneration = 0;
let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;
let lastPersistHash = '';
let lastPersistQuickSignature = '';
let persistenceListenersInstalled = false;
let persistenceLoadKey = '';
let activePersona = null;
let activePromptPreset = null;
let compatibilityLibrary = null;
let compatibilityLibraryLoading = null;
let personaLibrary = [];
let presetLibrary = [];

function ensureCompatibilityLibrary(render) {
  if (compatibilityLibrary || compatibilityLibraryLoading) return;
  compatibilityLibraryLoading = createCompatibilityLibrary().then(async (library) => {
    compatibilityLibrary = library;
    [personaLibrary, presetLibrary] = await Promise.all([library.listPersonas(), library.listPresets()]);
  }).catch(() => {}).finally(() => { compatibilityLibraryLoading = null; render(); });
}

function compatibilityRegexScripts(ctx) {
  const parsed = ctx && ctx.parsed || {};
  const card = parsed.card || {};
  const data = card.data || card;
  const risu = data.extensions && data.extensions.risuai || {};
  const moduleRoot = parsed.module || card.module || (card.type === 'risuModule' ? card.module : {}) || {};
  return normalizeRegexScripts([
    { scope: 'character', scripts: Array.isArray(risu.customScripts) ? risu.customScripts : [] },
    { scope: 'embedded', scripts: Array.isArray(moduleRoot.regex) ? moduleRoot.regex : [] },
  ]).scripts;
}

function compatibilityCard(ctx) {
  const card = ctx && ctx.parsed && ctx.parsed.card || {};
  return card && typeof card === 'object' ? (card.data || card) : {};
}

function parseCompatibleResponse(raw, ctx) {
  const scripts = compatibilityRegexScripts(ctx);
  const output = applyRegexStage(String(raw || ''), scripts, 'editoutput');
  const parsed = parseAssistantResponse(output.text);
  parsed.narrative = applyRegexStage(parsed.narrative, scripts, 'editdisplay').text;
  return parsed;
}

async function callCompatibleProvider(config, prompt, ctx) {
  const scripts = compatibilityRegexScripts(ctx);
  const compatiblePrompt = {
    ...prompt,
    system: applyRegexStage(prompt.system || '', scripts, 'editrequest').text,
    messages: (prompt.messages || []).map((message) => ({ ...message, content: applyRegexStage(message.content || '', scripts, 'editrequest').text })),
  };
  const response = await callProvider(config, compatiblePrompt);
  const prefill = String(prompt.assistantPrefill || '');
  return prefill ? prefill + String(response || '') : response;
}

export function primaryCharacter(parsed, lore, groups = buildNpcClusters(parsed, lore).groups) {
  const name = String((parsed && parsed.name) || '시뮬봇');
  const exact = groups.find((group) => group.charId.toLowerCase() === name.toLowerCase());
  const group = exact || groups.slice().sort((a, b) => assetCount(b) - assetCount(a))[0] || null;
  const pick = group && selectAsset(group, preferredEmotion(group));
  return { name, group, asset: pick && pick.asset, emotion: group && preferredEmotion(group) };
}
function assetCount(group) { return Array.from(group.emotions.values()).reduce((sum, items) => sum + items.length, 0); }

function detachSheetKeyHandler() {
  if (sheetKeyHandler) { document.removeEventListener('keydown', sheetKeyHandler); sheetKeyHandler = null; }
}

// localStorage는 저장 차단 환경(프라이빗 모드 등)에서 SecurityError를 던질 수 있다 — 항상 가드 경유.
function lsGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
function lsRemove(key) { try { localStorage.removeItem(key); } catch (_) {} }

function applySessionPayload(payload, ctx) {
  importPlaySession(payload);
  messageSerial = 0;
  messages = payload.messages.map((message) => {
    messageSerial += 1;
    return message.id ? message : { ...message, id: `message-${getSessionEpoch()}-${String(messageSerial).padStart(6, '0')}` };
  });
  conversationTurn = messages.filter((message) => message.role === 'user').length;
  stage = []; lastPrompt = null; fastCombatLog = []; ledgerDeltas = []; purchaseDraft = {};
  lodgingSelection = new Set(); lodgingSelectionDay = null;
  sessionCardKey = cardKeyOf(ctx);
  activePersona = payload.personaBinding && payload.personaBinding.snapshot
    ? JSON.parse(JSON.stringify(payload.personaBinding.snapshot))
    : null;
  activePromptPreset = payload.promptPresetBinding && payload.promptPresetBinding.snapshot
    ? JSON.parse(JSON.stringify(payload.promptPresetBinding.snapshot))
    : null;
}

function currentPersonaBinding() {
  return activePersona ? { boundPersonaId: activePersona.id, snapshot: JSON.parse(JSON.stringify(activePersona)) } : null;
}

function buildCurrentSessionExport() {
  const promptPresetBinding = activePromptPreset ? {
    id: activePromptPreset.id,
    version: activePromptPreset.version,
    hash: hashPromptPayload(activePromptPreset),
    snapshot: JSON.parse(JSON.stringify(activePromptPreset)),
  } : null;
  return exportPlaySession({ messages, personaBinding: currentPersonaBinding(), promptPresetBinding, savedAt: Date.now(), title: sceneLine() });
}

function persistentPayloadHash(payload) {
  return hashPromptPayload({ journal: payload.journal, messages: payload.messages, promptRuns: payload.promptRuns, memory: payload.memory, personaBinding: payload.personaBinding, promptPresetBinding: payload.promptPresetBinding });
}

// Avoid cloning and hashing a multi-million-token session on UI-only renders.
// The compact signature changes for every durable engine/message/memory decision;
// the full canonical payload hash remains the final write guard below.
function persistentQuickSignature() {
  const lastMessage = messages[messages.length - 1] || null;
  const memoryStatus = getMemoryRecords().map((record) => `${record.id}:${record.status}:${record.lifecycle || ''}`);
  const patchStatus = getContinuityPatches().map((patch) => `${patch.id}:${patch.status}`);
  return hashPromptPayload({
    epoch: getSessionEpoch(),
    eventCount: getEventCount(),
    messageCount: messages.length,
    lastMessage: lastMessage && { id: lastMessage.id, role: lastMessage.role, content: lastMessage.content, chips: lastMessage.chips },
    memoryStatus,
    patchStatus,
    persona: activePersona && `${activePersona.id}:${activePersona.version}:${activePersona.name}:${activePersona.prompt}`,
    promptPreset: activePromptPreset && `${activePromptPreset.id}:${activePromptPreset.version}:${hashPromptPayload(activePromptPreset)}`,
  });
}

async function ensureAutoPersistence(ctx, render) {
  const schemaHash = hashPromptPayload(getSchema());
  const generation = ++persistenceGeneration;
  persistenceReady = false;
  persistenceStatus = '자동 저장소 연결 중';
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  try {
    if (!persistence || persistenceSchemaHash !== schemaHash) {
      const previous = persistence;
      persistence = null;
      if (previous) try { await previous.close(); } catch (_) {}
      persistence = await createBrowserPlaySessionPersistence();
      persistenceSchemaHash = schemaHash;
    }
    const latest = await persistence.getLatest(schemaHash);
    if (generation !== persistenceGeneration) return;
    if (latest && latest.payload) {
      const payload = parsePlaySessionImport(JSON.stringify(latest.payload));
      applySessionPayload(payload, ctx);
      lastPersistHash = persistentPayloadHash(payload);
      lastPersistQuickSignature = persistentQuickSignature();
      persistenceStatus = `자동 복구 완료 · ${persistence.health.backend}`;
    } else {
      lastPersistHash = '';
      lastPersistQuickSignature = '';
      persistenceStatus = `자동 저장 준비됨 · ${persistence.health.backend}`;
    }
    persistenceReady = true;
    render();
  } catch (error) {
    if (generation !== persistenceGeneration) return;
    persistenceStatus = `자동 저장 준비 실패 · ${safeError(error).replace(/^요청 실패:\s*/, '')}`;
    persistenceReady = false;
    persistenceLoadKey = '';
    render();
  }
}

function scheduleAutoSave(delay = 750) {
  if (!persistenceReady || !persistence || busy) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; void savePersistentSessionNow(); }, delay);
}

async function savePersistentSessionNow() {
  if (!persistenceReady || !persistence || busy) return;
  if (persistInFlight) { persistQueued = true; return; }
  persistInFlight = true;
  try {
    const quickSignature = persistentQuickSignature();
    if (quickSignature === lastPersistQuickSignature) return;
    const payload = buildCurrentSessionExport();
    const contentHash = persistentPayloadHash(payload);
    if (contentHash === lastPersistHash) {
      lastPersistQuickSignature = quickSignature;
      return;
    }
    await persistence.put({
      id: `play:${persistenceSchemaHash}`,
      schemaHash: persistenceSchemaHash,
      title: payload.title,
      updatedAt: payload.savedAt,
      payload,
    });
    lastPersistHash = contentHash;
    lastPersistQuickSignature = quickSignature;
    persistenceStatus = `자동 저장됨 · ${persistence.health.backend}`;
  } catch (error) {
    persistenceStatus = `자동 저장 실패 · ${safeError(error).replace(/^요청 실패:\s*/, '')}`;
  } finally {
    persistInFlight = false;
    if (persistQueued) { persistQueued = false; void savePersistentSessionNow(); }
  }
}

function installPersistenceListeners() {
  if (persistenceListenersInstalled || typeof window === 'undefined') return;
  persistenceListenersInstalled = true;
  window.addEventListener('pagehide', () => { void savePersistentSessionNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void savePersistentSessionNow(); });
}

// 비동기 콜백(LLM 응답 등)이 언마운트된 뷰의 DOM을 만지지 않도록, 항상 현재 마운트의 render만 실행한다.
function refresh() {
  if (activeRender) activeRender();
}

export function renderPlayView(container, ctx) {
  registerCustomOrigin(settings);
  // 카드가 바뀌면 이전 카드의 대화·전투 버퍼·busy 상태를 물려받지 않는다.
  // 카드가 같아도 스키마 승인·엔진 리셋(epoch 증가)이 있었으면 대화·무대 등 UI 상태를 함께 리셋 —
  // 1일차 엔진에 옛 대화가 남아 프롬프트 시간선이 오염되는 것 방지(감사 지적).
  const cardKey = cardKeyOf(ctx);
  if (sessionCardKey !== cardKey) {
    sessionCardKey = cardKey;
    messages = [];
    busy = false;
    lastPrompt = null;
    selectedTarget = null;
    fastCombatLog = [];
    mobileSheetOpen = false;
    sheetWasOpen = false;
    mgmtConsoleOpen = false;
    lodgingSelection = new Set();
    lodgingSelectionDay = null;
    ledgerDeltas = [];
    purchaseDraft = {};
    messageSerial = 0;
    conversationTurn = 0;
    stage = [];
    detachSheetKeyHandler();
    npcGroups = buildNpcClusters(ctx.parsed, ctx.lore).groups;
    character = primaryCharacter(ctx.parsed, ctx.lore, npcGroups);
    // 말풍선 아바타는 기본 표정으로 고정한다 — 감정 스왑은 히어로 헤더에만 반영.
    character.baseAsset = character.asset;
  }
  const root = el('div', 'play-view');
  container.append(root);
  const render = () => {
    root.replaceChildren();
    root.append(renderLayout(ctx, refresh));
    // 전체 재구축 시 스크롤이 top으로 튀는 것 방지: 채팅을 항상 최신(하단)으로.
    const list = root.querySelector('.play-message-list');
    if (list) list.scrollTop = list.scrollHeight;
    if (persistenceReady && !busy) scheduleAutoSave();
  };
  ensureCompatibilityLibrary(render);
  activeRender = render;
  const autoSaveKey = hashPromptPayload(getSchema());
  const needsPersistenceLoad = persistenceLoadKey !== autoSaveKey;
  if (needsPersistenceLoad) {
    persistenceReady = false;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistenceLoadKey = autoSaveKey;
  }
  render();
  if (needsPersistenceLoad) void ensureAutoPersistence(ctx, render);
  installPersistenceListeners();
  return () => {
    if (activeRender === render) activeRender = null;
    detachSheetKeyHandler();
    void savePersistentSessionNow();
    document.body.classList.remove('sheet-open');
  };
}

function renderLayout(ctx, render) {
  const layout = el('div', 'play-layout');
  layout.append(renderMobileHud(ctx, render), renderChat(ctx, render), renderSide(ctx, render), renderBottomSheet(ctx, render));
  return layout;
}

function renderMobileHud(ctx, render) {
  const hud = el('div', 'mobile-hud');
  const state = getEngineState();
  const schema = getSchema();
  if (!schema || !state) {
    const name = el('strong'); name.textContent = (ctx.parsed && ctx.parsed.name) || '시뮬봇'; hud.append(name);
  } else {
    const facts = el('div', 'mobile-hud-facts');
    if (Number.isFinite(Number(state.gold))) facts.append(hudFact(`골드 ${formatMoney(state.gold)}`));
    if (Number.isFinite(Number(state.day))) facts.append(hudFact(`${Number(state.day)}일차`));
    const hp = state.player && state.player.pools && state.player.pools.hp;
    if (hp) facts.append(compactGauge('HP', hp));
    const combat = state.combat;
    if (combat && combat.active) for (const enemy of combat.enemies || []) facts.append(compactGauge(enemy.name || '적', enemy.hp));
    if (!facts.childNodes.length) facts.append(hudFact((ctx.parsed && ctx.parsed.name) || '플레이'));
    hud.append(facts);
  }
  const open = button('상태', 'secondary-btn mobile-state-button');
  open.setAttribute('aria-expanded', String(mobileSheetOpen));
  open.setAttribute('aria-controls', 'playStateSheet');
  open.addEventListener('click', () => { mobileSheetOpen = true; render(); });
  hud.append(open);
  return hud;
}

function hudFact(text) { const node = el('span', 'mobile-hud-fact'); node.textContent = text; return node; }
function compactGauge(label, pool) { const node = el('span', 'mobile-mini-gauge'); node.append(hudFact(`${label} ${pool.cur}/${pool.max}`), combatGauge(label, pool, '')); return node; }

function renderBottomSheet(ctx, render) {
  const overlay = el('div', `play-sheet-overlay${mobileSheetOpen ? ' open' : ''}`);
  overlay.id = 'playStateSheet';
  overlay.setAttribute('aria-hidden', String(!mobileSheetOpen));
  const closeSheet = () => {
    detachSheetKeyHandler();
    mobileSheetOpen = false;
    document.body.classList.remove('sheet-open');
    render();
    // 모달 닫힘 후 포커스를 열었던 '상태' 버튼으로 복원.
    requestAnimationFrame(() => { const btn = document.querySelector('.mobile-state-button'); if (btn) btn.focus(); });
  };
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeSheet(); });
  const sheet = el('aside', 'play-bottom-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '플레이 상태와 설정');
  const head = el('div', 'sheet-head'); const handle = button('상태 패널 닫기', 'sheet-handle'); const close = button('닫기', 'secondary-btn');
  handle.addEventListener('click', closeSheet); close.addEventListener('click', closeSheet); head.append(handle, close);
  sheet.append(head, renderLedgerSection(render), renderMemorySection(render), renderSettings(ctx, render), renderStateBox(ctx, render), renderTokenBox(ctx)); overlay.append(sheet);
  detachSheetKeyHandler(); // 재렌더 시 이전 렌더의 리스너가 남지 않도록 항상 정리
  if (mobileSheetOpen) {
    document.body.classList.add('sheet-open');
    // 열리는 순간에만 초점 이동 — 시트 내 폼 조작으로 인한 재렌더에서 포커스를 빼앗지 않는다.
    if (!sheetWasOpen) requestAnimationFrame(() => close.focus());
    sheetKeyHandler = (event) => {
      if (event.key === 'Escape') { closeSheet(); return; }
      if (event.key !== 'Tab') return;
      // 포커스 트랩: 시트가 열려 있는 동안 Tab 초점을 시트 안에 가둔다.
      const focusables = Array.from(sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((node) => !node.disabled);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!sheet.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', sheetKeyHandler);
  } else document.body.classList.remove('sheet-open');
  sheetWasOpen = mobileSheetOpen;
  return overlay;
}

function renderChat(ctx, render) {
  const panel = el('section', 'play-chat-panel');
  const header = el('div', 'view-header play-chat-header');
  const title = el('div', 'play-hero');
  title.append(characterAvatar(ctx, character && character.asset, 'play-hero-avatar'));
  const identity = el('div', 'play-hero-copy');
  const h2 = el('h2');
  h2.textContent = (character && character.name) || '시뮬봇';
  const p = el('p');
  p.textContent = sceneLine();
  identity.append(h2, p); title.append(identity);
  const copy = button('대화 복사', 'secondary-btn');
  copy.disabled = !messages.length;
  copy.addEventListener('click', () => {
    const text = transcriptText();
    const done = () => { copy.textContent = '복사됨!'; setTimeout(() => { copy.textContent = '대화 복사'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  const clear = button('대화 초기화', 'secondary-btn');
  clear.disabled = busy; // 비동기 응답 대기 중 초기화하면 pending 참조가 끊긴다(감사 지적)
  clear.addEventListener('click', () => {
    if (busy) return;
    messages = [];
    ledgerDeltas = [];
    lastPrompt = null;
    fastCombatLog = [];
    stage = [];
    render();
  });
  const actions = el('div', 'engine-header-controls');
  actions.append(copy, clear);
  header.append(title, actions);

  const list = el('div', 'play-message-list');
  if (!messages.length) {
    const empty = el('div', 'play-empty');
    empty.textContent = 'mock 제공자로 키 없이 바로 테스트할 수 있습니다.';
    list.append(empty);
  } else {
    for (let index = 0; index < messages.length; index += 1) list.append(renderMessage(messages[index], ctx, index === 0 || messages[index - 1].role !== messages[index].role));
  }
  if (busy) {
    const thinking = el('div', 'play-message assistant');
    thinking.textContent = '생각 중...';
    list.append(thinking);
  }
  const form = el('form', 'play-input-row');
  const input = el('textarea', 'play-input');
  const decisionCard = renderDecisionCard(input, ctx, render);
  if (decisionCard) list.append(decisionCard);

  input.name = 'message';
  input.placeholder = '예: 고기 스튜 하나 팔자';
  input.disabled = busy;
  const send = button('전송', 'primary-btn');
  send.type = 'submit';
  send.disabled = busy;
  form.append(input, send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    await submitTurn(text, ctx, render);
  });

  const standing = renderStage(ctx);
  panel.append(header);
  if (standing) panel.append(standing);
  panel.append(list, renderCombatConsole(input, ctx, render), renderManagementConsole(input, ctx, render), form);
  return panel;
}

function renderDecisionCard(input, ctx, render) {
  const state = getEngineState();
  const descriptor = availableManagement(getSchema(), state);
  const traffic = descriptor.sections.find((section) => section.type === 'traffic');
  if (!traffic) return null;
  if (traffic.pendingIncident) {
    const incident = traffic.pendingIncident;
    const card = el('section', 'play-decision-card incident');
    const title = el('strong', 'play-decision-title'); title.textContent = `⚠ ${incident.label}`;
    const body = el('p'); body.textContent = incident.desc;
    const actions = el('div', 'play-decision-actions');
    for (const choice of incident.choices) {
      const control = button(choice.label, 'secondary-btn');
      control.disabled = busy;
      control.addEventListener('click', () => runManagementTurn({ id: 'incident_choice', params: { choice: choice.id } }, input, ctx, render));
      actions.append(control);
    }
    card.append(title, body, actions);
    return card;
  }
  const pending = traffic.lodging && traffic.lodging.pending || [];
  if (!pending.length) return null;
  const day = Number(state.day);
  if (lodgingSelectionDay !== day) { lodgingSelection = new Set(); lodgingSelectionDay = day; }
  const validIds = new Set(pending.map((request) => request.id));
  lodgingSelection = new Set(Array.from(lodgingSelection).filter((id) => validIds.has(id)));
  const card = el('section', 'play-decision-card lodging');
  const title = el('strong', 'play-decision-title'); title.textContent = `🛎 숙박 문의 ${pending.length}건`;
  const requests = el('div', 'play-decision-requests');
  for (const request of pending) {
    const rowNode = el('label', 'play-decision-request');
    const check = el('input'); check.type = 'checkbox'; check.checked = lodgingSelection.has(request.id); check.disabled = busy;
    check.addEventListener('change', () => { if (check.checked) lodgingSelection.add(request.id); else lodgingSelection.delete(request.id); render(); });
    const text = el('span'); text.textContent = `${request.name} · ${request.party}명 · ${request.stayDays}박`;
    rowNode.append(check, text); requests.append(rowNode);
  }
  const actions = el('div', 'play-decision-actions');
  const accept = button('선택한 문의 받기', 'primary-btn');
  accept.disabled = busy || !pending.some((request) => lodgingSelection.has(request.id));
  accept.addEventListener('click', () => runManagementBatch(pending.map((request) => ({
    event: { id: lodgingSelection.has(request.id) ? 'lodging_accept' : 'lodging_reject', params: { requestId: request.id } },
    requestName: request.name,
  })), input, ctx, render));
  const reject = button('전체 거절', 'secondary-btn'); reject.disabled = busy;
  reject.addEventListener('click', () => runManagementBatch(pending.map((request) => ({ event: { id: 'lodging_reject', params: { requestId: request.id } }, requestName: request.name })), input, ctx, render));
  actions.append(accept, reject); card.append(title, requests, actions);
  return card;
}

function renderMessage(message, ctx, showIdentity) {
  if (message.role === 'ledger') {
    const row = el('article', 'play-ledger-message');
    const chips = el('div', 'play-chip-row');
    for (const chip of message.chips || []) chips.append(renderChip(chip));
    row.append(chips);
    return row;
  }
  const wrap = el('article', `play-message ${message.role}`);
  const text = el('div', 'play-message-text');
  text.textContent = message.content;
  if (message.role === 'assistant' && (showIdentity || (message.npcIds && message.npcIds.length))) {
    const label = el('div', 'play-speaker');
    if (showIdentity) {
      label.append(characterAvatar(ctx, character && (character.baseAsset || character.asset), 'play-speaker-avatar'));
      const name = el('span'); name.textContent = (character && character.name) || '시뮬봇'; label.append(name);
    }
    if (message.npcIds && message.npcIds.length) label.append(renderNpcAvatars(message.npcIds, ctx));
    wrap.append(label);
  } else if (message.role === 'user' && showIdentity) { const label = el('div', 'play-speaker user-label'); label.textContent = '나'; wrap.append(label); }
  wrap.append(text);
  if (message.chips && message.chips.length) {
    const chips = el('div', 'play-chip-row');
    const visible = message.chips.length >= 4 ? message.chips.slice(0, 2) : message.chips;
    for (const chip of visible) chips.append(renderChip(chip));
    if (message.chips.length >= 4) {
      const more = el('details', 'play-chip-more');
      // 전체 재렌더에도 펼침 상태가 유지되도록 메시지 객체에 기억한다.
      more.open = !!message.chipsOpen;
      more.addEventListener('toggle', () => { message.chipsOpen = more.open; });
      const summary = el('summary'); summary.textContent = `결과 ${message.chips.length - 2}개 더 보기`;
      const hidden = el('div', 'play-chip-hidden');
      for (const chip of message.chips.slice(2)) hidden.append(renderChip(chip));
      more.append(summary, hidden); chips.append(more);
    }
    wrap.append(chips);
  }
  return wrap;
}

function renderChip(chip) {
  const kind = ['combat', 'resource', 'pool', 'quest', 'settlement', 'system', 'info'].includes(chip.kind) ? chip.kind : 'info';
  const item = el('span', `badge event-chip chip-${kind} ${chip.ok ? 'engine-ok' : 'engine-fail'}`);
  const icon = { combat: '⚔', resource: '💰', pool: '❤', quest: '📜', settlement: '🌙', system: '⚙', info: 'ℹ' }[kind];
  item.append(document.createTextNode(`${icon} `));
  const parts = String(chip.text).split(/([+-]\d[\d,]*(?:\.\d+)?|[^\s]+→[^\s]+)/g);
  for (const part of parts) {
    if (/^(?:[+-]\d[\d,]*(?:\.\d+)?|[^\s]+→[^\s]+)$/.test(part)) { const strong = el('strong'); strong.textContent = part; item.append(strong); }
    else item.append(document.createTextNode(part));
  }
  return item;
}

function characterAvatar(ctx, asset, className, initialName) {
  const wrap = el('div', className);
  const showInitial = () => {
    wrap.replaceChildren();
    wrap.classList.add('initial');
    wrap.textContent = (initialName || (character && character.name) || '시').trim().charAt(0).toUpperCase();
  };
  const url = asset ? ctx.objectUrlFor(asset) : '';
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', showInitial); // 깨진 에셋이면 엑박 대신 이니셜로.
    img.src = url;
    wrap.append(img);
  } else showInitial();
  return wrap;
}
function npcPresentation(schema, npcId, emotion) {
  return resolveSpeaker({
    schema,
    groups: npcGroups,
    state: getEngineState(),
    reference: npcId,
    requestedEmotion: emotion,
    preferEmotion: preferredEmotion,
    pickAsset: selectAsset,
  }) || { id: String(npcId), name: String(npcId), asset: null, group: null };
}
function applySpeakers(parsed) {
  stage = resolveSpeakerList({
    schema: getSchema() || {},
    groups: npcGroups,
    state: getEngineState(),
    items: parsed && parsed.speakers,
    preferEmotion: preferredEmotion,
    pickAsset: selectAsset,
  });
  return stage.map((item) => item.npcId);
}
function renderStage(ctx) {
  let entries = stage.map((item) => {
    const presentation = npcPresentation(getSchema() || {}, item.npcId, item.emotion);
    return presentation.asset && { name: presentation.name, asset: presentation.asset, focus: item.focus };
  }).filter(Boolean);
  if (!entries.length) {
    if (!character || !character.group || !character.asset) return null;
    entries = [{ name: character.name, asset: character.asset, focus: true }];
  }
  if (entries.length === 3) {
    const focused = entries.find((item) => item.focus);
    if (focused) { const others = entries.filter((item) => item !== focused); entries = [others[0], focused, others[1]]; }
  } else if (entries.length === 2) entries.sort((a, b) => Number(b.focus) - Number(a.focus));
  const section = el('section', 'play-stage');
  for (const entry of entries) {
    const url = ctx.objectUrlFor(entry.asset);
    if (!url) continue;
    const slot = el('figure', `play-stage-slot${entry.focus ? ' focus' : ''}`);
    const img = document.createElement('img');
    img.alt = entry.name;
    img.addEventListener('error', () => slot.remove());
    img.src = url;
    const caption = el('figcaption'); caption.textContent = entry.name;
    slot.append(img, caption); section.append(slot);
  }
  return section.childNodes.length ? section : null;
}
function renderNpcAvatars(npcIds, ctx) {
  const row = el('div', 'npc-avatar-row');
  const ids = Array.from(new Set(npcIds)).filter(Boolean);
  for (const id of ids.slice(0, 3)) {
    const npc = npcPresentation(getSchema(), id);
    const avatar = characterAvatar(ctx, npc.asset, 'npc-avatar', npc.name);
    avatar.title = npc.name;
    avatar.setAttribute('aria-label', npc.name);
    row.append(avatar);
  }
  if (ids.length > 3) { const more = el('span', 'npc-avatar-more'); more.textContent = `+${ids.length - 3}`; row.append(more); }
  return row;
}
function promptNpcIds(prompt) { return prompt && Array.isArray(prompt.relatedNpcIds) && prompt.relatedNpcIds.length ? [...prompt.relatedNpcIds] : undefined; }
function nextMessageId() { messageSerial += 1; return `message-${getSessionEpoch()}-${String(messageSerial).padStart(6, '0')}`; }
function userMessage(content) { return { id: nextMessageId(), role: 'user', content: String(content || ''), sceneId: currentSceneId() }; }
function assistantMessage(content, chips, prompt = lastPrompt, npcIdsOverride) {
  const message = { id: nextMessageId(), role: 'assistant', content, chips, sceneId: currentSceneId() };
  const npcIds = npcIdsOverride === undefined ? promptNpcIds(prompt) : npcIdsOverride;
  if (npcIds && npcIds.length) message.npcIds = npcIds;
  return message;
}
function sceneLine() { const schema = getSchema(), state = getEngineState(); if (!schema || !state) return '새로운 장면'; return summarize(schema, state).split('\n')[0] || '새로운 장면'; }
function currentSceneId() {
  const schema = getSchema() || {};
  const state = getEngineState() || {};
  const location = state.currentLocation || state.location || (state.player && state.player.location);
  const value = location && typeof location === 'object' ? (location.id || location.name) : location;
  return String(value || `${schema.meta && schema.meta.id || 'simulation'}:default`).slice(0, 120);
}
function entityAliases() {
  const out = {};
  for (const block of (getSchema() && getSchema().entities) || []) if (block.type === 'npc') {
    for (const npc of block.instances || []) out[npc.id] = [npc.id, npc.nameKo, npc.nameEn, ...(npc.aliases || [])].filter(Boolean);
  }
  return out;
}
async function groundedFor(query, turn) {
  return retrieveGroundedMemory(query, {
    atTurn: turn,
    sceneId: currentSceneId(),
    viewerScopes: ['public', 'user'],
    viewerEntityIds: ['user'],
    entityAliases: entityAliases(),
    topK: 8,
  });
}
function verifiedNarrative(parsed, prompt, evidenceEvents, chips, options = {}) {
  const evidenceTexts = [
    ...Object.values((prompt && prompt.injectedText) || {}).map(String),
    ...(evidenceEvents || []).map((event) => String(event.summary || '')),
    String(options.userText || ''),
  ];
  const result = verifyNarrative({
    narrative: (parsed && parsed.narrative) || '',
    evidenceTexts,
    hasFailedProposedEvent: options.blocked === true || (evidenceEvents || []).some((event) => !event.ok),
    fallback: options.fallback || '요청한 행동은 엔진 조건을 충족하지 못해 성립하지 않았습니다.',
  });
  if (result.issues.some((issue) => issue.code === 'unsupported-number')) chips.push({ ok: false, kind: 'system', text: '근거 없는 수치가 포함된 서사 문장을 숨겼습니다' });
  return result.text;
}
function emotions() { return character && character.group ? Array.from(character.group.emotions.keys()) : []; }
function speakerCatalog() {
  return npcGroups.map((group) => {
    const presentation = npcPresentation(getSchema() || {}, group.charId);
    return { npcId: presentation.id, name: presentation.name, emotions: Array.from(group.emotions.keys()) };
  });
}
function outfitOf(npcId) { const state = getEngineState(); return state && state.npcs && state.npcs[npcId] ? state.npcs[npcId].outfit : undefined; }
function cardKeyOf(ctx) { return `${ctx.file ? `${ctx.file.name}:${ctx.file.size}` : 'no-card'}#${getSessionEpoch()}`; }
// 모든 LLM 요청의 재현 기록(BACKLOG P1.5) — 프롬프트 해시·모델·응답·제안/적용 사건을 세션에 남긴다.
function promptRunOf(prompt, raw, parsed, appliedOk = 0, memoryDecisions = [], factRefVerdicts = [], continuityPatchRecord = null) {
  return {
    promptHash: hashPromptPayload({ system: prompt.system, messages: prompt.messages }),
    model: settings.model || settings.provider,
    responseText: String(raw == null ? '' : raw),
    blocks: (prompt.promptTrace || []).map((item) => ({ blockId: item.blockId, active: item.active })),
    proposedEvents: ((parsed && parsed.events) || []).map((event) => event.id),
    appliedOk,
    proposedMemory: ((parsed && parsed.memoryCandidates) || []).map((candidate) => ({ kind: candidate.kind, text: candidate.text })),
    memoryDecisions: memoryDecisions.map((decision) => ({ recordId: decision.recordId, status: decision.status, reason: decision.reason })),
    factRefs: (parsed && parsed.factRefs) || [],
    factRefVerdicts,
    ...(parsed && parsed.continuityPatch ? { proposedContinuityPatch: parsed.continuityPatch } : {}),
    ...(continuityPatchRecord ? { continuityPatchRecord } : {}),
  };
}
function applyEmotion(value) { if (!value || !character || !character.group || !character.group.emotions.has(value)) return; const pick = selectAsset(character.group, value, outfitOf(character.group.charId)); if (pick) { character.asset = pick.asset; character.emotion = value; } }

function renderSide(ctx, render) {
  const side = el('aside', 'play-side-panel');
  const hud = renderCombatHud();
  if (hud) side.append(hud);
  side.append(renderLedgerSection(render), renderMemorySection(render), renderSettings(ctx, render), renderStateBox(ctx, render), renderTokenBox(ctx));
  return side;
}

function renderMemorySection(render) {
  const section = titled('연속성 기억');
  const all = getMemoryRecords();
  const pending = all.filter((record) => record.status === 'candidate');
  const approved = all.filter((record) => record.status === 'approved');
  const pendingPatches = getContinuityPatches('pending');
  const summary = el('p', 'memory-summary');
  summary.textContent = `확정 ${approved.length} · 기억 후보 ${pending.length} · 상태 변경 ${pendingPatches.length}`;
  section.append(summary);
  if (!pending.length && !pendingPatches.length) {
    const empty = el('p', 'muted'); empty.textContent = '검토할 기억 후보가 없습니다.'; section.append(empty);
    return section;
  }
  if (pending.length) {
    const list = el('div', 'memory-review-list');
    for (const record of pending.slice(0, 8)) {
      const card = el('article', 'memory-review-card');
      const text = el('p'); text.textContent = record.text;
      const meta = el('small'); meta.textContent = `${record.kind} · ${record.knowledgeScope} · ${record.sceneId || '장면 미지정'}`;
      const actions = el('div', 'memory-review-actions');
      const accept = button('기억 승인', 'secondary');
      accept.addEventListener('click', () => { approveMemory(record.id, conversationTurn); render(); });
      const reject = button('버리기', 'ghost');
      reject.addEventListener('click', () => { rejectMemory(record.id); render(); });
      actions.append(accept, reject); card.append(text, meta, actions); list.append(card);
    }
    section.append(list);
  }
  for (const patch of pendingPatches.slice(0, 5)) {
    const card = el('article', 'memory-review-card');
    const text = el('p');
    text.textContent = `확정 제안 ${patch.confirmMemoryIds.join(', ') || '없음'} · 해결 제안 ${patch.resolveMemoryIds.join(', ') || '없음'}`;
    const meta = el('small'); meta.textContent = patch.reason || '이유 미제시';
    const actions = el('div', 'memory-review-actions');
    const accept = button('상태 변경 승인', 'secondary');
    accept.addEventListener('click', () => { applyContinuityPatch(patch.id, conversationTurn); render(); });
    const reject = button('거절', 'ghost');
    reject.addEventListener('click', () => { rejectContinuityPatch(patch.id); render(); });
    actions.append(accept, reject); card.append(text, meta, actions); section.append(card);
  }
  return section;
}

function renderCombatHud() {
  const state = getEngineState();
  const combat = state.combat;
  if (!combat || !combat.active) return null;
  const section = titled('전투 HUD');
  for (const enemy of combat.enemies || []) {
    const intent = combat.intents && combat.intents[enemy.id] === 'heavy' ? '⚠ 강공격 준비' : '';
    section.append(combatGauge(`${enemy.name}${enemy.rank ? ` · ${enemy.rank}` : ''}`, enemy.hp, enemy.dead ? '전투불능' : intent));
  }
  const pools = (state.player && state.player.pools) || {};
  for (const id of ['hp', 'mp', 'sp']) if (pools[id]) section.append(combatGauge(id.toUpperCase(), pools[id], ''));
  return section;
}

function combatGauge(label, pool, status) {
  const wrap = el('div', 'combat-gauge');
  const head = el('div', 'combat-gauge-head');
  head.textContent = `${label} · ${pool.cur}/${pool.max}${status ? ` · ${status}` : ''}`;
  const track = el('div', 'combat-gauge-track');
  const fill = el('div', 'combat-gauge-fill');
  const pct = Number(pool.max) > 0 ? Math.max(0, Math.min(100, Math.round(Number(pool.cur) / Number(pool.max) * 100))) : 0;
  fill.style.setProperty('--pct', `${pct}%`);
  track.append(fill);
  wrap.append(head, track);
  return wrap;
}

function renderCombatConsole(input, ctx, render) {
  const schema = getSchema();
  const state = getEngineState();
  const descriptor = availableActions(schema, state);
  const consoleBox = el('div', 'combat-console');
  if (state.combat && state.combat.active && state.player.dead) {
    const end = button('전투 종료 (패배)', 'primary-btn');
    end.disabled = busy;
    end.addEventListener('click', () => runCombatTurn({ id: 'end_encounter', params: {} }, input, ctx, render));
    consoleBox.append(end);
    return consoleBox;
  }
  if (state.combat && (state.combat.cleared || state.combat.fled)) {
    const end = button('전투 종료', 'primary-btn');
    end.disabled = busy;
    end.addEventListener('click', () => runCombatTurn({ id: 'end_encounter', params: {} }, input, ctx, render));
    consoleBox.append(end);
    return consoleBox;
  }
  if (!descriptor.active) {
    if ((schema.combat || schema.pools) && lsGet('simbot.play.manualCombat') === '1') {
      const start = button('⚔ 전투 개시', 'secondary-btn');
      start.disabled = busy;
      start.addEventListener('click', () => startCombat(ctx, render));
      consoleBox.append(start);
    }
    return consoleBox;
  }
  const attack = descriptor.actions.find((action) => action.type === 'attack');
  const targets = attack ? attack.targets : [];
  if (!targets.some((target) => target.id === selectedTarget)) selectedTarget = targets.length ? targets[0].id : null;
  const targetRow = el('div', 'combat-command-row');
  const targetLabel = el('span', 'combat-command-label');
  targetLabel.textContent = '대상';
  targetRow.append(targetLabel);
  for (const target of targets) {
    const choose = button(`${target.name} ${target.hp.cur}/${target.hp.max}`, selectedTarget === target.id ? 'primary-btn' : 'secondary-btn');
    choose.type = 'button';
    choose.disabled = busy;
    choose.addEventListener('click', () => { selectedTarget = target.id; render(); });
    targetRow.append(choose);
  }
  const commands = el('div', 'combat-command-row');
  const attackButton = button('⚔ 공격', 'secondary-btn');
  attackButton.disabled = busy || !selectedTarget;
  attackButton.addEventListener('click', () => runCombatTurn({ id: 'combat_action', params: { action: 'attack', target: selectedTarget } }, input, ctx, render));
  commands.append(attackButton);
  for (const action of descriptor.actions.filter((item) => item.type === 'skill')) {
    const skill = button(`${action.name} (${action.pool.toUpperCase()} ${action.cost})`, 'secondary-btn');
    skill.disabled = busy || !action.affordable || !selectedTarget;
    skill.addEventListener('click', () => runCombatTurn({ id: 'combat_action', params: { action: 'skill', target: selectedTarget, skill: action.skill } }, input, ctx, render));
    commands.append(skill);
  }
  for (const action of descriptor.actions.filter((item) => item.type === 'item')) {
    const item = button(`🧪 ${action.label} ×${action.count} (+${action.amount} ${action.pool.toUpperCase()})`, 'secondary-btn');
    item.disabled = busy;
    item.addEventListener('click', () => runCombatTurn({ id: 'use_item', params: { itemId: action.itemId } }, input, ctx, render));
    commands.append(item);
  }
  const defend = button('🛡 방어', 'secondary-btn');
  defend.disabled = busy;
  defend.addEventListener('click', () => runCombatTurn({ id: 'combat_action', params: { action: 'defend' } }, input, ctx, render));
  const flee = descriptor.actions.find((action) => action.type === 'flee');
  const fleeButton = button(`🏃 도주 ${flee.rate}%`, 'secondary-btn');
  fleeButton.disabled = busy;
  fleeButton.addEventListener('click', () => runCombatTurn({ id: 'combat_action', params: { action: 'flee' } }, input, ctx, render));
  commands.append(defend, fleeButton);
  consoleBox.append(targetRow, commands);
  return consoleBox;
}

function renderManagementConsole(input, ctx, render) {
  const schema = getSchema();
  const state = getEngineState();
  const descriptor = availableManagement(schema, state);
  const details = el('details', 'mgmt-console');
  const hasStaff = !!(state && Array.isArray(state.staff));
  if (!descriptor.sections.length && !hasStaff) return details;
  details.open = mgmtConsoleOpen;
  details.addEventListener('toggle', () => { mgmtConsoleOpen = details.open; });
  const summary = el('summary');
  summary.textContent = '⚔ 현장 행동';
  details.append(summary);
  if (hasStaff) {
    const group = el('div', 'mgmt-section staff-recruit-action');
    const max = staffMax(schema, state);
    const recruit = button(state.staff.length < max ? '👥 직원 모집' : '직원 숙소 증축 필요', 'secondary-btn');
    recruit.disabled = busy || state.staff.length >= max;
    recruit.addEventListener('click', () => openCannedScene('여관에 있는 인물 중 고용 후보와의 자연스러운 협상 장면을 열어라. 임금 합의가 대화로 완료되기 전에는 hire 사건을 내지 마라.', ctx, render));
    group.append(recruit);
    details.append(group);
  }
  for (const section of descriptor.sections) {
    if (['sell', 'buy', 'purchase', 'upgrade'].includes(section.type)) continue;
    const group = el('div', 'mgmt-section');
    const label = el('span', 'combat-command-label');
    const trafficDay = Number(getEngineState().day);
    label.textContent = section.type === 'traffic' ? (Number.isFinite(trafficDay) ? `🏪 ${trafficDay}일차 영업` : '🏪 영업') : ({ sell: '판매', buy: '구매', purchase: '재료 구매', upgrade: '증축', gather: '채집 (무료 · 획득량은 주사위)', day_end: '하루' })[section.type] || section.type;
    group.append(label);
    if (section.type === 'traffic') {
      const trafficState = getEngineState().traffic;
      const resolved = trafficState && trafficState.day === getEngineState().day ? trafficState.resolved || {} : {};
      const firstPending = section.waves.find((wave) => !wave.resolved);
      for (const wave of section.waves) {
        const skipped = resolved[wave.id] === 'skipped';
        const control = button(skipped ? `― ${wave.label} 건너뜀` : wave.resolved ? `✓ ${wave.label} 완료` : `${wave.label} 진행`, 'secondary-btn');
        // 사건 대기 중엔 모든 파동 정지 — 대응부터 선택해야 영업이 이어진다.
        control.disabled = busy || wave.resolved || firstPending !== wave || !!section.pendingIncident;
        control.addEventListener('click', () => runManagementTurn({ id: 'traffic_wave', params: { wave: wave.id } }, input, ctx, render));
        group.append(control);
        if (!wave.resolved) {
          const skip = button('건너뛰기', 'secondary-btn');
          skip.disabled = busy || firstPending !== wave || !!section.pendingIncident;
          skip.addEventListener('click', () => runManagementTurn({ id: 'traffic_wave', params: { wave: wave.id, skip: true } }, input, ctx, render));
          group.append(skip);
        }
      }
    }
    if (section.type === 'traffic' && section.lodging) {
      if (!section.lodging.reviewed) {
        const review = button('숙박 문의 확인', 'secondary-btn');
        review.disabled = busy;
        review.addEventListener('click', () => runManagementTurn({ id: 'lodging_review', params: {} }, input, ctx, render));
        group.append(review);
      }
    }
    if (section.type === 'traffic' && section.mail) {
      const check = button(section.mail.checkedToday ? '✓ 우편함 확인함' : '📬 우편함 확인', 'secondary-btn');
      check.disabled = busy || section.mail.checkedToday;
      check.addEventListener('click', () => runManagementTurn({ id: 'mail_check', params: {} }, input, ctx, render));
      group.append(check);
      for (const letter of section.mail.letters) {
        if (letter.type === 'reward') continue;
        const kind = letter.type === 'reward' ? '감사 선물' : '의뢰 편지';
        const open = button(`📨 ${letter.axis} ${kind} 개봉`, 'secondary-btn');
        open.disabled = busy;
        open.addEventListener('click', () => runManagementTurn({ id: 'mail_open', params: { mailId: letter.id } }, input, ctx, render));
        group.append(open);
      }
    }
    if (false && (section.type === 'sell' || section.type === 'buy')) for (const item of section.items) {
      const owned = section.type === 'buy' && item.owned ? ` · 보유 ${item.owned}` : '';
      const control = button(`${item.name} (${formatMoney(item.price)})${owned}`, 'secondary-btn');
      control.disabled = busy || (section.type === 'buy' && !item.affordable);
      control.addEventListener('click', () => runManagementTurn({ id: section.type === 'buy' ? 'buy_item' : 'sale', params: { menuName: item.name, qty: 1 } }, input, ctx, render));
      group.append(control);
    }
    if (false && section.type === 'purchase') for (const item of section.items) {
      const line = el('div', 'mgmt-row purchase-stepper');
      const name = el('span'); name.textContent = item.label || item.id;
      const minus = button('−', 'secondary-btn');
      const qty = el('input', 'purchase-qty');
      qty.type = 'number'; qty.min = '1'; qty.max = '999'; qty.value = '1';
      const plus = button('+', 'secondary-btn');
      const control = button('', 'secondary-btn');
      const readQty = () => Math.max(1, Math.min(999, Math.round(Number(qty.value) || 1)));
      const updateLabel = () => {
        const value = readQty();
        control.textContent = `구매 (합계 ${formatMoney(Number(item.basePrice || 0) * value)})`;
        control.disabled = busy || Number(getEngineState().gold || 0) < Number(item.basePrice || 0) * value;
        return value;
      };
      // 타이핑 중에는 필드를 덮어쓰지 않는다(백스페이스로 비울 수 있게) — 클램프는 포커스 이탈/확정 시.
      const clampQty = () => { const value = updateLabel(); qty.value = String(value); return value; };
      minus.disabled = busy; plus.disabled = busy; qty.disabled = busy;
      minus.addEventListener('click', () => { qty.value = String(readQty() - 1); clampQty(); });
      plus.addEventListener('click', () => { qty.value = String(readQty() + 1); clampQty(); });
      qty.addEventListener('input', updateLabel);
      qty.addEventListener('change', clampQty);
      control.addEventListener('click', () => runManagementTurn({ id: 'purchase', params: { resource: item.id, qty: clampQty() } }, input, ctx, render));
      clampQty();
      line.append(name, minus, qty, plus, control);
      group.append(line);
    }
    if (false && section.type === 'upgrade') for (const item of section.items) {
      const control = button(item.maxed ? `${item.label} Lv.${item.level} (최대)` : `${item.label} Lv.${item.level}→${item.level + 1} (${formatMoney(item.nextCost)})`, 'secondary-btn');
      control.disabled = busy || item.maxed || !item.affordable;
      control.addEventListener('click', () => runManagementTurn({ id: 'upgrade', params: { facility: item.id } }, input, ctx, render));
      group.append(control);
    }
    if (section.type === 'gather') for (const resource of section.resources) for (const scale of section.scales) {
      const scaleLabel = { small: '소량', large: '대량', bulk: '대규모' }[scale.id];
      // "A_res [소량 100~200]"이 가격(원)처럼 오독됨(사용자 피드백) — 획득량임을 명시.
      const control = button(`${resource} ${scaleLabel} · 획득 +${scale.range.join('~')}개`, 'secondary-btn');
      control.disabled = busy;
      control.addEventListener('click', () => runManagementTurn({ id: 'gain_resource', params: { resource, scale: scale.id } }, input, ctx, render));
      group.append(control);
    }
    if (section.type === 'day_end') {
      const control = button('하루 마감', 'primary-btn');
      control.disabled = busy;
      control.addEventListener('click', () => runManagementTurn({ id: 'day_end', params: {} }, input, ctx, render));
      group.append(control);
    }
    if (section.type === 'quests') for (const item of section.items) {
      const label = item.pending ? `⚖ ${item.name} 계속` : item.done ? `✓ ${item.name} (완료)` : item.attemptedToday ? `✓ ${item.name} (오늘 처리됨)` : `⚖ ${item.name} · 성공 ${item.chance}% · 보상 ${item.reward ? item.reward.join('~') : '없음'}`;
      const control = button(label, 'secondary-btn');
      control.disabled = busy || item.done || (item.attemptedToday && !item.pending);
      control.addEventListener('click', () => runManagementTurn({ id: 'attempt_quest', params: { questId: item.id } }, input, ctx, render));
      group.append(control);
    }
    details.append(group);
  }
  return details;
}

function renderLedgerSection(render) {
  const sectionNode = titled('🧾 경영');
  sectionNode.classList.add('ledger-section');
  if (busy) sectionNode.classList.add('is-busy');
  const descriptor = availableManagement(getSchema(), getEngineState());
  const addButton = (label, event, disabled = false) => {
    const control = button(label, 'secondary-btn');
    control.disabled = busy || disabled;
    control.addEventListener('click', () => runLedgerAction(event, render));
    sectionNode.append(control);
  };
  for (const section of descriptor.sections) {
    if (section.type === 'traffic' && section.mail) for (const letter of section.mail.letters.filter((item) => item.type === 'reward')) {
      addButton(`📨 ${letter.axis} 감사 선물 개봉`, { id: 'mail_open', params: { mailId: letter.id } });
    }
    if (section.type === 'buy') for (const item of section.items) {
      const owned = section.type === 'buy' && item.owned ? ` · 보유 ${item.owned}` : '';
      addButton(`구매 · ${item.name} (${formatMoney(item.price)})${owned}`, { id: 'buy_item', params: { menuName: item.name, qty: 1 } }, !item.affordable);
    }
    if (section.type === 'purchase') for (const item of section.items) {
      const line = el('div', 'purchase-stepper');
      const name = el('span'); name.textContent = item.label || item.id;
      const minus = button('−', 'secondary-btn');
      const qty = el('input', 'purchase-qty'); qty.type = 'number'; qty.min = '0'; qty.max = '999'; qty.value = '1';
      const plus = button('+', 'secondary-btn');
      const subtotal = el('span', 'purchase-subtotal');
      const readQty = () => Math.max(0, Math.min(999, Math.round(Number(qty.value) || 0)));
      qty.value = String(purchaseDraft[item.id] ?? 1);
      const update = () => { const value = readQty(); purchaseDraft[item.id] = value; subtotal.textContent = formatMoney(Number(item.basePrice || 0) * value); return value; };
      const clamp = () => { const value = update(); qty.value = String(value); return value; };
      minus.disabled = busy; plus.disabled = busy; qty.disabled = busy;
      minus.addEventListener('click', () => { qty.value = String(readQty() - 1); clamp(); render(); });
      plus.addEventListener('click', () => { qty.value = String(readQty() + 1); clamp(); render(); });
      qty.addEventListener('input', update); qty.addEventListener('change', () => { clamp(); render(); });
      clamp(); line.append(name, minus, qty, plus, subtotal); sectionNode.append(line);
    }
    if (section.type === 'purchase') {
      // 0 수량 행은 배치에서 제외 — 엔진 purchase_batch는 qty<=0을 거부하므로(경계 유지) 제외는 UI 책임.
      const items = section.items.map((item) => ({ resource: item.id, qty: Math.max(0, Math.min(999, Number(purchaseDraft[item.id] ?? 1))) })).filter((item) => item.qty > 0);
      const total = items.reduce((sum, item) => {
        const def = section.items.find((row) => row.id === item.resource);
        return sum + Number(def && def.basePrice || 0) * item.qty;
      }, 0);
      addButton(`선택 수량 일괄 구매 · ${formatMoney(total)}`, { id: 'purchase_batch', params: { items } }, !items.length || Number(getEngineState().gold || 0) < total);
    }
    if (section.type === 'upgrade') for (const item of section.items) {
      addButton(item.maxed ? `${item.label} Lv.${item.level} (최대)` : `${item.label} Lv.${item.level}→${item.level + 1} (${formatMoney(item.nextCost)})`, { id: 'upgrade', params: { facility: item.id } }, item.maxed || !item.affordable);
    }
  }
  return sectionNode;
}

function runLedgerAction(event, render) {
  if (busy) return;
  const result = runEvent(event);
  const chips = [];
  for (const entry of result.entries || []) {
    const item = summarizeEventItem(event.id, entry, formatMoney);
    chips.push({ ok: !!entry.ok, text: item.text, kind: item.kind });
    if (entry.ok) ledgerDeltas.push(ledgerDelta(event, item.text));
  }
  const last = messages[messages.length - 1];
  if (last && last.role === 'ledger') last.chips.push(...chips);
  else messages.push({ role: 'ledger', chips });
  render();
}

function ledgerDelta(event, summary) {
  const params = event.params || {};
  if (event.id === 'purchase') return `재료(${params.resource}) ${params.qty}인분을 구매해 창고에 보관했다 (${summary})`;
  if (event.id === 'buy_item') return `${params.menuName} ${params.qty || 1}개를 구매했다 (${summary})`;
  if (event.id === 'sale') return `${params.menuName} ${params.qty || 1}개를 판매했다 (${summary})`;
  if (event.id === 'upgrade') return `${params.facility} 시설을 증축 완료했다 (${summary})`;
  if (event.id === 'mail_open') return `감사 선물 편지를 개봉했다 (${summary})`;
  return `${event.id} 행동을 처리했다 (${summary})`;
}

async function runManagementTurn(event, input, ctx, render) {
  if (busy) return;
  busy = true;
  const flavorText = input.value.trim();
  const chips = [];
  const resultTexts = [];
  const recentForNarration = messages.slice(-4);
  const recentChanges = ledgerDeltas.slice();
  if (flavorText) messages.push(userMessage(flavorText));
  input.value = '';
  // 스포 방지(사용자 피드백): 엔진은 먼저 굴리되, 칩·메시지·상태 패널 공개는 서사 도착과 함께.
  // "생각 중..." 동안 결과(🎲 성공/실패·골드 변동)가 보이지 않는다. (전투 턴은 즉시 표시 유지 — 호평 기능)
  render();
  const result = runEvent(event);
  appendEventChips(event.id, result.entries, chips, resultTexts);
  const pending = { id: nextMessageId(), role: 'assistant', content: '', chips, sceneId: currentSceneId() };
  try {
    const prompt = buildNarrationPrompt({ schema: getSchema(), state: getEngineState(), results: resultTexts, flavorText, recentMessages: recentForNarration, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges, eventType: event.id, decisionContext: decisionContextFor(event.id, result.entries) });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    recordPromptRun(promptRunOf(prompt, raw, parsed));
    applyEmotion(parsed.emotion);
    pending.npcIds = applySpeakers(parsed);
    const ignored = parsed.events.length + parsed.dropped;
    if (ignored) chips.push({ ok: false, kind: 'system', text: `서사화 사건 ${ignored}개 무시됨` });
    pending.content = verifiedNarrative(parsed, prompt, [], chips, { fallback: '관리 결과가 반영되었습니다.' }) || '관리 결과가 반영되었습니다.';
  } catch (_) {
    chips.push({ ok: false, kind: 'system', text: '서사화 API 오류 · 엔진 결과 유지' });
    pending.content = '관리 결과가 반영되었습니다.';
  } finally {
    ledgerDeltas = [];
    messages.push(pending); // 서사와 칩·상태가 함께 나타난다
    busy = false;
    render();
  }
}

async function runManagementBatch(items, input, ctx, render) {
  if (busy || !items.length) return;
  busy = true;
  const flavorText = input.value.trim();
  const chips = [];
  const resultTexts = [];
  const recentForNarration = messages.slice(-4);
  const recentChanges = ledgerDeltas.slice();
  if (flavorText) messages.push(userMessage(flavorText));
  input.value = '';
  render();
  for (const item of items) {
    const result = runEvent(item.event);
    const entries = result.entries || [];
    if (item.event.id === 'lodging_accept' && entries.some((entry) => !entry.ok && entry.reason === 'no_room_available')) {
      const text = `방이 없어 ${item.requestName} 문의는 받지 못함`;
      chips.push({ ok: false, kind: 'system', text }); resultTexts.push(text);
    } else appendEventChips(item.event.id, entries, chips, resultTexts);
  }
  const pending = { id: nextMessageId(), role: 'assistant', content: '', chips, sceneId: currentSceneId() };
  try {
    const prompt = buildNarrationPrompt({ schema: getSchema(), state: getEngineState(), results: resultTexts, flavorText, recentMessages: recentForNarration, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges, eventType: 'lodging_batch' });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    recordPromptRun(promptRunOf(prompt, raw, parsed));
    applyEmotion(parsed.emotion);
    pending.npcIds = applySpeakers(parsed);
    const ignored = parsed.events.length + parsed.dropped;
    if (ignored) chips.push({ ok: false, kind: 'system', text: `서사화 사건 ${ignored}개 무시됨` });
    pending.content = verifiedNarrative(parsed, prompt, [], chips, { fallback: '관리 결과가 반영되었습니다.' }) || '관리 결과가 반영되었습니다.';
  } catch (_) {
    chips.push({ ok: false, kind: 'system', text: '서사화 API 오류 · 엔진 결과 유지' });
    pending.content = '관리 결과가 반영되었습니다.';
  } finally {
    ledgerDeltas = [];
    messages.push(pending);
    busy = false;
    render();
  }
}

function decisionContextFor(type, entries) {
  if (type === 'traffic_wave') {
    const entry = (entries || []).find((item) => item.awaitingChoice && item.incident);
    if (entry) return `[화면의 실제 결정 카드]\n사건: ${entry.incident.label} — ${entry.incident.desc || ''}\n실제 선택지: ${(entry.choices || []).map((choice) => choice.label).join(' / ')}`;
  }
  if (type === 'lodging_review') {
    const entry = (entries || [])[0];
    if (entry && Array.isArray(entry.requests)) return `[화면의 실제 숙박 문의]\n${entry.requests.map((request) => `${request.name} · ${request.party}명 · ${request.stayDays}박`).join('\n')}`;
  }
  return '';
}

function renderSettings(ctx, render) {
  const details = el('details', 'play-settings');
  const hasKey = settings.provider === 'mock' || !!readKey(settings.provider);
  details.open = !hasKey;
  const summary = el('summary');
  summary.textContent = '설정';
  details.append(summary);

  const provider = namedSelect('provider');
  for (const key of Object.keys(PROVIDERS)) appendOption(provider, key, key, false);
  provider.value = settings.provider;
  provider.addEventListener('change', () => {
    settings.provider = provider.value;
    settings.model = defaultModel(settings.provider);
    saveSettings(settings);
    registerCustomOrigin(settings);
    render();
  });

  const base = namedInput('baseUrl', settings.baseUrl || '', 'url');
  base.placeholder = 'https://openrouter.ai/api/v1';
  base.addEventListener('change', () => {
    settings.baseUrl = base.value.trim();
    saveSettings(settings);
    registerCustomOrigin(settings);
    render();
  });

  const location = namedInput('location', settings.location || 'global');
  location.placeholder = 'us-central1 또는 global';
  location.addEventListener('change', () => {
    settings.location = location.value.trim() || 'global';
    saveSettings(settings);
    render();
  });

  const model = namedInput('model', settings.model || defaultModel(settings.provider));
  model.disabled = settings.provider === 'mock';
  model.addEventListener('change', () => {
    settings.model = model.value.trim();
    saveSettings(settings);
    render();
  });

  const key = settings.provider === 'vertex'
    ? namedTextarea('apiKey', '')
    : namedInput('apiKey', '', 'password');
  key.placeholder = readKey(settings.provider)
    ? maskedKey(settings.provider)
    : settings.provider === 'vertex'
      ? '서비스 계정 JSON 붙여넣기'
      : 'API 키';
  key.disabled = settings.provider === 'mock';
  const save = button('저장', 'secondary-btn');
  save.disabled = settings.provider === 'mock';
  save.addEventListener('click', () => {
    const value = key.value.trim();
    if (value) lsSet(keyName(settings.provider), value);
    key.value = '';
    render();
  });
  const del = button('삭제', 'secondary-btn');
  del.disabled = settings.provider === 'mock';
  del.addEventListener('click', () => {
    lsRemove(keyName(settings.provider));
    render();
  });

  const fastCombat = namedInput('fastCombat', '1', 'checkbox');
  fastCombat.checked = lsGet('simbot.play.fastCombat') === '1';
  fastCombat.addEventListener('change', () => {
    lsSet('simbot.play.fastCombat', fastCombat.checked ? '1' : '0');
    if (!fastCombat.checked) fastCombatLog = [];
    render();
  });

  const manualCombat = namedInput('manualCombat', '1', 'checkbox');
  manualCombat.checked = lsGet('simbot.play.manualCombat') === '1';
  manualCombat.addEventListener('change', () => { lsSet('simbot.play.manualCombat', manualCombat.checked ? '1' : '0'); render(); });

  const mults = el('div', 'scale-mults');
  const multHeading = el('h4'); multHeading.textContent = '배율'; mults.append(multHeading);
  const schema = getSchema(); const state = getEngineState();
  for (const scale of (schema && schema.scales) || []) {
    if (!scale || !scale.steps) continue;
    const current = state && state.scaleMults && state.scaleMults[scale.id] != null ? state.scaleMults[scale.id] : 1;
    const input = namedInput(`scaleMult-${scale.id}`, String(current), 'range');
    input.min = '0.5'; input.max = '3'; input.step = '0.1'; input.disabled = busy;
    const label = el('span'); label.textContent = `${scale.label || scale.id} ×${Number(current).toFixed(1)}`;
    input.addEventListener('change', () => runLedgerAction({ id: 'set_scale_mult', params: { scale: scale.id, mult: Number(input.value) } }, render));
    mults.append(field(label.textContent, input));
  }
  // 델타 스케일이 없는 카드에서는 빈 '배율' 제목만 남으므로 통째로 숨긴다.
  if (mults.childNodes.length <= 1) mults.replaceChildren();

  // S2: 세션 저장/이어하기 — 원장(엔진 사건 전체)+대화+LLM 요청 기록을 한 파일로.
  const exportSession = button('세션 내보내기', 'secondary-btn');
  exportSession.disabled = busy;
  exportSession.addEventListener('click', () => {
    const payload = buildCurrentSessionExport();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `simbot-session-${payload.savedAt}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const importFile = el('input');
  importFile.type = 'file'; importFile.accept = '.json,application/json'; importFile.hidden = true;
  const importSession = button('세션 가져오기', 'secondary-btn');
  importSession.disabled = busy;
  importSession.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!file || busy) return;
    try {
      const payload = parsePlaySessionImport(await file.text());
      applySessionPayload(payload, ctx); // 스키마 지문·해시·판정 검증 — 실패 시 throw, 기존 세션 무손상
      messages.push({ role: 'ledger', chips: [{ ok: true, kind: 'system', text: `세션 이어하기 — 대화 ${payload.messages.length}개 · 엔진 사건 ${payload.journal.events.length}개 복원` }] });
      lastPersistHash = '';
      lastPersistQuickSignature = '';
      scheduleAutoSave(0);
    } catch (err) {
      messages.push({ role: 'ledger', chips: [{ ok: false, kind: 'system', text: `세션 가져오기 거부 — ${importFailureKo(err)}` }] });
    }
    render();
  });

  const personaFile = el('input');
  personaFile.type = 'file'; personaFile.accept = '.png,image/png'; personaFile.hidden = true;
  const importPersona = button('Risu 페르소나 가져오기', 'secondary-btn');
  importPersona.disabled = busy;
  importPersona.addEventListener('click', () => personaFile.click());
  personaFile.addEventListener('change', async () => {
    const file = personaFile.files && personaFile.files[0]; personaFile.value = '';
    if (!file || busy) return;
    try {
      activePersona = importRisuPersonaPng(new Uint8Array(await file.arrayBuffer()), file.name);
      if (compatibilityLibrary) {
        await compatibilityLibrary.putPersona(activePersona);
        personaLibrary = await compatibilityLibrary.listPersonas();
      }
      messages.push({ role: 'ledger', chips: [{ ok: true, kind: 'system', text: `페르소나 연결 · ${activePersona.name} (이 세션에는 현재 버전이 고정됩니다)` }] });
      lastPersistQuickSignature = ''; scheduleAutoSave(0);
    } catch (error) {
      messages.push({ role: 'ledger', chips: [{ ok: false, kind: 'system', text: `페르소나 가져오기 실패 · ${safeError(error)}` }] });
    }
    render();
  });
  const exportPersona = button('페르소나 내보내기', 'secondary-btn');
  exportPersona.disabled = busy || !activePersona;
  exportPersona.addEventListener('click', () => {
    const bytes = exportRisuPersonaPng(activePersona);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    link.download = `${String(activePersona.name || 'persona').replace(/[<>:"/\\|?*]/g, '')}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const clearPersona = button('페르소나 해제', 'secondary-btn');
  clearPersona.disabled = busy || !activePersona;
  clearPersona.addEventListener('click', () => { activePersona = null; lastPersistQuickSignature = ''; scheduleAutoSave(0); render(); });
  const personaSelect = namedSelect('personaLibrary');
  appendOption(personaSelect, '', '페르소나 선택', !activePersona);
  for (const persona of personaLibrary) appendOption(personaSelect, persona.id, `${persona.name} · v${persona.version}`, activePersona && activePersona.id === persona.id);
  personaSelect.value = activePersona && personaLibrary.some((persona) => persona.id === activePersona.id) ? activePersona.id : '';
  personaSelect.addEventListener('change', () => {
    const selected = personaLibrary.find((persona) => persona.id === personaSelect.value);
    if (selected) activePersona = JSON.parse(JSON.stringify(selected));
    lastPersistQuickSignature = ''; scheduleAutoSave(0); render();
  });
  const clonePersona = button('페르소나 복제', 'secondary-btn');
  clonePersona.disabled = busy || !activePersona || !compatibilityLibrary;
  clonePersona.addEventListener('click', async () => {
    const copy = JSON.parse(JSON.stringify(activePersona));
    copy.id = `${copy.id}-copy-${Date.now().toString(36)}`; copy.name = `${copy.name} 복사본`; copy.version = 1;
    await compatibilityLibrary.putPersona(copy); personaLibrary = await compatibilityLibrary.listPersonas(); activePersona = copy;
    lastPersistQuickSignature = ''; scheduleAutoSave(0); render();
  });

  const presetFile = el('input');
  presetFile.type = 'file'; presetFile.accept = '.risup,.risupreset'; presetFile.hidden = true;
  const importPreset = button('Risu 프롬프트 가져오기', 'secondary-btn');
  importPreset.disabled = busy;
  importPreset.addEventListener('click', () => presetFile.click());
  presetFile.addEventListener('change', async () => {
    const file = presetFile.files && presetFile.files[0]; presetFile.value = '';
    if (!file || busy) return;
    try {
      const imported = await importRisuPreset(new Uint8Array(await file.arrayBuffer()), file.name);
      activePromptPreset = imported.preset;
      if (compatibilityLibrary) {
        await compatibilityLibrary.putPreset(activePromptPreset);
        presetLibrary = await compatibilityLibrary.listPresets();
      }
      messages.push({ role: 'ledger', chips: [{ ok: true, kind: 'system', text: `Risu 프롬프트 연결 · ${activePromptPreset.name} · 블록 ${activePromptPreset.blocks.length}개` }] });
      lastPersistQuickSignature = ''; scheduleAutoSave(0);
    } catch (error) {
      messages.push({ role: 'ledger', chips: [{ ok: false, kind: 'system', text: `Risu 프롬프트 가져오기 실패 · ${safeError(error)}` }] });
    }
    render();
  });
  const clearPreset = button('프롬프트 해제', 'secondary-btn');
  clearPreset.disabled = busy || !activePromptPreset;
  clearPreset.addEventListener('click', () => { activePromptPreset = null; lastPersistQuickSignature = ''; scheduleAutoSave(0); render(); });
  const presetSelect = namedSelect('presetLibrary');
  appendOption(presetSelect, '', '프롬프트 선택', !activePromptPreset);
  for (const preset of presetLibrary) appendOption(presetSelect, preset.id, `${preset.name} · v${preset.version}`, activePromptPreset && activePromptPreset.id === preset.id);
  presetSelect.value = activePromptPreset && presetLibrary.some((preset) => preset.id === activePromptPreset.id) ? activePromptPreset.id : '';
  presetSelect.addEventListener('change', () => {
    const selected = presetLibrary.find((preset) => preset.id === presetSelect.value);
    if (selected) activePromptPreset = JSON.parse(JSON.stringify(selected));
    lastPersistQuickSignature = ''; scheduleAutoSave(0); render();
  });

  details.append(
    field('제공자', provider),
    settings.provider === 'custom' ? field('Base URL', base) : hiddenBase(base),
    settings.provider === 'vertex' ? field('리전', location) : hiddenBase(location),
    field('모델', model),
    field('빠른 전투 (전투 서사를 종료 시 한 번에)', fastCombat),
    field('디버그: 수동 전투 개시', manualCombat),
    mults,
    field(settings.provider === 'vertex' ? '서비스 계정 JSON' : 'API 키', key),
    row(save, del),
    row(exportSession, importSession),
    importFile,
    notice(activePersona ? `연결된 페르소나: ${activePersona.name} · 세션 스냅샷 사용` : '연결된 페르소나 없음'),
    field('페르소나 라이브러리', personaSelect),
    row(importPersona, exportPersona, clearPersona),
    clonePersona,
    personaFile,
    notice(activePromptPreset ? `연결된 Risu 프롬프트: ${activePromptPreset.name} · 블록 ${activePromptPreset.blocks.length}개 · 세션 스냅샷 사용` : '연결된 Risu 프롬프트 없음 · 시뮬 기본 프롬프트 사용'),
    field('프롬프트 라이브러리', presetSelect),
    row(importPreset, clearPreset),
    presetFile,
    notice(persistenceStatus),
    settings.provider === 'vertex'
      ? notice('서비스 계정 JSON은 GCP 전체 권한을 가질 수 있는 강력한 자격증명입니다. 공용 PC에서 저장하지 말고 사용 후 삭제하세요.')
      : notice('키는 이 브라우저의 localStorage에만 저장됩니다. 공용 PC에서는 사용 후 반드시 삭제하세요.'),
    notice('플레이 시 대화 내용·발동한 로어북·상태 요약이 선택한 LLM 제공자에게 전송됩니다.')
  );
  return details;
}

// 가져오기 거부 사유를 사용자가 겪는 증상으로 번역.
function importFailureKo(err) {
  const message = err && err.message ? String(err.message) : '';
  if (message.includes('journal_schema_mismatch')) return '다른 카드/스키마의 세션입니다';
  if (message.includes('journal_corrupt')) return '파일이 손상되었거나 변조되었습니다';
  if (message.includes('play_session_not_json')) return 'JSON 파일이 아닙니다';
  if (message.includes('contract')) return '시뮬봇 세션 파일이 아닙니다';
  return '알 수 없는 형식입니다';
}

function renderStateBox(ctx, render) {
  const section = titled('상태 대시보드');
  const state = getEngineState();
  const schema = getSchema();
  if (!schema || !state) return section;
  const metrics = el('div', 'state-metrics');
  if (Number.isFinite(Number(state.gold))) metrics.append(stateMetric('💰 골드', formatMoney(state.gold)));
  if (Number.isFinite(Number(state.day))) metrics.append(stateMetric('📅 일차', Number(state.day).toLocaleString('ko-KR')));
  const pools = (state.player && state.player.pools) || {};
  for (const id of ['hp', 'mp', 'sp']) if (pools[id]) metrics.append(combatGauge(id.toUpperCase(), pools[id], ''));
  if (metrics.childNodes.length) section.append(metrics);
  // gold는 위 핵심 지표에 이미 있으므로 자원 그리드에서 제외(이중 노출 방지).
  appendStateGrid(section, '자원', Object.entries(state.resources || {}).filter(([id]) => id !== 'gold').map(([id, qty]) => {
    const def = (schema.resources || []).find((item) => item.id === id);
    return [(def && (def.label || def.name)) || id, Number(qty).toLocaleString('ko-KR')];
  }));
  const facilities = entityInstances(schema, 'facility');
  appendStateGrid(section, '시설', Object.entries(state.facilities || {}).map(([id, level]) => {
    const def = facilities.find((item) => item.id === id);
    return [((def && (def.label || def.name)) || id), `Lv.${Number(level).toLocaleString('ko-KR')}`];
  }));
  // 여관형 스키마: 직원·객실 현황 — 구 텍스트 요약의 [직원]/[객실] 줄을 대시보드로 승계.
  const types = new Set((schema.entities || []).map((entry) => entry.type));
  if (types.has('menuItem') && types.has('room')) {
    const npcs = entityInstances(schema, 'npc');
    appendStaffGrid(section, ctx, render, schema, state, npcs);
    const occupied = [];
    for (const status of roomStatus(schema, state)) {
      for (const guest of status.occupants) occupied.push([`${status.no}호`, `${guest.guestName} · ${guest.nightsLeft}박 남음`]);
    }
    appendStateGrid(section, '객실', occupied);
  }
  const other = el('div', 'state-detail-list');
  const claimed = new Set(state.claimedRewards || []);
  for (const quest of schema.quests || []) { const row = el('div', 'state-detail-row'); row.textContent = `📜 ${quest.name || quest.id}${claimed.has(quest.id) ? ' · 완료' : ''}`; other.append(row); }
  const npcRows = (lastPrompt && lastPrompt.relatedNpcIds ? lastPrompt.relatedNpcIds : []).map((id) => ({ id, text: npcSummary(schema, state, id) })).filter((item) => item.text);
  for (const item of npcRows) { const npc = npcPresentation(schema, item.id); const row = el('div', 'state-detail-row npc-state-row'); row.append(characterAvatar(ctx, npc.asset, 'npc-avatar', npc.name), document.createTextNode(`👤 ${item.text}`)); other.append(row); }
  if (other.childNodes.length) section.append(other);
  return section;
}

function stateMetric(label, value) { const node = el('div', 'state-metric'); const name = el('span'); name.textContent = label; const strong = el('strong'); strong.textContent = value; node.append(name, strong); return node; }
function appendStateGrid(section, title, items) { if (!items.length) return; const group = el('div', 'state-group'); const heading = el('h4'); heading.textContent = title; const grid = el('div', 'state-card-grid'); for (const [name, value] of items) { const card = el('div', 'state-card'); const label = el('span'); label.textContent = name; const strong = el('strong'); strong.textContent = value; card.append(label, strong); grid.append(card); } group.append(heading, grid); section.append(group); }
function appendStaffGrid(section, ctx, render, schema, state, npcs) {
  const group = el('div', 'state-group staff-group');
  const heading = el('h4'); heading.textContent = '직원';
  const grid = el('div', 'staff-card-grid');
  for (const item of state.staff || []) {
    const npc = npcs.find((entry) => entry.id === item.npcId);
    const name = (npc && npc.nameKo) || item.npcId;
    const presentation = npcPresentation(schema, item.npcId);
    const card = el('div', 'staff-card');
    card.append(characterAvatar(ctx, presentation.asset, 'staff-avatar', name));
    const copy = el('div', 'staff-card-copy');
    const label = el('strong'); label.textContent = name;
    const wage = el('span'); wage.textContent = `일급 ${formatMoney(item.dailyWage)}`;
    copy.append(label, wage);
    if (presentation.group) {
      const variants = Array.from(new Set(Array.from(presentation.group.emotions.values()).flat().map((asset) => asset.variant)
        .filter((variant) => variant != null && Number.isFinite(variant)))).sort((a, b) => a - b);
      if (variants.length) {
        const outfits = { 0: '기본의상', 1: '직원복', 2: '메이드복', 3: '갑옷', 4: '경량갑옷' };
        const select = namedSelect(`outfit-${item.npcId}`);
        for (const variant of variants) appendOption(select, String(variant), outfits[variant] || `의상 ${variant}`, false);
        select.value = String(outfitOf(item.npcId) ?? 0);
        select.disabled = busy;
        select.addEventListener('change', () => runLedgerAction({ id: 'set_outfit', params: { npcId: item.npcId, outfit: Number(select.value) } }, render));
        copy.append(select);
      }
    }
    const fire = button('해고', 'secondary-btn staff-fire-btn');
    fire.disabled = busy;
    fire.addEventListener('click', () => openCannedScene(`'${name}'에게 해고를 통보하는 장면을 열어라. 대화가 마무리되면 fire 사건을 내라.`, ctx, render));
    card.append(copy, fire); grid.append(card);
  }
  const capacity = el('div', 'staff-capacity');
  capacity.textContent = `빈 자리 ${(state.staff || []).length}/${staffMax(schema, state)}`;
  const help = el('p', 'staff-help');
  help.textContent = "채팅으로 고용 협상을 할 수 있어요 (예: '실비아에게 일해보지 않겠냐고 제안한다')";
  group.append(heading, grid, capacity, help); section.append(group);
}
function entityInstances(schema, type) { const def = (schema.entities || []).find((item) => item.type === type); return (def && def.instances) || []; }

const BASELINE_REF = 12029; // 용사여관 상시 로어북 실측치(앱 토큰 추정기) — 카드 미로드 시 폴백

function renderTokenBox(ctx) {
  const section = titled('토큰 미터');
  const schema = getSchema();
  const current = lastPrompt ? lastPrompt.injectedTokens : estimateTokens(summarize(schema, getEngineState()));
  const baseline = ctx.lore ? (estimateLorebookTokens(ctx.lore.entries).constant || BASELINE_REF) : BASELINE_REF;
  section.append(tokenGauge(current, baseline));
  if (lastPrompt) {
    const list = el('div', 'engine-list');
    for (const [key, value] of Object.entries(lastPrompt.injectedParts)) {
      const item = el('div', 'engine-list-row');
      item.textContent = `${key}: ${value.toLocaleString('ko-KR')}`;
      list.append(item);
    }
    section.append(list);
    if (lastPrompt.promptTrace && lastPrompt.promptTrace.length) {
      const trace = el('details', 'import-raw-details');
      const heading = el('summary'); heading.textContent = `Risu 프롬프트 검사 · ${lastPrompt.promptTrace.filter((item) => item.active).length}/${lastPrompt.promptTrace.length} 블록 활성`;
      const rows = el('div', 'engine-list');
      for (const item of lastPrompt.promptTrace) {
        const rowNode = el('div', 'engine-list-row');
        rowNode.textContent = `${item.active ? '전송' : '제외'} · ${item.blockId} · ${item.role} · ${item.tokensEstimate || 0}토큰${item.reason && item.reason !== 'ok' ? ` · ${item.reason}` : ''}`;
        rows.append(rowNode);
      }
      for (const warning of lastPrompt.promptWarnings || []) {
        const rowNode = el('div', 'engine-list-row engine-warning'); rowNode.textContent = `경고 · ${warning.code} · ${warning.detail || warning.path || ''}`; rows.append(rowNode);
      }
      trace.append(heading, rows); section.append(trace);
      if (lastPrompt.promptComparison) {
        const comparison = el('details', 'import-raw-details');
        const comparisonHeading = el('summary');
        comparisonHeading.textContent = `프롬프트 비교 · Risu 원문 ${lastPrompt.promptComparison.risu.messages.length}개 / SimPack ${lastPrompt.promptComparison.simpack.messages.length}개`;
        const result = el('p', lastPrompt.promptComparison.additive ? 'muted-line' : 'engine-warning');
        result.textContent = lastPrompt.promptComparison.additive
          ? `원문 블록 순서·역할 유지 · 엔진 전용 블록 ${lastPrompt.promptComparison.addedBlocks.filter((item) => item.active).length}개만 추가`
          : '원문 블록에도 차이가 감지됨 — 프리셋을 검토하세요.';
        comparison.append(comparisonHeading, result); section.append(comparison);
      }
    }
  }
  if (!ctx.lore) {
    const note = el('p', 'muted-line');
    note.textContent = '카드를 드롭하면 세계관 로어북이 자동 주입됩니다.';
    section.append(note);
  }
  return section;
}

// 인광 게이지: 상시 로어북(원본 매턴 고정) 대비 이번 턴 주입량을 막대로.
// 막대 길이는 데이터 비례 치수이므로 --pct 변수로 값만 전달(모양은 전부 CSS).
function tokenGauge(current, baseline) {
  const pct = baseline > 0 ? Math.min(100, Math.round((current / baseline) * 100)) : 0;
  const wrap = el('div', 'play-token-meter');

  const now = el('div', 'play-token-now');
  now.textContent = `${current.toLocaleString('ko-KR')} 토큰`;
  const sub = el('div', 'play-token-sub');
  sub.textContent = '이번 턴 주입';

  const track = el('div', 'play-token-track');
  const fill = el('div', 'play-token-fill');
  fill.style.setProperty('--pct', pct + '%');
  track.append(fill);

  const base = el('div', 'play-token-base');
  base.textContent = `상시 로어북(원본 매턴 고정) ${baseline.toLocaleString('ko-KR')} 토큰의 ${pct}%`;

  wrap.append(now, sub, track, base);
  return wrap;
}

async function runCombatTurn(event, input, ctx, render) {
  if (busy) return;
  busy = true;
  const flavorText = input.value.trim();
  const chips = [];
  const resultTexts = [];
  const beforeHp = poolSnapshot(getEngineState(), 'hp');
  const actionResult = runEvent(event);
  appendEventChips(event.id, actionResult.entries, chips, resultTexts);
  const state = getEngineState();
  // 소모품(use_item)은 즉각 적용 프리 액션 — 턴을 소비하지 않아 적 반격을 부르지 않는다(사용자 결정 2026-07-11).
  if (event.id === 'combat_action' && state.combat && state.combat.active && !state.combat.cleared && !state.combat.fled) {
    const enemyResult = runEvent({ id: 'enemy_turn', params: {} });
    appendEventChips('enemy_turn', enemyResult.entries, chips, resultTexts);
  }
  const afterHp = poolSnapshot(getEngineState(), 'hp');
  if (beforeHp && afterHp && beforeHp.cur !== afterHp.cur) resultTexts.push(`플레이어 HP ${beforeHp.cur}→${afterHp.cur}`);
  const fastCombat = lsGet('simbot.play.fastCombat') === '1';
  const combatAfter = getEngineState().combat;
  const fastCombatEnded = event.id === 'end_encounter' || (event.id === 'combat_action' && combatAfter && combatAfter.fled);
  // 연출 문장을 messages에 넣기 전에 잘라둔다 — 연출(user) 뒤에 서사화 프롬프트의 user 컨텍스트가
  // 붙으면 user→user 연속 롤이 되어 제공자(Vertex/Anthropic)가 거부한다(감사 지적).
  const recentForNarration = messages.slice(-4);
  if (flavorText) messages.push(userMessage(flavorText));
  const pending = { id: nextMessageId(), role: 'assistant', content: '', chips, sceneId: currentSceneId() };
  messages.push(pending);
  input.value = '';
  if (event.id === 'use_item') {
    // 즉각 적용: LLM 호출도 없다(칩이 결과). 빠른 전투 중이면 종료 시 일괄 서사에 포함되게 버퍼에만 남긴다.
    if (fastCombat) fastCombatLog.push(...resultTexts);
    pending.content = '🧪';
    busy = false;
    render();
    return;
  }
  render();
  if (fastCombat && !fastCombatEnded) {
    fastCombatLog.push(...resultTexts);
    pending.content = '⚡';
    busy = false;
    render();
    return;
  }
  try {
    const narrationResults = fastCombat ? [...fastCombatLog, ...resultTexts] : resultTexts;
    const recentChanges = ledgerDeltas.slice();
    if (fastCombat) fastCombatLog = [];
    const prompt = buildNarrationPrompt({ schema: getSchema(), state: getEngineState(), results: narrationResults, flavorText, recentMessages: recentForNarration, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    recordPromptRun(promptRunOf(prompt, raw, parsed));
    applyEmotion(parsed.emotion);
    pending.npcIds = applySpeakers(parsed);
    const ignored = parsed.events.length + parsed.dropped;
    if (ignored) chips.push({ ok: false, kind: 'system', text: `서사화 사건 ${ignored}개 무시됨` });
    pending.content = verifiedNarrative(parsed, prompt, [], chips, { fallback: '전투 결과가 반영되었습니다.' }) || '전투 결과가 반영되었습니다.';
  } catch (_) {
    chips.push({ ok: false, kind: 'system', text: '서사화 API 오류 · 엔진 결과 유지' });
    pending.content = '전투 결과가 반영되었습니다.';
  } finally {
    ledgerDeltas = [];
    busy = false;
    render();
  }
}

function appendEventChips(type, entries, chips, resultTexts) {
  for (const entry of entries || []) {
    if (type === 'enemy_turn' && entry.ok) {
      for (const result of entry.results || []) {
        const text = `${result.enemyId} 반격${result.intent === 'heavy' ? '(강공격)' : ''} 🎲${result.roll} · ${result.hit ? `${result.tier === 'critical_success' ? '크리티컬 · ' : ''}피해 ${result.damage}` : '빗나감'}`;
        chips.push({ ok: true, kind: 'combat', text });
        resultTexts.push(text);
      }
      if (entry.playerDead) resultTexts.push('플레이어 전투불능');
      continue;
    }
    // use_item 칩 포맷은 summarizeEvent(공통)가 담당 — 자유 텍스트·엔진 탭 경로와 표기 일치(감사 지적).
    const item = summarizeEventItem(type, entry, formatMoney);
    const text = item.text;
    chips.push({ ok: !!entry.ok, text, kind: item.kind });
    resultTexts.push(text);
  }
}

function poolSnapshot(state, id) {
  const pool = state.player && state.player.pools && state.player.pools[id];
  return pool ? { cur: Number(pool.cur), max: Number(pool.max) } : null;
}

async function startCombat(ctx, render) {
  if (busy) return;
  busy = true;
  conversationTurn += 1;
  const turn = conversationTurn;
  render();
  const recentChanges = ledgerDeltas.slice();
  try {
    const instruction = '이번 장면에 어울리는 적 명부로 start_encounter 사건 하나만 JSON으로 내라. 서사는 1~2문장만 허용한다.';
    const grounded = await groundedFor(instruction, turn);
    const prompt = buildPrompt({ schema: getSchema(), state: getEngineState(), lore: ctx.lore, card: compatibilityCard(ctx), persona: activePersona, promptPreset: activePromptPreset, recentMessages: messages.slice(-4), userInput: instruction, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges, groundedMemory: grounded.text });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    applyEmotion(parsed.emotion);
    const speakerIds = applySpeakers(parsed);
    const event = parsed.events.find((item) => item.id === 'start_encounter');
    let assistantRow;
    const evidenceEvents = [];
    let appliedOk = 0;
    if (!event) {
      const chips = [{ ok: false, kind: 'system', text: '적 정보를 만들지 못했습니다' }];
      assistantRow = assistantMessage(verifiedNarrative(parsed, prompt, [], chips, { blocked: true, fallback: '전투를 시작할 수 없었습니다.' }), chips, prompt, speakerIds);
    } else {
      const result = runEvent(event);
      const entry = result.entries[0] || { ok: false, reason: 'empty_log' };
      appliedOk = entry.ok ? 1 : 0;
      if (entry.ok) fastCombatLog = []; // 새 전투 시작 = 이전 전투 버퍼 폐기(감사 지적: 세션·전투 간 오염 방지)
      const ignored = parsed.events.length - 1 + parsed.dropped;
      const item = summarizeEventItem('start_encounter', entry, formatMoney);
      const chips = [{ ok: !!entry.ok, text: item.text, kind: item.kind }];
      if (ignored > 0) chips.push({ ok: false, kind: 'system', text: `다른 사건 ${ignored}개 무시됨` });
      evidenceEvents.push({ id: event.id, index: result.index, ok: !!entry.ok, summary: summarizeEvent(event.id, entry, formatMoney) });
      const content = verifiedNarrative(parsed, prompt, evidenceEvents, chips, { fallback: '전투를 시작할 수 없었습니다.' });
      assistantRow = assistantMessage(content, chips, prompt, speakerIds);
    }
    const memoryDecisions = ingestMemoryTurn({ turn, sceneId: currentSceneId(), assistantMessage: { id: assistantRow.id, content: assistantRow.content }, candidates: parsed.memoryCandidates || [], events: evidenceEvents });
    const pendingCount = memoryDecisions.filter((decision) => decision.status === 'candidate').length;
    if (pendingCount) assistantRow.chips.push({ ok: true, kind: 'info', text: `검토할 기억 후보 ${pendingCount}건` });
    const factRefVerdicts = validateMemoryFactRefs(parsed.factRefs || [], { hasState: true, events: evidenceEvents });
    const invalidFactRefs = factRefVerdicts.filter((verdict) => !verdict.ok).length;
    if (invalidFactRefs) assistantRow.chips.push({ ok: false, kind: 'system', text: `근거가 확인되지 않은 서사 주장 ${invalidFactRefs}건` });
    const continuityPatchRecord = parsed.continuityPatch ? proposeContinuityPatch(parsed.continuityPatch, turn) : null;
    if (continuityPatchRecord) assistantRow.chips.push({ ok: true, kind: 'info', text: '검토할 기억 상태 변경 1건' });
    recordPromptRun(promptRunOf(prompt, raw, parsed, appliedOk, memoryDecisions, factRefVerdicts, continuityPatchRecord));
    messages.push(assistantRow);
  } catch (_) {
    messages.push(assistantMessage('', [{ ok: false, kind: 'system', text: '적 정보를 만들지 못했습니다' }]));
  } finally {
    ledgerDeltas = [];
    busy = false;
    render();
  }
}

async function openCannedScene(instruction, ctx, render) {
  if (busy) return;
  busy = true;
  conversationTurn += 1;
  const turn = conversationTurn;
  render();
  const recentChanges = ledgerDeltas.slice();
  try {
    const schema = getSchema();
    const grounded = await groundedFor(instruction, turn);
    const prompt = buildPrompt({ schema, state: getEngineState(), lore: ctx.lore, card: compatibilityCard(ctx), persona: activePersona, promptPreset: activePromptPreset, recentMessages: messages.slice(-8), userInput: instruction, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges, groundedMemory: grounded.text });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    applyEmotion(parsed.emotion);
    const speakerIds = applySpeakers(parsed);
    const chips = [];
    if (parsed.dropped > 0) chips.push({ ok: false, kind: 'system', text: `형식 오류 사건 ${parsed.dropped}개 무시됨` });
    // 버튼 전용 인텐트는 LLM 응답으로 실행하지 않는다 — 치트·이중 영업 채널 차단(감사 지적).
    const blocked = parsed.events.filter((event) => buttonOnlyEvents.has(event.id));
    if (blocked.length) chips.push({ ok: false, kind: 'system', text: `버튼 전용 사건 ${blocked.length}개 무시됨` });
    let appliedOk = 0;
    const evidenceEvents = [];
    for (const event of parsed.events) {
      if (buttonOnlyEvents.has(event.id)) continue;
      const result = runEvent(event);
      const first = result.entries[0] || { ok: false, reason: 'empty_log' };
      if (first.ok) appliedOk += 1;
      const item = summarizeEventItem(event.id, first, formatMoney);
      chips.push({ ok: !!first.ok, text: item.text, kind: item.kind });
      evidenceEvents.push({ id: event.id, index: result.index, ok: result.entries.some((entry) => entry && entry.ok), summary: result.entries.map((entry) => summarizeEvent(event.id, entry, formatMoney)).join(' / ') });
    }
    const safeNarrative = verifiedNarrative(parsed, prompt, evidenceEvents, chips, { blocked: blocked.length > 0 });
    const assistantRow = assistantMessage(safeNarrative || '장면이 이어집니다.', chips, prompt, speakerIds);
    const memoryDecisions = ingestMemoryTurn({ turn, sceneId: currentSceneId(), assistantMessage: { id: assistantRow.id, content: assistantRow.content }, candidates: parsed.memoryCandidates || [], events: evidenceEvents });
    const pendingCount = memoryDecisions.filter((decision) => decision.status === 'candidate').length;
    if (pendingCount) chips.push({ ok: true, kind: 'info', text: `검토할 기억 후보 ${pendingCount}건` });
    const factRefVerdicts = validateMemoryFactRefs(parsed.factRefs || [], { hasState: true, events: evidenceEvents });
    const invalidFactRefs = factRefVerdicts.filter((verdict) => !verdict.ok).length;
    if (invalidFactRefs) chips.push({ ok: false, kind: 'system', text: `근거가 확인되지 않은 서사 주장 ${invalidFactRefs}건` });
    const continuityPatchRecord = parsed.continuityPatch ? proposeContinuityPatch(parsed.continuityPatch, turn) : null;
    if (continuityPatchRecord) chips.push({ ok: true, kind: 'info', text: '검토할 기억 상태 변경 1건' });
    recordPromptRun(promptRunOf(prompt, raw, parsed, appliedOk, memoryDecisions, factRefVerdicts, continuityPatchRecord));
    messages.push(assistantRow);
  } catch (err) {
    messages.push(assistantMessage(safeError(err), [{ ok: false, kind: 'system', text: 'API 오류' }]));
  } finally {
    ledgerDeltas = [];
    busy = false;
    render();
  }
}

async function submitTurn(text, ctx, render) {
  if (busy) return;
  text = applyRegexStage(String(text || ''), compatibilityRegexScripts(ctx), 'editinput').text;
  busy = true;
  conversationTurn += 1;
  const turn = conversationTurn;
  const userRow = userMessage(text);
  messages.push(userRow);
  render();
  const recentChanges = ledgerDeltas.slice();
  try {
    const schema = getSchema();
    const previousAssistant = messages.slice(0, -1).reverse().find((message) => message.role === 'assistant');
    const grounded = await groundedFor(text, turn);
    const prompt = buildPrompt({ schema, state: getEngineState(), lore: ctx.lore, card: compatibilityCard(ctx), persona: activePersona, promptPreset: activePromptPreset, recentMessages: messages.slice(-9, -1), userInput: text, lastVerdicts: previousAssistant && previousAssistant.chips, emotions: emotions(), speakerCatalog: speakerCatalog(), recentChanges, groundedMemory: grounded.text, currentMessageId: userRow.id });
    lastPrompt = prompt;
    const raw = await callCompatibleProvider(providerConfig(settings), prompt, ctx);
    const parsed = parseCompatibleResponse(raw, ctx);
    applyEmotion(parsed.emotion);
    const speakerIds = applySpeakers(parsed);
    const chips = [];
    if (parsed.dropped > 0) chips.push({ ok: false, kind: 'system', text: `형식 오류 사건 ${parsed.dropped}개 무시됨` });
    // 버튼 전용 인텐트는 LLM 응답으로 실행하지 않는다 — 치트·이중 영업 채널 차단(감사 지적).
    const blocked = parsed.events.filter((event) => buttonOnlyEvents.has(event.id));
    if (blocked.length) chips.push({ ok: false, kind: 'system', text: `버튼 전용 사건 ${blocked.length}개 무시됨` });
    let appliedOk = 0;
    const evidenceEvents = [];
    for (const event of parsed.events) {
      if (buttonOnlyEvents.has(event.id)) continue;
      const result = runEvent(event);
      const first = result.entries[0] || { ok: false, reason: 'empty_log' };
      if (first.ok) appliedOk += 1;
      const item = summarizeEventItem(event.id, first, formatMoney);
      chips.push({ ok: !!first.ok, text: item.text, kind: item.kind });
      evidenceEvents.push({
        id: event.id,
        index: result.index,
        ok: result.entries.some((entry) => entry && entry.ok),
        summary: result.entries.map((entry) => summarizeEvent(event.id, entry, formatMoney)).join(' / '),
      });
      // 빠른 전투 버퍼 수명: 자유 텍스트 경로로 전투가 새로 시작되거나 끝나면 버퍼를 비운다
      // (이전 전투 로그가 다음 전투 서사에 섞이는 오염 방지 — 감사 지적).
      if (first.ok && (event.id === 'start_encounter' || event.id === 'end_encounter')) fastCombatLog = [];
    }
    const combatNow = getEngineState().combat;
    if (fastCombatLog.length && (!combatNow || !combatNow.active)) fastCombatLog = [];
    const safeNarrative = verifiedNarrative(parsed, prompt, evidenceEvents, chips, { blocked: blocked.length > 0, userText: text });
    const assistantRow = assistantMessage(safeNarrative || '장면이 이어집니다.', chips, prompt, speakerIds);
    const memoryDecisions = ingestMemoryTurn({
      turn,
      sceneId: currentSceneId(),
      userMessage: { id: userRow.id, content: userRow.content },
      assistantMessage: { id: assistantRow.id, content: assistantRow.content },
      candidates: parsed.memoryCandidates || [],
      events: evidenceEvents,
    });
    const pendingCount = memoryDecisions.filter((decision) => decision.status === 'candidate').length;
    if (pendingCount) chips.push({ ok: true, kind: 'info', text: `검토할 기억 후보 ${pendingCount}건` });
    const factRefVerdicts = validateMemoryFactRefs(parsed.factRefs || [], { hasState: true, userMessageId: userRow.id, events: evidenceEvents });
    const invalidFactRefs = factRefVerdicts.filter((verdict) => !verdict.ok).length;
    if (invalidFactRefs) chips.push({ ok: false, kind: 'system', text: `근거가 확인되지 않은 서사 주장 ${invalidFactRefs}건` });
    const continuityPatchRecord = parsed.continuityPatch ? proposeContinuityPatch(parsed.continuityPatch, turn) : null;
    if (continuityPatchRecord) chips.push({ ok: true, kind: 'info', text: '검토할 기억 상태 변경 1건' });
    recordPromptRun(promptRunOf(prompt, raw, parsed, appliedOk, memoryDecisions, factRefVerdicts, continuityPatchRecord));
    messages.push(assistantRow);
  } catch (err) {
    messages.push(assistantMessage(safeError(err), [{ ok: false, kind: 'system', text: 'API 오류' }]));
  } finally {
    ledgerDeltas = [];
    busy = false;
    render();
  }
}

function maskedKey(provider) {
  if (provider === 'vertex') return '저장됨: 서비스 계정 JSON';
  const key = readKey(provider);
  if (!key) return '';
  return `저장됨: ****${key.slice(-4)}`;
}

function safeError(err) {
  const message = err && err.message ? err.message : String(err || '오류');
  const masked = message
    // GCP 서비스 계정 JSON이 에러에 섞여 나올 수 있다(Vertex 인증 실패 등) — PEM/private_key 마스킹.
    .replace(/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g, '[redacted-key]')
    .replace(/"private_key"\s*:\s*"[^"]*"?/g, '"private_key":"[redacted]"')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]') // Google API 키 포맷(감사 지적)
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 360);
  return `요청 실패: ${masked}`;
}

function titled(title) {
  const section = el('section', 'play-side-section');
  const h3 = el('h3');
  h3.textContent = title;
  section.append(h3);
  return section;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

// 전체 대화(서사 + 사건 결과 칩)를 붙여넣기용 평문으로.
function transcriptText() {
  const out = [];
  for (const m of messages) {
    if (m.role !== 'ledger') out.push((m.role === 'user' ? '유저: ' : 'AI: ') + String(m.content || ''));
    if (m.chips && m.chips.length) out.push(m.chips.map((c) => `[${c.text}]`).join(' '));
  }
  return out.join('\n\n');
}
