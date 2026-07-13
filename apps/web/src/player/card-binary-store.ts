export interface CardBinaryStore {
  put(projectId:string,bytes:Uint8Array):Promise<void>;
  get(projectId:string):Promise<Uint8Array|null>;
  delete(projectId:string):Promise<void>;
}

const DB_NAME='lucky-simulator-card-blobs', STORE='cards', VERSION=1;
export const LARGE_CARD_WARNING_BYTES=100*1024*1024;
export function needsLargeCardWarning(size:number){return size>LARGE_CARD_WARNING_BYTES;}

function request<T>(value:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error??new Error('card_blob_request_failed'));});}
async function openDb(){return await new Promise<IDBDatabase>((resolve,reject)=>{const value=indexedDB.open(DB_NAME,VERSION);value.onupgradeneeded=()=>{if(!value.result.objectStoreNames.contains(STORE))value.result.createObjectStore(STORE);};value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error??new Error('card_blob_open_failed'));});}

export function createBrowserCardBinaryStore():CardBinaryStore{
  const run=async<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>)=>{const db=await openDb();try{return await request(work(db.transaction(STORE,mode).objectStore(STORE)));}finally{db.close();}};
  return{
    async put(projectId,bytes){await run('readwrite',(store)=>store.put(bytes.slice().buffer,projectId));},
    async get(projectId){const value=await run<ArrayBuffer|undefined>('readonly',(store)=>store.get(projectId));return value?new Uint8Array(value):null;},
    async delete(projectId){await run('readwrite',(store)=>store.delete(projectId));}
  };
}

export function createMemoryCardBinaryStore():CardBinaryStore{
  const values=new Map<string,Uint8Array>();
  return{async put(id,bytes){values.set(id,bytes.slice());},async get(id){return values.get(id)?.slice()??null;},async delete(id){values.delete(id);}};
}
