import{describe,expect,it}from'vitest';import{LARGE_CARD_WARNING_BYTES,needsLargeCardWarning}from'./card-binary-store';
describe('large card import guard',()=>it('warns before files over 100MB are read into memory',()=>{expect(needsLargeCardWarning(LARGE_CARD_WARNING_BYTES)).toBe(false);expect(needsLargeCardWarning(LARGE_CARD_WARNING_BYTES+1)).toBe(true);}));
