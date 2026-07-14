<script lang="ts">
  import type {ProjectRuntime} from '@simbot/runtime';
  import type {PlaySession} from '@simbot/session';
  import Icon from '@simbot/ui/Icon.svelte';
  import OverlayGuard from '@simbot/ui/OverlayGuard.svelte';
  import ScreenRenderer from './ScreenRenderer.svelte';
  let {runtime,version,session,portraitFor,onchange=()=>{},onclose}:{runtime:ProjectRuntime;version:number;session:PlaySession;portraitFor:(npcId:string,emotion?:string)=>string|null;onchange?:()=>void;onclose:()=>void}=$props();
</script>
<OverlayGuard label="시뮬레이션" {onclose} dock>
  <div class="panel">
    <header><div><b>시뮬레이션</b><small>엔진이 직접 계산하고 기록하는 게임 화면</small></div><button aria-label="닫기" onclick={onclose}><Icon name="close"/></button></header>
    <main><ScreenRenderer {runtime} {version} {session} {portraitFor} {onchange}/></main>
  </div>
</OverlayGuard>
<style>
  .panel{container:simulation-panel / inline-size;width:min(1100px,100%);height:min(860px,calc(100dvh - 36px));display:flex;flex-direction:column;border:1px solid #3b414d;border-radius:12px;background:#12151b;color:#eceef3;box-shadow:0 24px 80px #000b;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #30343d;background:#191c22}header div{display:grid;gap:2px}header small{font-size:11px;color:#9299a7}header button{display:grid;place-items:center;padding:7px;border:0;background:transparent;color:#b4bac6;cursor:pointer}main{padding:14px;overflow:auto}@media(max-width:700px){.panel{width:100%;height:100dvh;border:0;border-radius:0}main{padding:10px}}
  @media(min-width:1000px){
    .panel{width:min(460px,42vw);height:100dvh;border-width:0 0 0 1px;border-radius:0;box-shadow:-18px 0 48px #0008;pointer-events:auto}
  }
</style>
