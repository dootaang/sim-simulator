const { summarize, npcSummary, availableActions } = require('../../engine/core/selectors.js');
const { estimateTokens, estimateLorebookTokens } = require('../core/lorebook/tokens.js');
const { buildPrompt, buildNarrationPrompt, parseAssistantResponse } = require('./llm/prompt.js');
const { PROVIDERS, callProvider } = require('./llm/providers.js');
const { providerConfig, loadSettings, saveSettings, registerCustomOrigin, readKey, keyName, defaultModel } = require('./llm/byokSettings.js');
const { el, button, field, row, notice, hiddenBase, namedInput, namedTextarea, namedSelect, appendOption, copyFallback: fallbackCopy } = require('./ui/dom.js');
import { getEngineState, getSchema, runEvent, summarizeEvent } from './engineSession.js';

let messages = [];
let busy = false;
let settings = loadSettings();
let lastPrompt = null;
let selectedTarget = null;
let fastCombatLog = [];

export function renderPlayView(container, ctx) {
  registerCustomOrigin(settings);
  const root = el('div', 'play-view');
  container.append(root);
  const render = () => {
    root.replaceChildren();
    root.append(renderLayout(ctx, render));
    // 전체 재구축 시 스크롤이 top으로 튀는 것 방지: 채팅을 항상 최신(하단)으로.
    const list = root.querySelector('.play-message-list');
    if (list) list.scrollTop = list.scrollHeight;
  };
  render();
  return () => {};
}

function renderLayout(ctx, render) {
  const layout = el('div', 'play-layout');
  layout.append(renderChat(ctx, render), renderSide(ctx, render));
  return layout;
}

function renderChat(ctx, render) {
  const panel = el('section', 'play-chat-panel');
  const header = el('div', 'view-header play-chat-header');
  const title = el('div');
  const h2 = el('h2');
  h2.textContent = '플레이(실험)';
  const p = el('p');
  p.textContent = 'LLM은 서사와 사건 후보만 제안하고, 상태는 엔진이 계산합니다.';
  title.append(h2, p);
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
    lastPrompt = null;
    fastCombatLog = [];
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
    for (const message of messages) list.append(renderMessage(message));
  }
  if (busy) {
    const thinking = el('div', 'play-message assistant');
    thinking.textContent = '생각 중...';
    list.append(thinking);
  }

  const form = el('form', 'play-input-row');
  const input = el('textarea', 'play-input');
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

  panel.append(header, list, renderCombatConsole(input, ctx, render), form);
  return panel;
}

function renderMessage(message) {
  const wrap = el('article', `play-message ${message.role}`);
  const text = el('div', 'play-message-text');
  text.textContent = message.content;
  wrap.append(text);
  if (message.chips && message.chips.length) {
    const chips = el('div', 'play-chip-row');
    for (const chip of message.chips) {
      const item = el('span', chip.ok ? 'badge engine-ok' : 'badge engine-fail');
      item.textContent = chip.text;
      chips.append(item);
    }
    wrap.append(chips);
  }
  return wrap;
}

function renderSide(ctx, render) {
  const side = el('aside', 'play-side-panel');
  const hud = renderCombatHud();
  if (hud) side.append(hud);
  side.append(renderSettings(render), renderStateBox(), renderTokenBox(ctx));
  return side;
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
    if (schema.combat || schema.pools) {
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

function renderSettings(render) {
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
    if (value) localStorage.setItem(keyName(settings.provider), value);
    key.value = '';
    render();
  });
  const del = button('삭제', 'secondary-btn');
  del.disabled = settings.provider === 'mock';
  del.addEventListener('click', () => {
    localStorage.removeItem(keyName(settings.provider));
    render();
  });

  const fastCombat = namedInput('fastCombat', '1', 'checkbox');
  fastCombat.checked = localStorage.getItem('simbot.play.fastCombat') === '1';
  fastCombat.addEventListener('change', () => {
    localStorage.setItem('simbot.play.fastCombat', fastCombat.checked ? '1' : '0');
    if (!fastCombat.checked) fastCombatLog = [];
    render();
  });

  details.append(
    field('제공자', provider),
    settings.provider === 'custom' ? field('Base URL', base) : hiddenBase(base),
    settings.provider === 'vertex' ? field('리전', location) : hiddenBase(location),
    field('모델', model),
    field('빠른 전투 (전투 서사를 종료 시 한 번에)', fastCombat),
    field(settings.provider === 'vertex' ? '서비스 계정 JSON' : 'API 키', key),
    row(save, del),
    settings.provider === 'vertex'
      ? notice('서비스 계정 JSON은 GCP 전체 권한을 가질 수 있는 강력한 자격증명입니다. 공용 PC에서 저장하지 말고 사용 후 삭제하세요.')
      : notice('키는 이 브라우저의 localStorage에만 저장됩니다. 공용 PC에서는 사용 후 반드시 삭제하세요.'),
    notice('플레이 시 대화 내용·발동한 로어북·상태 요약이 선택한 LLM 제공자에게 전송됩니다.')
  );
  return details;
}

function renderStateBox() {
  const section = titled('LLM이 보는 상태');
  const state = getEngineState();
  const schema = getSchema();
  const pre = el('pre', 'play-context-pre');
  pre.textContent = summarize(schema, state);
  section.append(pre);
  const npcText = (lastPrompt && lastPrompt.relatedNpcIds ? lastPrompt.relatedNpcIds : [])
    .map((id) => npcSummary(schema, state, id))
    .filter(Boolean)
    .join('\n');
  if (npcText) {
    const npc = el('pre', 'play-context-pre');
    npc.textContent = npcText;
    section.append(npc);
  }
  return section;
}

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
  const fastCombat = localStorage.getItem('simbot.play.fastCombat') === '1';
  const combatAfter = getEngineState().combat;
  const fastCombatEnded = event.id === 'end_encounter' || (event.id === 'combat_action' && combatAfter && combatAfter.fled);
  // 연출 문장을 messages에 넣기 전에 잘라둔다 — 연출(user) 뒤에 서사화 프롬프트의 user 컨텍스트가
  // 붙으면 user→user 연속 롤이 되어 제공자(Vertex/Anthropic)가 거부한다(감사 지적).
  const recentForNarration = messages.slice(-4);
  if (flavorText) messages.push({ role: 'user', content: flavorText });
  const pending = { role: 'assistant', content: '', chips };
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
    if (fastCombat) fastCombatLog = [];
    const prompt = buildNarrationPrompt({ schema: getSchema(), state: getEngineState(), results: narrationResults, flavorText, recentMessages: recentForNarration });
    lastPrompt = prompt;
    const raw = await callProvider(providerConfig(settings), prompt);
    const parsed = parseAssistantResponse(raw);
    const ignored = parsed.events.length + parsed.dropped;
    if (ignored) chips.push({ ok: false, text: `서사화 사건 ${ignored}개 무시됨` });
    pending.content = parsed.narrative || '전투 결과가 반영되었습니다.';
  } catch (_) {
    chips.push({ ok: false, text: '서사화 API 오류 · 엔진 결과 유지' });
    pending.content = '전투 결과가 반영되었습니다.';
  } finally {
    busy = false;
    render();
  }
}

function appendEventChips(type, entries, chips, resultTexts) {
  for (const entry of entries || []) {
    if (type === 'enemy_turn' && entry.ok) {
      for (const result of entry.results || []) {
        const text = `${result.enemyId} 반격${result.intent === 'heavy' ? '(강공격)' : ''} 🎲${result.roll} · ${result.hit ? `${result.tier === 'critical_success' ? '크리티컬 · ' : ''}피해 ${result.damage}` : '빗나감'}`;
        chips.push({ ok: true, text });
        resultTexts.push(text);
      }
      if (entry.playerDead) resultTexts.push('플레이어 전투불능');
      continue;
    }
    // use_item 칩 포맷은 summarizeEvent(공통)가 담당 — 자유 텍스트·엔진 탭 경로와 표기 일치(감사 지적).
    const text = summarizeEvent(type, entry, formatMoney);
    chips.push({ ok: !!entry.ok, text });
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
  render();
  try {
    const instruction = '이번 장면에 어울리는 적 명부로 start_encounter 사건 하나만 JSON으로 내라. 서사는 1~2문장만 허용한다.';
    const prompt = buildPrompt({ schema: getSchema(), state: getEngineState(), lore: ctx.lore, recentMessages: messages.slice(-4), userInput: instruction });
    lastPrompt = prompt;
    const parsed = parseAssistantResponse(await callProvider(providerConfig(settings), prompt));
    const event = parsed.events.find((item) => item.id === 'start_encounter');
    if (!event) {
      messages.push({ role: 'assistant', content: parsed.narrative || '', chips: [{ ok: false, text: '적 정보를 만들지 못했습니다' }] });
    } else {
      const result = runEvent(event);
      const entry = result.entries[0] || { ok: false, reason: 'empty_log' };
      if (entry.ok) fastCombatLog = []; // 새 전투 시작 = 이전 전투 버퍼 폐기(감사 지적: 세션·전투 간 오염 방지)
      const ignored = parsed.events.length - 1 + parsed.dropped;
      const chips = [{ ok: !!entry.ok, text: summarizeEvent('start_encounter', entry, formatMoney) }];
      if (ignored > 0) chips.push({ ok: false, text: `다른 사건 ${ignored}개 무시됨` });
      messages.push({ role: 'assistant', content: parsed.narrative, chips });
    }
  } catch (_) {
    messages.push({ role: 'assistant', content: '', chips: [{ ok: false, text: '적 정보를 만들지 못했습니다' }] });
  } finally {
    busy = false;
    render();
  }
}

async function submitTurn(text, ctx, render) {
  if (busy) return;
  busy = true;
  messages.push({ role: 'user', content: text });
  render();
  try {
    const schema = getSchema();
    const previousAssistant = messages.slice(0, -1).reverse().find((message) => message.role === 'assistant');
    const prompt = buildPrompt({ schema, state: getEngineState(), lore: ctx.lore, recentMessages: messages.slice(-9, -1), userInput: text, lastVerdicts: previousAssistant && previousAssistant.chips });
    lastPrompt = prompt;
    const raw = await callProvider(providerConfig(settings), prompt);
    const parsed = parseAssistantResponse(raw);
    const chips = [];
    if (parsed.dropped > 0) chips.push({ ok: false, text: `형식 오류 사건 ${parsed.dropped}개 무시됨` });
    for (const event of parsed.events) {
      const result = runEvent(event);
      const first = result.entries[0] || { ok: false, reason: 'empty_log' };
      chips.push({ ok: !!first.ok, text: summarizeEvent(event.id, first, formatMoney) });
      // 빠른 전투 버퍼 수명: 자유 텍스트 경로로 전투가 새로 시작되거나 끝나면 버퍼를 비운다
      // (이전 전투 로그가 다음 전투 서사에 섞이는 오염 방지 — 감사 지적).
      if (first.ok && (event.id === 'start_encounter' || event.id === 'end_encounter')) fastCombatLog = [];
    }
    const combatNow = getEngineState().combat;
    if (fastCombatLog.length && (!combatNow || !combatNow.active)) fastCombatLog = [];
    messages.push({ role: 'assistant', content: parsed.narrative || raw, chips });
  } catch (err) {
    messages.push({ role: 'assistant', content: safeError(err), chips: [{ ok: false, text: 'API 오류' }] });
  } finally {
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
  return `요청 실패: ${message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 360)}`;
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
    out.push((m.role === 'user' ? '유저: ' : 'AI: ') + String(m.content || ''));
    if (m.chips && m.chips.length) out.push(m.chips.map((c) => `[${c.text}]`).join(' '));
  }
  return out.join('\n\n');
}
