import { describe,expect,it } from 'vitest';
import { createRng,type RuntimeRecord } from '@simbot/kernel';
import { createInnRegistry } from '../src/index.ts';

// 마이그레이션 감사 회귀 — 정상 경로만 보는 스모크가 아니라 공격/우회가 실제로 막히는지 검증한다.
const schema:RuntimeRecord={entities:[{type:'room',instances:[{no:'101',capacity:1,requiresRoomLevel:1,pricePerNight:30000}]}],resources:[{id:'food',basePrice:100}]};
const initial=():RuntimeRecord=>({gold:1_000_000,day:1,facilities:{room:1,kitchen:1,tavern:1},staff:[],rooms:{},resources:{food:2},items:{},npcs:{silvia:{}},player:{pools:{hp:{cur:10,max:10}}},questAttempts:{},claimedRewards:[],combat:null});

describe('security guards (migration parity)',()=>{
  it('checkin은 상속 멤버 방 키(toString/hasOwnProperty)로 rooms를 오염시키지 못한다',()=>{
    const registry=createInnRegistry(),rng=createRng(1);
    for(const key of ['toString','hasOwnProperty','__proto__','constructor']){
      const result=registry.dispatch(schema,initial(),{id:'checkin',params:{roomNo:key,guestName:'A',stayDays:1}},rng);
      expect(result.log[0]?.ok).toBe(false);
    }
    // Object.prototype·rooms 내장 메서드가 오염되지 않았다.
    expect(({}as Record<string,unknown>).toString).toBe(Object.prototype.toString);
  });

  it('checkout도 위험 방 키에서 안전하게 실패한다',()=>{
    const registry=createInnRegistry(),rng=createRng(1);
    const result=registry.dispatch(schema,initial(),{id:'checkout',params:{roomNo:'toString',guestName:'A'}},rng);
    expect(result.log[0]?.ok).toBe(false);
  });

  it('전투 중에는 sale·purchase·purchase_batch가 in_combat으로 거부된다',()=>{
    const registry=createInnRegistry(),rng=createRng(1);
    const state:RuntimeRecord={...initial(),combat:{active:true}};
    for(const [id,params] of [['purchase',{resource:'food',qty:1}],['purchase_batch',{items:[{resource:'food',qty:1}]}]] as Array<[string,RuntimeRecord]>){
      const result=registry.dispatch(schema,state,{id,params},rng);
      expect(result.log[0]).toMatchObject({ok:false,reason:'in_combat'});
    }
  });
});
