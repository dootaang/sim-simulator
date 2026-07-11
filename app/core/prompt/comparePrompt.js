// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { compilePrompt } = require('./compilePrompt.js');

const ENGINE_BLOCKS = [
  { id: 'engine-facts', type: 'engineFacts', name: '엔진 사실', enabled: true, role: 'system', source: null },
  { id: 'available-actions', type: 'availableActions', name: '가능한 행동', enabled: true, role: 'system', source: null },
  { id: 'grounded-memory', type: 'groundedMemory', name: '근거 기억', enabled: true, role: 'system', source: null },
];

function compareRisuAndSimPack(input) {
  const risuPreset = JSON.parse(JSON.stringify(input.preset));
  risuPreset.compatibilityMode = 'risu';
  const simPreset = JSON.parse(JSON.stringify(input.preset));
  simPreset.compatibilityMode = 'simpack';
  const insertAt = Math.max(0, simPreset.blocks.findIndex((block) => block.type === 'chat'));
  const present = new Set(simPreset.blocks.map((block) => block.type));
  simPreset.blocks.splice(insertAt, 0, ...ENGINE_BLOCKS.filter((block) => !present.has(block.type)));
  const risu = compilePrompt({ ...input, preset: risuPreset, engineContext: null });
  const simpack = compilePrompt({ ...input, preset: simPreset });
  const engineIds = new Set(ENGINE_BLOCKS.map((block) => block.id));
  const simpackWithoutEngine = simpack.trace.filter((item) => !engineIds.has(item.blockId));
  const signature = (items) => items.map((item) => ({ blockId: item.blockId, blockType: item.blockType, role: item.role, active: item.active, reason: item.reason }));
  return {
    risu, simpack,
    additive: JSON.stringify(signature(risu.trace)) === JSON.stringify(signature(simpackWithoutEngine)),
    addedBlocks: simpack.trace.filter((item) => engineIds.has(item.blockId)),
  };
}

module.exports = { compareRisuAndSimPack, ENGINE_BLOCKS };
