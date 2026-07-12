import { describe, expect, it } from 'vitest';
import { toFactLine } from './FactReceipt.svelte';

describe('사실 영수증 — 엔진 로그를 사람이 읽는 확정 사실로', () => {
  it('gold_delta를 골드 델타·잔액으로 읽는다', () => {
    const l = toFactLine({ ok: true, event: 'gold_delta', amount: 35000, before: 1000000, after: 1035000, reason: '점심 매출' }, 0);
    expect(l).toMatchObject({ icon: '🪙', label: '골드', delta: '+35,000', after: '1,035,000', note: '점심 매출', rejected: false });
  });

  it('자원 감소는 하락 표시(음수 델타)로 읽는다', () => {
    const l = toFactLine({ ok: true, event: 'resource_delta', resource: 'food', amount: -5, before: 200, after: 195 }, 1);
    expect(l).toMatchObject({ icon: '🍚', label: '식자재', delta: '-5', after: '195' });
  });

  it('scale_delta의 등급 변화를 note로 보여준다', () => {
    const l = toFactLine({ ok: true, event: 'scale_delta', scale: 'affinity', target: 'silvia', delta: 6, after: 26, tierChanged: { from: { label: '지인' }, to: { label: '친구' } } }, 2);
    expect(l).toMatchObject({ label: 'silvia affinity', delta: '+6', after: '26', note: '지인 → 친구' });
  });

  it('LLM이 차단된 이벤트를 시도하면 거부 사실로 읽는다(치트 채널 차단 가시화)', () => {
    const l = toFactLine({ ok: false, event: 'gold_delta', reason: 'model_event_not_allowed' }, 3);
    expect(l.rejected).toBe(true);
    expect(l.note).toContain('엔진이 차단');
  });

  it('알 수 없는 성공 이벤트도 안전하게 요약한다', () => {
    const l = toFactLine({ ok: true, event: 'mystery_event', amount: 3, after: 9 }, 4);
    expect(l).toMatchObject({ icon: '⚙️', label: 'mystery_event', delta: '+3', after: '9', rejected: false });
  });
});
