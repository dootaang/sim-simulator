import {applyRegexScripts,CbsBudget,parseCbs,resolveAssetMacros,type AssetMacroAsset,type AssetMacroWarning,type AssetResolveOptions,type RegexScript} from '@simbot/risu';
import {renderMarkdownWithHtml as renderMarkdown} from '@simbot/ui/markdown';
import {sanitizeHtml} from '@simbot/ui/sanitize-html';

// 치환값(페르소나·카드 이름)은 사용자가 정한 문자열이다. 그 안에 중괄호가 있으면 뒷단의 CBS 파서·에셋
// 매크로가 그것을 문법으로 오인한다(통합 감사). 치환 전에 중괄호를 무력화한다.
const literal=(value:string)=>String(value??'').replace(/[{}]/g,'');
export function displayMacros(content:string,user:string,char:string){const u=literal(user),c=literal(char);return content.replace(/{{\s*user\s*}}/gi,u).replace(/{{\s*char\s*}}/gi,c);}
export interface DisplayAssetOptions extends AssetResolveOptions{activeModules?:readonly string[];screenWidth?:number}
export function prepareDisplayContent(content:string,user:string,char:string,scripts:readonly RegexScript[]=[],variables:Record<string,string>={},chatIndex=0,lastMessageId=0,activeModules:readonly string[]=[],budget=new CbsBudget(),screenWidth=0){
  // ADR 0004: 업스트림 processScriptFull과 같은 순서 — 각 정규식 치환 직후 CBS를 재평가한다.
  // 정규식 out에 든 {{getvar::…}}가 그 자리에서 값이 되므로(용사여관 outfit 사례) 뒷단이 완성된 이름을 받는다.
  // 메시지 1개 렌더 전체가 예산 하나를 공유한다 — 파스를 잘게 쪼개는 우회를 막는다(M-S2a).
  // screenWidth는 배경 경로와 같은 계약이다 — 카드 CSS의 {{#if {{? {{screen_width}} > 768}}}} 반응형
  // 분기가 메시지에서도 살아야 카드가 스스로 좁은 화면에 맞춰 그린다(DOMINIUM 실측).
  const cbs=(text:string)=>parseCbs(text,{userName:user,charName:char,chatIndex,lastMessageId,variables,activeModules,screenWidth,budget});
  let rendered=applyRegexScripts(content,scripts,'output',{parser:cbs});
  rendered=applyRegexScripts(rendered,scripts,'display',{parser:cbs});
  return cbs(rendered);}
// 예산 초과는 이 렌더의 진단으로 올라간다 — 카드가 상한에 걸린 사실을 사용자가 볼 수 있어야 한다(조용한 무시 금지).
// 에셋 경고와 코드 집합이 다르므로 캐스팅으로 끼워 넣지 않고 진단 타입을 넓힌다.
export interface CbsBudgetWarning{code:'cbs_budget_exceeded';macro:string;name:string}
export type DisplayWarning=AssetMacroWarning|CbsBudgetWarning;
function budgetWarnings(budget:CbsBudget):CbsBudgetWarning[]{return budget.breaches.map(breach=>({code:'cbs_budget_exceeded' as const,macro:breach.limit,name:`${breach.actual} > ${breach.allowed}`}));}
function uniqueWarnings(values:readonly DisplayWarning[]){const seen=new Set<string>();return values.filter(value=>{const key=`${value.code}\u0001${value.macro}\u0001${value.name}`;if(seen.has(key))return false;seen.add(key);return true;});}
// 카드 <style>은 버리지 않고 배경 HTML과 같은 규칙으로 가둬서 살린다(오너 승인 2026-07-16):
// 잔여 CBS 제거 → @import 제거 → 외부 url() 중화 → fixed/sticky 중화 → @scope로 카드 표면에 격리.
// 마크다운 앞에서 뽑아야 한다 — 마크다운이 CSS 본문 줄들을 <p>로 감싸 규칙을 부수기 때문이다.
const styleTree=/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
function safeCss(css:string){return css.replace(/\{\{[\s\S]*?}}/g,'').replace(/@import\b[^;]*;?/gi,'').replace(/url\(\s*(['"]?)(?!data:|blob:)[^)]+\1\s*\)/gi,'none').replace(/\bposition\s*:\s*(fixed|sticky)\b/gi,'position:relative');}
// 순서는 업스트림 Risu와 같다: 카드 정규식·CBS를 '원문'에 먼저 돌리고 에셋 이름 해석은 맨 마지막이다.
// 에셋을 먼저 풀면 <img="이름">이 <img src="…">로 바뀌어 그 문법에 매칭되는 카드 정규식(캐릭터 카드·
// 상태창 UI)이 통째로 죽는다 — DOMINIUM 실측으로 확인한 회귀. {{img::}}·{{raw::}}·<img="">는 CBS를
// 그대로 통과하므로(포트 계약) 마지막 한 번의 해석으로 충분하다.
export function renderDisplayContent(content:string,user:string,char:string,assets:readonly AssetMacroAsset[],scripts:readonly RegexScript[]=[],variables:Record<string,string>={},chatIndex=0,lastMessageId=0,assetOptions:DisplayAssetOptions={}):{html:string;warnings:DisplayWarning[]}{
  const budget=new CbsBudget(),prepared=prepareDisplayContent(content,user,char,scripts,variables,chatIndex,lastMessageId,assetOptions.activeModules,budget,assetOptions.screenWidth),resolved=resolveAssetMacros(prepared,assets,assetOptions);
  const styles:string[]=[];const body=resolved.content.replace(styleTree,(_whole,css:string)=>{const clean=safeCss(css).trim();if(clean&&!styles.includes(clean))styles.push(clean);return'';});
  const scoped=styles.length?`<style>@scope (.lucky-card-surface){${styles.join('\n')}}</style>`:'';
  return{html:scoped+sanitizeHtml(renderMarkdown(body)),warnings:uniqueWarnings([...resolved.warnings,...budgetWarnings(budget)])};}
