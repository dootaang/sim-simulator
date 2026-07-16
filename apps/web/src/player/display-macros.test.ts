import{describe,expect,it,vi}from'vitest';vi.mock('@simbot/ui/sanitize-html',()=>({sanitizeHtml:(source:string)=>source}));import{renderDisplayContent}from'./display-macros';

describe('display asset compatibility',()=>{it('resolves a bare Risu image name before sanitizing the message',()=>{const result=renderDisplayContent('<img src="YSP_default">','User','Card',[{name:'YSP_default',type:'image',mime:'image/png',bytes:Uint8Array.of(1,2,3)}]);expect(result.html).toContain('src="data:image/png;base64,AQID"');expect(result.html).not.toContain('src="YSP_default"');expect(result.warnings).toEqual([]);});});
describe('outfit-aware display assets',()=>{it('turns silvia_default into the current AVIF outfit before sanitizing',()=>{const assets=[{name:'silvia_default_0',type:'emotion',mime:'image/avif',bytes:Uint8Array.of(1)},{name:'silvia_default_2',type:'emotion',mime:'image/avif',bytes:Uint8Array.of(2)}],result=renderDisplayContent('<img src="silvia_default">','User','Card',assets,[],{},0,0,{outfits:{silvia:2}});expect(result.html).toContain('src="data:image/avif;base64,Ag=="');expect(result.html).not.toContain('silvia_default');expect(result.warnings).toEqual([]);});});

describe('정규식이 에셋 해석보다 먼저 원문을 본다 (업스트림 순서 — DOMINIUM 회귀)',()=>{
  it("<img=\"이름\"> 원문 문법에 매칭되는 카드 정규식이 살아 있고, 에셋은 정규식 결과 위에서 해석된다",()=>{
    const scripts=[{in:'@\\s*<img="(.*?)">\\s*\\|\\s*(.*?)\\s*\\|\\s*(.*?)\\s*@',out:'<div class="char-card"><img src="$1"><b>$2</b><span>$3</span></div>',type:'editdisplay',flag:'',comment:''}];
    const assets=[{name:'pic',type:'image',mime:'image/png',bytes:Uint8Array.of(1,2,3)}];
    const result=renderDisplayContent('@<img="pic">|엘로웬|이단심문소 종자@','User','Card',assets,scripts);
    expect(result.html).toContain('class="char-card"');            // 카드 정규식이 매칭됐다
    expect(result.html).toContain('src="data:image/png;base64,AQID"'); // 정규식 결과 속 이름이 실제 이미지로
    expect(result.html).not.toContain('<img="');                   // 원문 문법이 그대로 새지 않는다
    expect(result.warnings).toEqual([]);
  });
});

describe('카드의 자체 반응형 분기 — screen_width가 메시지 CBS에도 공급된다',()=>{
  it('넓은 화면에서만 넓은 분기가 켜진다',()=>{
    const content='{{#if {{? {{screen_width}} > 768 }} }}WIDE{{/if}}BASE';
    expect(renderDisplayContent(content,'User','Card',[],[],{},0,0,{screenWidth:1024}).html).toContain('WIDE');
    expect(renderDisplayContent(content,'User','Card',[],[],{},0,0,{screenWidth:390}).html).not.toContain('WIDE');
    expect(renderDisplayContent(content,'User','Card',[],[],{},0,0,{screenWidth:390}).html).toContain('BASE');
  });
});

describe('카드 <style>은 @scope로 가둬 보존한다 (안전 CSS 부분집합)',()=>{
  it('스타일을 뽑아 스코프에 넣고 잔여 CBS·@import·외부 url·fixed를 중화하며 중복은 한 번만 남긴다',()=>{
    const css='<style>.x{color:red;position:fixed;background:url(https://evil.test/a.png)}@import "https://evil.test/b.css";{{getvar::secret}}</style>';
    const result=renderDisplayContent(`${css}${css}<div class="x">hi</div>`,'User','Card',[]);
    expect(result.html.startsWith('<style>@scope (.lucky-card-surface){')).toBe(true);
    expect(result.html).toContain('position:relative');
    expect(result.html).not.toContain('position:fixed');
    expect(result.html).not.toContain('@import');
    expect(result.html).not.toContain('evil.test');
    expect(result.html).not.toContain('getvar');
    expect(result.html.match(/@scope/g)).toHaveLength(1); // 같은 CSS 두 번 선언은 한 번만
    expect(result.html).toContain('class="x"');
  });
});
