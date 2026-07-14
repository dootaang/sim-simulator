import{describe,expect,it,vi}from'vitest';
import{getCbsPortEnv}from'../src/port/parser.ts';
import{triggerPortEnv}from'../src/port/trigger-env.ts';
import{runCardTriggers}from'../src/trigger-runtime.ts';
import{RisuRuntimeWorkerClient,type RuntimeWorkerPort}from'../src/worker/client.ts';
import{executeRuntimeRequest}from'../src/worker/execute.ts';
import type{RuntimeWorkerRequest,RuntimeWorkerResponse}from'../src/worker/contract.ts';

const request=(requestId='r1'):RuntimeWorkerRequest=>({type:'trigger',requestId,snapshot:{sessionId:'chat-a',cardId:'card-a',revision:'rev-a',variables:{count:'1'}},input:{mode:'output',triggers:[{type:'output',conditions:[],effect:[{type:'setvar',operator:'+=',var:'count',value:'2'}]}]}});
class FakeWorker implements RuntimeWorkerPort{onmessage:((event:{data:RuntimeWorkerResponse})=>void)|null=null;onerror:null=null;posted:RuntimeWorkerRequest[]=[];terminated=0;postMessage(value:RuntimeWorkerRequest){this.posted.push(value);}terminate(){this.terminated+=1;}respond(value:RuntimeWorkerResponse){this.onmessage?.({data:value});}}

describe('card runtime worker boundary',()=>{
 it('returns a patch instead of mutating the supplied snapshot',async()=>{const input=request(),response=await executeRuntimeRequest(input);expect(input.snapshot.variables).toEqual({count:'1'});expect(response).toMatchObject({ok:true,requestId:'r1',baseRevision:'rev-a',patch:[{op:'set',key:'count',value:'3'}]});});
 it('restores the scoped upstream environments after every run',async()=>{const cbs=getCbsPortEnv(),trigger=triggerPortEnv();await runCardTriggers({...request().input,variables:{}});expect(getCbsPortEnv()).toBe(cbs);expect(triggerPortEnv()).toBe(trigger);});
 it('terminates a timed-out worker and rejects every partial result',async()=>{vi.useFakeTimers();const worker=new FakeWorker(),warnings:string[]=[];const client=new RisuRuntimeWorkerClient(()=>worker,{hardTimeoutMs:50,onWarning:value=>warnings.push(value.code)}),pending=client.execute(request()),rejected=expect(pending).rejects.toThrow('runtime_timeout');await vi.advanceTimersByTimeAsync(51);await rejected;expect(worker.terminated).toBe(1);expect(warnings).toContain('runtime_timeout');vi.useRealTimers();});
 it('discards and reports a response that arrives after a session switch',async()=>{const worker=new FakeWorker(),warnings:string[]=[];const client=new RisuRuntimeWorkerClient(()=>worker,{onWarning:value=>warnings.push(value.code)}),pending=client.execute(request()),rejected=expect(pending).rejects.toThrow('session_changed');client.dispose('session_changed');await rejected;worker.respond({type:'result',ok:false,requestId:'r1',sessionId:'chat-a',cardId:'card-a',baseRevision:'rev-a',error:'late',warnings:[],durationMs:1});expect(worker.terminated).toBe(1);expect(warnings).toEqual(expect.arrayContaining(['runtime_disposed','runtime_stale_response']));});
 it('rejects oversized input before a Worker or structured clone is created',async()=>{let created=0;const warnings:string[]=[],client=new RisuRuntimeWorkerClient(()=>{created+=1;return new FakeWorker();},{onWarning:value=>warnings.push(value.code)}),huge=request();huge.input.triggers=[{type:'output',conditions:[],effect:Array.from({length:20_001},()=>({type:'setvar'}))}];await expect(client.execute(huge)).rejects.toThrow('runtime_budget_exceeded:effects');expect(created).toBe(0);expect(warnings).toEqual(['runtime_budget_rejected']);});
});
