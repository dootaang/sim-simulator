import type{CardTriggerInput,CardTriggerResult}from'../trigger-runtime.ts';
export interface CardRuntimeSnapshot{sessionId:string;cardId:string;revision:string;variables:Record<string,string>}
export interface VariablePatch{op:'set'|'delete';key:string;value?:string}
export interface RuntimeEffect{type:string;payload:Record<string,unknown>}
export interface RuntimeWarning{code:string;message:string;effect?:string;actual?:number;limit?:number}
export interface RuntimeWorkerRequest{type:'trigger';requestId:string;snapshot:CardRuntimeSnapshot;input:Omit<CardTriggerInput,'variables'|'alert'>}
export interface RuntimeWorkerSuccess{type:'result';ok:true;requestId:string;sessionId:string;cardId:string;baseRevision:string;patch:VariablePatch[];effects:RuntimeEffect[];warnings:RuntimeWarning[];result:Pick<CardTriggerResult,'displayData'|'stopSending'|'ephemeral'>;durationMs:number}
export interface RuntimeWorkerFailure{type:'result';ok:false;requestId:string;sessionId:string;cardId:string;baseRevision:string;error:string;warnings:RuntimeWarning[];durationMs:number}
export type RuntimeWorkerResponse=RuntimeWorkerSuccess|RuntimeWorkerFailure;
export interface RuntimeClientWarning{code:'runtime_timeout'|'runtime_disposed'|'runtime_stale_response'|'runtime_worker_error';requestId:string;message:string}
