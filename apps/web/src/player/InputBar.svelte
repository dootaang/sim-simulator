<script lang="ts">
  import Icon from '@simbot/ui/Icon.svelte';
  let { busy = false, draft = '', onsend, onstop }: { busy?: boolean; draft?: string; onsend: (text: string) => Promise<void>; onstop: () => void } = $props();
  let text = $state('');
  // UX-RENEWAL §6.2: AI 연결 시트가 떴다 닫혀도 사용자가 쓴 문장은 사라지지 않는다.
  $effect(()=>{if(draft)text=draft;});
  async function submit(){const value=text.trim();if(!value||busy)return;text='';await onsend(value);}
</script>

<form onsubmit={(event)=>{event.preventDefault();void submit();}}>
  <textarea bind:value={text} placeholder="메시지를 입력하세요" rows="1" onkeydown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit();}}}></textarea>
  {#if busy}<button type="button" class="stop" onclick={onstop} aria-label="답변 중단"><Icon name="stop"/></button>{:else}<button disabled={!text.trim()} aria-label="보내기"><Icon name="send"/></button>{/if}
</form>

<style>
  form{display:flex;gap:0;align-items:stretch;padding:14px 18px 18px;background:linear-gradient(transparent,#111318 28%)}textarea{flex:1;max-height:160px;resize:vertical;padding:13px 15px;border:1px solid #343843;border-right:0;border-radius:7px 0 0 7px;background:#15171c;color:#eef0f5;font:15px/1.45 sans-serif}textarea:focus-visible{outline:0;border-color:#7999dc;box-shadow:0 0 0 1px #7999dc inset}button{width:48px;border:1px solid #343843;border-radius:0 7px 7px 0;background:#222630;color:#eee;display:grid;place-items:center;transition:.12s}button:hover{background:#426fcf;color:#fff}button:active{transform:scale(.97)}button:focus-visible{outline:2px solid #6c98f4;outline-offset:2px}button.stop{background:#71333b}button:disabled{opacity:.45}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
