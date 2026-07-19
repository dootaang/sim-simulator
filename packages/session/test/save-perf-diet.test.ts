import{describe,expect,it}from'vitest';import{createMemoryRepository}from'@simbot/persistence';import{type PromptPreset}from'@simbot/risu';import{ProjectRuntime}from'@simbot/runtime';import{PlaySession,type SessionSnapshot}from'../src/index.ts';

const source={source:'user' as const,path:'perf-diet'};
function preset(id:string,version=1):PromptPreset{return{contract:'prompt-preset/0.1',id,name:id,compatibilityMode:'risu',version,raw:{bulk:'x'.repeat(20_000)},settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source}]};}
function runtime(){return new ProjectRuntime({projectId:'perf-diet',schema:{progression:{sources:{train:[2,2]},thresholds:[1_000_000]},initialState:{player:{level:1,exp:0}}},screens:[{id:'play',regions:{actions:[{widget:'action-group',actions:[{event:{id:'progression/gain',params:{source:'train'}}}]}]}}],navigation:[],content:{},featureToggles:{},moduleIds:[]});}
const provider={async complete(){return{text:'ok'};}};

describe('성능 수술 파동 1 — 다이어트 후에도 규율은 그대로다',()=>{
  it('발산 감시: 외부에서 엔진 상태를 직접 변조하면 다음 원장 행동이 거부된다',async()=>{
    const session=new PlaySession({id:'diverge',runtime:runtime(),preset:preset('a'),card:{name:'G'},provider});
    await session.runLedgerAction('progression/gain',{source:'train'});
    (session.runtime.state.player as Record<string,unknown>).exp=999_999; // 저널을 우회한 변조
    await expect(session.runLedgerAction('progression/gain',{source:'train'})).rejects.toThrow('journal_runtime_diverged');
  });
  it('프리셋 참조화: 체크포인트가 raw를 들고 다니지 않아도 undo가 교체 전 프리셋을 정확히 복원한다',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=new PlaySession({id:'preset-ref',runtime:runtime(),preset:preset('alpha'),card:{name:'G'},repository,provider});
    await session.runLedgerAction('progression/gain',{source:'train'});
    session.setPreset(preset('beta'));
    await session.runLedgerAction('progression/gain',{source:'train'});
    const saved=await PlaySession.assembleSnapshot((await repository.get('preset-ref'))!.payload,repository);
    // 저장 payload의 체크포인트에는 프리셋 본문이 없다(참조만) — 다이어트의 목적 그 자체.
    expect((saved.history?.undo??[]).every(checkpoint=>!checkpoint.bindings.preset&&checkpoint.bindings.presetRef)).toBe(true);
    expect(saved.history?.undo.length??0).toBeGreaterThan(0);
    const restored=new PlaySession({id:'preset-ref',runtime:runtime(),preset:preset('beta'),card:{name:'G'},provider});
    restored.restore(saved);
    await restored.undoTurn(); // 마지막 턴 이전 = beta 시점
    expect(restored.snapshot().bindings?.preset.id).toBe('beta');
    await restored.undoTurn(); // 그 이전 = alpha 시점
    expect(restored.snapshot().bindings?.preset.id).toBe('alpha');
    expect(restored.snapshot().bindings?.preset.raw).toBeTruthy(); // 참조 해소가 본문까지 복원
  });
  it('디스크 undo 5·RAM 30: 저장은 얕고 세션은 깊다',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=new PlaySession({id:'depth',runtime:runtime(),preset:preset('a'),card:{name:'G'},repository,provider});
    for(let i=0;i<12;i+=1)await session.runLedgerAction('progression/gain',{source:'train'});
    expect(session.checkpointDepth).toBe(12); // RAM은 깊게(상한 30)
    const saved=await PlaySession.assembleSnapshot((await repository.get('depth'))!.payload,repository);
    expect(saved.history?.undo).toHaveLength(5); // 디스크는 최근 5개만(오너 결정 1)
    const restored=new PlaySession({id:'depth',runtime:runtime(),preset:preset('a'),card:{name:'G'},provider});
    restored.restore(saved);
    expect(restored.checkpointDepth).toBe(5);
    await restored.undoTurn();
    expect(restored.turn).toBe(11); // 재로드 후에도 5단 undo는 살아 있다
  });
});
