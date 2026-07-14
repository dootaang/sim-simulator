import{installRuntimeWorker,type RuntimeWorkerScope}from'@simbot/risu';
installRuntimeWorker(globalThis as unknown as RuntimeWorkerScope);
