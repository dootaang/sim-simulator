// RisuAI 전체 이식(ADR 0004)용 얇은 타입·스토어 스텁.
// 업스트림은 명목상 Database/character 타입과 svelte 스토어를 쓰지만, 이식 코드는 구조적으로만 접근한다.
export type Database = Record<string, any>;
export type character = Record<string, any>;
export type groupChat = Record<string, any>;
export type loreBook = Record<string, any>;
export type RisuModule = Record<string, any>;
export type LLMModel = Record<string, any>;
// svelte get(store) 호환 미니 스토어 — cbs.ts의 trigger_id가 사용한다.
export interface MiniStore<T> { value: T; subscribe: (run: (value: T) => void) => () => void; set: (value: T) => void }
export function miniStore<T>(value: T): MiniStore<T> { return { value, subscribe(run) { run(this.value); return () => {}; }, set(next: T) { this.value = next; } }; }
export function get<T>(store: MiniStore<T>): T { return store.value; }
export const CurrentTriggerIdStore = miniStore('');
