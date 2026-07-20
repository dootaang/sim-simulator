import {describe,expect,it}from'vitest';
import{readFileSync}from'node:fs';
import type{MemoryRecord}from'@simbot/contracts';
import {isPlayerSafeMemory,memoryCounts,receiptFor}from'./memory-ui';

const record=(value:Partial<MemoryRecord>&Pick<MemoryRecord,'id'|'text'>):MemoryRecord=>({validFromTurn:1,validToTurn:null,scope:{kind:'public'},evidence:[{kind:'message',id:'m1'}],status:'approved',...value,id:value.id,text:value.text});

describe('memory presentation',()=>{
  it('separates active, candidate and archived counts',()=>{
    const rows=[record({id:'a',text:'A'}),record({id:'b',text:'B',status:'candidate'}),record({id:'c',text:'C',status:'rejected'})];
    expect(memoryCounts(rows,new Set(['a']))).toEqual({total:2,approved:1,candidates:1,archived:1});
  });
  it('does not expose character-private or hidden memories',()=>{
    expect(isPlayerSafeMemory(record({id:'public',text:'공개'}))).toBe(true);
    expect(isPlayerSafeMemory(record({id:'private',text:'비밀',scope:{kind:'entity',entityId:'npc'}}))).toBe(false);
    expect(isPlayerSafeMemory(record({id:'hidden',text:'숨김',knowledge:{state:'hidden'}}))).toBe(false);
  });
  it('builds separate recall and capture receipts while hiding duplicates and secrets',()=>{
    const rows=[record({id:'used',text:'사용 기억'}),record({id:'new',text:'새 기억',status:'candidate'}),record({id:'secret',text:'NPC 비밀',scope:{kind:'entity',entityId:'npc'}})];
    const receipt=receiptFor({id:'run:1:m2',turn:1,kind:'send',createdAt:'now',responseText:'',proposedEvents:[],logs:[],issues:[],memoryTrace:{query:'질문',perspectives:[],included:[{id:'used',sectionId:'common',kind:'summary',evidence:['message:m1']},{id:'secret',sectionId:'npc',kind:'secret',evidence:['message:m1']}],excluded:{approval:0,visibilityOrTime:0,scene:0,relevanceOrBudget:0},abstained:false},memoryDecisions:[{recordId:'new',status:'candidate',reason:'needs-review'},{recordId:'used',status:'approved',reason:'duplicate'}]},rows);
    expect(receipt.used.map(item=>item.id)).toEqual(['used']);
    expect(receipt.captured.map(item=>item.id)).toEqual(['new']);
    expect(receipt.hiddenUsed).toBe(1);
  });
  it('keeps the memory notebook, status explanation and per-response receipt visible',()=>{
    const source=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
    expect(source('./SidePanel.svelte')).toContain('장기기억');
    expect(source('./SettingsPanel.svelte')).toContain('키가 없어도 장기기억의 저장·회상·검토는 작동합니다.');
    expect(source('./SessionInspector.svelte')).toContain('기억 수첩');
    expect(source('./MessageList.svelte')).toContain('이번 답변에서 회상');
  });
});
