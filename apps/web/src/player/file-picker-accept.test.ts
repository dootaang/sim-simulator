import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';import{compatibleFileAccept,usesAppleTouchFilePicker}from'./file-picker-accept';

describe('iOS/iPadOS custom file picker compatibility',()=>{
  it.each([
    ['iPhone',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',platform:'iPhone',maxTouchPoints:5},true],
    ['classic iPad',{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',platform:'iPad',maxTouchPoints:5},true],
    ['desktop-disguised iPad',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5},true],
    ['real Mac',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:0},false],
    ['touch Windows',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',platform:'Win32',maxTouchPoints:10},false],
  ])('%s detection',(_name,value,expected)=>expect(usesAppleTouchFilePicker(value)).toBe(expected));

  it('omits accept only for Apple touch pickers and preserves the desktop filter',()=>{
    const filter='.charx,.zip';
    expect(compatibleFileAccept(filter,{platform:'MacIntel',maxTouchPoints:5})).toBeUndefined();
    expect(compatibleFileAccept(filter,{platform:'MacIntel',maxTouchPoints:0})).toBe(filter);
    expect(compatibleFileAccept(filter,{platform:'Win32',maxTouchPoints:10})).toBe(filter);
  });

  it('routes every custom-extension input through the shared compatibility helper',()=>{
    const sources=[
      readFileSync(new URL('./PlayerPage.svelte',import.meta.url),'utf8'),
      readFileSync(new URL('./PromptPanel.svelte',import.meta.url),'utf8'),
      readFileSync(new URL('../editor/EditorPage.svelte',import.meta.url),'utf8'),
    ],joined=sources.join('\n');
    expect(joined.match(/compatibleFileAccept\(/g)).toHaveLength(5);
    expect(joined).not.toMatch(/accept="[^"]*\.(?:charx|simpack|risum|risup|risupreset|preset)/i);
  });
});
