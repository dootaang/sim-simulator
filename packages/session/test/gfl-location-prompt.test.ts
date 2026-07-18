import{describe,expect,it}from'vitest';
import{defaultCardPreset,type CompiledPrompt}from'@simbot/risu';
import{ProjectRuntime}from'@simbot/runtime';
import{PlaySession}from'../src/index.ts';

describe('GFL location narrative grounding',()=>{it('sends the moved Korean location name to management narration and the next chat',async()=>{
  const runtime=new ProjectRuntime({projectId:'gfl-location',schema:{locations:[{id:'base-command',name:'지휘관실'},{id:'base-maintenance',name:'정비실'}],gfl:{dolls:[],items:[],equipment:[],missions:[],facilities:[],hire:{capacity:[4,8,12,16,20]}},initialState:{day:1,gold:0,resources:{},items:{},player:{},clock:{day:1,hour:8,phase:'오전'},location:'base-command',gfl:{started:true,baseLocation:'base-command',currentLocationName:'지휘관실',dolls:{},echelons:[],facilities:{base1:1,base2:1,base3:1,base4:1,base5:1},manufacturing:[],repairs:[],sortie:null}}},screens:[],navigation:[],content:{},featureToggles:{},moduleIds:['genre.gfl']});
  const prompts:CompiledPrompt[]=[];const session=new PlaySession({id:'gfl-location',runtime,preset:defaultCardPreset(),card:{name:'소녀전선'},provider:{async complete(request){prompts.push(request.prompt);return{text:'정비실에 도착했다.'};}}});
  await session.runManagementTurn('gfl/location/move',{locationId:'base-maintenance'});await session.send('주변을 살핀다');
  for(const prompt of prompts){const sent=prompt.messages.map(message=>message.content).join('\n');expect(sent).toContain('정비실');expect(sent).toContain('base-maintenance');}
  // 서사화 경로엔 카드 시스템 프롬프트가 없으므로 이미지 표식 형식을 엔진이 직접 가르쳐야 한다 —
  // 빠지면 모델이 [M16A1_smug] 같은 대괄호 표기를 지어낸다(2026-07-18 오너 실측 버그).
  const narration=prompts[0]!.messages.map(message=>message.content).join('\n');
  expect(narration).toContain('[|<img="캐릭터_표정">|"대사"|]');
  expect(narration).toContain('대괄호 안에 이름만 넣는 표기는 금지');
});});
