<script lang="ts" module>
  export type NavDestination='bots'|'chat'|'manage'|'settings';
</script>
<script lang="ts">
  import Icon from './icons/Icon.svelte';
  // UX-RENEWAL-MASTER §4: 최상위 목적지 4개는 화면 크기와 무관하게 같은 이름·순서를 유지한다.
  // 1000px 미만에서는 하단 탭바, 이상에서는 왼쪽 세로 레일로 배치만 바뀐다.
  let{active,chatEnabled=true,manageEnabled=true,onnavigate}:{active:NavDestination;chatEnabled?:boolean;manageEnabled?:boolean;onnavigate:(dest:NavDestination)=>void}=$props();
  const items:Array<{id:NavDestination;label:string;icon:string;aria?:string}>=[
    {id:'bots',label:'봇',icon:'bot',aria:'봇 목록'},
    {id:'chat',label:'대화',icon:'message'},
    {id:'manage',label:'관리',icon:'shield',aria:'관리 화면'},
    {id:'settings',label:'설정',icon:'settings',aria:'전체 설정'}
  ];
</script>

<nav class="adaptive-nav" aria-label="주요 메뉴">
  {#each items as item(item.id)}
    <button class:active={active===item.id} aria-label={item.aria??item.label} aria-current={active===item.id?'page':undefined} disabled={item.id==='chat'&&!chatEnabled||item.id==='manage'&&!manageEnabled} onclick={()=>onnavigate(item.id)}>
      <Icon name={item.icon} size={22}/><span>{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .adaptive-nav{display:flex;background:var(--color-inset);border-color:var(--color-line)}
  .adaptive-nav button{display:grid;place-items:center;gap:2px;min-width:var(--touch-min);min-height:var(--touch-min);padding:var(--space-1);border:0;background:transparent;color:var(--color-text-muted);font-size:var(--type-caption);cursor:pointer;transition:color var(--motion-fast)}
  .adaptive-nav button.active{color:var(--color-accent)}
  .adaptive-nav button:hover:not(:disabled){color:var(--color-text)}
  .adaptive-nav button:disabled{opacity:.4;cursor:default}
  .adaptive-nav button:focus-visible{outline:2px solid var(--color-focus);outline-offset:-2px}
  @media(max-width:999px){
    /* 오버레이(z=90)보다 위 — 관리·설정이 열려 있어도 최상위 목적지는 한 번의 탭으로 이동한다. */
    .adaptive-nav{position:fixed;inset:auto 0 0;z-index:95;justify-content:space-around;border-top:1px solid var(--color-line);padding-bottom:env(safe-area-inset-bottom)}
    .adaptive-nav button{flex:1;height:var(--nav-size)}
  }
  @media(min-width:1000px){
    .adaptive-nav{flex-direction:column;justify-content:flex-start;gap:var(--space-2);width:100%;padding:var(--space-2) 0;border:0;background:transparent}
    .adaptive-nav button{width:100%}
  }
</style>
