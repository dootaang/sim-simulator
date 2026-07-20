import{expect,test,type Page}from'@playwright/test';

const card=Buffer.from(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'합성 상태창 카드',description:'구조화 상태창 테스트',first_mes:'관측 임무를 시작한다.',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},group_only_greetings:[],character_book:{entries:[]},assets:[]}}));
const schema={meta:{id:'text-panels-e2e'},textPanels:[{id:'status',kind:'panel',fields:['이름','상태'],source:'승무원 상태'},{id:'news',kind:'feed',fields:['뉴스'],source:'관측 소식'}],initialState:{day:1}};
const compiled={schema,moduleIds:['sim.text-panels'],screens:[{id:'text-panels',title:'상태창',layout:'dashboard',regions:{main:[{widget:'detail-panel',title:'승무원 상태',source:'state.panels.status.fields'},{widget:'detail-panel',title:'관측 소식',source:'state.panels.news'}]}}],navigation:[{id:'text-panels',screenId:'text-panels',label:'상태창'}]};

async function seed(page:Page){
  let response=0;
  await page.route(/(?:sqlite3\.wasm|sqlite\.worker\.ts)/,route=>route.abort());
  await page.addInitScript(()=>localStorage.setItem('simbot.llm',JSON.stringify({provider:'custom',endpoint:'http://127.0.0.1:4173/test-llm',model:'test',apiKey:'key'})));
  await page.route('http://127.0.0.1:4173/test-llm',async route=>{response+=1;const content=response===1?'관측 완료.\n이름: 리안 | 상태: 경계 |\n| 뉴스: 외곽 항로 정상 |':'교대 완료.\n이름: 리안 | 상태: 휴식 |\n| 뉴스: 귀환 절차 시작 |';await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content}}]})});});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'봇카드 가져오기'})).toBeVisible();
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'synthetic-text-panels.json',mimeType:'application/json',buffer:card});
  await expect(page.getByText('관측 임무를 시작한다.')).toBeVisible();
  let projectId='';
  await expect.poll(async()=>projectId=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('simbot-sessions',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);}),row=await new Promise<any>((resolve,reject)=>{const request=db.transaction('sessions').objectStore('sessions').get('cardlib:index');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});db.close();return String(row?.payload?.cards?.[0]?.projectId??'');}),{timeout:15_000}).not.toBe('');
  await page.evaluate(async({artifact,id})=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('simbot-sessions',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});await new Promise<void>((resolve,reject)=>{const request=db.transaction('sessions','readwrite').objectStore('sessions').put({id:`cardlib:${id}:compiler`,schemaHash:'cardlib-compiler',title:'Engine compilation',updatedAt:Date.now(),payload:artifact});request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve();});await new Promise<void>((resolve,reject)=>{const store=db.transaction('sessions','readwrite').objectStore('sessions'),request=store.openCursor();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve();return;}if(String(cursor.key).startsWith(`${id}:chat:`))cursor.delete();cursor.continue();};});db.close();},{artifact:compiled,id:projectId});
  await page.reload();
  if(await page.getByTitle('합성 상태창 카드').count())await page.getByTitle('합성 상태창 카드').click();
}

async function send(page:Page,text:string){await page.getByRole('textbox',{name:'메시지를 입력하세요'}).fill(text);await page.getByRole('button',{name:'보내기',exact:true}).click();}

test('상태 체인은 채팅에서 제거되고 위젯·영수증에 반영되며 다음 응답으로 갱신된다',async({page})=>{
  await page.setViewportSize({ width: 1280, height: 800 }); await page.addInitScript(()=>localStorage.setItem('simbot.sim.pinned','0')); await seed(page);await send(page,'첫 관측');
  const first=page.getByRole('article').filter({hasText:'관측 완료.'}).last();await expect(first).toBeVisible();await expect(first).not.toContainText('이름: 리안 |');await expect(first).toContainText('panel_sync');
  await page.getByRole('button',{name:/ 열기$/}).click();let dialog=page.getByRole('dialog',{name:'시뮬레이션'});await expect(dialog).toContainText('리안');await expect(dialog).toContainText('경계');await expect(dialog).toContainText('외곽 항로 정상');
  await dialog.getByRole('button',{name:'닫기'}).click();await send(page,'교대');
  const second=page.getByRole('article').filter({hasText:'교대 완료.'}).last();await expect(second).toBeVisible();await expect(second).not.toContainText('상태: 휴식 |');await expect(second).toContainText('panel_sync');
  await page.getByRole('button',{name:/ 열기$/}).click();dialog=page.getByRole('dialog',{name:'시뮬레이션'});await expect(dialog).toContainText('휴식');await expect(dialog).toContainText('귀환 절차 시작');await expect(dialog).not.toContainText('경계');
});
