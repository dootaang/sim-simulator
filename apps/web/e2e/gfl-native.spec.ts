import{expect,test}from'@playwright/test';
import{strToU8,zipSync}from'fflate';
import{joinBytes,makePngChunk,PNG_SIGNATURE}from'@simbot/card';
import{createSimPack,packSimPack}from'@simbot/simpack';

const dollCount=120;
const classes=Array.from({length:dollCount},(_,index)=>`["${index===0?'M4A1':`D${index+1}`}"]="${index===0?'AR':'SMG'}"`).join(',');
const grades=Array.from({length:dollCount},(_,index)=>`["${index===0?'M4A1':`D${index+1}`}"]=${index===0?5:3}`).join(',');
const lua=`local DOLL_CLASS={${classes}}
local DOLL_GRADE={${grades}}
local ITEM_DATA={["전투식량"]={price=50,type="use",desc="전투 중 체력을 회복",effect={hp=100},drop=100}}
local EQUIP_DATA={["옵티컬"]={price=100,power=50,desc="명중을 보조하는 조준경",etc="전투력 +50"}}
local DOC_DATA={{id="doc0",year="1908",code="023-TNG-1908",title="퉁구스카 대폭발",body="첫 번째 기록입니다.<br>둘째 줄입니다."}}
local KALINA_SHOP_ITEMS={{id="전투식량",price=50,desc="전투 중 체력을 회복"}}
local PROG_BY_STAR={[0]=3,[1]=5,[2]=7,[3]=8,[4]=9,[5]=10,[6]=11}
local MISSION_TYPES={{key="recon",name="🔍 정찰 임무",step_mod=-1,hint="교전 최소화. 빠르게 끝나지만 보상 적음."},{key="sweep",name="⚔️ 소탕 임무",step_mod=0,hint="구역의 적을 소탕. 표준 난이도·보상."},{key="annihil",name="💥 섬멸 임무",step_mod=1,hint="거점 완전 섬멸. 길고 어렵지만 보상 큼."}}
local EV_GUIDE={battle="교전 상황. 실제 전투를 서술하라.",boss="보스 교전을 서술하라.",recon="정찰 상황. 교전을 넣지 마라.",other="돌발 상황. 교전을 넣지 마라.",mystery="정체불명 상황을 서술하라."}
local ENCOUNTER_POOL={"D2","D3","D4","D5","D6","D7","D8","D9","D10"}
local ENCOUNTER_BAN={}
local BOSS_LIST={"Scarecrow","Gebbennu"}
local NO_RECRUIT_BOSSES={Gebbennu=true}
local MFG_EQ_POOL_NORMAL={"옵티컬"}
local MFG_EQ_POOL_HEAVY={"옵티컬"}
local MISSION_DATA={["ALPHA"]={name="ALPHA",diff="★★★★",power=100,reward="자금 +500 / 부품 +100",enemy="철혈",boss="Scarecrow"},["BETA"]={name="BETA",power=900},["GAMMA"]={name="GAMMA",power=1000}}
local FAIRY_DATA={["지휘요정"]={power=300}}
${'-- certified runtime\n'.repeat(700)}`;
const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'소녀전선:잔불',description:'전술인형과 제대를 운영하는 대형 시뮬레이션',first_mes:'그리폰 기지에 접속했다.',mes_example:'',personality:'',scenario:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:['소녀전선'],creator:'test',character_version:'1',extensions:{risuai:{defaultVariables:'A_day=1\nA_gold=5000\nA_res=3000\nScarecrowa=["300","200","100","-4","90"]\nGebbennua=["400","300","150","0","97"]',triggerscript:[{effect:[{type:'triggerlua',code:lua}]}]}},group_only_greetings:[],character_book:{entries:[]},assets:[{name:'전투식량',type:'image',ext:'png',uri:'embedded:0'}]}};
const png=joinBytes(PNG_SIGNATURE,makePngChunk('tEXt',strToU8(`chara-ext-asset_:0\0${Buffer.from('item-image').toString('base64')}`)),makePngChunk('tEXt',strToU8(`ccv3\0${Buffer.from(JSON.stringify(card)).toString('base64')}`)),makePngChunk('IEND',new Uint8Array()));
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const dollIds=Array.from({length:dollCount},(_,index)=>index===0?'M4A1':`D${index+1}`);
const assetModule=zipSync(Object.fromEntries([...dollIds.map(id=>[`assets/${id}_normal.png`,pixel]),['assets/FAMAS_normal.png',pixel],['assets/FAMAS_smile.png',pixel]]));

const romanceSchema:any={initialState:{day:1,gold:10000,resources:{res:3000,parts:20,cores:9},items:{},player:{level:1,exp:0,pools:{hp:{cur:1000,max:1000},mp:{cur:1000,max:1000}}},clock:{day:1,hour:8,turn:0,phase:'오전'},location:'base-command',gfl:{started:true,mode:'commander',baseLocation:'base-command',dolls:{m4a1:{id:'m4a1',name:'M4A1',class:'AR',grade:5,hp:{cur:400,max:1000},mp:{cur:1000,max:1000},baseMaxHp:1000,basePower:1000,power:1000,mood:90,affinity:80,mod:0,status:'대기',equipment:[],records:{kills:0,crits:0,guarded:0},hiredDay:1,secretHobby:'모형 수집'}},echelons:[{id:'e1',name:'제1제대',slots:['m4a1',null,null,null,null,null],fairyId:null}],facilities:{base1:1,base2:1,base3:1,base4:1,base5:1},manufacturing:[],repairs:[],logistics:[],completedMissions:[],sortie:null,settings:{relationDifficulty:'standard',jealousy:'mild'},daily:{day:1,sortiesUsed:0,sortiesCompleted:0,management:0,relations:0,endDay:0,claimed:[]},promises:[],promiseRequest:{dollId:'m4a1',name:'M4A1',type:'repair',deadline:null,requestedDay:1,triggered:false},promiseReceipts:[],anniversaries:[],outingDays:{},lastInteractions:{}}},resources:[{id:'res',basePrice:1},{id:'parts',basePrice:1},{id:'cores',basePrice:1}],locations:[{id:'base-command',name:'지휘관실'},{id:'base-hall',name:'복도'},{id:'base-maintenance',name:'정비실'},{id:'base-outside',name:'기지 외부'}],gfl:{dolls:[{id:'m4a1',name:'M4A1',class:'AR',grade:5,maxHp:1000,maxMp:1000,power:1000,mood:90}],items:[],equipment:[],fairies:[],missions:[{id:'alpha',name:'ALPHA',theater:'front',stars:0,power:100,enemy:'철혈',rewards:{gold:100},enemies:[{id:'target',name:'표적',power:10,hp:10}]}],facilities:[],hire:{capacity:[4,8,12,16,20]},relation:{names:['적대','경계','불편','첫 만남','익숙해짐','호감을 가짐','신뢰','소중히 여김','사랑','서약','???'],thresholds:[-150,-80,-20,0,20,50,80,120,150,400,400],descriptions:[]}}};
const romanceProject=createSimPack({id:'gfl-romance-e2e',title:'연애 리듬 검증',schema:romanceSchema,screens:[{id:'play',title:'대화',layout:'chat',regions:{main:[{widget:'chat'}]}},{id:'romance',title:'연애 리듬',layout:'dashboard',regions:{main:[{widget:'gfl-console'}]}}],navigation:[{id:'play',screenId:'play',label:'대화'},{id:'romance',screenId:'romance',label:'연애 리듬'}]});
(romanceProject.manifest.modules as unknown as Record<string,unknown>).installed=['genre.gfl'];
(romanceProject.manifest.content as unknown as Record<string,unknown>).nativePresentation='gfl';
const romanceSimpack=Buffer.from(packSimPack(romanceProject));
const promotionSchema:any=structuredClone(romanceSchema);
promotionSchema.initialState.gfl.dolls.m4a1.affinity=480; // 수치는 서약 직전 — 보정 +9로 대화 판정이 항상 성공한다
promotionSchema.initialState.gfl.dolls.m4a1.confirmedTier=3; // 확정은 첫 만남 — 승급 대기 상태로 시작
const promotionProject=createSimPack({id:'gfl-promotion-e2e',title:'승급 게이트 검증',schema:promotionSchema,screens:[{id:'play',title:'대화',layout:'chat',regions:{main:[{widget:'chat'}]}},{id:'romance',title:'연애 리듬',layout:'dashboard',regions:{main:[{widget:'gfl-console'}]}}],navigation:[{id:'play',screenId:'play',label:'대화'},{id:'romance',screenId:'romance',label:'연애 리듬'}]});
(promotionProject.manifest.modules as unknown as Record<string,unknown>).installed=['genre.gfl'];
(promotionProject.manifest.content as unknown as Record<string,unknown>).nativePresentation='gfl';
const promotionSimpack=Buffer.from(packSimPack(promotionProject));

async function importGfl(page:import('@playwright/test').Page){
  await page.goto('/');
  await expect(page.getByRole('button',{name:/카드 가져오기/}).first()).toBeVisible({timeout:15_000});
  await expect(page.getByText('저장소를 여는 중…')).toHaveCount(0);
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles([{name:'소녀전선_잔불.png',mimeType:'image/png',buffer:Buffer.from(png)},{name:'gfl-sprites.zip',mimeType:'application/zip',buffer:Buffer.from(assetModule)}]);
  const simulation=page.getByRole('dialog',{name:'시뮬레이션'});
  await expect(simulation).toBeVisible({timeout:15_000});
  await expect(simulation.getByLabel('소녀전선 지휘 콘솔')).toBeVisible();
  // setInputFiles는 async change handler가 연결 ZIP을 저장하기 전에 반환할 수 있다.
  // 존재하지 않는 DB를 버전 지정 open으로 먼저 만들면 실제 앱의 upgrade도 막으므로, 먼저 목록을 확인한다.
  await expect.poll(()=>browserStoreCount(page,'modules'),{timeout:10_000}).toBeGreaterThan(0);
  return simulation;
}

async function browserStoreCount(page:import('@playwright/test').Page,storeName:string){return page.evaluate(async(name)=>{const databases=await indexedDB.databases();if(!databases.some(value=>value.name==='lucky-simulator-card-blobs'))return 0;const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('lucky-simulator-card-blobs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{if(!db.objectStoreNames.contains(name))return 0;const tx=db.transaction(name,'readonly');return await new Promise<number>((resolve,reject)=>{const request=tx.objectStore(name).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}},storeName);}

test('소녀전선 PNG를 넣으면 별도 컴파일 질문 없이 네이티브 플레이로 바로 전환된다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const simulation=await importGfl(page);
  const console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await expect(console).toContainText('소녀전선: 잔불');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await expect(console.locator('header.status')).toContainText('지휘관 Lv');
  await expect(console.locator('header.status')).toContainText('0 / 30 EXP');
  await expect(console).toContainText('현재 위치 · 지휘관실');
  await expect(console.getByRole('button',{name:'제조·수복'})).toBeDisabled();
  await console.getByRole('button',{name:'정비실'}).click();
  // 기본값 '관리 화면 유지' 켬(2026-07-19) — 서사 행동 뒤에도 관리창이 남는다. 메뉴 재개방 경로는
  // 닫기 버튼으로 명시적으로 닫은 뒤 검증한다.
  await expect(console).toContainText('현재 위치 · 정비실');
  await simulation.getByRole('button',{name:'닫기'}).click();
  await expect(simulation).toBeHidden();
  await page.getByRole('button',{name:'현재 봇 메뉴'}).click();
  await page.getByRole('button',{name:'시뮬레이션 열기'}).click();
  const reopened=page.getByRole('dialog',{name:'시뮬레이션'}).getByLabel('소녀전선 지휘 콘솔');
  await expect(reopened).toContainText('현재 위치 · 정비실');
  await expect(reopened.getByRole('button',{name:'제조·수복'})).toBeEnabled();
  await reopened.getByRole('button',{name:'인형 고용',exact:true}).click();
  // 결정론 peek이 실제 뽑기 전에 다음 5명의 초상화를 영구 캐시에 준비한다.
  await expect.poll(()=>browserStoreCount(page,'asset-thumbnails'),{timeout:10_000}).toBeGreaterThan(0);
  await reopened.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await expect(reopened).toContainText('숙소 0/4');
  await expect(reopened.getByRole('button',{name:'계약',exact:true}).first()).toBeVisible();
  await expect(reopened.locator('.hire-grid img')).toHaveCount(5);
  await expect(reopened.locator('.portrait-loading')).toHaveCount(0);
  // 콘솔용 이미지는 원본 ZIP을 매번 다시 디코드하지 않고 192px WebP 영구 캐시에 남는다.
  await expect.poll(()=>browserStoreCount(page,'asset-thumbnails')).toBeGreaterThan(0);
  const firstOffers=await reopened.locator('.hire-grid article b').allTextContents();
  await reopened.getByRole('button',{name:'목록 다시 뽑기 · 오늘 1회'}).click();
  await expect(reopened.getByRole('button',{name:'목록 다시 뽑기 · 오늘 1회'})).toBeDisabled();
  const rerolledOffers=await reopened.locator('.hire-grid article b').allTextContents();
  expect(rerolledOffers).toHaveLength(5);
  expect(rerolledOffers).not.toEqual(firstOffers);
  await reopened.getByRole('button',{name:'작전',exact:true}).click();
  await reopened.getByRole('button',{name:/레드·오렌지 작전구역/}).click();
  await expect(reopened).toContainText('ALPHA');
  await simulation.getByRole('button',{name:'닫기'}).click();
  await page.getByRole('button',{name:'메뉴 닫기'}).click();
  await page.getByRole('button',{name:'Aa 보기 설정'}).click();
  await page.getByRole('button',{name:'작게',exact:true}).click();
  await expect(page.getByLabel('본문 이미지 최대 너비')).toHaveValue('16');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('simbot.llm')??'{}').assetWidth)).toBe(16);
});

test('기록실 원문을 열람하고 확인 대화상자를 거쳐 인형을 해체한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByText(/기록실 · 1\/1/).click();
  await console.getByText(/1908 · 023-TNG-1908 · 퉁구스카 대폭발/).click();
  await expect(console).toContainText('첫 번째 기록입니다.'); await expect(console).toContainText('둘째 줄입니다.');
  await console.getByRole('button',{name:'인형 고용',exact:true}).click(); await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click(); await console.getByRole('button',{name:/다음 시간대 · 수송 도착/}).click();
  await simulation.getByRole('button',{name:'닫기'}).click(); await expect(simulation).toBeHidden(); await page.getByRole('button',{name:'관리 화면 열기'}).click();
  const reopened=page.getByRole('dialog',{name:'시뮬레이션'}).getByLabel('소녀전선 지휘 콘솔'); await reopened.getByRole('button',{name:'인형',exact:true}).click();
  await expect(reopened.locator('.doll-grid button')).toHaveCount(1); page.once('dialog',dialog=>dialog.accept());
  await reopened.getByText(/위험 구역/).click(); // 해체는 탭 최하단 접힌 위험 구역 — 펼쳐야 버튼이 보인다
  await reopened.getByRole('button',{name:'인형 해체 · 확인 필요'}).click(); await simulation.getByRole('button',{name:'닫기'}).click(); await expect(simulation).toBeHidden();
  await page.getByRole('button',{name:'관리 화면 열기'}).click(); const finalConsole=page.getByRole('dialog',{name:'시뮬레이션'}).getByLabel('소녀전선 지휘 콘솔'); await finalConsole.getByRole('button',{name:'인형',exact:true}).click();
  await expect(finalConsole.locator('.doll-grid button')).toHaveCount(0);
});

test('임무 유형 선택부터 다단계 진행·전투·루팅 영수증까지 완주한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  await page.addInitScript(()=>{let sequence=0;Object.defineProperty(Crypto.prototype,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`});});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  // 풀블리드 다이어트: 텍스트 헤더 대신 플로팅 도구(닫기)만 — 접근성 이름은 컨테이너 aria-label이 유지한다.
  await expect(simulation.getByRole('button',{name:'닫기'})).toBeVisible();
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click();
  await console.getByRole('button',{name:/수송 도착/}).click();
  // 창 유지 기본 켬(2026-07-19) — 서사 행동 뒤에도 관리창이 남는다.
  await console.getByRole('button',{name:'제대',exact:true}).click();
  await expect(console.locator('.slots .slot')).toHaveCount(6);
  await expect(console.locator('.slots .slot').filter({hasText:'전열'})).toHaveCount(2);
  await expect(console.locator('.slots .slot').filter({hasText:'중열'})).toHaveCount(2);
  await expect(console.locator('.slots .slot').filter({hasText:'후열'})).toHaveCount(2);
  await expect(console.locator('.formation-hint')).toContainText('RF·MG는 후열');
  await console.locator('.roster button').first().click();
  // 6번째 칸(후열 2번) 배치 회귀 — 칸 수만 세는 검증은 slot>4 하드코딩을 놓쳤다.
  await console.getByRole('button',{name:/SLOT 6/}).click();
  await console.locator('.roster button').first().click();
  await expect(console.locator('.slots .slot').nth(5)).not.toContainText('EMPTY');
  // 회귀 가드: 배치 초상화는 슬롯 버튼 안에 갇혀야 한다 — 행 라벨(<strong>) 추가로 :first-child
  // 격리 규칙이 죽으면서 absolute 이미지가 화면 전체를 덮었던 버그(2026-07-19 실기기).
  const imgContained=await console.locator('.slots .slot').nth(5).evaluate((slot)=>{const img=slot.querySelector('img');if(!img)return true;const a=img.getBoundingClientRect(),b=slot.getBoundingClientRect();return a.width<=b.width+2&&a.height<=b.height+2;});
  expect(imgContained).toBe(true);
  await console.getByRole('button',{name:'작전',exact:true}).click();
  await console.getByRole('button',{name:/레드·오렌지 작전구역/}).click();
  await console.getByRole('button',{name:/ALPHA/}).click();
  await expect(console.locator('.risk')).toContainText('성공 가능성 약');
  await expect(console.locator('.risk')).toContainText('전투력이 낮아도 출격');
  await expect(console.locator('.risk')).toContainText('상성: 기계 장갑 부대');
  await expect(console.locator('.risk')).toContainText('제대 내 유리 병과 0명');
  await expect(console.locator('.mission-types')).toContainText('정찰 임무');
  await console.locator('.mission-types button').filter({hasText:'소탕 임무'}).click();
  await console.getByRole('button',{name:'전술 교전',exact:true}).click();
  await expect(console.locator('.stage-tracker span')).toHaveCount(9);
  await expect(console.locator('.brief .combat-roster')).toContainText('HP');
  await expect(console.locator('.battle-intel')).toContainText('적 전력');
  await expect(console.locator('.battle-intel .enemy-card')).toHaveCount(1);
  await expect(console.locator('.tactical-situation')).toContainText('전황');
  await expect(console.locator('.tactical-situation')).toContainText('추천:');
  await expect(console.locator('.tactics button.recommended')).toHaveCount(1);
  let nonCombatStages=0,recruited=false,bossRecruited=false,interventionUsed=false,interrogated=false;
  for(let step=0;step<9;step++){
    let usedThisStep=false;
    const stageButton=console.getByRole('button',{name:/단계 진행/});
    if(await stageButton.isVisible()){nonCombatStages++;await stageButton.click();}
    else {
      const commandSelect=console.locator('.intervention select').first();
      if(!interventionUsed&&await commandSelect.isEnabled()){await commandSelect.selectOption('focus');await expect(commandSelect).toHaveValue('focus');await console.locator('.intervention select').nth(1).selectOption('1');interventionUsed=true;usedThisStep=true;}
      await console.getByRole('button',{name:/균형 전술/}).click();
    }
    await simulation.getByRole('button',{name:'닫기'}).click();
    await expect(simulation).toBeHidden();
    const interrogate=page.getByRole('region',{name:'엔진 결정 카드'}).getByRole('button',{name:'심문한다'});
    if(await interrogate.isVisible()){await interrogate.click();interrogated=true;}
    const recruit=page.getByRole('region',{name:'엔진 결정 카드'}).getByRole('button',{name:'영입을 시도한다'});
    if(await recruit.isVisible()){await recruit.click();recruited=true;}
    const bossRecruit=page.getByRole('region',{name:'엔진 결정 카드'}).getByRole('button',{name:'영입한다'});
    if(await bossRecruit.isVisible()){await bossRecruit.click();bossRecruited=true;}
    await page.getByRole('button',{name:'관리 화면 열기'}).click();
    await console.getByRole('button',{name:'작전',exact:true}).click();
    if(usedThisStep)await expect(console).toContainText(' 지휘 개입');
  }
  expect(nonCombatStages).toBeGreaterThan(0);
  expect(bossRecruited).toBe(true);
  expect(interventionUsed).toBe(true);
  await expect(console.locator('.battle-report')).toContainText('최근 전투 보고');
  await expect(console.locator('.battle-report .combat-roster')).toContainText('HP');
  await expect(console.locator('.battle-report')).toContainText('상성: 기계 장갑 부대');
  await expect(console.locator('.battle-report')).toContainText('전리품: 전투식량 ×1');
  await expect(console.locator('.commander-exp')).toContainText('지휘 EXP');
  await expect(console.locator('.reward-settlement')).toContainText('작전 보상 정산');
  await expect(console.locator('.reward-settlement')).toContainText('자금');
  await console.getByRole('button',{name:'기지',exact:true}).click();
  const representative=await console.locator('.stage .name').innerText();
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await expect(console.locator('.doll-grid button')).toHaveCount(2);
  await expect(console.locator('.doll-grid')).toContainText('Scarecrow');
  await expect(console.locator('.doll-grid .health')).toHaveCount(2);
  await console.locator('.doll-grid article',{hasText:'Scarecrow'}).getByRole('button').click();
  await console.getByRole('button',{name:'기지',exact:true}).click();
  await expect(console.locator('.stage .name')).toHaveText(representative);
});

test('관계 선택지 캡슐과 1:1 대화 세션이 엔진 상태로 작동한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click();
  await console.getByRole('button',{name:/수송 도착/}).click();
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await expect(console).toContainText('관계 선택지 · d20 판정');
  await expect(console).toContainText('오늘 교류 4회 남음');
  await expect(console.getByRole('button',{name:/차분히 대화한다/})).toBeEnabled();
  await console.getByRole('button',{name:/1:1 대화 시작/}).click();
  // 대화 세션 = 결정 카드가 채팅에 상주하고, 시간은 엔진이 잠근다.
  const dock=page.getByRole('region',{name:'엔진 결정 카드'});
  // 창 유지 기본 켬 — 미러 dock(관리창 안)과 채팅 dock이 공존하므로 첫 확인은 미러로 한정한다.
  await expect(simulation.getByRole('region',{name:'엔진 결정 카드'})).toContainText('대화 중 · 시간 정지');
  await expect(console.getByRole('button',{name:'다음 시간대',exact:true})).toBeDisabled();
  await expect(console.getByRole('button',{name:'하루 마감',exact:true})).toBeDisabled();
  await simulation.getByRole('button',{name:'닫기'}).click();
  await dock.getByRole('button',{name:'대화를 마무리한다'}).click();
  await page.getByRole('button',{name:'관리 화면 열기'}).click();
  await expect(console.getByRole('button',{name:'다음 시간대',exact:true})).toBeEnabled();
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await expect(console.getByRole('button',{name:/1:1 대화 시작/})).toBeDisabled();
  await expect(console).toContainText('오늘 완료');
});

test('호감이 앞서가면 승급 대기 배지가 뜨고 대화 성공이 한 단계씩 확정한다',async({page})=>{
  await page.goto('/'); await expect(page.getByRole('button',{name:/카드 가져오기/}).first()).toBeVisible({timeout:15_000});
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'gfl-promotion.simpack',mimeType:'application/zip',buffer:promotionSimpack});
  await page.getByRole('button',{name:'연애 리듬'}).click(); const console=page.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await expect(console.locator('.relation-meta')).toContainText('첫 만남');
  await expect(console.locator('.pending-badge')).toContainText('승급 대기 · 익숙해짐');
  await console.getByRole('button',{name:/차분히 대화한다/}).click();
  await expect(console.locator('.relation-meta')).toContainText('익숙해짐');
  await expect(console.locator('.pending-badge')).toContainText('승급 대기 · 호감을 가짐');
  await console.getByRole('button',{name:/서로 부를 별명을 정한다/}).click();
  await expect(console.locator('.relation-meta')).toContainText('호감을 가짐');
  await expect(console.locator('.pending-badge')).toContainText('승급 대기 · 신뢰');
});

test('연속 엔진 클릭은 채팅에서 접힌 영수증 묶음이 되고 펼치면 전부 보인다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click(); await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click(); await console.getByRole('button',{name:/다음 시간대 · 수송 도착/}).click();
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await console.getByRole('button',{name:'기지 대표로 설정'}).click(); // ledger 3연속
  await console.getByRole('button',{name:'수복 투입'}).click();
  await console.getByRole('button',{name:'MOD 개조'}).click();
  await simulation.getByRole('button',{name:'닫기'}).click(); await expect(simulation).toBeHidden();
  const receipts=page.locator('.list article.message',{hasText:'장부에 반영되었습니다'});
  const toggle=page.getByRole('button',{name:/엔진 영수증 3건/}).last(); // 준비 클릭 묶음도 접힐 수 있어 마지막 것
  await expect(toggle).toBeVisible(); // 마지막 3연속 묶음이 접혔다
  const collapsed=await receipts.count(); // 앞선 준비 클릭 묶음도 각 1건씩만 보인다
  await toggle.click();
  await expect(receipts).toHaveCount(collapsed+2); // 이전 2건이 펼쳐진다
});

test('하루 리듬 바·관계 게이지·퀵 칩이 게임 감각을 시각화한다',async({page})=>{
  await page.setViewportSize({width:1280,height:800}); // 자동 핀 — 채팅과 콘솔 나란히
  await page.goto('/'); await expect(page.getByRole('button',{name:/카드 가져오기/}).first()).toBeVisible({timeout:15_000});
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'gfl-romance.simpack',mimeType:'application/zip',buffer:romanceSimpack});
  await page.getByRole('button',{name:'연애 리듬'}).click(); const console=page.getByLabel('소녀전선 지휘 콘솔');
  await expect(console.locator('.day-rhythm i.now')).toHaveCount(1); // 하루 리듬 바
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await expect(console.locator('.relation-gauge')).toBeVisible(); // 관계 게이지(신뢰 구간)
  await expect(console.locator('.relation-gauge small')).toContainText('다음 문턱까지');
});

test('신뢰 인형과 외출해 시간대를 쓰고 수락한 수복 약속의 이행 영수증을 받는다',async({page})=>{
  await page.goto('/'); await expect(page.getByRole('button',{name:/카드 가져오기/}).first()).toBeVisible({timeout:15_000});
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({name:'gfl-romance.simpack',mimeType:'application/zip',buffer:romanceSimpack});
  await page.getByRole('button',{name:'연애 리듬'}).click(); const console=page.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'인형',exact:true}).click(); await expect(console).toContainText('취향 · ?');
  const outing=console.getByRole('button',{name:'함께 외출 · 시간대 1칸'}); await expect(outing).toBeEnabled(); await outing.click();
  await expect(console.locator('header.status')).toContainText('오후'); await expect(outing).toBeDisabled();
  await expect(console.locator('.promise-request')).toContainText('M4A1의 약속 요청'); await console.locator('.promise-request').getByRole('button',{name:'약속한다'}).click();
  await console.getByRole('button',{name:'정비실',exact:true}).click(); await console.getByRole('button',{name:'인형',exact:true}).click(); await console.getByRole('button',{name:'수복 투입'}).click(); await console.getByRole('button',{name:'다음 시간대',exact:true}).click();
  await expect(console.getByRole('button',{name:'하루 마감',exact:true})).toBeEnabled(); await console.getByRole('button',{name:'하루 마감',exact:true}).click();
  await console.getByRole('button',{name:'인형',exact:true}).click(); await expect(console).toContainText('✓ 약속 이행 완료'); await expect(console).toContainText('호감 +5 · 기분 +15');
});

test('군수지원 복귀 보상을 수령하고 심야 작전의 실제 명중 보정을 확인한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page); let console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click(); await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click(); await console.getByRole('button',{name:/수송 도착/}).click();
  const reopen=async()=>{const open=page.getByRole('button',{name:'관리 화면 열기'});if(await open.isVisible().catch(()=>false))await open.click(); return page.getByRole('dialog',{name:'시뮬레이션'}).getByLabel('소녀전선 지휘 콘솔');};
  console=await reopen(); await console.getByRole('button',{name:'제대',exact:true}).click(); await console.locator('.roster button').first().click(); await expect(console.locator('.slots .remove')).toHaveCount(1);
  await console.getByRole('button',{name:'2시간대 파견'}).click(); await expect(console.locator('.logistics-panel')).toContainText('파견 중 · 2시간대 남음');
  await console.getByRole('button',{name:'기지',exact:true}).click(); await console.getByRole('button',{name:'다음 시간대'}).click();
  console=await reopen(); await console.getByRole('button',{name:'다음 시간대'}).click();
  console=await reopen(); await console.getByRole('button',{name:'제대',exact:true}).click(); await expect(console.locator('.logistics-panel')).toContainText('복귀 완료 · 보급품 수령 대기');
  await console.getByRole('button',{name:'보급품 수령'}).click(); await expect(console.locator('.logistics-panel')).toContainText('파견 순간 보상이 확정');
  await console.getByRole('button',{name:'기지',exact:true}).click(); await console.getByRole('button',{name:'다음 시간대'}).click();
  console=await reopen(); await expect(console.locator('header.status')).toContainText('심야');
  await console.getByRole('button',{name:'작전',exact:true}).click(); await expect(console.locator('.night-warning')).toContainText('기본 명중 −3');
  await expect(console.locator('.night-warning')).toContainText('최종 -3');
  await console.getByRole('button',{name:/레드·오렌지 작전구역/}).click(); await console.getByRole('button',{name:/ALPHA/}).click();
  await expect(console.locator('.risk')).toContainText('d20 보정'); await console.getByRole('button',{name:'빠른 교전'}).click();
});

test('휴대폰 가로모드에서 대화 장면과 관리창이 한 화면에 맞고 가로 스크롤이 생기지 않는다',async({page})=>{
  await page.setViewportSize({width:844,height:390});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'전술인형으로 시작'}).click();
  await expect(console.locator('.workspace')).toBeVisible();
  await expect(console.locator('.stage')).toBeVisible();
  await expect(console.locator('.dialogue')).toBeVisible();
  const layout=await console.evaluate(element=>{const workspace=element.querySelector<HTMLElement>('.workspace'),stage=element.querySelector<HTMLElement>('.stage'),dialogue=element.querySelector<HTMLElement>('.dialogue');return{fits:element.scrollWidth<=element.clientWidth+1,columns:workspace?getComputedStyle(workspace).gridTemplateColumns.split(' ').filter(Boolean).length:0,stageVisible:!!stage&&stage.getBoundingClientRect().width>0,dialogueVisible:!!dialogue&&dialogue.getBoundingClientRect().width>0};});
  expect(layout).toEqual({fits:true,columns:2,stageVisible:true,dialogueVisible:true});
  await console.getByRole('button',{name:'상점·장비'}).click();
  await expect(console).toContainText('카리나 보급 상점');
  await console.getByRole('button',{name:'카리나 보급 상점'}).click();
  const product=console.locator('.product').filter({hasText:'전투식량'});
  await expect(product.getByRole('img',{name:'전투식량 상품 이미지'})).toBeVisible();
  await expect(product).toContainText('전투 중 체력을 회복');
  await expect(product).toContainText('HP +100');
  await expect(product).toContainText('인형 탭에서 대상 인형에게 사용');
  await expect(product.getByRole('button',{name:'구매'})).toBeVisible();
});

test('소녀전선 각도괄호 태그를 채팅 본문의 감정 스프라이트로 렌더링한다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem('simbot.llm',JSON.stringify({provider:'custom',endpoint:'http://127.0.0.1:4173/test-llm',model:'test',apiKey:'key'})));
  const reply='FAMAS가 자신의 장비를 토닥였다.\n[|<img="famas_normal">|"제 정식 명칭은 FAMAS입니다."|]\n[|<img="famas_smile">|"더 궁금한 점이 있으신가요?"|]\n|BGM_Dawn|';
  await page.route('http://127.0.0.1:4173/test-llm',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:reply}}]})}));
  const simulation=await importGfl(page);
  await simulation.getByRole('button',{name:'닫기'}).click();
  await expect(page.getByRole('button',{name:'관리 화면 열기'})).toContainText('★ 관리');
  await expect(page.getByRole('region',{name:'소녀전선 장면 음악'})).toHaveCount(0);
  await page.getByPlaceholder('메시지를 입력하세요').fill('FAMAS에게 자기소개를 부탁한다.');
  await page.getByRole('button',{name:'보내기'}).click();
  await expect(page.getByText('FAMAS가 자신의 장비를 토닥였다.')).toBeVisible();
  await expect(page.getByText(/<img="famas_normal">/)).toHaveCount(0);
  await expect(page.getByText('|BGM_Dawn|')).toHaveCount(0);
  await expect(page.locator('.text img[alt="famas_normal"]')).toBeVisible();
  await expect(page.locator('.text img[alt="famas_smile"]')).toBeVisible();
  const quotedDialogue=page.locator('.text .dialogue');
  await expect(quotedDialogue).toHaveCount(2);
  await expect(quotedDialogue.first()).toHaveText('“제 정식 명칭은 FAMAS입니다.”');
  await expect(quotedDialogue.first()).toBeVisible();
  await expect(page.locator('.gfl-say')).toHaveCount(0);
  const dialogueLayout=await quotedDialogue.first().evaluate(element=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);return{visible:box.width>0&&box.height>0,color:style.color,fits:element.parentElement!.scrollWidth<=element.parentElement!.clientWidth+1};});
  expect(dialogueLayout.visible).toBe(true);
  expect(dialogueLayout.color).toBe('rgb(229, 191, 121)');
  expect(dialogueLayout.fits).toBe(true);
});

test('저격 고용에서 이름을 검색해 지정 계약한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await expect(console.getByRole('region',{name:'전술인형 선택기'})).toHaveCount(0);
  await console.getByText(/저격 고용 · 원하는 인형/).click();
  const picker=console.getByRole('region',{name:'전술인형 선택기'});
  await expect(picker.getByLabel(`인형 ${dollCount}명 가상 목록`)).toBeVisible();
  const before=await picker.locator('.virtual-row article').count();
  expect(before).toBeGreaterThan(1);
  expect(before).toBeLessThan(dollCount);
  await picker.getByLabel('인형 이름 검색').fill('M4A1');
  await expect(picker.locator('.results article')).toHaveCount(1);
  await expect(picker).toContainText('M4A1');
  await picker.getByRole('button',{name:'지정 계약'}).click();
  await expect(console).toContainText('숙소 1/4');
});

test('관리창 아래에 같은 결정 카드를 표시하고 그 자리에서 후속 결정을 처리한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  await page.addInitScript(()=>localStorage.setItem('simbot.llm',JSON.stringify({provider:'openai',model:'gpt-4.1-mini',apiKey:'',keepSimulationOpen:true})));
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click();
  await console.getByRole('button',{name:/수송 도착/}).click();
  await expect(simulation).toBeVisible();
  await console.getByRole('button',{name:'인형',exact:true}).click();
  await console.getByRole('button',{name:/1:1 대화 시작/}).click();
  const mirror=simulation.locator('.decision-mirror').getByRole('region',{name:'엔진 결정 카드'});
  await expect(mirror).toContainText('대화 중 · 시간 정지');
  await mirror.getByRole('button',{name:'대화를 마무리한다'}).click();
  // 대화 마무리는 40% 확률로 약속 요청 카드를 남긴다(7차) — 세션 카드가 걷혀 상태가 정착한 뒤에
  // 확인해야 요청 카드 렌더와의 레이스가 없다. 거절(무페널티)로 정리한 뒤 빈 상태를 확인.
  await expect(simulation.locator('.decision-mirror').getByRole('button',{name:'대화를 마무리한다'})).toHaveCount(0);
  const later=simulation.locator('.decision-mirror').getByRole('button',{name:'지금은 어렵다'});
  await expect(async()=>{if(await later.isVisible().catch(()=>false))await later.click();await expect(simulation.locator('.decision-mirror')).toHaveCount(0);}).toPass();
});

test('시설 카드는 하나씩 펼쳐 현재·다음 효과와 증설 버튼을 보여준다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  const cards=console.locator('.facility-grid article');
  await cards.first().locator('.facility-summary').click();
  await expect(cards.first()).toContainText('현재 효과');
  await expect(cards.first()).toContainText('다음 효과');
  await expect(cards.first().getByRole('button',{name:'시설 증설'})).toBeVisible();
  await cards.nth(1).locator('.facility-summary').click();
  await expect(cards.first().locator('.facility-detail')).toHaveCount(0);
  const noOverflow=await console.evaluate(element=>element.scrollWidth<=element.clientWidth+1);
  expect(noOverflow).toBe(true);
});

test('기지 근무 배치·불만도 게이지·가공 라인이 콘솔에서 작동한다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click();
  await console.getByRole('button',{name:/수송 도착/}).click();
  await console.getByRole('button',{name:'기지',exact:true}).click(); // 창 유지로 탭이 리셋되지 않는다
  await expect(console).toContainText('기지 불만도');
  await expect(console).toContainText('가공 라인');
  // 근무 배치 — 도착한 인형을 훈련 시설에 투입하면 기분 칩이 붙는다.
  await console.locator('.crew-card select').first().selectOption({index:1});
  await expect(console.locator('.crew-card .crew-chip').first()).toContainText('기분');
  // 가공 라인 — 부품 가공 시작이 대기열에 잡힌다.
  await console.getByRole('button',{name:/부품 가공/}).click();
  await expect(console.locator('.refinery-card article')).toContainText('부품 가공');
});

test('채팅 결정 카드에서 게이지·오토런을 직접 다룬다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'인형 고용',exact:true}).click();
  await console.getByRole('button',{name:'오늘의 인형 뽑기'}).click();
  await console.getByRole('button',{name:'계약',exact:true}).first().click();
  await console.getByRole('button',{name:/수송 도착/}).click();
  await console.getByRole('button',{name:'제대',exact:true}).click();
  await console.locator('.roster button').first().click();
  await console.getByRole('button',{name:'작전',exact:true}).click();
  await expect(console.getByRole('button',{name:'엔진 전용 · LLM 0회(기본)',exact:true})).toHaveClass(/active/);
  const chatMessagesBefore=await page.locator('.message').count();
  const modelMessagesBefore=await page.locator('.message .meta .model').count();
  await console.getByRole('button',{name:/레드·오렌지 작전구역/}).click();
  await console.getByRole('button',{name:/ALPHA/}).click();
  await console.locator('.mission-types button').filter({hasText:'소탕 임무'}).click();
  await console.getByRole('button',{name:'빠른 교전',exact:true}).click();
  // 관리창의 미러 카드에 게이지와 오토런이 뜨고, 한 번의 클릭이 정지 지점까지 여러 단계를 해소한다.
  const mirror=simulation.locator('.decision-mirror');
  await expect(mirror).toContainText('지휘 게이지 0/100');
  await mirror.getByRole('button',{name:'자동 진행 · 정지 지점까지'}).click();
  await expect(page.locator('.message').getByText(/자동 진행 · \d+단계/).first()).toBeVisible();
  // 오토런은 채팅에 메시지 2개(사용자 의도+서사)만 더한다 — 표시 병합으로 보이는 수는 그 이하일 수 있다.
  await expect.poll(async()=>page.locator('.message').count()).toBeLessThanOrEqual(chatMessagesBefore+2);
  await expect(page.locator('.message .meta .model')).toHaveCount(modelMessagesBefore);
});

test('누적 회차에서도 로컬 엔진 버튼의 화면 반영 p95가 100ms 안이다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'작전',exact:true}).click();
  const silent=console.getByRole('button',{name:'엔진 전용 · LLM 0회'}),auto=console.getByRole('button',{name:'자동 진행 + AI 서사'});
  for(let index=0;index<20;index+=1)await(index%2?silent:auto).click();
  const samples=await console.locator('.performance-diagnostics>details').allTextContents();
  const totals=samples.map(text=>Number(text.match(/합계 ([\d,.]+)ms/)?.[1]?.replaceAll(',','')??NaN)).filter(Number.isFinite).sort((a,b)=>a-b);
  expect(totals).toHaveLength(20);
  expect(totals[Math.ceil(totals.length*.95)-1],samples.join('\n')).toBeLessThanOrEqual(100);
});

test('사람처럼 1초씩 쉬어 눌러도 전체 저장이 다음 엔진 행동을 가로막지 않는다',async({page})=>{
  await page.setViewportSize({width:844,height:720});
  const simulation=await importGfl(page),console=simulation.getByLabel('소녀전선 지휘 콘솔');
  await console.getByRole('button',{name:'지휘관으로 시작'}).click();
  await console.getByRole('button',{name:'작전',exact:true}).click();
  const silent=console.getByRole('button',{name:'엔진 전용 · LLM 0회'}),auto=console.getByRole('button',{name:'자동 진행 + AI 서사'});
  for(let index=0;index<4;index+=1){await new Promise(resolve=>setTimeout(resolve,1_000));await(index%2?silent:auto).click();}
  const samples=(await console.locator('.performance-diagnostics>details').allTextContents()).slice(0,4),totals=samples.map(text=>Number(text.match(/합계 ([\d,.]+)ms/)?.[1]?.replaceAll(',','')??NaN));
  expect(totals.every(value=>Number.isFinite(value)&&value<=100),samples.join('\n')).toBe(true);
  await expect(console.locator('.performance-diagnostics>details').first()).toContainText('background-save-wait-complete');
  await expect(console.locator('.performance-diagnostics>details').first()).toContainText('wal-build-complete');
});
