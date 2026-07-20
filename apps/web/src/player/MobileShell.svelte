<script lang="ts">
  import type{ChatIndex}from'@simbot/session';
  import type{CardLibraryMeta}from'./card-library';
  import Icon from'@simbot/ui/Icon.svelte';
  // UX-RENEWAL-MASTER §4.1: 전체 설정 진입로는 하단 탭 하나뿐 — 앱바의 톱니는 제거됐다.
  // page 상태는 PlayerPage가 소유한다(하단 탭 '봇'과 앱바가 같은 상태를 공유해야 하므로).
  let{cardName='봇을 선택하세요',cards,index,activeId,hasCard=false,sideOpen=false,page='chat',onadd,oncard,onremove,onsideopen=()=>{},onsideclose=()=>{},onpage=()=>{}}:{cardName?:string;cards:CardLibraryMeta[];index:ChatIndex;activeId:string|null;hasCard?:boolean;sideOpen?:boolean;page?:'chat'|'library';onadd:()=>void;oncard:(id:string)=>void;onremove:(id:string)=>void;onsideopen?:()=>void;onsideclose?:()=>void;onpage?:(page:'chat'|'library')=>void}=$props();
  let query=$state('');
  let filtered=$derived(cards.filter(card=>card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  function choose(id:string){onpage('chat');oncard(id);}
</script>

<svelte:window onkeydown={(event)=>{if(event.key!=='Escape')return;if(sideOpen)onsideclose();else if(page==='library'&&hasCard)onpage('chat');}}/>
<header class="appbar">
  {#if sideOpen}<button aria-label="메뉴 닫기" onclick={onsideclose}><Icon name="left"/></button><strong>메뉴</strong><span class="slot"></span>
  {:else if page==='chat'&&hasCard}<span class="brand">★</span><strong>{cardName}</strong><button aria-label="현재 봇 메뉴" onclick={onsideopen}><Icon name="ellipsis"/></button>
  {:else}<span class="brand">★</span><strong>봇 목록</strong><span class="slot"></span>{/if}
</header>

{#if page==='library'&&!sideOpen}
  <section class="library" aria-label="봇 목록">
    <div class="search"><Icon name="search" size={18}/><input bind:value={query} aria-label="봇 검색" placeholder="봇 검색"/></div>
    <div class="cards">
      {#each filtered as card(card.projectId)}<div class:active={card.projectId===activeId} class="card-row"><button class="select-card" onclick={()=>choose(card.projectId)}><span class="avatar">{#if card.thumbnail}<img src={card.thumbnail} alt=""/>{:else}{card.name.slice(0,1)}{/if}</span><span class="meta"><b>{card.name}</b><small>{card.projectId===activeId?`${index.chats.length}개 채팅 · 현재 사용 중`:card.missing?'원본 재연결 필요':'열어서 계속하기'}</small></span><Icon name="right" size={18}/></button><button class="remove-card" aria-label="봇 삭제" title={`${card.name} 삭제`} onclick={()=>onremove(card.projectId)}><Icon name="trash" size={17}/><span>삭제</span></button></div>{/each}
      {#if !filtered.length&&cards.length}<p>검색 결과가 없습니다.</p>{/if}
      {#if !cards.length}<div class="empty"><b>아직 가져온 봇이 없습니다.</b><span>RisuAI 카드 파일을 이 기기에 가져오세요.</span></div>{/if}
    </div>
    <button class="add" onclick={onadd} aria-label="봇카드 가져오기"><Icon name="plus"/> 봇카드 가져오기</button>
  </section>
{/if}

<style>
  .appbar,.library{display:none}
  @media(max-width:999px){
    .appbar{position:fixed;inset:0 0 auto;z-index:35;min-height:56px;display:grid;grid-template-columns:52px minmax(0,1fr) 52px;align-items:center;border-bottom:1px solid #30343d;background:#111318;color:#eef0f5;padding-top:env(safe-area-inset-top)}
    .appbar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:16px}.appbar button{height:56px;display:grid;place-items:center;border:0;background:transparent;color:inherit}.brand{display:grid;place-items:center;color:#d8b36a;font-size:18px}
    .library{display:flex;position:fixed;inset:calc(56px + env(safe-area-inset-top)) 0 var(--bottom-nav-inset,0px);z-index:30;flex-direction:column;background:#111318;color:#eef0f5}.search{display:flex;align-items:center;gap:9px;margin:12px;padding:0 12px;border:1px solid #363b46;border-radius:9px;background:#181b21;color:#858d9c}.search input{flex:1;min-width:0;padding:12px 0;border:0;outline:0;background:transparent;color:#eef0f5;font-size:16px}.cards{flex:1;overflow-y:auto;padding:0 12px 92px}.card-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border-top:1px solid #292d35}.card-row:first-child{border-top:0}.card-row.active{border-radius:9px;background:#202633}.select-card{width:100%;display:grid;grid-template-columns:58px minmax(0,1fr) 24px;align-items:center;gap:12px;padding:11px 8px;border:0;background:transparent;color:inherit;text-align:left}.remove-card{display:grid;place-items:center;gap:2px;align-self:stretch;min-width:54px;padding:8px 5px;border:0;border-left:1px solid #303641;background:transparent;color:#d3a0a0;font-size:11px}.remove-card:active{background:#522a2f;color:#fff}.avatar{width:58px;height:58px;display:grid;place-items:center;overflow:hidden;border:1px solid #3b414c;border-radius:10px;background:#292d36;font-size:20px}.avatar img{width:100%;height:100%;object-fit:cover}.meta{display:grid;gap:6px;min-width:0}.meta b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.meta small{color:#858d9c}.empty{display:grid;place-items:center;gap:7px;padding:54px 20px;text-align:center;color:#8d95a3}.empty b{color:#dfe3eb}.cards p{text-align:center;color:#8d95a3}.add{position:fixed;right:18px;bottom:calc(18px + var(--bottom-nav-inset,0px));z-index:32;display:flex;align-items:center;gap:7px;padding:12px 16px;border:1px solid #596579;border-radius:999px;background:#293344;color:#e9eef8;box-shadow:0 8px 24px #0008}
    :global(.shell:has(.library) main),:global(.shell:has(.side.open) main){visibility:hidden;pointer-events:none}
  }
</style>
