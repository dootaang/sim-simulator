import { tagCompatibilityGrades } from './ysp-translate.ts';

interface ParsedCard { name:string; card:Record<string,unknown>; assets?:Array<{name?:string;type?:string;mime?:string}>; embeddedModules?:string[]; modules?:Array<{name?:string;regex?:unknown[];lorebook?:unknown[];defaultVariables?:string|Record<string,string>;raw?:Record<string,unknown>}>; sourceBytes?:Uint8Array; }
interface RuntimeProject { projectId:string; schema:Record<string,unknown>; screens:Record<string,unknown>[]; navigation:Record<string,unknown>[]; content:Record<string,unknown>; featureToggles:Record<string,unknown>; moduleIds?:string[]; }
export interface CardCompileArtifact {schema:Record<string,unknown>;moduleIds:string[];screens?:Record<string,unknown>[];navigation?:Record<string,unknown>[];}

export interface CardPassport {
  mode: 'full-sim' | 'chat';
  grades: { exact: string[]; approx: string[]; preserved: string[] };
  cardName: string;
  runtime?:{kind:'embedded-risu-program';luaChars:number;defaultVariableChars:number;regexScripts:number;triggerScripts:number;htmlChars:number;assets:number;lowLevelAccess:boolean;directExecution:false};
}

export interface CardRuntimeProfile {
  project: RuntimeProject;
  passport: CardPassport;
  card: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    systemPrompt: string;
    postHistoryInstructions: string;
    regexScripts: import('./card-regex.ts').RegexScript[];
  };
  firstMessage: string;
  greetings: string[];
  regexScripts: import('./card-regex.ts').RegexScript[];
  defaultVariables: Record<string,string>;
  backgroundHtml:string;
}

export function cardToRuntimeProject(parsed: ParsedCard, compiled?:CardCompileArtifact|null): CardRuntimeProfile {
  const root=parsed.card as Record<string,unknown>;
  const nested=root.data;
  const data=nested&&typeof nested==='object'&&!Array.isArray(nested)?nested as Record<string,unknown>:root;
  const characterBook=data.character_book;
  const book=characterBook&&typeof characterBook==='object'&&!Array.isArray(characterBook)?characterBook as Record<string,unknown>:{};
  const loreEntries=Array.isArray(book.entries)?book.entries.filter((entry):entry is Record<string,unknown>=>Boolean(entry)&&typeof entry==='object'&&!Array.isArray(entry)):[],lorebooks=[...loreEntries.map(entry=>({...entry,_luckySourceScope:'character',_luckySourceNamespace:'character',_luckySourceRank:2,_luckyBook:{scan_depth:book.scan_depth,token_budget:book.token_budget,recursive_scanning:book.recursive_scanning}})),...(parsed.modules??[]).flatMap((module,moduleIndex)=>(module.lorebook??[]).filter((entry):entry is Record<string,unknown>=>Boolean(entry)&&typeof entry==='object'&&!Array.isArray(entry)).map(entry=>({...entry,_luckySourceScope:'module',_luckySourceNamespace:String(module.raw?.namespace??module.raw?.name??`module-${moduleIndex}`),_luckySourceRank:4,_luckyBook:{scan_depth:module.raw?.scan_depth,token_budget:module.raw?.token_budget,recursive_scanning:module.raw?.recursive_scanning}})))];
  const textPool=[data.description,data.first_mes,data.system_prompt,data.post_history_instructions,...loreEntries.map((entry)=>entry.content),...(parsed.embeddedModules??[])].map(text).filter(Boolean).join('\n');
  const grades=tagCompatibilityGrades(textPool);
  const fixtureInn=!('format'in parsed)&&grades.exact.length+grades.approx.length+grades.preserved.length>0;
  const cardName=text(data.name)||parsed.name||'Imported card';
  const regexScripts=extractRegexScripts(parsed),risuExtension=(data.extensions&&typeof data.extensions==='object'?((data.extensions as Record<string,unknown>).risuai):null),risu=risuExtension&&typeof risuExtension==='object'?risuExtension as Record<string,unknown>:null,defaultVariables={...variableMap(risu?.defaultVariables??data.defaultVariables??data.default_variables)},backgroundHtml=[text(risu?.backgroundHTML),...(parsed.modules??[]).map(module=>text(module.raw?.backgroundEmbedding))].filter(Boolean).join('\n');
  for(const module of parsed.modules??[])Object.assign(defaultVariables,variableMap(module.defaultVariables??module.raw?.defaultVariables??module.raw?.default_variables));
  const activeModules=[...new Set((parsed.modules??[]).flatMap((module,index)=>[module.raw?.id,module.raw?.namespace,module.raw?.name,module.name,parsed.embeddedModules?.[index]].map(text).filter(Boolean)))],assetCommands=[...new Set((parsed.assets??[]).filter(asset=>String(asset.mime??'').startsWith('image/')).map(asset=>text(asset.name??asset.type).replace(/[_-]\d+$/,'')).filter(Boolean))];
  const content={characters:[{id:'primary',name:cardName,description:text(data.description),personality:text(data.personality),scenario:text(data.scenario)}],lorebooks,activeModules,assetCommands};
  const project:RuntimeProject={
    // 이름 슬러그만 쓰면 동명 카드 2장이 라이브러리·채팅을 서로 덮어쓴다(감사 #8) — 원본 바이트 해시로 유일화.
    projectId:`card:${slug(cardName)}:${hashBytes(parsed.sourceBytes??new TextEncoder().encode(cardName))}`,
    schema:compiled?.schema??(fixtureInn?innFixtureSchema():{initialState:{day:1}}),
    screens:compiled?.screens??[{id:'play',title:'플레이',layout:'stage-chat-sidebar',regions:{main:[{widget:'chat'}]}}],
    navigation:compiled?.navigation??[{id:'play',screenId:'play',label:'플레이'}],
    content,featureToggles:{},moduleIds:compiled?.moduleIds??(fixtureInn?['genre.inn']:[])
  };
  return {
    project,
    passport:{mode:compiled||fixtureInn?'full-sim':'chat',grades,cardName,...(risu&&embeddedProgram(risu,parsed.assets?.length??0)?{runtime:embeddedProgram(risu,parsed.assets?.length??0)!}:{})},
    card:{name:cardName,description:text(data.description),personality:text(data.personality),scenario:text(data.scenario),systemPrompt:text(data.system_prompt),postHistoryInstructions:text(data.post_history_instructions),regexScripts},
    firstMessage:text(data.first_mes),
    greetings:[text(data.first_mes),...(Array.isArray(data.alternate_greetings)?data.alternate_greetings.map(text):[])].filter(Boolean),
    regexScripts,defaultVariables,backgroundHtml
  };
}

import {extractRegexScripts} from './card-regex.ts';
function innFixtureSchema():Record<string,unknown>{return{initialState:{day:1,gold:1_000_000,resources:{food:200,drink:200},facilities:{quarter:1,tavern:1,room:1,kitchen:1},staff:[],player:{}}};}
function variableMap(value:unknown):Record<string,string>{
  if(typeof value==='string')return Object.fromEntries(value.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');return at<0?[line,'']:[line.slice(0,at).trim(),line.slice(at+1).trim()];}).filter(([key])=>key));
  if(!value||typeof value!=='object'||Array.isArray(value))return{};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,String(item??'')]));
}

function hashBytes(bytes:Uint8Array):string{let h=2166136261;for(let i=0;i<bytes.length;i+=1){h^=bytes[i]!;h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
function text(value:unknown):string{return typeof value==='string'?value:'';}
function slug(value:string):string{return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-+|-+$/g,'')||'card';}
function embeddedProgram(risu:Record<string,unknown>,assets:number):NonNullable<CardPassport['runtime']>|null{
  const triggerSource=risu.triggerscript??risu.triggerScript,scriptSource=risu.customScripts??risu.customscript,triggers:unknown[]=Array.isArray(triggerSource)?triggerSource:[],scripts:unknown[]=Array.isArray(scriptSource)?scriptSource:[],lua=triggers.flatMap(trigger=>{const item=trigger&&typeof trigger==='object'?trigger as Record<string,unknown>:{};return Array.isArray(item.effect)?item.effect:[];}).reduce((sum,effect)=>sum+text(effect&&typeof effect==='object'?(effect as Record<string,unknown>).code:'').length,0),defaults=risu.defaultVariables??risu.default_variables,defaultVariableChars=typeof defaults==='string'?defaults.length:defaults&&typeof defaults==='object'&&!Array.isArray(defaults)?JSON.stringify(defaults).length:0,htmlChars=text(risu.backgroundHTML).length;
  if(!lua&&!scripts.length&&!defaultVariableChars&&!htmlChars)return null;
  return{kind:'embedded-risu-program',luaChars:lua,defaultVariableChars,regexScripts:scripts.length,triggerScripts:triggers.length,htmlChars,assets,lowLevelAccess:risu.lowLevelAccess===true,directExecution:false};
}
