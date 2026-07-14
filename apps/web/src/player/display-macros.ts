import {applyRegexScripts,parseCbs,resolveAssetMacros,type AssetMacroAsset,type AssetMacroWarning,type AssetResolveOptions,type RegexScript} from '@simbot/risu';
import {renderMarkdownWithHtml as renderMarkdown} from '@simbot/ui/markdown';
import {sanitizeHtml} from '@simbot/ui/sanitize-html';

// 치환값(페르소나·카드 이름)은 사용자가 정한 문자열이다. 그 안에 중괄호가 있으면 뒷단의 CBS 파서·에셋
// 매크로가 그것을 문법으로 오인한다(통합 감사). 치환 전에 중괄호를 무력화한다.
const literal=(value:string)=>String(value??'').replace(/[{}]/g,'');
export function displayMacros(content:string,user:string,char:string){const u=literal(user),c=literal(char);return content.replace(/{{\s*user\s*}}/gi,u).replace(/{{\s*char\s*}}/gi,c);}
export interface DisplayAssetOptions extends AssetResolveOptions{activeModules?:readonly string[]}
export function prepareDisplayContent(content:string,user:string,char:string,scripts:readonly RegexScript[]=[],variables:Record<string,string>={},chatIndex=0,lastMessageId=0,activeModules:readonly string[]=[]){
  // ADR 0004: 업스트림 processScriptFull과 같은 순서 — 각 정규식 치환 직후 CBS를 재평가한다.
  // 정규식 out에 든 {{getvar::…}}가 그 자리에서 값이 되므로(용사여관 outfit 사례) 뒷단이 완성된 이름을 받는다.
  const cbs=(text:string)=>parseCbs(text,{userName:user,charName:char,chatIndex,lastMessageId,variables,activeModules});
  let rendered=applyRegexScripts(content,scripts,'output',{parser:cbs});
  rendered=applyRegexScripts(rendered,scripts,'display',{parser:cbs});
  return cbs(rendered);}
function uniqueWarnings(values:readonly AssetMacroWarning[]){const seen=new Set<string>();return values.filter(value=>{const key=`${value.code}\u0001${value.macro}\u0001${value.name}`;if(seen.has(key))return false;seen.add(key);return true;});}
export function renderDisplayContent(content:string,user:string,char:string,assets:readonly AssetMacroAsset[],scripts:readonly RegexScript[]=[],variables:Record<string,string>={},chatIndex=0,lastMessageId=0,assetOptions:DisplayAssetOptions={}):{html:string;warnings:AssetMacroWarning[]}{const first=resolveAssetMacros(content,assets,assetOptions),prepared=prepareDisplayContent(first.content,user,char,scripts,variables,chatIndex,lastMessageId,assetOptions.activeModules),second=resolveAssetMacros(prepared,assets,assetOptions);return{html:sanitizeHtml(renderMarkdown(second.content)),warnings:uniqueWarnings([...first.warnings,...second.warnings])};}
