// SPDX-License-Identifier: GPL-3.0-or-later
// C0-1 / C2 — abstention 결정: '관련 기억 없음'을 언제 택할지.
// 임계값은 실측 전이라 uncalibrated로 표시하고 확정하지 않는다(핸드오프 금지선).
// 개념 참고: LIBRA evidence gate(off|soft|strict) 아이디어. 코드 미복사, 재구현.

import type { RetrievalHit } from './contracts.ts';

export type EvidenceGate = 'off' | 'soft' | 'strict';

export interface AbstentionConfig {
  gate: EvidenceGate;
  // 상위 hit의 최소 신뢰도. 실측 전 잠정값(experimental/uncalibrated).
  minConfidence: number;
  calibrated: false;
}

export const DEFAULT_ABSTENTION: AbstentionConfig = {
  gate: 'soft',
  minConfidence: 0.15,
  calibrated: false,
};

export interface AbstentionDecision {
  abstain: boolean;
  confidence: number;
  reason: string;
}

// 상위 hit 점수 분포로 신뢰도를 근사한다.
//  - off: 절대 abstain 안 함(기준선)
//  - soft: 최상위 점수가 임계 미만이면 abstain
//  - strict: 최상위와 차상위 격차(margin)까지 요구 — 근소하게 헷갈리면 abstain
export function decideAbstention(hits: RetrievalHit[], config: AbstentionConfig = DEFAULT_ABSTENTION): AbstentionDecision {
  if (config.gate === 'off') return { abstain: false, confidence: hits[0] ? (hits[0].evidenceScore ?? hits[0].score) : 0, reason: 'gate-off' };
  if (!hits.length) return { abstain: true, confidence: 0, reason: 'no-hits' };
  const top = hits[0].evidenceScore ?? hits[0].score ?? 0;
  const second = hits[1] ? (hits[1].evidenceScore ?? hits[1].score ?? 0) : 0;
  const margin = top - second;
  // 점수 정규화 없이 상대 신뢰도만 본다(uncalibrated) — 실측에서 임계 보정.
  const confidence = top;
  if (config.gate === 'soft') {
    if (confidence < config.minConfidence) return { abstain: true, confidence, reason: 'below-min-confidence' };
    return { abstain: false, confidence, reason: 'ok' };
  }
  // strict
  if (confidence < config.minConfidence) return { abstain: true, confidence, reason: 'below-min-confidence' };
  if (margin < config.minConfidence * 0.5) return { abstain: true, confidence, reason: 'ambiguous-margin' };
  return { abstain: false, confidence, reason: 'ok' };
}
