import{describe,expect,it}from'vitest';
import{joinBytes,makePngChunk,parseCard,PNG_SIGNATURE}from'@simbot/card';
import{buildCompilerPrompt}from'../src/compiler-prompt.ts';
import{diagnoseCard}from'../src/diagnosis.ts';
import{mineCard}from'../src/lua-mine.ts';

const strToU8=(value:string)=>new TextEncoder().encode(value);
const b64=(value:unknown)=>btoa(String.fromCharCode(...strToU8(JSON.stringify(value))));

describe('card diagnosis honesty',()=>{
  it('reports a PNG embedded Risu program instead of crashing or silently dropping it',()=>{
    const root={spec:'chara_card_v3',spec_version:'3.0',data:{name:'Runtime card',alternate_greetings:['a'],assets:[{name:'face',type:'emotion',ext:'png',uri:'embedded:0'}],character_book:{entries:[{content:'전투와 상점'}]},extensions:{risuai:{customScripts:[{in:'x',out:'y',type:'editdisplay'}],defaultVariables:'day=1\ngold=20',triggerscript:[{effect:[{type:'triggerlua',code:'local SHOP_COST = 20'}]}],backgroundHTML:'1234',lowLevelAccess:true}}}};
    const png=joinBytes(PNG_SIGNATURE,makePngChunk('tEXt',strToU8(`chara-ext-asset_:0\0${btoa('img')}`)),makePngChunk('tEXt',strToU8(`ccv3\0${b64(root)}`)),makePngChunk('IEND',new Uint8Array())),parsed=parseCard(png,'runtime.png'),mined=mineCard(parsed),coverage=buildCompilerPrompt(parsed,mined).coverage,diagnosis=diagnoseCard(parsed,mined,coverage);
    expect(diagnosis.classification).toBe('script-assisted-sim');
    expect(diagnosis.runtime).toMatchObject({luaChars:20,defaultVariableLines:2,regexScripts:1,triggerScripts:1,htmlChars:4,lowLevelAccess:true});
    expect(diagnosis.assets).toMatchObject({count:1,found:1,embeddedChunks:1});
    expect(diagnosis.content).toMatchObject({loreEntries:1,alternateGreetings:1});
    expect(diagnosis.issues.some(issue=>issue.code==='low_level_runtime_required')).toBe(true);
  });
});
