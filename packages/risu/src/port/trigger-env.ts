// 트리거 이식(ADR 0004 M-C)의 환경 계약. 업스트림 triggers.ts가 리스 DB·스토어·UI에 기대던 것을
// 세션이 주입한다. 위험 훅(LLM·이미지·Lua)은 이 계약에 아예 없다 — 기본 무해화는 port/triggers.ts 헤더가 소유.
export interface TriggerPortEnv {
  getDatabase: () => Record<string, any>;
  getCurrentCharacter: () => Record<string, any>;
  getCurrentChat: () => Record<string, any>;
  setCurrentCharacter: (value: Record<string, any>) => void;
  setDatabase: (value: Record<string, any>) => void;
  getModuleTriggers: () => Record<string, any>[];
  alert: (kind: 'error' | 'normal', message: string) => void;
  alertInput: (message: string) => Promise<string>;
  alertSelect: (options: string[]) => Promise<string>;
}
const defaultEnv: TriggerPortEnv = {
  getDatabase: () => ({ characters: [], templateDefaultVariables: '' }),
  getCurrentCharacter: () => ({ type: 'character', chats: [{ message: [] }], chatPage: 0, triggerscript: [] }),
  getCurrentChat: () => ({ message: [] }),
  setCurrentCharacter: () => {},
  setDatabase: () => {},
  getModuleTriggers: () => [],
  alert: () => {},
  alertInput: async () => '',
  alertSelect: async () => '',
};
let env: TriggerPortEnv = defaultEnv;
export function setTriggerPortEnv(next: Partial<TriggerPortEnv>) { env = { ...defaultEnv, ...next }; }
export function triggerPortEnv(): TriggerPortEnv { return env; }
export function restoreTriggerPortEnv(previous:TriggerPortEnv){env=previous;}
export async function withTriggerPortEnv<T>(next:Partial<TriggerPortEnv>,work:()=>Promise<T>|T):Promise<T>{const previous=env;setTriggerPortEnv(next);try{return await work();}finally{restoreTriggerPortEnv(previous);}}
