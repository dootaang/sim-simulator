import { describe, expect, it } from 'vitest';
import { eventId, failure, success } from '../src/index.ts';
describe('contracts', () => { it('브랜드 id와 Result가 런타임 값을 바꾸지 않는다', () => { expect(eventId('time/advance')).toBe('time/advance'); expect(success(1)).toEqual({ ok:true, value:1 }); expect(failure('x')).toEqual({ ok:false, error:'x' }); }); });
