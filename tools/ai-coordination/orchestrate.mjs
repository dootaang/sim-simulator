#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {acquireLock,atomicJson,git,implementationPrompt,parseArgs,repositoryState,reviewPrompt,run,sessionName,validateReview,writeText,RUNTIME_DIR} from './core.mjs';

const root=process.cwd(),options=parseArgs(process.argv.slice(2));
if(options.help){console.log(`사용법: pnpm ai:pair -- --objective <파일> [--max-rounds 3] [--claude-budget-usd 5] [--timeout-minutes 45] [--dry-run]\n\n감독기는 Claude를 구현자, Codex를 읽기 전용 감사자로 차례로 실행합니다. 자동 커밋·푸시는 하지 않습니다.`);process.exit(0);}
if(!options.objective)throw new Error('objective_file_required');

const objectiveFile=path.resolve(root,options.objective),objective=await readFile(objectiveFile,'utf8');
if(!objective.trim())throw new Error('objective_empty');if(objective.length>100_000)throw new Error('objective_too_large');
const release=await acquireLock(root,{force:options.forceUnlock}),name=sessionName();
const directory=path.join(root,RUNTIME_DIR,'runs',name),worktree=path.join(root,RUNTIME_DIR,'worktrees',name),stateFile=path.join(directory,'STATUS.json');

try{
  const baseline=await repositoryState(root);
  if(baseline.tracked.length&&!options.dryRun)throw new Error(`tracked_worktree_not_clean:\n${baseline.tracked.join('\n')}`);
  const state={status:'running',startedAt:new Date().toISOString(),objectiveFile,baselineHead:baseline.head,branch:baseline.branch,mainUntrackedPreserved:baseline.untracked,worktree:options.dryRun?null:worktree,round:0,verdict:null};
  await atomicJson(stateFile,state);await writeText(path.join(directory,'OBJECTIVE.md'),objective);
  console.log(`교대 작업 시작 · ${baseline.branch}@${baseline.head.slice(0,7)} · 최대 ${options.maxRounds}라운드`);
  if(!options.dryRun){await git(['worktree','add','--detach',worktree,baseline.head],root);console.log(`격리 작업 트리: ${worktree}`);}
  let priorReview=null;
  for(let round=1;round<=options.maxRounds;round++){
    state.round=round;await atomicJson(stateFile,state);
    const implementPrompt=implementationPrompt({objective,round,review:priorReview,baselineHead:baseline.head,preexistingUntracked:[]});
    await writeText(path.join(directory,`round-${round}-implementer-prompt.md`),implementPrompt);
    if(options.dryRun){await writeText(path.join(directory,`round-${round}-reviewer-prompt.md`),reviewPrompt({objective,round,implementationReport:'(dry-run)',baselineHead:baseline.head}));state.status='dry_run';await atomicJson(stateFile,state);console.log(`dry-run 완료 · ${directory}`);break;}

    console.log(`[${round}/${options.maxRounds}] Claude 구현 시작`);
    const implementation=await run('claude',['-p','--output-format','json','--permission-mode','acceptEdits','--allowedTools','Read,Edit,Write,Glob,Grep,Bash','--disallowedTools','Bash(git commit *),Bash(git push *),Bash(git reset *),Bash(git checkout *),Bash(git clean *)','--max-budget-usd',String(options.claudeBudgetUsd),'--no-session-persistence'],{cwd:worktree,input:implementPrompt,timeoutMs:options.timeoutMinutes*60_000,logFile:path.join(directory,`round-${round}-claude.log`)});
    if(implementation.code)throw new Error(`claude_failed:${implementation.stderr.slice(-2000)}`);
    const afterImplementation=await repositoryState(worktree);
    if(afterImplementation.head!==baseline.head)throw new Error(`head_changed_by_implementer:${baseline.head}->${afterImplementation.head}`);
    let implementationReport=implementation.stdout;
    try{implementationReport=JSON.parse(implementation.stdout).result??implementation.stdout;}catch{}
    await writeText(path.join(directory,`round-${round}-implementation.md`),implementationReport);

    const reviewerPrompt=reviewPrompt({objective,round,implementationReport,baselineHead:baseline.head}),reviewOutput=path.join(directory,`round-${round}-review.json`),schema=path.join(worktree,'tools','ai-coordination','review.schema.json');
    await writeText(path.join(directory,`round-${round}-reviewer-prompt.md`),reviewerPrompt);
    console.log(`[${round}/${options.maxRounds}] Codex 읽기 전용 감사 시작`);
    const beforeReview=(await repositoryState(worktree)).rawStatus;
    const reviewRun=await run('codex',['exec','--ephemeral','--sandbox','read-only','--output-schema',schema,'--output-last-message',reviewOutput,'--cd',worktree,'-'],{cwd:worktree,input:reviewerPrompt,timeoutMs:options.timeoutMinutes*60_000,logFile:path.join(directory,`round-${round}-codex.log`)});
    if(reviewRun.code)throw new Error(`codex_failed:${reviewRun.stderr.slice(-2000)}`);
    const afterReview=await repositoryState(worktree);
    if(afterReview.head!==baseline.head||afterReview.rawStatus!==beforeReview)throw new Error('reviewer_modified_workspace');
    const review=validateReview(JSON.parse(await readFile(reviewOutput,'utf8')));priorReview=JSON.stringify(review,null,2);state.verdict=review.verdict;await atomicJson(stateFile,state);
    console.log(`[${round}/${options.maxRounds}] 감사 판정: ${review.verdict} · ${review.summary}`);
    if(review.verdict==='approve'){state.status='approved_unpublished';state.finishedAt=new Date().toISOString();await atomicJson(stateFile,state);await writeText(path.join(directory,'FINAL.md'),`# 양측 합의 완료\n\n${review.summary}\n\n자동 커밋·푸시는 하지 않았습니다. 격리 작업 트리에서 최종 확인한 뒤 게시하세요.\n\n작업 트리: \`${worktree}\`\n`);break;}
    if(review.verdict==='user_decision'){state.status='needs_user';state.finishedAt=new Date().toISOString();await atomicJson(stateFile,state);break;}
    if(round===options.maxRounds){state.status='max_rounds_reached';state.finishedAt=new Date().toISOString();await atomicJson(stateFile,state);}
  }
  console.log(`기록: ${directory}`);
}catch(error){
  await atomicJson(stateFile,{status:'failed',failedAt:new Date().toISOString(),error:error instanceof Error?error.message:String(error)}).catch(()=>{});throw error;
}finally{await release();}
