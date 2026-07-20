import{expect,test}from'@playwright/test';

// UX-RENEWAL §6.2 — 지연형 프로바이더 설정: 키 없이 보내면 설정 화면이 뜨고, 초안은 절대 사라지지 않는다.
const card=Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'연결 봇',description:'',first_mes:'첫 인사',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));

test('키 없이 전송하면 프로바이더 설정이 열리고 닫아도 초안이 남는다',async({page})=>{
  await page.goto('/');
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'connect.json',mimeType:'application/json',buffer:card});
  await expect(page.getByText('첫 인사')).toBeVisible();
  const input=page.getByRole('textbox',{name:'메시지를 입력하세요'});
  await input.fill('키 없이 쓰던 문장');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  // 전송 대신 연결 시트: 무엇을 하면 되는지, 초안이 보관됐는지 알려준다.
  const settings=page.getByRole('dialog',{name:'전체 설정'});
  await expect(settings).toBeVisible();
  await expect(settings.getByText('쓰던 메시지가 그대로 이어서 전송됩니다.')).toBeVisible();
  // 연결하지 않고 닫아도 초안은 입력창으로 돌아온다.
  await settings.getByRole('button',{name:'닫기'}).click();
  await expect(settings).toBeHidden();
  await expect(input).toHaveValue('키 없이 쓰던 문장');
});

test('프로바이더 설정을 탭 이동으로 취소해도 같은 초안을 반복해서 복원하고 미저장 키를 버린다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'connect-repeat.json',mimeType:'application/json',buffer:card});
  const input=page.getByRole('textbox',{name:'메시지를 입력하세요'}),send=page.getByRole('button',{name:'보내기',exact:true});
  await input.fill('반복해서 지켜야 할 문장');
  await send.click();
  let settings=page.getByRole('dialog',{name:'전체 설정'});
  await expect(settings).not.toHaveAttribute('aria-modal','true');
  await settings.locator('label').filter({hasText:'API 키'}).locator('textarea').first().fill('저장하지-않은-키');
  await page.getByRole('button',{name:'봇 목록'}).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button',{name:'대화 목록'}).click();
  await page.getByRole('region',{name:'대화 목록'}).locator('.select-chat').first().click();
  await expect(input).toHaveValue('반복해서 지켜야 할 문장');

  // 취소한 키가 준비 완료로 오인되면 설정이 열리지 않고 이전 provider로 메시지를 보내 버린다.
  await send.click();
  settings=page.getByRole('dialog',{name:'전체 설정'});
  await expect(settings).toBeVisible();
  await settings.getByRole('button',{name:'취소',exact:true}).click();
  await expect(input).toHaveValue('반복해서 지켜야 할 문장');

  // 같은 문자열이어도 복원 사건은 새 sequence를 가지므로 두 번째 취소 역시 입력창을 되살린다.
  await send.click();
  settings=page.getByRole('dialog',{name:'전체 설정'});
  await settings.getByRole('button',{name:'취소',exact:true}).click();
  await expect(input).toHaveValue('반복해서 지켜야 할 문장');
});
