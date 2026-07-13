<script lang="ts">
  import {onMount,tick,type Snippet} from 'svelte';
  let {label,onclose,children,dock=false,strong=false,zIndex=90,closeOnBackdrop=true}:{label:string;onclose:()=>void;children:Snippet;dock?:boolean;strong?:boolean;zIndex?:number;closeOnBackdrop?:boolean}=$props();
  let dialog=$state<HTMLDivElement>();
  onMount(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;void tick().then(()=>dialog?.focus());return()=>previous?.focus();});
  function keydown(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();onclose();return;}if(event.key!=='Tab'||!dialog)return;const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(value=>!value.hidden);if(!focusable.length){event.preventDefault();dialog.focus();return;}const first=focusable[0]!,last=focusable.at(-1)!;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
</script>
<div class="overlay" class:dock class:strong style:z-index={zIndex}>
  <div class="dialog" bind:this={dialog} role="dialog" aria-modal="true" aria-label={label} tabindex="-1" onkeydown={keydown} onclick={(event)=>{if(closeOnBackdrop&&event.target===event.currentTarget)onclose();}}>{@render children()}</div>
</div>
<style>
  .overlay{position:fixed;inset:0;display:grid;background:#07090db8;backdrop-filter:blur(4px)}.overlay.strong{background:#07090dd9;backdrop-filter:blur(5px)}.dialog{box-sizing:border-box;width:100%;height:100%;display:grid;place-items:center;padding:18px;outline:0}@media(max-width:700px){.dialog{padding:0}}@media(min-width:1000px){.overlay.dock{background:transparent;backdrop-filter:none;pointer-events:none}.overlay.dock .dialog{place-items:stretch end;padding:0}.overlay.dock .dialog :global(*){pointer-events:auto}}
</style>
