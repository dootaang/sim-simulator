// LLM 서사를 엔진 사실로 승격하지 않기 위한 마지막 관문.
// 출처: 레거시 앱 `app/core/memory/narrativeVerifier.ts`(SPDX GPL-3.0-or-later)의 복원.
// 모노레포 마이그레이션(03074d8)이 레거시 앱과 함께 삭제해 회귀했던 것을 되살린다.
//
// 원리: 엔진이 확정한 근거(영수증·상태)에 없는 숫자를 서사가 말하면 그건 모델이 지어낸 것이다.
// 우리 엔진은 상태를 지키지만, 화면에 나가는 '글'까지 지켜주지는 않는다 — 그 구멍을 여기서 막는다.
//
// 모드:
//  - 'flag'(기본): 문제 문장을 지우지 않고 issues로 보고만 한다. 산문 롤플레이에서 문장을 임의로
//    잘라내면 서사가 망가지므로, 기본은 탐지다. UI가 "근거 없는 숫자 N건"으로 알리면 사용자가
//    리롤할지 판단한다.
//  - 'redact': 레거시 동작. 문제 문장을 제거한다(실패 사건을 성공처럼 서술하는 경우엔 폴백으로 대체).

export type NarrativeIssueCode = 'failed-event-claim' | 'unsupported-number';
export interface NarrativeIssue { code: NarrativeIssueCode; detail?: string; }
export interface NarrativeVerification { text: string; issues: NarrativeIssue[]; }
export interface NarrativeVerifyInput {
  narrative: string;
  evidenceTexts?: string[];
  hasFailedProposedEvent?: boolean;
  fallback?: string;
  mode?: 'flag' | 'redact';
}

// 1,000 같은 자리구분 쉼표를 제거해 비교한다(서사는 '999,999', 엔진 로그는 999999로 쓴다).
function numericTokens(text: string): string[] {
  return Array.from(String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)).map((match) => match[0].replace(/,/g, ''));
}
function sentences(text: string): string[] {
  return String(text ?? '').split(/(?<=[.!?。！？]|다\.|요\.)\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
}

export function verifyNarrative(input: NarrativeVerifyInput): NarrativeVerification {
  const narrative = String(input.narrative ?? '').trim();
  const fallback = String(input.fallback ?? '엔진 판정 결과가 반영되었습니다.');
  const mode = input.mode ?? 'flag';

  // 제안한 사건이 엔진에서 실패했는데 서사가 성공처럼 말하면, 그 서사 자체를 신뢰할 수 없다.
  if (input.hasFailedProposedEvent) {
    const issues: NarrativeIssue[] = [{ code: 'failed-event-claim' }];
    return { text: mode === 'redact' ? fallback : narrative, issues };
  }

  const allowed = new Set(numericTokens((input.evidenceTexts ?? []).join('\n')));
  const issues: NarrativeIssue[] = [];
  const kept = sentences(narrative).filter((sentence) => {
    const unsupported = numericTokens(sentence).filter((token) => !allowed.has(token));
    if (!unsupported.length) return true;
    issues.push({ code: 'unsupported-number', detail: unsupported.join(',') });
    return false;
  });

  if (mode !== 'redact') return { text: narrative, issues }; // 탐지만 — 원문 보존
  return { text: kept.join('\n').trim() || (issues.length ? fallback : narrative), issues };
}
