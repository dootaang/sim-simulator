'use strict';

const { deriveRng } = require('./rng.js');

function questRequirementMet(schema, state, quest) {
  const requires = quest && quest.requires;
  if (!requires) return true;
  if (requires.facility) {
    const level = Number((state.facilities && state.facilities[requires.facility]) || 0);
    if (level < Number(requires.level || 1)) return false;
  }
  return true;
}

function activeQuests(schema, state) {
  const all = (schema.quests || []).filter((quest) => questRequirementMet(schema, state, quest));
  const board = schema.questBoard;
  if (!board) return all;
  const facilityLevel = Number((state.facilities && state.facilities[board.facility]) || 0);
  if (facilityLevel < Number(board.unlockLevel || 1)) return [];
  const pendingId = state.pendingQuest && state.pendingQuest.day === state.day ? state.pendingQuest.questId : null;
  // 게시판은 하루 동안 고정한다. 완료 직후 후보를 다시 섞으면 버튼을 누르는 순간
  // 다른 의뢰가 튀어나온다. 완료 표시는 selector가 맡고 교체는 다음 day 주소에서 일어난다.
  const candidates = all;
  const rng = deriveRng(state.seed ?? 0, `questboard/${state.day}/${board.facility || 'none'}`);
  const shuffled = candidates.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const size = Math.max(1, Math.trunc(Number(board.size) || 3));
  const visible = shuffled.slice(0, size);
  if (pendingId && !visible.some((quest) => quest.id === pendingId)) {
    const pending = all.find((quest) => quest.id === pendingId);
    if (pending) visible.push(pending);
  }
  return visible;
}

module.exports = { activeQuests, questRequirementMet };
