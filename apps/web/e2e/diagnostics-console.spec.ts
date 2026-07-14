import{expect,test}from'@playwright/test';

// 상시 콘솔의 계약. 문제가 0건이어도 열려야 하고, 타이핑을 훔치면 안 되고, 꺼진 레벨은 만들지도 않는다.
test('콘솔은 사건이 없어도 열리고, 백틱은 입력 중일 때 타이핑을 훔치지 않는다',async({page})=>{
  await page.goto('/');
  const card=Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'콘솔 카드',description:'진단 콘솔 테스트',first_mes:'안녕하세요',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'console-card.json',mimeType:'application/json',buffer:card});
  const console_=page.getByRole('complementary',{name:'진단 콘솔'});
  await expect(console_).toBeHidden();
  // 사건이 0건이어도 백틱으로 열린다 — 문제가 있을 때만 보는 창이 아니다.
  await page.locator('.list').click({position:{x:5,y:5}}); // 입력창 밖으로 포커스를 뺀다
  await page.keyboard.press('`');
  await expect(console_).toBeVisible();
  await expect(console_).toContainText('기록된 사건이 없습니다');
  await page.keyboard.press('Escape');
  await expect(console_).toBeHidden();
  // 입력창에 포커스가 있으면 백틱은 그냥 글자다. 콘솔이 타이핑을 훔치면 채팅이 망가진다.
  const input=page.locator('form textarea, form input[type="text"]').first();
  await input.click();
  await input.type('a`b');
  await expect(console_).toBeHidden();
  await expect(input).toHaveValue('a`b');
});

test('추적 레벨이 꺼져 있으면 추적 사건은 만들어지지도 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const{diagnostics}=await import('/src/player/diagnostics.svelte.ts');
    diagnostics.clear();
    const before=diagnostics.enabled('trace'); // 기본은 꺼짐
    const skipped=diagnostics.record({level:'trace',kind:'cbs',code:'trace_event',summary:'추적',detail:{},card:'c',chat:'x',message:null});
    const off=diagnostics.count;
    diagnostics.levels.trace=true;
    diagnostics.record({level:'trace',kind:'cbs',code:'trace_event',summary:'추적',detail:{},card:'c',chat:'x',message:null});
    const on=diagnostics.count;
    diagnostics.levels.trace=false;diagnostics.clear();
    return{before,skipped,off,on};
  });
  expect(result.before).toBe(false); // 추적은 기본 꺼짐
  expect(result.skipped).toBe('');   // 꺼진 레벨은 키조차 돌려주지 않는다
  expect(result.off).toBe(0);        // 만들지도 않는다 — 필터로 숨기는 게 아니다
  expect(result.on).toBe(1);
});
