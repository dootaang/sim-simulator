// 카드 트리거 실행 경계 (ADR 0004 M-C) — 업스트림 전체 이식(port/triggers.ts)을 우리 세션 계약으로 감싼다.
// 변수 의미론: 트리거의 chat.scriptstate['$key'] ↔ 세션 cbsVariables를 실행 전후로 동기화해
// 트리거·CBS·정규식이 리스와 동일하게 한 저장소를 공유한다. Lua(triggerlua)·LLM·이미지 효과는
// port 헤더가 기본 무해화한다(M-D capability 게이트에서 개방).
import { runTrigger } from './port/triggers.ts';
import { setTriggerPortEnv } from './port/trigger-env.ts';
import { setCbsPortEnv } from './port/parser.ts';

export interface CardTriggerScript { comment?: string; type: string; conditions?: unknown[]; effect?: unknown[] }
export type CardTriggerMode = 'start' | 'manual' | 'output' | 'input' | 'display' | 'request';
export interface CardTriggerInput {
  mode: CardTriggerMode;
  triggers: readonly CardTriggerScript[];
  moduleTriggers?: readonly CardTriggerScript[];
  variables: Record<string, string>;
  messages?: ReadonlyArray<{ role: 'user' | 'char'; data: string }>;
  displayData?: string;
  manualName?: string;
  userName?: string;
  charName?: string;
  defaultVariables?: string;
  activeModules?: readonly string[];
  alert?: (kind: 'error' | 'normal', message: string) => void;
}
// display 모드의 setvar는 업스트림에서 휘발성(tempVars)이다 — 매 렌더 실행이 상태를 오염시키지 않게 하는 안전 설계.
// 그래서 variables에는 반영하지 않고 ephemeral로 따로 돌려준다.
export interface CardTriggerResult { displayData: string | null; stopSending: boolean; variables: Record<string, string>; ephemeral: Record<string, string> }

const scriptStateOf = (variables: Record<string, string>) => Object.fromEntries(Object.entries(variables).map(([key, value]) => [`$${key}`, String(value)]));

export async function runCardTriggers(input: CardTriggerInput): Promise<CardTriggerResult> {
  const active = (input.triggers ?? []).filter((script) => script && script.type === input.mode);
  const moduleActive = (input.moduleTriggers ?? []).filter((script) => script && script.type === input.mode);
  if (!active.length && !moduleActive.length) return { displayData: input.displayData ?? null, stopSending: false, variables: input.variables, ephemeral: {} };
  const chat = { message: (input.messages ?? []).map((message) => ({ role: message.role, data: message.data })), scriptstate: scriptStateOf(input.variables) };
  const char: Record<string, unknown> = { type: 'character', name: input.charName ?? 'Character', chats: [chat], chatPage: 0, triggerscript: [...active], defaultVariables: input.defaultVariables ?? '', lowLevelAccess: false };
  const database = { characters: [char], templateDefaultVariables: '' };
  setTriggerPortEnv({
    getDatabase: () => database,
    getCurrentCharacter: () => char,
    getCurrentChat: () => chat,
    setCurrentCharacter: (value) => { Object.assign(char, value); },
    setDatabase: () => {},
    getModuleTriggers: () => [...moduleActive],
    alert: input.alert ?? (() => {}),
  });
  // 트리거 내부의 risuChatParser({{getvar}} 등)도 같은 변수·이름을 보게 한다.
  setCbsPortEnv({
    getChatVar: (key) => String((chat.scriptstate as Record<string, string>)[`$${key}`] ?? ''),
    setChatVar: (key, value) => { (chat.scriptstate as Record<string, string>)[`$${key}`] = value; },
    getGlobalChatVar: (key) => String((chat.scriptstate as Record<string, string>)[`$${key}`] ?? ''),
    getUserName: () => input.userName ?? 'User',
    getModules: () => (input.activeModules ?? []).map((namespace) => ({ namespace, name: namespace })),
    database: () => database,
  });
  type TriggerReturn = { displayData?: string; stopSending?: boolean; tempVars?: Record<string, string> } | null | undefined;
  let result: TriggerReturn = null;
  const tempVars: Record<string, string> = {}; // 업스트림은 호출자가 넘긴 이 객체에 display setvar를 쓰고 그대로 돌려준다
  try { result = (await (runTrigger as unknown as (...args: unknown[]) => Promise<TriggerReturn>)(char, input.mode, { chat, displayMode: input.mode === 'display', displayData: input.displayData, manualName: input.manualName, tempVars })); }
  catch { result = null; /* 트리거 실패는 본문을 해치지 않는다 — 업스트림도 display 트리거 예외를 삼킨다 */ }
  const variables: Record<string, string> = { ...input.variables };
  for (const [key, value] of Object.entries((chat.scriptstate as Record<string, unknown>) ?? {})) if (key.startsWith('$')) variables[key.slice(1)] = String(value);
  return { displayData: (result?.displayData ?? input.displayData) ?? null, stopSending: !!result?.stopSending, variables, ephemeral: { ...tempVars, ...(result?.tempVars ?? {}) } };
}
