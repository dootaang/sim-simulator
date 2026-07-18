const systemProposal=/\[\[(?:aff|mood|hp|mp|gold|res|diss|stat|event|log\s*\d*|prog|loot|보스격파|전투완료|목표달성|작전완료|임무완료|진행|단계완료)[^\]]*\]\]/gi;
const uiToken=/\[(?:상태창|사이드패널|하단상태창|진행도상태|시작버튼|인트로|대화|임포트대기)\]/g;
const background=/\[배경\s*:\s*([^\]]+)\]/gi;
const time=/\|\s*day\s*\d+\s*_\s*[가-힣]+/gi;

function dialogue(asset:string,quote:string){
  // 카드 고유의 <img="이름"> 대화 표식을 Risu의 img CBS로 넘긴다.
  // 이후 치환 순서는 Risu ParseMarkdown과 동일하게 처리한다.
  return `\n{{img::${asset.trim()}}}\n“${quote.trim().replace(/^["“]|["”]$/g,'')}”\n`;
}

export type GflNarrativeSegment=
  |{kind:'prose';text:string}
  |{kind:'dialogue';asset:string;quote:string};

const privateStart='\uE000',privateEnd='\uE001';
const unquote=(value:string)=>value.trim().replace(/^["“]|["”]$/g,'');
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function projectDialogueFrames(source:string,replace:(asset:string,quote:string)=>string){
  return source
    .replace(/\[\s*전투\s*\|\s*(?:<|&lt;)?img\s*=\s*["“”]?([^"“”>]+?)["“”]?\s*(?:>|&gt;)?\s*\|\s*["“”]?([\s\S]*?)["“”]?\s*\|\s*HP=\d+>\d+\s*\|\s*MP=\d+>\d+\s*\|\s*\]/gi,(_all,asset,quote)=>replace(String(asset),String(quote)))
    .replace(/\[\s*(?:엑스|적대)\s*\|\s*(?:<|&lt;)?img\s*=\s*["“”]?([^"“”>]+?)["“”]?\s*(?:>|&gt;)?\s*\|\s*["“”]?([\s\S]*?)["“”]?\s*\|\s*\]/gi,(_all,asset,quote)=>replace(String(asset),String(quote)))
    .replace(/\[\s*\|\s*(?:<|&lt;)?img\s*=\s*["“”]?([^"“”>]+?)["“”]?\s*(?:>|&gt;)?\s*\|\s*["“”]?([\s\S]*?)["“”]?\s*\|\s*\]/gi,(_all,asset,quote)=>replace(String(asset),String(quote)))
    .replace(/{{\s*img\s*::\s*([^{}]+?)\s*}}\s*\r?\n\s*>\s*([^\n]+)/gi,(_all,asset,quote)=>replace(String(asset),String(quote)));
}

export function isNativeGflPresentation(project:{content?:unknown;moduleIds?:readonly string[]}){
  const content=project.content&&typeof project.content==='object'&&!Array.isArray(project.content)?project.content as Record<string,unknown>:{};
  return content.nativePresentation==='gfl'||project.moduleIds?.includes('genre.gfl')===true;
}

function cleanGflNarrative(source:string){
  return source
    .replace(/\[USER\|([^|\]]+?)\|\]/gi,(_all,quote)=>`\n> ${String(quote).trim()}\n`)
    .replace(/\[UI_IMG\][\s\S]*?\[UI_IMG\]/gi,'')
    .replace(/\[제조완료:[^\]]*\]/gi,'')
    .replace(/\[(?:이벤트\s*:\s*[^\]]+|퇴각 확인)\]/gi,'')
    .replace(/\[세이브\][\s\S]*?\[\/세이브\]/gi,'')
    .replace(/\[\[kalina_shop=(?:1|0)\]\]/gi,'')
    .replace(systemProposal,'')
    .replace(background,'')
    .replace(time,'')
    .replace(uiToken,'')
    .replace(/\(AI지침:[^)]*\)/gi,'')
    .replace(/^\s*(?:==@|\/{3}|\|)\s*$/gm,'')
    .replace(/[ \t]+$/gm,'')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

/** GFL 카드 표식을 내레이션과 네이티브 대화 장면으로 나누되 원래 순서는 보존한다. */
export function parseGflNarrative(source:string):GflNarrativeSegment[]{
  const dialogues:Array<{asset:string;quote:string}>=[],safe=String(source??'').replace(/[\uE000\uE001]/g,'�'),projected=projectDialogueFrames(safe,(asset,quote)=>{const index=dialogues.push({asset:asset.trim(),quote:unquote(quote)})-1;return `\n${privateStart}${index}${privateEnd}\n`;});
  const cleaned=cleanGflNarrative(projected),segments:GflNarrativeSegment[]=[];
  let cursor=0;
  for(const match of cleaned.matchAll(/\uE000(\d+)\uE001/g)){
    const index=match.index??0,prose=cleaned.slice(cursor,index).trim(),item=dialogues[Number(match[1])];
    if(prose)segments.push({kind:'prose',text:prose});
    if(item)segments.push({kind:'dialogue',...item});
    cursor=index+match[0].length;
  }
  const prose=cleaned.slice(cursor).trim();if(prose)segments.push({kind:'prose',text:prose});
  return segments;
}

interface GflRenderedPart<W>{html:string;warnings:W[]}
/** 일반 산문은 기존 렌더러에 맡기고 대사는 엔진 소유 HTML에 안전한 텍스트로 넣는다. */
export function renderGflNarrative<W extends{code:string;macro:string;name:string}>(source:string,render:(content:string)=>GflRenderedPart<W>){
  const html:string[]=[],warnings:W[]=[];
  for(const segment of parseGflNarrative(source)){
    if(segment.kind==='prose'){const result=render(segment.text);html.push(result.html);warnings.push(...result.warnings);continue;}
    const safeAsset=/[{}<>\r\n]/.test(segment.asset)?'':segment.asset,result=safeAsset?render(`{{img::${safeAsset}}}`):{html:'',warnings:[] as W[]};
    warnings.push(...result.warnings);
    html.push(`${result.html}\n<p><span class="dialogue">“${escapeHtml(segment.quote).replace(/\r?\n/g,'<br>')}”</span></p>`);
  }
  const seen=new Set<string>();
  return{html:html.join('\n'),warnings:warnings.filter(warning=>{const key=`${warning.code}\u0001${warning.macro}\u0001${warning.name}`;if(seen.has(key))return false;seen.add(key);return true;})};
}

/** 원본 Risu UI 명령을 실행하지 않고 Lucky의 안전한 이미지·인용문으로 투영한다. */
export function prepareGflNarrative(source:string){
  return cleanGflNarrative(projectDialogueFrames(String(source??''),(asset,quote)=>dialogue(asset,quote)));
}

export function extractGflBackgroundCue(content:string):string|null{
  let cue:string|null=null;
  for(const match of String(content??'').matchAll(background))cue=match[1]?.trim()??cue;
  background.lastIndex=0;
  return cue;
}

export function latestGflBackgroundCue(messages:readonly{role?:string;content?:string}[]):string|null{
  for(let index=messages.length-1;index>=0;index-=1){
    const message=messages[index];
    if(message?.role!=='assistant')continue;
    const cue=extractGflBackgroundCue(message.content??'');
    if(cue)return cue;
  }
  return null;
}
