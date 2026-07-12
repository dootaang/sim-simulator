<script lang="ts">
  import Button from '@simbot/ui/Button.svelte';
  import Panel from '@simbot/ui/Panel.svelte';
  import { evaluateCondition, resolveValue, type ProjectRuntime } from '@simbot/runtime';
  import type { PlaySession } from '@simbot/session';
  import ChatPanel from './ChatPanel.svelte';

  let { runtime, version, session = null, portraitFor = () => null }: { runtime: ProjectRuntime; version: number; session?: PlaySession|null; portraitFor?: (npcId:string,emotion?:string)=>string|null } = $props();
  let active = $state('');
  let selection = $state<Record<string, unknown>>({});
  let lastLog = $state<unknown[]>([]);
  let revision = $state(0);
  $effect(() => { revision = version; });
  let project = $derived(runtime.project);
  let context = $derived({ state: runtime.state, schema: project.schema, content: project.content, selection, featureToggles: project.featureToggles });
  let screens = $derived(project.screens.filter((item) => evaluateCondition(item.visibleWhen, context)));
  let screen = $derived(screens.find((item) => item.id === (active || project.navigation[0]?.screenId)) ?? screens[0]);
  function source(widget: Record<string, unknown>) { revision; const value = widget.source; if (typeof value === 'string' && value.startsWith('engine:')) { try { return runtime.select(value.slice(7)); } catch { return null; } } if (typeof value === 'string' && value.startsWith('state.')) return value.split('.').slice(1).reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, runtime.state); return value; }
  function act(action: Record<string, unknown>) { const event = (action.event ?? action) as Record<string, unknown>, id = String(event.id ?? ''); if (!id) return; const params = resolveValue(event.params ?? {}, context) as Record<string, unknown>; lastLog = runtime.dispatch(id, params).log; revision += 1; }
  function asList(value: unknown): Record<string, unknown>[] { if (Array.isArray(value)) return value as Record<string, unknown>[]; if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => item && typeof item === 'object' ? { id, ...item as Record<string, unknown> } : { id, value: item }); return []; }
</script>

<nav class="screen-nav" aria-label="프로젝트 화면">
  {#each project.navigation as item}
    {#if evaluateCondition(item.visibleWhen, context)}<Button variant={(active || project.navigation[0]?.screenId) === item.screenId ? 'primary' : 'ghost'} onclick={() => active = String(item.screenId)}>{String(item.label ?? item.id)}</Button>{/if}
  {/each}
</nav>
{#if screen}
  <section class={`screen layout-${String(screen.layout ?? 'dashboard')}`}>
    <h1>{String(screen.title ?? screen.id)}</h1>
    {#each Object.entries((screen.regions ?? {}) as Record<string, Record<string, unknown>[]>) as [region, widgets]}
      <div class={`region region-${region}`}>
        {#each widgets as widget}
          {#if evaluateCondition(widget.visibleWhen, context)}
            <Panel title={widget.title ? String(widget.title) : undefined}>
              {#if widget.widget === 'chat'}
                {#if session}<ChatPanel {session} {portraitFor} onchange={()=>revision+=1}/>{:else}<div class="chat"><p>플레이 세션을 준비하고 있습니다.</p>{#if lastLog.length}<pre>{JSON.stringify(lastLog, null, 2)}</pre>{/if}</div>{/if}
              {:else if widget.widget === 'action-group' || widget.widget === 'decision-card'}
                <div class="actions">{#each asList(widget.actions) as action}<Button disabled={action.enabled === false} onclick={() => act(action)}>{String(action.label ?? action.id)}</Button>{/each}</div>
              {:else if ['card-list', 'map-nodes', 'inventory-grid', 'quest-board'].includes(String(widget.widget))}
                <div class="cards">{#each asList(source(widget)) as item, index}<Button variant="secondary" onclick={() => selection[String(widget.selectionKey ?? 'selectedId')] = item.id ?? index}>{String(item.label ?? item.name ?? item.id ?? index)}</Button>{/each}</div>
              {:else}<pre>{JSON.stringify(source(widget), null, 2)}</pre>{/if}
            </Panel>
          {/if}
        {/each}
      </div>
    {/each}
  </section>
{:else}<Panel title="화면 없음"><p>이 프로젝트에는 표시 가능한 화면 선언이 없습니다.</p></Panel>{/if}

<style>
  .screen-nav,.actions,.cards{display:flex;gap:var(--space-2);flex-wrap:wrap}.screen-nav{margin-bottom:var(--space-4)}.screen{display:grid;grid-template-columns:minmax(0,1fr) minmax(16rem,var(--sidebar-width));gap:var(--space-4)}.screen>h1{grid-column:1/-1;margin:0}.region{display:flex;flex-direction:column;gap:var(--space-4)}.region-main{grid-column:1}.region-hud,.region-side,.region-actions{grid-column:2}.chat{min-height:18rem}.chat pre,pre{white-space:pre-wrap;overflow:auto;font:12px var(--font-mono)}@media(max-width:800px){.screen{grid-template-columns:1fr}.region-main,.region-hud,.region-side,.region-actions{grid-column:1}}
</style>
