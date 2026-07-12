import type {ModelProvider} from '../index.ts';import {createProvider,type ProviderConfig} from './index.ts';
export type AuxSlot='translation'|'emotion'|'memory'|'other';
export interface AuxConfig{enabled:boolean;slots:Partial<Record<AuxSlot,ProviderConfig>>;}
export function auxProviderFor(slot:AuxSlot,aux:AuxConfig|undefined,fallback:ModelProvider){if(!aux?.enabled)return fallback;const config=aux.slots[slot];return config?createProvider(config):fallback;}
// translation·emotion 슬롯은 설정 계약만 먼저 고정했다. 실제 UI 소비 경로는 다음 슬라이스에서 연결한다.
