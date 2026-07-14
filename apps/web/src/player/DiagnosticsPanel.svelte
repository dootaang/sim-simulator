<script lang="ts">
  import Icon from '@simbot/ui/Icon.svelte';
  import {diagnostics,diagnosticLabel,diagnosticLevelLabel,diagnosticLevels,type DiagnosticEvent,type DiagnosticLevel} from './diagnostics.svelte.ts';
  let {chat=null,onclose}:{chat?:string|null;onclose:()=>void}=$props();
  // 밸브식 콘솔: 문제가 있을 때만 보는 창이 아니라 항상 열어두는 관측창이다. 그래서 하단 드로어이고,
  // 채팅을 밀어내지 않고 그 위에 얹힌다. 백틱으로 열고 Esc로 닫는다(핫키는 PlayerPage가 소유).
  let copied=$state('');
  // 카드를 옮겨 다니면 사건이 섞인다. 기본은 "지금 이 채팅" — 복사본을 받는 쪽도 어느 게 현재 문제인지
  // 고를 필요가 없어야 한다. 전체 보기는 한 번 눌러서 켠다.
  let scoped=$state(true);
  let shown=$state<Record<DiagnosticLevel,boolean>>({error:true,warn:true,info:true,trace:true});
  let scope=$derived(scoped&&chat?chat:null);
  let visible=$derived((event:DiagnosticEvent)=>(!scope||event.chat===scope)&&shown[event.level]);
  let events=$derived(diagnostics.events.filter(visible).slice().reverse());
  let lastTurn=$derived(diagnostics.lastTurn(scope??undefined));
  const time=(at:number)=>new Date(at).toLocaleTimeString('ko-KR',{hour12:false});
  async function copy(what:'all'|'filtered'|'turn'){
    const text=what==='all'?diagnostics.copyText(undefined,undefined,'전체')
      :what==='filtered'?diagnostics.copyText(scope??undefined,visible,'현재 필터')
      :diagnostics.copyText(scope??undefined,(event)=>visible(event)&&event.turn===lastTurn,`마지막 턴(${lastTurn})`);
    await navigator.clipboard.writeText(text);copied=what;setTimeout(()=>copied='',1500);
  }
</script>

<aside class="console" aria-label="진단 콘솔">
  <header>
    <strong><Icon name="badge" size={13}/> 콘솔</strong>
    <div class="levels">
      {#each diagnosticLevels as level}
        <button class="chip {level}" class:off={!shown[level]} onclick={()=>shown[level]=!shown[level]} title="{diagnosticLevelLabel[level]} 표시/숨김">{diagnosticLevelLabel[level]}</button>
      {/each}
      {#if !diagnostics.levels.trace}<span class="hint" title="추적 사건은 꺼져 있으면 만들지도 않는다 — 설정 → 진단에서 켠다">추적 꺼짐</span>{/if}
    </div>
    {#if chat}<div class="scope"><button class:on={scoped} onclick={()=>scoped=true}>이 채팅</button><button class:on={!scoped} onclick={()=>scoped=false}>전체</button></div>{/if}
    <span class="spacer"></span>
    <div class="actions">
      <button disabled={!events.length} onclick={()=>copy('filtered')}>{copied==='filtered'?'복사됨':'현재 필터'}</button>
      <button disabled={lastTurn===null} onclick={()=>copy('turn')}>{copied==='turn'?'복사됨':'마지막 턴'}</button>
      <button disabled={!diagnostics.count} onclick={()=>copy('all')}>{copied==='all'?'복사됨':'전체'}</button>
      <button disabled={!diagnostics.count} onclick={()=>diagnostics.clear()}>비우기</button>
      <button class="icon" onclick={onclose} aria-label="콘솔 닫기"><Icon name="close" size={13}/></button>
    </div>
  </header>
  {#if !events.length}
    <p class="empty">기록된 사건이 없습니다. 카드를 굴리면 여기에 흐릅니다 — 실패한 단계는 물론이고, 처리 과정도 남습니다.</p>
  {:else}
    <ol>
      {#each events as event (event.key)}
        <li class={event.level}>
          <div class="head"><time>{time(event.at)}</time><span class="tag {event.level}">{diagnosticLevelLabel[event.level]}</span><span class="tag kind">{diagnosticLabel[event.kind]}</span><b>{event.summary}</b>{#if event.status==='pending'}<span class="tag pending">진행 중</span>{/if}<code>{event.code}</code></div>
          <dl>{#each Object.entries(event.detail) as [field,value]}<div><dt>{field}</dt><dd>{value}</dd></div>{/each}</dl>
        </li>
      {/each}
    </ol>
  {/if}
  <footer>카드 원문·대화 내용·API 키는 화면에도 복사본에도 들어가지 않습니다. 이 콘솔은 읽기 전용입니다 — 상태를 바꾸지 않습니다.</footer>
</aside>

<style>
  .console{position:fixed;left:0;right:0;bottom:0;z-index:58;display:flex;flex-direction:column;height:min(42vh,26rem);background:rgba(12,14,19,.97);border-top:1px solid #2b303b;box-shadow:0 -12px 40px rgba(0,0,0,.45);color:#dfe3ea;font-size:.78rem}
  header{display:flex;align-items:center;gap:.5rem;padding:.45rem .6rem;border-bottom:1px solid #23272f;flex-wrap:wrap}
  header strong{display:flex;align-items:center;gap:.3rem;font-size:.8rem}
  .spacer{flex:1}
  .levels,.scope,.actions{display:flex;gap:.2rem;align-items:center}
  .chip,.scope button,.actions button{padding:.2rem .45rem;border:1px solid #333944;border-radius:.35rem;background:transparent;color:inherit;font-size:.7rem;cursor:pointer}
  .chip.off{opacity:.35}
  .chip.error{border-color:#7a3a3a}.chip.warn{border-color:#7a6532}.chip.info{border-color:#33556f}.chip.trace{border-color:#3d3d4d}
  .scope button.on{background:#272c36}
  .actions button:disabled{opacity:.35;cursor:default}
  .hint{font-size:.65rem;opacity:.45;margin-left:.25rem}
  ol{flex:1;list-style:none;margin:0;padding:.35rem .6rem;overflow:auto;display:flex;flex-direction:column;gap:.2rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  li{padding:.3rem .45rem;border-left:2px solid #3d3d4d;background:rgba(255,255,255,.015)}
  li.error{border-left-color:#e05c5c}li.warn{border-left-color:#f0b429}li.info{border-left-color:#5b93c7}
  .head{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
  .head b{font-weight:600}
  .head code{margin-left:auto;opacity:.45;font-size:.68rem}
  time{opacity:.45;font-variant-numeric:tabular-nums}
  .tag{padding:.05rem .3rem;border-radius:.2rem;font-size:.65rem;background:rgba(255,255,255,.07)}
  .tag.error{background:rgba(224,92,92,.2);color:#f0a0a0}.tag.warn{background:rgba(240,180,41,.18);color:#f0cf8a}.tag.info{background:rgba(91,147,199,.18);color:#a8c9e8}
  .tag.pending{background:rgba(74,127,181,.2);color:#8ab6e8}
  dl{margin:.2rem 0 0;display:grid;gap:.05rem;padding-left:1rem}
  dl div{display:grid;grid-template-columns:7rem 1fr;gap:.5rem}
  dt{opacity:.45}
  dd{margin:0;word-break:break-all;opacity:.85}
  .empty{flex:1;display:flex;align-items:center;justify-content:center;margin:0;padding:1rem;opacity:.45;text-align:center;line-height:1.6}
  footer{padding:.35rem .6rem;border-top:1px solid #23272f;font-size:.65rem;opacity:.4}
  @media(max-width:999px){.console{top:0;height:100%;padding-top:env(safe-area-inset-top)}}
</style>
