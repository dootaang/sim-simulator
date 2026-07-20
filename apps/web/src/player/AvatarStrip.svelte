<script lang="ts">
  import type { CardLibraryMeta } from './card-library';
  import Icon from '@simbot/ui/Icon.svelte';
  import AdaptiveNav,{type NavDestination} from '@simbot/ui/AdaptiveNav.svelte';
  // UX-RENEWAL-MASTER §4.2: 데스크톱은 같은 4목적지를 왼쪽 세로 레일로 배치한다. 톱니 진입로는 레일의 '설정'으로 통일.
  let {cards,activeId,avatarFor:_,navActive='chat',chatEnabled=true,manageEnabled=true,onnavigate=()=>{},onadd,onselect,onremove}:{cards:Array<CardLibraryMeta&{ephemeral?:boolean}>;activeId:string|null;avatarFor?:(id:string)=>string|null;navActive?:NavDestination;chatEnabled?:boolean;manageEnabled?:boolean;onnavigate?:(dest:NavDestination)=>void;onadd:()=>void;onselect:(id:string)=>void;onremove:(id:string)=>void}=$props();
</script>
<aside class="strip" aria-label="카드 라이브러리">
  <AdaptiveNav active={navActive} {chatEnabled} {manageEnabled} {onnavigate}/>
  <div class="cards">{#each cards as card (card.projectId)}<button class:active={card.projectId===activeId} class="avatar" title={`${card.name}${card.ephemeral?' · 이번 세션만':''}`} onclick={()=>onselect(card.projectId)} oncontextmenu={(e)=>{e.preventDefault();onremove(card.projectId);}}>{#if card.thumbnail}<img src={card.thumbnail} alt=""/>{:else}<span>{card.name.slice(0,1)}</span>{/if}{#if card.ephemeral}<i>!</i>{/if}</button>{/each}<button class="add" onclick={onadd} aria-label="카드 가져오기"><Icon name="plus"/></button></div>
</aside>
<style>
  .strip{width:80px;height:100dvh;flex:none;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px 6px;background:#0f1013;border-right:1px solid #30333c}.cards{display:flex;flex-direction:column;align-items:center;gap:10px;overflow-y:auto;border-top:1px solid var(--color-line);padding-top:10px;width:100%}.avatar,.add{position:relative;width:54px;height:54px;display:grid;place-items:center;border:1px solid #3a3e48;border-radius:8px;background:#242730;color:#d9dce5;font-size:20px;cursor:pointer;overflow:hidden;transition:.14s}.avatar:hover,.add:hover{color:#fff;border-color:#6c98f4;background:#292d36}.avatar:active,.add:active{transform:scale(.96)}.avatar:focus-visible,.add:focus-visible{outline:2px solid #6c98f4;outline-offset:2px}.avatar img{width:100%;height:100%;object-fit:cover}.avatar.active{border-color:#6999ff;box-shadow:0 0 0 2px #6999ff44}.add{border-style:dashed}.avatar i{position:absolute;right:2px;bottom:2px;border-radius:50%;background:#d59532;color:#111;width:16px;height:16px;font:700 11px/16px sans-serif}@media(max-width:680px){.strip{display:none}}
@media(max-width:999px){.strip{display:none}}</style>
