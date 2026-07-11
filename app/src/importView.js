const { buildCompilerInput, parseCompilerOutput, mockCompilerOutput } = require('./llm/compilerPrompt.js');
const { mineCard } = require('./llm/luaMine.js');
const { patchSchemaWithMined } = require('./llm/schemaPatch.js');
const { PROVIDERS, callProvider } = require('./llm/providers.js');
const { providerConfig, loadSettings, saveSettings, registerCustomOrigin, readKey, keyName, defaultModel } = require('./llm/byokSettings.js');
const { el, button, field, row, notice, hiddenBase, namedInput, namedTextarea, namedSelect, appendOption, copyFallback } = require('./ui/dom.js');
const { validateSchema } = require('./schema/validate.js');
import { setActiveSchema } from './engineSession.js';

const SECTION_KEYS = ['meta', 'resources', 'scales', 'ladders', 'entities', 'formulas', 'processes', 'events', 'initialState', '_assumptions'];
const stateByCard = new Map();

let busy = false;
let settings = loadSettings();
let activeImportRender = null;

// 비동기 컴파일 완료 콜백이 언마운트된 옛 인스턴스의 render를 잡고 있지 않도록,
// 항상 현재 마운트의 render만 실행한다 (탭 이탈 후 복귀 시 '컴파일 중' 락인 방지).
function refreshImport() {
  if (activeImportRender) activeImportRender();
}

export function renderImportView(container, ctx) {
  registerCustomOrigin(settings);
  const root = el('div', 'import-view');
  container.append(root);
  const render = () => {
    root.replaceChildren();
    root.append(renderHeader(ctx, render), renderLayout(ctx, render));
  };
  activeImportRender = render;
  render();
  return () => { if (activeImportRender === render) activeImportRender = null; };
}

export async function compileSchemaForImport(ctx, config) {
  const cfg = config || providerConfig(settings);
  const mined = cfg.provider === 'mock'
    ? null
    : Object.prototype.hasOwnProperty.call(cfg, 'mined')
      ? cfg.mined
      : mineCard(ctx && ctx.parsed);
  const compilerInput = buildCompilerInput(ctx && ctx.lore, mined);
  const raw = cfg.provider === 'mock'
    ? mockCompilerOutput()
    : await compileWithContinuation(cfg, compilerInput, ctx ? (message) => addLog(ctx, message) : null);
  const parsed = parseCompilerOutput(raw);
  if (!parsed.ok) {
    return {
      raw,
      schema: null,
      issues: [{ level: 'error', path: '$', msg: parsed.error }],
      compiledAt: new Date().toISOString(),
      approved: false,
      mined,
    };
  }
  const patched = patchSchemaWithMined(parsed.json, mined);
  const checked = validateSchema(patched.schema);
  return {
    raw,
    schema: checked.schema,
    issues: checked.issues,
    compiledAt: new Date().toISOString(),
    approved: false,
    mined,
    patches: patched.patches,
  };
}

// 대형 카드(NPC 수십 명)의 스키마 JSON은 모델 출력 상한을 넘어 잘릴 수 있다.
// 부분 응답을 버리지 않고(allowTruncated) "끊긴 지점부터 이어서"를 최대 3회 요청해 이어붙인다.
// 상한 자체를 올리지 않는 이유: 프로바이더/모델별 최대 출력이 달라(예: 16K 캡 모델) 초과 요청은 400이 난다.
async function compileWithContinuation(cfg, compilerInput, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  const messages = [{ role: 'user', content: 'Return only the compiled JSON object.' }];
  let combined = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await callProvider(cfg, {
      system: compilerInput,
      messages,
      maxTokens: 16000,
      temperature: 0.2,
      allowTruncated: true,
    });
    const text = typeof result === 'string' ? result : String((result && result.text) || '');
    // finish_reason이 비표준(null 등)이라 잘림 신호를 못 받는 프록시 대비:
    // 괄호 균형 스니핑으로 미완성 JSON을 잘림으로 간주한다.
    const flagged = !!(result && typeof result === 'object' && result.truncated);
    const stripped = combined ? text.replace(/^\s*```(?:json)?\s*/i, '') : text;
    // 모델이 이어쓰기 대신 JSON 전체를 처음부터 다시 출력한 경우: 이어붙이지 않고 교체한다.
    const restarted = combined && stripped.trimStart().startsWith('{') && combined.trimStart().replace(/^```(?:json)?\s*/i, '').startsWith(stripped.trimStart().slice(0, 40));
    combined = restarted ? text : combined + stripped;
    const truncated = flagged || looksTruncatedJson(combined);
    if (!truncated) return combined;
    if (attempt < 3) log(`컴파일 응답 잘림 — 이어서 요청 (${attempt + 2}/4회차, 매 회차 전체 룰북이 재전송되어 토큰이 추가 소모됩니다)`);
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: '출력이 중간에 잘렸다. 직전 출력이 끊긴 지점의 바로 다음 문자부터, 반복·설명·코드펜스 없이 이어서 계속 출력하라.' });
  }
  throw new Error('연속 요청 후에도 응답이 계속 잘려요 — 출력 한도가 큰 모델(예: gemini-2.5-pro, claude-sonnet)을 선택해 주세요');
}

// 문자열/이스케이프를 제외한 중괄호·대괄호 깊이로 JSON 완결 여부를 어림한다.
// 깊이가 0으로 닫히지 않으면 미완성(잘림)으로 간주 — finish_reason 비표준 프록시 보완.
function looksTruncatedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return false; // JSON이 아예 없으면 잘림 판정 대상 아님(파서가 처리)
  let depth = 0;
  let inString = false;
  let escaped = false;
  let opened = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') { depth += 1; opened = true; }
    else if (ch === '}' || ch === ']') { depth -= 1; if (opened && depth === 0) return false; }
  }
  return opened && depth > 0;
}

function renderHeader(ctx, render) {
  const header = el('div', 'view-header import-header');
  const title = el('div');
  const h2 = el('h2');
  h2.textContent = '임포트 컴파일러';
  const p = el('p');
  p.textContent = '카드를 게임 규칙으로 변환합니다.';
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
  const combatSchema = button('내장 전투 스키마(헌터) 적용', 'secondary-btn');
  combatSchema.disabled = busy;
  combatSchema.addEventListener('click', () => {
    setActiveSchema(require('../../schema/hunters-combat.v0.json'));
    addLog(ctx, '내장 전투 스키마 적용됨 · 플레이 탭에서 전투를 테스트할 수 있습니다');
    ctx.goToPlay();
  });
  buttonRow.append(compile, revert, combatSchema);
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

  panel.append(renderCopyBar(result), renderSchemaSummary(result.schema), renderIssueSummary(result));
  if (result.schema) {
    panel.append(renderAssumptions(result.schema), renderAdvancedEditor(ctx, result, render));
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
    const patches = (result.patches || []).map((p) => `${p.path}: ${fmtPatchVal(p.from)} → ${fmtPatchVal(p.to)}`).join('\n') || '(없음)';
    const text = `=== 검증 이슈 ===\n${issues}\n\n=== 채굴값 강제 적용 ===\n${patches}\n\n=== 스키마 JSON ===\n${result.schema ? JSON.stringify(result.schema, null, 2) : '(파싱 실패)'}`;
    const done = () => { copy.textContent = '복사됨!'; setTimeout(() => { copy.textContent = '검수 결과 복사'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => copyFallback(text, done));
    else copyFallback(text, done);
  });
  bar.append(copy);
  return bar;
}

function renderIssueSummary(result) {
  const section = titled('점검 사항');
  const list = el('div', 'import-issue-list');
  const patches = result.patches || [];
  if (!result.issues.length && !patches.length) {
    const ok = el('p', 'badge engine-ok import-status-badge');
    ok.textContent = '✅ 자동 점검 통과';
    list.append(ok);
  } else {
    for (const patch of patches) {
      const item = el('div', 'import-check-card import-check-auto');
      item.textContent = `🔧 자동으로 보정했어요 · ${patch.path}: ${fmtPatchVal(patch.from)} → ${fmtPatchVal(patch.to)}`;
      list.append(item);
    }
    for (const issue of result.issues) {
      const isError = issue.level === 'error';
      const item = el('div', `import-check-card ${isError ? 'import-check-error' : 'import-check-review'}`);
      item.textContent = `${isError ? '⛔' : '⚠️'} 확인이 필요해요 · ${issue.path}: ${issue.msg}`;
      list.append(item);
    }
  }
  section.append(list);
  return section;
}

// 채굴값으로 강제 교정된 필드를 투명하게 표시(LLM 값 → 카드 실값).
function renderPatches(result) {
  const patches = result && result.patches;
  if (!patches || !patches.length) return el('div', 'play-hidden');
  const section = titled('채굴값 강제 적용 (카드 Lua 실값으로 교정)');
  const p = el('p', 'muted-line');
  p.textContent = '아래 숫자는 LLM 출력이 아니라 카드 Lua에서 직접 채굴한 값으로 덮어쓴 것입니다.';
  section.append(p);
  const list = el('div', 'import-issue-list');
  for (const patch of patches) {
    const item = el('div', 'engine-list-row import-issue import-warn');
    item.textContent = `${patch.path}: ${fmtPatchVal(patch.from)} → ${fmtPatchVal(patch.to)}`;
    list.append(item);
  }
  section.append(list);
  return section;
}

function fmtPatchVal(value) {
  if (value === null || value === undefined) return '(없음)';
  return JSON.stringify(value);
}

function renderSchemaSummary(schema) {
  const section = titled('결과 요약');
  if (!schema) {
    const p = el('p', 'engine-warning');
    p.textContent = '컴파일러 출력을 JSON으로 파싱할 수 없습니다.';
    section.append(p);
    return section;
  }
  const grid = el('div', 'import-section-grid');
  for (const [label, value] of [
    ['자원', `${count(schema.resources)}종`],
    ['시설', `${entityCount(schema, 'facility')}개`],
    ['사건', `${count(schema.events)}종`],
    ['의뢰', `${count(schema.quests)}개`],
    ['NPC', `${entityCount(schema, 'npc')}명`],
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
  const wrap = el('div', 'import-editor-list');
  result.drafts = result.drafts || {};
  result.openSections = result.openSections || {};
  for (const key of SECTION_KEYS) {
    if (!result.schema || !(key in result.schema)) continue;
    const details = el('details', 'import-editor');
    // 재렌더에도 펼침 상태 유지.
    details.open = !!result.openSections[key];
    details.addEventListener('toggle', () => { result.openSections[key] = details.open; });
    const summary = el('summary');
    summary.textContent = key;
    const textarea = el('textarea', 'import-json-input');
    textarea.name = key;
    // 검증 실패 등으로 재렌더돼도 편집 중이던 텍스트를 날리지 않는다.
    textarea.value = key in result.drafts ? result.drafts[key] : JSON.stringify(result.schema[key], null, 2);
    textarea.addEventListener('input', () => { result.drafts[key] = textarea.value; });
    const validate = button('섹션 재검증', 'secondary-btn');
    validate.addEventListener('click', () => {
      revalidateSection(ctx, key, textarea.value);
      render();
    });
    details.append(summary, textarea, validate);
    wrap.append(details);
  }
  return wrap;
}

function renderAdvancedEditor(ctx, result, render) {
  const details = el('details', 'import-advanced');
  details.open = !!result.advancedOpen;
  details.addEventListener('toggle', () => { result.advancedOpen = details.open; });
  const summary = el('summary');
  summary.textContent = '고급: 규칙 원문(JSON) 직접 편집';
  details.append(summary, renderSectionEditors(ctx, result, render), renderFullJson(result.schema));
  return details;
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
  const approve = button('이 규칙으로 플레이 시작', 'primary-btn');
  const counts = issueCounts(result.issues);
  // 고급 편집에서 수정했지만 아직 재검증하지 않은 섹션이 있으면 승인 잠금 —
  // 수정 전 스키마가 조용히 승인되는 혼란 방지(감사 지적).
  const pendingDrafts = result.drafts ? Object.keys(result.drafts) : [];
  approve.disabled = !result.schema || counts.error > 0 || busy || pendingDrafts.length > 0;
  approve.addEventListener('click', () => {
    const current = currentResult(ctx);
    if (!current || !current.schema || issueCounts(current.issues).error > 0) return;
    if (current.drafts && Object.keys(current.drafts).length) { render(); return; }
    // 승인 시점에 한 번 더 정규화 — 배포 후 추가된 합성 규칙(traffic 등)이 기존 컴파일 결과에도 적용되게.
    const finalized = validateSchema(current.schema);
    setActiveSchema(finalized.schema);
    current.approved = true;
    addLog(ctx, '스키마 승인됨 · 엔진 세션이 재설정되었습니다.');
    ctx.goToPlay();
  });
  const note = el('p', 'muted-line');
  const hasJsonError = (result.issues || []).some((issue) => issue.source === 'advanced-json');
  note.textContent = pendingDrafts.length > 0
    ? `고급 편집에 저장되지 않은 수정이 있어요(${pendingDrafts.join(', ')}) — 각 섹션의 "섹션 재검증"을 먼저 눌러주세요.`
    : hasJsonError
      ? '고급 편집의 JSON에 오류가 있어요 — 되돌리려면 다시 컴파일'
      : counts.error > 0
        ? '플레이를 시작하려면 확인이 필요한 오류를 해결해 주세요.'
        : '승인하면 활성 엔진 세션이 이 정규화된 스키마로 재설정됩니다.';
  section.append(approve, note);
  return section;
}

async function runCompile(ctx, render) {
  busy = true;
  addLog(ctx, `컴파일 시작 (제공자 ${settings.provider}).`);
  const cfg = providerConfig(settings);
  let mined = null;
  if (cfg.provider !== 'mock') {
    mined = mineCard(ctx && ctx.parsed);
    addLog(ctx, formatMineLog(mined));
  }
  render();
  try {
    const result = await compileSchemaForImport(ctx, Object.assign({}, cfg, { mined }));
    setCurrentResult(ctx, result);
    const counts = issueCounts(result.issues);
    addLog(ctx, `컴파일 완료: 에러 ${counts.error}, 경고 ${counts.warn}.`);
    if (result.patches && result.patches.length) {
      addLog(ctx, `채굴값 강제 적용: ${result.patches.length}개 필드를 카드 실값으로 교정.`);
    }
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
    refreshImport();
  }
}

function formatMineLog(mined) {
  if (!mined || !mined.hasModule) {
    const reason = mined && mined.reason ? ` (${mined.reason})` : '';
    return `Lua mining: prose fallback${reason}.`;
  }
  if (mined.archetype !== 'lua-rich') {
    return `Lua mining: prose / tables ${mined.tableCount || 0} / Lua ${mined.luaSize || 0} chars.`;
  }
  return `Lua mining: lua-rich / mined tables ${mined.tableCount || 0} / rule tables ${mined.ruleTableCount || 0} / Lua ${mined.luaSize || 0} chars.`;
}

function revalidateSection(ctx, key, value) {
  const result = currentResult(ctx);
  if (!result || !result.schema) return;
  try {
    const schema = JSON.parse(JSON.stringify(result.schema));
    schema[key] = JSON.parse(value);
    const checked = validateSchema(schema);
    result.schema = checked.schema;
    // 다른 섹션의 미해결 JSON 문법 오류는 유지한다 — 멀쩡한 섹션 재검증이
    // 깨진 섹션의 에러를 지우고 승인 잠금을 풀어버리는 것 방지.
    const pendingJsonErrors = (result.issues || []).filter((issue) => issue.source === 'advanced-json' && issue.path !== key);
    result.issues = [...pendingJsonErrors, ...checked.issues];
    result.approved = false;
    if (result.drafts) delete result.drafts[key]; // 성공 → 정규화된 값으로 갱신
    addLog(ctx, `섹션 ${key} 재검증: 에러 ${issueCounts(result.issues).error}개.`);
  } catch (err) {
    result.issues = (result.issues || []).filter((issue) => issue.path !== key);
    result.issues.unshift({ level: 'error', path: key, msg: safeError(err), source: 'advanced-json' });
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

function maskedKey(provider) {
  if (provider === 'vertex') return 'stored: service account JSON';
  const key = readKey(provider);
  return key ? `stored: ****${key.slice(-4)}` : '';
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

function entityCount(schema, type) {
  const entity = Array.isArray(schema && schema.entities)
    ? schema.entities.find((entry) => entry && entry.type === type)
    : null;
  return entity && Array.isArray(entity.instances) ? entity.instances.length : 0;
}

function safeError(err) {
  const message = err && err.message ? err.message : String(err || 'Error');
  return message
    // GCP 서비스 계정 JSON이 에러에 섞여 나올 수 있다(Vertex 인증 실패 등) — PEM/private_key 마스킹.
    .replace(/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g, '[redacted-key]')
    .replace(/"private_key"\s*:\s*"[^"]*"?/g, '"private_key":"[redacted]"')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 360);
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
