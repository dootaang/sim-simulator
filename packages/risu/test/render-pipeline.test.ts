import{describe,expect,it}from'vitest';
import{applyRegexScripts,calcString,parseCbs,resolveAssetMacros,type RegexScript}from'../src/index.ts';

const innRule:RegexScript={in:'<img src="(silvia)_(smile)">',out:'<div class="rp-image-wrap"><img src="{{raw::$1_$2_{{getvar::npc_$1_outfit}}}}" class="rp-image-card"></div>',type:'editdisplay',flag:'g'};

describe('Risu 표시 파이프라인',()=>{
  it('용사여관 맨 이름 출력을 의상 변수와 실제 data URL로 만든다',()=>{const regex=applyRegexScripts('<img src="silvia_smile">',[innRule],'display');expect(regex).toContain('{{raw::silvia_smile_{{getvar::npc_silvia_outfit}}}}');const cbs=parseCbs(regex,{variables:{npc_silvia_outfit:'apron'}});expect(cbs).toContain('{{raw::silvia_smile_apron}}');const asset=resolveAssetMacros(cbs,[{name:'silvia_smile_apron',type:'image',mime:'image/png',bytes:new Uint8Array([1,2,3])}]);expect(asset.content).toContain('<img src="data:image/png;base64,AQID"');});
  it('위험한 출력과 파괴적 패턴을 무력화하고 특수 치환 토큰을 문자로 둔다',()=>{const malicious=applyRegexScripts('x',[{in:'x',out:'<script>x</script><img src="javascript:x" onerror="x">',type:'editdisplay'}],'display');expect(malicious).not.toMatch(/script|javascript:|onerror/i);expect(applyRegexScripts('aaaa!',[{in:'(a+)+',out:'x',type:'editdisplay'}],'display')).toBe('aaaa!');expect(applyRegexScripts('before x after',[{in:'x',out:"$&-$`-$'-$1",type:'editdisplay'}],'display')).toBe('before x-before - after-$1 after');}); // ADR 0004: 업스트림 네이티브 치환 의미론 채택
  it('Risu editrequest 스크립트를 모델 요청 단계에 적용한다',()=>{expect(applyRegexScripts('before',[{in:'before',out:'after',type:'editrequest'}],'process')).toBe('after');});
  it('CBS는 미지 함수를 잔재 없이 통과시키고 eval 없는 산술 결과를 낸다',()=>{expect(parseCbs('a{{unknown::x}}b',{variables:{}})).toBe('ab');expect(calcString('(2+3)*4')).toBe('20');expect(parseCbs('{{#if {{greater::3::2}}}}yes{{:else}}no{{/if}}',{variables:{}})).toBe('yes');});
  it('배경 CBS는 화면 너비를 계산하고 배경 에셋 매크로를 다음 단계까지 보존한다',()=>{const rendered=parseCbs('{{#if {{? {{screen_width}} > 768 }} }}wide{{:else}}small{{/if}} {{bg::room}}',{variables:{},screenWidth:1200});expect(rendered).toBe('wide {{bg::room}}');});
});

describe('Risu raw assets in HTML attributes',()=>{
  it('preserves a simple raw macro through CBS and resolves it to the card asset URL',()=>{
    const source='<div class="rp-image-wrap"><img src="{{raw::YSP_default}}" class="rp-image-card"></div>';
    const cbs=parseCbs(source,{variables:{}});
    expect(cbs).toBe(source);
    const resolved=resolveAssetMacros(cbs,[{name:'YSP_default',type:'x-risu-asset',mime:'image/webp',bytes:new Uint8Array([1,2,3])}],{bare:false});
    expect(resolved.content).toContain('<img src="data:image/webp;base64,AQID" class="rp-image-card">');
    expect(resolved.warnings).toEqual([]);
  });
});
