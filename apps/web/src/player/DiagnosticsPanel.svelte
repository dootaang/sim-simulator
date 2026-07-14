<script lang="ts">
  import Icon from '@simbot/ui/Icon.svelte';
  import {diagnostics,diagnosticLabel,type DiagnosticEvent} from './diagnostics.svelte.ts';
  let {secrets=[],onclose}:{secrets?:readonly string[];onclose:()=>void}=$props();
  let copied=$state(false);
  let events=$derived([...diagnostics.events].reverse());
  const time=(at:number)=>new Date(at).toLocaleTimeString('ko-KR',{hour12:false});
  const rows=(event:DiagnosticEvent)=>Object.entries(event.detail);
  async function copy(){await navigator.clipboard.writeText(diagnostics.copyText(secrets));copied=true;setTimeout(()=>copied=false,1500);}
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<aside class="panel" aria-label="진단">
  <header>
    <div><strong><Icon name="badge" size={14}/> 진단</strong><span>{events.length}건 · 최근 {events.length?time(events[0]!.at):'—'}</span></div>
    <div class="actions">
      <button class="primary" disabled={!events.length} onclick={copy}>{copied?'복사됨':'전체 복사'}</button>
      <button disabled={!events.length} onclick={()=>diagnostics.clear()}>비우기</button>
      <button class="icon" onclick={onclose} aria-label="닫기"><Icon name="close" size={14}/></button>
    </div>
  </header>
  <p class="note">여기 담기는 건 실패한 처리 단계뿐입니다. 카드 원문·이미지·API 키는 복사본에 들어가지 않습니다.</p>
  {#if !events.length}
    <div class="empty"><p>기록된 문제가 없습니다.</p><p class="hint">이미지가 안 뜨거나 시뮬레이션이 반응하지 않을 때 다시 열어보세요. 실패한 단계가 여기 남습니다.</p></div>
  {:else}
    <ol>
      {#each events as event}
        <li class={event.kind}>
          <div class="head"><span class="kind">{diagnosticLabel[event.kind]}</span><b>{event.summary}</b><time>{time(event.at)}</time></div>
          <div class="where">{event.card}{event.message===null?'':` · 메시지 ${event.message}`}<code>{event.code}</code></div>
          <dl>{#each rows(event) as [key,value]}<div><dt>{key}</dt><dd>{value===null?'(없음)':String(value)}</dd></div>{/each}</dl>
        </li>
      {/each}
    </ol>
  {/if}
</aside>

<style>
  .scrim{position:fixed;inset:0;background:rgba(6,8,14,.55);z-index:40;}
  .panel{position:fixed;top:0;right:0;bottom:0;width:min(30rem,100vw);z-index:41;display:flex;flex-direction:column;gap:.5rem;padding:1rem;background:var(--surface,#12151d);border-left:1px solid var(--line,#252a36);overflow:auto;}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;}
  header strong{display:flex;align-items:center;gap:.35rem;font-size:1rem;}
  header span{display:block;font-size:.75rem;opacity:.6;margin-top:.15rem;}
  .actions{display:flex;gap:.35rem;}
  .actions button{padding:.3rem .6rem;font-size:.75rem;border:1px solid var(--line,#252a36);border-radius:.4rem;background:transparent;color:inherit;cursor:pointer;}
  .actions button:disabled{opacity:.4;cursor:default;}
  .actions .primary{background:var(--accent,#f0b429);border-color:transparent;color:#171717;font-weight:600;}
  .actions .icon{padding:.3rem;}
  .note{margin:0;font-size:.7rem;opacity:.55;line-height:1.5;}
  .empty{margin-top:3rem;text-align:center;opacity:.6;}
  .empty .hint{font-size:.75rem;opacity:.7;margin-top:.5rem;line-height:1.6;}
  ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem;}
  li{padding:.6rem;border:1px solid var(--line,#252a36);border-left:3px solid var(--accent,#f0b429);border-radius:.4rem;background:rgba(255,255,255,.02);}
  li.provider,li.simulation{border-left-color:#e05c5c;}
  .head{display:flex;align-items:center;gap:.4rem;}
  .head b{flex:1;font-size:.85rem;font-weight:600;}
  .kind{font-size:.65rem;padding:.1rem .35rem;border-radius:.25rem;background:rgba(255,255,255,.08);}
  time{font-size:.7rem;opacity:.5;font-variant-numeric:tabular-nums;}
  .where{display:flex;align-items:center;gap:.4rem;font-size:.7rem;opacity:.6;margin:.25rem 0 .4rem;}
  .where code{margin-left:auto;font-size:.65rem;opacity:.8;}
  dl{margin:0;display:grid;gap:.15rem;font-size:.72rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
  dl div{display:grid;grid-template-columns:7rem 1fr;gap:.5rem;}
  dt{opacity:.55;}
  dd{margin:0;word-break:break-all;}
</style>
