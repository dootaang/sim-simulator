import type { ParsedCard } from '@simbot/card';
import { createSimPack, sha256Hex, type SimPackProject } from '@simbot/simpack';

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
