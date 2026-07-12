<script lang="ts">
  import type { PlaySession, ChatMessage, SessionSnapshot } from '@simbot/session';
  import { alternateForward } from './card-library';
  import { toFactLine } from './FactReceipt.svelte';
  let {session,version,firstMessage='',cardName,model,portraitFor,onchange}:{session:PlaySession;version:number;firstMessage?:string;cardName:string;model:string;portraitFor:(id:string,emotion?:string)=>string|null;onchange:()=>void}=$props();
  let editing=$state<string|null>(null),draft=$state(''),busy=$state(false),alternateIndex=$state(0),latest=$state<SessionSnapshot|null>(null);
  // 대안 탐색 상태는 세션에 종속 — 채팅 전환·되돌리기로 대안이 사라지면 즉시 클램프하고 latest를 버린다.
  // (같은 카드의 다른 채팅은 projectId가 같아 stale latest가 무결성 검사를 통과해 버릴 수 있음 — 교차 오염 차단)
  $effect(()=>{void version;void session;const max=session.alternateCount;if(alternateIndex>max||latest&&latest.id!==session.id){alternateIndex=Math.min(alternateIndex,max);latest=null;}});
  let messages=$derived.by(()=>{void version;return session.messages;});
  let facts=$derived(session.lastLogs.map(toFactLine));
  function name(message:ChatMessage){return message.role==='user'?'사용자':cardName;}
  async function save(message:ChatMessage){if(draft.trim()&&draft!==message.content)await session.editMessage(message.id,draft);editing=null;onchange();}
  async function remove(message:ChatMessage,cascade=false){if(cascade&&!confirm('이 메시지 이후를 전부 삭제할까요?'))return;await session.removeMessage(message.id,cascade);onchange();}
  async function left(){if(alternateIndex<=0)return;busy=true;try{if(alternateIndex===session.alternateCount)latest=session.snapshot();alternateIndex-=1;await session.showAlternate(alternateIndex);onchange();}finally{busy=false;}}
  async function right(){busy=true;try{const action=alternateForward(alternateIndex,session.alternateCount);if(action.kind==='show'){alternateIndex=action.index;if(action.index===session.alternateCount&&latest){session.restore(latest);await session.save();}else await session.showAlternate(action.index);}else{await session.reroll();alternateIndex=session.alternateCount;latest=session.snapshot();}onchange();}finally{busy=false;}}
</script>
<div class="list">
  {#if !messages.length&&firstMessage}<article class="message assistant"><div class="avatar">{#if portraitFor(cardName)}<img src={portraitFor(cardName)!} alt=""/>{:else}{cardName.slice(0,1)}{/if}</div><div class="body"><div class="head"><strong>{cardName}</strong><span>첫 메시지</span></div><div class="text">{firstMessage}</div></div></article>{/if}
  {#each messages as message,index (message.id)}
    <article class="message" class:user={message.role==='user'} class:assistant={message.role==='assistant'}>
      <div class="avatar">{#if portraitFor(message.role==='assistant'?cardName:'user')}<img src={portraitFor(message.role==='assistant'?cardName:'user')!} alt=""/>{:else}{name(message).slice(0,1)}{/if}</div>
      <div class="body"><div class="head"><strong>{name(message)}</strong><span>{message.role==='assistant'?'default':''}</span><div class="tools"><button title="편집" onclick={()=>{editing=message.id;draft=message.content;}}>✎</button><button title="복사" onclick={()=>navigator.clipboard.writeText(message.content)}>⧉</button><button title="삭제" onclick={()=>void remove(message)}>🗑</button><button title="이후 전부 삭제" onclick={()=>void remove(message,true)}>⋯</button></div></div>
        {#if editing===message.id}<textarea bind:value={draft} onblur={()=>void save(message)} onkeydown={(e)=>{if(e.key==='Enter'&&e.ctrlKey)void save(message);}}></textarea>{:else}<div class="text">{message.content}</div>{/if}
        {#if message.role==='assistant'}<div class="meta"><span class="model">🤖 {model}</span>{#if index===messages.length-1}<span class="swipe"><button disabled={busy||alternateIndex===0} onclick={()=>void left()}>←</button><b>{alternateIndex+1}/{session.alternateCount+1}</b><button disabled={busy||session.checkpointDepth===0} onclick={()=>void right()}>→</button></span>{/if}</div>{/if}
        {#if message.role==='assistant'&&index===messages.length-1&&facts.length}<div class="chips">{#each facts as fact}<span class:rejected={fact.rejected}>{fact.icon} {fact.label} {fact.delta??''}</span>{/each}</div>{/if}
      </div>
    </article>
  {/each}
</div>
<style>
  .list{padding:34px 24px 120px}.message{display:grid;grid-template-columns:56px minmax(0,1fr);gap:14px;margin:0 auto 28px;max-width:900px}.avatar{width:56px;height:56px;border-radius:8px;background:#292d36;display:grid;place-items:center;font:700 20px sans-serif;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}.head{display:flex;align-items:center;gap:8px;min-height:26px;font-family:sans-serif}.head span{font-size:11px;color:#858b98}.tools{margin-left:auto;display:flex;gap:2px}.tools button,.swipe button{border:0;background:transparent;color:#858b98;cursor:pointer;padding:4px 6px}.tools button:hover,.swipe button:hover{color:#78a2ff}.text{white-space:pre-wrap;color:#e7e4dc;font:16px/1.78 Georgia,'Noto Serif KR',serif}.user .text{font-family:system-ui,sans-serif;color:#d9dde7}.body textarea{width:100%;min-height:110px;padding:10px;background:#191c22;color:#eee;border:1px solid #6793ef;border-radius:8px}.meta{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:7px;font:11px sans-serif;color:#727887}.model{background:#20242c;padding:3px 7px;border-radius:10px}.swipe{display:flex;align-items:center}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.chips span{border:1px solid #477a63;border-radius:999px;padding:3px 8px;font:11px sans-serif;color:#a7d7bf}.chips .rejected{border-color:#8b4d59;color:#e0a7b0}@media(max-width:680px){.list{padding-inline:12px}.message{grid-template-columns:42px 1fr}.avatar{width:42px;height:42px}}
</style>
