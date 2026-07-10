const { simulateActivation } = require('../../core/lorebook/activate.js');
const { estimateTokens } = require('../../core/lorebook/tokens.js');
const { summarize, npcSummary } = require('../../../engine/core/selectors.js');

const COMMON_PROMPT = `[절대 규칙]
1. 게임 수치(골드·재고·호감도·평판·경험치)는 외부 엔진이 계산한다. 너는 수치를 창작하거나 계산하지 마라. 상태 정보에 적힌 값만 사실로 취급하라.
2. 서사는 한국어로, 장면 중심으로 짧게(300자 내외). NPC 대사와 행동 위주. 플레이어의 행동을 대신 결정하지 마라.
3. NPC 행동은 [NPC 상태]에 적힌 티어 규범을 따른다. 금지 행동은 절대 쓰지 마라.
4. 응답의 맨 끝에, 이번 장면에서 플레이어가 한 "행동(의도)"만 아래 형식의 JSON 코드블록으로 제안하라. 사건이 없으면 빈 배열.
5. ★너는 금액·수량 이외의 어떤 숫자(골드·데미지·경험치·변동량)도 사건에 넣지 않는다. 아래 사건들은 "무엇을 했는가"만 담고, 결과 수치는 엔진이 스키마에서 계산한다. 임의 금액을 지정하는 사건은 존재하지 않는다.`;

const EVENT_PROMPT_HEADER = `[사용 가능한 사건 = 행동(의도)만. 숫자 결과는 엔진이 계산]`;
const SALE_JSON_EXAMPLE = `\`\`\`json
{"events":[{"id":"sale","params":{"menuName":"고기 스튜","qty":2}}]}
\`\`\``;
const EVENT_PROMPTS = {
  sale: `- sale {menuName, qty} — 메뉴 판매 완결 시. (엔진: 매출 가산 + 식자재 차감)
- purchase {resource:"food"|"drink", qty} — 재료 구매. (엔진: 원가 차감 + 재고 가산. 유저가 산 그 한 건만, gold 변동을 따로 넣지 마라)`,
  upgrade: `- upgrade {facility} — 시설 확장. facility는 상태의 시설 id(tavern/kitchen/room/quarters). (엔진: 비용 차감 + 레벨 상승. 비용·골드·레벨은 쓰지 마라)`,
  gather: `- gain_resource {resource:"food"|"drink", scale:"small"|"large"|"bulk", reason} — 사냥·채집·부산물로 재료를 얻을 때. (엔진: 규모 표에서 수량 결정. qty·amount·gold는 쓰지 마라)`,
  room: `- checkin {roomNo, guestName, stayDays} / checkout {roomNo, guestName} — roomNo는 [객실 목록]의 실제 호수(예: 101). (엔진: 숙박비 선불 가산)`,
  npc: `- hire {npcId, dailyWage} — 임금 합의가 대화로 완료된 경우만. dailyWage는 대화에서 합의된 값 / fire {npcId}`,
  scale: `- scale_delta {scale:"affinity", target:npcId, direction:"+"|"-", size:"S"|"M"|"L"|"XL", reason} — 크기만 분류. S=사소한 배려, M=거리 좁힘, L=깊은 유대, XL=관계 전환점. 한 NPC당 하루 1회.`,
  reputation: `- rep_event {axis, category, reason} — 평판 변동. axis·category는 [평판 카테고리] 목록에서만. (엔진이 변동값 결정)`,
  experience: `- exp_gain {category, reason} — 의미 있는 행동에만, 매 턴 금지. category는 [경험치 카테고리] 목록에서만(목록에 없으면 내지 마라). (엔진이 값 결정)`,
  dayEnd: `- day_end {} — 플레이어가 하루를 마무리할 때 ("오늘은 여기까지", "잠자리에 든다" 등). (엔진: 매출 정산·임금·체크아웃)`,
  item: `- use_item {itemId} — 소모품 사용. itemId는 [소모품 목록]의 id만. (엔진: 재고 차감 + 회복. 회복량·수치는 쓰지 마라)`,
};

const EVENT_RULES_HEADER = `[사건 규칙]
- 실제로 완결된 일만. 진행 중·계획은 사건이 아니다.
- 사건은 반드시 {"id":"사건이름","params":{...}} 형식. id는 [사용 가능한 사건] 목록의 이름만. 목록에 없는 사건·형식을 지어내지 마라.`;
const INN_EVENT_RULES = `- ★한 행동 = 사건 1개. purchase 한 건에 gold 변동을 덧붙이지 말고(엔진이 원가 차감), 손님 수·주문량을 임의로 늘려 sale을 여러 개 만들지 마라. 유저가 "하나 팔자"면 sale 1개, "더 팔자"처럼 모호하면 장면에 실제 등장해 완결된 판매만 센다. 유저가 지시하지 않은 거래(유령 구매/판매)는 절대 만들지 마라.
- 판매·구매는 재고·골드를 엔진이 검증한다. 재고·골드가 없으면 그 행동은 실패한다(무한 공짜 없음).
- ★서사 본문에 리스식 대괄호 태그([ysp_gold::...], [YSP_QUEST_CLEAR::...], [rep_event::...] 등)나 <img> 태그를 절대 쓰지 마라. 상태 변경은 오직 맨 끝의 JSON 사건으로만 표현한다(그 태그들은 우리 엔진에서 무의미하며 화면에 지저분하게 노출된다).
- npcId는 [NPC 목록]의 영문 id, menuName은 [메뉴 목록], roomNo는 [객실 목록]의 값을 정확히 그대로 사용(목록에 없으면 불가).`;
const NEUTRAL_EVENT_RULES = `- ★한 행동 = 사건 1개. 한 행동에 엔진이 계산할 결과 변동을 덧붙이지 마라. 유저가 지시하지 않은 사건은 절대 만들지 마라.
- ★서사 본문에 상태 변경 태그나 <img> 태그를 절대 쓰지 마라. 상태 변경은 오직 맨 끝의 JSON 사건으로만 표현한다.`;
const EVENT_RULES_FOOTER = `- 확신이 없으면 사건을 내지 마라. 빈 배열이 안전하다.`;

const REWARD_PROMPT_APPENDIX = `

[reward event]
- reward {questId, tier, reason} only when a quest/manual/request is complete and the reward tier is known (E~S). questId is the stable unique id for that quest, such as "boar-hunt".
- The same questId can be rewarded only once. If the player repeats "claim reward" for an already claimed quest, do not emit reward again; the engine rejects duplicates.
- The engine chooses gold from schema rewards.gold[tier]; never write amount, goldDelta, cost, qty, or any numeric reward result. Use reward only at completion/reporting time, not while work is still in progress.`;

const COMBAT_PROMPT_APPENDIX = `

[전투 사건]
- start_encounter {enemies:[{name, hp, atk?, def?, evade?, acc?, rank?}]} — 적과 조우해 전투가 시작될 때 1회만 제안한다. 적 스탯은 서사에 맞게 제안하되 시작 후에는 엔진에 고정되어 재수정할 수 없다. rank는 E~S(경험치·전리품 표 기준)다.
- combat_action {action:"attack"|"skill"|"defend"|"flee", target?, skill?} — 플레이어의 전투 행동이다. target은 [전투] 상태의 적 id(e1 등), skill은 [스킬 목록]의 id만 쓴다.
- enemy_action {enemyId, action:"attack", skill?} — 적의 반격이다. 어떤 적이 행동하는지만 정하고 결과는 엔진이 계산한다.
- end_encounter {} — 전멸(victory) 또는 도주 성공 후 전투를 닫을 때 제안한다. 보상(EXP·골드)은 엔진이 표에서 계산한다.

[전투 규칙]
- ★데미지·명중·성공여부·굴림·보상 수치를 절대 쓰지 마라. 사건에도 서사에도 단정하지 마라. 엔진 로그가 결과다.
- 죽은 적 공격·부활·없는 MP 사용은 엔진이 거부한다. 전투 중에는 [전투] 상태의 HP만 사실이다.
- 사건 흐름: 조우→start_encounter, 플레이어 턴→combat_action 1개 + 적 반격 enemy_action 1개를 같은 events 배열에 순서대로, 전멸/도주 후→end_encounter.
- [전투] 상태가 이미 표시되어 있으면 start_encounter를 절대 다시 내지 마라(엔진이 거부한다).
- 적 처치·전투 종료·승리를 서사로 단정하지 마라. 적의 생사는 [전투] 상태와 엔진 판정만이 결정한다. 모든 적이 "전투불능"으로 표시된 다음에야 end_encounter를 내라.
- 전투 중 플레이어가 공격·스킬·방어·도주를 시도하면 반드시 combat_action 사건을 내라. 사건 없는 전투 행동은 일어나지 않은 것이다.`;

function buildSystemPrompt(schema = {}) {
  const title = (schema.meta && schema.meta.title) || '시뮬레이션';
  const identity = isInnLike(schema)
    ? `당신은 판타지 여관 경영 RP "${title}"의 내레이터다. 플레이어({{user}})는 여관 주인이다.`
    : `당신은 "${title}"의 내레이터다. 플레이어({{user}})의 행동을 대신 결정하지 않고 세계와 인물의 반응을 묘사한다.`;
  const sections = [identity, COMMON_PROMPT];
  const events = eventSections(schema);
  if (events.length) {
    if (hasSaleCapability(schema)) sections.push(SALE_JSON_EXAMPLE);
    sections.push(EVENT_PROMPT_HEADER + '\n' + events.join('\n'));
  }
  sections.push(EVENT_RULES_HEADER + '\n' + (isInnLike(schema) ? INN_EVENT_RULES : NEUTRAL_EVENT_RULES) + '\n' + EVENT_RULES_FOOTER);
  if (hasGoldRewards(schema)) sections.push(REWARD_PROMPT_APPENDIX.trim());
  if (isCombatCapable(schema)) sections.push(COMBAT_PROMPT_APPENDIX.trim());
  return sections.join('\n\n');
}

// 이전 export를 유지하되, 런타임은 활성 스키마를 받는 buildSystemPrompt를 사용한다.
const SYSTEM_PROMPT = buildSystemPrompt({});

function eventSections(schema) {
  const types = new Set((schema.entities || []).map((entry) => entry.type));
  const ladders = schema.ladders || [];
  const sections = [];
  if (hasSaleCapability(schema)) sections.push(EVENT_PROMPTS.sale);
  if (types.has('facility')) sections.push(EVENT_PROMPTS.upgrade);
  if (schema.gather) sections.push(EVENT_PROMPTS.gather);
  if (types.has('room')) sections.push(EVENT_PROMPTS.room);
  if (types.has('npc')) sections.push(EVENT_PROMPTS.npc);
  if ((schema.scales || []).some((scale) => scale.owner === 'npc' || scale.owner === 'captive')) sections.push(EVENT_PROMPTS.scale);
  if (ladders.some((ladder) => ladder.id === 'reputation')) sections.push(EVENT_PROMPTS.reputation);
  if (ladders.some((ladder) => ladder.id === 'player_level' && ladder.sources)) sections.push(EVENT_PROMPTS.experience);
  if ((schema.processes || []).some((process) => process.trigger === 'dayEnd')) sections.push(EVENT_PROMPTS.dayEnd);
  if (hasConsumables(schema)) sections.push(EVENT_PROMPTS.item);
  return sections;
}

function hasConsumables(schema) {
  return (schema.resources || []).some((resource) => resource && resource.effect);
}

function hasSaleCapability(schema) {
  return (schema.entities || []).some((entry) => entry.type === 'menuItem')
    || (schema.resources || []).some((resource) => resource.basePrice != null && !resource.effect);
}

// 여관형 = 숙박(room)과 메뉴 판매(menuItem)를 둘 다 갖춘 스키마.
// menuItem만 있는 카드(예: 헌터물의 마정석 판매)에 "여관 주인" 정체성을 씌우지 않는다.
function isInnLike(schema) {
  const types = new Set((schema.entities || []).map((entry) => entry.type));
  return types.has('menuItem') && types.has('room');
}

function hasGoldRewards(schema) {
  return !!(schema.rewards && schema.rewards.gold);
}

function isCombatCapable(schema) {
  return !!(schema.combat || schema.pools);
}

function formatEngineVerdicts(chips) {
  if (!Array.isArray(chips) || !chips.length) return '';
  const lines = chips.map((chip) => chip && chip.ok
    ? `✅ ${String(chip.text || '')}`
    : `❌ ${String((chip && chip.text) || '')} → 이 사건은 무효다. 서사에서 일어난 것으로 취급하지 말고 이번 턴에 정정하라.`);
  return `[엔진 판정 — 직전 턴 사건 처리 결과]\n${lines.join('\n')}`;
}

function buildPrompt({ schema, state, lore, recentMessages, userInput, lastVerdicts }) {
  const combatCapable = isCombatCapable(schema);
  const stateText = summarize(schema, state);
  const npcIds = relatedNpcIds(schema, state, recentMessages, userInput);
  const npcText = npcIds.map((id) => npcSummary(schema, state, id)).filter(Boolean).join('\n');
  const repCats = reputationCategories(schema);
  const expCats = expCategories(schema);
  const npcList = npcListText(schema);
  const menuList = menuListText(schema, state);
  const roomList = roomListText(schema);
  const skillList = combatCapable ? skillListText(schema) : '';
  const itemList = consumableListText(schema, state);
  const loreText = loreContext(lore, recentMessages, userInput);
  const verdictText = formatEngineVerdicts(lastVerdicts);

  const context = [
    '[상태]',
    stateText,
    '',
    verdictText,
    verdictText ? '' : '',
    npcText ? '[NPC 상태]\n' + npcText + '\n' : '',
    repCats ? '[평판 카테고리]\n' + repCats + '\n' : '',
    expCats ? '[경험치 카테고리]\n' + expCats + '\n' : '',
    npcList ? '[NPC 목록]\n' + npcList + '\n' : '',
    menuList ? '[메뉴 목록]\n' + menuList + '\n' : '',
    roomList ? '[객실 목록]\n' + roomList + '\n' : '',
    combatCapable && skillList ? '[스킬 목록]\n' + skillList + '\n' : '',
    itemList ? '[소모품 목록]\n' + itemList + '\n' : '',
    '[세계 정보]',
    loreText || (lore ? '없음' : '카드를 드롭하면 세계관 로어북이 자동 주입됩니다'),
    '',
    '---',
    String(userInput || ''),
  ].filter((part) => part !== '').join('\n');

  // 컨텍스트(user)까지 포함해 병합 — 이력 끝이 user(연출문 등)면 컨텍스트와 한 메시지로 합쳐진다.
  const messages = conversationMessages([...(recentMessages || []).slice(-8), { role: 'user', content: context }]);

  const injectedParts = {
    state: estimateTokens(stateText),
    npc: estimateTokens(npcText),
    repCats: estimateTokens(repCats),
    expCats: estimateTokens(expCats),
    npcList: estimateTokens(npcList),
    menuList: estimateTokens(menuList),
    roomList: estimateTokens(roomList),
    items: estimateTokens(itemList),
    lore: estimateTokens(loreText || ''),
  };
  if (verdictText) injectedParts.verdicts = estimateTokens(verdictText);
  if (combatCapable) injectedParts.skills = estimateTokens(skillList);
  const injectedTokens = Object.values(injectedParts).reduce((sum, value) => sum + value, 0);

  return {
    system: buildSystemPrompt(schema),
    messages,
    injectedTokens,
    injectedParts,
    relatedNpcIds: npcIds,
    injectedText: { state: stateText, verdicts: verdictText, npc: npcText, repCats, npcList, items: itemList, lore: loreText },
  };
}

function buildNarrationPrompt({ schema, state, results, flavorText, recentMessages }) {
  const stateText = summarize(schema, state);
  const combatLine = stateText.split('\n').find((line) => line.startsWith('[전투]')) || '[전투] 종료됨';
  const resultText = (results || []).map((result) => typeof result === 'string' ? result : String((result && result.text) || '')).filter(Boolean).join('\n');
  const context = [
    '[확정된 전투 결과]',
    (results || []).length > 8 ? '여러 턴의 전투 전체를 시간순으로 요약 서사화하라.' : '',
    resultText || '변화 없음',
    '',
    combatLine,
    flavorText ? `플레이어의 연출 의도: ${flavorText}` : '',
  ].filter(Boolean).join('\n');
  const messages = conversationMessages([...(recentMessages || []).slice(-4), { role: 'user', content: context }]);
  const injectedParts = { state: estimateTokens(combatLine), results: estimateTokens(resultText), flavor: estimateTokens(flavorText || '') };
  return {
    system: buildSystemPrompt(schema).split('\n\n[절대 규칙]')[0] + '\n\n아래 [확정된 전투 결과]는 엔진이 이미 계산·반영한 사실이다. 이 수치·생사를 그대로 따라 한국어로 짧게(250자 내외) 서사화하라. 결과를 바꾸거나 새 사건 JSON을 내지 마라.',
    messages,
    injectedTokens: Object.values(injectedParts).reduce((sum, value) => sum + value, 0),
    injectedParts,
    relatedNpcIds: [],
    injectedText: { state: combatLine, results: resultText, flavorText: flavorText || '' },
  };
}

// 대화 이력을 API 전송용으로 정리: ①마커 전용 assistant 메시지('⚡'/'🧪' — 엔진 전용 턴 표기)를
// 제거하고 ②연속 동일 role을 병합한다. 제공자(Vertex/Anthropic)의 교대 role 규칙 위반으로
// 400이 나는 것을 구조적으로 방지(감사 지적 — 빠른 전투·즉각 아이템 턴이 연속 assistant를 만들 수 있음).
const MARKER_ONLY_RE = /^[\s⚡🧪]*$/;
function conversationMessages(rows) {
  const out = [];
  for (const row of rows || []) {
    const role = row.role === 'assistant' ? 'assistant' : 'user';
    const content = String(row.content || '');
    if (role === 'assistant' && MARKER_ONLY_RE.test(content)) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content;
    else out.push({ role, content });
  }
  return out;
}

function parseAssistantResponse(text) {
  const source = String(text || '');
  const blocks = Array.from(source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  let events = [];
  let jsonBlock = null;
  if (blocks.length) {
    jsonBlock = blocks[blocks.length - 1][1].trim();
    try {
      const parsed = JSON.parse(jsonBlock);
      events = Array.isArray(parsed.events) ? parsed.events : [];
    } catch (_) {
      events = [];
    }
  }
  const validEvents = events.filter((event) => event && typeof event.id === 'string' && event.id.trim());
  const dropped = events.length - validEvents.length;
  const rawNarrative = jsonBlock
    ? source.replace(blocks[blocks.length - 1][0], '').trim()
    : source.trim();
  return { narrative: stripRisuTags(rawNarrative), events: validEvents, dropped };
}

// 카드 DNA에 밴 리스식 태그를 서사 표시에서 제거한다(우리 엔진의 상태 기제는 JSON
// 사건이라 이 태그들은 무의미한 노이즈). CBS·Lua 실행은 이 프로젝트에서 영구 금지.
function stripRisuTags(text) {
  return String(text || '')
    .replace(/\[[^\]\n]*::[^\]\n]*\]/g, '')  // [ysp_gold::+N::사유], [YSP_QUEST_CLEAR::...], [rep_event::...] 등
    .replace(/<img\b[^>]*>/gi, '')            // <img src="silvia_smile"> 감정 스프라이트 태그
    .replace(/\{\{[^}]*\}\}/g, '')            // {{getvar::...}} 등 CBS
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function relatedNpcIds(schema, state, recentMessages, userInput) {
  const haystack = [...(recentMessages || []).map((m) => m.content || ''), userInput || ''].join('\n').toLowerCase();
  const staff = new Set((state.staff || []).map((item) => item.npcId));
  return npcEntities(schema).filter((npc) => {
    if (staff.has(npc.id)) return true;
    const names = [npc.id, npc.nameKo, npc.nameEn].filter(Boolean).map((x) => String(x).toLowerCase());
    return names.some((name) => name && haystack.includes(name));
  }).map((npc) => npc.id);
}

function reputationCategories(schema) {
  const ladder = (schema.ladders || []).find((entry) => entry.id === 'reputation');
  if (!ladder || !Array.isArray(ladder.axes)) return '';
  return ladder.axes.map((axis) => `${axis}(${(ladder.axisLabels || {})[axis] || axis}): ${Object.keys((ladder.categories || {})[axis] || {}).join(', ')}`).join('\n');
}

// exp_gain의 유효 category(=player_level.sources 키)를 LLM에 정확히 알려준다.
function expCategories(schema) {
  const ladder = (schema.ladders || []).find((entry) => entry.id === 'player_level');
  const sources = ladder && ladder.sources ? Object.keys(ladder.sources) : [];
  return sources.join(', ');
}

function npcListText(schema) {
  return npcEntities(schema).map((npc) => `${npc.id}: ${npc.nameKo}${npc.class ? ` (${npc.class})` : ''}`).join('\n');
}

function consumableListText(schema, state) {
  return (schema.resources || []).filter((resource) => resource && resource.effect && Number((state.resources && state.resources[resource.id]) || 0) >= 1).map((resource) => {
    const count = Number(state.resources[resource.id]);
    return `${resource.id}: ${resource.label || resource.id} ×${count} (+${resource.effect.amount} ${String(resource.effect.pool).toUpperCase()})`;
  }).join('\n');
}

// 현재 주방 레벨에서 팔 수 있는 메뉴 이름을 LLM에 정확히 알려준다(sale 이름 불일치 방지).
function menuListText(schema, state) {
  const block = (schema.entities || []).find((entry) => entry.type === 'menuItem');
  const items = block && Array.isArray(block.instances) ? block.instances : [];
  const kitchen = Number((state && state.facilities && state.facilities.kitchen) || 1);
  return items
    .filter((m) => Number(m.requiresKitchenLevel || 1) <= kitchen)
    .map((m) => `${m.name}${m.category ? ` (${m.category})` : ''}${m.price != null ? ` ${Number(m.price).toLocaleString('ko-KR')}원` : ''}`)
    .join('\n');
}

// 실제 객실 호수를 LLM에 알려준다(checkin roomNo 불일치 방지).
function roomListText(schema) {
  const block = (schema.entities || []).find((entry) => entry.type === 'room');
  const rooms = block && Array.isArray(block.instances) ? block.instances : [];
  return rooms
    .map((r) => `${r.no}호${r.kind ? ` (${r.kind})` : ''}${r.pricePerNight != null ? ` ${Number(r.pricePerNight).toLocaleString('ko-KR')}원/박` : ''}`)
    .join('\n');
}

function skillListText(schema) {
  return Object.entries(schema.skills || {})
    .map(([id, skill]) => `${id}: ${skill.name || id} (${skill.pool || 'mp'} ${skill.cost || 0}, 위력 ${skill.power || 0})`)
    .join('\n');
}

function loreContext(lore, recentMessages, userInput) {
  if (!lore) return '';
  const text = [...(recentMessages || []).map((m) => m.content || ''), userInput || ''].join('\n');
  const result = simulateActivation(lore, text, { scanDepth: 8, tokenBudget: 0 });
  let used = 0;
  const query = text.toLowerCase();
  return result.active
    .filter((row) => !row.entry.constant)
    .sort((a, b) => relevance(a.entry, query) - relevance(b.entry, query) || (a.order || 0) - (b.order || 0))
    .filter((row) => {
      const tokens = Number(row.tokens || 0);
      if (used + tokens > 2500) return false;
      used += tokens;
      return true;
    })
    .map((row) => `${row.entry.name || row.name || '(이름 없음)'}:\n${row.entry.content}`)
    .join('\n\n');
}

function relevance(entry, query) {
  const name = String(entry.name || '').toLowerCase();
  if (name && query.includes(name)) return 0;
  const keys = Array.isArray(entry.keys) ? entry.keys.map((key) => String(key).toLowerCase()) : [];
  if (keys.some((key) => key && query.includes(key))) return 1;
  return 2;
}

function npcEntities(schema) {
  const block = (schema.entities || []).find((entry) => entry.type === 'npc');
  return block && Array.isArray(block.instances) ? block.instances : [];
}

module.exports = { SYSTEM_PROMPT, buildSystemPrompt, formatEngineVerdicts, buildPrompt, buildNarrationPrompt, parseAssistantResponse };
