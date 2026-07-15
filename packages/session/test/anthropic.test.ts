import {describe,expect,it} from 'vitest';
import type {CompiledPrompt} from '@simbot/risu';
import {anthropicPromptParts,createAnthropicProvider} from '../src/providers/anthropic.ts';

const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const basePrompt:Pick<CompiledPrompt,'assistantPrefill'|'trace'|'warnings'>={assistantPrefill:'',trace:[],warnings:[]};

describe('Anthropic prompt caching and usage',()=>{
  it('splits stable and volatile system blocks and puts cache_control on the stable prefix',async()=>{
    let sent:Record<string,unknown>={};
    const prompt:CompiledPrompt={...basePrompt,messages:[
      {role:'system',content:'main'},{role:'system',content:'card description'},
      {role:'system',content:'lore'},{role:'user',content:'hello'},{role:'system',content:'engine facts'},
    ],messageMeta:[{blockType:'plain'},{blockType:'description'},{blockType:'lorebook'},{blockType:'chat'},{blockType:'engineFacts'}]};
    const provider=createAnthropicProvider({apiKey:'k',model:'m',fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return response({content:[{type:'text',text:'ok'}]});}});
    await provider.complete({prompt,format:'prose'});
    expect(sent.system).toEqual([
      {type:'text',text:'main\n\ncard description',cache_control:{type:'ephemeral'}},
      {type:'text',text:'lore\n\nengine facts'},
    ]);
  });

  it('recombines cached segments to the exact legacy system string',async()=>{
    let sent:Record<string,unknown>={};
    const messages=[{role:'system',content:'main'},{role:'system',content:'persona'},{role:'user',content:'hello'},{role:'system',content:'memory'}] as const;
    const messageMeta=[{blockType:'plain'},{blockType:'persona'},{blockType:'chat'},{blockType:'memory'}];
    const provider=createAnthropicProvider({apiKey:'k',model:'m',fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return response({content:[{type:'text',text:'ok'}]});}});
    await provider.complete({prompt:{...basePrompt,messages:[...messages],messageMeta},format:'prose'});
    const blocks=sent.system as Array<{text:string}>;
    expect(blocks.map(block=>block.text).join('\n\n')).toBe(anthropicPromptParts([...messages]).system);
  });

  it('keeps the legacy request body byte-identical when message metadata is absent',async()=>{
    let rawBody='';
    const prompt:CompiledPrompt={...basePrompt,messages:[{role:'system',content:'rule one'},{role:'system',content:'rule two'},{role:'user',content:'hello'}]};
    const provider=createAnthropicProvider({apiKey:'k',model:'legacy-model',fetch:async(_url,init)=>{rawBody=String(init?.body);return response({content:[{type:'text',text:'ok'}]});}});
    await provider.complete({prompt,format:'prose'});
    expect(rawBody).toBe('{"model":"legacy-model","max_tokens":4096,"system":"rule one\\n\\nrule two","messages":[{"role":"user","content":"hello"}]}');
  });

  it('returns measured Anthropic token usage including cache reads and writes',async()=>{
    const provider=createAnthropicProvider({apiKey:'k',model:'m',fetch:async()=>response({content:[{type:'text',text:'ok'}],usage:{input_tokens:100,output_tokens:25,cache_read_input_tokens:300,cache_creation_input_tokens:40}})});
    const result=await provider.complete({prompt:{...basePrompt,messages:[{role:'user',content:'hello'}]},format:'prose'});
    expect(result.usage).toEqual({inputTokens:440,outputTokens:25});
  });
});
