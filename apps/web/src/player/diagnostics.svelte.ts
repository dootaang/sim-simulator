import {maskSecrets} from '@simbot/session';

// 진단 수집기 — "테스트는 통과하는데 실물 카드에서는 안 된다"를 끝내기 위한 것.
// 실패가 화면에서 스스로 말하게 한다: 무엇을 찾았고, 어떤 이름을 시도했고, 왜 실패했는가.
//
// 이 파일이 지키는 규율.
// ① 렌더가 상태를 바꾸면 안 된다(M-S0). 사건은 평범한 배열에 담고, UI 알림($state)은 마이크로태스크로
//    미룬다. 렌더 도중 반응 상태를 건드리면 렌더 → 기록 → 렌더 루프가 된다.
// ② 같은 사건은 한 번만. 같은 메시지를 다시 그릴 때마다 쌓이면 로그가 아니라 소음이다.
// ③ 진행 중인 일을 실패로 적지 않는다. 지연 로딩 중인 에셋은 곧 뜬다 — 뜨면 그 기록은 철회한다(resolve).
//    거짓 실패를 복사해 보내는 진단은 없느니만 못하다.
// ④ 화면과 복사본이 같은 데이터를 본다. 자르기·마스킹은 수집 시점에 끝낸다 — 복사할 때만 지우면
//    화면에는 그대로 남는다.
export type DiagnosticKind='asset'|'cbs'|'regex'|'trigger'|'simulation'|'provider'|'card';
export type DiagnosticStatus='failed'|'pending';
// 콘솔은 문제만 보는 창이 아니라 상시 관측창이다 — 그래서 성공 경로(정보)도 흐른다. 다만 레벨로 가른다.
// 추적은 턴당 수백 줄이라 기본으로 켜면 안 되고, 꺼져 있으면 **만들지도 않는다**(enabled로 미리 묻는다).
// 만들어놓고 필터로 숨기면 렌더 경로에서 문자열 수천 개를 헛만드는 짓이다.
export type DiagnosticLevel='error'|'warn'|'info'|'trace';
export const diagnosticLevels:DiagnosticLevel[]=['error','warn','info','trace'];
export const diagnosticLevelLabel:Record<DiagnosticLevel,string>={error:'오류',warn:'경고',info:'정보',trace:'추적'};
export interface DiagnosticEvent{key:string;at:number;level:DiagnosticLevel;kind:DiagnosticKind;code:string;status:DiagnosticStatus;summary:string;detail:Record<string,string>;card:string;chat:string;message:number|null;turn:number|null}
export interface DiagnosticInput{level?:DiagnosticLevel;kind:DiagnosticKind;code:string;status?:DiagnosticStatus;summary:string;detail:Record<string,string|number|null>;card:string;chat:string;message:number|null;turn?:number|null;key?:string}

const MAX_EVENTS=500,MAX_FIELD=400;
export const diagnosticLabel:Record<DiagnosticKind,string>={asset:'에셋',cbs:'CBS',regex:'정규식',trigger:'트리거',simulation:'시뮬레이션',provider:'모델',card:'카드'};

class Diagnostics{
  #events:DiagnosticEvent[]=[];#seen=new Set<string>();#pending=false;#secrets:string[]=[];
  version=$state(0); // UI가 구독하는 유일한 반응 값. 렌더 밖(마이크로태스크)에서만 올린다.
  // 추적만 기본 꺼짐. 오류·경고·정보는 항상 흐른다 — 상시 콘솔은 평소에도 뭔가 보여야 쓸모가 있다.
  levels=$state<Record<DiagnosticLevel,boolean>>({error:true,warn:true,info:true,trace:false});
  enabled(level:DiagnosticLevel){return this.levels[level];} // 비싼 사건은 만들기 전에 여기로 먼저 묻는다
  get events():readonly DiagnosticEvent[]{void this.version;return this.#events;}
  get count(){void this.version;return this.#events.length;}
  // 키는 PlayerPage가 심는다. 진단은 어떤 경로로든 키를 화면에도 복사본에도 남기지 않는다.
  setSecrets(secrets:readonly (string|undefined)[]){this.#secrets=secrets.filter((value):value is string=>!!value&&value.trim().length>0);}
  // 카드 원문·이미지 바이너리·키는 진단에 담지 않는다. 값이 길면 자르고, 데이터 URL은 흔적만 남긴다.
  #safe(value:string|number|null){if(value===null)return'(없음)';const text=maskSecrets(String(value),...this.#secrets);if(/^data:/.test(text))return`(데이터 URL ${text.length}자)`;return text.length>MAX_FIELD?`${text.slice(0,MAX_FIELD)}… (총 ${text.length}자)`:text;}
  #notify(){if(this.#pending)return;this.#pending=true;queueMicrotask(()=>{this.#pending=false;this.version+=1;});}
  #keyOf(input:DiagnosticInput){return input.key??`${input.kind}${input.code}${input.chat}${input.message}${input.summary}`;}
  record(input:DiagnosticInput){
    const level=input.level??'error';
    if(!this.levels[level])return''; // 꺼진 레벨은 기록하지 않는다
    const key=this.#keyOf(input);
    if(this.#seen.has(key))return key; // 재렌더로 같은 사건이 쌓이지 않는다
    this.#seen.add(key);
    const detail:Record<string,string>={};for(const[field,value]of Object.entries(input.detail))detail[field]=this.#safe(value);
    this.#events.push({key,at:Date.now(),level,kind:input.kind,code:input.code,status:input.status??'failed',summary:this.#safe(input.summary),detail,card:input.card,chat:input.chat,message:input.message,turn:input.turn??null});
    // 밀려난 사건의 중복 키도 함께 지운다 — 안 그러면 #seen이 무한히 자라고, 다시 일어난 문제가
    // "이미 본 사건"이라며 기록되지 않는다.
    while(this.#events.length>MAX_EVENTS)this.#seen.delete(this.#events.shift()!.key);
    this.#notify();
    return key;
  }
  // 진행 중이던 사건이 결국 성공했을 때 철회한다(지연 로딩이 끝나 이미지가 뜬 경우).
  resolve(key:string){const before=this.#events.length;this.#events=this.#events.filter(event=>event.key!==key);this.#seen.delete(key);if(this.#events.length!==before)this.#notify();}
  clear(){this.#events=[];this.#seen.clear();this.version+=1;}
  // 복붙용 텍스트. 사용자 대화 원문·카드 파일·키는 들어가지 않는다(값은 수집 시점에 이미 안전하다).
  // 실전에서 가장 많이 쓰는 건 "방금 이 턴이 이상해요"다 — 그래서 마지막 턴만 따로 뽑을 수 있어야 한다.
  lastTurn(chat?:string){let last:number|null=null;for(const event of this.#events)if((!chat||event.chat===chat)&&event.turn!==null&&(last===null||event.turn>last))last=event.turn;return last;}
  copyText(chat?:string,filter?:(event:DiagnosticEvent)=>boolean,scopeLabel?:string){
    const events=this.#events.filter(event=>(!chat||event.chat===chat)&&(!filter||filter(event))).slice().reverse();
    const head=`# 럭키★시뮬레이터 진단 (${new Date().toISOString()})\n범위: ${scopeLabel??(chat?`현재 채팅(${chat})`:'전체')} · 사건 ${events.length}건\n`;
    return head+events.map(event=>{
      const rows=Object.entries(event.detail).map(([field,value])=>`  ${field}: ${value}`).join('\n');
      return `\n## [${diagnosticLevelLabel[event.level]}·${diagnosticLabel[event.kind]}] ${event.summary}${event.status==='pending'?' (진행 중)':''}\n  코드: ${event.code}${event.turn===null?'':` · 턴 ${event.turn}`}\n  카드: ${event.card}\n  채팅: ${event.chat}${event.message===null?'':` · 메시지 ${event.message}`}\n${rows}`;
    }).join('\n');
  }
}
// 수집기는 모듈 인스턴스가 아니라 앱에 하나뿐이어야 한다. 같은 파일이 두 모듈로 로드되면(Vite의 HMR
// 쿼리, 번들 중복 등) 기록하는 쪽과 보는 쪽이 갈려 진단이 통째로 사라진다 — 실제로 그랬다.
const globals=globalThis as{__luckyDiagnostics?:Diagnostics};
export const diagnostics=globals.__luckyDiagnostics??=new Diagnostics();
