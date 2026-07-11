import { parseCard } from '../core/card/parseCard.js';
import { cardAssetBytes } from '../core/card/cardAssets.js';
import { extractLorebook, loreStats } from '../core/lorebook/normalize.js';
import { renderNpcGallery, buildNpcClusters } from './npcGallery.js';
import { renderLorebookView } from './lorebookView.js';
import { renderActivateView } from './activateView.js';
import { renderAssetsView } from './assetsView.js';
import { renderEngineView } from './engineView.js';
import { renderPlayView, primaryCharacter } from './playView.js';
import { applyCardTheme } from './theme/cardTheme.js';
import { renderImportView } from './importView.js';
// 주의: engineSession.getSchema()는 기본 내장 스키마를 항상 반환하므로(절대 null 아님)
// "플레이할 것이 있는가" 판정에 쓰면 안 된다. 사용자가 명시적으로 스키마를 활성화해
// 플레이로 직행한 경우만 아래 플래그로 추적한다.
let schemaActivated = false;

const tabs = [
  { id: 'overview', label: '개요' },
  { id: 'npc', label: 'NPC 갤러리' },
  { id: 'lorebook', label: '로어북' },
  { id: 'activate', label: '활성화 시뮬' },
  { id: 'assets', label: '에셋' },
  { id: 'engine', label: '엔진(실험)' },
  { id: 'play', label: '플레이(실험)' },
  { id: 'import', label: '임포트(실험)' },
];

const KNOWN_ORIGINS = [
  'https://generativelanguage.googleapis.com/',
  'https://api.openai.com/',
  'https://api.anthropic.com/',
  'https://oauth2.googleapis.com/',
];
let allowedCustomOrigin = '';

const state = {
  parsed: null,
  lore: null,
  file: null,
  activeTab: 'play',
  shellMode: 'player',
  error: '',
  avifSupported: null,
  viewUrls: new Map(),
  cleanup: null,
  cardTheme: null,
};

const app = document.getElementById('app');

disableNetworkApis();
renderShell();
detectAvifSupport().then((ok) => {
  state.avifSupported = ok;
  render();
});

function disableNetworkApis() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isAllowedFetchUrl(url)) return originalFetch(input, init);
    return Promise.reject(new Error('Network requests are disabled except for the selected BYOK provider.'));
  };
  window.SIMBOT_NETWORK_POLICY = {
    setAllowedCustomOrigin(origin) {
      allowedCustomOrigin = origin || '';
    },
  };
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function XMLHttpRequestDisabled() {
    const xhr = new OriginalXHR();
    const open = xhr.open.bind(xhr);
    xhr.open = function disabledOpen(method, url) {
      if (/^(https?:)?\/\//i.test(String(url))) throw new Error('Network requests are disabled in this local app.');
      return open(method, url);
    };
    return xhr;
  };
}

function renderShell() {
  clearTabResources();
  const header = document.createElement('header');
  header.className = 'topbar';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h1');
  title.id = 'appTitle';
  title.textContent = state.parsed?.name || '시뮬봇 카드 플레이그라운드';
  const subtitle = document.createElement('p');
  subtitle.textContent = state.shellMode === 'creator' ? '카드의 구조와 게임 변환 도구를 탐색합니다.' : '';
  titleWrap.append(title, subtitle);
  const status = document.createElement('div');
  status.className = 'status-pill';
  status.id = 'loadStatus';
  status.textContent = '카드 없음';
  const headerActions = document.createElement('div');
  headerActions.className = 'shell-actions';
  headerActions.append(status);
  if (state.shellMode === 'player' && state.parsed) {
    headerActions.append(shellButton('제작자 도구', () => enterCreator()), shellButton('카드 교체', () => inputNode.click()));
  } else if (state.shellMode === 'player' && schemaActivated) {
    // 카드 없이 내장/승인 스키마로 플레이 중 — 제작자 도구 복귀 경로는 남긴다.
    headerActions.append(shellButton('제작자 도구', () => enterCreator()));
  } else if (state.shellMode === 'creator') {
    headerActions.prepend(shellButton('← 플레이로 돌아가기', () => enterPlayer()));
  }
  header.append(titleWrap, headerActions);

  const main = document.createElement('main');
  const dropSection = document.createElement('section');
  dropSection.className = 'drop-section landing-drop';
  const dropzoneNode = document.createElement('div');
  dropzoneNode.className = 'dropzone';
  dropzoneNode.id = 'dropzone';
  dropzoneNode.tabIndex = 0;
  const dropTitle = document.createElement('div');
  dropTitle.className = 'drop-title';
  dropTitle.textContent = '카드를 여기에 드롭';
  const dropSub = document.createElement('div');
  dropSub.className = 'drop-sub';
  dropSub.textContent = '.charx, .png, .jpg, .jpeg, .json, .risum';
  const pickButton = document.createElement('button');
  pickButton.className = 'primary-btn';
  pickButton.id = 'pickButton';
  pickButton.type = 'button';
  pickButton.textContent = '파일 선택';
  const inputNode = document.createElement('input');
  inputNode.id = 'fileInput';
  inputNode.type = 'file';
  inputNode.hidden = true;
  dropzoneNode.append(dropTitle, dropSub, pickButton, inputNode);
  const message = document.createElement('div');
  message.className = 'message';
  message.id = 'message';
  message.setAttribute('role', 'status');
  dropSection.append(dropzoneNode, message);

  const nav = document.createElement('nav');
  nav.className = 'tabs';
  nav.id = 'tabs';
  nav.setAttribute('aria-label', '카드 보기 탭');
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'panel';
  // 카드가 없어도 사용자가 스키마를 명시 활성화했으면 플레이 화면을 연다 — 랜딩 데드엔드 방지.
  if (state.shellMode === 'player' && !state.parsed && !schemaActivated) {
    const landing = document.createElement('section');
    landing.className = 'landing-hero';
    const heroTitle = document.createElement('h2');
    heroTitle.textContent = '봇카드를 게임으로';
    const heroCopy = document.createElement('p');
    heroCopy.textContent = '봇카드를 드롭하면 캐릭터와 플레이할 수 있는 게임으로 변환합니다';
    const steps = document.createElement('ol');
    steps.className = 'landing-steps';
    for (const text of ['카드 드롭', '(선택) 게임 변환·승인', '플레이']) { const li = document.createElement('li'); li.textContent = text; steps.append(li); }
    const creatorLink = document.createElement('button');
    creatorLink.type = 'button'; creatorLink.className = 'text-link'; creatorLink.textContent = '카드 없이 제작자 도구 열기';
    creatorLink.addEventListener('click', enterCreator);
    landing.append(heroTitle, heroCopy, dropSection, steps, creatorLink);
    main.append(landing);
    header.classList.add('landing-topbar');
  } else {
    main.append(inputNode, nav, panel);
  }
  app.replaceChildren(header, main);

  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) loadFile(file);
    input.value = '';
  });

  // 드롭존은 랜딩(카드 없음)에서만 DOM에 존재한다.
  if (dropzone) {
    document.getElementById('pickButton').addEventListener('click', () => input.click());
    for (const event of ['dragenter', 'dragover']) {
      dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragging');
      });
    }
    for (const event of ['dragleave', 'drop']) {
      dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragging');
      });
    }
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  if (state.shellMode === 'creator') renderTabs();
  render();
}

function shellButton(label, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = label;
  button.addEventListener('click', handler); return button;
}

function enterCreator() {
  clearTabResources(); state.shellMode = 'creator'; state.activeTab = state.parsed ? 'overview' : 'import'; renderShell();
}

function enterPlayer() {
  clearTabResources(); state.shellMode = 'player'; state.activeTab = 'play'; renderShell();
}

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.replaceChildren();
  for (const tab of tabs.filter((item) => item.id !== 'play')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.textContent = tab.label;
    button.setAttribute('aria-selected', String(state.activeTab === tab.id));
    button.disabled = !state.parsed && tab.id !== 'overview' && tab.id !== 'engine' && tab.id !== 'import';
    button.addEventListener('click', () => {
      if (state.activeTab === tab.id) return;
      clearTabResources();
      state.activeTab = tab.id;
      renderTabs();
      render();
    });
    nav.append(button);
  }
}

async function loadFile(file) {
  state.error = '';
  setMessage(`파싱 중: ${file.name}`);
  clearTabResources();
  revokeViewUrls();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseCard(bytes, file.name, { lazy: true });
    const lore = extractLorebook(parsed.card);
    state.parsed = parsed;
    state.lore = lore;
    state.file = { name: file.name, size: file.size, type: file.type || '' };
    state.activeTab = 'play';
    state.shellMode = 'player';
    const primary = primaryCharacter(parsed, lore);
    state.cardTheme = await applyCardTheme(primary.asset, objectUrlFor);
    const decoded = parsed.assets.filter((asset) => asset.bytes).length;
    console.info('[simbot] parsed card', {
      format: parsed.format,
      name: parsed.name,
      assets: parsed.assets.length,
      decodedAssetsImmediatelyAfterParse: decoded,
      lazy: !!parsed.lazy,
    });
    setMessage(`로드 완료: ${parsed.name || file.name}`);
  } catch (err) {
    state.parsed = null;
    state.lore = null;
    state.file = null;
    state.error = err && err.message ? err.message : String(err);
    setMessage(`파싱 실패: ${state.error}`);
  }
  renderShell();
}

function render() {
  const status = document.getElementById('loadStatus');
  if (!status) return;
  status.textContent = state.parsed ? `${state.parsed.format} · ${state.parsed.assets.length} assets` : '카드 없음';

  const panel = document.getElementById('panel');
  if (!panel) { setMessage(state.error ? `파싱 실패: ${state.error}` : ''); return; }
  panel.replaceChildren();

  const ctx = createContext();
  if (state.activeTab === 'engine') {
    state.cleanup = renderEngineView(panel, ctx);
    return;
  }
  if (state.activeTab === 'play') {
    state.cleanup = renderPlayView(panel, ctx);
    return;
  }
  if (state.activeTab === 'import') {
    state.cleanup = renderImportView(panel, ctx);
    return;
  }

  if (!state.parsed) {
    panel.append(renderEmptyOverview());
    return;
  }

  if (state.activeTab === 'overview') panel.append(renderOverview(ctx));
  if (state.activeTab === 'npc') state.cleanup = renderNpcGallery(panel, ctx);
  if (state.activeTab === 'lorebook') state.cleanup = renderLorebookView(panel, ctx);
  if (state.activeTab === 'activate') state.cleanup = renderActivateView(panel, ctx);
  if (state.activeTab === 'assets') state.cleanup = renderAssetsView(panel, ctx);
}

function isAllowedFetchUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    const href = parsed.href;
    if (KNOWN_ORIGINS.some((origin) => href.startsWith(origin))) return true;
    if (parsed.protocol === 'https:' && isAiplatformHost(parsed.hostname)) return true;
    return !!allowedCustomOrigin && parsed.protocol === 'https:' && parsed.origin === allowedCustomOrigin;
  } catch (_) {
    return false;
  }
}

function isAiplatformHost(hostname) {
  return hostname === 'aiplatform.googleapis.com' || /^[a-z0-9-]+-aiplatform\.googleapis\.com$/i.test(hostname);
}

function createContext() {
  return {
    parsed: state.parsed,
    lore: state.lore,
    file: state.file,
    objectUrlFor,
    revokeViewUrls,
    formatBytes,
    goToPlay: () => { schemaActivated = true; enterPlayer(); },
  };
}

function renderEmptyOverview() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const title = document.createElement('h2');
  title.textContent = '카드를 로드하면 내부 구조를 표시합니다';
  const body = document.createElement('p');
  body.textContent = state.error || '드롭존 또는 파일 선택 버튼을 사용하세요. 모든 처리는 브라우저 메모리 안에서만 수행됩니다.';
  wrap.append(title, body);
  return wrap;
}

function renderOverview(ctx) {
  const { parsed, lore, file } = ctx;
  const data = (parsed.card && parsed.card.data) || {};
  const stats = lore ? loreStats(lore.entries) : null;
  const firstMes = String(data.first_mes == null ? '' : data.first_mes);
  const postHistory = String(data.post_history_instructions == null ? '' : data.post_history_instructions);
  const decoded = parsed.assets.filter((asset) => asset.bytes).length;
  const npcClusters = buildNpcClusters(parsed, lore);

  const wrap = document.createElement('div');
  wrap.className = 'overview-grid';
  wrap.append(
    statCard('카드 이름', parsed.name || file.name),
    statCard('포맷', `${parsed.format || '-'} · ${parsed.spec || '-'} ${parsed.specVersion || ''}`.trim()),
    statCard('파일 크기', formatBytes(file.size)),
    statCard('로어북', lore ? `${stats.total}개 · 상시 ${stats.constant}개` : '없음'),
    statCard('에셋', `${parsed.assets.length}개 · 즉시 디코드 ${decoded}개`),
    statCard('NPC 연결', `${npcClusters.linkedCount}/${npcClusters.groups.length} 클러스터`)
  );

  if (state.avifSupported === false && parsed.assets.some((asset) => String(asset.ext).toLowerCase() === 'avif')) {
    const banner = document.createElement('div');
    banner.className = 'warning-banner';
    banner.textContent = '이 브라우저는 AVIF 이미지를 표시하지 못할 수 있습니다. 표본 카드의 대부분 에셋은 AVIF입니다.';
    wrap.prepend(banner);
  }

  const lengths = document.createElement('section');
  lengths.className = 'wide-section';
  lengths.append(
    sectionTitle('프롬프트 길이'),
    keyValueList([
      ['first_mes', `${firstMes.length.toLocaleString()}자`],
      ['post_history_instructions', `${postHistory.length.toLocaleString()}자`],
      ['lazy 근거', parsed.lazy ? `원본 버퍼 보존, 에셋 bytes=${decoded}` : `즉시 파싱 포맷, 에셋 bytes=${decoded}`],
    ])
  );

  const details = document.createElement('details');
  details.className = 'source-preview wide-section';
  const summary = document.createElement('summary');
  summary.textContent = '카드 원문 프리뷰';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(parsed.card, null, 2).slice(0, 24000);
  details.append(summary, pre);

  wrap.append(lengths, details);
  return wrap;
}

function statCard(label, value) {
  const el = document.createElement('section');
  el.className = 'stat-card';
  const k = document.createElement('div');
  k.className = 'stat-label';
  k.textContent = label;
  const v = document.createElement('div');
  v.className = 'stat-value';
  v.textContent = value;
  el.append(k, v);
  return el;
}

function sectionTitle(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function keyValueList(rows) {
  const dl = document.createElement('dl');
  dl.className = 'kv-list';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}

function objectUrlFor(asset) {
  if (!asset || !asset.found) return '';
  if (state.viewUrls.has(asset)) return state.viewUrls.get(asset);
  const bytes = cardAssetBytes(state.parsed, asset);
  if (!bytes) return '';
  const url = URL.createObjectURL(new Blob([bytes], { type: asset.mime || 'application/octet-stream' }));
  state.viewUrls.set(asset, url);
  return url;
}

function clearTabResources() {
  if (typeof state.cleanup === 'function') state.cleanup();
  state.cleanup = null;
  revokeViewUrls();
}

function revokeViewUrls() {
  for (const url of state.viewUrls.values()) URL.revokeObjectURL(url);
  state.viewUrls.clear();
}

function setMessage(text) {
  const el = document.getElementById('message');
  if (el) el.textContent = text;
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function detectAvifSupport() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0);
    img.onerror = () => resolve(false);
    img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAAPBtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAAAEQAABAAAAAQAAABIAAAAoAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAAGF2MDFJbWFnZQAAAAAOcGl4aQAAAAADCAgIAAAAFWlzcGUAAAAAAAAAAQAAAAEAAAAQcGFzcAAAAAEAAAABAAAAFGNvbHJuY2x4AAEABQABAAAAGGlwbWEAAAAAAAAAAQABBAUBgYAAAEdtZGF0EgAKBzgABogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  });
}

window.SIMBOT_DEBUG = {
  getState: () => state,
  buildNpcClusters: () => state.parsed ? buildNpcClusters(state.parsed, state.lore) : null,
};
