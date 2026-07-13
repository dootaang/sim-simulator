import type {CardAsset,ParsedCard,RegexScript} from './index.ts';
import {repackCardDocument} from './repack.ts';

export interface CardLoreEntry{
  id:string;name:string;keys:string[];secondaryKeys:string[];content:string;enabled:boolean;constant:boolean;
  selective:boolean;order:number;useRegex:boolean;folder:string;raw:Record<string,unknown>;
}
export interface CardDocumentAsset{
  id:string;name:string;type:string;ext:string;uri:string;path?:string;mime:string;size:number;bytes:Uint8Array|null;origin:'card'|'module';deleted?:boolean;
}
export interface CardDocumentDraft{
  name:string;description:string;personality:string;scenario:string;firstMessage:string;alternateGreetings:string[];
  creatorNotes:string;systemPrompt:string;postHistoryInstructions:string;tags:string[];backgroundHtml:string;
  lorebook:CardLoreEntry[];regexScripts:RegexScript[];triggerScripts:Record<string,unknown>[];assets:CardDocumentAsset[];
}
export interface CardDocument{
  contract:'lucky-card-document/0.1';source:ParsedCard;draft:CardDocumentDraft;original:CardDocumentDraft;
  cardRoot:Record<string,unknown>;moduleRoot:Record<string,unknown>|null;revision:number;dirty:boolean;
}

const clone=<T>(value:T):T=>structuredClone(value);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const strings=(value:unknown)=>Array.isArray(value)?value.map(String):typeof value==='string'?value.split(',').map(item=>item.trim()).filter(Boolean):[];
const bool=(value:unknown,fallback=false)=>typeof value==='boolean'?value:fallback;

function loreFrom(rawValue:unknown,index:number):CardLoreEntry{
  const raw=clone(object(rawValue)),keys=strings(raw.keys??raw.key),secondaryKeys=strings(raw.secondary_keys??raw.secondkey);
  return{id:String(raw.id??raw.uid??`lore-${index+1}`),name:String(raw.name??raw.comment??keys[0]??`로어 ${index+1}`),keys,secondaryKeys,
    content:String(raw.content??''),enabled:raw.enabled!==false,constant:bool(raw.constant??raw.alwaysActive),selective:bool(raw.selective),
    order:Number(raw.insertion_order??raw.insertorder??index),useRegex:bool(object(raw.extensions).risu_useRegex??raw.useRegex??raw.use_regex),folder:String(raw.folder??''),raw};
}

function assetFrom(value:CardAsset,index:number):CardDocumentAsset{return{id:`asset-${index}`,name:value.name,type:value.type,ext:value.ext,uri:value.uri,...(value.path?{path:value.path}:{}),mime:value.mime,size:value.size,bytes:value.bytes?.slice()??null,origin:value.type==='module-asset'?'module':'card'};}

function readDraft(parsed:ParsedCard):{draft:CardDocumentDraft;moduleRoot:Record<string,unknown>|null}{
  const root=object(parsed.card),data=object(root.data??root),extensions=object(data.extensions),risu=object(extensions.risuai),moduleRoot=parsed.modules?.[0]?.raw?clone(parsed.modules[0].raw):null;
  const moduleLore=Array.isArray(moduleRoot?.lorebook)?moduleRoot.lorebook:null,book=object(data.character_book),cardLore=Array.isArray(book.entries)?book.entries:[];
  const lore=(moduleLore??cardLore).map(loreFrom),regexScripts=clone(parsed.modules?.flatMap(module=>module.regex)??[]),triggerSource=moduleRoot?.trigger??risu.triggerScript??risu.triggerscript,triggerScripts=Array.isArray(triggerSource)?clone(triggerSource.map(object)):[];
  return{moduleRoot,draft:{name:String(data.name??root.name??parsed.name),description:String(data.description??''),personality:String(data.personality??''),scenario:String(data.scenario??''),
    firstMessage:String(data.first_mes??data.firstMessage??''),alternateGreetings:strings(data.alternate_greetings??data.alternateGreetings),creatorNotes:String(data.creator_notes??''),
    systemPrompt:String(data.system_prompt??''),postHistoryInstructions:String(data.post_history_instructions??''),tags:strings(data.tags),
    backgroundHtml:String(risu.backgroundHTML??moduleRoot?.backgroundEmbedding??''),lorebook:lore,regexScripts,triggerScripts,assets:parsed.assets.map(assetFrom)}};
}

export function createCardDocument(parsed:ParsedCard):CardDocument{
  const {draft,moduleRoot}=readDraft(parsed);return{contract:'lucky-card-document/0.1',source:parsed,draft:clone(draft),original:clone(draft),cardRoot:clone(parsed.card),moduleRoot,revision:0,dirty:false};
}
export function updateCardDocument(document:CardDocument,change:(draft:CardDocumentDraft)=>void){change(document.draft);document.revision+=1;document.dirty=true;return document;}
export function resetCardDocument(document:CardDocument){document.draft=clone(document.original);document.revision+=1;document.dirty=false;return document;}
export function addCardDocumentAsset(document:CardDocument,file:{name:string;type:string;bytes:Uint8Array},kind='asset'){
  const ext=file.name.split('.').pop()?.toLowerCase()||'bin',stem=file.name.replace(/\.[^.]+$/,''),used=new Set(document.draft.assets.map(asset=>asset.path??asset.uri)),suffix=ext==='bin'?'':`.${ext}`;let path=`assets/${stem}${suffix}`,index=2;while(used.has(path))path=`assets/${stem}_${index++}${suffix}`;document.draft.assets.push({id:`asset-${crypto.randomUUID()}`,name:stem,type:kind,ext,uri:path,path,mime:file.type||'application/octet-stream',size:file.bytes.length,bytes:file.bytes.slice(),origin:'card'});document.revision+=1;document.dirty=true;
}
export function removeCardDocumentAsset(document:CardDocument,id:string){const asset=document.draft.assets.find(value=>value.id===id);if(asset){asset.deleted=true;document.revision+=1;document.dirty=true;}}
export function addCardLoreEntry(document:CardDocument){document.draft.lorebook.push({id:`lore-${crypto.randomUUID()}`,name:'새 로어',keys:[],secondaryKeys:[],content:'',enabled:true,constant:false,selective:false,order:document.draft.lorebook.length,useRegex:false,folder:'',raw:{}});document.revision+=1;document.dirty=true;}
export function removeCardLoreEntry(document:CardDocument,id:string){document.draft.lorebook=document.draft.lorebook.filter(entry=>entry.id!==id);document.revision+=1;document.dirty=true;}
export function exportCardDocument(document:CardDocument){return repackCardDocument(document);}
