export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue; }
export type MutableJsonObject = { [key: string]: JsonValue };

export type Brand<T, TName extends string> = T & { readonly __brand: TName };
export type EventId = Brand<string, 'EventId'>;
export type ModuleId = Brand<string, 'ModuleId'>;
export type SelectorId = Brand<string, 'SelectorId'>;
export type SessionId = Brand<string, 'SessionId'>;

export function eventId(value: string): EventId { return value as EventId; }
export function moduleId(value: string): ModuleId { return value as ModuleId; }
export function selectorId(value: string): SelectorId { return value as SelectorId; }
export function sessionId(value: string): SessionId { return value as SessionId; }
