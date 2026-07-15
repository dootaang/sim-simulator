import type { ParsedCard } from '@simbot/card';
import { inspectGameRuntimeSchema } from '@simbot/contracts';
import { genreTemplates,screenPresetsFor } from '@simbot/modules';
import type { ModelProvider } from '@simbot/session';
import { createSimPack, sha256Hex, type SimPackProject } from '@simbot/simpack';
import { buildCompilerPrompt,buildRepairPrompt } from './compiler-prompt.ts';
import { diagnoseCard } from './diagnosis.ts';
import { mineCard } from './lua-mine.ts';
import { patchSchemaWithMined, type SchemaPatch, type UnmatchedMinedValue } from './schema-patch.ts';
import { normalizeCompiledSchema,validateCompiledSemantics,type CompileIssue } from './schema-normalize.ts';
export * from './compiler-prompt.ts';export * from './diagnosis.ts';export * from './lua-mine.ts';export * from './schema-patch.ts';export * from './schema-normalize.ts';

export interface CompileAttempt{attempt:number;raw:string;issues:string[];}
export interface CompileResult{compilerVersion:'0.2';schema:Record<string,unknown>;moduleIds:string[];screens:Record<string,unknown>[];navigation:Record<string,unknown>[];patches:SchemaPatch[];unmatchedMinedValues:UnmatchedMinedValue[];issues:CompileIssue[];warnings:string[];attempts:CompileAttempt[];diagnosis:ReturnType<typeof diagnoseCard>;rulebookUsed:string;}
export interface CompileCardOptions{parsed:ParsedCard;provider:ModelProvider;signal?:AbortSignal;}
function parseOutput(text:string){const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const start=clean.indexOf('{'),end=clean.lastIndexOf('}');if(start<0||end<=start)throw new Error('compiler_json_invalid');const value=JSON.parse(clean.slice(start,end+1)) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('compiler_schema_invalid');return value as Record<string,unknown>;}
const KNOWN_MODULES=new Set(['core.stats','core.inventory','core.equipment','core.progression','core.jobs','core.location','core.time','core.factions','rpg.quests','rpg.shop','rpg.crafting','rpg.loot','rpg.party','combat.turnbased','genre.inn','genre.inn.traffic','genre.hunter']);
export function resolveModules(source:string,diagnosis:ReturnType<typeof diagnoseCard>){
  const matched=genreTemplates().filter(template=>template.detect(source)),excluded=new Set(matched.flatMap(template=>template.excludes??[]));
  const ids=[...matched.map(template=>template.id),...diagnosis.suggestedModules.filter(id=>KNOWN_MODULES.has(id)&&!excluded.has(id))];
  return[...new Set(ids)];
}
export async function compileCard({parsed,provider,signal}:CompileCardOptions):Promise<CompileResult>{
  const mined=mineCard(parsed),prompt=buildCompilerPrompt(parsed,mined),diagnosis=diagnoseCard(parsed,mined,prompt.coverage),source=JSON.stringify(parsed.card),moduleIds=resolveModules(source,diagnosis),attempts:CompileAttempt[]=[];
  let repair:string|null=null,last:unknown;
  for(let index=0;index<3;index++){
    const messages=repair?[{role:'system' as const,content:'당신은 JSON 스키마 교정기다.'},{role:'user' as const,content:repair}]:[{role:'system' as const,content:prompt.system},{role:'user' as const,content:prompt.user}];
    try{
      const raw=(await provider.complete({prompt:{messages,assistantPrefill:'',trace:[],warnings:[]},format:'json',...(signal?{signal}:{})})).text,llm=parseOutput(raw),normalized=normalizeCompiledSchema(llm,moduleIds),patched=patchSchemaWithMined(normalized.schema,mined),semantic=validateCompiledSemantics(patched.schema,moduleIds),validation=inspectGameRuntimeSchema(patched.schema),validationMessages=[...validation.map(value=>`${value.path} ${value.message}`),...semantic.filter(value=>value.level==='error').map(value=>`${value.path} ${value.message}`)];
      attempts.push({attempt:index+1,raw,issues:validationMessages});
      if(validationMessages.length){repair=buildRepairPrompt(raw,validationMessages);last=new Error(validationMessages.join('; '));continue;}
      patched.schema._compiler={version:'0.2'};
      const presets=screenPresetsFor(moduleIds),issues=[...normalized.issues,...semantic.filter(value=>value.level!=='error')],warnings=[...mined.warnings,...diagnosis.issues.map(value=>value.message),...issues.map(value=>value.message),...patched.unmatchedMinedValues.map(value=>`채굴했으나 연결 못함: ${value.path} — ${value.reason}`)];
      return{compilerVersion:'0.2',schema:patched.schema,moduleIds,screens:presets.screens,navigation:presets.navigation,patches:patched.patches,unmatchedMinedValues:patched.unmatchedMinedValues,issues,warnings,attempts,diagnosis,rulebookUsed:prompt.coverage.rulebookText};
    }catch(error){last=error;if(error instanceof DOMException&&error.name==='AbortError')throw error;repair=null;}
  }
  const detail=last instanceof Error?last.message:'compiler_json_invalid';
  throw new Error(`컴파일 실패 — 태그 전용 모드 안내는 일반 채팅만 가능하다는 뜻이며, 시뮬 상태 적용은 비활성화됩니다. (${detail})`);
}

export interface ModuleCandidate { id: string; label: string; confidence: number; evidence: string[]; status: 'installed'|'suggested'|'rejected'; }
export interface CompileReport { contract: 'simbot-compile-report/0.1'; cardName: string; format: string; candidates: ModuleCandidate[]; warnings: Array<{code:string;detail:string}>; unmatchedMinedValues: UnmatchedMinedValue[]; }
export interface CompileDraft { project: SimPackProject; report: CompileReport; }

function score(source:string,patterns:RegExp[]) { const evidence=patterns.filter((pattern)=>pattern.test(source)).map((pattern)=>pattern.source); return {confidence:Math.min(.95,evidence.length*.22),evidence}; }
function screens(modules:string[]) {
  const values:Array<Record<string,unknown>>=[{id:'play',title:'플레이',layout:'stage-chat-sidebar',regions:{main:[{widget:'chat'}]}}];
  if(modules.includes('genre.hunter')) values.push({id:'hunter',title:'헌터 활동',layout:'dashboard',regions:{hud:[{widget:'detail-panel',source:'engine:hunter/status'}],main:[{widget:'quest-board',source:'state.hunter'}],actions:[{widget:'action-group',actions:[{label:'헌터 등록',event:{id:'hunter/register',params:{}}}]}]}});
  if(modules.includes('genre.inn')) values.push({id:'management',title:'여관 경영',layout:'dashboard',regions:{hud:[{widget:'detail-panel',source:'state.facilities'}],main:[{widget:'card-list',source:'engine:inn/rooms'}],actions:[{widget:'action-group',actions:[{label:'점심 영업',event:{id:'traffic_wave',params:{wave:'lunch'}}},{label:'저녁 영업',event:{id:'traffic_wave',params:{wave:'evening'}}}]}]}});
  return values;
}
export function compileCardDraft(card:ParsedCard,approvedModules:string[]=[]):CompileDraft {
  const source=JSON.stringify(card.card).toLowerCase();
  const hunter=score(source,[/alternate hunters/,/헌터/,/게이트/,/각성자/,/hunter[_ -]?rank/]);
  const inn=score(source,[/용사.{0,4}여관/,/여관.{0,4}경영/,/숙박/,/주점/,/lodging/,/traffic_wave/]);
  const data=(card.card.data??{}) as Record<string,unknown>;
  const extensions=(data.extensions??{}) as Record<string,unknown>;
  const explicit=(extensions.simbot??{}) as Record<string,unknown>;
  const declared=Array.isArray(explicit.modules)?explicit.modules.map(String):[];
  const installed=[...new Set([...approvedModules,...declared])];
  const candidates:ModuleCandidate[]=[
    {id:'genre.hunter',label:'헌터 장르',...hunter,status:installed.includes('genre.hunter')?'installed':hunter.confidence>=.44?'suggested':'rejected'},
    {id:'genre.inn',label:'여관 경영 장르',...inn,status:installed.includes('genre.inn')?'installed':inn.confidence>=.44?'suggested':'rejected'}
  ];
  const screenList=screens(installed);
  const book=(data.character_book??{}) as Record<string,unknown>;
  const lorebooks=Array.isArray(book.entries)?book.entries:[];
  const project=createSimPack({
    id:String(data.name??card.name??'card').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-')||'card',title:card.name||'Imported card',fileName:card.source??'card.bin',sourceFormat:card.format,sourceVersion:card.specVersion,sourceBytes:card.sourceBytes,
    schema:{meta:{id:'compiled-card'},initialState:{day:1,gold:0,resources:{},facilities:{},staff:[],player:{level:1,exp:0,pools:{hp:{cur:100,max:100}}}}},screens:screenList,navigation:screenList.map((screen)=>({id:screen.id,screenId:screen.id,label:screen.title})),
    characters:[{id:'primary',name:card.name,description:String(data.description??''),personality:String(data.personality??''),scenario:String(data.scenario??'')}],lorebooks,
    assets:card.assets.map(({bytes:_,...asset},index)=>({id:`asset:${index}`,name:asset.name,kind:asset.type,blob:null,canonical:asset,source:null}))
  });
  const manifest=project.manifest as unknown as Record<string,unknown>;
  (manifest.modules as Record<string,unknown>).installed=installed;
  manifest.risu={sourceSpec:card.spec,rawCard:card.card,containerEntries:card.containerEntries};
  manifest.evidence=candidates.flatMap((candidate)=>candidate.evidence.map((path)=>({moduleId:candidate.id,path,confidence:candidate.confidence})));
  const assetList=manifest.assets as Array<Record<string,unknown>>;
  card.assets.forEach((item,index)=>{if(!item.bytes)return;const ext=item.ext.replace(/[^a-z0-9]/gi,'').toLowerCase()||extensionFor(item.mime),path=`blobs/assets/${String(index).padStart(4,'0')}-${safeAssetName(item.name||item.type||'asset')}.${ext}`;project.files[path]=Uint8Array.from(item.bytes);assetList[index]!.blob={path,sha256:sha256Hex(item.bytes),size:item.bytes.length,mime:item.mime};});
  const runtime=manifest.runtime as Record<string,unknown>,minedPatch=patchSchemaWithMined(runtime.schema as Record<string,unknown>,mineCard(card));
  runtime.schema=minedPatch.schema;
  return {project,report:{contract:'simbot-compile-report/0.1',cardName:card.name,format:card.format,candidates,warnings:candidates.filter((candidate)=>candidate.status==='suggested').map((candidate)=>({code:'module_needs_approval',detail:`${candidate.label}는 근거가 있지만 시작 전 승인이 필요합니다.`})),unmatchedMinedValues:minedPatch.unmatchedMinedValues}};
}
function safeAssetName(value:string){return value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^\.+/,'').slice(0,80)||'asset';}
function extensionFor(mime:string){return ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav'} as Record<string,string>)[mime]??'bin';}
