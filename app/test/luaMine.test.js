'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLuaTables,
  parseValue,
  parseNumberRange,
} = require('../src/llm/luaMine.js');

test('block-commented tables are not mined', () => {
  const tables = parseLuaTables('--[[ ghost = {9,9} ]] real = {1,2}');
  assert.equal(Object.hasOwn(tables, 'ghost'), false);
  assert.deepEqual(tables.real, [1, 2]);
});

test('multiline block comments are skipped before the next table', () => {
  const tables = parseLuaTables('--[[\nghost = { 9, 9 }\nmore text\n]]\nreal = { 3, 4 }');
  assert.deepEqual(tables, { real: [3, 4] });
});

test('leveled block comments use a matching close delimiter', () => {
  const tables = parseLuaTables('--[==[ ghost = {1} ]] still comment ]==]\nreal = {5,6}');
  assert.deepEqual(tables, { real: [5, 6] });
});

test('unterminated block comments consume the remaining input without crashing', () => {
  assert.doesNotThrow(() => parseLuaTables('--[[ ghost = {9}\nreal = {1,2}'));
  assert.deepEqual(parseLuaTables('--[[ ghost = {9}\nreal = {1,2}'), {});
});

test('long-bracket strings preserve their raw multiline content', () => {
  const tables = parseLuaTables('t = { desc = [[여러\n줄]] , n = 5 }');
  assert.deepEqual(tables.t, { desc: '여러\n줄', n: 5 });
});

test('unterminated long-bracket strings return the remaining input without crashing', () => {
  let parsed;
  assert.doesNotThrow(() => { parsed = parseValue('[[unfinished\ntext', 0); });
  assert.deepEqual(parsed, ['unfinished\ntext', '[[unfinished\ntext'.length]);
});

test('leveled long strings are values and bracket keys keep their legacy path', () => {
  const [value] = parseValue('[=[left ]] middle\nright]=]', 0);
  assert.equal(value, 'left ]] middle\nright');
  assert.deepEqual(parseLuaTables('t = { [=[two]=] }').t, ['two']);
  assert.deepEqual(parseLuaTables('t = { [1] = "one" }').t, { 1: 'one' });
});

test('nested tables and line comments retain existing parsing behavior', () => {
  const tables = parseLuaTables('t = { nested = { 1, -- note\n2 }, value = 3 }');
  assert.deepEqual(tables.t, { nested: [1, 2], value: 3 });
});

test('quoted-string escapes retain the simplified legacy behavior', () => {
  const tables = parseLuaTables(String.raw`t = { value = "a\"b" }`);
  assert.equal(tables.t.value, 'a"b');
});

test('unterminated quoted strings do not crash', () => {
  assert.doesNotThrow(() => parseLuaTables('t = { value = "unfinished'));
  assert.equal(parseLuaTables('t = { value = "unfinished').t.value, 'unfinished');
});

test('numeric range parsing retains established cases', () => {
  assert.deepEqual(parseNumberRange('300,000~1,000,000'), [300000, 1000000]);
  assert.deepEqual(parseNumberRange('3~8만원'), [30000, 80000]);
  assert.equal(parseNumberRange('C~B'), null);
});
