import type { JsonObject, JsonValue } from './json.ts';

export type ConditionOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'truthy' | 'includes';
export type ScreenCondition = boolean | { readonly all: readonly ScreenCondition[] } | { readonly any: readonly ScreenCondition[] } | { readonly not: ScreenCondition } | { readonly op: ConditionOperator; readonly path: string; readonly value?: JsonValue };
export interface ScreenAction { readonly id: string; readonly params?: JsonObject; }
export interface ScreenWidget { readonly widget: string; readonly title?: string; readonly source?: string | JsonObject; readonly props?: JsonObject; readonly actions?: readonly JsonObject[]; readonly visibleWhen?: ScreenCondition; }
export interface ScreenDocument { readonly id: string; readonly title: string; readonly layout: string; readonly presentation?: 'page' | 'modal' | 'overlay'; readonly visibleWhen?: ScreenCondition; readonly regions: Readonly<Record<string, readonly ScreenWidget[]>>; }
export interface NavigationItem { readonly id: string; readonly screenId: string; readonly label: string; readonly visibleWhen?: ScreenCondition; }
