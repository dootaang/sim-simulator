const { buildCompilerInput, parseCompilerOutput, mockCompilerOutput } = require('./llm/compilerPrompt.js');
const { PROVIDERS, callProvider, providerDef } = require('./llm/providers.js');
const { validateSchema } = require('./schema/validate.js');
import { setActiveSchema } from './engineSession.js';

const SECTION_KEYS = ['meta', 'resources', 'scales', 'ladders', 'entities', 'formulas', 'processes', 'events', 'initialState', '_assumptions'];
const stateByCard = new Map();

let busy = false;
let settings = loadSettings();

export function renderImportView(container, ctx) {
  registerCustomOrigin();
  const root = el('div', 'import-view');
  container.append(root);
  const render = () => {
    root.replaceChildren();
    root.append(renderHeader(ctx, render), renderLayout(ctx, render));
  };
  render();
  return () => {};
}

export async function compileSchemaForImport(ctx, config) {
  const cfg = config || providerConfig();
  const compilerInput = buildCompilerInput(ctx && ctx.lore);
  const raw = cfg.provider === 'mock'
    ? mockCompilerOutput()
    : await callProvider(cfg, {
      system: compilerInput,
      messages: [{ role: 'user', content: 'Return only the compiled JSON object.' }],
      maxTokens: 16000,
      temperature: 0.2,
    });
  const parsed = parseCompilerOutput(raw);
  if (!parsed.ok) {
    return {
      raw,
      schema: null,
      issues: [{ level: 'error', path: '$', msg: parsed.error }],
      compiledAt: new Date().toISOString(),
      approved: false,
    };
  }
  const checked = validateSchema(parsed.json);
  return {
    raw,
    schema: checked.schema,
    issues: checked.issues,
    compiledAt: new Date().toISOString(),
    approved: false,
  };
}

function renderHeader(ctx, render) {
  const header = el('div', 'view-header import-header');
  const title = el('div');
  const h2 = el('h2');
  h2.textContent = '임포트 컴파일러';
  const p = el('p');
  p.textContent = '카드의 룰북(규칙 설명글)을 게임 스키마로 컴파일합니다. LLM 출력은 검증을 통과하고 사용자가 승인하기 전까지는 제안일 뿐입니다.';
  title.append(h2, p);

  const buttonRow = el('div', 'engine-header-controls');
  const compile = button(busy ? '컴파일 중...' : '컴파일', 'primary-btn');
  compile.disabled = busy || (!ctx.lore && settings.provider !== 'mock');
  compile.addEventListener('click', async () => {
    await runCompile(ctx, render);
  });
  const revert = button('내장 스키마로 되돌리기', 'secondary-btn');
  revert.disabled = busy;
  revert.addEventListener('click', () => {
    setActiveSchema(null); // 완성된 내장(손제작) 스키마로 복귀
    addLog(ctx, '내장(기본) 스키마로 되돌렸습니다. 플레이 탭에서 매끄럽게 플레이할 수 있습니다.');
    render();
  });
  buttonRow.append(compile, revert);
  header.append(title, buttonRow);
  return header;
}

function renderLayout(ctx, render) {
  const layout = el('div', 'import-layout');
  layout.append(renderRunPanel(ctx, render), renderReviewPanel(ctx, render));
  return layout;
}

function renderRunPanel(ctx, render) {
  const panel = el('section', 'import-run-panel');
  panel.append(renderSettings(render));

  const status = titled('상태');
  const cardLine = el('p', 'muted-line');
  cardLine.textContent = ctx.lore
    ? `카드 로어북 항목: ${ctx.lore.entries.length}개`
    : settings.provider === 'mock'
      ? '카드가 없습니다. mock 제공자는 카드 없이도 결정론 스키마를 만듭니다.'
      : '실제 제공자로 컴파일하려면 먼저 카드를 드롭하세요.';
  status.append(cardLine);

  const result = currentResult(ctx);
  if (result) {
    const counts = issueCounts(result.issues);
    const stamp = el('p', 'muted-line');
    stamp.textContent = `마지막 컴파일: ${result.compiledAt} / 에러 ${counts.error} / 경고 ${counts.warn}`;
    status.append(stamp);
    if (result.approved) {
      const approved = el('p', 'badge engine-ok import-status-badge');
      approved.textContent = '승인됨 · 엔진 세션에 반영됨';
      status.append(approved);
    }
  }

  const log = titled('컴파일 로그');
  const lines = currentLog(ctx);
  if (!lines.length) {
    const empty = el('p', 'muted-line');
    empty.textContent = '아직 컴파일하지 않았습니다.';
    log.append(empty);
  } else {
    const list = el('div', 'engine-list');
    for (const line of lines) {
      const row = el('div', 'engine-list-row');
      row.textContent = line;
      list.append(row);
    }
    log.append(list);
  }

  panel.append(status, log);
  return panel;
}

function renderSettings(render) {
  const details = el('details', 'play-settings import-settings');
  const hasKey = settings.provider === 'mock' || !!readKey(settings.provider);
  details.open = !hasKey;
  const summary = el('summary');
  summary.textContent = '제공자 설정';
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

  const location = namedInput('location', settings.location || 'global');
  location.placeholder = 'us-central1 또는 global';
  location.addEventListener('change', () => {
    settings.location = location.value.trim() || 'global';
    saveSettings();
    render();
  });

  const model = namedInput('model', settings.model || defaultModel(settings.provider));
  model.disabled = settings.provider === 'mock';
  model.addEventListener('change', () => {
    settings.model = model.value.trim();
    saveSettings();
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

  const save = button('키 저장', 'secondary-btn');
  save.disabled = settings.provider === 'mock';
  save.addEventListener('click', () => {
    const value = key.value.trim();
    if (value) localStorage.setItem(keyName(settings.provider), value);
    key.value = '';
    render();
  });

  const del = button('키 삭제', 'secondary-btn');
  del.disabled = settings.provider === 'mock';
  del.addEventListener('click', () => {
    localStorage.removeItem(keyName(settings.provider));
    render();
  });

  details.append(
    field('제공자', provider),
    settings.provider === 'custom' ? field('베이스 URL', base) : hiddenBase(base),
    settings.provider === 'vertex' ? field('리전', location) : hiddenBase(location),
    field('모델', model),
    field(settings.provider === 'vertex' ? '서비스 계정 JSON' : 'API 키', key),
    row(save, del),
    settings.provider === 'vertex'
      ? notice('서비스 계정 JSON은 GCP 전체 권한을 가질 수 있는 강력한 자격증명입니다. 공용 PC에서 저장하지 말고 사용 후 삭제하세요.')
      : notice('키는 이 브라우저의 localStorage에만 저장됩니다. mock 제공자는 네트워크를 쓰지 않습니다.')
  );
  return details;
}

function renderReviewPanel(ctx, render) {
  const panel = el('section', 'import-review-panel');
  const result = currentResult(ctx);
  if (!result) {
    const empty = el('div', 'empty-state import-empty');
    const h = el('h2');
    h.textContent = '스키마 제안 없음';
    const p = el('p');
    p.textContent = '컴파일을 실행하면 스키마를 검수·편집·검증·승인할 수 있습니다.';
    empty.append(h, p);
    panel.append(empty);
    return panel;
  }

  panel.append(renderCopyBar(result), renderIssueSummary(result), renderSchemaSummary(result.schema));
  if (result.schema) {
    panel.append(renderAssumptions(result.schema), renderSectionEditors(ctx, result, render), renderFullJson(result.schema));
  }
  panel.append(renderApproval(ctx, result, render));
  return panel;
}

// 검수 결과(검증 이슈 + 스키마 JSON)를 붙여넣기용 평문으로 클립보드에 복사.
function renderCopyBar(result) {
  const bar = el('div', 'import-copy-bar');
  const copy = button('검수 결과 복사', 'secondary-btn');
  copy.addEventListener('click', () => {
    const issues = (result.issues || []).map((i) => `${String(i.level).toUpperCase()} ${i.path}: ${i.msg}`).join('\n') || '(이슈 없음)';
    const text = `=== 검증 이슈 ===\n${issues}\n\n=== 스키마 JSON ===\n${result.schema ? JSON.stringify(result.schema, null, 2) : '(파싱 실패)'}`;
    const done = () => { copy.textContent = '복사됨!'; setTimeout(() => { copy.textContent = '검수 결과 복사'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => copyFallback(text, done));
    else copyFallback(text, done);
  });
  bar.append(copy);
  return bar;
}

function copyFallback(text, done) {
  const ta = el('textarea', 'offscreen');
  ta.value = text;
  ta.setAttribute('readonly', '');
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); if (done) done(); } catch (_) { /* ignore */ }
  ta.remove();
}

function renderIssueSummary(result) {
  const section = titled('검증');
  const counts = issueCounts(result.issues);
  const row = el('div', 'import-metric-row');
  row.append(metric('에러', counts.error), metric('경고', counts.warn));
  section.append(row);

  const list = el('div', 'import-issue-list');
  if (!result.issues.length) {
    const ok = el('p', 'badge engine-ok import-status-badge');
    ok.textContent = '검증 문제 없음';
    list.append(ok);
  } else {
    for (const issue of result.issues) {
      const item = el('div', `engine-list-row import-issue ${issue.level === 'error' ? 'engine-fail' : 'import-warn'}`);
      item.textContent = `${issue.level.toUpperCase()} ${issue.path}: ${issue.msg}`;
      list.append(item);
    }
  }
  section.append(list);
  return section;
}

function renderSchemaSummary(schema) {
  const section = titled('섹션');
  if (!schema) {
    const p = el('p', 'engine-warning');
    p.textContent = '컴파일러 출력을 JSON으로 파싱할 수 없습니다.';
    section.append(p);
    return section;
  }
  const grid = el('div', 'import-section-grid');
  for (const [label, value] of [
    ['resources', count(schema.resources)],
    ['scales', count(schema.scales)],
    ['ladders', count(schema.ladders)],
    ['entities', count(schema.entities)],
    ['formulas', count(schema.formulas)],
    ['processes', count(schema.processes)],
    ['events', count(schema.events)],
  ]) {
    grid.append(metric(label, value));
  }
  section.append(grid);
  return section;
}

function renderAssumptions(schema) {
  const section = titled('가정(확정 못 한 값)');
  const items = Array.isArray(schema._assumptions) ? schema._assumptions
    : schema.meta && Array.isArray(schema.meta.assumptions) ? schema.meta.assumptions
      : [];
  if (!items.length) {
    const p = el('p', 'muted-line');
    p.textContent = '기록된 가정이 없습니다.';
    section.append(p);
    return section;
  }
  const list = el('ul', 'import-assumption-list');
  for (const item of items) {
    const li = el('li');
    li.textContent = String(item);
    list.append(li);
  }
  section.append(list);
  return section;
}

function renderSectionEditors(ctx, result, render) {
  const section = titled('섹션 편집기');
  const wrap = el('div', 'import-editor-list');
  for (const key of SECTION_KEYS) {
    if (!result.schema || !(key in result.schema)) continue;
    const details = el('details', 'import-editor');
    const summary = el('summary');
    summary.textContent = key;
    const textarea = el('textarea', 'import-json-input');
    textarea.name = key;
    textarea.value = JSON.stringify(result.schema[key], null, 2);
    const validate = button('섹션 재검증', 'secondary-btn');
    validate.addEventListener('click', () => {
      revalidateSection(ctx, key, textarea.value);
      render();
    });
    details.append(summary, textarea, validate);
    wrap.append(details);
  }
  section.append(wrap);
  return section;
}

function renderFullJson(schema) {
  const details = el('details', 'import-full-json');
  const summary = el('summary');
  summary.textContent = '정규화된 JSON 미리보기';
  const pre = el('pre', 'engine-preview import-json-pre');
  pre.textContent = JSON.stringify(schema, null, 2);
  details.append(summary, pre);
  return details;
}

function renderApproval(ctx, result, render) {
  const section = el('section', 'import-approval');
  const approve = button('승인 후 엔진에 반영', 'primary-btn');
  const counts = issueCounts(result.issues);
  approve.disabled = !result.schema || counts.error > 0 || busy;
  approve.addEventListener('click', () => {
    const current = currentResult(ctx);
    if (!current || !current.schema || issueCounts(current.issues).error > 0) return;
    setActiveSchema(current.schema);
    current.approved = true;
    addLog(ctx, '스키마 승인됨 · 엔진 세션이 재설정되었습니다.');
    render();
  });
  const note = el('p', 'muted-line');
  note.textContent = counts.error > 0
    ? '승인 전에 검증 에러를 해결하세요. LLM 원출력은 절대 그대로 반영되지 않습니다.'
    : '승인하면 활성 엔진 세션이 이 정규화된 스키마로 재설정됩니다.';
  section.append(approve, note);
  return section;
}

async function runCompile(ctx, render) {
  busy = true;
  addLog(ctx, `컴파일 시작 (제공자 ${settings.provider}).`);
  render();
  try {
    const result = await compileSchemaForImport(ctx, providerConfig());
    setCurrentResult(ctx, result);
    const counts = issueCounts(result.issues);
    addLog(ctx, `컴파일 완료: 에러 ${counts.error}, 경고 ${counts.warn}.`);
  } catch (err) {
    setCurrentResult(ctx, {
      raw: '',
      schema: null,
      issues: [{ level: 'error', path: '$', msg: safeError(err) }],
      compiledAt: new Date().toISOString(),
      approved: false,
    });
    addLog(ctx, `컴파일 실패: ${safeError(err)}`);
  } finally {
    busy = false;
    render();
  }
}

function revalidateSection(ctx, key, value) {
  const result = currentResult(ctx);
  if (!result || !result.schema) return;
  try {
    const schema = JSON.parse(JSON.stringify(result.schema));
    schema[key] = JSON.parse(value);
    const checked = validateSchema(schema);
    result.schema = checked.schema;
    result.issues = checked.issues;
    result.approved = false;
    addLog(ctx, `섹션 ${key} 재검증: 에러 ${issueCounts(checked.issues).error}개.`);
  } catch (err) {
    result.issues = result.issues.filter((issue) => issue.path !== key);
    result.issues.unshift({ level: 'error', path: key, msg: safeError(err) });
    result.approved = false;
    addLog(ctx, `섹션 ${key} JSON 파싱 실패.`);
  }
}

function currentResult(ctx) {
  const entry = stateByCard.get(cardKey(ctx));
  return entry && entry.result;
}

function setCurrentResult(ctx, result) {
  const key = cardKey(ctx);
  const entry = stateByCard.get(key) || { log: [] };
  entry.result = result;
  stateByCard.set(key, entry);
}

function currentLog(ctx) {
  const entry = stateByCard.get(cardKey(ctx));
  return entry && entry.log ? entry.log : [];
}

function addLog(ctx, text) {
  const key = cardKey(ctx);
  const entry = stateByCard.get(key) || { log: [] };
  entry.log = [`${new Date().toISOString()} ${text}`].concat(entry.log || []).slice(0, 8);
  stateByCard.set(key, entry);
}

function cardKey(ctx) {
  const file = ctx && ctx.file;
  return file ? `${file.name}:${file.size}:${file.type}` : '__no_card__';
}

function providerConfig() {
  return {
    provider: settings.provider,
    model: settings.model || defaultModel(settings.provider),
    baseUrl: settings.provider === 'custom' ? settings.baseUrl : '',
    location: settings.provider === 'vertex' ? (settings.location || 'global') : '',
    apiKey: settings.provider === 'mock' ? '' : readKey(settings.provider),
  };
}

function loadSettings() {
  return {
    provider: localStorage.getItem('simbot.byok.provider') || 'mock',
    model: localStorage.getItem('simbot.byok.model') || 'gemini-2.5-flash',
    baseUrl: localStorage.getItem('simbot.byok.customBase') || '',
    location: localStorage.getItem('simbot.byok.location') || 'global',
  };
}

function saveSettings() {
  localStorage.setItem('simbot.byok.provider', settings.provider);
  localStorage.setItem('simbot.byok.model', settings.model || '');
  localStorage.setItem('simbot.byok.customBase', settings.baseUrl || '');
  localStorage.setItem('simbot.byok.location', settings.location || 'global');
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
  if (provider === 'vertex') return 'stored: service account JSON';
  const key = readKey(provider);
  return key ? `stored: ****${key.slice(-4)}` : '';
}

function defaultModel(provider) {
  return providerDef(provider).defModel || '';
}

function issueCounts(issues) {
  return (issues || []).reduce((acc, issue) => {
    acc[issue.level] = (acc[issue.level] || 0) + 1;
    return acc;
  }, { error: 0, warn: 0 });
}

function count(value) {
  return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
}

function safeError(err) {
  const message = err && err.message ? err.message : String(err || 'Error');
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 360);
}

function hiddenBase(node) {
  const wrap = el('div', 'play-hidden');
  wrap.append(node);
  return wrap;
}

function titled(title) {
  const section = el('section', 'play-side-section import-section');
  const h3 = el('h3');
  h3.textContent = title;
  section.append(h3);
  return section;
}

function metric(label, value) {
  const card = el('div', 'metric import-metric');
  const span = el('span');
  span.textContent = label;
  const strong = el('strong');
  strong.textContent = String(value);
  card.append(span, strong);
  return card;
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

function namedTextarea(name, value) {
  const node = el('textarea');
  node.name = name;
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
