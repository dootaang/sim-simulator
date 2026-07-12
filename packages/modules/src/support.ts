import type { DispatchResult, HandlerContext, ModuleDefinition, RuntimeRecord } from '@simbot/kernel';
export type Context = HandlerContext;
export function record(value: unknown): RuntimeRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeRecord : {}; }
export function list<T = RuntimeRecord>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
export function number(value: unknown, fallback = 0): number { const result=Number(value); return Number.isFinite(result)?result:fallback; }
export function string(value: unknown): string { return typeof value === 'string' ? value : String(value ?? ''); }
export function safeKey(value: string): boolean { return !!value && !['__proto__','prototype','constructor'].includes(value); }
// 소유 키만 인덱싱 — 'toString'·'hasOwnProperty' 같은 상속 멤버가 존재검사를 우회해 rooms 등의
// 내장 메서드를 그림자 씌우는 것 차단(감사 Major: 옛 safeOwnKey 가드 이관). safeKey(블랙리스트)와 병용.
export function own(container: RuntimeRecord, key: string): unknown { return safeKey(key) && Object.prototype.hasOwnProperty.call(container, key) ? container[key] : undefined; }
export function ok(context: Context, entry: RuntimeRecord = {}): DispatchResult { return { state:context.state, log:[{ok:true,event:context.event.id,...entry}] }; }
export function fail(context: Context, reason: string, detail?: unknown): DispatchResult { return { state:context.state, log:[{ok:false,event:context.event.id,reason,...(detail == null?{}:{detail:string(detail)})}] }; }
export function roll(value: unknown, context: Context): number { const values=list<unknown>(value); return values.length>=2?context.rng.int(number(values[0]),number(values[1])):number(record(value).value ?? value); }
export function moduleDefinition(id:string, dependencies:string[], owns:string[], writes:string[], events:ModuleDefinition['events'], selectors:ModuleDefinition['selectors']={}):ModuleDefinition{return{id,version:'1.0.0',dependencies,stateAccess:{owns,reads:[],writes},events:events??{},selectors,processes:{},migrations:{}};}
export function scoped(handler:(context:Context)=>DispatchResult){return(context:Context)=>handler(context);}
export function owned(state:RuntimeRecord,id:string):number{if(!safeKey(id))return 0;const resources=record(state.resources),items=record(state.items);return number(Object.prototype.hasOwnProperty.call(resources,id)?resources[id]:items[id]);}
export function addOwned(state:RuntimeRecord,id:string,delta:number):void{if(!safeKey(id))throw new Error(`unsafe_item_id:${id}`);const resources=record(state.resources);const target=Object.prototype.hasOwnProperty.call(resources,id)?resources:record(state.items);target[id]=Math.max(0,number(target[id])+delta);if(target===resources)state.resources=resources;else state.items=target;}
export function rewards(state:RuntimeRecord,value:unknown,context:Context):void{for(const[id,amount]of Object.entries(record(value))){const qty=roll(amount,context);if(id==='gold')state.gold=number(state.gold)+qty;else addOwned(state,id,qty);}}
