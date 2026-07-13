<script lang="ts">
  import type{CardAsset}from'@simbot/card';
  import{parseCbs}from'@simbot/risu';
  import{safeBackgroundSource}from'./background-render';
  let{html='',assets=[],variables={},userName='User',charName='Character',assetUrlFor}:{html?:string;assets?:CardAsset[];variables?:Record<string,string>;userName?:string;charName?:string;assetUrlFor:(asset:CardAsset)=>string|null}=$props();
  let source=$derived.by(()=>{if(!html.trim())return'';const cbs=parseCbs(html,{variables:{...variables},userName,charName,screenWidth:typeof innerWidth==='number'?innerWidth:0});return safeBackgroundSource(cbs,assets,asset=>assetUrlFor(asset as CardAsset));});
</script>
{#if source}<div class="background-host" aria-hidden="true">{@html source}</div>{/if}
<style>.background-host{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}.background-host :global(.lucky-card-background-content){position:absolute;inset:0;background:transparent}.background-host :global(img),.background-host :global(video){max-width:100%;height:auto}</style>
