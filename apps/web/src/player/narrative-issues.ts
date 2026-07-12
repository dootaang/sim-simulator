interface NarrativeIssue{code:'failed-event-claim'|'unsupported-number';detail?:string;}
export interface NarrativeWarning{label:string;strong:boolean;details:string[];}
// 경고는 원문 바깥의 표시 정보만 만든다. 서사 본문은 입력값 그대로 돌려줘 잘라내지 않는다.
export function presentNarrativeIssues(content:string,issues:NarrativeIssue[]):{content:string;warning:NarrativeWarning|null}{
  if(!issues.length)return{content,warning:null};const failed=issues.some((issue)=>issue.code==='failed-event-claim'),numbers=issues.filter((issue)=>issue.code==='unsupported-number');
  return{content,warning:{label:failed?'거부된 사건 서술':`근거 없는 숫자 ${numbers.length}건`,strong:failed,details:issues.map((issue)=>issue.detail?.trim()||(issue.code==='failed-event-claim'?'엔진이 거부한 사건을 성공한 것처럼 서술했습니다.':'근거가 확인되지 않은 숫자입니다.'))}};
}
