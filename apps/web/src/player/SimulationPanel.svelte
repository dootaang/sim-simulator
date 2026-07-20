<script lang="ts">
  import type {ProjectRuntime} from '@simbot/runtime';
  import type {PlaySession} from '@simbot/session';
  import Icon from '@simbot/ui/Icon.svelte';
  import OverlayGuard from '@simbot/ui/OverlayGuard.svelte';
  import ScreenRenderer from './ScreenRenderer.svelte';
  import DecisionDock from './DecisionDock.svelte';
  import type{DecisionCardModel}from'./decision-model';
  import type {SimulationActionHandler} from './simulation-action';
  import {isNativeGflPresentation} from './gfl-presentation';
  let {runtime,version,assetRevision=0,session,portraitFor,portraitThumbFor=portraitFor,assetFor=()=>null,busy=false,pinned=false,pinnable=true,decisionCards=[],onaction,onchange=()=>{},onpin=()=>{},onclose}:{runtime:ProjectRuntime;version:number;assetRevision?:number;session:PlaySession;portraitFor:(npcId:string,emotion?:string,outfit?:number)=>string|null;portraitThumbFor?:(npcId:string,emotion?:string,outfit?:number)=>string|null;assetFor?:(name:string)=>string|null;busy?:boolean;pinned?:boolean;pinnable?:boolean;decisionCards?:DecisionCardModel[];onaction:SimulationActionHandler;onchange?:()=>void;onpin?:()=>void;onclose:()=>void}=$props();
  // 자체 크롬(테두리·status 헤더)을 완비한 네이티브 콘솔은 다이얼로그 헤더를 접는다 — "창 속 창 속 창" 해소.
  // 핀·닫기는 우상단 플로팅으로 이사(aria-label 불변 — e2e·접근성 계약 유지).
  let fullBleed=$derived(isNativeGflPresentation(runtime.project));
</script>
{#snippet body()}
  {#if fullBleed}
    <div class="float-tools">{#if pinnable||pinned}<button class:active={pinned} title={pinned?'고정 해제':'우측에 고정'} aria-label={pinned?'럭키 시뮬레이션 고정 해제':'럭키 시뮬레이션 우측 고정'} onclick={onpin}><Icon name="pin" size={15}/></button>{/if}<button aria-label="닫기" onclick={onclose}><Icon name="close"/></button></div>
  {:else}
  <header><div><b>럭키 시뮬레이션</b></div><div class="tools">{#if pinnable||pinned}<button class:active={pinned} title={pinned?'고정 해제':'우측에 고정'} aria-label={pinned?'럭키 시뮬레이션 고정 해제':'럭키 시뮬레이션 우측 고정'} onclick={onpin}><Icon name="pin" size={15}/></button>{/if}<button aria-label="닫기" onclick={onclose}><Icon name="close"/></button></div></header>
  {/if}
  <main class:flush={fullBleed}><ScreenRenderer {runtime} {version} {assetRevision} {session} {portraitFor} {portraitThumbFor} {assetFor} {busy} {onaction} {onchange}/></main>{#if decisionCards.length}<footer class="decision-mirror"><DecisionDock cards={decisionCards} {busy} {onaction}/></footer>{/if}
{/snippet}
<!-- 핀 모드: 오버레이가 아니라 셸의 레이아웃 칼럼 — 채팅이 옆에 그대로 보이므로 행동 후에도 닫지 않는다(조종석 ③ 정비소). -->
{#if pinned}
  <aside class="panel pinned" aria-label="럭키 시뮬레이션">{@render body()}</aside>
{:else}
  <OverlayGuard label="럭키 시뮬레이션" {onclose} dock>
    <div class="panel">{@render body()}</div>
  </OverlayGuard>
{/if}
<style>
  .panel{container:simulation-panel / inline-size;position:relative;width:min(1100px,100%);height:min(860px,calc(100dvh - 36px));display:flex;flex-direction:column;border:1px solid #3b414d;border-radius:12px;background:#12151b;color:#eceef3;box-shadow:0 24px 80px #000b;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #30343d;background:#191c22}header>div:first-child{display:grid;gap:2px}.tools{display:flex;align-items:center;gap:2px}header button{display:grid;place-items:center;padding:7px;border:0;background:transparent;color:#b4bac6;cursor:pointer}header button:hover,header button.active{color:#8fb3ff}main{flex:1;min-height:0;padding:14px;overflow:auto}main.flush{padding:0}.float-tools{position:absolute;top:8px;right:10px;z-index:6;display:flex;gap:2px;padding:2px;border:1px solid #3b414d;border-radius:999px;background:#12151bd9;backdrop-filter:blur(2px)}.float-tools button{display:grid;place-items:center;padding:6px;border:0;border-radius:999px;background:transparent;color:#b4bac6;cursor:pointer}.float-tools button:hover,.float-tools button.active{color:#8fb3ff}.decision-mirror{flex:none;max-height:38dvh;overflow:auto;border-top:1px solid #30343d;background:#0e1116}@media(max-width:700px){.panel{width:100%;height:100%;border:0;border-radius:0}main{padding:10px}}
  @media(min-width:1000px){
    .panel{width:min(460px,42vw);height:100dvh;border-width:0 0 0 1px;border-radius:0;box-shadow:-18px 0 48px #0008;pointer-events:auto}
  }
  .panel.pinned{flex:none;width:min(460px,40vw);height:100dvh;border-width:0 0 0 1px;border-radius:0;box-shadow:none}
</style>
