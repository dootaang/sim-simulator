import{describe,expect,it}from'vitest';import{defaultCardPreset}from'@simbot/risu';import{ProjectRuntime}from'@simbot/runtime';import{PlaySession,type SessionSnapshot}from'../src/index.ts';

// 파동 3 관문: integrity v2(섹션 합성)가 구형 전체 서명과 '탐지 등가'임을 섹션별 1필드 변조로 증명한다.
function runtime(){return new ProjectRuntime({projectId:'v2m',schema:{progression:{sources:{train:[2,2]},thresholds:[1_000_000]},initialState:{player:{level:1,exp:0}}},screens:[{id:'play',regions:{actions:[{widget:'action-group',actions:[{event:{id:'progression/gain',params:{source:'train'}}}]}]}}],navigation:[],content:{},featureToggles:{},moduleIds:[]});}
async function makeSnapshot(){
  const session=new PlaySession({id:'v2m',runtime:runtime(),preset:defaultCardPreset(),card:{name:'M'},provider:{async complete(){return{text:'ok',memories:[{text:'기억 한 줄'}]};}}});
  await session.send('turn');
  await session.runLedgerAction('progression/gain',{source:'train'});
  return session.snapshot();
}
function expectReject(mutate:(value:SessionSnapshot)=>void,base:SessionSnapshot){
  const forged=structuredClone(base);mutate(forged);
  const victim=new PlaySession({id:'v2m',runtime:runtime(),preset:defaultCardPreset(),card:{name:'M'},provider:{async complete(){return{text:'x'};}}});
  expect(()=>victim.restore(forged)).toThrow(/session_corrupt:integrity/);
}

describe('integrity v2 변조 매트릭스 — 어떤 섹션을 만져도 복원은 거부된다',()=>{
  it('8개 섹션 각각의 1필드 변조를 전부 잡는다',async()=>{
    const base=await makeSnapshot();
    expect(base.integrityVersion).toBe(2);
    expectReject(v=>{v.turn=999;},base); // meta
    expectReject(v=>{v.messages[0]!.content='조작된 메시지';},base); // messages
    expectReject(v=>{(v.engine.state as Record<string,unknown>).player={level:99,exp:0};},base); // engine
    expectReject(v=>{if(v.memory[0])v.memory[0]={...v.memory[0],text:'조작된 기억'};},base); // memory
    expectReject(v=>{if(v.journal)(v.journal.events[0] as {ok:boolean}).ok=false;},base); // journal 이벤트
    expectReject(v=>{if(v.history?.undo[0])v.history.undo[0].turn=77;},base); // history
    expectReject(v=>{if(v.bindings)v.bindings.preset={...v.bindings.preset,name:'조작'};},base); // bindings
    expectReject(v=>{v.cbsVariables={...(v.cbsVariables??{}),hacked:'1'};},base); // extras(cbsVariables)
    expectReject(v=>{v.lastLogs=[{ok:true,event:'invent_gold',amount:999}];},base); // extras(lastLogs — v1엔 없던 커버리지)
  });
  it('서명 자체를 지우거나 버전을 구형으로 바꿔치기해도 거부된다',async()=>{
    const base=await makeSnapshot();
    expectReject(v=>{delete (v as Partial<SessionSnapshot>).integrity;},base);
    // v2 payload를 v1인 척 다운그레이드 — v1 알고리즘 재계산과도 일치하지 않으므로 거부
    expectReject(v=>{delete (v as Partial<SessionSnapshot>).integrityVersion;},base);
  });
});
