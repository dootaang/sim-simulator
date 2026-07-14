#!/usr/bin/env node
import {repositoryState,run} from './core.mjs';

const root=process.cwd(),checks=[];
for(const command of ['claude','codex']){
  try{const result=await run(command,['--version'],{cwd:root,timeoutMs:10_000});checks.push({name:command,ok:result.code===0,detail:(result.stdout||result.stderr).trim()});}
  catch(error){checks.push({name:command,ok:false,detail:error instanceof Error?error.message:String(error)});}
}
try{const result=await run('claude',['auth','status'],{cwd:root,timeoutMs:10_000}),value=JSON.parse(result.stdout);checks.push({name:'claude-auth',ok:result.code===0&&value.loggedIn===true,detail:value.loggedIn?`로그인됨 (${value.authMethod??'인증 방식 확인됨'})`:'로그인 필요'});}
catch(error){checks.push({name:'claude-auth',ok:false,detail:error instanceof Error?error.message:String(error)});}
try{const result=await run('codex',['login','status'],{cwd:root,timeoutMs:10_000});checks.push({name:'codex-auth',ok:result.code===0,detail:result.code===0?'로그인됨':'로그인 필요'});}
catch(error){checks.push({name:'codex-auth',ok:false,detail:error instanceof Error?error.message:String(error)});}
try{const state=await repositoryState(root);checks.push({name:'git',ok:!state.tracked.length,detail:state.tracked.length?`추적된 미완성 변경 ${state.tracked.length}건`:`${state.branch}@${state.head.slice(0,7)} · 기존 미추적 파일 ${state.untracked.length}건은 보존`});}
catch(error){checks.push({name:'git',ok:false,detail:error instanceof Error?error.message:String(error)});}
for(const check of checks)console.log(`${check.ok?'✓':'✗'} ${check.name}: ${check.detail}`);
if(checks.some(check=>!check.ok))process.exitCode=1;
