import{describe,expect,it}from'vitest';import{compactAssetMacrosForPrompt,defaultCardPreset,compilePrompt,resolveAssetMacros,resolveNamedAsset}from'../src/index.ts';
const asset={name:'YSP default.png',type:'image',mime:'image/png',bytes:new Uint8Array([1,2,3])};
describe('card asset macros',()=>{
  it('resolves raw assets with normalized names and preserves missing macros with a warning',()=>{const found=resolveAssetMacros('{{raw::ysp.DEFAULT/png}}',[asset]);expect(found.content).toBe('data:image/png;base64,AQID');expect(found.warnings).toEqual([]);const missing=resolveAssetMacros('{{raw::missing}}',[asset]);expect(missing.content).toBe('{{raw::missing}}');expect(missing.warnings).toEqual([{code:'asset_missing',macro:'raw',name:'missing'}]);});
  it('renders the confirmed image forms and preserves unsupported or unknown macros with warnings',()=>{expect(resolveAssetMacros('{{img::YSP default.png}}',[asset]).content).toContain('<img src="data:image/png;base64,AQID"');for(const source of ['{{video::YSP default.png}}','{{invented::YSP default.png}}']){const result=resolveAssetMacros(source,[asset]);expect(result.content).toBe(source);expect(result.warnings[0]?.code).toBe('unsupported_asset_macro');}});
  it('never puts blob or data URLs into compiled prompts',()=>{const preset=defaultCardPreset();preset.blocks=[{id:'main',type:'plain',name:'main',enabled:true,role:'system',text:'asset={{raw::YSP default.png}}',source:null}];const result=compilePrompt({preset,card:{name:'Card'},assets:[asset]});expect(result.messages[0]?.content).toBe('asset=YSP default.png');expect(JSON.stringify(result)).not.toMatch(/blob:|data:/);expect(compactAssetMacrosForPrompt('{{raw::x}}').content).toBe('x');});
  it('keeps card assets first while allowing a namespaced lazy module URL',()=>{const card={...asset,url:'blob:card',bytes:null},module={...asset,url:'blob:module',bytes:null,moduleNamespace:'pack'};expect(resolveAssetMacros('{{raw::YSP default.png}}',[card,module]).content).toBe('blob:card');expect(resolveAssetMacros('{{raw::pack/YSP default.png}}',[card,module]).content).toBe('blob:module');});
  it('resolves an emotion command with the engine-owned outfit without overriding exact names',()=>{const variants=[{...asset,name:'silvia_default_0',mime:'image/avif'},{...asset,name:'silvia_default_2',mime:'image/avif'}];expect(resolveNamedAsset('silvia_default',variants)?.name).toBe('silvia_default_0');expect(resolveNamedAsset('silvia_default',variants,{outfits:{silvia:2}})?.name).toBe('silvia_default_2');expect(resolveNamedAsset('silvia_default_0',variants,{outfits:{silvia:2}})?.name).toBe('silvia_default_0');});
});

describe('맨 이름 에셋 — 모델이 매크로 없이 <img src="이름">을 쓸 때',()=>{
  const assets=[{name:'YSP_default',type:'image',mime:'image/png',bytes:new Uint8Array([1,2,3])},
                {name:'silvia_smile',type:'image',mime:'image/png',bytes:new Uint8Array([4,5,6])}];
  it('카드 에셋 이름을 data URL로 해석한다',()=>{
    const out=resolveAssetMacros('<div class="rp-image-wrap"><img src="YSP_default" class="rp-image-card"></div>',assets);
    expect(out.content).toContain('src="data:image/png;base64,');
    expect(out.content).toContain('rp-image-card'); // 카드가 준 클래스는 보존
    expect(out.warnings).toEqual([]);
  });
  it('대소문자 차이를 흡수한다',()=>{
    expect(resolveAssetMacros('<img src="SILVIA_SMILE">',assets).content).toContain('data:image/png;base64,');
  });
  it('없는 에셋은 깨진 아이콘 대신 이미지를 제거하고 경고한다',()=>{
    const out=resolveAssetMacros('<img src="nope_missing"> 본문은 남는다',assets);
    expect(out.content).not.toContain('<img');
    expect(out.content).toContain('본문은 남는다');
    expect(out.warnings[0]).toMatchObject({code:'asset_missing',name:'nope_missing'});
  });
  it('이미 URL인 src는 건드리지 않는다',()=>{
    const url='<img src="data:image/png;base64,AQID">';
    expect(resolveAssetMacros(url,assets).content).toBe(url);
  });
});

describe('꼬리 _ 폴백 (ADR 0004 경과 조치)', () => {
  it("'silvia_smile_'을 기존 에셋 'silvia_smile_apron'이 아니라 정확한 그룹 이름 'silvia_smile'로 해석한다", () => {
    const assets = [{ name: 'silvia_smile', type: 'image', mime: 'image/png', bytes: new Uint8Array([1]) }];
    const out = resolveAssetMacros('{{raw::silvia_smile_}}', assets);
    expect(out.content).toContain('data:image/png');
    expect(out.warnings).toEqual([]);
  });
});
