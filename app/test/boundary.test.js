'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCard } = require('../core/card/parseCard.js');
const { validateSchema } = require('../src/schema/validate.js');
const { patchSchemaWithMined } = require('../src/llm/schemaPatch.js');

test('parseCard rejects empty and arbitrary bytes with controlled errors', () => {
  assert.throws(() => parseCard(new Uint8Array()), Error);
  assert.throws(() => parseCard(Uint8Array.from([0x13, 0x37, 0x00, 0xff])), Error);
});

test('parseCard rejects truncated zip and PNG signatures with controlled errors', () => {
  assert.throws(() => parseCard(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), Error);
  assert.throws(() => parseCard(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), Error);
});

test('validateSchema handles null and arrays by returning issues', () => {
  for (const input of [null, []]) {
    let result;
    assert.doesNotThrow(() => { result = validateSchema(input); });
    assert.ok(Array.isArray(result.issues));
    assert.ok(result.issues.length > 0);
  }
});

test('validateSchema handles sparse and deeply malformed objects', () => {
  const inputs = [
    { meta: 1 },
    { meta: { id: { bad: true } }, resources: { nested: [] }, scales: [null], ladders: 'x', entities: [{}], events: [[[]]] },
  ];
  for (const input of inputs) {
    let result;
    assert.doesNotThrow(() => { result = validateSchema(input); });
    assert.ok(Array.isArray(result.issues));
    assert.ok(result.issues.length > 0);
  }
});

test('patchSchemaWithMined ignores missing and empty garbage inputs', () => {
  assert.deepEqual(patchSchemaWithMined(null, null), { schema: null, patches: [] });
  assert.deepEqual(patchSchemaWithMined([], { tables: {} }), { schema: [], patches: [] });
});

test('patchSchemaWithMined makes zero patches for nonmatching shapes', () => {
  const cases = [
    [{ meta: 1 }, { tables: { noise: { x: 'y' } } }],
    [{ entities: 'bad', ladders: { bad: true } }, { tables: { numbers: [3, 2, 1], nested: null } }],
  ];
  for (const [schema, mined] of cases) {
    let result;
    assert.doesNotThrow(() => { result = patchSchemaWithMined(schema, mined); });
    assert.equal(result.schema, schema);
    assert.deepEqual(result.patches, []);
  }
});
