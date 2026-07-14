import {spawn} from 'node:child_process';
import {appendFile, mkdir, open, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const RUNTIME_DIR='.ai-coordination';

export function commandLine(name,args=[]){
  if(process.platform==='win32'&&(name==='claude'||name==='codex')){
    const shim=path.join(process.env.APPDATA??'','npm',`${name}.ps1`);
    return{file:'powershell.exe',args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',shim,...args]};
  }
  return{file:name,args};
}

function terminateTree(child){
  if(!child.pid)return;
  if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).unref();
  else{child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},2_000).unref();}
}

export async function run(command,args,{cwd=process.cwd(),input='',timeoutMs=60_000,logFile=null,quiet=true,maxBytes=50*1024*1024}={}){
  const launch=commandLine(command,args),child=spawn(launch.file,launch.args,{cwd,env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='',bytes=0,timedOut=false;
  const capture=(kind,chunk)=>{const text=chunk.toString();bytes+=chunk.length;if(bytes>maxBytes){terminateTree(child);return;}if(kind==='stdout')stdout+=text;else stderr+=text;if(logFile)void appendFile(logFile,`[${kind}] ${text}`,'utf8');if(!quiet)(kind==='stdout'?process.stdout:process.stderr).write(text);};
  child.stdout.on('data',chunk=>capture('stdout',chunk));child.stderr.on('data',chunk=>capture('stderr',chunk));
  if(input){child.stdin.write(input);}child.stdin.end();
  const timer=setTimeout(()=>{timedOut=true;terminateTree(child);},timeoutMs);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1));}).finally(()=>clearTimeout(timer));
  if(bytes>maxBytes)throw new Error(`${command}_output_limit_exceeded`);
  if(timedOut)throw new Error(`${command}_timeout_after_${timeoutMs}ms`);
  return{code,stdout,stderr};
}

export async function git(args,cwd,{allowFailure=false}={}){
  const result=await run('git',args,{cwd,timeoutMs:30_000});
  if(result.code&&!allowFailure)throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function repositoryState(cwd){
  const [head,branch,status]=await Promise.all([git(['rev-parse','HEAD'],cwd),git(['branch','--show-current'],cwd),git(['status','--porcelain=v1','-z'],cwd)]);
  const entries=status?status.split('\0').filter(Boolean):[],tracked=[],untracked=[];
  for(const entry of entries)(entry.startsWith('??')?untracked:tracked).push(entry);
  return{head,branch,tracked,untracked,rawStatus:status};
}

export function parseArgs(argv){
  const options={maxRounds:3,claudeBudgetUsd:5,timeoutMinutes:45,dryRun:false,objective:null,forceUnlock:false};
  for(let index=0;index<argv.length;index++){
    const value=argv[index];
    if(value==='--objective')options.objective=argv[++index]??null;
    else if(value==='--max-rounds')options.maxRounds=positive(argv[++index],'max-rounds');
    else if(value==='--claude-budget-usd')options.claudeBudgetUsd=positive(argv[++index],'claude-budget-usd');
    else if(value==='--timeout-minutes')options.timeoutMinutes=positive(argv[++index],'timeout-minutes');
    else if(value==='--dry-run')options.dryRun=true;
    else if(value==='--force-unlock')options.forceUnlock=true;
    else if(value==='--help'||value==='-h')options.help=true;
    else throw new Error(`unknown_argument:${value}`);
  }
  return options;
}

function positive(value,label){const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`invalid_${label}:${value}`);return number;}

export async function atomicJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;
  await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,file);
}

export async function acquireLock(root,{force=false}={}){
  const directory=path.join(root,RUNTIME_DIR);await mkdir(directory,{recursive:true});const file=path.join(directory,'LOCK.json');
  if(force)await rm(file,{force:true});
  let handle;
  try{handle=await open(file,'wx');}
  catch(error){
    if(error?.code!=='EEXIST')throw error;
    let owner='알 수 없는 실행';try{owner=await readFile(file,'utf8');}catch{}
    throw new Error(`coordination_locked:${owner.trim()}`);
  }
  await handle.writeFile(`${JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})}\n`,'utf8');await handle.close();
  return async()=>rm(file,{force:true});
}

export async function writeText(file,text){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text,'utf8');}

export function sessionName(){return new Date().toISOString().replace(/[:.]/g,'-');}

export function implementationPrompt({objective,round,review,baselineHead,preexistingUntracked}){
  return `당신은 이 라운드의 구현자다. 사용자가 정한 목표를 실제 코드로 완성하되, 다음 감사자가 독립적으로 검증할 수 있게 근거를 남겨라.

## 목표
${objective}

## 현재 라운드
${round}

## 기준 커밋
${baselineHead}

## 이전부터 존재한 사용자 파일(절대 수정·삭제·커밋 금지)
${preexistingUntracked.length?preexistingUntracked.join('\n'):'(없음)'}

## 이전 감사
${review??'(첫 라운드 — 이전 감사 없음)'}

## 강제 규칙
- 저장소의 AGENTS.md, ADR, DESIGN을 따른다.
- 한 번에 구현 범위만 수정한다. .ai-coordination과 tools/ai-coordination은 건드리지 않는다.
- git commit, push, reset, checkout, clean을 실행하지 않는다. 게시 여부는 감독기 밖에서 결정한다.
- 이전 감사 지적은 코드로 직접 검증한 뒤 수용하거나, 틀렸다면 구체적 근거로 반박한다.
- 관련 검증을 실행하되 실패를 숨기지 않는다.
- 사용자나 다른 작업자의 무관한 변경을 건드리지 않는다.
- 마지막 답변에는 실제 화면/플레이에서 달라지는 점, 변경 파일, 실행한 검증, 남은 위험을 적는다.
`;
}

export function reviewPrompt({objective,round,implementationReport,baselineHead}){
  return `당신은 독립 감사자다. 구현자의 설명을 믿지 말고 현재 작업 트리의 실제 diff와 호출 경로를 읽어 검증하라. 파일은 절대 수정하지 않는다.

## 사용자 목표
${objective}

## 기준 커밋
${baselineHead}

## 라운드
${round}

## 구현자 보고
${implementationReport}

## 판정 규칙
- 실제 사용자 화면·플레이 동작이 목표를 충족하는지가 우선이다.
- 비슷한 이름의 파일이나 초록색 테스트만으로 승인하지 않는다.
- 보안, 상태 소유권, 저장·새로고침, 모바일, 실물 카드 경로를 범위에 맞게 확인한다.
- critical/high/medium 결함이 있으면 changes_requested다.
- 제품 선택이 필요하고 임의 결정하면 결과가 크게 바뀌는 경우에만 user_decision이다.
- 근거에는 파일과 줄 또는 재현 가능한 호출 경로를 적는다.
- 사소한 취향 차이만으로 승인을 막지 않는다.
- 출력은 지정된 JSON 스키마만 따른다.
`;
}

export function validateReview(value){
  if(!value||!['approve','changes_requested','user_decision'].includes(value.verdict)||typeof value.summary!=='string'||!Array.isArray(value.findings)||!Array.isArray(value.questions))throw new Error('review_output_invalid');
  for(const finding of value.findings)if(!finding||!['critical','high','medium','low'].includes(finding.severity)||['title','evidence','recommendation'].some(key=>typeof finding[key]!=='string'))throw new Error('review_finding_invalid');
  return value;
}
