import type { ParsedCard } from '@simbot/card';
import { inspectGameRuntimeSchema } from '@simbot/contracts';
import type { ModelProvider } from '@simbot/session';
import { createSimPack, sha256Hex, type SimPackProject } from '@simbot/simpack';
import { buildCompilerPrompt } from './compiler-prompt.ts';
import { diagnoseCard } from './diagnosis.ts';
import { mineCard } from './lua-mine.ts';
import { patchSchemaWithMined, type SchemaPatch } from './schema-patch.ts';
export * from './compiler-prompt.ts';export * from './diagnosis.ts';export * from './lua-mine.ts';export * from './schema-patch.ts';

export interface CompileResult{schema:Record<string,unknown>;moduleIds:string[];patches:SchemaPatch[];warnings:string[];diagnosis:ReturnType<typeof diagnoseCard>;rulebookUsed:string;}
export interface CompileCardOptions{parsed:ParsedCard;provider:ModelProvider;signal?:AbortSignal;}
function parseOutput(text:string){const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const start=clean.indexOf('{'),end=clean.lastIndexOf('}');if(start<0||end<=start)throw new Error('compiler_json_invalid');const value=JSON.parse(clean.slice(start,end+1)) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('compiler_schema_invalid');return value as Record<string,unknown>;}
export async function compileCard({parsed,provider,signal}:CompileCardOptions):Promise<CompileResult>{const mined=mineCard(parsed),prompt=buildCompilerPrompt(parsed,mined),request={prompt:{messages:[{role:'system' as const,content:prompt.system},{role:'user' as const,content:prompt.user}],assistantPrefill:'',trace:[],warnings:[]},format:'json' as const,...(signal?{signal}:{})};let llm:Record<string,unknown>|null=null,last:unknown;for(let attempt=0;attempt<2;attempt++)try{llm=parseOutput((await provider.complete(request)).text);break;}catch(error){last=error;}if(!llm)throw new Error(`컴파일 실패 — 태그 전용 모드로 진행할 수 있습니다. (${last instanceof Error?last.message:'compiler_json_invalid'})`);const patched=patchSchemaWithMined(llm,mined),validation=inspectGameRuntimeSchema(patched.schema);if(validation.length)throw new Error(`컴파일 스키마 검증 실패 — 태그 전용 모드로 진행할 수 있습니다. (${validation.map(v=>`${v.path} ${v.message}`).join('; ')})`);const diagnosis=diagnoseCard(parsed,mined,prompt.coverage),source=JSON.stringify(parsed.card);
  // 여관 모듈은 '여관'이라는 낱말이 아니라 기능적 증거로만 고른다. 낱말로 고르면 주점·여관을 스쳐
  // 언급하는 한국어 판타지 카드마다 엉뚱하게 여관 경영 스키마가 붙는다(카드 일반화 원칙).
  // 증거 = 투숙 경제의 뼈대(체크인/체크아웃 이벤트, 객실·투숙 상태) 또는 우리 여관 이벤트 계약.
  const innEvidence=/ysp_checkin|ysp_checkout|traffic_wave|checkin|checkout|lodging/i.test(source)
    ||(/객실|숙박|투숙/.test(source)&&/체크인|체크아웃/.test(source));
  const moduleIds=[...(innEvidence?['genre.inn']:[]),...diagnosis.suggestedModules.filter(id=>['core.stats','core.inventory','core.facilities','combat.turnbased'].includes(id))];return{schema:patched.schema,moduleIds:[...new Set(moduleIds)],patches:patched.patches,warnings:[...mined.warnings,...diagnosis.issues.map(i=>i.message)],diagnosis,rulebookUsed:prompt.coverage.rulebookText};}

export interface ModuleCandidate { id: string; label: string; confidence: number; evidence: string[]; status: 'installed'|'suggested'|'rejected'; }
export interface CompileReport { contract: 'simbot-compile-report/0.1'; cardName: string; format: string; candidates: ModuleCandidate[]; warnings: Array<{code:string;detail:string}>; }
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
  return {project,report:{contract:'simbot-compile-report/0.1',cardName:card.name,format:card.format,candidates,warnings:candidates.filter((candidate)=>candidate.status==='suggested').map((candidate)=>({code:'module_needs_approval',detail:`${candidate.label}는 근거가 있지만 시작 전 승인이 필요합니다.`}))}};
}
function safeAssetName(value:string){return value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^\.+/,'').slice(0,80)||'asset';}
function extensionFor(mime:string){return ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav'} as Record<string,string>)[mime]??'bin';}
