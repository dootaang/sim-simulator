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
      maxTokens: 12000,
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
  h2.textContent = 'Import compiler';
  const p = el('p');
  p.textContent = 'Compile card lorebook rules into a game schema. LLM output is only a proposal until validation passes and you approve it.';
  title.append(h2, p);

  const buttonRow = el('div', 'engine-header-controls');
  const compile = button(busy ? 'Compiling...' : 'Compile', 'primary-btn');
  compile.disabled = busy || (!ctx.lore && settings.provider !== 'mock');
  compile.addEventListener('click', async () => {
    await runCompile(ctx, render);
  });
  buttonRow.append(compile);
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

  const status = titled('Status');
  const cardLine = el('p', 'muted-line');
  cardLine.textContent = ctx.lore
    ? `Card lorebook entries: ${ctx.lore.entries.length}`
    : settings.provider === 'mock'
      ? 'No card loaded. Mock can still produce a deterministic schema.'
      : 'Load a card before compiling with a real provider.';
  status.append(cardLine);

  const result = currentResult(ctx);
  if (result) {
    const counts = issueCounts(result.issues);
    const stamp = el('p', 'muted-line');
    stamp.textContent = `Last compile: ${result.compiledAt} / errors ${counts.error} / warnings ${counts.warn}`;
    status.append(stamp);
    if (result.approved) {
      const approved = el('p', 'badge engine-ok import-status-badge');
      approved.textContent = 'Approved and applied to engine session';
      status.append(approved);
    }
  }

  const log = titled('Compiler log');
  const lines = currentLog(ctx);
  if (!lines.length) {
    const empty = el('p', 'muted-line');
    empty.textContent = 'No compiler run yet.';
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
  summary.textContent = 'Provider settings';
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
  key.placeholder = readKey(settings.provider) ? maskedKey(settings.provider) : 'API key';
  key.disabled = settings.provider === 'mock';

  const save = button('Store key', 'secondary-btn');
  save.disabled = settings.provider === 'mock';
  save.addEventListener('click', () => {
    const value = key.value.trim();
    if (value) localStorage.setItem(keyName(settings.provider), value);
    key.value = '';
    render();
  });

  const del = button('Delete key', 'secondary-btn');
  del.disabled = settings.provider === 'mock';
  del.addEventListener('click', () => {
    localStorage.removeItem(keyName(settings.provider));
    render();
  });

  details.append(
    field('Provider', provider),
    settings.provider === 'custom' ? field('Base URL', base) : hiddenBase(base),
    field('Model', model),
    field('API key', key),
    row(save, del),
    notice('Keys stay in this browser localStorage. The mock provider does not use the network.')
  );
  return details;
}

function renderReviewPanel(ctx, render) {
  const panel = el('section', 'import-review-panel');
  const result = currentResult(ctx);
  if (!result) {
    const empty = el('div', 'empty-state import-empty');
    const h = el('h2');
    h.textContent = 'No schema proposal';
    const p = el('p');
    p.textContent = 'Run the compiler to review, edit, validate, and approve a schema.';
    empty.append(h, p);
    panel.append(empty);
    return panel;
  }

  panel.append(renderIssueSummary(result), renderSchemaSummary(result.schema));
  if (result.schema) {
    panel.append(renderAssumptions(result.schema), renderSectionEditors(ctx, result, render), renderFullJson(result.schema));
  }
  panel.append(renderApproval(ctx, result, render));
  return panel;
}

function renderIssueSummary(result) {
  const section = titled('Validation');
  const counts = issueCounts(result.issues);
  const row = el('div', 'import-metric-row');
  row.append(metric('Errors', counts.error), metric('Warnings', counts.warn));
  section.append(row);

  const list = el('div', 'import-issue-list');
  if (!result.issues.length) {
    const ok = el('p', 'badge engine-ok import-status-badge');
    ok.textContent = 'No validation issues';
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
  const section = titled('Sections');
  if (!schema) {
    const p = el('p', 'engine-warning');
    p.textContent = 'Compiler output could not be parsed as JSON.';
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
  const section = titled('Assumptions');
  const items = Array.isArray(schema._assumptions) ? schema._assumptions
    : schema.meta && Array.isArray(schema.meta.assumptions) ? schema.meta.assumptions
      : [];
  if (!items.length) {
    const p = el('p', 'muted-line');
    p.textContent = 'No assumptions were provided.';
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
  const section = titled('Section editor');
  const wrap = el('div', 'import-editor-list');
  for (const key of SECTION_KEYS) {
    if (!result.schema || !(key in result.schema)) continue;
    const details = el('details', 'import-editor');
    const summary = el('summary');
    summary.textContent = key;
    const textarea = el('textarea', 'import-json-input');
    textarea.name = key;
    textarea.value = JSON.stringify(result.schema[key], null, 2);
    const validate = button('Revalidate section', 'secondary-btn');
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
  summary.textContent = 'Normalized JSON preview';
  const pre = el('pre', 'engine-preview import-json-pre');
  pre.textContent = JSON.stringify(schema, null, 2);
  details.append(summary, pre);
  return details;
}

function renderApproval(ctx, result, render) {
  const section = el('section', 'import-approval');
  const approve = button('Approve and apply to engine', 'primary-btn');
  const counts = issueCounts(result.issues);
  approve.disabled = !result.schema || counts.error > 0 || busy;
  approve.addEventListener('click', () => {
    const current = currentResult(ctx);
    if (!current || !current.schema || issueCounts(current.issues).error > 0) return;
    setActiveSchema(current.schema);
    current.approved = true;
    addLog(ctx, 'Schema approved and active engine session reset.');
    render();
  });
  const note = el('p', 'muted-line');
  note.textContent = counts.error > 0
    ? 'Fix validation errors before approval. Raw LLM output is never applied directly.'
    : 'Approval resets the active engine session to use this normalized schema.';
  section.append(approve, note);
  return section;
}

async function runCompile(ctx, render) {
  busy = true;
  addLog(ctx, `Compile started with provider ${settings.provider}.`);
  render();
  try {
    const result = await compileSchemaForImport(ctx, providerConfig());
    setCurrentResult(ctx, result);
    const counts = issueCounts(result.issues);
    addLog(ctx, `Compile finished: ${counts.error} errors, ${counts.warn} warnings.`);
  } catch (err) {
    setCurrentResult(ctx, {
      raw: '',
      schema: null,
      issues: [{ level: 'error', path: '$', msg: safeError(err) }],
      compiledAt: new Date().toISOString(),
      approved: false,
    });
    addLog(ctx, `Compile failed: ${safeError(err)}`);
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
    addLog(ctx, `Section ${key} revalidated: ${issueCounts(checked.issues).error} errors.`);
  } catch (err) {
    result.issues = result.issues.filter((issue) => issue.path !== key);
    result.issues.unshift({ level: 'error', path: key, msg: safeError(err) });
    result.approved = false;
    addLog(ctx, `Section ${key} JSON parse failed.`);
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
