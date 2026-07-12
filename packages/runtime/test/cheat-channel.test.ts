import {describe,expect,it}from'vitest';
import{ProjectRuntime,BUTTON_ONLY_EVENTS,runtimeFromManifest}from'../src/index.ts';

// 마이그레이션 감사 Critical 회귀: 화면에 버튼으로 선언된 버튼 전용 인텐트(traffic_wave 등)가
// LLM 허용목록(allowedModelEventIds)에 새어 들어가면 LLM이 이중 발동 치트를 칠 수 있다.
const innManifest=(screens:unknown[])=>({
  id:'inn-card',
  runtime:{schema:{traffic:{capacityFacility:'tavern',base:[[1,1]],capacity:[5],waves:[{id:'lunch',share:1}]},initialState:{gold:10,facilities:{tavern:1},staff:[],rooms:{},day:1,player:{pools:{hp:10}}}},screens,navigation:[]},
  content:{},modules:{installed:['genre.inn']},
});

describe('LLM cheat channel',()=>{
  it('버튼 전용 인텐트는 화면 액션에 있어도 LLM 허용목록에서 배제된다',()=>{
    const runtime=new ProjectRuntime(runtimeFromManifest(innManifest([
      {id:'management',regions:{actions:[{actions:[
        {label:'점심 영업',event:{id:'traffic_wave',params:{wave:'lunch'}}},
        {label:'우편 확인',event:{id:'mail_check'}},
      ]}]}},
    ])as never));
    const allowed=runtime.allowedModelEventIds();
    expect(allowed).not.toContain('traffic_wave');
    expect(allowed).not.toContain('mail_check');
    for(const id of BUTTON_ONLY_EVENTS)expect(allowed).not.toContain(id);
  });

  it('버튼 전용 목록은 옛 buttonOnlyEvents와 동일하다',()=>{
    expect([...BUTTON_ONLY_EVENTS].sort()).toEqual([
      'incident_choice','lodging_accept','lodging_reject','lodging_review','mail_check','mail_open','purchase_batch','set_outfit','set_scale_mult','traffic_wave',
    ]);
  });

  it('플레이어의 직접 dispatch는 버튼 전용 인텐트도 정상 실행된다(허용목록은 LLM 전용 제한)',()=>{
    const runtime=new ProjectRuntime(runtimeFromManifest(innManifest([])as never));
    expect(runtime.registry.hasEvent('traffic_wave')).toBe(true);
    const log=runtime.dispatch('traffic_wave',{wave:'lunch'}).log;
    expect(log[0]?.reason).not.toBe('model_event_not_allowed'); // 직접 경로는 안 막힌다
  });
});
