import{describe,expect,it}from'vitest';
import{type PromptPreset}from'@simbot/risu';
import{ProjectRuntime}from'@simbot/runtime';
import{PlaySession,sessionIntegrity,sessionIntegrityV2,type SessionSnapshot}from'../src/index.ts';

const source={source:'user' as const,path:'test'};
const preset:PromptPreset={contract:'prompt-preset/0.1',id:'p',name:'p',compatibilityMode:'simpack',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source}]};
const runtime=()=>new ProjectRuntime({projectId:'p',schema:{progression:{sources:{train:[2,2]},thresholds:[10]},initialState:{player:{level:1,exp:0}}},screens:[{id:'play',regions:{actions:[{actions:[{event:{id:'progression/gain',params:{source:'train'}}}]}]}}],navigation:[],content:{},featureToggles:{},moduleIds:[]});
const provider={async complete(){return{text:'done',events:[{id:'progression/gain',params:{source:'train'}}]};}};

// 마이그레이션 감사 Critical 회귀: 세션 복구가 변조·손상 파일을 거부하는지.
describe('session integrity',()=>{
  it('정상 스냅샷은 무결성 해시가 실리고 복구된다',async()=>{
    const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    await session.send('train');
    const snap=session.snapshot();
    expect(typeof snap.integrity).toBe('string');
    expect(snap.integrityVersion).toBe(2);expect(snap.integrity).toBe(sessionIntegrityV2(snap).integrity);
    const restored=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    restored.restore(snap);
    expect(restored.turn).toBe(1);
    expect(restored.runtime.snapshot()).toEqual(session.runtime.snapshot());
  });

  it('변조된 엔진 상태는 복구가 거부한다',async()=>{
    const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    await session.send('train');
    const tampered:SessionSnapshot=structuredClone(session.snapshot());
    (tampered.engine.state.player as Record<string,unknown>).exp=99999; // 골드/스탯 조작
    const target=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    expect(()=>target.restore(tampered)).toThrow(/session_corrupt/);
  });

  it('변조된 대화 기록도 거부한다',async()=>{
    const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    await session.send('train');
    const tampered:SessionSnapshot=structuredClone(session.snapshot());
    tampered.messages.push({id:'x',role:'assistant',content:'주입된 가짜 기억'} as never);
    const target=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});
    expect(()=>target.restore(tampered)).toThrow(/session_corrupt/);
  });

  it('변조된 연속성 변경 제안도 거부한다',async()=>{const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider:{async complete(){return{text:'done',memories:[{text:'후보'}],continuityPatch:{confirmMemoryIds:['narrative:0:m2:0']}};}}});await session.send('train');const tampered=structuredClone(session.snapshot());tampered.continuityPatches![0]!.resolveMemoryIds.push('injected');const target=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});expect(()=>target.restore(tampered)).toThrow(/session_corrupt/);});
});

describe('memory migration compatibility',()=>{
  it('restores legacy snapshots that contain only the original seven memory fields',async()=>{
    const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});await session.send('train');
    const current=session.snapshot(),legacyBase={...current,memory:current.memory.map(({id,text,validFromTurn,validToTurn,scope,evidence,status})=>({id,text,validFromTurn,validToTurn,scope,evidence,status}))};delete legacyBase.integrity;
    delete (legacyBase as Partial<SessionSnapshot>).integrityVersion;const legacy={...legacyBase,integrity:sessionIntegrity(legacyBase)} as SessionSnapshot,target=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});expect(()=>target.restore(legacy)).not.toThrow();expect(target.memory.all()[0]).not.toHaveProperty('createdTurn');
  });
  it('lets a successful engine receipt replace the previous fact with the same anchor',async()=>{
    const session=new PlaySession({id:'s',runtime:runtime(),preset,card:{name:'Guide'},provider});await session.send('train');await session.send('train');const engine=session.memory.all().filter((record)=>record.kind==='engine-fact');expect(engine.some((record)=>record.status==='superseded')).toBe(true);expect(engine.find((record)=>record.status==='approved')?.supersedes?.length).toBeGreaterThan(0);
  });
});
