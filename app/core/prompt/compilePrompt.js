'use strict';

// C2 — Risu 호환 프롬프트 컴파일러 (순수 함수).
//
// 고증 출처(선별 재구현 — 전면 복사 아님): RisuAI, kwaroran/RisuAI, GPL-3.0,
// 로컬 클론 commit eb7780b (docs/BACKLOG.md 기준 커밋 9d8791e 이후 main).
// - src/ts/process/prompt.ts: PromptItem 타입(plain/jailbreak/typed/chat/authornote/cache)
// - src/ts/process/index.svelte.ts:
//   · 카드 systemPrompt의 {{original}} 병합(379행) · innerFormat의 {{slot}} 단일 치환(625행)
//   · chat range 음수·-1000 규칙(717행) · systemizeChat의 "role: content" 승격(2030행)
//   · description에 personality/scenario를 잇는 고정 문구(439~445행)
// 의도적 차이: Risu 템플릿 모드는 카드 systemPrompt를 무시하지만(레거시 경로만 병합),
// CCv3 명세는 system_prompt의 {{original}} 지원을 권고하므로 우리는 main slot에서 병합한다.
//
// 순수성 계약: 입력을 변이하지 않고, 같은 입력이면 항상 같은 출력. app/src 접근 금지.

const { estimateTokens } = require('../lorebook/tokens.js');
const { evaluateSafeCbs } = require('../compat/safeCbs.js');

function compilePrompt(input) {
  const preset = input && input.preset;
  if (!preset || !Array.isArray(preset.blocks)) throw new TypeError('compilePrompt: preset.blocks가 필요합니다 (normalizePromptPreset을 먼저 통과시키세요).');
  const card = (input && input.card) || {};
  const persona = (input && input.persona) || null;
  const loreEntries = input && input.lore && Array.isArray(input.lore.entries) ? input.lore.entries : [];
  const chat = Array.isArray(input && input.chat) ? input.chat : [];
  const authorNote = (input && input.authorNote) || null;
  const memory = typeof (input && input.memory) === 'string' ? input.memory : '';
  const engineContext = (input && input.engineContext) || null;
  const options = (input && input.options) || {};

  const vars = {
    user: String((persona && persona.name) || 'User'),
    char: String(card.name || ''),
  };
  const warnings = [];
  const warnedMacros = new Set();
  const substitute = (text, path) => {
    const result = evaluateSafeCbs(text, {
      user: vars.user, char: vars.char,
      persona: String((persona && persona.prompt) || ''),
      variables: input && input.variables && typeof input.variables === 'object' ? input.variables : {},
    });
    for (const warning of result.warnings) {
      if (warnedMacros.has(warning.detail)) continue;
      warnedMacros.add(warning.detail);
      warnings.push({ ...warning, path });
    }
    return result.text; // 미지원 매크로는 조용히 지우지 않고 원문 보존.
  };
  const applyInnerFormat = (format, content, path) => {
    if (typeof format !== 'string' || !format) return content;
    // Risu 고증: parser를 먼저 돌린 innerFormat에 {{slot}} "단일" 치환 — slot 내용은 재파싱하지 않는다.
    return substitute(format, path).replace('{{slot}}', content);
  };

  const trace = [];
  // 출력 조각: { message, blockIndex } — authorNote depth 주입 위치 계산을 위해 블록별 경계를 기억한다.
  const emitted = [];
  const roleOf = (block, fallback = 'system') => (block.role === 'user' || block.role === 'assistant' || block.role === 'system' ? block.role : fallback);

  const pushInactive = (block, index, reason, role = 'none', sourcePath = `preset.blocks[${index}]`) => {
    trace.push({ blockId: block.id, blockType: block.type, sourcePath, role, active: false, reason, chars: 0, tokensEstimate: 0 });
  };
  const pushActive = (block, index, role, content, sourcePath, extra) => {
    trace.push(Object.assign({
      blockId: block.id, blockType: block.type, sourcePath, role, active: true, reason: 'ok',
      chars: content.length, tokensEstimate: estimateTokens(content),
    }, extra || {}));
    emitted.push({ message: { role, content }, blockIndex: index });
  };

  // authorNote depth 주입 대상이 될 chat 블록이 실제로 메시지를 낼지 선계산.
  const chatSliceOf = (block) => {
    let start = block.rangeStart;
    let end = block.rangeEnd === 'end' ? chat.length : block.rangeEnd;
    if (start === -1000) { start = 0; end = chat.length; }
    if (start < 0) start = Math.max(0, chat.length + start);
    if (end < 0) end = Math.max(0, chat.length + end);
    if (start >= end) return { slice: [], start: 0 };
    return { slice: chat.slice(start, end), start };
  };
  const chatWillEmit = preset.blocks.some((block) => block.enabled !== false && block.type === 'chat' && chatSliceOf(block).slice.length > 0);

  const noteDepth = authorNote && Number.isFinite(Number(authorNote.depth)) ? Math.max(0, Math.trunc(Number(authorNote.depth))) : 0;
  const noteContentRaw = authorNote ? String(authorNote.content || '') : '';
  // depth 주입 노트는 리스트로 모은다 — authornote 블록이 2개 이상이어도 유실 없이
  // 전부 주입되어 trace와 messages가 일치해야 한다(감사 지적).
  const pendingNotes = []; // { message, depth }
  let lastChatSegment = null; // { startInEmitted, length }

  if (preset.settings && preset.settings.sendNames === true) {
    warnings.push({ code: 'send_names_unsupported', path: 'preset.settings.sendNames', detail: 'v0에서는 이름 필드 전송을 지원하지 않습니다.' });
  }

  preset.blocks.forEach((block, index) => {
    const path = `preset.blocks[${index}]`;
    if (block.enabled === false) return pushInactive(block, index, 'disabled', 'none');

    switch (block.type) {
      case 'plain':
      case 'jailbreak': {
        let text = String(block.text || '');
        let sourcePath = path;
        if (block.slot === 'main' && String(card.systemPrompt || '').trim()) {
          text = String(card.systemPrompt).replaceAll('{{original}}', text);
          sourcePath = `card.systemPrompt+${path}`;
        } else if (block.slot === 'globalNote' && String(card.postHistoryInstructions || '').trim()) {
          text = String(card.postHistoryInstructions).replaceAll('{{original}}', text);
          sourcePath = `card.postHistoryInstructions+${path}`;
        }
        const content = substitute(text, sourcePath);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), sourcePath);
        return pushActive(block, index, roleOf(block), content, sourcePath);
      }
      case 'description': {
        // Risu 고증: description 뒤에 personality/scenario를 고정 영문 문구로 잇는다(439~445행).
        let text = String(card.description || '');
        if (String(card.personality || '').trim()) text += `\n\nDescription of {{char}}: ${card.personality}`;
        if (String(card.scenario || '').trim()) text += `\n\nCircumstances and context of the dialogue: ${card.scenario}`;
        const content = applyInnerFormat(block.innerFormat, substitute(text, 'card.description'), path);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), 'card.description');
        return pushActive(block, index, roleOf(block), content, 'card.description');
      }
      case 'persona': {
        const content = applyInnerFormat(block.innerFormat, substitute(persona && persona.prompt, 'input.persona.prompt'), path);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), 'input.persona.prompt');
        return pushActive(block, index, roleOf(block), content, 'input.persona.prompt');
      }
      case 'lorebook': {
        const bodies = loreEntries.map((entry) => String((entry && entry.content) || '')).filter((body) => body.trim());
        const merged = bodies.map((body) => substitute(body, 'input.lore.entries')).join('\n\n');
        const content = applyInnerFormat(block.innerFormat, merged, path);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), 'input.lore.entries');
        return pushActive(block, index, roleOf(block), content, `input.lore.entries[0..${bodies.length - 1}]`);
      }
      case 'memory': {
        const content = applyInnerFormat(block.innerFormat, substitute(memory, 'input.memory'), path);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), 'input.memory');
        return pushActive(block, index, roleOf(block), content, 'input.memory');
      }
      case 'authornote': {
        const content = applyInnerFormat(block.innerFormat, substitute(noteContentRaw, 'input.authorNote'), path);
        if (!content.trim()) return pushInactive(block, index, 'empty', roleOf(block), 'input.authorNote');
        const role = roleOf(block);
        if (noteDepth > 0 && chatWillEmit) {
          pendingNotes.push({ message: { role, content }, depth: noteDepth });
          trace.push({
            blockId: block.id, blockType: block.type, sourcePath: 'input.authorNote', role, active: true, reason: 'ok',
            chars: content.length, tokensEstimate: estimateTokens(content), insertedAt: `chat[-${noteDepth}]`,
          });
          return;
        }
        if (noteDepth > 0 && !chatWillEmit) {
          warnings.push({ code: 'authornote_depth_fallback', path: 'input.authorNote.depth', detail: '주입할 대화가 없어 블록 위치에 그대로 출력합니다.' });
        }
        return pushActive(block, index, role, content, 'input.authorNote');
      }
      case 'chat': {
        const { slice, start } = chatSliceOf(block);
        if (!slice.length) return pushInactive(block, index, chat.length ? 'empty_range' : 'empty', 'none', 'input.chat');
        const asSystem = !!(preset.settings && preset.settings.sendChatAsSystem);
        const startInEmitted = emitted.length;
        slice.forEach((message, offset) => {
          const role = message.role === 'assistant' ? 'assistant' : 'user';
          let content = substitute(message.content, `input.chat[${start + offset}]`);
          let finalRole = role;
          if (asSystem) {
            // Risu systemizeChat 고증: "role: content"로 승격 후 system role.
            content = `${role}: ${content}`;
            finalRole = 'system';
          }
          pushActive(block, index, finalRole, content, `input.chat[${start + offset}]`);
        });
        lastChatSegment = { startInEmitted, length: slice.length };
        return;
      }
      case 'postEverything':
        // 앵커 블록 — 자체 내용이 없다. (Risu에서는 여러 내부 기능이 여기로 밀어넣는 컨테이너.)
        return pushInactive(block, index, 'empty', 'none');
      case 'cache':
        return pushInactive(block, index, 'unsupported', 'none');
      case 'engineFacts':
      case 'availableActions':
      case 'groundedMemory': {
        const key = block.type === 'engineFacts' ? 'facts' : block.type === 'availableActions' ? 'availableActions' : 'groundedMemory';
        const content = substitute(engineContext && engineContext[key], `engineContext.${key}`);
        if (!content.trim()) return pushInactive(block, index, 'empty', 'system', `engineContext.${key}`);
        return pushActive(block, index, 'system', content, `engineContext.${key}`);
      }
      default:
        return pushInactive(block, index, 'unsupported', 'none');
    }
  });

  // engineContext는 있는데 받아줄 블록이 프리셋에 없으면 — 몰래 다른 블록에 섞지 않고 경고만.
  if (engineContext) {
    const holders = { facts: 'engineFacts', availableActions: 'availableActions', groundedMemory: 'groundedMemory' };
    for (const [key, type] of Object.entries(holders)) {
      if (String(engineContext[key] || '').trim() && !preset.blocks.some((block) => block.enabled !== false && block.type === type)) {
        warnings.push({ code: 'engine_block_missing', path: `engineContext.${key}`, detail: `프리셋에 ${type} 블록이 없어 전달되지 않았습니다.` });
      }
    }
  }

  const messages = emitted.map((item) => item.message);
  if (pendingNotes.length && lastChatSegment) {
    // 원본 위치 기준 오름차순(동일 위치는 블록 순서 유지 — 안정 정렬)으로 삽입.
    // i번째 삽입 시점에는 앞선 i개가 전부 자기 위치 이하에 들어가 있으므로 +i 보정이 정확하다.
    pendingNotes
      .map((note) => ({ ...note, at: lastChatSegment.startInEmitted + Math.max(0, lastChatSegment.length - note.depth) }))
      .sort((a, b) => a.at - b.at)
      .forEach((note, i) => messages.splice(note.at + i, 0, note.message));
  }

  let finalMessages = messages;
  if (options.mergeConsecutiveRoles === true) {
    finalMessages = [];
    for (const message of messages) {
      const last = finalMessages[finalMessages.length - 1];
      if (last && last.role === message.role) last.content += `\n\n${message.content}`;
      else finalMessages.push({ role: message.role, content: message.content });
    }
  }

  return {
    messages: finalMessages,
    assistantPrefill: substitute((preset.settings && preset.settings.assistantPrefill) || '', 'preset.settings.assistantPrefill'),
    trace,
    warnings,
  };
}

module.exports = { compilePrompt };
