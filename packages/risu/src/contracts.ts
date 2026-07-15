export type PromptRole='system'|'user'|'assistant';
export interface Provenance{source:'card'|'module'|'preset'|'persona'|'asset'|'compiler'|'user';path:string;note?:string}
export interface Persona{contract:'persona/0.1';id:string;name:string;prompt:string;icon:string;note:string;embeddedModule:unknown|null;source:Provenance|null;version:number}
export type PromptBlock=
 |{id:string;type:'plain'|'jailbreak'|'cot';name:string;enabled:boolean;role:PromptRole;text:string;slot?:'main'|'globalNote'|'normal';source:Provenance|null}
 |{id:string;type:'description'|'persona'|'lorebook'|'authornote'|'memory'|'postEverything';name:string;enabled:boolean;role?:PromptRole;innerFormat?:string;depth?:number;defaultText?:string;source:Provenance|null}
 |{id:string;type:'chat';name:string;enabled:boolean;rangeStart:number;rangeEnd:number|'end';source:Provenance|null}
 |{id:string;type:'cache';name:string;enabled:boolean;depth:number;role:PromptRole|'all';source:Provenance|null}
 |{id:string;type:'engineFacts'|'availableActions'|'groundedMemory';name:string;enabled:boolean;role:'system';source:Provenance|null}
 |{id:string;type:'unsupported';originalType:string;name:string;enabled:false;reason:string;raw:unknown;source:Provenance|null};
export interface PromptPreset{contract:'prompt-preset/0.1';id:string;name:string;compatibilityMode:'risu'|'simpack';version:number;blocks:PromptBlock[];settings:{assistantPrefill:string;sendNames:boolean;sendChatAsSystem:boolean};raw:unknown|null}
export interface CompileCard{name:string;description?:string;personality?:string;scenario?:string;systemPrompt?:string;postHistoryInstructions?:string;regexScripts?:import('./card-regex.ts').RegexScript[]}
export interface PromptCompileInput{preset:PromptPreset;card:CompileCard;assets?:Array<{name:string;type:string;mime:string;bytes:Uint8Array|null}>;activeModules?:readonly string[];persona?:Persona|null;lore?:{entries:Array<{content:string;name?:string}>}|null;chat?:Array<{role:'user'|'assistant';content:string}>;authorNote?:{content:string;depth?:number}|null;memory?:string|null;postEverything?:string|Array<{role:PromptRole;content:string}>;engineContext?:{facts?:string;availableActions?:string;groundedMemory?:string}|null;variables?:Record<string,string|number|boolean>;options?:{mergeConsecutiveRoles?:boolean}}
export interface PromptTraceRow{blockId:string;blockType:string;sourcePath:string;role:PromptRole|'none';active:boolean;reason:string;chars:number;tokensEstimate:number;insertedAt?:string}
export interface CompiledPrompt{messages:Array<{role:PromptRole;content:string}>;messageMeta?:Array<{blockType:string}>;assistantPrefill:string;trace:PromptTraceRow[];warnings:Array<{code:string;path:string;detail?:string}>}
