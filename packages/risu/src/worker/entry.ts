import{executeRuntimeRequest}from'./execute.ts';import type{RuntimeWorkerRequest}from'./contract.ts';
export interface RuntimeWorkerScope{postMessage(value:unknown):void;onmessage:((event:{data:RuntimeWorkerRequest})=>void)|null}
export function installRuntimeWorker(scope:RuntimeWorkerScope){let queue=Promise.resolve();scope.onmessage=event=>{queue=queue.then(async()=>scope.postMessage(await executeRuntimeRequest(event.data)));};}
