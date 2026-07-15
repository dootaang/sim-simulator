type Row=Record<string,unknown>;
type GenreTemplateIssue={level:string;path:string;message:string;source?:string};

export interface GenreTemplate{
  id:string;
  detect(source:string):boolean;
  excludes?:string[];
  synthesize?(schema:Record<string,unknown>,issues:Array<{level:string;path:string;message:string}>):void;
}

const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const list=<T=unknown>(value:unknown):T[]=>Array.isArray(value)?value as T[]:[];
const text=(value:unknown)=>typeof value==='string'?value:'';
const number=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
function entityBlock(schema:Row,type:string){return list<Row>(schema.entities).find(value=>value?.type===type);}
function instances(schema:Row,type:string){return list<Row>(entityBlock(schema,type)?.instances);}

function synthesizeInn(schema:Row,issues:GenreTemplateIssue[]){
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

const hunterSignatures=[/alternate hunters/i,/헌터/,/게이트/,/각성자/,/hunter[_ -]?rank/i,/던전.{0,6}(공략|입장)/];

export function genreTemplates():GenreTemplate[]{
  return[
    {
      id:'genre.inn',
      detect(source){return/ysp_checkin|ysp_checkout|\btraffic_wave\b|\bcheckin\b|\bcheckout\b|\blodging\b/i.test(source)||(/객실|숙박|투숙/.test(source)&&/체크인|체크아웃/.test(source));},
      excludes:['rpg.quests'],
      synthesize:synthesizeInn,
    },
    {
      id:'genre.hunter',
      detect(source){return hunterSignatures.filter(pattern=>pattern.test(source)).length>=2;},
    },
  ];
}
