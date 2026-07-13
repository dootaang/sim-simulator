import{describe,expect,it}from'vitest';import{createMemoryRepository}from'@simbot/persistence';import{type PromptPreset}from'@simbot/risu';import{ProjectRuntime}from'@simbot/runtime';import{PlaySession,sessionIntegrity,type SessionSnapshot}from'../src/index.ts';

describe('session editing and turn checkpoints',()=>{
  it('edits and removes messages without changing engine state or reusing message ids',async()=>{const repository=createMemoryRepository<SessionSnapshot>(),session=new PlaySession({id:'editing',runtime:runtime(),preset,card:{name:'Guide'},repository,provider:{async complete(){return{text:'answer',events:[{id:'progression/gain',params:{source:'train'}}]};}}});await session.send('one');await session.send('two');const engine=session.runtime.snapshot();await session.editMessage('m2','edited answer');expect(session.messages.find((message)=>message.id==='m2')?.content).toBe('edited answer');expect((await repository.get('editing'))?.payload.messages.find((message)=>message.id==='m2')?.content).toBe('edited answer');expect(session.runtime.snapshot()).toEqual(engine);await session.removeMessage('m2');expect(session.messages.map((message)=>message.id)).toEqual(['m1','m3','m4']);expect(session.runtime.snapshot()).toEqual(engine);await session.send('three');expect(new Set(session.messages.map((message)=>message.id)).size).toBe(session.messages.length);expect(session.messages.at(-1)?.id).toBe('m6');const afterThird=session.runtime.snapshot();await session.removeMessage('m3',true);expect(session.messages.map((message)=>message.id)).toEqual(['m1']);expect(session.runtime.snapshot()).toEqual(afterThird);});
  it('undoes the third turn to the exact second-turn messages, engine, and memory',async()=>{const session=new PlaySession({id:'undo',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'answer',events:[{id:'progression/gain',params:{source:'train'}}]};}}});await session.send('one');await session.send('two');const atTwo=session.snapshot();await session.send('three');expect(session.checkpointDepth).toBe(3);await session.undoTurn();expect(session.turn).toBe(atTwo.turn);expect(session.messages).toEqual(atTwo.messages);expect(session.runtime.snapshot()).toEqual(atTwo.engine);expect(session.memory.all()).toEqual(atTwo.memory);expect(session.checkpointDepth).toBe(2);});
  it('rerolls from the prior checkpoint, keeps one user turn, and exposes the prior alternate',async()=>{let call=0;const session=new PlaySession({id:'reroll',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){call+=1;return{text:`answer-${call}`,events:[{id:'progression/gain',params:{source:'train'}}]};}}});await session.send('one');await session.send('two');const previous=session.snapshot();const result=await session.reroll();expect(result.response.text).toBe('answer-3');expect(session.messages.filter((message)=>message.role==='user')).toHaveLength(2);expect(session.messages.at(-1)?.content).toBe('answer-3');expect((session.runtime.state.player as Record<string,unknown>).exp).toBe(4);expect(session.alternateCount).toBe(1);expect(session.checkpointDepth).toBe(2);session.showAlternate(0);expect(session.messages).toEqual(previous.messages);expect(session.runtime.snapshot()).toEqual(previous.engine);expect(session.lastLogs).toEqual(previous.lastLogs);});
});

describe('Risu-style alternatives and continuation',()=>{
  it('stores a sidecar translation and response metadata without changing the original',async()=>{let calls=0;const provider={async complete(){calls+=1;return calls===1?{text:'<b>Hello</b> {{raw::face}}',usage:{inputTokens:12,outputTokens:4},model:'model-x',finishReason:'stop',generationId:'gen-1'}:{text:'<b>안녕</b> {{raw::face}}'};}};const session=new PlaySession({id:'translation',runtime:runtime(),preset,card:{name:'Guide'},provider,providerInfo:{provider:'test',model:'fallback'}});await session.send('hello');const original=session.messages.at(-1)!.content;await session.translateMessage(session.messages.at(-1)!.id);expect(session.messages.at(-1)?.content).toBe(original);expect(session.messages.at(-1)?.translation).toContain('{{raw::face}}');expect(session.promptRuns[0]).toMatchObject({provider:'test',model:'model-x',inputTokens:12,outputTokens:4,tokensEstimated:false,finishReason:'stop',generationId:'gen-1'});});
  it('restores generated alternatives after reopening a saved session',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>();let call=0;
    const make=()=>new PlaySession({id:'persistent-alternates',runtime:runtime(),preset,card:{name:'Guide'},repository,provider:{async complete(){call+=1;return{text:`answer-${call}`};}}});
    const first=make();await first.send('hello');await first.reroll();expect(first.alternateCount).toBe(1);
    const restored=make();restored.restore((await repository.get('persistent-alternates'))!.payload);
    expect(restored.alternateCount).toBe(1);await restored.showAlternate(0);expect(restored.messages.at(-1)?.content).toBe('answer-1');
  });
  it('sends a continuation instruction without storing a fake user message',async()=>{
    let promptText='';const session=new PlaySession({id:'continue',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete({prompt}){promptText=prompt.messages.map(message=>message.content).join('\n');return{text:'continued'};}}});
    await session.continueGeneration();
    expect(promptText).toContain('Continue the last assistant response');
    expect(session.messages.map(message=>message.role)).toEqual(['assistant']);
    expect(session.messages[0]?.content).toBe('continued');
  });
  it('keeps a bounded prompt and engine evidence ledger in the saved snapshot',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=new PlaySession({id:'audit-ledger',runtime:runtime(),preset,card:{name:'Guide'},repository,provider:{async complete(){return{text:'done',events:[{id:'progression/gain',params:{source:'train'}}]};}}});
    await session.send('train');const run=session.promptRuns[0]!;
    expect(run.prompt!.messages.length).toBeGreaterThan(0);expect(run.stateBefore).not.toEqual(run.stateAfter);expect(run.logs).toEqual(expect.arrayContaining([expect.objectContaining({ok:true})]));
    expect((await repository.get('audit-ledger'))?.payload.promptRuns?.[0]?.id).toBe(run.id);
  });
});

describe('card tag translation channel',()=>{
  it('dispatches registered card events, strips translated tags, and blocks button-only events',async()=>{const value=new ProjectRuntime({projectId:'inn',schema:{initialState:{day:1,gold:0,resources:{food:0,drink:0},facilities:{},staff:[],rooms:{},npcs:{},player:{}}},screens:[],navigation:[],content:{},featureToggles:{},moduleIds:['genre.inn']}),session=new PlaySession({id:'tagged',runtime:value,preset,card:{name:'Guide'},tagTranslator:()=>({residue:'tag-free narrative',events:[{id:'gold_delta',params:{amount:50}},{id:'traffic_wave',params:{wave:'lunch'}}]}),provider:{async complete(){return{text:'story [ysp_gold::50] [ysp_wave]'};}}});const result=await session.send('play');expect((value.state as Record<string,unknown>).gold).toBe(50);expect(result.logs).toEqual(expect.arrayContaining([expect.objectContaining({ok:true,event:'gold_delta'}),expect.objectContaining({ok:false,event:'traffic_wave',reason:'card_tag_blocked'})]));expect(session.messages.at(-1)?.content).toBe('tag-free narrative');expect(session.memory.all().some((record)=>record.id.startsWith('engine:0:gold_delta:'))).toBe(true);});
  it('keeps the original assistant text when no translator is injected',async()=>{const session=new PlaySession({id:'plain',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'plain [ysp_gold::50]'};}}});await session.send('play');expect(session.messages.at(-1)?.content).toBe('plain [ysp_gold::50]');});
});
describe('asset speaker extraction',()=>{
  it('uses deterministic card image commands when a prose provider has no speaker metadata',async()=>{
    const session=new PlaySession({id:'sprite-speaker',runtime:runtime(),preset,card:{name:'Guide'},speakerExtractor:(text)=>text.includes('silvia_smile')?[{npcId:'silvia',emotion:'smile',focus:true}]:[],provider:{async complete(){return{text:'<img src="silvia_smile"> 반가워요.'};}}});
    await session.send('인사한다');
    expect(session.rawLastSpeakers).toEqual([{npcId:'silvia',emotion:'smile',focus:true}]);
  });
  it('prefers provider speaker metadata when it exists',async()=>{
    const session=new PlaySession({id:'provider-speaker',runtime:runtime(),preset,card:{name:'Guide'},speakerExtractor:()=>[{npcId:'fallback'}],provider:{async complete(){return{text:'hello',speakers:[{npcId:'provider',emotion:'angry'}]};}}});
    await session.send('인사한다');
    expect(session.rawLastSpeakers).toEqual([{npcId:'provider',emotion:'angry'}]);
  });
});
const source={source:'user' as const,path:'test'},preset:PromptPreset={contract:'prompt-preset/0.1',id:'p',name:'p',compatibilityMode:'simpack',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source},{id:'facts',type:'engineFacts',name:'facts',enabled:true,role:'system',source},{id:'actions',type:'availableActions',name:'actions',enabled:true,role:'system',source},{id:'memory',type:'groundedMemory',name:'memory',enabled:true,role:'system',source}]};
function runtime(){return new ProjectRuntime({projectId:'p',schema:{progression:{sources:{train:[2,2]},thresholds:[10]},initialState:{player:{level:1,exp:0}}},screens:[{id:'play',regions:{actions:[{widget:'action-group',actions:[{event:{id:'progression/gain',params:{source:'train'}}}]}]}}],navigation:[],content:{},featureToggles:{},moduleIds:[]});}
describe('long play session coordinator',()=>{it('applies only screen-approved registered events and persists exact engine state',async()=>{const repository=createMemoryRepository<SessionSnapshot>(),session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},repository,provider:{async complete(){return{text:'done',events:[{id:'progression/gain',params:{source:'train'}},{id:'progression/allocate',params:{stat:'atk'}},{id:'invent_gold',params:{amount:999}}]};}}});const result=await session.send('train');expect(result.logs).toEqual(expect.arrayContaining([expect.objectContaining({ok:true,event:'progression/gain'}),expect.objectContaining({ok:false,reason:'model_event_not_allowed'}),expect.objectContaining({ok:false,reason:'unregistered_model_event'})]));expect((session.runtime.state.player as Record<string,unknown>).exp).toBe(2);expect((await repository.get('s'))?.payload.turn).toBe(1);});it('blocks overlapping model requests',async()=>{let release=()=>{};const wait=new Promise<void>((resolve)=>release=resolve),session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){await wait;return{text:'done'};}}});const first=session.send('one');await expect(session.send('two')).rejects.toThrow('session_busy');release();await first;});});

it('runs 300 turns without growing the model context or losing restorable state',async()=>{const repository=createMemoryRepository<SessionSnapshot>();let calls=0,maxPromptMessages=0;const session=new PlaySession({id:'long',runtime:runtime(),preset,card:{name:'Guide'},repository,historyWindow:40,provider:{async complete({prompt}){calls+=1;maxPromptMessages=Math.max(maxPromptMessages,prompt.messages.length);return{text:`turn ${calls}`,...(calls%5===0?{events:[{id:'progression/gain',params:{source:'train'}}]}:{})};}}});for(let turn=1;turn<=300;turn++)await session.send(`action ${turn}`);expect(session.turn).toBe(300);expect(session.messages).toHaveLength(600);expect(maxPromptMessages).toBeLessThanOrEqual(43);const saved=(await repository.get('long'))!.payload,restored=new PlaySession({id:'long',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'restored'};}}});restored.restore(saved);expect(restored.turn).toBe(300);expect(restored.runtime.snapshot()).toEqual(session.runtime.snapshot());expect(restored.memory.all()).toEqual(session.memory.all());});
describe('되돌리기 — restore가 미래 턴 메모리를 남기지 않는다',()=>{it('스냅샷 이후 생긴 메모리는 롤백 시 사라진다',async()=>{const session=new PlaySession({id:'u',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok',events:[{id:'progression/gain',params:{source:'train'}}],memories:[{text:'이번 턴의 서사 기억'}]};}}});await session.send('turn1');const checkpoint=session.snapshot();const idsAt1=session.memory.all().map((r)=>r.id).sort();await session.send('turn2');expect(session.memory.all().some((r)=>r.id.includes(':1:'))).toBe(true);session.restore(checkpoint);expect(session.memory.all().map((r)=>r.id).sort()).toEqual(idsAt1);expect(session.memory.all().some((r)=>r.id.includes(':1:'))).toBe(false);});});
describe('대안 전환 — 파생 상태 전부가 함께 돌아간다',()=>{it('showAlternate가 기억 원장과 무대 화자까지 복원한다',async()=>{let call=0;const session=new PlaySession({id:'alt',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){call+=1;return{text:`v${call}`,speakers:[{npcId:`npc${call}`}],memories:[{text:`기억 v${call}`}]};}}});await session.send('턴1');const memA=session.memory.all(),spkA=session.rawLastSpeakers;await session.reroll();expect(session.messages.at(-1)?.content).toBe('v2');expect(session.memory.all()).not.toEqual(memA);await session.showAlternate(0);expect(session.messages.at(-1)?.content).toBe('v1');expect(session.memory.all()).toEqual(memA);expect(session.rawLastSpeakers).toEqual(spkA);});});
describe('감사 수정 회귀 — 실패 롤백·삭제 정합·무결성 필수',()=>{
  it('모델 호출 실패 시 user 메시지와 체크포인트가 되감긴다',async()=>{let fail=true;const session=new PlaySession({id:'rb',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){if(fail)throw new Error('model_http_500');return{text:'ok'};}}});await expect(session.send('hello')).rejects.toThrow('model_http_500');expect(session.messages).toHaveLength(0);expect(session.checkpointDepth).toBe(0);fail=false;await session.send('hello');expect(session.messages.map((m)=>m.role)).toEqual(['user','assistant']);});
  it('cascade 삭제 후 되돌리기가 지운 미래를 부활시키지 않는다',async()=>{const session=new PlaySession({id:'cs',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok'};}}});for(let t=1;t<=3;t++)await session.send(`턴${t}`);const deletedId=session.messages[2]!.id;await session.removeMessage(deletedId,true);expect(session.messages).toHaveLength(2);expect(session.checkpointDepth).toBe(2);await session.undoTurn();expect(session.messages.length).toBeLessThanOrEqual(2);expect(session.messages.some((m)=>m.id===deletedId)).toBe(false);});
  it('무결성 해시가 없는 스냅샷은 복구를 거부한다(우회 차단)',async()=>{const session=new PlaySession({id:'it',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok'};}}});await session.send('x');const stripped=structuredClone(session.snapshot()) as unknown as Record<string,unknown>;delete stripped.integrity;const target=new PlaySession({id:'it',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok'};}}});expect(()=>target.restore(stripped as never)).toThrow(/session_corrupt/);});
});
describe('프록시 안전성 — UI가 감싼 객체가 세션을 죽이지 않는다',()=>{
  // 재현: Svelte 5 $state는 값을 Proxy로 감싸고 structuredClone은 Proxy를 복제하지 못한다(DataCloneError).
  const wrap=<T extends object>(value:T):T=>new Proxy(value,{});
  it('프록시로 감싼 card 옵션으로 세션을 만들 수 있다',()=>{expect(structuredClone as unknown).toBeTruthy();expect(()=>new PlaySession({id:'p',runtime:runtime(),preset:wrap(preset),card:wrap({name:'Guide'}),provider:{async complete(){return{text:'ok'};}}})).not.toThrow();});
  it('프록시로 감싼 스냅샷을 복구할 수 있다',async()=>{const session=new PlaySession({id:'p2',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok'};}}});await session.send('x');const snap=session.snapshot();const target=new PlaySession({id:'p2',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'ok'};}}});expect(()=>target.restore(wrap(snap))).not.toThrow();expect(target.turn).toBe(1);expect(target.messages).toHaveLength(2);});
});
describe('서사 검증 관문 — 지어낸 숫자 탐지',()=>{
  it('엔진 근거에 없는 숫자를 말하면 issues에 잡히고, 서사 원문은 보존된다',async()=>{
    const session=new PlaySession({id:'nv',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'금고에 250만 골드가 쌓였다.'};}}});
    await session.send('금고를 확인한다');
    expect(session.narrativeIssues.map((i)=>i.code)).toContain('unsupported-number');
    expect(session.messages.at(-1)?.content).toBe('금고에 250만 골드가 쌓였다.'); // 원문 보존(자르지 않는다)
  });
  it('엔진이 확정한 숫자만 말하면 문제 없다',async()=>{
    const session=new PlaySession({id:'nv2',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'별일 없이 하루가 지났다.'};}}});
    await session.send('쉰다');
    expect(session.narrativeIssues).toEqual([]);
  });
});
describe('통합 감사 수정 — 무결성·카드 태그 채널',()=>{
  it('cbsVariables 변조를 무결성 검증이 잡는다',async()=>{
    const session=new PlaySession({id:'ia',runtime:runtime(),preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    await session.send('x');
    const snap=structuredClone(session.snapshot()) as SessionSnapshot&{cbsVariables?:Record<string,string>};
    snap.cbsVariables={gold:'99999999'}; // 저장 파일의 변수만 손댄다
    const target=new PlaySession({id:'ia',runtime:runtime(),preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    expect(()=>target.restore(snap)).toThrow(/session_corrupt/);
  });
  it('cbsVariables가 없던 구 스냅샷은 그대로 복원된다(하위호환)',async()=>{
    const session=new PlaySession({id:'ib',runtime:runtime(),preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    await session.send('x');
    const snap=structuredClone(session.snapshot()) as unknown as Record<string,unknown>;
    delete snap.cbsVariables; const base={...snap}; delete base.integrity;
    const legacy={...base,integrity:sessionIntegrity(base as never)} as SessionSnapshot;
    const target=new PlaySession({id:'ib',runtime:runtime(),preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    expect(()=>target.restore(legacy)).not.toThrow();
  });
  it('컴파일 스키마가 바뀌면 같은 채팅의 낡은 엔진 상태를 복원하지 않는다',async()=>{
    const source=new PlaySession({id:'schema-bound',runtime:runtime(),preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    await source.send('x');
    const project=runtime().project,changed=new ProjectRuntime({...project,schema:{...project.schema,_compiler:{version:'0.2'},initialState:{day:1,gold:999,player:{}}}}),target=new PlaySession({id:'schema-bound',runtime:changed,preset,card:{name:'C'},provider:{async complete(){return{text:'ok'};}}});
    expect(()=>target.restore(source.snapshot())).toThrow('session_schema_incompatible');
  });
  it('카드 태그 채널은 허용목록 밖 이벤트를 거부한다(방어 심층)',async()=>{
    const value=runtime();
    const session=new PlaySession({id:'ic',runtime:value,preset,card:{name:'C'},
      tagTranslator:()=>({residue:'서사',events:[{id:'progression/gain',params:{source:'train'}}]}), // 번역기가 넓어진 상황을 가정
      provider:{async complete(){return{text:'서사'};}}} as never);
    await session.send('x');
    expect(session.lastLogs).toEqual(expect.arrayContaining([expect.objectContaining({ok:false,reason:'card_tag_not_allowed'})]));
    expect((value.state.player as Record<string,unknown>).exp).toBe(0); // 상태 불변
  });
});
