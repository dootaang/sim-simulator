<script lang="ts">
  import type {ProjectRuntime} from '@simbot/runtime';
  import type {PlaySession} from '@simbot/session';
  import Icon from '@simbot/ui/Icon.svelte';
  import OverlayGuard from '@simbot/ui/OverlayGuard.svelte';
  import ScreenRenderer from './ScreenRenderer.svelte';
  import type {SimulationActionHandler} from './simulation-action';
  let {runtime,version,session,portraitFor,busy=false,pinned=false,pinnable=true,onaction,onchange=()=>{},onpin=()=>{},onclose}:{runtime:ProjectRuntime;version:number;session:PlaySession;portraitFor:(npcId:string,emotion?:string,outfit?:number)=>string|null;busy?:boolean;pinned?:boolean;pinnable?:boolean;onaction:SimulationActionHandler;onchange?:()=>void;onpin?:()=>void;onclose:()=>void}=$props();
</script>
{#snippet body()}
  <header><div><b>시뮬레이션</b><small>엔진이 직접 계산하고 기록하는 게임 화면</small></div><div class="tools">{#if pinnable||pinned}<button class:active={pinned} title={pinned?'고정 해제':'우측에 고정'} aria-label={pinned?'시뮬레이션 고정 해제':'시뮬레이션 우측 고정'} onclick={onpin}><Icon name="pin" size={15}/></button>{/if}<button aria-label="닫기" onclick={onclose}><Icon name="close"/></button></div></header>
  <main><ScreenRenderer {runtime} {version} {session} {portraitFor} {busy} {onaction} {onchange}/></main>
{/snippet}
<!-- 핀 모드: 오버레이가 아니라 셸의 레이아웃 칼럼 — 채팅이 옆에 그대로 보이므로 행동 후에도 닫지 않는다(조종석 ③ 정비소). -->
{#if pinned}
  <aside class="panel pinned" aria-label="시뮬레이션">{@render body()}</aside>
{:else}
  <OverlayGuard label="시뮬레이션" {onclose} dock>
    <div class="panel">{@render body()}</div>
  </OverlayGuard>
{/if}
<style>
  .panel{container:simulation-panel / inline-size;width:min(1100px,100%);height:min(860px,calc(100dvh - 36px));display:flex;flex-direction:column;border:1px solid #3b414d;border-radius:12px;background:#12151b;color:#eceef3;box-shadow:0 24px 80px #000b;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #30343d;background:#191c22}header>div:first-child{display:grid;gap:2px}header small{font-size:11px;color:#9299a7}.tools{display:flex;align-items:center;gap:2px}header button{display:grid;place-items:center;padding:7px;border:0;background:transparent;color:#b4bac6;cursor:pointer}header button:hover,header button.active{color:#8fb3ff}main{padding:14px;overflow:auto}@media(max-width:700px){.panel{width:100%;height:100dvh;border:0;border-radius:0}main{padding:10px}}
  @media(min-width:1000px){
    .panel{width:min(460px,42vw);height:100dvh;border-width:0 0 0 1px;border-radius:0;box-shadow:-18px 0 48px #0008;pointer-events:auto}
  }
  .panel.pinned{flex:none;width:min(460px,40vw);height:100dvh;border-width:0 0 0 1px;border-radius:0;box-shadow:none}
</style>
