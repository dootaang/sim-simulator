import type { JsonObject, SessionId } from './json.ts';
import type { EngineEvent } from './engine.ts';

export interface SessionMessage { readonly id: string; readonly index: number; readonly role: 'system' | 'user' | 'assistant'; readonly content: string; readonly createdAt: string; }
export interface SessionEvent { readonly index: number; readonly event: EngineEvent; readonly log: readonly JsonObject[]; readonly stateHash: string; }
export interface SessionBundle { readonly contract: 'simbot-session/0.1'; readonly id: SessionId; readonly projectId: string; readonly schemaHash: string; readonly messages: readonly SessionMessage[]; readonly events: readonly SessionEvent[]; readonly snapshots: readonly JsonObject[]; readonly memory: readonly JsonObject[]; }
