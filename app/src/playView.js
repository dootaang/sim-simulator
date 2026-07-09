const schema = require('../../schema/yongsa-inn.v0.json');
const { summarize, npcSummary } = require('../../engine/core/selectors.js');
const { estimateTokens, estimateLorebookTokens } = require('../core/lorebook/tokens.js');
const { buildPrompt, parseAssistantResponse } = require('./llm/prompt.js');
const { PROVIDERS, callProvider, providerDef } = require('./llm/providers.js');
import { getEngineState, runEvent, summarizeEvent } from './engineSession.js';

let messages = [];
let busy = false;
let settings = loadSettings();
let lastPrompt = null;

export function renderPlayView(container, ctx) {
  registerCustomOrigin();
  const root = el('div', 'play-view');
  container.append(root);
  const render = () => {
    root.replaceChildren();
    root.append(renderLayout(ctx, render));
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
  const clear = button('대화 초기화', 'secondary-btn');
  clear.addEventListener('click', () => {
    messages = [];
    lastPrompt = null;
    render();
  });
  header.append(title, clear);

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

  panel.append(header, list, form);
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
  side.append(renderSettings(render), renderStateBox(), renderTokenBox(ctx));
  return side;
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
    saveSettings();
    registerCustomOrigin();
    render();
  });

  const base = namedInput('baseUrl', settings.baseUrl || '', 'url');
  base.placeholder = 'https://openrouter.ai/api/v1';
  base.addEventListener('change', () => {
    settings.baseUrl = base.value.trim();
    saveSettings();
    registerCustomOrigin();
    render();
  });

  const model = namedInput('model', settings.model || defaultModel(settings.provider));
  model.disabled = settings.provider === 'mock';
  model.addEventListener('change', () => {
    settings.model = model.value.trim();
    saveSettings();
    render();
  });

  const key = namedInput('apiKey', '', 'password');
  key.placeholder = readKey(settings.provider) ? maskedKey(settings.provider) : 'API 키';
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

  details.append(
    field('제공자', provider),
    settings.provider === 'custom' ? field('Base URL', base) : hiddenBase(base),
    field('모델', model),
    field('API 키', key),
    row(save, del),
    notice('키는 이 브라우저의 localStorage에만 저장됩니다. 공용 PC에서는 사용 후 반드시 삭제하세요.'),
    notice('플레이 시 대화 내용·발동한 로어북·상태 요약이 선택한 LLM 제공자에게 전송됩니다.')
  );
  return details;
}

function renderStateBox() {
  const section = titled('LLM이 보는 상태');
  const state = getEngineState();
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

async function submitTurn(text, ctx, render) {
  busy = true;
  messages.push({ role: 'user', content: text });
  render();
  try {
    const prompt = buildPrompt({ schema, state: getEngineState(), lore: ctx.lore, recentMessages: messages.slice(-9, -1), userInput: text });
    lastPrompt = prompt;
    const raw = await callProvider(providerConfig(), prompt);
    const parsed = parseAssistantResponse(raw);
    const chips = [];
    for (const event of parsed.events) {
      const result = runEvent(event);
      const first = result.entries[0] || { ok: false, reason: 'empty_log' };
      chips.push({ ok: !!first.ok, text: summarizeEvent(event.id, first, formatMoney) });
    }
    messages.push({ role: 'assistant', content: parsed.narrative || raw, chips });
  } catch (err) {
    messages.push({ role: 'assistant', content: safeError(err), chips: [{ ok: false, text: 'API 오류' }] });
  } finally {
    busy = false;
    render();
  }
}

function providerConfig() {
  return {
    provider: settings.provider,
    model: settings.model || defaultModel(settings.provider),
    baseUrl: settings.provider === 'custom' ? settings.baseUrl : '',
    apiKey: settings.provider === 'mock' ? '' : readKey(settings.provider),
  };
}

function loadSettings() {
  return {
    provider: localStorage.getItem('simbot.byok.provider') || 'mock',
    model: localStorage.getItem('simbot.byok.model') || 'gemini-2.5-flash',
    baseUrl: localStorage.getItem('simbot.byok.customBase') || '',
  };
}

function saveSettings() {
  localStorage.setItem('simbot.byok.provider', settings.provider);
  localStorage.setItem('simbot.byok.model', settings.model || '');
  localStorage.setItem('simbot.byok.customBase', settings.baseUrl || '');
}

function registerCustomOrigin() {
  if (settings.provider !== 'custom' || !settings.baseUrl || !window.SIMBOT_NETWORK_POLICY) return;
  try {
    const url = new URL(settings.baseUrl);
    if (url.protocol === 'https:') window.SIMBOT_NETWORK_POLICY.setAllowedCustomOrigin(url.origin);
  } catch (_) {}
}

function readKey(provider) {
  return localStorage.getItem(keyName(provider)) || '';
}

function keyName(provider) {
  return `simbot.byok.${provider}`;
}

function maskedKey(provider) {
  const key = readKey(provider);
  if (!key) return '';
  return `저장됨: ****${key.slice(-4)}`;
}

function defaultModel(provider) {
  return providerDef(provider).defModel || '';
}

function safeError(err) {
  const message = err && err.message ? err.message : String(err || '오류');
  return `요청 실패: ${message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 360)}`;
}

function hiddenBase(node) {
  const wrap = el('div', 'play-hidden');
  wrap.append(node);
  return wrap;
}

function titled(title) {
  const section = el('section', 'play-side-section');
  const h3 = el('h3');
  h3.textContent = title;
  section.append(h3);
  return section;
}

function field(label, child) {
  const wrap = el('label', 'field');
  const span = el('span');
  span.textContent = label;
  wrap.append(span, child);
  return wrap;
}

function row(...children) {
  const wrap = el('div', 'play-button-row');
  wrap.append(...children);
  return wrap;
}

function notice(text) {
  const p = el('p', 'muted-line play-notice');
  p.textContent = text;
  return p;
}

function namedInput(name, value, type = 'text') {
  const node = el('input');
  node.name = name;
  node.type = type;
  node.value = value;
  return node;
}

function namedSelect(name) {
  const node = el('select');
  node.name = name;
  return node;
}

function appendOption(select, value, label, disabled) {
  const option = el('option');
  option.value = String(value);
  option.textContent = label;
  option.disabled = !!disabled;
  select.append(option);
}

function button(text, className) {
  const node = el('button', className);
  node.type = 'button';
  node.textContent = text;
  return node;
}

function el(tag, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}
