import {describe,expect,it}from'vitest';
import{translateYspTags,tagCompatibilityGrades}from'../src/index.ts';

describe('ysp tag translation (럭키: 용사여관 태그 → 엔진 이벤트)',()=>{
  it('깔끔히 대응하는 태그는 exact로 직역된다',()=>{
    const t=translateYspTags('영업 마감. [ysp_gold::+35000::점심 매출] 손님이 붐볐다 [ysp_food::-5][ysp_drink::-3]');
    expect(t.events).toEqual([
      {id:'gold_delta',params:{amount:35000,reason:'점심 매출'},grade:'exact',tag:'[ysp_gold::+35000::점심 매출]'},
      {id:'resource_delta',params:{resource:'food',amount:-5},grade:'exact',tag:'[ysp_food::-5]'},
      {id:'resource_delta',params:{resource:'drink',amount:-3},grade:'exact',tag:'[ysp_drink::-3]'},
    ]);
    expect(t.residue).toBe('영업 마감.  손님이 붐볐다'); // 태그 제거된 서사만 남음
  });

  it('checkin/checkout/nextday/hire/fire를 직역한다',()=>{
    const t=translateYspTags('[ysp_checkin::101::silvia::2][ysp_hire::mirian::10000][ysp_nextday][ysp_fire::kang][ysp_checkout::101::silvia]');
    expect(t.events.map((e)=>e.id)).toEqual(['checkin','hire','day_end','fire','checkout']);
    expect(t.events[0]!.params).toEqual({roomNo:'101',guestName:'silvia',stayDays:2});
    expect(t.events[1]!.params).toEqual({npcId:'mirian',dailyWage:10000});
    expect(t.events[4]!.params).toEqual({roomNo:'101',guestName:'silvia'});
  });

  it('호감도는 raw 델타를 stepped size로 근사 변환(approx)한다',()=>{
    const t=translateYspTags('[ysp_affinity::silvia::+2][ysp_affinity::kang::-8]');
    expect(t.events[0]).toMatchObject({id:'scale_delta',grade:'approx',params:{scale:'affinity',target:'silvia',size:'S',direction:'+'}});
    expect(t.events[1]).toMatchObject({params:{scale:'affinity',target:'kang',size:'L',direction:'-'}});
  });

  it('현재 스키마에 대응 없는 태그는 실행하지 않고 보존(unsupported)한다',()=>{
    const t=translateYspTags('[ysp_capture::a::b::c::D::0::0::0::0::0][ysp_rep_마을::+5][YSP_GATE_MAP::던전::A::x][ysp_exp::+40]');
    expect(t.events).toHaveLength(0); // 임의 실행 금지
    const kinds=t.unsupported.map((u)=>u.kind);
    expect(kinds).toContain('포로');expect(kinds).toContain('평판');expect(kinds).toContain('던전/게이트');expect(kinds).toContain('경험치');
  });

  it('결정론 — 같은 본문이면 같은 번역',()=>{
    const text='[ysp_gold::+100][ysp_affinity::silvia::+3][ysp_capture::x::y::z::E::0::0::0::0::0]';
    expect(translateYspTags(text)).toEqual(translateYspTags(text));
  });

  it('호환성 여권 등급 요약을 낸다',()=>{
    const g=tagCompatibilityGrades('[ysp_gold::+1][ysp_affinity::a::+1][ysp_rep_마을::+1][ysp_gate_move::1]');
    expect(g.exact).toContain('gold_delta');
    expect(g.approx).toContain('scale_delta');
    expect(g.preserved).toEqual(expect.arrayContaining(['평판','던전/게이트']));
  });
});
