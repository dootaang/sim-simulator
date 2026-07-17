import{describe,expect,it}from'vitest';
import type{ParsedCard}from'@simbot/card';
import{compileKnownCard}from'../src/known-cards.ts';

const DV='A_day=1\nA_gold=5000\nA_res=3000\nD1a=["1500","1600","1250","-5","90","성격 설명"]\nD1d=["7000","계약 설명"]';
function gfl():ParsedCard{const classes=Array.from({length:20},(_,i)=>`["D${i+1}"]="AR"`).join(','),grades=Array.from({length:20},(_,i)=>`["D${i+1}"]=3`).join(','),lua=`local DOLL_CLASS={${classes}}\nlocal DOLL_GRADE={${grades}}\nlocal MOD_POWER={[1]=111,[2]=222,[3]=333}\nlocal base_defaults={base1={gold="4000",res="2000"},base2={gold="4000",res="2000"},base3={gold="4000",res="2000"},base4={gold="5000",res="3000"},base5={gold="3000",res="1000"}}\nlocal ITEM_DATA={["RAM"]={price=100,type="use",desc="회복"}}\nlocal EQUIP_DATA={["SCOPE"]={price=200,power=10}}\nlocal MISSION_DATA={["ALPHA"]={name="ALPHA",power="800",reward="자금 +500 / 부품 +100",enemy="철혈"},["BETA"]={name="BETA",power="900"},["GAMMA"]={name="GAMMA",power="1000"}}\n${'-- filler\n'.repeat(1200)}`;return{format:'png',source:'gfl.png',spec:'chara_card_v3',specVersion:'3',name:'소녀전선:잔불',card:{spec:'chara_card_v3',data:{name:'소녀전선:잔불',description:'전술인형과 제대',character_book:{entries:[]},extensions:{risuai:{defaultVariables:DV,triggerscript:[{effect:[{type:'triggerlua',code:lua}]}]}}}},assets:[],containerEntries:[],sourceBytes:new Uint8Array([1]),modules:[{name:'runtime',origin:'card-extension',regex:[],lorebook:[],defaultVariables:DV,raw:{triggerscript:[{effect:[{type:'triggerlua',code:lua}]}]}}]};}
describe('known card compiler',()=>{
  it('converts the certified GFL structure without an LLM call',()=>{const result=compileKnownCard(gfl());expect(result?.moduleIds).toEqual(['genre.gfl']);expect(result?.screens).toEqual([{id:'gfl-command',title:'그리폰 지휘부',layout:'gfl-command',regions:{main:[{widget:'gfl-console'}]}}]);expect(((result?.schema.gfl as any).dolls)).toHaveLength(20);expect((result?.schema.initialState as any).gold).toBe(5000);expect(result?.attempts).toEqual([]);});
  it('does not claim unrelated cards',()=>{const value=gfl();value.card={data:{name:'일반 대화'}};value.modules=[];expect(compileKnownCard(value)).toBeNull();});
  it('수치를 발명하지 않는다 — 카드 defaultVariables의 실능력치를 회수하고 없는 인형만 원본 폴백을 쓴다',()=>{
    const result=compileKnownCard(gfl()),dolls=(result?.schema.gfl as any).dolls;
    expect(dolls[0]).toMatchObject({name:'D1',maxHp:1500,maxMp:1600,power:1250,mood:90,price:7000,description:'계약 설명'}); // 카드 실값
    expect(dolls[1]).toMatchObject({name:'D2',maxHp:1000,maxMp:1000,power:500,mood:50}); // 원본 Lua 폴백(발명 공식 아님)
    expect((result?.schema.gfl as any).modPower).toEqual([111,222,333]);                  // MOD_POWER 테이블 회수
    expect((result?.schema.gfl as any).commanderFunds).toBe(10_000);                      // 지휘관 시작 자금(원본 Lua)
    expect((result?.schema.gfl as any).hire).toMatchObject({dailySlots:5,snipePremium:3000,capacity:[3,6,9,12,15]});
    expect((result?.schema.gfl as any).facilities[0]).toMatchObject({name:'훈련 시설',cost:{gold:4000,res:2000},costMultiplier:1.5});
  });
  it('회수와 합성을 구분해 정직하게 표시한다(헌법 2)',()=>{
    const result=compileKnownCard(gfl());
    expect(result?.warnings.join(' ')).toContain('1/20');                                  // 회수 요약
    const templateIssues=result?.issues.filter(issue=>issue.source==='template')??[];
    expect(templateIssues.map(issue=>issue.path)).toEqual(expect.arrayContaining(['gfl.dolls','combat','gfl.manufacturing']));
    expect(templateIssues.find(issue=>issue.path==='gfl.dolls')?.message).toContain('19/20');
  });
});
