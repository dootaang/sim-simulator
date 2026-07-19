import{expect,test}from'@playwright/test';
test.use({viewport:{width:390,height:844}});
const card=Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'iPad 호환 카드',description:'',first_mes:'iPad 파일 선택 확인',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));

test('Mac으로 표시되는 iPad에서도 커스텀 카드·모듈·프리셋 파일을 선택할 수 있다',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5});
  });
  await page.goto('/');

  const mainPickers=page.locator('input.hidden[type="file"][multiple]');
  await expect(mainPickers).toHaveCount(2);
  await expect(mainPickers.nth(0)).not.toHaveAttribute('accept'); // 카드 + 함께 선택한 모듈
  await expect(mainPickers.nth(1)).not.toHaveAttribute('accept'); // 별도 에셋 모듈

  // accept 해제는 검증 해제가 아니다. 잘못 고른 파일은 기존 카드 관문이 안전하게 거절한다.
  await mainPickers.nth(0).setInputFiles({name:'not-a-card.txt',mimeType:'text/plain',buffer:Buffer.from('no')});
  await expect(page.getByText('가져올 봇카드를 찾지 못했습니다. 카드와 에셋 모듈을 함께 선택해 주세요.')).toBeVisible();

  await mainPickers.nth(0).setInputFiles({name:'ipad.json',mimeType:'application/json',buffer:card});
  await expect(page.getByText('iPad 파일 선택 확인')).toBeVisible();
  await page.getByRole('button',{name:'현재 봇 메뉴'}).click();
  await page.getByRole('button',{name:'전체 설정'}).click();
  const settings=page.getByRole('dialog',{name:'전체 설정'}),menu=settings.getByLabel('설정 메뉴');
  await menu.selectOption('prompt');
  await expect(settings.getByText('Risu 프리셋 가져오기').locator('input[type="file"]')).not.toHaveAttribute('accept');

  // 표준 JSON 백업 입력은 iPad에서도 필터를 유지해 문서 선택기의 편의를 잃지 않는다.
  await expect(page.locator('aside.side input[type="file"]')).toHaveAttribute('accept','application/json,.json');
});
