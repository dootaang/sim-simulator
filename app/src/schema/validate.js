'use strict';

const REQUIRED_TOP_LEVEL = ['meta', 'resources', 'scales', 'ladders', 'entities', 'events'];
const ENTITY_FIELDS = {
  room: ['no', 'kind', 'pricePerNight', 'capacity', 'requiresRoomLevel'],
  menuItem: ['name', 'category', 'grade', 'price', 'requiresKitchenLevel', 'consumes'],
  npc: ['id', 'nameKo', 'nameEn', 'class', 'group'],
  facility: ['id', 'label', 'maxLevel'],
};
const ROOM_ALIASES = { number: 'no', roomNo: 'no', price: 'pricePerNight' };
const NPC_ALIASES = { name: 'nameKo' };

function validateSchema(obj) {
  const issues = [];
  const schema = clone(obj || {});

  normalizeAliases(schema, issues);
  validateTop(schema, issues);
  validateResources(schema, issues);
  validateScales(schema, issues);
  validateLadders(schema, issues);
  validateEntities(schema, issues);
  validateFormulas(schema, issues);
  validateProcesses(schema, issues);
  validateRewards(schema, issues);
  validateEvents(schema, issues);

  return { schema, issues };
}

function normalizeAliases(schema, issues) {
  const room = findEntity(schema, 'room');
  if (room) {
    room.fields = normalizeFieldList(room.fields, ROOM_ALIASES, 'entities.room.fields', issues);
    for (const [index, instance] of asArray(room.instances).entries()) {
      normalizeObjectFields(instance, ROOM_ALIASES, `entities.room.instances[${index}]`, issues);
    }
  }

  const npc = findEntity(schema, 'npc');
  if (npc) {
    npc.fields = normalizeFieldList(npc.fields, NPC_ALIASES, 'entities.npc.fields', issues);
    for (const [index, instance] of asArray(npc.instances).entries()) {
      normalizeObjectFields(instance, NPC_ALIASES, `entities.npc.instances[${index}]`, issues);
    }
  }
}

function validateTop(schema, issues) {
  if (!isObject(schema)) {
    error(issues, '$', 'Schema must be a JSON object.');
    return;
  }
  for (const key of REQUIRED_TOP_LEVEL) {
    if (schema[key] == null) error(issues, key, 'Required top-level field is missing.');
  }
  if (!isObject(schema.meta)) error(issues, 'meta', 'meta must be an object.');
  else {
    for (const key of ['id', 'title', 'schemaVersion']) requireField(schema.meta, key, `meta.${key}`, issues);
  }
}

function validateResources(schema, issues) {
  if (!requireArray(schema.resources, 'resources', issues)) return;
  const ids = new Set();
  schema.resources.forEach((resource, index) => {
    const path = `resources[${index}]`;
    if (!isObject(resource)) return error(issues, path, 'Resource must be an object.');
    for (const key of ['id', 'unit', 'min']) requireField(resource, key, `${path}.${key}`, issues);
    duplicate(ids, resource.id, `${path}.id`, issues);
  });
}

function validateScales(schema, issues) {
  if (!requireArray(schema.scales, 'scales', issues)) return;
  const ids = new Set();
  schema.scales.forEach((scale, index) => {
    const path = `scales[${index}]`;
    if (!isObject(scale)) return error(issues, path, 'Scale must be an object.');
    for (const key of ['id', 'owner', 'range', 'default', 'steps', 'tiers']) {
      requireField(scale, key, `${path}.${key}`, issues);
    }
    // actionMinimums는 선택 — 호감도류엔 있지만 인기도 등엔 없다. 있으면 객체여야.
    if (scale.actionMinimums != null && !isObject(scale.actionMinimums)) {
      warn(issues, `${path}.actionMinimums`, 'actionMinimums가 있으면 객체여야 합니다.');
    }
    duplicate(ids, scale.id, `${path}.id`, issues);
    validateRange(scale.range, `${path}.range`, issues, 'error');
    if (isRange(scale.range) && Number(scale.range[0]) >= Number(scale.range[1])) {
      warn(issues, `${path}.range`, 'Scale range should ascend.');
    }
    if (!isObject(scale.steps)) error(issues, `${path}.steps`, 'steps must be an object.');
    else {
      for (const key of ['S', 'M', 'L', 'XL', 'S-', 'M-', 'L-', 'XL-']) {
        if (scale.steps[key] == null) error(issues, `${path}.steps.${key}`, 'Missing step size.');
      }
    }
    if (!requireArray(scale.tiers, `${path}.tiers`, issues)) return;
    scale.tiers.forEach((tier, tierIndex) => {
      const tierPath = `${path}.tiers[${tierIndex}]`;
      if (!isObject(tier)) return error(issues, tierPath, 'Tier must be an object.');
      for (const key of ['range', 'label', 'brief', 'forbidden']) requireField(tier, key, `${tierPath}.${key}`, issues);
      validateRange(tier.range, `${tierPath}.range`, issues, 'error');
      if (isRange(scale.range) && isRange(tier.range)) {
        if (Number(tier.range[0]) < Number(scale.range[0]) || Number(tier.range[1]) > Number(scale.range[1])) {
          warn(issues, `${tierPath}.range`, 'Tier range falls outside scale range.');
        }
      }
      if (!Array.isArray(tier.forbidden)) error(issues, `${tierPath}.forbidden`, 'forbidden must be an array.');
    });
  });
}

function validateLadders(schema, issues) {
  if (!requireArray(schema.ladders, 'ladders', issues)) return;
  const ids = new Set();
  schema.ladders.forEach((ladder, index) => {
    const path = `ladders[${index}]`;
    if (!isObject(ladder)) return error(issues, path, 'Ladder must be an object.');
    requireField(ladder, 'id', `${path}.id`, issues);
    duplicate(ids, ladder.id, `${path}.id`, issues);
    if (ladder.id === 'player_level') {
      for (const key of ['currency', 'sources']) requireField(ladder, key, `${path}.${key}`, issues);
      // thresholds는 선택 — 룰북에 레벨 문턱이 없으면 null이 정상(엔진은 thresholds||[]로 처리).
      // null/없으면 검수에서 채우도록 경고만, 있으면 배열이어야.
      if (ladder.thresholds == null) warn(issues, `${path}.thresholds`, '레벨업 문턱이 미정입니다 — 검수에서 채우거나, 비워두면 레벨업이 비활성됩니다.');
      else requireArray(ladder.thresholds, `${path}.thresholds`, issues);
      if (!isObject(ladder.sources)) error(issues, `${path}.sources`, 'sources must be an object.');
    }
    if (ladder.id === 'reputation') {
      for (const key of ['axes', 'axisLabels', 'ranks', 'onPromote', 'onNegative', 'categories']) {
        requireField(ladder, key, `${path}.${key}`, issues);
      }
      requireArray(ladder.axes, `${path}.axes`, issues);
      if (!isObject(ladder.axisLabels)) error(issues, `${path}.axisLabels`, 'axisLabels must be an object.');
      if (!isObject(ladder.categories)) error(issues, `${path}.categories`, 'categories must be an object.');
      if (requireArray(ladder.ranks, `${path}.ranks`, issues)) validateRanks(ladder.ranks, `${path}.ranks`, issues);
    }
  });
}

function validateEntities(schema, issues) {
  if (!requireArray(schema.entities, 'entities', issues)) return;
  const types = new Set();
  schema.entities.forEach((entity, index) => {
    const path = `entities[${index}]`;
    if (!isObject(entity)) return error(issues, path, 'Entity block must be an object.');
    for (const key of ['type', 'fields', 'instances']) requireField(entity, key, `${path}.${key}`, issues);
    duplicate(types, entity.type, `${path}.type`, issues);
    requireArray(entity.fields, `${path}.fields`, issues);
    requireArray(entity.instances, `${path}.instances`, issues);

    const required = ENTITY_FIELDS[entity.type];
    if (!required) return;
    const fieldSet = new Set(asArray(entity.fields));
    for (const field of required) {
      if (!fieldSet.has(field)) error(issues, `${path}.fields`, `Missing canonical field ${field}.`);
    }
    asArray(entity.instances).forEach((instance, instanceIndex) => {
      const itemPath = `${path}.instances[${instanceIndex}]`;
      if (!isObject(instance)) return error(issues, itemPath, 'Entity instance must be an object.');
      for (const field of required) {
        if (!(field in instance)) error(issues, `${itemPath}.${field}`, `Missing required field ${field}.`);
      }
    });
  });
}

function validateFormulas(schema, issues) {
  if (schema.formulas == null) return;
  if (!requireArray(schema.formulas, 'formulas', issues)) return;
  schema.formulas.forEach((formula, index) => {
    if (!isObject(formula)) return error(issues, `formulas[${index}]`, 'Formula must be an object.');
    requireField(formula, 'id', `formulas[${index}].id`, issues);
  });
}

function validateProcesses(schema, issues) {
  if (schema.processes == null) return;
  if (!requireArray(schema.processes, 'processes', issues)) return;
  schema.processes.forEach((process, index) => {
    const path = `processes[${index}]`;
    if (!isObject(process)) return error(issues, path, 'Process must be an object.');
    for (const key of ['trigger', 'steps']) requireField(process, key, `${path}.${key}`, issues);
    if (requireArray(process.steps, `${path}.steps`, issues)) {
      process.steps.forEach((step, stepIndex) => {
        if (!isObject(step)) return error(issues, `${path}.steps[${stepIndex}]`, 'Process step must be an object.');
        requireField(step, 'id', `${path}.steps[${stepIndex}].id`, issues);
      });
    }
  });
}

function validateRewards(schema, issues) {
  if (schema.rewards == null) return;
  if (!isObject(schema.rewards)) return warn(issues, 'rewards', 'rewards must be an object when present.');
  if (!isObject(schema.rewards.gold)) return warn(issues, 'rewards.gold', 'rewards.gold must be an object when present.');

  for (const [tier, range] of Object.entries(schema.rewards.gold)) {
    const path = `rewards.gold.${tier}`;
    if (!isRange(range)) {
      warn(issues, path, 'Reward range must be an array of length 2.');
      continue;
    }
    const min = Number(range[0]);
    const max = Number(range[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      warn(issues, path, 'Reward range values should be numeric.');
    } else if (min > max) {
      warn(issues, path, 'Reward range should ascend.');
    }
  }
}

function validateEvents(schema, issues) {
  if (!requireArray(schema.events, 'events', issues)) return;
  const ids = new Set();
  schema.events.forEach((event, index) => {
    const path = `events[${index}]`;
    if (!isObject(event)) return error(issues, path, 'Event must be an object.');
    for (const key of ['id', 'params']) requireField(event, key, `${path}.${key}`, issues);
    duplicate(ids, event.id, `${path}.id`, issues);
    if (!isObject(event.params)) error(issues, `${path}.params`, 'params must be an object.');
  });
}

function validateRanks(ranks, path, issues) {
  let last = -Infinity;
  ranks.forEach((rank, index) => {
    const rankPath = `${path}[${index}]`;
    if (!isObject(rank)) return error(issues, rankPath, 'Rank must be an object.');
    for (const key of ['id', 'next']) requireField(rank, key, `${rankPath}.${key}`, issues);
    if (rank.next != null) {
      const next = Number(rank.next);
      if (!Number.isFinite(next)) warn(issues, `${rankPath}.next`, 'Rank next should be numeric or null.');
      else if (next <= last) warn(issues, `${rankPath}.next`, 'Rank next thresholds should ascend.');
      else last = next;
    }
  });
}

function normalizeFieldList(fields, aliases, path, issues) {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field) => {
    if (aliases[field]) {
      warn(issues, path, `Normalized field ${field} -> ${aliases[field]}.`);
      return aliases[field];
    }
    return field;
  });
}

function normalizeObjectFields(obj, aliases, path, issues) {
  if (!isObject(obj)) return;
  for (const [from, to] of Object.entries(aliases)) {
    if (from in obj && !(to in obj)) {
      obj[to] = obj[from];
      delete obj[from];
      warn(issues, `${path}.${from}`, `Normalized field ${from} -> ${to}.`);
    }
  }
}

function validateRange(value, path, issues, level) {
  if (!isRange(value)) {
    (level === 'warn' ? warn : error)(issues, path, 'Range must be an array of length 2.');
  }
}

function requireArray(value, path, issues) {
  if (!Array.isArray(value)) {
    error(issues, path, 'Must be an array.');
    return false;
  }
  return true;
}

function requireField(obj, key, path, issues) {
  if (!obj || !(key in obj)) error(issues, path, 'Required field is missing.');
}

function duplicate(set, value, path, issues) {
  if (value == null || value === '') return;
  if (set.has(value)) warn(issues, path, `Duplicate id/type ${value}.`);
  set.add(value);
}

function findEntity(schema, type) {
  return asArray(schema && schema.entities).find((entry) => entry && entry.type === type);
}

function isRange(value) {
  return Array.isArray(value) && value.length === 2;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function error(issues, path, msg) {
  issues.push({ level: 'error', path, msg });
}

function warn(issues, path, msg) {
  issues.push({ level: 'warn', path, msg });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { validateSchema };
