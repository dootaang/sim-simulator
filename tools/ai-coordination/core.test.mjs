import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acquireLock,atomicJson,commandLine,parseArgs,validateReview} from './core.mjs';

test('명령행의 비용·반복·시간 안전 한도를 읽는다',()=>{
  assert.deepEqual(parseArgs(['--objective','goal.md','--max-rounds','2','--claude-budget-usd','3.5','--timeout-minutes','10','--dry-run']),{maxRounds:2,claudeBudgetUsd:3.5,timeoutMinutes:10,dryRun:true,objective:'goal.md',forceUnlock:false});
  assert.throws(()=>parseArgs(['--max-rounds','0']),/invalid_max-rounds/);
});

test('Windows npm CLI는 PowerShell 래퍼로 안전하게 실행한다',()=>{
  const launch=commandLine('claude',['--version']);
  if(process.platform==='win32'){assert.equal(launch.file,'powershell.exe');assert.ok(launch.args.some(value=>value.endsWith('claude.ps1')));}
  else assert.deepEqual(launch,{file:'claude',args:['--version']});
  assert.deepEqual(commandLine('git',['status']),{file:'git',args:['status']});
});

test('동시에 두 감독기가 같은 작업 트리를 잡지 못한다',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'simbot-pair-')),release=await acquireLock(root);
  await assert.rejects(()=>acquireLock(root),/coordination_locked/);await release();
  const next=await acquireLock(root);await next();await rm(root,{recursive:true,force:true});
});

test('상태 파일은 완성된 JSON으로 원자 교체된다',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'simbot-state-')),file=path.join(root,'STATUS.json');
  await atomicJson(file,{status:'running',round:1});await atomicJson(file,{status:'approved',round:2});assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{status:'approved',round:2});await rm(root,{recursive:true,force:true});
});

test('감사 결과는 허용된 판정과 근거 구조만 받는다',()=>{
  const valid={verdict:'changes_requested',summary:'수정 필요',findings:[{severity:'high',title:'저장 누락',evidence:'a.ts:1',recommendation:'저장 연결'}],questions:[]};
  assert.equal(validateReview(valid),valid);assert.throws(()=>validateReview({...valid,verdict:'maybe'}),/review_output_invalid/);
});
