import{describe,expect,it}from'vitest';
import type{PromptPreset,RuntimeWorkerSuccess}from'@simbot/risu';
import{ProjectRuntime}from'@simbot/runtime';
import{PlaySession}from'../src/index.ts';

const source={source:'user' as const,path:'test'},preset:PromptPreset={contract:'prompt-preset/0.1',id:'p',name:'p',compatibilityMode:'simpack',version:1,raw:null,settings:{assistantPrefill:'',sendNames:false,sendChatAsSystem:false},blocks:[{id:'chat',type:'chat',name:'chat',enabled:true,rangeStart:-1000,rangeEnd:'end',source}]};
const make=()=>new PlaySession({id:'chat-a',runtime:new ProjectRuntime({projectId:'card-a',schema:{initialState:{}},screens:[],navigation:[],content:{},featureToggles:{},moduleIds:[]}),preset,card:{name:'Card'},defaultVariables:{kept:'yes'},provider:{async complete(){return{text:'ok'};}}});
const response=(session:PlaySession,patch:RuntimeWorkerSuccess['patch']):RuntimeWorkerSuccess=>({type:'result',ok:true,requestId:'r1',sessionId:'chat-a',cardId:'card-a',baseRevision:session.cardRuntimeRevision,patch,effects:[],warnings:[],result:{displayData:null,stopSending:false,ephemeral:{}},durationMs:1});

describe('session card-runtime transaction',()=>{
 it('applies a validated patch atomically',async()=>{const session=make(),result=await session.applyCardRuntimeTransaction(response(session,[{op:'set',key:'count',value:'2'},{op:'delete',key:'kept'}]),'r1');expect(result).toEqual({applied:true});expect(session.cbsVariables).toEqual({count:'2'});});
 it('rejects a stale revision without changing any variable',async()=>{const session=make(),stale={...response(session,[{op:'set',key:'count',value:'2'}]),baseRevision:'old'};expect(await session.applyCardRuntimeTransaction(stale,'r1')).toEqual({applied:false,reason:'revision_mismatch'});expect(session.cbsVariables).toEqual({kept:'yes'});});
 it('rejects the entire transaction when one patch or effect is unsafe',async()=>{const session=make(),bad=response(session,[{op:'set',key:'count',value:'2'},{op:'set',key:'__proto__',value:'bad'}]);expect(await session.applyCardRuntimeTransaction(bad,'r1')).toEqual({applied:false,reason:'unsafe_patch_key'});expect(session.cbsVariables).toEqual({kept:'yes'});const effect={...response(session,[]),effects:[{type:'unknown',payload:{}}]};expect(await session.applyCardRuntimeTransaction(effect,'r1')).toEqual({applied:false,reason:'effects_unclassified'});});
});
