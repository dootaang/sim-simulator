'use strict';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function menu(schema, name) {
  return schema.entities.find((entry) => entry.type === 'menuItem').instances.find((item) => item.name === name);
}

function repCategory(schema, axis, startsWith) {
  return Object.keys(schema.ladders.find((entry) => entry.id === 'reputation').categories[axis])
    .find((key) => key.startsWith(startsWith));
}

module.exports = { deepFreeze, menu, repCategory };
