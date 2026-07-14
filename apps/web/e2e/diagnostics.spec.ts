import{expect,test}from'@playwright/test';

// 진단 콘솔의 존재 이유: "이미지가 안 떠요"에서 멈추지 않고, 무엇을 시도했고 왜 실패했는지를
// 사용자가 그대로 복사해 넘길 수 있어야 한다. 그리고 렌더가 진단을 남기면서 상태를 바꾸면 안 된다(M-S0).
test('에셋 해석 실패가 시도한 이름까지 담아 진단에 남고, 재렌더로 중복되지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const[{mount},{default:MessageList},{PlaySession},{ProjectRuntime},{diagnostics}]=await Promise.all([import('/@id/svelte'),import('/src/player/MessageList.svelte'),import('/@fs/C:/freetalk/simbot-simulator/packages/session/src/index.ts'),import('/@fs/C:/freetalk/simbot-simulator/packages/runtime/src/index.ts'),import('/src/player/diagnostics.svelte.ts')]);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV+ZVAAAAABJRU5ErkJggg==',bytes=Uint8Array.from(atob(png.split(',')[1]!),value=>value.charCodeAt(0));
    // 카드에는 silvia_default_0/_1만 있다. 엔진 의상은 2 — 있는 변형과 요구된 변형이 어긋난 실제 상황.
    const assets=[{name:'silvia_default_0',type:'emotion',ext:'png',uri:'',mime:'image/png',found:true,size:bytes.length,bytes},{name:'silvia_default_1',type:'emotion',ext:'png',uri:'',mime:'image/png',found:true,size:bytes.length,bytes}];
    const preset={contract:'prompt-preset/0.1',id:'p',name:'p',compatibilityMode:'simpack',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source:{source:'user',path:'test'}}]};
    const runtime=new ProjectRuntime({projectId:'diag',schema:{entities:[{type:'npc',instances:[{id:'silvia',name:'Silvia'}]}],initialState:{npcs:{silvia:{outfit:2}}}},screens:[],navigation:[],content:{},featureToggles:{},moduleIds:[]});
    const session=new PlaySession({id:'diag-session',runtime,preset,card:{name:'테스트 카드'},provider:{async complete(){return{text:'<img src="kalena_smile"> 없는 에셋',speakers:[]};}}});
    await session.send('인사');
    diagnostics.clear();
    const host=document.createElement('main');document.body.replaceChildren(host);
    const props={session,version:1,scrollRequest:0,greetings:[],waiting:false,cardName:'테스트 카드',userName:'나',userPortrait:null,botPortrait:null,model:'test',assets,assetWidth:32,portraitFor:()=>null,onchange:()=>{},onassetneeded:()=>{},oncontinue:()=>{},onerror:()=>{}};
    const component=mount(MessageList,{target:host,props});
    await new Promise(resolve=>setTimeout(resolve,60));
    const afterFirst=diagnostics.count;
    // 같은 메시지를 다시 그린다 — 진단이 쌓이면 로그가 아니라 소음이고, 세션 변수가 변하면 M-S0 위반이다.
    const before=JSON.stringify(session.cbsVariables);
    mount(MessageList,{target:document.createElement('main'),props});
    await new Promise(resolve=>setTimeout(resolve,60));
    const event=diagnostics.events.find(value=>value.kind==='asset');
    return{stripped:(host.querySelector('.message:last-of-type .text')?.innerHTML??'').includes('kalena'),afterFirst,afterSecond:diagnostics.count,detail:event?.detail??{},summary:event?.summary??'',copy:diagnostics.copyText(['sk-secret-key']),variablesUnchanged:before===JSON.stringify(session.cbsVariables),mounted:!!component};
  });
  expect(result.stripped).toBe(false); // 깨진 이미지 대신 조용히 지우고, 대신 진단에 남긴다
  expect(result.afterFirst).toBe(1);
  expect(result.afterSecond).toBe(1); // 재렌더로 중복되지 않는다
  expect(result.variablesUnchanged).toBe(true); // 진단 기록이 M-S0을 다시 뚫지 않는다
  expect(result.summary).toContain('kalena_smile');
  expect(result.detail['시도한 이름']).toContain('kalena_smile');
  expect(result.detail['결과']).toBe('asset_missing');
  expect(result.copy).toContain('에셋 해석 실패');
  expect(result.copy).not.toContain('sk-secret-key'); // 키는 복사본에 절대 들어가지 않는다
});
