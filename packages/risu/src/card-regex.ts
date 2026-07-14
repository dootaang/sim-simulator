// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from LogPapa core/convert/cardRegex.js (extractRegexScripts,
// sanitizeRegexOut, isCatastrophic, buildRegex), itself compatible with
// RisuAI regex hooks. See THIRD_PARTY_NOTICES.md.
// ADR 0004: 실행 의미론은 RisuAI 전체 이식(port/scripts.ts)에 위임하고,
// 이 파일은 추출·정화·예산·façade만 담당한다.
import { processScriptsCore, type RisuScriptEnv } from './port/scripts.ts';
export type { RisuScriptEnv } from './port/scripts.ts';
export type CardRegexStage='display'|'output'|'process'|'input';
type RegexStage=CardRegexStage;
export interface RegexScript{in:string;out:string;type:string;flag?:string;flags?:string;comment?:string;}

const stageTypes:Record<CardRegexStage,Set<string>>={
  display:new Set(['editdisplay','edit_display','display']),
  output:new Set(['editoutput','edit_output','output']),
  process:new Set(['editprocess','edit_process','process','editrequest','edit_request','request']),
  input:new Set(['editinput','edit_input','input'])
};
const MAX_SCRIPTS=200,MAX_MATCHES=1000,MAX_TEXT=1_000_000,MAX_MS=25;
let activeScripts:readonly RegexScript[]=[],activeVariables:Record<string,string>={};
export function setActiveRenderContext(scripts:readonly RegexScript[],variables:Record<string,string>){activeScripts=scripts;activeVariables=variables;}
export function activeRenderContext(){return{scripts:activeScripts,variables:activeVariables};}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function sanitizeRegexOut(out:string){return String(out).replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi,'').replace(/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base)\b[^>]*>/gi,'').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript:/gi,'');}
export function isCatastrophic(pattern:string){return /\([^()]*[+*][^()]*\)[+*{]/.test(pattern);}
export function buildRegex(input:string,hint=''){let pattern=input,flags=hint;const match=/^\/([\s\S]*)\/([gimsuy]*)$/.exec(input);if(match){pattern=match[1]!;flags=match[2]||flags;}if(!flags.includes('g'))flags+='g';return new RegExp(pattern,flags);}
export function extractRegexScripts(parsed:unknown):RegexScript[]{const root=record(parsed),found:RegexScript[]=[],seen=new Set<unknown>();const push=(value:unknown)=>{if(!Array.isArray(value)||seen.has(value))return;seen.add(value);for(const entry of value){const item=record(entry);if(typeof item.in==='string'&&typeof item.out==='string')found.push({in:item.in,out:sanitizeRegexOut(item.out),type:String(item.type??'editdisplay'),flag:String(item.flag??item.flags??''),comment:String(item.comment??'')});}};const card=record(root.card),data=record(card.data??card),risu=record(record(data.extensions).risuai);push(root.presetRegex);push(root.regex);push(root.regexScript);push(root.customScripts);push(root.customscript);push(risu.customScripts);push(risu.customscript);push(risu.regexScript);push(risu.regex);push(record(root.module).regex);push(record(root.module).regexScript);push(record(card.module).regex);for(const module of Array.isArray(root.modules)?root.modules:[]){const value=record(module);push(value.regex);push(value.regexScript);push(value.customScripts);push(record(value.raw).regex);push(record(value.raw).regexScript);}return found;}
export function mergeRegexScripts(...sources:readonly (readonly RegexScript[])[]){const output:RegexScript[]=[],seen=new Set<string>();for(const scripts of sources)for(const script of scripts){const key=`${script.type}\u0001${script.in}\u0001${script.out}\u0001${script.flag??script.flags??''}`;if(seen.has(key))continue;seen.add(key);output.push({...script});}return output;}
// ADR 0004: 실행 본체는 업스트림 전체 이식(port/scripts.ts). 이 façade는 우리 강화만 담당 —
// 단계 별칭 정규화, /패턴/flags 리터럴 지원(로그파파 유산), 스크립트 수·본문 길이·시간 예산,
// catastrophic 패턴 스킵, out의 위험 태그 정화. env(선택)로 CBS parser·@@emo 등 훅을 주입한다.
export function applyRegexScripts(text:string,scripts:readonly RegexScript[],stage:RegexStage,env:RisuScriptEnv={}){if(!text||!scripts.length||text.length>MAX_TEXT)return text;const started=Date.now();
 const mode=({display:'editdisplay',output:'editoutput',process:'editprocess',input:'editinput'} as const)[stage];
 const staged=scripts.slice(0,MAX_SCRIPTS).filter((script)=>script&&stageTypes[stage].has(String(script.type||'editdisplay').toLowerCase())).map((script)=>{let input=String(script.in??''),flag=String(script.flag??script.flags??'');const literal=/^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(input);if(literal){input=literal[1]!;flag=literal[2]||flag;}return{in:input,out:sanitizeRegexOut(String(script.out??'')),type:mode,flag,ableFlag:flag!==''};});
 if(!staged.length)return text;
 try{return processScriptsCore(text,staged,mode,{...env,skipScript:(source)=>isCatastrophic(source)||!!env.skipScript?.(source),outOfBudget:()=>Date.now()-started>MAX_MS||!!env.outOfBudget?.()}).data;}catch{return text;}}
