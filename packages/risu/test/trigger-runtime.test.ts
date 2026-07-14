import { describe, expect, it } from 'vitest';
import { runCardTriggers } from '../src/trigger-runtime.ts';

// ADR 0004 M-C — 업스트림 트리거 v1 실행기의 골든 테스트. 조건(var)·효과(setvar)·display 데이터 수정이
// 리스 카드 그대로 동작하고, 변수는 세션 cbsVariables와 왕복 동기화된다.
describe('Risu 트리거 전체 이식 (trigger-runtime)', () => {
  it('display 트리거는 v2 효과만 실행한다 — v1 setvar는 차단되어 렌더가 상태를 못 바꾼다(업스트림 displayAllowList)', async () => {
    const blocked = await runCardTriggers({
      mode: 'display',
      triggers: [{ comment: '위험', type: 'display', conditions: [], effect: [{ type: 'setvar', operator: '=', var: 'seen', value: '1' }] }],
      variables: { mood: 'happy' },
      displayData: '그녀가 인사했다',
    });
    expect(blocked.variables).toEqual({ mood: 'happy' }); // v1 setvar는 실행되지 않는다
    expect(blocked.ephemeral).toEqual({});
    expect(blocked.displayData).toBe('그녀가 인사했다');
    // 허용된 v2 효과(디스플레이 상태)는 휘발성 tempVars로만 남는다
    const allowed = await runCardTriggers({
      mode: 'display',
      triggers: [{ type: 'display', conditions: [], effect: [{ type: 'v2SetDisplayState', var: 'badge', value: 'apron' } as never] }],
      variables: {},
      displayData: 'x',
    });
    expect(allowed.variables).toEqual({}); // 세션 변수는 여전히 불변
  });
  it('조건(var)이 참이면 효과가 실행되고 거짓이면 실행되지 않는다', async () => {
    const yes = await runCardTriggers({ mode: 'output', triggers: [{ type: 'output', conditions: [{ type: 'var', var: 'mood', value: 'happy', operator: '=' }], effect: [{ type: 'setvar', operator: '=', var: 'seen', value: '1' }] }], variables: { mood: 'happy' } });
    expect(yes.variables.seen).toBe('1');
    const no = await runCardTriggers({ mode: 'output', triggers: [{ type: 'output', conditions: [{ type: 'var', var: 'mood', value: 'happy', operator: '=' }], effect: [{ type: 'setvar', operator: '=', var: 'seen', value: '1' }] }], variables: { mood: 'sad' } });
    expect(no.variables.seen).toBeUndefined();
  });
  it('setvar의 산술 연산자(+=)와 CBS 치환({{getvar}})이 함께 동작한다', async () => {
    const result = await runCardTriggers({
      mode: 'output',
      triggers: [{ type: 'output', conditions: [], effect: [{ type: 'setvar', operator: '+=', var: 'count', value: '2' }, { type: 'setvar', operator: '=', var: 'echo', value: '{{getvar::count}}!' }] }],
      variables: { count: '3' },
    });
    expect(result.variables.count).toBe('5');
    expect(result.variables.echo).toBe('5!');
  });
  it('모드가 다른 트리거는 실행되지 않고, 트리거가 없으면 원문이 그대로 돌아온다', async () => {
    const result = await runCardTriggers({ mode: 'display', triggers: [{ type: 'output', conditions: [], effect: [{ type: 'setvar', operator: '=', var: 'x', value: '1' }] }], variables: {}, displayData: '원문' });
    expect(result).toEqual({ displayData: '원문', stopSending: false, variables: {}, ephemeral: {} });
  });
  it('Lua 트리거는 통째로 무해화되고(M-D 전) 같은 카드의 v1 트리거는 계속 동작한다', async () => {
    const result = await runCardTriggers({
      mode: 'output',
      triggers: [
        { type: 'output', conditions: [], effect: [{ type: 'triggerlua', code: 'setChatVar("hacked","1")' }] }, // 업스트림: 첫 효과가 lua면 트리거 전체가 코드 경로
        { type: 'output', conditions: [], effect: [{ type: 'setvar', operator: '=', var: 'after', value: 'ok' }] },
      ],
      variables: {},
    });
    expect(result.variables.hacked).toBeUndefined();
    expect(result.variables.after).toBe('ok');
  });
});
