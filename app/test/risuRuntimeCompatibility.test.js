'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSafeCbs } = require('../core/compat/safeCbs.js');
const { normalizeRegexScripts, applyRegexStage } = require('../core/compat/regexPipeline.js');
const { normalizeRisuModule, resolveModuleBindings } = require('../core/compat/moduleResolver.js');
const { extractLorebook, mergeLorebooks } = require('../core/lorebook/normalize.js');
const { simulateActivation } = require('../core/lorebook/activate.js');

test('안전 CBS는 읽기 전용 값만 치환하고 변경·미지원 매크로는 원문과 경고로 남긴다', () => {
  const result = evaluateSafeCbs('{{user}}/{{char}}/{{getvar::weather}}/{{setvar::gold::999}}', {
    user: '주인장', char: '실비아', variables: { weather: '비' },
  });
  assert.equal(result.text, '주인장/실비아/비/{{setvar::gold::999}}');
  assert.deepEqual(result.warnings.map((warning) => warning.detail), ['setvar']);
});

test('정규식은 네 단계를 분리하고 위험 지시·중첩 반복을 실행 차단한다', () => {
  const normalized = normalizeRegexScripts([{ scope: 'character', scripts: [
    { comment: '입력 정리', in: '\\s+$', out: '', type: 'editinput' },
    { comment: '표시', in: 'HP:(\\d+)', out: '체력 $1', type: 'editdisplay' },
    { comment: '활성 HTML', in: 'x', out: '<script>alert(1)</script>', type: 'editoutput' },
    { comment: 'redos', in: '(a+)+$', out: 'x', type: 'editrequest' },
  ] }]);
  assert.equal(applyRegexStage('말  ', normalized.scripts, 'editinput').text, '말');
  assert.equal(applyRegexStage('HP:12', normalized.scripts, 'editdisplay').text, '체력 12');
  assert.deepEqual(normalized.issues.filter((issue) => issue.level === 'blocked').map((issue) => issue.reason), ['action_or_active_content', 'unsafe_quantifier']);
});

test('모듈은 namespace 중복을 명시적 scope 우선순위로 해소하고 실행 코드를 차단한다', () => {
  const global = normalizeRisuModule({ id: 'old', namespace: 'weather', lorebook: [{}] }, 'global');
  const chat = normalizeRisuModule({ id: 'new', namespace: 'weather', regex: [{}], cjs: 'evil()' }, 'chat');
  const result = resolveModuleBindings([chat, global]);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].id, 'new');
  assert.equal(result.modules[0].execution, 'blocked');
  assert.equal(result.issues[0].reason, 'shadowed');
});

test('Risu 로어 확률·대소문자·깊이와 source 합성 순서가 결정론적으로 보존된다', () => {
  const cardLore = extractLorebook({ data: { name: '카드', character_book: { scan_depth: 8, recursive_scanning: true, entries: [
    { comment: 'Card', keys: ['Hero'], content: '@@depth 3\n@@role assistant\n카드', probability: 100, case_sensitive: true },
  ] } } });
  const moduleLore = extractLorebook({ module: { name: '모듈', lorebook: [
    { id: 'm1', comment: 'Module', key: 'hero', content: '모듈', activationPercent: 0 },
  ] } });
  const merged = mergeLorebooks([{ scope: 'character', lore: cardLore }, { scope: 'module', namespace: 'm', lore: moduleLore }]);
  assert.equal(merged.entries[0].depth, 3);
  assert.equal(merged.entries[0].role, 'assistant');
  assert.equal(simulateActivation(merged, 'hero', { seed: 7, turn: 1 }).active.length, 0, 'Hero는 case-sensitive이고 module은 확률 0');
  assert.equal(simulateActivation(merged, 'Hero', { seed: 7, turn: 1 }).active.length, 1);
  assert.equal(merged.recursive, true);
});

test('recursive lore는 활성 로어의 본문 키로 다음 로어를 결정론적으로 연쇄 활성화한다', () => {
  const lore = { recursive: true, entries: [
    { uid: 'a', name: 'A', keys: ['용'], content: '숨은 키는 여의주', enabled: true, probability: 100, order: 0 },
    { uid: 'b', name: 'B', keys: ['여의주'], content: '두 번째 지식', enabled: true, probability: 100, order: 1 },
  ] };
  const result = simulateActivation(lore, '용이 나타났다', { seed: 1, turn: 2 });
  assert.deepEqual(result.active.map((item) => [item.uid, item.activationPass]), [['a', 0], ['b', 1]]);
});
