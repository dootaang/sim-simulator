const schema = require('../../schema/yongsa-inn.v0.json');
const { createState } = require('../../engine/core/createState.js');
const { applyEvent } = require('../../engine/core/applyEvent.js');
const { createRng } = require('../../engine/core/rng.js');
const { summarize, npcSummary, roomStatus, availableMenu, staffMax } = require('../../engine/core/selectors.js');

let seedValue = 42;
let engineState = createState(schema, seedValue);
let rng = createRng(seedValue);
let logs = [];
let eventCount = 0;
let selectedEvent = 'checkin';

const eventTypes = [
  'checkin',
  'checkout',
  'sale',
  'purchase',
  'hire',
  'fire',
  'scale_delta',
  'rep_event',
  'exp_gain',
  'gold_delta',
  'resource_delta',
  'day_end',
];

export function renderEngineView(container, ctx) {
  const root = el('div', 'engine-view');
  container.append(root);

  const render = () => {
    root.replaceChildren();
    root.append(renderHeader(render), renderBody(render, ctx));
  };
  render();
  return () => {};
}

function resetSession(seed) {
  seedValue = Number.isFinite(Number(seed)) ? Number(seed) : 42;
  engineState = createState(schema, seedValue);
  rng = createRng(seedValue);
  logs = [];
  eventCount = 0;
}

function renderHeader(render) {
  const header = el('div', 'view-header engine-header');
  const title = el('div');
  const h2 = el('h2');
  h2.textContent = '엔진(실험)';
  const p = el('p');
  p.textContent = '게임 상태를 엔진(코드)이 계산합니다 - LLM 없음';
  title.append(h2, p);

  const controls = el('div', 'engine-header-controls');
  const seed = input('number', String(seedValue));
  seed.setAttribute('aria-label', '시드');
  seed.addEventListener('change', () => {
    resetSession(seed.value);
    render();
  });

  const reset = button('리셋', 'secondary-btn');
  reset.addEventListener('click', () => {
    resetSession(seed.value);
    render();
  });

  const endDay = button('하루 마감', 'primary-btn engine-day-btn');
  endDay.addEventListener('click', () => {
    runEvent({ id: 'day_end', params: {} });
    render();
  });

  const meta = el('div', 'status-pill engine-status');
  meta.textContent = `${engineState.day}일차 · 이벤트 ${eventCount}`;
  controls.append(labelInline('Seed', seed), reset, endDay, meta);
  header.append(title, controls);
  return header;
}

function renderBody(render, ctx) {
  const layout = el('div', 'engine-layout');
  layout.append(renderStatePanel(ctx), renderConsole(render));
  return layout;
}

function renderStatePanel(ctx) {
  const panel = el('section', 'engine-state-panel');
  const summary = el('pre', 'engine-summary');
  summary.textContent = summarize(schema, engineState);

  const statGrid = el('div', 'engine-stat-grid');
  statGrid.append(
    stat('Gold', formatMoney(engineState.gold)),
    stat('Food', `${engineState.resources.food || 0} 인분`),
    stat('Drink', `${engineState.resources.drink || 0} 잔`),
    stat('Facilities', facilityText(engineState.facilities))
  );

  panel.append(summary, statGrid, renderRooms(), renderStaff(), renderReputation(), renderChangedNpcs());
  return panel;
}

function renderRooms() {
  const section = titledSection('객실');
  const grid = el('div', 'engine-room-grid');
  for (const room of roomStatus(schema, engineState)) {
    const card = el('article', `engine-room${room.locked ? ' locked' : ''}`);
    const title = el('strong');
    title.textContent = `${room.no}호 · ${room.kind}`;
    const meta = el('div', 'muted-line');
    meta.textContent = room.locked
      ? `잠금 · 객실동 Lv.${room.requiresRoomLevel} 필요`
      : room.occupants.length
        ? room.occupants.map((guest) => `${guest.guestName}(${guest.nightsLeft}박)`).join(', ')
        : '공실';
    card.append(title, meta);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function renderStaff() {
  const section = titledSection('직원');
  const max = staffMax(schema, engineState);
  const wage = engineState.staff.reduce((sum, staff) => sum + Number(staff.dailyWage || 0), 0);
  const line = el('p', 'muted-line');
  line.textContent = `고용 ${engineState.staff.length}/${max} · 일급 합계 ${formatMoney(wage)}`;
  section.append(line);
  if (engineState.unpaidWages > 0) {
    const warning = el('p', 'engine-warning');
    warning.textContent = `미지급 임금 ${formatMoney(engineState.unpaidWages)}`;
    section.append(warning);
  }
  const list = el('div', 'engine-list');
  if (!engineState.staff.length) {
    const empty = el('div', 'muted-line');
    empty.textContent = '없음';
    list.append(empty);
  } else {
    for (const staff of engineState.staff) {
      const row = el('div', 'engine-list-row');
      row.textContent = `${npcName(staff.npcId)} · ${formatMoney(staff.dailyWage)}`;
      list.append(row);
    }
  }
  section.append(list);
  return section;
}

function renderReputation() {
  const section = titledSection('평판');
  const labels = reputationLadder().axisLabels || {};
  const list = el('div', 'engine-list');
  for (const [axis, value] of Object.entries(engineState.reputation)) {
    const row = el('div', 'engine-list-row');
    row.textContent = `${labels[axis] || axis}: ${value.rank}(${value.exp})`;
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderChangedNpcs() {
  const section = titledSection('NPC 호감도');
  const changed = Object.entries(engineState.npcs).filter(([, data]) => data.affinity !== 50);
  if (!changed.length) {
    const empty = el('p', 'muted-line');
    empty.textContent = '변동 없음';
    section.append(empty);
    return section;
  }
  const list = el('div', 'engine-list');
  for (const [npcId] of changed) {
    const row = el('div', 'engine-list-row');
    row.textContent = npcSummary(schema, engineState, npcId);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderConsole(render) {
  const panel = el('section', 'engine-console');
  const form = el('div', 'engine-form');
  const select = el('select');
  for (const type of eventTypes) appendOption(select, type, type, false);
  select.value = selectedEvent;
  select.addEventListener('change', () => {
    selectedEvent = select.value;
    render();
  });
  form.append(field('이벤트', select), renderParamForm(selectedEvent));

  const run = button('실행', 'primary-btn');
  run.addEventListener('click', () => {
    runEvent(collectEvent(selectedEvent, form));
    render();
  });
  form.append(run);

  const logList = el('div', 'engine-log-list');
  for (const entry of logs) logList.append(renderLog(entry));
  if (!logs.length) {
    const empty = el('p', 'muted-line');
    empty.textContent = '아직 실행한 이벤트가 없습니다.';
    logList.append(empty);
  }

  panel.append(form, logList);
  return panel;
}

function renderParamForm(type) {
  const wrap = el('div', 'engine-param-grid');
  if (type === 'checkin') {
    wrap.append(field('객실', roomSelect()), field('투숙객', namedInput('guestName', 'silvia')), field('박수', namedInput('stayDays', '2', 'number')));
  } else if (type === 'checkout') {
    wrap.append(field('투숙객', occupantSelect()));
  } else if (type === 'sale') {
    wrap.append(field('메뉴', menuSelect()), field('수량', namedInput('qty', '1', 'number')));
  } else if (type === 'purchase') {
    wrap.append(field('자원', resourceSelect('resource')), field('수량', namedInput('qty', '1', 'number')), pricePreview());
  } else if (type === 'hire') {
    wrap.append(field('NPC', npcSelect(false)), field('일급', namedInput('dailyWage', '100000', 'number')));
  } else if (type === 'fire') {
    wrap.append(field('직원', staffSelect()));
  } else if (type === 'scale_delta') {
    wrap.append(field('NPC', npcSelect(true)), field('방향', directionSelect()), field('크기', sizeSelect()), field('charBonus', bonusSelect()), field('사유', namedInput('reason', '')));
  } else if (type === 'rep_event') {
    const axis = repAxisSelect();
    const category = repCategorySelect(axis.value);
    axis.addEventListener('change', () => {
      fillRepCategories(category, axis.value);
    });
    wrap.append(field('축', axis), field('카테고리', category), field('사유', namedInput('reason', '')));
  } else if (type === 'exp_gain') {
    wrap.append(field('카테고리', expCategorySelect()), field('사유', namedInput('reason', '')));
  } else if (type === 'gold_delta') {
    wrap.append(field('금액', namedInput('amount', '10000', 'number')), field('사유', namedInput('reason', '')));
  } else if (type === 'resource_delta') {
    wrap.append(field('자원', resourceSelect('resource')), field('수량 변화', namedInput('amount', '1', 'number')), field('사유', namedInput('reason', '')));
  } else if (type === 'day_end') {
    const p = el('p', 'muted-line');
    p.textContent = '파라미터 없음';
    wrap.append(p);
  }
  return wrap;
}

function collectEvent(type, form) {
  const get = (name) => form.querySelector(`[name="${name}"]`);
  const value = (name) => {
    const node = get(name);
    return node ? node.value : '';
  };
  const number = (name) => Number(value(name));

  const params = {};
  if (type === 'checkin') Object.assign(params, { roomNo: Number(value('roomNo')), guestName: value('guestName'), stayDays: number('stayDays') });
  if (type === 'checkout') Object.assign(params, parseOccupant(value('occupant')));
  if (type === 'sale') Object.assign(params, { menuName: value('menuName'), qty: number('qty') });
  if (type === 'purchase') Object.assign(params, { resource: value('resource'), qty: number('qty') });
  if (type === 'hire') Object.assign(params, { npcId: value('npcId'), dailyWage: number('dailyWage') });
  if (type === 'fire') Object.assign(params, { npcId: value('npcId') });
  if (type === 'scale_delta') Object.assign(params, { scale: 'affinity', target: value('npcId'), direction: value('direction'), size: value('size'), charBonus: number('charBonus'), reason: value('reason') });
  if (type === 'rep_event') Object.assign(params, { axis: value('axis'), category: value('category'), reason: value('reason') });
  if (type === 'exp_gain') Object.assign(params, { category: value('category'), reason: value('reason') });
  if (type === 'gold_delta') Object.assign(params, { amount: number('amount'), reason: value('reason') });
  if (type === 'resource_delta') Object.assign(params, { resource: value('resource'), amount: number('amount'), reason: value('reason') });
  return { id: type, params };
}

function runEvent(event) {
  const result = applyEvent(schema, engineState, event, rng);
  if (result.log.some((entry) => entry.ok)) {
    engineState = result.state;
  }
  eventCount += 1;
  logs.unshift({ event, entries: result.log, index: logs.length + 1 });
}

function renderLog(item) {
  const details = el('details', 'engine-log-entry');
  details.open = true;
  const summary = el('summary');
  const first = item.entries[0] || {};
  const badge = el('span', first.ok ? 'badge engine-ok' : 'badge engine-fail');
  badge.textContent = first.ok ? 'ok' : 'fail';
  const text = el('span');
  text.textContent = summarizeLog(item.event.id, first);
  summary.append(badge, text);
  details.append(summary);

  if (first.tierChanged) {
    const chip = el('span', 'decorator-chip engine-tier-chip');
    chip.textContent = `${first.tierChanged.from.label} -> ${first.tierChanged.to.label}`;
    details.append(chip);
  }
  if (first.report) details.append(renderReport(first.report));
  if (!first.ok) {
    const reason = el('p', 'engine-warning');
    reason.textContent = `${first.reason}${first.detail ? `: ${first.detail}` : ''}`;
    details.append(reason);
  }
  return details;
}

function renderReport(report) {
  const wrap = el('div', 'engine-report');
  const p = el('p', 'muted-line');
  p.textContent = `고객 ${report.customers} · 매출 ${formatMoney(report.grossGold)} · 임금 ${formatMoney(report.wagesPaid)}/${formatMoney(report.wagesDue)} · 못 판 고객 ${report.turnedAway}`;
  wrap.append(p);
  const table = el('table', 'engine-table');
  const head = el('tr');
  for (const label of ['메뉴', '수량', '금액']) {
    const th = el('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);
  for (const sale of report.sales) {
    const row = el('tr');
    for (const value of [sale.menuName, sale.qty, formatMoney(sale.price)]) {
      const td = el('td');
      td.textContent = String(value);
      row.append(td);
    }
    table.append(row);
  }
  wrap.append(table);
  if (report.checkouts.length) {
    const checkout = el('p', 'muted-line');
    checkout.textContent = `체크아웃: ${report.checkouts.map((item) => `${item.roomNo}호 ${item.guestName}`).join(', ')}`;
    wrap.append(checkout);
  }
  return wrap;
}

function summarizeLog(type, entry) {
  if (!entry.ok) return `${type} 실패`;
  if (type === 'scale_delta') return entry.capped ? `${entry.target} capped · ${entry.before} -> ${entry.after}` : `${entry.target} ${entry.before} -> ${entry.after}`;
  if (type === 'rep_event') return `${entry.axis}/${entry.category} ${entry.before.rank}(${entry.before.exp}) -> ${entry.after.rank}(${entry.after.exp}), delta ${entry.delta}`;
  if (type === 'day_end') return `하루 마감 · ${entry.report.day}일차 정산`;
  if (entry.goldDelta != null) return `${type} · gold ${entry.goldDelta >= 0 ? '+' : ''}${formatMoney(entry.goldDelta)}`;
  return `${type} 실행`;
}

function roomSelect() {
  const select = namedSelect('roomNo');
  for (const room of roomStatus(schema, engineState)) {
    const disabled = room.locked;
    const label = disabled ? `${room.no}호 - 객실동 Lv.${room.requiresRoomLevel} 필요` : `${room.no}호 · ${room.kind}`;
    appendOption(select, room.no, label, disabled);
  }
  select.value = '106';
  return select;
}

function occupantSelect() {
  const select = namedSelect('occupant');
  const occupants = [];
  for (const [roomNo, guests] of Object.entries(engineState.rooms)) {
    for (const guest of guests) occupants.push({ roomNo, guestName: guest.guestName });
  }
  if (!occupants.length) appendOption(select, '', '현재 투숙객 없음', true);
  for (const guest of occupants) appendOption(select, `${guest.roomNo}|${guest.guestName}`, `${guest.roomNo}호 · ${guest.guestName}`, false);
  return select;
}

function menuSelect() {
  const select = namedSelect('menuName');
  for (const menu of availableMenu(schema, engineState)) {
    appendOption(select, menu.name, `${menu.category} · ${menu.name} · ${formatMoney(menu.price)}`, false);
  }
  select.value = select.querySelector('option[value="고기 스튜"]') ? '고기 스튜' : select.value;
  return select;
}

function resourceSelect(name) {
  const select = namedSelect(name);
  appendOption(select, 'food', '식자재', false);
  appendOption(select, 'drink', '주류', false);
  return select;
}

function npcSelect(includeHired) {
  const select = namedSelect('npcId');
  const hired = new Set(engineState.staff.map((staff) => staff.npcId));
  for (const npc of npcs()) {
    if (!includeHired && hired.has(npc.id)) continue;
    appendOption(select, npc.id, `${npc.nameKo} · ${npc.class || npc.group || ''}`, false);
  }
  select.value = select.querySelector('option[value="silvia"]') ? 'silvia' : select.value;
  return select;
}

function staffSelect() {
  const select = namedSelect('npcId');
  if (!engineState.staff.length) appendOption(select, '', '재직 직원 없음', true);
  for (const staff of engineState.staff) appendOption(select, staff.npcId, npcName(staff.npcId), false);
  return select;
}

function directionSelect() {
  const select = namedSelect('direction');
  appendOption(select, '+', '+', false);
  appendOption(select, '-', '-', false);
  return select;
}

function sizeSelect() {
  const select = namedSelect('size');
  for (const size of ['S', 'M', 'L', 'XL']) appendOption(select, size, size, false);
  select.value = 'M';
  return select;
}

function bonusSelect() {
  const select = namedSelect('charBonus');
  for (const value of ['-1', '0', '1']) appendOption(select, value, value, false);
  select.value = '0';
  return select;
}

function repAxisSelect() {
  const select = namedSelect('axis');
  const ladder = reputationLadder();
  for (const axis of ladder.axes) appendOption(select, axis, ladder.axisLabels[axis] || axis, false);
  return select;
}

function repCategorySelect(axis) {
  const select = namedSelect('category');
  fillRepCategories(select, axis);
  return select;
}

function fillRepCategories(select, axis) {
  select.replaceChildren();
  const ladder = reputationLadder();
  for (const category of Object.keys(ladder.categories[axis])) appendOption(select, category, category, false);
}

function expCategorySelect() {
  const select = namedSelect('category');
  const ladder = schema.ladders.find((entry) => entry.id === 'player_level');
  for (const category of Object.keys(ladder.sources)) appendOption(select, category, category, false);
  return select;
}

function pricePreview() {
  const p = el('p', 'muted-line engine-preview');
  p.textContent = '단가: 식자재 3,000 / 주류 5,000';
  return p;
}

function parseOccupant(value) {
  const [roomNo, guestName] = String(value || '').split('|');
  return { roomNo: Number(roomNo), guestName };
}

function reputationLadder() {
  return schema.ladders.find((entry) => entry.id === 'reputation');
}

function npcs() {
  return schema.entities.find((entry) => entry.type === 'npc').instances;
}

function npcName(npcId) {
  const npc = npcs().find((entry) => entry.id === npcId);
  return (npc && npc.nameKo) || npcId;
}

function facilityText(facilities) {
  return `주점${facilities.tavern} / 주방${facilities.kitchen} / 객실${facilities.room} / 숙소${facilities.quarters}`;
}

function stat(label, value) {
  const card = el('section', 'stat-card engine-stat');
  const k = el('div', 'stat-label');
  k.textContent = label;
  const v = el('div', 'stat-value');
  v.textContent = value;
  card.append(k, v);
  return card;
}

function titledSection(title) {
  const section = el('section', 'engine-section');
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

function labelInline(label, child) {
  const wrap = el('label', 'engine-inline-field');
  const span = el('span');
  span.textContent = label;
  wrap.append(span, child);
  return wrap;
}

function namedInput(name, value, type = 'text') {
  const node = input(type, value);
  node.name = name;
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

function input(type, value) {
  const node = el('input');
  node.type = type;
  node.value = value;
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
