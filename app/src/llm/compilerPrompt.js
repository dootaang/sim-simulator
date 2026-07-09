'use strict';

const canonicalSchema = require('../../../schema/yongsa-inn.v0.json');

const SYSTEM_PROMPT = "당신은 RisuAI 시뮬봇 카드의 \"룰북 산문\"을 결정론 게임 엔진용 표준 스키마 JSON으로 변환하는 컴파일러다.\n\n[설계 철학] 런타임에 서사는 LLM이, 수치 계산·상태는 엔진이 소유한다. 너의 임무는 룰북에서 \"엔진이 계산할 수 있는 규칙\"(수치·문턱·범위·티어·공식·표)만 뽑아 구조화하는 것이다. 분위기·서사 지침·이미지 규칙은 넣지 마라.\n\n[출력 형식 — 이 JSON 하나만. 앞뒤 설명·마크다운·코드펜스 금지. ★필드명은 아래 그대로 쓰고 대체 이름을 지어내지 마라.]\n{\n  \"meta\": { \"id\": \"kebab-id\", \"title\": \"카드명\", \"schemaVersion\": \"0.1\" },\n  \"resources\": [ { \"id\": \"gold|food|drink|material\", \"unit\": \"문자열\", \"min\": 0, \"basePrice\": 정수옵션 } ],\n  \"scales\": [ { \"id\": \"affinity 등\", \"owner\": \"npc|player|captive\", \"range\": [최소,최대], \"default\": 정수,\n    \"steps\": { \"S\": +정수, \"M\": +정수, \"L\": +정수, \"XL\": +정수, \"S-\": -정수, \"M-\": -정수, \"L-\": -정수, \"XL-\": -정수 },\n    \"tiers\": [ { \"range\": [lo,hi], \"label\": \"티어명\", \"brief\": \"짧은 서술\", \"forbidden\": [\"금지행동\"] } ],\n    \"actionMinimums\": { \"동작명\": 최소수치 } } ],\n  \"ladders\": [\n    { \"id\": \"player_level\", \"currency\": \"exp\", \"thresholds\": [문턱들 또는 null], \"sources\": { \"카테고리\": 값 또는 [최소,최대] } },\n    { \"id\": \"reputation\", \"axes\": [\"축id\"], \"axisLabels\": { \"축id\": \"한글명\" },\n      \"ranks\": [ { \"id\": \"E\", \"next\": 문턱 }, { \"id\": \"S\", \"next\": null } ],\n      \"onPromote\": \"resetExp\", \"onNegative\": \"demoteBorrow\",\n      \"categories\": { \"축id\": { \"카테고리\": [최소,최대] } } } ],\n  \"entities\": [\n    { \"type\": \"room\", \"fields\": [\"no\",\"kind\",\"pricePerNight\",\"capacity\",\"requiresRoomLevel\"], \"instances\": [ { \"no\": 정수, \"kind\": \"문자열\", \"pricePerNight\": 정수, \"capacity\": 정수또는null, \"requiresRoomLevel\": 정수 } ] },\n    { \"type\": \"menuItem\", \"fields\": [\"name\",\"category\",\"grade\",\"price\",\"requiresKitchenLevel\",\"consumes\"], \"instances\": [ { \"name\": \"\", \"category\": \"\", \"grade\": \"E~S\", \"price\": 정수, \"requiresKitchenLevel\": 정수, \"consumes\": { \"food|drink\": 1 } } ] },\n    { \"type\": \"npc\", \"fields\": [\"id\",\"nameKo\",\"nameEn\",\"class\",\"group\"], \"instances\": [ { \"id\":\"\", \"nameKo\":\"\", \"nameEn\":\"\", \"class\":\"\", \"group\":\"\" } ] },\n    { \"type\": \"facility\", \"fields\": [\"id\",\"label\",\"maxLevel\"], \"instances\": [ { \"id\":\"\", \"label\":\"\", \"maxLevel\": 정수 } ] } ],\n  \"formulas\": [ { \"id\": \"daily_revenue 등\", \"baseline\": { \"시설레벨\": { \"cap\": 정수, \"customers\": [최소,최대], \"revenue\": [최소,최대] } }, \"note\": \"\" } ],\n  \"processes\": [ { \"trigger\": \"dayEnd 등\", \"steps\": [ { \"id\": \"단계id\", \"note\": \"\" } ] } ],\n  \"events\": [ { \"id\": \"sale|purchase|checkin|checkout|hire|fire|scale_delta|rep_event|exp_gain|gold_delta|resource_delta|day_end 등\", \"params\": { \"필드\": \"타입\" } } ],\n  \"initialState\": { \"day\": 1, \"gold\": 정수, \"resources\": {}, \"facilities\": {}, \"staff\": [], \"player\": {}, \"reputation\": {} },\n  \"_assumptions\": [ \"룰북에서 확정 못 한 값과 사유를 문장으로\" ]\n}\n\n[변환 규칙]\n1. 룰북에 명시된 수치만. 없는 값은 지어내지 말고 생략하거나 null, 그리고 무엇을 못 정했는지 \"_assumptions\"에 반드시 적는다.\n2. 0~200 등 유계 수치 + 구간별 서술/금지 = scales.tiers. 원본 티어를 하나도 빠뜨리지 말고 range·label·forbidden을 옮긴다.\n3. EXP 누적→문턱 승급 = ladders. 평판 여러 축은 axes로 묶고 축별 변동 범위표를 categories로.\n4. 태그(예: [ysp_affinity::id::±N])는 events로. 스케일 변동은 LLM이 크기(S/M/L/XL)만 분류하고 엔진이 steps로 수치화하는 설계이므로 params에 size를 두고, 원본이 ±N을 줘도 그 값들은 steps로 뽑는다.\n5. ★메뉴는 엔진 판매의 핵심이다. 요리·주류·특수메뉴·무기·방어구 등 모든 판매 품목을 entities.menuItem.instances에 빠짐없이 넣되, name은 룰북에 적힌 한국어 이름 그대로(예: \"고기 스튜\", \"에일\", \"철제 장검\"), price는 원문 가격(1만원=10000처럼 숫자만), requiresKitchenLevel/requiresForge는 그 품목이 등장하는 시설 레벨({{#when kitchen level}} 등 조건 블록의 레벨)로 채운다. 객실·NPC도 마찬가지로 표/목록을 빠짐없이 instances로.\n6. 정기 정산·일급 차감·시간 경과는 formulas + processes로.\n7. ★initialState는 플레이를 바로 시작할 수 있게 채운다. 룰북에 시작 자본·초기 재고가 없으면(대개 Lua 변수라 명시 안 됨), 재화 가격 규모를 보고 초기 운영이 가능한 값으로 정한다: gold는 기본 식자재/재료를 수십 인분 살 수 있는 수준(예: 최소 300,000 이상), food·drink는 최소 영업 가능한 초기 재고(예: 각 20), facilities는 모든 시설을 레벨 1로. 이렇게 정한 값은 _assumptions에 \"임시 시작값\"으로 기록한다.\n8. 출력은 파싱 가능한 단일 JSON. 그 외 텍스트 절대 금지.\n\n아래 [룰북]을 컴파일하라.\n\n[룰북]\n{{RULEBOOK}}";

const MAX_RULEBOOK_CHARS = 200000;

const REWARD_SCHEMA_APPENDIX = "\n\n[rewards/upgrades/gather table rules]\nOutput JSON must include \"rewards\": { \"gold\": { \"E\":[min,max], \"D\":[min,max], \"C\":[min,max], \"B\":[min,max], \"A\":[min,max], \"S\":[min,max] } }. Quest/manual/request reward gold belongs only in this engine table, not in individual event params.\n\n★ Reward gold source priority: if the mined rules block has a per-rank table with a pay/reward range (e.g. a questPay or reward field already given as [min,max] numbers), copy those numbers EXACTLY into rewards.gold for the matching rank. Do NOT scale, round up, multiply, or inflate them — the mined numbers are the authoritative amounts. Only invent ranges for ranks that are ABSENT from the mined table, and keep those consistent in magnitude with the nearest mined rank (a lower rank must not exceed a higher rank). Sanity bound: unless a mined value explicitly says so, no rewards.gold max should exceed roughly 3x the most expensive facility upgrade cost — if your inferred number blows past that, you are hallucinating; pull it back down. If the rulebook gives no reward amounts at all, infer sensible tier ranges from menu prices and upgrade costs, then record the reason in _assumptions as temporary reward values.\n\nEach facility instance should include \"upgradeCosts\": { \"2\": cost, \"3\": cost, \"4\": cost } for the next-level expansion costs. Upgrade costs are engine-owned table values; never place costs, gold deltas, or target levels in individual upgrade events. If the rulebook does not provide exact costs, infer them from the economy scale and record the temporary assumption in _assumptions.\n\nOutput top-level \"gather\": { \"small\":[min,max], \"large\":[min,max], \"bulk\":[min,max], \"note\":\"...\" } for self-supply yields such as hunting, gathering, and monster byproducts. Gather quantities are engine-owned table values; never place qty or amount in individual gain_resource events.";

function promptTemplate() {
  return SYSTEM_PROMPT + REWARD_SCHEMA_APPENDIX;
}

function buildCompilerInput(lore, mined) {
  const entries = Array.isArray(lore && lore.entries) ? lore.entries : [];
  const rows = entries
    .filter((entry) => String(entry && entry.content || '').trim())
    .map((entry, index) => ({
      index,
      constant: !!entry.constant,
      name: String(entry.name || entry.comment || `entry-${index + 1}`),
      content: String(entry.content || ''),
    }));

  const minedBlock = formatMinedRules(mined);
  if (!rows.length && !minedBlock) return promptTemplate().replace('{{RULEBOOK}}', mockRulebook());

  const constantRows = rows.filter((row) => row.constant);
  const restRows = rows.filter((row) => !row.constant).sort((a, b) => b.content.length - a.content.length || a.index - b.index);
  const selected = minedBlock ? [minedBlock] : [];
  let used = minedBlock.length;

  for (const row of constantRows.concat(restRows)) {
    const block = formatEntry(row);
    if (used + block.length > MAX_RULEBOOK_CHARS && selected.length) continue;
    selected.push(block);
    used += block.length;
    if (used >= MAX_RULEBOOK_CHARS) break;
  }

  const omitted = rows.length - (selected.length - (minedBlock ? 1 : 0));
  if (omitted > 0 && typeof console !== 'undefined' && console.info) {
    console.info('[simbot] compiler input trimmed', { included: rows.length - omitted, omitted });
  }
  return promptTemplate().replace('{{RULEBOOK}}', selected.join('\n\n').slice(0, MAX_RULEBOOK_CHARS));
}

function parseCompilerOutput(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: 'No JSON object found in compiler output.' };
  try {
    return { ok: true, json: JSON.parse(source.slice(start, end + 1)) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function mockCompilerOutput() {
  const schema = clone(canonicalSchema);
  schema.meta = Object.assign({}, schema.meta, {
    id: 'mock-compiler-yongsa-inn',
    title: String(schema.meta && schema.meta.title || 'Mock schema') + ' mock',
  });
  schema._assumptions = ['Mock compiler output: canonical schema with deliberate alternate field names for validator normalization.'];

  const rooms = entity(schema, 'room');
  if (rooms) {
    rooms.instances = rooms.instances.map((room) => {
      const next = Object.assign({}, room);
      next.roomNo = next.no;
      next.price = next.pricePerNight;
      delete next.no;
      delete next.pricePerNight;
      return next;
    });
  }

  const npcs = entity(schema, 'npc');
  if (npcs && npcs.instances[0]) {
    npcs.instances = npcs.instances.map((npc, index) => {
      if (index !== 0) return npc;
      const next = Object.assign({}, npc);
      next.name = next.nameKo;
      delete next.nameKo;
      return next;
    });
  }

  return JSON.stringify(schema, null, 2);
}

function formatEntry(row) {
  return `### \ub8f0\ubd81 \ud56d\ubaa9: ${row.name}\n${row.content}`;
}

function formatMinedRules(mined) {
  if (!mined || mined.archetype !== 'lua-rich') return '';
  const payload = {};
  if (mined.tables && Object.keys(mined.tables).length) payload.tables = sortObject(mined.tables);
  if (mined.constants && Object.keys(mined.constants).length) payload.constants = sortObject(mined.constants);
  if (!Object.keys(payload).length) return '';
  return [
    '[채굴된 규칙 값 - 카드 Lua에서 정확 추출]',
    '이 블록의 숫자는 카드에 내장된 Lua 테이블 리터럴을 정적 파싱한 authoritative 값이다.',
    '룰북 prose와 충돌하면 채굴된 값을 우선하고, 이름을 스키마 필드에 자연스럽게 매핑하라.',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortObject(value[key]);
  return out;
}

function mockRulebook() {
  return 'Mock lorebook entry: use the default inn schema shape and keep assumptions explicit.';
}

function entity(schema, type) {
  return (schema.entities || []).find((entry) => entry.type === type);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { SYSTEM_PROMPT, buildCompilerInput, parseCompilerOutput, mockCompilerOutput };
