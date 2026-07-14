import{resolve}from'node:path';
import{expect,test}from'@playwright/test';

// 저장소 경로를 하드코딩하지 않는다 — 다른 폴더·다른 OS에서도 이 검증이 그대로 돌아야 한다.
const repo=resolve(process.cwd(),'../..').split('\\').join('/');

// 진단 콘솔의 존재 이유: "이미지가 안 떠요"에서 멈추지 않고, 무엇을 시도했고 왜 실패했는지를
// 사용자가 그대로 복사해 넘길 수 있어야 한다. 그러려면 세 가지가 참이어야 한다.
//   ① 정상 지연 로딩을 실패로 적지 않는다 — 거짓 실패를 복사해 보내는 진단은 없느니만 못하다.
//   ② 렌더가 진단을 남기면서 상태를 바꾸지 않는다(M-S0).
//   ③ 키는 화면에도 복사본에도 없다.
test('에셋 진단은 "못 찾음"과 "불러오는 중"을 구분하고, 로딩이 끝나면 기록을 철회한다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async(repo)=>{
    const[{mount},{default:MessageList},{PlaySession},{ProjectRuntime},{diagnostics}]=await Promise.all([import('/@id/svelte'),import('/src/player/MessageList.svelte'),import(`/@fs/${repo}/packages/session/src/index.ts`),import(`/@fs/${repo}/packages/runtime/src/index.ts`),import('/src/player/diagnostics.svelte.ts')]);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV+ZVAAAAABJRU5ErkJggg==',bytes=Uint8Array.from(atob(png.split(',')[1]!),value=>value.charCodeAt(0));
    // silvia_default_2: 이름은 있지만 바이트가 없다 — 별도 에셋 모듈의 지연 로딩 상태 그대로.
    // kalena_smile: 카드 어디에도 없다 — 진짜 실패.
    const assets=[{name:'silvia_default_2',type:'emotion',ext:'png',uri:'',mime:'image/png',found:true,size:0},{name:'silvia_default_0',type:'emotion',ext:'png',uri:'',mime:'image/png',found:true,size:bytes.length,bytes}];
    const preset={contract:'prompt-preset/0.1',id:'p',name:'p',compatibilityMode:'simpack',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source:{source:'user',path:'test'}}]};
    const runtime=new ProjectRuntime({projectId:'diag',schema:{entities:[{type:'npc',instances:[{id:'silvia',name:'Silvia'}]}],initialState:{npcs:{silvia:{outfit:2}}}},screens:[],navigation:[],content:{},featureToggles:{},moduleIds:[]});
    const session=new PlaySession({id:'diag-session',runtime,preset,card:{name:'테스트 카드'},provider:{async complete(){return{text:'<img src="silvia_default_2"> <img src="kalena_smile"> 본문',speakers:[]};}}});
    await session.send('인사');
    diagnostics.clear();
    diagnostics.setSecrets(['sk-live-abcdef0123456789']);
    const host=document.createElement('main');document.body.replaceChildren(host);
    const props={session,version:1,scrollRequest:0,greetings:[],waiting:false,cardName:'테스트 카드',userName:'나',userPortrait:null,botPortrait:null,model:'test',assets,assetWidth:32,portraitFor:()=>null,onchange:()=>{},onassetneeded:()=>{},oncontinue:()=>{},onerror:()=>{}};
    mount(MessageList,{target:host,props});
    await new Promise(resolve=>setTimeout(resolve,60));
    const codes=()=>diagnostics.events.map(event=>event.code).sort();
    const afterRender=codes();
    // 같은 메시지를 다시 그린다 — 진단이 쌓이면 로그가 아니라 소음이다.
    const before=JSON.stringify(session.cbsVariables);
    mount(MessageList,{target:document.createElement('main'),props});
    await new Promise(resolve=>setTimeout(resolve,60));
    const afterRerender=codes();
    // 지연 로딩이 끝났다 — "불러오는 중" 기록은 사라져야 한다(PlayerPage의 ensureModuleAsset이 이 키로 철회한다).
    diagnostics.resolve(`asset:${session.id}:silvia_default_2`);
    // 키가 실제로 사건 안에 들어간다. 마스킹이 없으면 아래 검사는 통과할 수 없다.
    diagnostics.record({kind:'provider',code:'request_failed',summary:'요청 실패: Bearer sk-live-abcdef0123456789',detail:{'요청 헤더':'authorization: Bearer sk-live-abcdef0123456789'},card:'테스트 카드',chat:session.id,message:0});
    const leaked=diagnostics.events.find(event=>event.code==='request_failed')!;
    return{afterRender,afterRerender,afterResolve:codes(),variablesUnchanged:before===JSON.stringify(session.cbsVariables),
      stripped:(host.querySelector('.message:last-of-type .text')?.innerHTML??'').includes('img'),
      missing:diagnostics.events.find(event=>event.code==='asset_missing')?.detail??{},
      screenSummary:leaked.summary,screenDetail:leaked.detail['요청 헤더']??'',copy:diagnostics.copyText(session.id)};
  },repo);
  expect(result.stripped).toBe(false); // 깨진 이미지는 지우고, 대신 진단에 남긴다
  expect(result.afterRender).toEqual(['asset_loading','asset_missing']); // 지연 로딩과 진짜 실패를 가른다
  expect(result.afterRerender).toEqual(['asset_loading','asset_missing']); // 재렌더로 중복되지 않는다
  expect(result.afterResolve).toEqual(['asset_missing','request_failed']); // asset_loading만 철회되고 진짜 실패는 남는다
  expect(result.variablesUnchanged).toBe(true); // 진단이 M-S0을 다시 뚫지 않는다
  expect(result.missing['시도한 이름']).toContain('kalena_smile');
  expect(result.missing['있는 변형']).toContain('카드에 없음');
  // 키는 화면(수집 시점 마스킹)에도 복사본에도 없다 — 복사할 때만 지우면 화면에는 그대로 남는다.
  expect(result.screenSummary).not.toContain('sk-live-abcdef0123456789');
  expect(result.screenDetail).not.toContain('sk-live-abcdef0123456789');
  expect(result.screenDetail).toContain('redacted');
  expect(result.copy).not.toContain('sk-live-abcdef0123456789');
});
