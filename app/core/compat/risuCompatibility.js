// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { validateRisuCompatibilityEnvelope } = require('./schemas.js');
const { normalizeRisuModule } = require('./moduleResolver.js');
const { normalizeRegexScripts } = require('./regexPipeline.js');

const STATUSES = ['supported', 'preserved', 'translated', 'degraded', 'blocked'];

function createRisuCompatibilityEnvelope(parsed, lore) {
  const card = parsed && parsed.card || {};
  const data = card && typeof card === 'object' && !Array.isArray(card) ? (card.data || card) : {};
  const extensions = object(data.extensions);
  const risu = object(extensions.risuai);
  const moduleRoot = object(parsed && parsed.module || card && card.module || (card && card.type === 'risuModule' ? card.module : null));
  const assets = array(parsed && parsed.assets).map(assetReference);
  const modules = collectModules(parsed, moduleRoot);
  const features = collectCompatibilityFeatures({ parsed, lore, data, extensions, risu, moduleRoot, assets });
  const envelope = {
    contract: 'risu-compatibility/0.1',
    source: {
      format: sourceFormat(parsed && parsed.format),
      version: String(parsed && parsed.specVersion || parsed && parsed.spec || ''),
      fileName: String(parsed && parsed.source || ''),
      displayName: String(parsed && parsed.name || data.name || moduleRoot.name || ''),
    },
    raw: {
      card,
      sourceBytes: parsed && parsed._sourceBytes instanceof Uint8Array ? parsed._sourceBytes : null,
      containerEntries: array(parsed && parsed.containerEntries).map((entry) => ({
        name: String(entry.name || ''), size: finite(entry.size), kind: String(entry.kind || 'file'),
      })),
      extensions,
    },
    normalized: {
      character: normalizedCharacter(data, parsed),
      lorebooks: lore ? [lore] : [],
      assets,
      modules,
      persona: null,
      promptPreset: null,
    },
    compatibility: { features, totals: statusTotals(features) },
    provenance: baseProvenance(parsed, data, moduleRoot, lore),
  };
  const issues = validateRisuCompatibilityEnvelope(envelope);
  if (issues.length) throw new Error(`Risu compatibility envelope invalid: ${issues.map((item) => `${item.path} ${item.message}`).join('; ')}`);
  return envelope;
}

function collectCompatibilityFeatures(input) {
  const { parsed, lore, data, risu, moduleRoot, assets } = input;
  const features = [];
  add(features, 'character', '캐릭터 기본 정보', normalizedCharacter(data, parsed) ? 'supported' : 'preserved', normalizedCharacter(data, parsed) ? 1 : 0, '표준 카드 필드를 공통 캐릭터 모델로 읽습니다.', 'card', '$.data');
  add(features, 'lorebook', '로어북', lore ? 'supported' : 'preserved', lore ? array(lore.entries).length : 0, lore ? '활성화 설정과 원문을 함께 보존합니다.' : '읽을 로어북이 없습니다.', lore && lore.kind === 'module' ? 'module' : 'card', lore && lore.kind === 'module' ? '$.module.lorebook' : '$.data.character_book');
  add(features, 'assets', '에셋', assets.some((asset) => !asset.found) ? 'degraded' : 'supported', assets.length, assets.some((asset) => !asset.found) ? '일부 에셋 참조를 컨테이너에서 찾지 못했습니다.' : '에셋 메타데이터와 원본 바이트 위치를 보존합니다.', 'asset', '$.data.assets');
  const containerAssetCount = array(parsed && parsed.containerEntries).filter((entry) => /chara-ext-asset|asset:/i.test(String(entry && entry.name))).length;
  if (containerAssetCount > assets.length) add(features, 'container-assets', '컨테이너 전용 에셋', 'preserved', containerAssetCount - assets.length, '표준 assets 목록에는 없지만 원본 컨테이너 바이트에 보존했습니다. 후속 에셋 매퍼가 연결해야 합니다.', 'asset', '$.container');
  const embeddedModules = array(parsed && parsed.embeddedModules);
  if (embeddedModules.length) add(features, 'embedded-modules', '내장 모듈 파일', 'preserved', embeddedModules.length, '모듈 파일 원본은 보존했습니다. Lua·정규식 등 상세 실행 검사는 카드 MRI가 별도로 수행합니다.', 'module', '$.container');

  const regex = array(moduleRoot.regex).concat(array(risu.customScripts));
  if (regex.length) {
    const normalizedRegex = normalizeRegexScripts([{ scope: 'character', scripts: regex }]);
    const blocked = normalizedRegex.scripts.filter((script) => !script.safe).length;
    add(features, 'regex', '정규식 스크립트', blocked ? 'degraded' : 'supported', regex.length, blocked ? `${blocked}개는 안전 검사로 실행 차단하고 나머지는 단계별 실행할 수 있습니다.` : '입력·요청·출력·표시 단계를 구분해 안전한 치환으로 실행할 수 있습니다.', 'module', '$.module.regex');
  }

  const triggers = array(moduleRoot.trigger).concat(array(risu.triggerscript));
  const effects = triggers.flatMap((trigger) => array(trigger && trigger.effect));
  const luaCount = effects.filter((effect) => /lua/i.test(String(effect && effect.type))).length;
  const cjsCount = Number(!!moduleRoot.cjs);
  const lowLevelCount = Number(!!(moduleRoot.lowLevelAccess || risu.lowLevelAccess || triggers.some((trigger) => trigger && trigger.lowLevelAccess)));
  if (triggers.length) add(features, 'triggers', '트리거', luaCount || cjsCount || lowLevelCount ? 'blocked' : 'preserved', triggers.length, luaCount || cjsCount || lowLevelCount ? '실행 코드는 원본에 보존하지만 안전 경계가 생기기 전에는 실행하지 않습니다.' : '트리거 구조는 보존하고 호환 변환을 기다립니다.', 'module', '$.module.trigger');
  if (luaCount) add(features, 'lua', 'Lua', 'blocked', luaCount, '정적 분석만 하며 현재 실행하지 않습니다.', 'module', '$.module.trigger[*].effect');
  if (cjsCount) add(features, 'cjs', 'CJS 모듈 코드', 'blocked', cjsCount, '임의 JavaScript이므로 실행하지 않습니다.', 'module', '$.module.cjs');
  if (moduleRoot.mcp) add(features, 'mcp', 'MCP 연결', 'blocked', 1, '사용자 권한과 연결 격리가 생기기 전에는 호출하지 않습니다.', 'module', '$.module.mcp');
  if (lowLevelCount) add(features, 'low-level', '저수준 권한', 'blocked', lowLevelCount, '명시적 권한과 샌드박스가 없어 실행을 차단합니다.', 'module', '$.module.lowLevelAccess');

  const html = String(risu.backgroundHTML || '');
  if (html) add(features, 'html', 'HTML/CSS 화면', 'translated', 1, '원문은 보존하고 안전한 화면 선언으로 옮길 대상으로 표시합니다.', 'card', '$.data.extensions.risuai.backgroundHTML');
  const macroCount = countMacros([data.description, data.first_mes, data.post_history_instructions, lore && array(lore.entries).map((entry) => entry.content).join('\n')].join('\n'));
  if (macroCount) add(features, 'cbs', 'CBS 매크로', 'preserved', macroCount, '매크로 원문은 보존하며 지원 부분집합을 후속 단계에서 실행합니다.', 'card', '$.data');

  const knownRisu = new Set(['backgroundHTML', 'defaultVariables', 'bias', 'translatorNote', 'lowLevelAccess', 'hideChatIcon', 'utilityBot', 'escapeOutput', 'customScripts', 'triggerscript', 'additionalAssets', 'source', 'emotions', 'viewScreen', 'largePortrait', 'lorePlus', 'inlayViewScreen', 'newGenData', 'license', 'private', 'additionalText', 'toggles']);
  const opaqueRisu = Object.keys(risu).filter((key) => !knownRisu.has(key));
  if (opaqueRisu.length) add(features, 'opaque-extensions', '알 수 없는 Risu 확장 필드', 'preserved', opaqueRisu.length, `해석하지 않고 원본 그대로 보존합니다: ${opaqueRisu.join(', ')}`, 'card', '$.data.extensions.risuai');
  return features;
}

function normalizedCharacter(data, parsed) {
  const hasCharacter = !!(data && typeof data === 'object' && (data.name != null || data.description != null || data.first_mes != null)) && parsed && parsed.spec !== 'risu-module';
  if (!hasCharacter) return null;
  return {
    name: String(data.name || parsed.name || ''), description: String(data.description || ''),
    personality: String(data.personality || ''), scenario: String(data.scenario || ''),
    firstMessage: String(data.first_mes || ''), alternateGreetings: array(data.alternate_greetings).map(String),
    systemPrompt: String(data.system_prompt || ''), postHistoryInstructions: String(data.post_history_instructions || ''),
    creator: String(data.creator || ''), characterVersion: String(data.character_version || ''), tags: array(data.tags).map(String),
  };
}

function collectModules(parsed, moduleRoot) {
  const out = [];
  if (Object.keys(moduleRoot).length) out.push(moduleBinding(moduleRoot, 'embedded'));
  for (const name of array(parsed && parsed.embeddedModules)) {
    if (!out.some((item) => item.name === name)) out.push({
      id: String(name), name: String(name), namespace: '', scope: 'embedded', lowLevelAccess: false,
      capabilities: ['container-reference'], provenance: { source: 'module', path: String(name), note: '컨테이너 안의 모듈 파일' },
    });
  }
  return out;
}

function moduleBinding(moduleRoot, scope) {
  return normalizeRisuModule(moduleRoot, scope, '$.module');
}

function assetReference(asset) {
  return {
    name: String(asset && asset.name || ''), type: String(asset && asset.type || ''), ext: String(asset && asset.ext || ''),
    uri: String(asset && asset.uri || ''), mime: String(asset && asset.mime || ''), found: !!(asset && asset.found), size: finite(asset && asset.size),
  };
}

function baseProvenance(parsed, data, moduleRoot, lore) {
  const out = [{ source: 'card', path: '$', note: String(parsed && parsed.source || '') }];
  if (data && data.extensions) out.push({ source: 'card', path: '$.data.extensions' });
  if (Object.keys(moduleRoot).length) out.push({ source: 'module', path: '$.module' });
  if (lore) out.push({ source: lore.kind === 'module' ? 'module' : 'card', path: lore.kind === 'module' ? '$.module.lorebook' : '$.data.character_book' });
  return out;
}

function countMacros(text) { return Array.from(String(text || '').matchAll(/\{\{[^{}]+\}\}/g)).length; }
function add(list, id, label, status, count, reason, source, path) { list.push({ id, label, status, count: finite(count), reason, evidence: [{ source, path }] }); }
// 상단 요약은 로어 2천 개 같은 콘텐츠 수가 아니라 "지원 기능 종류" 수를 보여준다.
// 개별 콘텐츠 수는 각 feature.count 행에서 따로 표시한다.
function statusTotals(features) { return Object.fromEntries(STATUSES.map((status) => [status, features.filter((item) => item.status === status).length])); }
function sourceFormat(value) { return ['charx', 'png', 'jpeg', 'json', 'risum', 'persona-png', 'risup'].includes(value) ? value : 'unknown'; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function finite(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }

module.exports = { createRisuCompatibilityEnvelope, collectCompatibilityFeatures, normalizedCharacter, statusTotals };
