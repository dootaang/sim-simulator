import { describe, expect, it } from 'vitest';
import { applyRegexScripts } from '../src/card-regex.ts';
import { processScriptsCore } from '../src/port/scripts.ts';

// ADR 0004 — RisuAI scripts.ts(eb7780b) 전체 이식의 골든 테스트.
// 부분집합 시절에 없던 업스트림 의미론이 실카드 그대로 동작함을 고정한다.
describe('Risu 정규식 전체 이식 (port/scripts)', () => {
  it('<order N> 메타가 실행 순서를 내림차순으로 바꾼다', () => {
    const out = applyRegexScripts('x', [
      { in: 'x', out: 'first', type: 'editdisplay', flag: 'g<order 1>' },
      { in: 'x', out: 'second', type: 'editdisplay', flag: 'g<order 9>' },
    ], 'display');
    expect(out).toBe('second'); // order 내림차순: 9가 먼저 실행돼 x→second, order 1 차례엔 x가 없어 그대로
  });
  it('<cbs> 액션이 in 패턴을 parser로 먼저 파싱한다', () => {
    const out = applyRegexScripts('안녕 주인장', [{ in: '{{user}}', out: '사장님', type: 'editdisplay', flag: 'g<cbs>' }], 'display', { parser: (text) => text.replaceAll('{{user}}', '주인장') });
    expect(out).toBe('안녕 사장님');
  });
  it('@@move_top은 매치를 본문에서 떼어 맨 위로 올리고 $1 치환을 지원한다', () => {
    const out = applyRegexScripts('이야기 [배너:용사여관] 계속', [{ in: '\\[배너:([^\\]]+)\\]', out: '@@move_top ★ $1', type: 'editdisplay', flag: 'g' }], 'display');
    expect(out).toBe('★ 용사여관\n이야기  계속');
  });
  it('$n은 개행이 되고, >로 끝나는 out에는 개행이 붙으며 <no_end_nl>이 막는다', () => {
    expect(applyRegexScripts('a', [{ in: 'a', out: '1$n2', type: 'editdisplay' }], 'display')).toBe('1\n2');
    expect(applyRegexScripts('a', [{ in: 'a', out: '<b>', type: 'editdisplay', flag: 'g' }], 'display')).toBe('<b>\n');
    expect(applyRegexScripts('a', [{ in: 'a', out: '<b>', type: 'editdisplay', flag: 'g<no_end_nl>' }], 'display')).toBe('<b>');
  });
  it('@@repeat_back end_nl은 직전 같은 역할 메시지의 매치를 끝에 개행으로 붙인다', () => {
    const { data } = processScriptsCore('이번 응답', [{ in: '\\[상태:[^\\]]+\\]', out: '@@repeat_back end_nl', type: 'editdisplay', flag: 'g' }], 'editdisplay', { previousSameRole: () => '지난 응답 [상태:평온]' });
    expect(data).toBe('이번 응답\n[상태:평온]');
  });
  it('@@emo는 emotionSink 훅으로 감정 이름을 보내고 본문은 보존한다', () => {
    const seen: string[] = [];
    const { data, emoChanged } = processScriptsCore('그녀가 웃었다', [{ in: '웃었다', out: '@@emo smile', type: 'editdisplay', flag: 'g' }], 'editdisplay', { emotionSink: (name) => seen.push(name) });
    expect(seen).toEqual(['smile']);
    expect(emoChanged).toBe(true);
    expect(data).toBe('그녀가 웃었다');
  });
  it('치환 결과는 parser로 재파싱된다 — 정규식 out의 CBS 변수가 그 자리에서 평가된다 (outfit 사례)', () => {
    const out = applyRegexScripts('<img src="silvia_smile">', [{ in: '<img src="(\\w+)_(\\w+)">', out: '{{raw::$1_$2_{{getvar::outfit}}}}', type: 'editdisplay', flag: 'g' }], 'display', { parser: (text) => text.replaceAll('{{getvar::outfit}}', '2') });
    expect(out).toContain('{{raw::silvia_smile_2}}');
  });
  it('우리 강화는 유지된다 — catastrophic 패턴 스킵과 위험 out 정화', () => {
    expect(applyRegexScripts('aaaa!', [{ in: '(a+)+', out: 'x', type: 'editdisplay' }], 'display')).toBe('aaaa!');
    expect(applyRegexScripts('x', [{ in: 'x', out: '<script>bad</script>안전', type: 'editdisplay' }], 'display')).toBe('안전');
  });

  it('꼬리 _ 이름(outfit 변수 미충전)은 변형 그룹의 기본으로 폴백해 렌더된다 — M-D 전 경과 조치', () => {
    const out = applyRegexScripts('<img src="silvia_smile">', [{ in: String.raw`<img src="(\w+)_(\w+)">`, out: '{{raw::$1_$2_{{getvar::outfit}}}}', type: 'editdisplay', flag: 'g' }], 'display', { parser: (text) => text.replaceAll('{{getvar::outfit}}', '') });
    expect(out).toContain('{{raw::silvia_smile_}}');
  });
});
