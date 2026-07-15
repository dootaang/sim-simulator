import {describe,expect,it} from 'vitest';
import {compilePrompt,type PromptPreset} from '../src/index.ts';

const source=null;
const preset:PromptPreset={contract:'prompt-preset/0.1',id:'meta',name:'meta',compatibilityMode:'risu',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[
  {id:'main',type:'plain',name:'main',enabled:true,role:'system',text:'main',source},
  {id:'lore',type:'lorebook',name:'lore',enabled:true,role:'system',source},
  {id:'note',type:'authornote',name:'note',enabled:true,role:'system',depth:1,source},
  {id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source},
  {id:'post',type:'postEverything',name:'post',enabled:true,role:'system',source},
]};

describe('compiled prompt message metadata',()=>{
  it('stays index-aligned through emit, chat, author-note splice, and postEverything expansion',()=>{
    const result=compilePrompt({preset,card:{name:'Card'},lore:{entries:[{content:'lore'}]},authorNote:{content:'note'},chat:[{role:'user',content:'u'},{role:'assistant',content:'a'}],postEverything:[{role:'system',content:'post-system'},{role:'user',content:'post-user'}]});
    expect(result.messages.map(message=>message.content)).toEqual(['main','lore','u','a','post-system','note','post-user']);
    expect(result.messageMeta).toEqual([{blockType:'plain'},{blockType:'lorebook'},{blockType:'chat'},{blockType:'chat'},{blockType:'postEverything'},{blockType:'authornote'},{blockType:'postEverything'}]);
    expect(result.messageMeta).toHaveLength(result.messages.length);
  });

  it('keeps metadata aligned when consecutive roles are merged',()=>{
    const result=compilePrompt({preset:{...preset,blocks:preset.blocks.slice(0,2)},card:{name:'Card'},lore:{entries:[{content:'lore'}]},options:{mergeConsecutiveRoles:true}});
    expect(result.messages).toEqual([{role:'system',content:'main\n\nlore'}]);
    expect(result.messageMeta).toEqual([{blockType:'merged'}]);
  });
});
