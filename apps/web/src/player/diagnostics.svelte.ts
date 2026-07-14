import {maskSecrets} from '@simbot/session';

// 진단 수집기 — "테스트는 통과하는데 실물 카드에서는 안 된다"를 끝내기 위한 것.
// 실패가 화면에서 스스로 말하게 한다: 무엇을 찾았고, 어떤 이름을 시도했고, 왜 실패했는가.
//
// 두 가지 규율이 이 파일의 존재 이유다.
// ① 렌더가 상태를 바꾸면 안 된다(M-S0). 그래서 사건은 평범한 배열에 담고, UI 알림($state)은
//    마이크로태스크로 미룬다. 렌더 도중 반응 상태를 건드리면 렌더 → 기록 → 렌더 루프가 된다.
// ② 같은 사건은 한 번만. 같은 메시지를 다시 그릴 때마다 쌓이면 로그가 아니라 소음이다.
export type DiagnosticKind='asset'|'cbs'|'regex'|'trigger'|'simulation'|'provider'|'card';
export interface DiagnosticEvent{at:number;kind:DiagnosticKind;code:string;summary:string;detail:Record<string,string|number|null>;card:string;chat:string;message:number|null}
export interface DiagnosticInput extends Omit<DiagnosticEvent,'at'>{key?:string}

const MAX_EVENTS=100,MAX_FIELD=400;
const label:Record<DiagnosticKind,string>={asset:'에셋',cbs:'CBS',regex:'정규식',trigger:'트리거',simulation:'시뮬레이션',provider:'모델',card:'카드'};
// 카드 원문·이미지 바이너리·키는 진단에 담지 않는다. 값이 길면 자르고, 데이터 URL은 흔적만 남긴다.
const field=(value:string|number|null)=>{if(value===null)return'(없음)';const text=String(value);if(/^data:/.test(text))return`(데이터 URL ${text.length}자)`;return text.length>MAX_FIELD?`${text.slice(0,MAX_FIELD)}… (${text.length}자)`:text;};

class Diagnostics{
  #events:DiagnosticEvent[]=[];#seen=new Set<string>();#pending=false;
  version=$state(0); // UI가 구독하는 유일한 반응 값. 렌더 밖(마이크로태스크)에서만 올린다.
  get events():readonly DiagnosticEvent[]{void this.version;return this.#events;}
  get count(){void this.version;return this.#events.length;}
  record(input:DiagnosticInput){
    const key=input.key??`${input.kind}${input.code}${input.chat}${input.message}${input.summary}`;
    if(this.#seen.has(key))return; // 재렌더로 같은 사건이 쌓이지 않는다
    this.#seen.add(key);
    this.#events.push({at:Date.now(),kind:input.kind,code:input.code,summary:input.summary,detail:input.detail,card:input.card,chat:input.chat,message:input.message});
    while(this.#events.length>MAX_EVENTS)this.#events.shift();
    if(this.#pending)return;
    this.#pending=true;
    queueMicrotask(()=>{this.#pending=false;this.version+=1;}); // 렌더 중 상태 변경 금지 — 알림은 렌더가 끝난 뒤
  }
  clear(){this.#events=[];this.#seen.clear();this.version+=1;}
  // 복붙용 텍스트. 사용자 대화 원문·카드 파일·키는 들어가지 않는다.
  copyText(secrets:readonly string[]=[]){
    const head=`# 럭키★시뮬레이터 진단 (${new Date().toISOString()})\n사건 ${this.#events.length}건\n`;
    const body=this.#events.slice().reverse().map(event=>{
      const rows=Object.entries(event.detail).map(([key,value])=>`  ${key}: ${field(value)}`).join('\n');
      return `\n## [${label[event.kind]}] ${event.summary}\n  코드: ${event.code}\n  카드: ${event.card}\n  채팅: ${event.chat}${event.message===null?'':` · 메시지 ${event.message}`}\n${rows}`;
    }).join('\n');
    return maskSecrets(`${head}${body}`,...secrets);
  }
}
export const diagnostics=new Diagnostics();
export const diagnosticLabel=label;
