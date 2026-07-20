<script lang="ts">
  import type{ChatIndex}from'@simbot/session';
  import type{CardLibraryMeta}from'./card-library';
  import Icon from'@simbot/ui/Icon.svelte';
  type ShellPage='chat'|'library'|'chats';
  let{cardName='봇을 선택하세요',cards,index,activeId,hasCard=false,sideOpen=false,page='chat',playLabel='플레이',playEnabled=false,onadd,oncard,onremove,onchat=()=>{},onnewchat=()=>{},onrenamechat=()=>{},onremovechat=()=>{},onplay=()=>{},onsideopen=()=>{},onsideclose=()=>{},onpage=()=>{}}:{cardName?:string;cards:CardLibraryMeta[];index:ChatIndex;activeId:string|null;hasCard?:boolean;sideOpen?:boolean;page?:ShellPage;playLabel?:string;playEnabled?:boolean;onadd:()=>void;oncard:(id:string)=>void;onremove:(id:string)=>void;onchat?:(id:string)=>void;onnewchat?:()=>void;onrenamechat?:(id:string)=>void;onremovechat?:(id:string)=>void;onplay?:()=>void;onsideopen?:()=>void;onsideclose?:()=>void;onpage?:(page:ShellPage)=>void}=$props();
  let query=$state('');
  let filtered=$derived(cards.filter(card=>card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  function chooseCard(id:string){onpage('chats');oncard(id);}
  function chooseChat(id:string){onpage('chat');onchat(id);}
</script>

<svelte:window onkeydown={(event)=>{if(event.key!=='Escape')return;if(sideOpen)onsideclose();else if(page==='chat'&&hasCard)onpage('chats');}}/>
<header class="appbar">
  {#if sideOpen}<button aria-label="메뉴 닫기" onclick={onsideclose}><Icon name="left"/></button><strong>메뉴</strong><span class="slot"></span>
  {:else if page==='chat'&&hasCard}<button aria-label="대화 목록" onclick={()=>onpage('chats')}><Icon name="left"/></button><strong>{cardName}</strong>{#if playEnabled}<button class="play" aria-label={`${playLabel} 열기`} onclick={onplay}>{playLabel}</button>{:else}<button aria-label="현재 봇 메뉴" onclick={onsideopen}><Icon name="ellipsis"/></button>{/if}
  {:else if page==='chats'&&hasCard}<span class="brand">★</span><strong>대화</strong><button aria-label="현재 봇 메뉴" onclick={onsideopen}><Icon name="ellipsis"/></button>
  {:else}<span class="brand">★</span><strong>봇 목록</strong><span class="slot"></span>{/if}
</header>

{#if page==='library'&&!sideOpen}
  <section class="browser library" aria-label="봇 목록">
    <div class="search"><Icon name="search" size={18}/><input bind:value={query} aria-label="봇 검색" placeholder="봇 검색"/></div>
    <div class="rows">
      {#each filtered as card(card.projectId)}<div class:active={card.projectId===activeId} class="card-row"><button class="select-row" onclick={()=>chooseCard(card.projectId)}><span class="avatar">{#if card.thumbnail}<img src={card.thumbnail} alt=""/>{:else}{card.name.slice(0,1)}{/if}</span><span class="meta"><b>{card.name}</b><small>{card.projectId===activeId?`${index.chats.length}개 대화 · 현재 봇`:card.missing?'원본 재연결 필요':'대화 목록 보기'}</small></span><Icon name="right" size={18}/></button><button class="remove-row" aria-label="봇 삭제" title={`${card.name} 삭제`} onclick={()=>onremove(card.projectId)}><Icon name="trash" size={17}/><span>삭제</span></button></div>{/each}
      {#if !filtered.length&&cards.length}<p>검색 결과가 없습니다.</p>{/if}
      {#if !cards.length}<div class="empty"><b>아직 가져온 봇이 없습니다.</b><span>RisuAI 카드 파일을 이 기기에 가져오세요.</span></div>{/if}
    </div>
    <button class="add" onclick={onadd} aria-label="봇카드 가져오기"><Icon name="plus"/> 봇카드 가져오기</button>
  </section>
{:else if page==='chats'&&!sideOpen}
  <section class="browser chats" aria-label="대화 목록">
    <div class="list-head"><div><b>{cardName}</b><span>이어갈 대화를 선택하세요.</span></div><button onclick={onnewchat}><Icon name="plus" size={17}/> 새 대화</button></div>
    <div class="rows chat-rows">
      {#each index.chats as chat(chat.chatId)}<div class:active={chat.chatId===index.activeChatId} class="chat-row"><button class="select-chat" onclick={()=>chooseChat(chat.chatId)}><span><b>{chat.name}</b><small>{chat.turn}턴 · {new Date(chat.updatedAt).toLocaleDateString()}</small></span><Icon name="right" size={18}/></button><button aria-label={`${chat.name} 이름 변경`} onclick={()=>onrenamechat(chat.chatId)}><Icon name="pencil" size={16}/></button><button aria-label={`${chat.name} 삭제`} onclick={()=>onremovechat(chat.chatId)}><Icon name="trash" size={16}/></button></div>{/each}
      {#if !index.chats.length}<div class="empty"><b>아직 대화가 없습니다.</b><span>새 대화를 만들면 여기에서 이어갈 수 있습니다.</span></div>{/if}
    </div>
  </section>
{/if}

<style>
  .appbar,.browser{display:none}.browser{flex-direction:column;background:var(--color-canvas);color:var(--color-text)}.search{display:flex;align-items:center;gap:9px;margin:12px;padding:0 12px;border:1px solid var(--color-line);border-radius:9px;background:var(--color-surface);color:var(--color-text-muted)}.search input{flex:1;min-width:0;padding:12px 0;border:0;outline:0;background:transparent;color:var(--color-text);font-size:16px}.rows{flex:1;overflow-y:auto;padding:0 12px 92px}.card-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border-top:1px solid var(--color-line)}.card-row:first-child{border-top:0}.card-row.active,.chat-row.active{border-radius:9px;background:var(--color-selected)}.select-row{width:100%;display:grid;grid-template-columns:58px minmax(0,1fr) 24px;align-items:center;gap:12px;padding:11px 8px;border:0;background:transparent;color:inherit;text-align:left}.remove-row{display:grid;place-items:center;gap:2px;align-self:stretch;min-width:54px;padding:8px 5px;border:0;border-left:1px solid var(--color-line);background:transparent;color:var(--color-danger);font-size:11px}.remove-row:active{background:color-mix(in srgb,var(--color-danger) 24%,var(--color-surface));color:var(--color-text)}.avatar{width:58px;height:58px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--color-line);border-radius:10px;background:var(--color-surface-raised);font-size:20px}.avatar img{width:100%;height:100%;object-fit:cover}.meta{display:grid;gap:6px;min-width:0}.meta b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.meta small,.list-head span,.select-chat small{color:var(--color-text-muted)}.empty{display:grid;place-items:center;gap:7px;padding:54px 20px;text-align:center;color:var(--color-text-muted)}.empty b{color:var(--color-text)}.rows p{text-align:center;color:var(--color-text-muted)}.add{position:fixed;z-index:32;display:flex;align-items:center;gap:7px;padding:12px 16px;border:1px solid var(--color-line);border-radius:999px;background:var(--color-surface-raised);color:var(--color-text);box-shadow:var(--shadow-panel)}.list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px;border-bottom:1px solid var(--color-line)}.list-head div{display:grid;gap:4px}.list-head button{display:flex;align-items:center;gap:5px;padding:9px 11px;border:1px solid var(--color-line);border-radius:8px;background:var(--color-surface-raised);color:var(--color-text)}.chat-row{display:grid;grid-template-columns:minmax(0,1fr) 44px 44px;align-items:stretch;border-bottom:1px solid var(--color-line)}.chat-row>button{border:0;background:transparent;color:var(--color-text-muted)}.select-chat{display:flex;align-items:center;justify-content:space-between;padding:14px 10px;text-align:left}.select-chat span{display:grid;gap:5px}.chat-row>button:not(.select-chat):active{background:color-mix(in srgb,var(--color-danger) 18%,var(--color-surface));color:var(--color-danger)}
  @media(min-width:1000px){.browser{display:flex;position:fixed;inset:0 0 0 80px;z-index:30}.rows{padding:0 24px 92px}.search,.list-head{max-width:720px;width:calc(100% - 48px);margin:20px auto 12px;box-sizing:border-box}.card-row,.chat-row{max-width:720px;width:100%;margin:0 auto}.add{right:24px;bottom:24px}:global(.shell:has(.browser) main),:global(.shell:has(.browser) .simulation){visibility:hidden;pointer-events:none}}
  @media(max-width:999px){.appbar{position:fixed;inset:0 0 auto;z-index:35;min-height:56px;display:grid;grid-template-columns:64px minmax(0,1fr) 64px;align-items:center;border-bottom:1px solid var(--color-line);background:var(--color-canvas);color:var(--color-text);padding-top:env(safe-area-inset-top)}.appbar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:16px}.appbar button{min-height:56px;display:grid;place-items:center;border:0;background:transparent;color:inherit}.appbar .play{padding:0 7px;color:var(--color-accent);font-size:12px;font-weight:700}.brand{display:grid;place-items:center;color:var(--color-accent);font-size:18px}.browser{display:flex;position:fixed;inset:calc(56px + env(safe-area-inset-top)) 0 var(--bottom-nav-inset,0px);z-index:30}.add{right:18px;bottom:calc(18px + var(--bottom-nav-inset,0px))}:global(.shell:has(.browser) main),:global(.shell:has(.side.open) main){visibility:hidden;pointer-events:none}}
</style>
