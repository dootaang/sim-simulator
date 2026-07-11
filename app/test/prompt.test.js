'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const innSchema = require('../../schema/yongsa-inn.v0.json');
const hunterSchema = require('../../schema/hunters-combat.v0.json');
const { createState } = require('../../engine/core/createState.js');
const { summarize } = require('../../engine/core/selectors.js');
const { buildSystemPrompt, formatEngineVerdicts, buildPrompt, buildNarrationPrompt, parseAssistantResponse } = require('../src/llm/prompt.js');
const { validateSchema } = require('../src/schema/validate.js');

test('quest vocabulary and list are conditional while inn prompt bytes stay unchanged', () => {
  const before = buildPrompt({ schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '쉰다' });
  const questSchema = JSON.parse(JSON.stringify(innSchema));
  questSchema.quests = [{ id: 'Q1', name: '첫 의뢰', check: { mode: 'rate', rate: 65 }, rewardTier: 'E' }];
  questSchema.rewards = { gold: { E: [1000, 1000] } };
  const prompt = buildPrompt({ schema: questSchema, state: createState(questSchema), recentMessages: [], userInput: '도전' });
  assert.match(prompt.system, /attempt_quest \{questId\}/);
  assert.match(prompt.messages.at(-1).content, /\[의뢰 목록\]/);
  assert.match(prompt.messages.at(-1).content, /Q1: 첫 의뢰 \(성공 65% · 보상 1,000~1,000\)/);
  assert.ok(prompt.injectedParts.quests > 0);
  assert.doesNotMatch(before.system, /attempt_quest/);
  assert.doesNotMatch(before.messages.at(-1).content, /\[의뢰 목록\]/);
});

test('inn system prompt keeps its identity and all inn event vocabulary', () => {
  const system = buildSystemPrompt(innSchema);
  assert.match(system, /"용사여관"의 내레이터/);
  assert.match(system, /\bsale\b/);
  assert.match(system, /\bcheckin\b/);
  assert.doesNotMatch(system, /\bcombat_action\b/);
});

test('hunter system prompt is combat-specific and contains no inn vocabulary', () => {
  const system = buildSystemPrompt(hunterSchema);
  assert.match(system, /"헌터 전투 코어 \(참조 스키마\)"의 내레이터/);
  for (const word of ['용사여관', '여관', 'sale', 'checkin', 'upgrade', 'hire']) assert.doesNotMatch(system, new RegExp(word));
  for (const phrase of [
    'start_encounter를 절대 다시 내지 마라',
    '모든 적이 "전투불능"으로 표시된 다음에야 end_encounter를 내라',
    '반드시 combat_action 사건을 내라',
  ]) assert.ok(system.includes(phrase));
});

test('formatEngineVerdicts formats failures, successes, and empty input', () => {
  const text = formatEngineVerdicts([{ ok: false, text: 'start_encounter 실패' }, { ok: true, text: '공격 처리' }]);
  assert.match(text, /❌ start_encounter 실패.*무효/);
  assert.match(text, /✅ 공격 처리/);
  assert.equal(formatEngineVerdicts([]), '');
});

test('buildPrompt injects optional engine verdicts immediately after state', () => {
  const base = { schema: hunterSchema, state: createState(hunterSchema), recentMessages: [], userInput: '공격한다' };
  const withVerdicts = buildPrompt({ ...base, lastVerdicts: [{ ok: false, text: '거부됨' }] });
  const context = withVerdicts.messages.at(-1).content;
  assert.ok(context.indexOf('[엔진 판정') > context.indexOf('[상태]'));
  assert.match(context, /무효/);
  assert.ok(withVerdicts.injectedParts.verdicts > 0);
  assert.doesNotMatch(buildPrompt(base).messages.at(-1).content, /\[엔진 판정/);
});

test('summarize omits inn lines for hunter and preserves inn golden bytes', () => {
  const hunterSummary = summarize(hunterSchema, createState(hunterSchema));
  assert.doesNotMatch(hunterSummary, /\[여관\]/);
  assert.equal(summarize(innSchema, createState(innSchema)), [
    '[여관] 1일차 · 골드 500,000원 · 식자재 20인분 · 주류 20잔 · 시설 주점1/주방1/객실1/숙소1',
    '[직원] 없음',
    '[객실] 전 객실 공실',
    '[평판] 마을 E(0) · 모험가 길드 E(0) · 마법사 길드 E(0) · 귀족·왕실 E(0) · 뒷세계 E(0) · 상인 조합 E(0)',
  ].join('\n'));
});

test('parseAssistantResponse drops events without a non-empty string id', () => {
  const parsed = parseAssistantResponse('서사\n```json\n{"events":[{"params":{}},{"id":"","params":{}},{"id":"combat_action","params":{"action":"attack"}}]}\n```');
  assert.equal(parsed.dropped, 2);
  assert.deepEqual(parsed.events, [{ id: 'combat_action', params: { action: 'attack' } }]);
});

test('parseAssistantResponse parses optional emotion', () => {
  const parsed = parseAssistantResponse('미소 짓는다.\n```json\n{"emotion":"smile","events":[]}\n```');
  assert.equal(parsed.emotion, 'smile');
});

test('parseAssistantResponse remains compatible when emotion is absent', () => {
  const parsed = parseAssistantResponse('그대로 바라본다.\n```json\n{"events":[]}\n```');
  assert.equal(Object.hasOwn(parsed, 'emotion'), false);
  assert.equal(parsed.narrative, '그대로 바라본다.');
});

test('parseAssistantResponse accepts and removes terminal unfenced event JSON', () => {
  const parsed = parseAssistantResponse('고용 계약이 성립됐다.\n{"events":[{"id":"hire","params":{"npcId":"silvia","dailyWage":10000}}],"emotion":"default"}');
  assert.equal(parsed.narrative, '고용 계약이 성립됐다.');
  assert.equal(parsed.events[0].id, 'hire');
  assert.equal(parsed.emotion, 'default');
});

test('decision narration forbids invented choices and time travel', () => {
  const prompt = buildNarrationPrompt({ schema: innSchema, state: createState(innSchema), results: ['사건 발생'], eventType: 'traffic_wave', decisionContext: '실제 선택지: 붙잡는다 / 지킨다', recentMessages: [] });
  assert.match(prompt.system, /대응 방법을 제안·열거/);
  assert.match(prompt.system, /날짜와 일차를 진행시키지 마라/);
  assert.match(prompt.messages.at(-1).content, /실제 선택지: 붙잡는다 \/ 지킨다/);
});

test('buildPrompt enables all combat vocabulary after scales are promoted', () => {
  const source = {
    meta: { id: 'promoted', title: '승격 전투', schemaVersion: '0.1' }, resources: [],
    scales: [{ id: 'HP', owner: 'player', range: [0, 100], default: 80 }], ladders: [], entities: [], events: [],
  };
  const schema = validateSchema(source).schema;
  const prompt = buildPrompt({ schema, state: createState(schema), recentMessages: [], userInput: '싸운다' });
  for (const id of ['start_encounter', 'combat_action', 'enemy_action', 'end_encounter']) assert.match(prompt.system, new RegExp(id));
});

test('buildNarrationPrompt fixes engine results and includes flavor text', () => {
  const state = createState(hunterSchema);
  state.combat = { active: true };
  const prompt = buildNarrationPrompt({ schema: hunterSchema, state, results: ['공격 · e1 명중 · 피해 12'], flavorText: '낮게 파고든다', recentMessages: [] });
  assert.match(prompt.system, /새 사건 JSON을 내지 마라/);
  assert.match(prompt.messages.at(-1).content, /\[확정된 전투 결과\]/);
  assert.match(prompt.messages.at(-1).content, /공격 · e1 명중 · 피해 12/);
  assert.match(prompt.messages.at(-1).content, /플레이어의 연출 의도: 낮게 파고든다/);
});

test('buildNarrationPrompt adds chronological whole-combat instruction only for long result lists', () => {
  const state = createState(hunterSchema);
  state.combat = { active: true };
  const base = { schema: hunterSchema, state, flavorText: '', recentMessages: [] };
  assert.doesNotMatch(buildNarrationPrompt({ ...base, results: Array(8).fill('결과') }).messages.at(-1).content, /여러 턴의 전투 전체/);
  assert.match(buildNarrationPrompt({ ...base, results: Array(9).fill('결과') }).messages.at(-1).content, /여러 턴의 전투 전체를 시간순으로 요약/);
});

test('buy menus expose only buy_item vocabulary and narration uses generic result heading', () => {
  const shop = { meta: { title: '상점' }, resources: [], entities: [{ type: 'menuItem', instances: [{ name: '서약반지', price: 30000, trade: 'buy' }] }] };
  const system = buildSystemPrompt(shop);
  assert.match(system, /buy_item \{menuName, qty\}/);
  assert.match(system, /구매는 buy_item, 판매는 sale이다/);
  assert.doesNotMatch(system, /- sale \{/);
  const context = buildPrompt({ schema: shop, state: { gold: 70000 }, recentMessages: [], userInput: '산다' }).messages.at(-1).content;
  assert.match(context, /서약반지 30,000원 \(구매\)/);
  const narration = buildNarrationPrompt({ schema: shop, state: { gold: 70000, items: { 서약반지: 1 } }, results: ['구매'], recentMessages: [] });
  assert.match(narration.messages.at(-1).content, /^\[확정된 결과\]/);
  assert.match(narration.messages.at(-1).content, /\[소지품\] 서약반지 ×1/);
});

test('sell-only inn menu list preserves its existing bytes', () => {
  const context = buildPrompt({ schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '판다' }).messages.at(-1).content;
  const menu = context.split('[메뉴 목록]\n')[1].split('\n\n[객실 목록]')[0];
  const block = innSchema.entities.find((entry) => entry.type === 'menuItem');
  const expected = block.instances
    .filter((item) => Number(item.requiresKitchenLevel || 1) <= 1)
    .map((item) => `${item.name}${item.category ? ` (${item.category})` : ''}${item.price != null ? ` ${Number(item.price).toLocaleString('ko-KR')}원` : ''}`)
    .join('\n');
  assert.equal(menu, expected);
});

test('consumables inject vocabulary and stocked item list while inn stays unchanged', () => {
  const state = createState(hunterSchema);
  const prompt = buildPrompt({ schema: hunterSchema, state, recentMessages: [], userInput: '포션을 쓴다' });
  assert.match(prompt.system, /use_item \{itemId\}/);
  assert.match(prompt.messages.at(-1).content, /\[소모품 목록\]/);
  assert.match(prompt.messages.at(-1).content, /health_potion: 체력 포션 ×3 \(\+40 HP\)/);
  assert.ok(prompt.injectedParts.items > 0);
  assert.doesNotMatch(buildSystemPrompt(innSchema), /use_item/);
  assert.doesNotMatch(buildPrompt({ schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '쉰다' }).messages.at(-1).content, /\[소모품 목록\]/);
});

test('recentChanges omission preserves buildPrompt output bytes', () => {
  const base = { schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '영업을 시작한다' };
  assert.deepEqual(buildPrompt(base), buildPrompt({ ...base, recentChanges: undefined }));
});

test('recentChanges injects the owner-managed change block into both prompts', () => {
  const changes = ['재료(food) 20인분을 구매해 창고에 보관했다'];
  const prompt = buildPrompt({ schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '영업한다', recentChanges: changes });
  const narration = buildNarrationPrompt({ schema: innSchema, state: createState(innSchema), results: ['영업 완료'], recentMessages: [], recentChanges: changes });
  for (const result of [prompt, narration]) {
    assert.match(result.messages.at(-1).content, /\[직전 장면 이후 주인장이 직접 처리한 변화/);
    assert.match(result.messages.at(-1).content, /- 재료\(food\) 20인분을 구매해 창고에 보관했다/);
  }
});

test('empty recentChanges does not inject a change block', () => {
  const prompt = buildPrompt({ schema: innSchema, state: createState(innSchema), recentMessages: [], userInput: '영업한다', recentChanges: [] });
  assert.doesNotMatch(prompt.messages.at(-1).content, /직전 장면 이후 주인장이 직접 처리한 변화/);
});
