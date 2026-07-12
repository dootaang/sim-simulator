import type { EventId, JsonObject, JsonValue, ModuleId, SelectorId } from './json.ts';

export interface EngineEvent<TParams extends JsonObject = JsonObject> { readonly id: EventId; readonly params: TParams; }
export interface EngineError { readonly code: string; readonly detail?: JsonValue; }
export interface EngineLogEntry extends JsonObject { readonly ok: boolean; readonly event: string; }
export interface EngineSuccess<TState extends JsonObject> { readonly ok: true; readonly state: TState; readonly log: readonly EngineLogEntry[]; readonly emitted?: readonly EngineEvent[]; }
export interface EngineFailure<TState extends JsonObject> { readonly ok: false; readonly state: TState; readonly error: EngineError; readonly log: readonly EngineLogEntry[]; }
export type EngineResult<TState extends JsonObject> = EngineSuccess<TState> | EngineFailure<TState>;

export interface StateAccess { readonly owns: readonly string[]; readonly reads: readonly string[]; readonly writes: readonly string[]; }
export interface ModuleManifest { readonly id: ModuleId; readonly version: string; readonly dependencies: readonly ModuleId[]; readonly stateAccess: StateAccess; }
export interface ModuleRegistration { readonly manifest: ModuleManifest; readonly eventIds: readonly EventId[]; readonly selectorIds: readonly SelectorId[]; }
