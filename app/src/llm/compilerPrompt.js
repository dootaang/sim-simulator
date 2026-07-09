'use strict';

const canonicalSchema = require('../../../schema/yongsa-inn.v0.json');

const SYSTEM_PROMPT = "\ub2f9\uc2e0\uc740 RisuAI \uc2dc\ubbac\ubd07 \uce74\ub4dc\uc758 \"\ub8f0\ubd81 \uc0b0\ubb38\"\uc744 \uacb0\uc815\ub860 \uac8c\uc784 \uc5d4\uc9c4\uc6a9 \ud45c\uc900 \uc2a4\ud0a4\ub9c8 JSON\uc73c\ub85c \ubcc0\ud658\ud558\ub294 \ucef4\ud30c\uc77c\ub7ec\ub2e4.\n\n[\uc124\uacc4 \ucca0\ud559] \ub7f0\ud0c0\uc784\uc5d0 \uc11c\uc0ac\ub294 LLM\uc774, \uc218\uce58 \uacc4\uc0b0\u00b7\uc0c1\ud0dc\ub294 \uc5d4\uc9c4\uc774 \uc18c\uc720\ud55c\ub2e4. \ub108\uc758 \uc784\ubb34\ub294 \ub8f0\ubd81\uc5d0\uc11c \"\uc5d4\uc9c4\uc774 \uacc4\uc0b0\ud560 \uc218 \uc788\ub294 \uaddc\uce59\"(\uc218\uce58\u00b7\ubb38\ud131\u00b7\ubc94\uc704\u00b7\ud2f0\uc5b4\u00b7\uacf5\uc2dd\u00b7\ud45c)\ub9cc \ubf51\uc544 \uad6c\uc870\ud654\ud558\ub294 \uac83\uc774\ub2e4. \ubd84\uc704\uae30\u00b7\uc11c\uc0ac \uc9c0\uce68\u00b7\uc774\ubbf8\uc9c0 \uaddc\uce59\uc740 \ub123\uc9c0 \ub9c8\ub77c.\n\n[\ucd9c\ub825 \ud615\uc2dd \u2014 \uc774 JSON \ud558\ub098\ub9cc. \uc55e\ub4a4 \uc124\uba85\u00b7\ub9c8\ud06c\ub2e4\uc6b4\u00b7\ucf54\ub4dc\ud39c\uc2a4 \uae08\uc9c0. \u2605\ud544\ub4dc\uba85\uc740 \uc544\ub798 \uadf8\ub300\ub85c \uc4f0\uace0 \ub300\uccb4 \uc774\ub984\uc744 \uc9c0\uc5b4\ub0b4\uc9c0 \ub9c8\ub77c.]\n{\n  \"meta\": { \"id\": \"kebab-id\", \"title\": \"\uce74\ub4dc\uba85\", \"schemaVersion\": \"0.1\" },\n  \"resources\": [ { \"id\": \"gold|food|drink|material\", \"unit\": \"\ubb38\uc790\uc5f4\", \"min\": 0, \"basePrice\": \uc815\uc218\uc635\uc158 } ],\n  \"scales\": [ { \"id\": \"affinity \ub4f1\", \"owner\": \"npc|player|captive\", \"range\": [\ucd5c\uc18c,\ucd5c\ub300], \"default\": \uc815\uc218,\n    \"steps\": { \"S\": +\uc815\uc218, \"M\": +\uc815\uc218, \"L\": +\uc815\uc218, \"XL\": +\uc815\uc218, \"S-\": -\uc815\uc218, \"M-\": -\uc815\uc218, \"L-\": -\uc815\uc218, \"XL-\": -\uc815\uc218 },\n    \"tiers\": [ { \"range\": [lo,hi], \"label\": \"\ud2f0\uc5b4\uba85\", \"brief\": \"\uc9e7\uc740 \uc11c\uc220\", \"forbidden\": [\"\uae08\uc9c0\ud589\ub3d9\"] } ],\n    \"actionMinimums\": { \"\ub3d9\uc791\uba85\": \ucd5c\uc18c\uc218\uce58 } } ],\n  \"ladders\": [\n    { \"id\": \"player_level\", \"currency\": \"exp\", \"thresholds\": [\ubb38\ud131\ub4e4 \ub610\ub294 null], \"sources\": { \"\uce74\ud14c\uace0\ub9ac\": \uac12 \ub610\ub294 [\ucd5c\uc18c,\ucd5c\ub300] } },\n    { \"id\": \"reputation\", \"axes\": [\"\ucd95id\"], \"axisLabels\": { \"\ucd95id\": \"\ud55c\uae00\uba85\" },\n      \"ranks\": [ { \"id\": \"E\", \"next\": \ubb38\ud131 }, { \"id\": \"S\", \"next\": null } ],\n      \"onPromote\": \"resetExp\", \"onNegative\": \"demoteBorrow\",\n      \"categories\": { \"\ucd95id\": { \"\uce74\ud14c\uace0\ub9ac\": [\ucd5c\uc18c,\ucd5c\ub300] } } } ],\n  \"entities\": [\n    { \"type\": \"room\", \"fields\": [\"no\",\"kind\",\"pricePerNight\",\"capacity\",\"requiresRoomLevel\"], \"instances\": [ { \"no\": \uc815\uc218, \"kind\": \"\ubb38\uc790\uc5f4\", \"pricePerNight\": \uc815\uc218, \"capacity\": \uc815\uc218\ub610\ub294null, \"requiresRoomLevel\": \uc815\uc218 } ] },\n    { \"type\": \"menuItem\", \"fields\": [\"name\",\"category\",\"grade\",\"price\",\"requiresKitchenLevel\",\"consumes\"], \"instances\": [ { \"name\": \"\", \"category\": \"\", \"grade\": \"E~S\", \"price\": \uc815\uc218, \"requiresKitchenLevel\": \uc815\uc218, \"consumes\": { \"food|drink\": 1 } } ] },\n    { \"type\": \"npc\", \"fields\": [\"id\",\"nameKo\",\"nameEn\",\"class\",\"group\"], \"instances\": [ { \"id\":\"\", \"nameKo\":\"\", \"nameEn\":\"\", \"class\":\"\", \"group\":\"\" } ] },\n    { \"type\": \"facility\", \"fields\": [\"id\",\"label\",\"maxLevel\"], \"instances\": [ { \"id\":\"\", \"label\":\"\", \"maxLevel\": \uc815\uc218 } ] } ],\n  \"formulas\": [ { \"id\": \"daily_revenue \ub4f1\", \"baseline\": { \"\uc2dc\uc124\ub808\ubca8\": { \"cap\": \uc815\uc218, \"customers\": [\ucd5c\uc18c,\ucd5c\ub300], \"revenue\": [\ucd5c\uc18c,\ucd5c\ub300] } }, \"note\": \"\" } ],\n  \"processes\": [ { \"trigger\": \"dayEnd \ub4f1\", \"steps\": [ { \"id\": \"\ub2e8\uacc4id\", \"note\": \"\" } ] } ],\n  \"events\": [ { \"id\": \"sale|purchase|checkin|checkout|hire|fire|scale_delta|rep_event|exp_gain|gold_delta|resource_delta|day_end \ub4f1\", \"params\": { \"\ud544\ub4dc\": \"\ud0c0\uc785\" } } ],\n  \"initialState\": { \"day\": 1, \"gold\": \uc815\uc218, \"resources\": {}, \"facilities\": {}, \"staff\": [], \"player\": {}, \"reputation\": {} },\n  \"_assumptions\": [ \"\ub8f0\ubd81\uc5d0\uc11c \ud655\uc815 \ubabb \ud55c \uac12\uacfc \uc0ac\uc720\ub97c \ubb38\uc7a5\uc73c\ub85c\" ]\n}\n\n[\ubcc0\ud658 \uaddc\uce59]\n1. \ub8f0\ubd81\uc5d0 \uba85\uc2dc\ub41c \uc218\uce58\ub9cc. \uc5c6\ub294 \uac12\uc740 \uc9c0\uc5b4\ub0b4\uc9c0 \ub9d0\uace0 \uc0dd\ub7b5\ud558\uac70\ub098 null, \uadf8\ub9ac\uace0 \ubb34\uc5c7\uc744 \ubabb \uc815\ud588\ub294\uc9c0 \"_assumptions\"\uc5d0 \ubc18\ub4dc\uc2dc \uc801\ub294\ub2e4.\n2. 0~200 \ub4f1 \uc720\uacc4 \uc218\uce58 + \uad6c\uac04\ubcc4 \uc11c\uc220/\uae08\uc9c0 = scales.tiers. \uc6d0\ubcf8 \ud2f0\uc5b4\ub97c \ud558\ub098\ub3c4 \ube60\ub728\ub9ac\uc9c0 \ub9d0\uace0 range\u00b7label\u00b7forbidden\uc744 \uc62e\uae34\ub2e4.\n3. EXP \ub204\uc801\u2192\ubb38\ud131 \uc2b9\uae09 = ladders. \ud3c9\ud310 \uc5ec\ub7ec \ucd95\uc740 axes\ub85c \ubb36\uace0 \ucd95\ubcc4 \ubcc0\ub3d9 \ubc94\uc704\ud45c\ub97c categories\ub85c.\n4. \ud0dc\uadf8(\uc608: [ysp_affinity::id::\u00b1N])\ub294 events\ub85c. \uc2a4\ucf00\uc77c \ubcc0\ub3d9\uc740 LLM\uc774 \ud06c\uae30(S/M/L/XL)\ub9cc \ubd84\ub958\ud558\uace0 \uc5d4\uc9c4\uc774 steps\ub85c \uc218\uce58\ud654\ud558\ub294 \uc124\uacc4\uc774\ubbc0\ub85c params\uc5d0 size\ub97c \ub450\uace0, \uc6d0\ubcf8\uc774 \u00b1N\uc744 \uc918\ub3c4 \uadf8 \uac12\ub4e4\uc740 steps\ub85c \ubf51\ub294\ub2e4.\n5. \uac1d\uc2e4\u00b7\uba54\ub274\u00b7NPC \ud45c/\ubaa9\ub85d\uc740 entities.instances\ub85c \ube60\uc9d0\uc5c6\uc774. \u2605\ud544\ub4dc\uba85\uc740 \uc704 \ud615\uc2dd \uadf8\ub300\ub85c.\n6. \uc815\uae30 \uc815\uc0b0\u00b7\uc77c\uae09 \ucc28\uac10\u00b7\uc2dc\uac04 \uacbd\uacfc\ub294 formulas + processes\ub85c.\n7. \ucd9c\ub825\uc740 \ud30c\uc2f1 \uac00\ub2a5\ud55c \ub2e8\uc77c JSON. \uadf8 \uc678 \ud14d\uc2a4\ud2b8 \uc808\ub300 \uae08\uc9c0.\n\n\uc544\ub798 [\ub8f0\ubd81]\uc744 \ucef4\ud30c\uc77c\ud558\ub77c.\n\n[\ub8f0\ubd81]\n{{RULEBOOK}}";

const MAX_RULEBOOK_CHARS = 60000;

function buildCompilerInput(lore) {
  const entries = Array.isArray(lore && lore.entries) ? lore.entries : [];
  const rows = entries
    .filter((entry) => String(entry && entry.content || '').trim())
    .map((entry, index) => ({
      index,
      constant: !!entry.constant,
      name: String(entry.name || entry.comment || `entry-${index + 1}`),
      content: String(entry.content || ''),
    }));

  if (!rows.length) return SYSTEM_PROMPT.replace('{{RULEBOOK}}', mockRulebook());

  const constantRows = rows.filter((row) => row.constant);
  const restRows = rows.filter((row) => !row.constant).sort((a, b) => b.content.length - a.content.length || a.index - b.index);
  const selected = [];
  let used = 0;

  for (const row of constantRows.concat(restRows)) {
    const block = formatEntry(row);
    if (used + block.length > MAX_RULEBOOK_CHARS && selected.length) continue;
    selected.push(block);
    used += block.length;
    if (used >= MAX_RULEBOOK_CHARS) break;
  }

  const omitted = rows.length - selected.length;
  if (omitted > 0 && typeof console !== 'undefined' && console.info) {
    console.info('[simbot] compiler input trimmed', { included: selected.length, omitted });
  }
  return SYSTEM_PROMPT.replace('{{RULEBOOK}}', selected.join('\n\n').slice(0, MAX_RULEBOOK_CHARS));
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
