import {describe,expect,it}from'vitest';
import{ProjectRuntime,type RuntimeProject}from'@simbot/runtime';
import{translateYspTags}from'@simbot/risu';

// 럭키 시뮬레이터 북극성 하버스(ADR 0002): 실제 리스 카드처럼 LLM이 [ysp_*] 태그를 본문에 뱉으면
// 번역기가 엔진 이벤트로 옮기고 엔진이 상태를 소유한다. 300턴을 돌려도 엔진 상태가 독립 장부와
// 어긋나지 않고(디싱크 0), 되돌리면 상태도 함께 복원됨을 증명한다. 카드가 손코딩하던
// reindexYspState·bk_turn_key를 엔진이 네이티브로 대체한다는 것의 기계적 증거.

const innProject=():RuntimeProject=>({
  projectId:'yongsa',
  schema:{
    staffing:{facility:'quarter',capacityByLevel:{'1':1,'2':3}},
    scales:[{id:'affinity',owner:'npc',range:[0,200],default:20,steps:{S:1,M:3,L:6,XL:10,'S-':-1,'M-':-3,'L-':-6,'XL-':-10}}],
    entities:[
      {type:'facility',instances:[{id:'quarter',maxLevel:2},{id:'tavern',maxLevel:2},{id:'room',maxLevel:2},{id:'kitchen',maxLevel:2}]},
      {type:'npc',instances:[{id:'silvia'}]},
      {type:'room',instances:[{no:'101',capacity:1,requiresRoomLevel:1,pricePerNight:0}]},
    ],
    initialState:{day:1,gold:1_000_000,resources:{food:200,drink:200},items:{},facilities:{quarter:1,tavern:1,room:1,kitchen:1},staff:[],rooms:{},npcs:{silvia:{affinity:20}},player:{pools:{hp:{cur:10,max:10}}},combat:null},
  },
  screens:[],navigation:[],content:{},featureToggles:{},moduleIds:['genre.inn'],
});

// 결정론 태그 스크립트 — 턴 t의 'LLM 본문'. RNG·시각 없음(index 기반).
function turnText(t:number):string{
  const sale=30000+(t%7)*1000, cost=5000+(t%3)*500;
  let s=`${t}일차 영업을 정리했다. [ysp_gold::+${sale}::매출][ysp_gold::-${cost}::재료비] `;
  s+=`주방이 바빴다 [ysp_food::+2][ysp_food::-1][ysp_drink::+1][ysp_drink::-1] `;
  if(t%5===0)s+=`실비아와 눈이 마주쳤다 [ysp_affinity::silvia::+1] `;
  return s;
}
// 엔진과 독립인 '기대 장부' — 같은 태그를 순수 산술로 누적(엔진 clamp와 동일 규칙).
function expectedLedger(turns:number){let gold=1_000_000,food=200,drink=200;for(let t=1;t<=turns;t++){const sale=30000+(t%7)*1000,cost=5000+(t%3)*500;gold=Math.max(0,gold+sale);gold=Math.max(0,gold-cost);food=Math.max(0,food+2);food=Math.max(0,food-1);drink=Math.max(0,drink+1);drink=Math.max(0,drink-1);}return{gold,food,drink};}

function applyTurn(runtime:ProjectRuntime,text:string){const{events}=translateYspTags(text);for(const e of events)runtime.dispatch(e.id,e.params as Record<string,unknown>);}

describe('disync harness — 300턴 태그 플레이 불변성',()=>{
  it('엔진 상태가 독립 장부와 매 턴 일치한다(디싱크 0)',()=>{
    const runtime=new ProjectRuntime(innProject(),7);
    for(let t=1;t<=300;t++){
      applyTurn(runtime,turnText(t));
      const led=expectedLedger(t),st=runtime.state as Record<string,unknown>,res=st.resources as Record<string,number>;
      expect(st.gold).toBe(led.gold);
      expect(res.food).toBe(led.food);
      expect(res.drink).toBe(led.drink);
    }
    // 서사가 상태를 조작하지 못한다: LLM이 "골드 100만 벌었다"고 써도 태그가 없으면 엔진 불변.
    const before=(runtime.state as Record<string,unknown>).gold;
    applyTurn(runtime,'나는 갑자기 골드를 백만이나 벌었다! 최고다.');
    expect((runtime.state as Record<string,unknown>).gold).toBe(before);
  });

  it('재현성 — 같은 시드·같은 스크립트면 300턴 최종 상태가 동일',()=>{
    const a=new ProjectRuntime(innProject(),7),b=new ProjectRuntime(innProject(),7);
    for(let t=1;t<=300;t++){applyTurn(a,turnText(t));applyTurn(b,turnText(t));}
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('되돌리면 상태도 함께 되돌아간다 — 롤백이 글이 아니라 상태를 복원',()=>{
    const runtime=new ProjectRuntime(innProject(),7);
    for(let t=1;t<=150;t++)applyTurn(runtime,turnText(t));
    const checkpoint=runtime.snapshot(); // 150턴 시점 전체 상태
    for(let t=151;t<=300;t++)applyTurn(runtime,turnText(t));
    const at300=runtime.snapshot();
    runtime.restore(checkpoint); // 되돌리기
    expect(runtime.snapshot()).toEqual(checkpoint); // 150턴 상태로 완전 복원
    for(let t=151;t<=300;t++)applyTurn(runtime,turnText(t)); // 같은 미래 재생
    expect(runtime.snapshot()).toEqual(at300); // 결정론적으로 동일 재현
  });

  it('affinity 근사 변환도 결정론적으로 누적된다',()=>{
    const runtime=new ProjectRuntime(innProject(),7);
    for(let t=1;t<=60;t++)applyTurn(runtime,turnText(t)); // t%5===0에서 +1(S) 12회
    const npcs=(runtime.state as Record<string,unknown>).npcs as Record<string,{affinity?:number}>;
    expect(npcs.silvia?.affinity).toBe(20+12); // 20 시작 + S스텝(1)*12
  });
});
