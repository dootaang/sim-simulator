export interface CompileIssue { level:'warn'|'error'; path:string; message:string; source:'model'|'normalizer'|'template' }
type Row=Record<string,unknown>;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const list=<T=unknown>(value:unknown):T[]=>Array.isArray(value)?value as T[]:[];
const text=(value:unknown)=>typeof value==='string'?value:'';
const number=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

function collection(schema:Row,key:string,identity:string,issues:CompileIssue[]){
  const value=schema[key];
  if(Array.isArray(value))return;
  if(object(value)){
    schema[key]=Object.entries(value).map(([id,item])=>object(item)?{...(identity in item?{}:{[identity]:id}),...item}:{[identity]:id,value:item});
    issues.push({level:'warn',path:key,message:'객체 맵을 표준 배열로 변환했습니다.',source:'normalizer'});
  }
}
function entityBlock(schema:Row,type:string){return list<Row>(schema.entities).find(value=>value?.type===type);}
function instances(schema:Row,type:string){return list<Row>(entityBlock(schema,type)?.instances);}

function normalizeEntities(schema:Row,issues:CompileIssue[]){
  collection(schema,'entities','type',issues);
  for(const [index,raw] of list<Row>(schema.entities).entries()){
    if(!object(raw))continue;
    if(!Array.isArray(raw.fields))raw.fields=[];
    if(object(raw.instances)){
      const identity=raw.type==='room'?'no':raw.type==='menuItem'?'name':'id';
      raw.instances=Object.entries(raw.instances).map(([id,item])=>object(item)?{...(identity in item?{}:{[identity]:id}),...item}:{[identity]:id,value:item});
      issues.push({level:'warn',path:`entities[${index}].instances`,message:'엔티티 맵을 instances 배열로 변환했습니다.',source:'normalizer'});
    }
    if(!Array.isArray(raw.instances))continue;
    const fields=new Set((raw.fields as unknown[]).map(String));
    for(const item of raw.instances)if(object(item))for(const key of Object.keys(item))fields.add(key);
    raw.fields=[...fields];
  }
}

function normalizeFacilityIds(schema:Row,issues:CompileIssue[]){
  const rows=instances(schema,'facility'),renames:Record<string,string>={};
  for(const row of rows){const id=text(row.id),match=/^lv_(.+)$/.exec(id);if(match&&!rows.some(other=>other!==row&&other.id===match[1])){renames[id]=match[1]!;row.id=match[1];}}
  if(!Object.keys(renames).length)return;
  const facilities=object((schema.initialState as Row|undefined)?.facilities)?(schema.initialState as Row).facilities as Row:null;
  if(facilities)for(const [from,to] of Object.entries(renames))if(from in facilities){facilities[to]=facilities[from];delete facilities[from];}
  for(const row of rows)if(object(row.upgradeCosts))row.upgradeCosts=Object.fromEntries(Object.entries(row.upgradeCosts).filter(([level,cost])=>number(level)>1&&number(cost)>0).map(([level,cost])=>[level,Math.trunc(number(cost))]));
  issues.push({level:'warn',path:'entities.facility',message:`시설 ID를 정규화했습니다: ${Object.entries(renames).map(([a,b])=>`${a}→${b}`).join(', ')}`,source:'normalizer'});
}

function normalizeResourcesAndMenus(schema:Row,issues:CompileIssue[]){
  collection(schema,'resources','id',issues);
  const labels:Record<string,string>={gold:'골드',food:'식자재',drink:'주류',material:'재료'};
  for(const row of list<Row>(schema.resources))if(object(row)){if(!row.label&&labels[text(row.id)])row.label=labels[text(row.id)];if(row.min==null)row.min=0;if(!row.unit)row.unit=row.id==='food'?'인분':row.id==='drink'?'잔':row.id==='gold'?'원':'개';}
  const resourceIds=new Set(list<Row>(schema.resources).map(row=>text(row.id)));
  for(const [index,item] of instances(schema,'menuItem').entries()){
    if(!item.trade)item.trade=/구매|도매|buy/i.test(`${item.category??''} ${item.name??''}`)?'buy':'sell';
    if(item.trade==='sell'&&!object(item.consumes)){
      const category=`${item.category??''}`;
      if(/drink|liquor|주류|술/i.test(category)&&resourceIds.has('drink'))item.consumes={drink:1};
      else if(/special|material|특수|재료/i.test(category)&&resourceIds.has('material'))item.consumes={material:1};
      else if(resourceIds.has('food'))item.consumes={food:1};
      if(item.consumes)issues.push({level:'warn',path:`entities.menuItem.instances[${index}].consumes`,message:'카테고리에서 기본 원가 자원을 연결했습니다.',source:'normalizer'});
    }
  }
}

function normalizeInitialState(schema:Row){
  if(!object(schema.initialState))return;
  const state=schema.initialState;
  if(state.day==null)state.day=1;
  if(state.gold==null)state.gold=0;
  for(const key of ['resources','facilities','rooms','npcs','reputation','items'])if(!object(state[key]))state[key]={};
  if(!Array.isArray(state.staff))state.staff=[];
  if(!object(state.player))state.player={};
}

function synthesizeInn(schema:Row,issues:CompileIssue[]){
  const facilities=instances(schema,'facility'),rooms=instances(schema,'room'),menus=instances(schema,'menuItem'),npcs=instances(schema,'npc');
  const findFacility=(pattern:RegExp)=>facilities.find(value=>pattern.test(`${value.id??''} ${value.label??''}`));
  const tavern=findFacility(/tavern|hall|주점|홀/i),kitchen=findFacility(/kitchen|주방/i),room=findFacility(/^room$|객실/i),quarter=findFacility(/quarter|직원.*숙소|기숙/i);
  if(quarter&&!object(schema.staffing)){
    const max=Math.max(1,Math.trunc(number(quarter.maxLevel,1))),capacityByLevel:Row={};
    for(let level=1;level<=max;level++)capacityByLevel[String(level)]=level;
    schema.staffing={facility:quarter.id,capacityByLevel};
    issues.push({level:'warn',path:'staffing',message:'직원 숙소를 고용 정원에 연결했습니다.',source:'template'});
  }
  if(list<Row>(schema.quests).length&&!object(schema.questBoard)&&tavern){schema.questBoard={facility:tavern.id,unlockLevel:2,size:3,refresh:'daily'};issues.push({level:'warn',path:'questBoard',message:'의뢰 게시판을 주점 2레벨에 연결했습니다.',source:'template'});}
  if(!object(schema.traffic)&&menus.length&&rooms.length&&facilities.length){
    const axes=list<string>(list<Row>(schema.ladders).find(value=>value.id==='reputation')?.axes),village=axes.find(id=>/village|마을/i.test(id))??axes[0];
    const modifiers:Row[]=[{type:'staff',perStaff:.08,max:.32}];
    if(village)modifiers.unshift({type:'ladder_rank',ladder:'reputation',axis:village,multipliers:{E:.6,D:.75,C:.9,B:1,A:1.15,S:1.3}});
    schema.traffic={id:'auto_service',capacityFacility:tavern?.id??facilities[0]?.id,base:[[3,6],[6,12],[10,20],[16,30]],capacity:[8,16,28,45],waves:[{id:'lunch',label:'점심 영업',share:.4},{id:'evening',label:'저녁 영업',share:.6}],modifiers,sells:{entity:'menuItem'},...(kitchen?{kitchenFacility:kitchen.id}:{}),lodging:{roomsEntity:'room',...(room?{roomFacility:room.id}:{}),base:[[1,2],[1,3],[2,4],[3,6]],segments:[{id:'traveler',label:'여행자',weight:4,party:[1,2],stay:{'1':.6,'2':.3,'3':.1}},{id:'adventurer',label:'모험가 일행',weight:3,party:[2,4],stay:{'1':.4,'2':.4,'3':.2}},{id:'merchant',label:'상인',weight:2,party:[1,2],stay:{'2':.5,'3':.3,'5':.2}}]},incidents:{chance:35,deck:[{id:'drunk_brawl',label:'진상 취객',desc:'만취한 손님이 홀에서 행패를 부린다.',weight:4,choices:[{id:'subdue',label:'직접 제압한다',effects:{waveMultiplier:.9}},{id:'appease',label:'술값을 물어 달랜다',effects:{gold:[-15000,-5000]}},{id:'ignore',label:'방치한다',effects:{waveMultiplier:.7}}]},{id:'petty_thief',label:'좀도둑',desc:'손님 하나가 계산대 근처를 서성인다.',weight:3,choices:[{id:'chase',label:'쫓아가 붙잡는다',effects:{gold:[-5000,25000]}},{id:'guard',label:'계산대만 지킨다',effects:{waveMultiplier:.95}}]},{id:'kitchen_fire',label:'주방 사고',desc:'주방에서 사고가 발생한다.',weight:2,choices:[{id:'repair',label:'즉시 수리한다',effects:{gold:[-30000,-10000]}},{id:'endure',label:'임시로 버틴다',effects:{resources:{food:-2},waveMultiplier:.85}}]}]}};
    issues.push({level:'warn',path:'traffic',message:'메뉴·객실·시설을 근거로 기본 영업·숙박·사건 모듈을 구성했습니다.',source:'template'});
  }
  if(object(schema.initialState)){
    const state=schema.initialState,facilityState=state.facilities as Row,npcState=state.npcs as Row;
    for(const value of facilities)if(text(value.id)&&facilityState[text(value.id)]==null)facilityState[text(value.id)]=1;
    for(const value of npcs)if(text(value.id)&&!object(npcState[text(value.id)]))npcState[text(value.id)]={};
  }
}

function normalizeQuestsAndCombat(schema:Row,issues:CompileIssue[]){
  if(object(schema.quests)){schema.quests=Object.entries(schema.quests).map(([id,value])=>object(value)?{id,...value}:{id});issues.push({level:'warn',path:'quests',message:'퀘스트 맵을 배열로 변환했습니다.',source:'normalizer'});}
  const hasCombat=object(schema.combat)||Array.isArray(schema.pools);
  if(hasCombat&&!object(schema.encounters)){schema.encounters={pool:[{id:'goblin_pack',name:'고블린 무리',rank:'E',count:[2,3]},{id:'wild_wolf',name:'들개 떼',rank:'E',count:[1,2]},{id:'bandit',name:'산적',rank:'D',count:[1,2]}]};issues.push({level:'warn',path:'encounters',message:'전투 규칙에 기본 조우 풀을 연결했습니다.',source:'template'});}
  for(const quest of list<Row>(schema.quests))if(quest.encounterChance==null&&hasCombat)quest.encounterChance=['E','D'].includes(text(quest.rewardTier))?15:25;
}

export function normalizeCompiledSchema(input:Row,moduleIds:string[]){
  const schema=structuredClone(object(input.schema)&&Object.keys(input).length<=4?input.schema as Row:input),issues:CompileIssue[]=[];
  collection(schema,'scales','id',issues);collection(schema,'ladders','id',issues);collection(schema,'events','id',issues);collection(schema,'pools','id',issues);
  normalizeEntities(schema,issues);normalizeResourcesAndMenus(schema,issues);normalizeFacilityIds(schema,issues);normalizeInitialState(schema);normalizeQuestsAndCombat(schema,issues);
  if(moduleIds.includes('genre.inn'))synthesizeInn(schema,issues);
  return{schema,issues};
}
