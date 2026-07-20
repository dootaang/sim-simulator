import{expect,test}from'@playwright/test';
test.use({viewport:{width:390,height:844}});
const cardJson=(name:string,firstMes:string)=>Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name,description:'모바일 정보',first_mes:firstMes,mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));
const card=cardJson('모바일 봇','모바일 채팅');
test('데스크톱의 봇 탭도 실제 봇 목록을 열고 다시 대화로 돌아온다',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.getByRole('region',{name:'봇 목록'})).toBeVisible();
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'desktop-shelf.json',mimeType:'application/json',buffer:cardJson('데스크톱 봇','데스크톱 채팅')});
  await expect(page.getByText('데스크톱 채팅')).toBeVisible();
  await page.getByRole('button',{name:'봇 목록'}).click();
  const library=page.getByRole('region',{name:'봇 목록'});
  await expect(library).toBeVisible();
  await expect(library.getByLabel('봇 검색')).toBeVisible();
  await library.getByRole('button',{name:/데스크톱 봇/}).click();
  await expect(library).toBeHidden();
  await page.getByRole('region',{name:'대화 목록'}).locator('.select-chat').first().click();
  await expect(page.getByText('데스크톱 채팅')).toBeVisible();
  await page.getByRole('button',{name:'전체 설정'}).click();
  let settings=page.getByRole('dialog',{name:'전체 설정'}),advanced=settings.locator('details').filter({hasText:'고급 생성 파라미터'});
  await expect(settings).toHaveAttribute('aria-modal','true');
  await expect(advanced).not.toHaveAttribute('open','');
  await advanced.getByText('고급 생성 파라미터').click();
  await expect(advanced).toHaveAttribute('open','');
  await settings.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'전체 설정'}).click();
  settings=page.getByRole('dialog',{name:'전체 설정'});advanced=settings.locator('details').filter({hasText:'고급 생성 파라미터'});
  await expect(advanced).toHaveAttribute('open','');
});
test('모바일도 데스크톱과 같은 봇 목록·채팅·사이드 패널을 한 화면씩 사용한다',async({page})=>{await page.goto('/');const library=page.getByRole('region',{name:'봇 목록'}),side=page.locator('aside.side');await expect(library).toBeVisible();await expect(page.getByRole('button',{name:'전체 설정'})).toBeVisible();await expect(side).toBeHidden();await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'mobile.json',mimeType:'application/json',buffer:card});await expect(page.getByRole('button',{name:'대화 목록'})).toBeVisible();await expect(page.getByText('모바일 채팅')).toBeVisible();await page.getByRole('button',{name:'대화 목록'}).click();await page.getByRole('button',{name:'봇 목록'}).click();await expect(page.getByRole('button',{name:'대화 목록'})).toBeEnabled();await expect(library.getByText('모바일 봇')).toBeVisible();await library.getByRole('button',{name:/모바일 봇/}).click();await page.getByRole('region',{name:'대화 목록'}).locator('.select-chat').first().click();await page.getByRole('button',{name:'현재 봇 메뉴'}).click();await expect(side).toBeVisible();await expect(side.getByTitle('채팅')).toBeVisible();await expect(side.getByTitle('카드 정보')).toBeVisible();await expect(side.getByTitle('에셋')).toBeVisible();await expect(side.getByTitle('가져오기 진단')).toBeVisible();await page.getByRole('button',{name:'메뉴 닫기'}).click();await expect(side).toBeHidden();await expect(page.getByText('모바일 채팅')).toBeVisible();});

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

test('모바일 봇 목록에서 삭제 버튼을 바로 찾고 확인 후 봇과 채팅을 지운다',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('region',{name:'봇 목록'})).toBeVisible();
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'delete.json',mimeType:'application/json',buffer:cardJson('삭제할 봇','삭제 테스트 채팅')});
  await expect(page.getByText('삭제 테스트 채팅')).toBeVisible();
  await page.getByRole('button',{name:'대화 목록'}).click();
  await page.getByRole('button',{name:'봇 목록'}).click();
  const remove=page.getByRole('button',{name:'봇 삭제'});
  await expect(remove).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await remove.click();
  await expect(page.getByRole('region',{name:'봇 목록'}).getByText('삭제할 봇')).toBeHidden();
  await expect(page.getByText('아직 가져온 봇이 없습니다.')).toBeVisible();
});

test('모바일 설정에서 가져온 Risu 프리셋 토글을 바로 찾고 바꾼다',async({page})=>{
  await page.goto('/');
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'toggle-mobile.json',mimeType:'application/json',buffer:cardJson('토글 봇','토글 확인 채팅')});
  await page.getByRole('button',{name:'대화 목록'}).click();
  await page.getByRole('button',{name:'전체 설정'}).click();
  const settings=page.getByRole('dialog',{name:'전체 설정'}),menu=settings.getByLabel('설정 메뉴');
  await expect(menu).toBeVisible();
  await menu.selectOption('prompt');
  await expect(settings.locator('h3')).toContainText('프롬프트 프리셋');
  const preset=Buffer.from(JSON.stringify({name:'모바일 온세무 테스트',customPromptTemplateToggle:'=표시=group\nlang=출력 언어=select=한국어, English\ncot=생각 과정\nwords=최소 글자=text\n=표시=groupEnd',promptTemplate:[{type:'chat',name:'대화',rangeStart:-20,rangeEnd:'end'}]}));
  await settings.locator('input[accept=".json,.preset,.risup,.risupreset"]').setInputFiles({name:'mobile-preset.json',mimeType:'application/json',buffer:preset});
  const presetSelect=settings.locator('.prompt .top select');
  await expect(presetSelect).toContainText('모바일 온세무 테스트',{timeout:30_000});
  await presetSelect.selectOption({label:'모바일 온세무 테스트'});
  await expect(menu.locator('option[value="toggles"]')).toHaveCount(0);
  await expect(settings.getByText('출력 언어')).toBeVisible();
  await expect(settings.getByText('생각 과정')).toBeVisible();
  await settings.getByLabel('생각 과정').check();
  await expect(settings.getByLabel('생각 과정')).toBeChecked();
});
