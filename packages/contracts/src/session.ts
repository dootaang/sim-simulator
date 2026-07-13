import type { JsonObject } from './json.ts';

export interface EngineJournalEvent { readonly index:number;readonly parentIndex:number;readonly event:{readonly id:string;readonly params:JsonObject};readonly ok:boolean;readonly log:readonly JsonObject[];readonly stateHash:string;readonly rng:number; }
export interface EngineJournalHead { readonly index:number;readonly stateHash:string;readonly rng:number; }
export interface EngineJournalData { readonly contract:'simbot-event-journal/0.1';readonly schemaHash:string;readonly initial:{readonly state:JsonObject;readonly rng:number};readonly snapshotInterval:number;readonly events:readonly EngineJournalEvent[];readonly cursor:number;readonly head:EngineJournalHead; }
