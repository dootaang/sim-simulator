import type { ParsedCard } from '@simbot/card';
import type { MinedCard } from './lua-mine.ts';

export const MAX_RULEBOOK_CHARS = 200_000;
export interface CompilerCoverage { rulebookText:string; totalEntries:number; includedEntries:number; omittedEntries:number; omitted:Array<{name:string;chars:number}> }
interface Row { name:string; content:string; constant:boolean }

const SHAPE = `{
  "meta":{"id":"kebab-id","title":"카드명","schemaVersion":"0.1"},
  "resources":[{"id":"gold|food|drink|material","label":"표시명","unit":"단위","min":0,"basePrice":3000}],
  "scales":[{"id":"affinity","owner":"npc|player","range":[0,200],"default":50,"steps":{"S":2,"M":5,"L":10,"XL":20,"S-":-2,"M-":-5,"L-":-10,"XL-":-20},"tiers":[{"range":[0,49],"label":"경계","brief":"짧은 태도 규범","forbidden":[]}]}],
  "ladders":[{"id":"reputation","axes":["village"],"ranks":[{"id":"E","next":100},{"id":"S","next":null}],"categories":{}}],
  "entities":[
    {"type":"room","fields":["no","kind","pricePerNight","capacity","requiresRoomLevel"],"instances":[{"no":"101","kind":"single","pricePerNight":30000,"capacity":1,"requiresRoomLevel":1}]},
    {"type":"menuItem","fields":["name","category","price","requiresKitchenLevel","consumes"],"instances":[{"name":"삶은 달걀","category":"food","price":5000,"requiresKitchenLevel":1,"consumes":{"food":1},"trade":"sell"}]},
    {"type":"npc","fields":["id","nameKo","nameEn","class","group"],"instances":[]},
    {"type":"facility","fields":["id","label","maxLevel","upgradeCosts"],"instances":[]}
  ],
  "events":[{"id":"gold_delta","params":{"amount":"integer"}}],
  "initialState":{"day":1,"gold":0,"resources":{},"facilities":{},"staff":[],"rooms":{},"npcs":{},"player":{}},
  "_assumptions":[]
}`;

const SYSTEM = `당신은 RisuAI 시뮬레이션 카드의 룰북을 결정론 게임 엔진 스키마로 번역하는 컴파일러다.
LLM은 규칙의 구조와 의미만 번역한다. 숫자는 [정적 채굴값]이 최우선이며 임의로 부풀리지 않는다.
반드시 설명, 마크다운, 코드펜스 없이 JSON 객체 하나만 출력한다.

[필수 출력 모양]
${SHAPE}

[절대 규칙]
1. resources, scales, ladders, entities, events는 값이 없어도 반드시 JSON 배열([])이다. 객체로 출력하지 않는다.
2. initialState는 반드시 객체다. 각 entity 블록은 type, fields 배열, instances 배열을 가진다.
3. 룰북에 없는 값은 지어내지 말고 생략하거나 _assumptions에 출처와 사유를 쓴다.
4. 거래 품목은 entities의 menuItem에 넣고 판매는 trade:"sell", 구매는 trade:"buy"로 구분한다. 판매품은 consumes를 반드시 둔다.
5. 객실, NPC, 시설, 메뉴, 장비처럼 반복되는 항목은 하나도 합쳐 쓰지 말고 instances에 개별 항목으로 옮긴다.
6. 관계 수치와 티어 규범은 scales, 누적 문턱과 등급은 ladders에 둔다.
7. 퀘스트는 quests 배열에 {id,name,check,rewardTier,repeatable?,requires?,encounterChance?}로 둔다.
8. 보상표는 rewards.gold의 등급별 [min,max], 시설 증축비는 facility.upgradeCosts에 둔다.
9. 전투가 있으면 pools 배열, combat 객체, skills 객체, encounters.pool을 추가한다.
10. 여관 영업 규칙이 있으면 traffic 객체에 waves, capacity/base, lodging, incidents, mail을 둔다. 실제 선택지는 incidents.deck[].choices만이 권위 있다.
11. 정산은 settlement 배열, 제작/과정 규칙은 processes 또는 recipes에 둔다.
12. Lua 코드 자체나 실행 가능한 스크립트는 출력하지 않는다.`;

function cardData(card:ParsedCard) {
  return card.card.data && typeof card.card.data === 'object' && !Array.isArray(card.card.data)
    ? card.card.data as Record<string,unknown> : card.card;
}

export function collectRulebook(parsed:ParsedCard,mined:MinedCard):CompilerCoverage {
  const data=cardData(parsed),book=data.character_book&&typeof data.character_book==='object'?data.character_book as Record<string,unknown>:{},entries:Row[]=[];
  for(const [index,value] of (Array.isArray(book.entries)?book.entries:[]).entries()){
    if(!value||typeof value!=='object')continue;
    const row=value as Record<string,unknown>,content=String(row.content??'');
    if(content.trim())entries.push({name:String(row.name??row.comment??`entry-${index+1}`),content,constant:!!row.constant});
  }
  for(const module of parsed.modules??[])for(const [index,value] of module.lorebook.entries()){
    if(!value||typeof value!=='object')continue;
    const row=value as Record<string,unknown>,content=String(row.content??'');
    if(content.trim())entries.push({name:String(row.name??`module-${index+1}`),content,constant:!!row.constant});
  }
  const blocks=[`[정적 채굴값 — 숫자는 코드 소유]\n${JSON.stringify({tables:mined.tables,constants:mined.constants,defaultVariables:mined.defaultVars.numbers},null,2)}`,`[카드 설명]\n${String(data.description??'')}`],included=new Set<string>();
  let used=blocks.join('\n\n').length;
  for(const entry of entries.sort((a,b)=>Number(b.constant)-Number(a.constant)||b.content.length-a.content.length)){
    const block=`### ${entry.name}\n${entry.content}`;
    if(used+block.length>MAX_RULEBOOK_CHARS)continue;
    blocks.push(block);included.add(entry.name);used+=block.length;
  }
  return{rulebookText:blocks.join('\n\n').slice(0,MAX_RULEBOOK_CHARS),totalEntries:entries.length,includedEntries:included.size,omittedEntries:entries.length-included.size,omitted:entries.filter(entry=>!included.has(entry.name)).map(entry=>({name:entry.name,chars:entry.content.length}))};
}

export function buildCompilerPrompt(parsed:ParsedCard,mined:MinedCard){const coverage=collectRulebook(parsed,mined);return{coverage,system:SYSTEM,user:`아래 룰북을 위 스키마 모양으로 컴파일하라.\n\n${coverage.rulebookText}`};}
export function buildRepairPrompt(raw:string,issues:string[]){return`${SYSTEM}\n\n이전 출력은 JSON 문법은 맞지만 스키마 검증에 실패했다. 오류를 전부 고쳐 완전한 JSON 객체를 다시 출력하라.\n[검증 오류]\n${issues.map(value=>`- ${value}`).join('\n')}\n[이전 출력]\n${raw}`;}
