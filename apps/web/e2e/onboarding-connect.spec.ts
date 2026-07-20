import{expect,test}from'@playwright/test';

// UX-RENEWAL §6.2 — 지연형 AI 연결: 키 없이 보내면 연결 시트가 뜨고, 초안은 절대 사라지지 않는다.
const card=Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'연결 봇',description:'',first_mes:'첫 인사',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));

test('키 없이 전송하면 AI 연결 시트가 열리고 닫아도 초안이 남는다',async({page})=>{
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
