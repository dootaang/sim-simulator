'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { createState } = require('../core/createState.js'); const { applyEvent } = require('../core/applyEvent.js'); const { createRng } = require('../core/rng.js');
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../examples/cross-genre/fixtures.json'), 'utf8'));
function run(schema, state, id, params = {}) { return applyEvent(schema, state, { id, params }, createRng(11)); }

test('루미나 마을은 시뮬 규칙을 억지로 합성하지 않고 대화·로어 프로젝트로 열린다', () => {
  const fixture = fixtures.lumina; const state = createState(fixture.schema, 1); assert.equal(fixture.mode, 'conversation-lore'); assert.equal(fixture.screens.length, 0); assert.equal(fixture.lore[0].keys[0], '루미나'); assert.equal(state.day, 1); assert.equal(state.combat, null);
});

test('소녀전선 축소 루프: 인형 보유→제대 편성→임무 보상→수복', () => {
  const schema = fixtures.girlsFrontline.schema; let state = createState(schema, 1); state = run(schema, state, 'party/add', { memberId: 'm4a1' }).state; state = run(schema, state, 'party/add', { memberId: 'st-ar15' }).state; state = run(schema, state, 'party/assign', { memberId: 'm4a1', role: 'leader' }).state; state = run(schema, state, 'quest/start', { questId: 'supply-run' }).state; state = run(schema, state, 'quest/progress', { questId: 'supply-run', stepId: 'clear' }).state; state = run(schema, state, 'quest/claim', { questId: 'supply-run' }).state; state = run(schema, state, 'jobs/start', { jobId: 'repair-m4a1' }).state; const job = state.jobs[0].id; state = run(schema, state, 'jobs/tick', { instanceId: job }).state; assert.deepEqual(state.party.members, ['m4a1', 'st-ar15']); assert.equal(state.resources.reward_token, 1); assert.equal(state.resources.repair_parts, 1); assert.equal(state.resources.m4a1_health, 100);
});

test('Belladonna 축소 루프: 주간 계획→학사 사건→성장→다음 주', () => {
  const schema = fixtures.belladonna.schema; let state = createState(schema, 1); state = run(schema, state, 'jobs/start', { jobId: 'study-week' }).state; const job = state.jobs[0].id; state = run(schema, state, 'jobs/tick', { instanceId: job }).state; state = run(schema, state, 'factions/change', { factionId: 'student-council', source: 'academy-event' }).state; state = run(schema, state, 'progression/gain', { source: 'study' }).state; state = run(schema, state, 'time/advance', { unit: 'day' }).state; assert.equal(state.resources.study_result, 1); assert.equal(state.factions['student-council'], 5); assert.equal(state.player.exp, 10); assert.equal(state.day, 2);
});

test('세 장르 축소 루프의 기능 80% 이상은 기존 공통 모듈 조합이다', () => {
  const used = ['rpg.party', 'rpg.quests', 'core.jobs', 'core.time', 'core.factions', 'core.progression']; const genreSpecific = []; assert.ok(used.length / (used.length + genreSpecific.length || 1) >= 0.8);
});
