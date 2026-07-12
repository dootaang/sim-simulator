import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {compilePrompt,defaultCardPreset,type PromptCompileInput,type PromptPreset} from '../src/index.ts';

interface Fixture{comment:string;presetKind:string;presetOverrides?:{mainText?:string;chatRangeStart?:number;authorNoteDepth?:number;assistantPrefill?:string};input:Omit<PromptCompileInput,'preset'>;expected:{messages:ReturnType<typeof compilePrompt>['messages'];assistantPrefill:string;warnings:ReturnType<typeof compilePrompt>['warnings']}}
const fixtureDir=join(dirname(fileURLToPath(import.meta.url)),'fixtures','prompt-parity');
const fixtures=readdirSync(fixtureDir).filter((name)=>name.endsWith('.json')).sort().map((name)=>({name,value:JSON.parse(readFileSync(join(fixtureDir,name),'utf8')) as Fixture}));

function presetFor(fixture:Fixture):PromptPreset{
  const preset=defaultCardPreset(),overrides=fixture.presetOverrides??{};
  if(overrides.mainText!==undefined){const block=preset.blocks.find((value)=>value.id==='main');if(block?.type==='plain')block.text=overrides.mainText;}
  if(overrides.chatRangeStart!==undefined){const block=preset.blocks.find((value)=>value.id==='chat');if(block?.type==='chat')block.rangeStart=overrides.chatRangeStart;}
  if(overrides.assistantPrefill!==undefined)preset.settings.assistantPrefill=overrides.assistantPrefill;
  if(fixture.presetKind==='depth'){
    const chatIndex=preset.blocks.findIndex((value)=>value.id==='chat');
    preset.blocks.splice(chatIndex,0,{id:'authornote',type:'authornote',name:'작가 노트',enabled:true,role:'system',depth:overrides.authorNoteDepth??0,source:null});
  }
  if(fixture.presetKind==='simpack-additive'){
    preset.compatibilityMode='simpack';
    const actions=preset.blocks.find((value)=>value.id==='actions');if(actions)actions.enabled=true;
  }
  return preset;
}

describe('프롬프트 파리티 골든',()=>{
  for(const fixture of fixtures)it(`${fixture.name}: ${fixture.value.comment}`,()=>{
    const result=compilePrompt({preset:presetFor(fixture.value),...fixture.value.input});
    expect(result.messages).toEqual(fixture.value.expected.messages);
    expect(result.assistantPrefill).toBe(fixture.value.expected.assistantPrefill);
    expect(result.warnings).toEqual(fixture.value.expected.warnings);
  });

  it('카드 네 원문 필드를 손실 없이 보존한다',()=>{
    const card={name:'아린',description:'설명 원문 ①',personality:'성격 원문 ②',scenario:'상황 원문 ③',systemPrompt:'시스템 원문 ④'};
    const output=compilePrompt({preset:defaultCardPreset(),card}).messages.map((message)=>message.content).join('\n');
    for(const original of [card.description,card.personality,card.scenario,card.systemPrompt])expect(output).toContain(original);
  });

  it('{{original}} 병합 뒤에도 카드와 프리셋 원문을 모두 보존한다',()=>{
    const preset=defaultCardPreset(),main=preset.blocks.find((value)=>value.id==='main');if(main?.type==='plain')main.text='프리셋 원문';
    const output=compilePrompt({preset,card:{name:'아린',systemPrompt:'카드 앞 {{original}} 카드 뒤'}}).messages[0]?.content;
    expect(output).toBe('카드 앞 프리셋 원문 카드 뒤');
  });

  it('페르소나·로어·chat range·depth의 선언 순서를 지킨다',()=>{
    const fixture=fixtures.find(({name})=>name.startsWith('03-'))!.value;
    expect(compilePrompt({preset:presetFor(fixture),...fixture.input}).messages.map((message)=>message.content)).toEqual(['D.','유저는 페르.','L1\n\nL2','u2','a2','AN','u3','a3']);
  });

  it('SimPack 엔진 지시는 Risu 원문에 가산적이다',()=>{
    const fixture=fixtures.find(({name})=>name.startsWith('04-'))!.value,input=fixture.input;
    const risu=compilePrompt({preset:defaultCardPreset(),card:input.card});
    const simpack=compilePrompt({preset:presetFor(fixture),...input});
    const engine=new Set(['엔진 사실','가능 행동']);
    expect(simpack.messages.filter((message)=>!engine.has(message.content))).toEqual(risu.messages);
  });

  it('미지원 매크로는 원문과 경고 양쪽에 남는다',()=>{
    const fixture=fixtures.find(({name})=>name.startsWith('05-'))!.value,result=compilePrompt({preset:presetFor(fixture),...fixture.input});
    expect(result.messages[0]?.content).toContain('{{getvar::x}}');
    expect(result.warnings).toContainEqual({code:'unsupported_macro',path:'card.description',detail:'getvar::x'});
  });
});
