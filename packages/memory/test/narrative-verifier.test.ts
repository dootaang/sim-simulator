import { describe, expect, it } from 'vitest';
import { verifyNarrative } from '../src/narrative-verifier.ts';

// 회귀: 이 검증기는 레거시 앱에 있었으나 모노레포 마이그레이션(03074d8)이 삭제했다.
// 옛 테스트(app/test/narrativeVerifier.test.ts)를 그대로 되살리고, 기본 모드(flag)를 추가 검증한다.

describe('narrative verifier — 서사가 엔진 사실을 참칭하지 못하게', () => {
  it('redact: 실패한 엔진 사건이 있으면 성공처럼 보이는 서사를 폴백으로 교체한다', () => {
    const result = verifyNarrative({ narrative: '실비아가 정식 직원이 되어 환하게 웃었다.', hasFailedProposedEvent: true, fallback: '고용 조건을 충족하지 못했습니다.', mode: 'redact' });
    expect(result.text).toBe('고용 조건을 충족하지 못했습니다.');
    expect(result.issues[0]?.code).toBe('failed-event-claim');
  });

  it('redact: 근거 없는 숫자가 든 문장만 제거한다', () => {
    const result = verifyNarrative({
      narrative: '실비아가 고개를 끄덕였다. 금고에는 999,999원이 쌓였다. 다음 이야기를 기다린다.',
      evidenceTexts: ['현재 골드 500,000원'],
      mode: 'redact',
    });
    expect(result.text).not.toMatch(/999,999/);
    expect(result.text).toMatch(/실비아가 고개/);
    expect(result.text).toMatch(/다음 이야기/);
    expect(result.issues[0]?.detail).toBe('999999');
  });

  it('상태·사용자 발언에 실제 있는 숫자는 문제 삼지 않는다', () => {
    const result = verifyNarrative({ narrative: '일급 10,000원을 제안했다.', evidenceTexts: ['사용자: 일급 만 원, 즉 10,000원으로 하자'] });
    expect(result.text).toBe('일급 10,000원을 제안했다.');
    expect(result.issues).toEqual([]);
  });

  it('flag(기본): 원문을 자르지 않고 근거 없는 숫자만 보고한다', () => {
    const narrative = '금고에는 250만 골드가 있다. 실비아가 웃었다.';
    const result = verifyNarrative({ narrative, evidenceTexts: ['gold_delta 결과: {"after":1035000}'] });
    expect(result.text).toBe(narrative); // 서사는 그대로 — 잘라내면 산문이 망가진다
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported-number');
    expect(result.issues[0]?.detail).toBe('250');
  });

  it('엔진 영수증에 있는 숫자는 쉼표 표기가 달라도 통과한다', () => {
    const result = verifyNarrative({ narrative: '금고에 1,035,000 골드가 남았다.', evidenceTexts: ['gold_delta 결과: {"after":1035000}'] });
    expect(result.issues).toEqual([]);
  });
});
