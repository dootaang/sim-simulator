import{expect,test}from'@playwright/test';
test.use({viewport:{width:390,height:844}});
const cardJson=(name:string,firstMes:string)=>Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name,description:'모바일 정보',first_mes:firstMes,mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));
const card=cardJson('모바일 봇','모바일 채팅');
test('모바일도 데스크톱과 같은 봇 목록·채팅·사이드 패널을 한 화면씩 사용한다',async({page})=>{await page.goto('/');const library=page.getByRole('region',{name:'봇 목록'});await expect(library).toBeVisible();await expect(page.getByRole('button',{name:'전체 설정'})).toBeVisible();await expect(page.getByRole('complementary')).toBeHidden();await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'mobile.json',mimeType:'application/json',buffer:card});await expect(page.getByRole('button',{name:'봇 목록'})).toBeVisible();await expect(page.getByText('모바일 채팅')).toBeVisible();await page.getByRole('button',{name:'봇 목록'}).click();await expect(page.getByRole('button',{name:'채팅으로 돌아가기'})).toBeVisible();await expect(library.getByText('모바일 봇')).toBeVisible();await library.getByRole('button',{name:/모바일 봇/}).click();await page.getByRole('button',{name:'현재 봇 메뉴'}).click();const side=page.getByRole('complementary');await expect(side).toBeVisible();await expect(side.getByTitle('채팅')).toBeVisible();await expect(side.getByTitle('카드 정보')).toBeVisible();await expect(side.getByTitle('에셋')).toBeVisible();await expect(side.getByTitle('호환성 여권')).toBeVisible();await page.getByRole('button',{name:'메뉴 닫기'}).click();await expect(side).toBeHidden();await expect(page.getByText('모바일 채팅')).toBeVisible();});

// 오너 결정(2026-07-17): 카드가 아무리 넓게 그려도 페이지 가로 스크롤은 없다 — 넘치면 본문을 통째로
// 줄여(zoom) 세로 폭 안에 넣는다. 고정 1600px 카드 UI + 무공백 긴 URL이 대표 재현 케이스다.
test('고정 폭 카드 UI도 가로 스크롤 없이 세로 폭 안에 들어간다',async({page})=>{
  await page.goto('/');
  const wide=cardJson('넓은 봇','<div style="width:1600px;background:#123;color:#fff">고정 1600px 카드 UI</div>\n\n**https://drive.example.test/urls/0FEMMWV9H4qsEy3ncS1wu9aaaaaaaaaaaaaaaaaa**');
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'wide.json',mimeType:'application/json',buffer:wide});
  await expect(page.getByText('고정 1600px 카드 UI')).toBeVisible();
  const main=page.locator('main.lucky-card-surface');
  await expect.poll(()=>main.evaluate((el)=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1); // 페이지 가로 넘침 없음
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const zoom=await page.locator('.text').first().evaluate((el)=>el.style.getPropertyValue('zoom'));
  expect(Number(zoom)).toBeGreaterThan(0);   // 축소 맞춤이 실제로 적용됐고
  expect(Number(zoom)).toBeLessThan(1);      // 1600px 콘텐츠가 390px 안으로 줄었다
});
