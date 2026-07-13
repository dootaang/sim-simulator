import type { ParsedCard } from '@simbot/card';
import type { MinedCard } from './lua-mine.ts';
export const MAX_RULEBOOK_CHARS=200_000;
export interface CompilerCoverage{rulebookText:string;totalEntries:number;includedEntries:number;omittedEntries:number;omitted:Array<{name:string;chars:number}>;}
interface Row{name:string;content:string;constant:boolean;}
function cardData(card:ParsedCard){return card.card.data&&typeof card.card.data==='object'&&!Array.isArray(card.card.data)?card.card.data as Record<string,unknown>:card.card;}
export function collectRulebook(parsed:ParsedCard,mined:MinedCard):CompilerCoverage{
 const d=cardData(parsed),book=d.character_book&&typeof d.character_book==='object'?d.character_book as Record<string,unknown>:{},entries:Row[]=(Array.isArray(book.entries)?book.entries:[]).filter(e=>e&&typeof e==='object').map((e,i)=>{const row=e as Record<string,unknown>;return{name:String(row.name??row.comment??`entry-${i+1}`),content:String(row.content??''),constant:!!row.constant};}).filter(e=>e.content.trim());
 for(const m of parsed.modules??[])for(const[i,e]of (m.lorebook as unknown[]).entries())if(e&&typeof e==='object')entries.push({name:String((e as Record<string,unknown>).name??`module-${i+1}`),content:String((e as Record<string,unknown>).content??''),constant:!!(e as Record<string,unknown>).constant});
 const blocks=[`[정적 채굴값 — 숫자는 코드 소유]\n${JSON.stringify({tables:mined.tables,constants:mined.constants,defaultVariables:mined.defaultVars.numbers},null,2)}`,`[카드 설명]\n${String(d.description??'')}`],included=new Set<string>();let used=blocks.join('\n\n').length;
 for(const e of entries.sort((a,b)=>Number(b.constant)-Number(a.constant)||b.content.length-a.content.length)){const block=`### ${e.name}\n${e.content}`;if(used+block.length>MAX_RULEBOOK_CHARS)continue;blocks.push(block);included.add(e.name);used+=block.length;}
 return{rulebookText:blocks.join('\n\n').slice(0,MAX_RULEBOOK_CHARS),totalEntries:entries.length,includedEntries:included.size,omittedEntries:entries.length-included.size,omitted:entries.filter(e=>!included.has(e.name)).map(e=>({name:e.name,chars:e.content.length}))};
}
export function buildCompilerPrompt(parsed:ParsedCard,mined:MinedCard){const coverage=collectRulebook(parsed,mined);return{coverage,system:'당신은 RisuAI 카드 룰북을 결정론 엔진 JSON으로 번역하는 컴파일러다. 서사와 구조만 번역하고 숫자는 [정적 채굴값]을 우선한다. 설명이나 코드펜스 없이 JSON 객체 하나만 출력한다. 필수 필드: meta, resources, scales, ladders, entities, events, initialState. 장르에 따라 rewards, pools, combat, quests, processes, formulas를 추가한다. 없는 규칙은 지어내지 말고 _assumptions에 기록한다. 거래 품목은 entities.menuItem, 전투 소모 풀은 pools에 둔다.',user:coverage.rulebookText};}
