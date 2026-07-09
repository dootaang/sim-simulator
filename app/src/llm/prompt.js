const { simulateActivation } = require('../../core/lorebook/activate.js');
const { estimateTokens } = require('../../core/lorebook/tokens.js');
const { summarize, npcSummary } = require('../../../engine/core/selectors.js');

const SYSTEM_PROMPT = `당신은 판타지 여관 경영 RP "용사여관"의 내레이터다. 플레이어({{user}})는 여관 주인이다.

[절대 규칙]
1. 게임 수치(골드·재고·호감도·평판·경험치)는 외부 엔진이 계산한다. 너는 수치를 창작하거나 계산하지 마라. 상태 정보에 적힌 값만 사실로 취급하라.
2. 서사는 한국어로, 장면 중심으로 짧게(300자 내외). NPC 대사와 행동 위주. 플레이어의 행동을 대신 결정하지 마라.
3. NPC 행동은 [NPC 상태]에 적힌 티어 규범을 따른다. 금지 행동은 절대 쓰지 마라.
4. 응답의 맨 끝에, 이번 장면에서 플레이어가 한 "행동(의도)"만 아래 형식의 JSON 코드블록으로 제안하라. 사건이 없으면 빈 배열.
5. ★너는 금액·수량 이외의 어떤 숫자(골드·데미지·경험치·변동량)도 사건에 넣지 않는다. 아래 사건들은 "무엇을 했는가"만 담고, 결과 수치는 엔진이 스키마에서 계산한다. 임의 금액을 지정하는 사건은 존재하지 않는다.

\`\`\`json
{"events":[{"id":"sale","params":{"menuName":"고기 스튜","qty":2}}]}
\`\`\`

[사용 가능한 사건 = 행동(의도)만. 숫자 결과는 엔진이 계산]
- sale {menuName, qty} — 메뉴 판매 완결 시. (엔진: 매출 가산 + 식자재 차감)
- purchase {resource:"food"|"drink", qty} — 재료 구매. (엔진: 원가 차감 + 재고 가산. 유저가 산 그 한 건만, gold 변동을 따로 넣지 마라)
- checkin {roomNo, guestName, stayDays} / checkout {roomNo, guestName} — roomNo는 [객실 목록]의 실제 호수(예: 101). (엔진: 숙박비 선불 가산)
- hire {npcId, dailyWage} — 임금 합의가 대화로 완료된 경우만. dailyWage는 대화에서 합의된 값 / fire {npcId}
- scale_delta {scale:"affinity", target:npcId, direction:"+"|"-", size:"S"|"M"|"L"|"XL", reason} — 크기만 분류. S=사소한 배려, M=거리 좁힘, L=깊은 유대, XL=관계 전환점. 한 NPC당 하루 1회.
- rep_event {axis, category, reason} — 평판 변동. axis·category는 [평판 카테고리] 목록에서만. (엔진이 변동값 결정)
- exp_gain {category, reason} — 의미 있는 행동에만, 매 턴 금지. category는 목록에서만. (엔진이 값 결정)
- day_end {} — 플레이어가 하루를 마무리할 때 ("오늘은 여기까지", "잠자리에 든다" 등). (엔진: 매출 정산·임금·체크아웃)

[사건 규칙]
- 실제로 완결된 일만. 진행 중·계획은 사건이 아니다.
- ★한 행동 = 사건 1개. purchase 한 건에 gold 변동을 덧붙이지 말고(엔진이 원가 차감), 손님 수·주문량을 임의로 늘려 sale을 여러 개 만들지 마라. 유저가 "하나 팔자"면 sale 1개, "더 팔자"처럼 모호하면 장면에 실제 등장해 완결된 판매만 센다. 유저가 지시하지 않은 거래(유령 구매/판매)는 절대 만들지 마라.
- 판매·구매는 재고·골드를 엔진이 검증한다. 재고·골드가 없으면 그 행동은 실패한다(무한 공짜 없음).
- npcId는 [NPC 목록]의 영문 id, menuName은 [메뉴 목록], roomNo는 [객실 목록]의 값을 정확히 그대로 사용(목록에 없으면 불가).
- 확신이 없으면 사건을 내지 마라. 빈 배열이 안전하다.`;

const REWARD_PROMPT_APPENDIX = `

[reward event]
- reward {tier, reason} only when a quest/manual/request is complete and the reward tier is known (E~S). The engine chooses gold from schema rewards.gold[tier]; never write an amount.
- Reward gold must only be represented by reward {tier}. Do not invent gold amounts. Use it only at completion/reporting time, not while work is still in progress.`;

function buildPrompt({ schema, state, lore, recentMessages, userInput }) {
  const stateText = summarize(schema, state);
  const npcIds = relatedNpcIds(schema, state, recentMessages, userInput);
  const npcText = npcIds.map((id) => npcSummary(schema, state, id)).filter(Boolean).join('\n');
  const repCats = reputationCategories(schema);
  const npcList = npcListText(schema);
  const menuList = menuListText(schema, state);
  const roomList = roomListText(schema);
  const loreText = loreContext(lore, recentMessages, userInput);

  const context = [
    '[상태]',
    stateText,
    '',
    npcText ? '[NPC 상태]\n' + npcText + '\n' : '',
    '[평판 카테고리]',
    repCats,
    '',
    '[NPC 목록]',
    npcList,
    '',
    menuList ? '[메뉴 목록]\n' + menuList + '\n' : '',
    roomList ? '[객실 목록]\n' + roomList + '\n' : '',
    '[세계 정보]',
    loreText || (lore ? '없음' : '카드를 드롭하면 세계관 로어북이 자동 주입됩니다'),
    '',
    '---',
    String(userInput || ''),
  ].filter((part) => part !== '').join('\n');

  const messages = (recentMessages || []).slice(-8).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || ''),
  }));
  messages.push({ role: 'user', content: context });

  const injectedParts = {
    state: estimateTokens(stateText),
    npc: estimateTokens(npcText),
    repCats: estimateTokens(repCats),
    npcList: estimateTokens(npcList),
    menuList: estimateTokens(menuList),
    roomList: estimateTokens(roomList),
    lore: estimateTokens(loreText || ''),
  };
  const injectedTokens = Object.values(injectedParts).reduce((sum, value) => sum + value, 0);

  return {
    system: SYSTEM_PROMPT + REWARD_PROMPT_APPENDIX,
    messages,
    injectedTokens,
    injectedParts,
    relatedNpcIds: npcIds,
    injectedText: { state: stateText, npc: npcText, repCats, npcList, lore: loreText },
  };
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
  const narrative = jsonBlock
    ? source.replace(blocks[blocks.length - 1][0], '').trim()
    : source.trim();
  return { narrative, events };
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
  const ladder = schema.ladders.find((entry) => entry.id === 'reputation');
  return ladder.axes.map((axis) => `${axis}(${ladder.axisLabels[axis] || axis}): ${Object.keys(ladder.categories[axis]).join(', ')}`).join('\n');
}

function npcListText(schema) {
  return npcEntities(schema).map((npc) => `${npc.id}: ${npc.nameKo}${npc.class ? ` (${npc.class})` : ''}`).join('\n');
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
  const block = schema.entities.find((entry) => entry.type === 'npc');
  return block && Array.isArray(block.instances) ? block.instances : [];
}

module.exports = { SYSTEM_PROMPT, buildPrompt, parseAssistantResponse };
