import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const commands = [['engine-tests','npm',['test'],resolve(root,'engine')],['app-tests','npm',['test'],resolve(root,'app')],['app-typecheck','npm',['run','typecheck'],resolve(root,'app')],['app-build','npm',['run','build'],resolve(root,'app')]];
const results = {};
for (const [id, command, args, cwd] of commands) { const started = performance.now(); const executable = process.platform === 'win32' ? `${command}.cmd` : command; const result = spawnSync(executable, args, { cwd, encoding: 'utf8', shell: false }); results[id] = { ok: result.status === 0, status: result.status, durationMs: Math.round(performance.now() - started) }; if (result.status !== 0) { process.stderr.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status || 1); } }
const files = ['schema/yongsa-inn.v0.json','schema/generic-combat.v0.json','engine/test/fixtures/hero-inn.workflow.json','engine/test/fixtures/generic-combat.workflow.json','examples/alternate-hunters-v2/project.json'];
const hashes = Object.fromEntries(files.map((file) => [file, createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')]));
const baseline = { contract:'migration-baseline/0.1', createdAt:new Date().toISOString(), node:process.version, results, hashes };
writeFileSync(resolve(root,'migration-baseline.json'), `${JSON.stringify(baseline,null,2)}\n`); process.stdout.write(`${JSON.stringify(baseline,null,2)}\n`);
