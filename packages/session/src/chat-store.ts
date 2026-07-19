import type { SessionRepository } from '@simbot/persistence';

export interface ChatMeta { chatId:string; name:string; turn:number; updatedAt:number; }
export interface ChatIndex { contract:'simbot-chat-index/0.1'; projectId:string; chats:ChatMeta[]; activeChatId:string|null; }

// UI는 채팅을 전환할 때 `${projectId}:chat:${chatId}` id로 새 PlaySession을 만들고 저장 snapshot을 restore한다.
export class ChatStore {
  readonly #repository:SessionRepository<ChatIndex>;
  readonly #projectId:string;
  constructor(repository:SessionRepository<ChatIndex>,projectId:string){this.#repository=repository;this.#projectId=projectId;}
  async list():Promise<ChatIndex>{const stored=await this.#repository.get(this.#indexId());if(!stored)return this.#empty();const value=stored.payload;if(value.contract!=='simbot-chat-index/0.1'||value.projectId!==this.#projectId)throw new Error('chat_index_incompatible');return structuredClone(value);}
  // 리스 문법: 새 채팅은 맨 위(unshift). 회차 번호는 기존 최대치+1이라 삭제 후에도 겹치지 않는다.
  async create(name?:string):Promise<ChatMeta>{const index=await this.list(),chatId=crypto.randomUUID(),now=Date.now(),next=index.chats.reduce((max,chat)=>Math.max(max,Number(/^(\d+)회차$/.exec(chat.name)?.[1]??0)),0)+1,meta={chatId,name:name?.trim()||`${next}회차`,turn:0,updatedAt:now};index.chats.unshift(meta);index.activeChatId=chatId;await this.#save(index);return structuredClone(meta);}
  async rename(chatId:string,name:string){const value=name.trim();if(!value)throw new Error('chat_name_empty');const index=await this.list(),chat=this.#required(index,chatId);chat.name=value;chat.updatedAt=Date.now();await this.#save(index);}
  // 인덱스를 먼저 저장하고 세션 행을 지운다 — 역순이면 인덱스 쓰기 실패 시 목록에 남은 고스트 채팅이
  // 이미 지워진 세션을 가리킨다(감사 #4). 이 순서면 실패해도 무해한 고아 행만 남는다.
  async remove(chatId:string){const index=await this.list(),position=index.chats.findIndex((chat)=>chat.chatId===chatId);if(position<0)throw new Error(`chat_not_found:${chatId}`);index.chats.splice(position,1);if(index.activeChatId===chatId)index.activeChatId=index.chats[0]?.chatId??null;await this.#save(index);const sessionId=`${this.#projectId}:chat:${chatId}`,row=await this.#repository.get(sessionId),payload=row?.payload as {journal?:{sealedEpochRefs?:Array<{offset:number}>};shardManifest?:{messages:{chunks:string[]};journalEvents:{chunks:string[]}}}|undefined;for(const ref of payload?.journal?.sealedEpochRefs??[])await this.#repository.delete(`${sessionId}::sealed-epoch:${ref.offset}`); // 분리 보관된 봉인 본문 동반 삭제(파동 2 GC)
  for(let offset=0;offset<(payload?.shardManifest?.messages.chunks.length??0);offset+=1)await this.#repository.delete(`${sessionId}::shard:messages:${offset}`);
  for(let offset=0;offset<(payload?.shardManifest?.journalEvents.chunks.length??0);offset+=1)await this.#repository.delete(`${sessionId}::shard:journal-events:${offset}`); // 샤드 청크 동반 삭제(파동 4 GC)
  await this.#repository.delete(sessionId);}
  async setActive(chatId:string){const index=await this.list();this.#required(index,chatId);index.activeChatId=chatId;await this.#save(index);}
  async touch(chatId:string,turn:number){const index=await this.list(),chat=this.#required(index,chatId);chat.turn=Math.max(0,Math.trunc(turn));chat.updatedAt=Date.now();await this.#save(index);}
  async syncTurn(chatId:string,turn:number){const index=await this.list(),chat=this.#required(index,chatId),next=Math.max(0,Math.trunc(turn));if(chat.turn===next)return;chat.turn=next;await this.#save(index);}
  #required(index:ChatIndex,chatId:string){const chat=index.chats.find((entry)=>entry.chatId===chatId);if(!chat)throw new Error(`chat_not_found:${chatId}`);return chat;}
  #empty():ChatIndex{return{contract:'simbot-chat-index/0.1',projectId:this.#projectId,chats:[],activeChatId:null};}
  #indexId(){return`${this.#projectId}:chatindex`;}
  async #save(index:ChatIndex){await this.#repository.put({id:this.#indexId(),schemaHash:this.#projectId,title:'Chat index',updatedAt:Date.now(),payload:structuredClone(index)});}
}
