import {genreTemplates} from '@simbot/modules';

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
  for(const template of genreTemplates())if(moduleIds.includes(template.id))template.synthesize?.(schema,issues);
  return{schema,issues};
}

export function validateCompiledSemantics(schema:Row,moduleIds:string[]):CompileIssue[]{
  const issues:CompileIssue[]=[];
  const error=(path:string,message:string)=>issues.push({level:'error',path,message,source:'normalizer'});
  const resources=list<Row>(schema.resources),entities=list<Row>(schema.entities);
  resources.forEach((row,index)=>{if(!text(row?.id))error(`resources[${index}].id`,'자원 id가 필요합니다.');});
  entities.forEach((row,index)=>{
    if(!text(row?.type))error(`entities[${index}].type`,'엔티티 type이 필요합니다.');
    if(!Array.isArray(row?.instances))error(`entities[${index}].instances`,'엔티티 instances 배열이 필요합니다.');
  });
  if(!object(schema.initialState))error('initialState','초기 상태 객체가 필요합니다.');
  if(moduleIds.includes('genre.inn')){
    if(!resources.length)error('resources','여관 운영에 사용할 자원이 하나 이상 필요합니다.');
    if(!instances(schema,'facility').length)error('entities.facility','여관 시설이 하나 이상 필요합니다.');
    if(!instances(schema,'room').length)error('entities.room','숙박에 사용할 객실이 하나 이상 필요합니다.');
    if(!instances(schema,'menuItem').length)error('entities.menuItem','영업에 사용할 메뉴가 하나 이상 필요합니다.');
    if(!object(schema.traffic))error('traffic','영업·숙박 규칙을 구성할 수 없습니다. 시설, 객실, 메뉴를 보완하세요.');
  }
  return issues;
}
