import { availableActions, availableManagement } from '../../engine/core/selectors.js';
import { evaluateCondition, normalizeScreens, resolveEvent, selectScreenData } from '../core/screens/runtime.js';
import { el, button } from './ui/dom.js';

const uiByProject = new Map();

export function renderDeclarativePlayer(ctx, api) {
  const manifest = ctx.simpack;
  if (!manifest || !manifest.runtime || !Array.isArray(manifest.runtime.screens) || !manifest.runtime.screens.length) return null;
  const normalized = normalizeScreens(manifest.runtime.screens, manifest.runtime.navigation);
  if (!normalized.screens.length) return null;
  const projectId = manifest.id || 'project';
  const ui = uiByProject.get(projectId) || { activeScreenId: normalized.navigation[0]?.screenId || normalized.screens[0].id, modalScreenId: null, selection: {} };
  uiByProject.set(projectId, ui);
  const context = { state: api.state(), schema: api.schema(), content: manifest.content || {}, selection: ui.selection, options: manifest.runtime.options || {}, featureToggles: manifest.runtime.featureToggles || {} };
  const visibleScreens = normalized.screens.filter((screen) => evaluateCondition(screen.visibleWhen, context));
  if (!visibleScreens.some((screen) => screen.id === ui.activeScreenId && screen.presentation === 'page')) ui.activeScreenId = visibleScreens.find((screen) => screen.presentation === 'page')?.id || visibleScreens[0]?.id;

  const root = el('div', 'declarative-player');
  const nav = el('nav', 'declarative-nav'); nav.setAttribute('aria-label', '프로젝트 화면');
  for (const item of normalized.navigation.filter((entry) => evaluateCondition(entry.visibleWhen, context))) {
    const target = visibleScreens.find((screen) => screen.id === item.screenId); if (!target) continue;
    const control = button(item.label, ui.activeScreenId === target.id ? 'declarative-nav-active' : 'secondary-btn');
    control.addEventListener('click', () => { if (target.presentation === 'page') ui.activeScreenId = target.id; else ui.modalScreenId = target.id; api.render(); });
    nav.append(control);
  }
  root.append(nav);
  const active = visibleScreens.find((screen) => screen.id === ui.activeScreenId) || visibleScreens[0];
  if (active) {
    root.append(renderScreen(active, context, api, ui));
    const widgets = Object.values(active.regions).flat();
    if (!widgets.some((widget) => widget && widget.widget === 'chat')) {
      const core = el('div', 'declarative-core-play'); core.append(api.chat());
      if (!widgets.some((widget) => widget && widget.widget === 'sidebar')) core.append(api.sidebar());
      root.append(core);
    }
  }
  const modal = visibleScreens.find((screen) => screen.id === ui.modalScreenId && screen.presentation !== 'page');
  if (modal) {
    const overlay = el('div', `declarative-${modal.presentation}`); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const panel = renderScreen(modal, context, api, ui); const close = button('닫기', 'secondary-btn'); close.addEventListener('click', () => { ui.modalScreenId = null; api.render(); }); panel.prepend(close); overlay.append(panel); root.append(overlay);
  }
  return root;
}

function renderScreen(screen, context, api, ui) {
  const section = el('section', `declarative-screen layout-${safeClass(screen.layout)}`); section.dataset.screenId = screen.id;
  const heading = el('h2'); heading.textContent = screen.title; section.append(heading);
  for (const [regionId, widgets] of Object.entries(screen.regions)) {
    const region = el('div', `declarative-region region-${safeClass(regionId)}`); region.dataset.region = regionId;
    for (const widget of widgets || []) if (widget && evaluateCondition(widget.visibleWhen, context)) region.append(renderWidget(widget, context, api, ui));
    section.append(region);
  }
  return section;
}

function renderWidget(widget, context, api, ui) {
  if (widget.widget === 'chat') return api.chat();
  if (widget.widget === 'sidebar') return api.sidebar();
  const box = el('section', `declarative-widget widget-${safeClass(widget.widget || 'unknown')}`);
  if (widget.title) { const title = el('h3'); title.textContent = String(widget.title); box.append(title); }
  const data = selectScreenData(widget.source, context, selectors(api));
  const type = String(widget.widget || '');
  if (type === 'stat-strip') renderStats(box, data);
  else if (type === 'gauge') renderGauge(box, data, widget.props || {});
  else if (['entity-card', 'card-list', 'quest-board', 'inventory-grid', 'facility-grid', 'map-nodes', 'crafting-queue', 'timeline'].includes(type)) renderCards(box, data, widget, ui, api);
  else if (type === 'table') renderTable(box, data);
  else if (type === 'slot-grid') renderSlots(box, data);
  else if (type === 'calendar') renderCalendar(box, data);
  else if (type === 'combat-hud') renderCombat(box, data);
  else if (['action-group', 'decision-card'].includes(type)) renderActions(box, Array.isArray(data) ? data : widget.actions || [], context, api);
  else if (type === 'detail-panel') renderDetail(box, data);
  else { const pre = el('pre'); pre.textContent = data == null ? `지원하지 않는 위젯: ${type}` : JSON.stringify(data, null, 2); box.append(pre); }
  return box;
}

function selectors(api) {
  return {
    'core.summary': ({ state }) => Object.entries({ day: state.day, gold: state.gold }).filter(([, value]) => value != null).map(([label, value]) => ({ label, value })),
    'core.resources': ({ state, schema }) => Object.entries(state.resources || {}).map(([id, value]) => ({ id, label: (schema.resources || []).find((item) => item.id === id)?.label || id, value })),
    'core.inventory': ({ state }) => Object.entries(state.inventory || state.resources || {}).map(([id, value]) => ({ id, label: id, value })),
    'core.facilities': ({ state }) => Object.entries(state.facilities || {}).map(([id, value]) => ({ id, label: id, value })),
    'core.locations': ({ content, state }) => (content.locations || []).map((location) => ({ ...location, selected: state.location === location.id })),
    'core.calendar': ({ state }) => ({ day: state.day, time: state.time || null }),
    'core.jobs': ({ state }) => state.jobs || [],
    'progression.summary': ({ schema, state }) => api.select('progression/summary', schema, state),
    'equipment.slots': ({ schema, state }) => api.select('equipment/slots', schema, state),
    'party.formation': ({ schema, state }) => api.select('party/formation', schema, state),
    'time.current': ({ schema, state }) => api.select('time/current', schema, state),
    'location.map': ({ schema, state }) => api.select('location/map', schema, state),
    'quests.list': ({ schema, state }) => api.select('quests/list', schema, state),
    'crafting.recipes': ({ schema, state }) => api.select('crafting/recipes', schema, state),
    'factions.list': ({ schema, state }) => api.select('factions/list', schema, state),
    'jobs.queue': ({ schema, state }) => api.select('jobs/queue', schema, state),
    'rpg.quests': ({ schema, state }) => (schema.quests || []).map((quest) => ({ ...quest, completed: !!(state.completedQuests || {})[quest.id] })),
    'combat.hud': ({ state }) => state.combat ? { ...state.combat, player: state.player && state.player.pools && state.player.pools.hp } : null,
    'combat.actions': ({ schema, state }) => {
      const selected = availableActions(schema, state);
      if (!selected.active) return [];
      return (selected.actions || []).map((action) => {
        if (action.type === 'item') return { ...action, label: action.label, event: { id: 'use_item', params: { itemId: action.itemId } } };
        const params = { action: action.type, ...(action.skill ? { skill: action.skill } : {}), ...(action.targets && action.targets[0] ? { target: action.targets[0].id } : {}) };
        return { ...action, label: action.name || action.type, event: { id: 'combat_action', params } };
      });
    },
    'core.management': ({ schema, state }) => availableManagement(schema, state),
  };
}

function renderStats(box, data) { const row = el('div', 'declarative-stat-strip'); for (const item of asList(data)) { const stat = el('div', 'declarative-stat'); const k = el('span'); k.textContent = String(item.label ?? item.id ?? ''); const v = el('strong'); v.textContent = String(item.value ?? ''); stat.append(k, v); row.append(stat); } box.append(row); }
function renderGauge(box, data, props) { const value = Number((data && (data.cur ?? data.value)) ?? 0); const max = Math.max(1, Number((data && data.max) ?? props.max ?? 100)); const label = el('div'); label.textContent = `${props.label || ''} ${value}/${max}`; const meter = el('progress'); meter.max = max; meter.value = Math.max(0, Math.min(max, value)); box.append(label, meter); }
function renderCards(box, data, widget, ui, api) { const grid = el('div', 'declarative-card-grid'); for (const [index, item] of asList(data).entries()) { const card = button(String(item.label || item.name || item.title || item.id || index), 'declarative-card'); const sub = el('small'); sub.textContent = String(item.value ?? item.desc ?? item.description ?? ''); card.append(sub); card.addEventListener('click', () => { ui.selection[widget.selectionKey || 'selectedId'] = item.id ?? index; if (widget.onSelect) runAction(widget.onSelect, { ...api.context(), selection: ui.selection }, api); else api.render(); }); grid.append(card); } box.append(grid); }
function renderTable(box, data) { const rows = asList(data); const table = el('table'); const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {})))).slice(0, 8); const head = el('tr'); keys.forEach((key) => { const th = el('th'); th.textContent = key; head.append(th); }); table.append(head); rows.forEach((row) => { const tr = el('tr'); keys.forEach((key) => { const td = el('td'); td.textContent = String(row[key] ?? ''); tr.append(td); }); table.append(tr); }); box.append(table); }
function renderSlots(box, data) { const grid = el('div', 'declarative-slots'); for (const item of asList(data)) { const slot = el('div', 'declarative-slot'); slot.textContent = `${item.slot || item.id || 'slot'}: ${item.name || item.itemId || '비어 있음'}`; grid.append(slot); } box.append(grid); }
function renderCalendar(box, data) { const value = el('div', 'declarative-calendar'); value.textContent = `${data && data.day != null ? data.day : '-'}일${data && data.time ? ` · ${data.time}` : ''}`; box.append(value); }
function renderCombat(box, data) { if (!data || !data.active) { box.append(document.createTextNode('전투 없음')); return; } renderGauge(box, data.player || {}, { label: '플레이어' }); for (const enemy of data.enemies || []) { const row = el('div'); row.textContent = `${enemy.name || enemy.id} ${enemy.hp && enemy.hp.cur}/${enemy.hp && enemy.hp.max}`; box.append(row); } }
function renderActions(box, actions, context, api) { const row = el('div', 'declarative-actions'); for (const action of actions || []) { const control = button(String(action.label || action.name || action.id || action.type || '행동'), 'primary-btn'); control.disabled = action.enabled === false || action.affordable === false; control.addEventListener('click', () => runAction(action.event || action, context, api)); row.append(control); } box.append(row); }
function renderDetail(box, data) { const pre = el('pre'); pre.textContent = data == null ? '선택 없음' : JSON.stringify(data, null, 2); box.append(pre); }
function runAction(action, context, api) { const event = resolveEvent(action, context); if (event) api.event(event); }
function asList(value) { if (Array.isArray(value)) return value; if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => item && typeof item === 'object' ? { id, ...item } : ({ id, label: id, value: item })); return []; }
function safeClass(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-'); }
