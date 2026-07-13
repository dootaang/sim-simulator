<script lang="ts">
  import type { CardAsset } from '@simbot/card';
  import type { ChatIndex, PlaySession } from '@simbot/session';
  import type { CardPassport, CardRuntimeProfile, Persona } from '@simbot/risu';
  import Icon from '@simbot/ui/Icon.svelte';
  import PassportPanel from './PassportPanel.svelte';
  import NpcGallery from './NpcGallery.svelte';
  import { toFactLine } from './FactReceipt.svelte';
  import { summarizeEngineState } from './card-library';

  interface BindingUi { personas: Persona[]; boundId: string | null; onchange: (id: string | null) => void }
  let { profile, passport, index, session, version, bindingUi, assets, assetUrlFor, open = false, compiling = false, oncreate, onselect, onrename, onremove, onexport, onimport, oncompile, onsim, oninspect, onedit, onundo, onredo }: {
    profile: CardRuntimeProfile; passport: CardPassport; index: ChatIndex; session: PlaySession; version: number;
    bindingUi: BindingUi; assets: CardAsset[]; assetUrlFor: (asset: CardAsset) => string | null; open?: boolean; compiling?: boolean;
    oncreate: () => void; onselect: (id: string) => void; onrename: (id: string) => void; onremove: (id: string) => void;
    onexport: () => void; onimport: (file: File) => void; oncompile: () => void; onsim: () => void; oninspect: () => void; onedit: () => void; onundo: () => void; onredo: () => void;
  } = $props();
  let tab = $state<'chat' | 'basic' | 'passport'>('chat');
  let query = $state('');
  let importInput = $state<HTMLInputElement>();
  let facts = $derived.by(() => { void version; return session.lastLogs.map(toFactLine); });
  let confirmed = $derived(facts.filter((fact) => !fact.rejected).length);
  let blocked = $derived(facts.filter((fact) => fact.rejected).length);
  let stateRows = $derived.by(() => { void version; return summarizeEngineState(session.runtime.state); });
  let filteredChats = $derived(index.chats.filter((chat) => chat.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
</script>

<aside class="side" class:open style:display={open?'flex':undefined}>
  <header><strong>{profile.card.name}</strong><button class="edit-card" onclick={onedit} title="봇카드와 스크립트 편집"><Icon name="pencil" size={14}/><span>봇 편집</span></button><span class="passport-count">{passport.grades.exact.length}/{passport.grades.approx.length}/{passport.grades.preserved.length}</span><div class="tabs"><button class:active={tab==='chat'} onclick={()=>tab='chat'} title="채팅"><Icon name="message"/></button><button class:active={tab==='basic'} onclick={()=>tab='basic'} title="카드 정보"><Icon name="user"/></button><button class:active={tab==='passport'} onclick={()=>tab='passport'} title="호환성 여권"><Icon name="badge"/></button></div></header>
  {#if tab==='chat'}
    <section class="content chats">
      <button class="new" onclick={oncreate}><Icon name="plus"/> 새 채팅</button>
      <input class="search" bind:value={query} placeholder="채팅 검색" aria-label="채팅 검색"/>
      <div class="transfer"><button onclick={onexport}>내보내기</button><button onclick={()=>importInput?.click()}>가져오기</button><input class="hidden" bind:this={importInput} type="file" accept="application/json,.json" onchange={(event)=>{const input=event.currentTarget,file=input.files?.[0];if(file)onimport(file);input.value='';}}/></div>
      {#each filteredChats as chat(chat.chatId)}<div class:active={index.activeChatId===chat.chatId} class="chat"><button class="select" onclick={()=>onselect(chat.chatId)}><b>{chat.name}</b><small>{chat.turn}턴</small></button><button title="이름 변경" onclick={()=>onrename(chat.chatId)}><Icon name="pencil" size={14}/></button><button title="삭제" onclick={()=>onremove(chat.chatId)}><Icon name="trash" size={14}/></button></div>{/each}
    </section>
    <section class="engine"><div class="engine-head"><strong><Icon name="star" size={12}/> 엔진 확정 · 이번 턴</strong><span>{confirmed}확정 · {blocked}차단</span></div><button class="compile" disabled={compiling} onclick={oncompile}><Icon name="star" size={14}/>{compiling?'엔진 컴파일 중…':passport.mode==='full-sim'?'엔진 재컴파일':'엔진 컴파일'}</button>{#if passport.mode==='full-sim'}<button class="simulate" onclick={onsim}><Icon name="badge" size={14}/> 시뮬레이션 열기</button>{/if}<div class="mode">{passport.mode==='full-sim'?'완전 시뮬':'일반 채팅'}</div>{#if stateRows.length}<dl>{#each stateRows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>{/if}{#if facts.length}<ul>{#each facts.slice(0,4) as fact}<li class:rejected={fact.rejected}><Icon name={fact.icon} size={13}/><b>{fact.label}</b><span>{fact.delta??fact.note}</span></li>{/each}</ul>{/if}<button class="inspect" onclick={oninspect}><Icon name="badge" size={14}/> 세션 검사기</button><div class="history"><button disabled={!session.checkpointDepth} onclick={onundo} title="되돌리기"><Icon name="undo"/><span>{session.checkpointDepth}</span></button><button disabled={!session.redoDepth} onclick={onredo} title="다시 실행"><Icon name="redo"/><span>{session.redoDepth}</span></button></div></section>
  {:else if tab==='basic'}
    <section class="content basic"><h3>{profile.card.name}</h3><h4>설명</h4><p>{profile.card.description||'설명 없음'}</p><h4>시나리오</h4><p>{profile.card.scenario||'시나리오 없음'}</p><label>이 카드에 고정할 페르소나<select value={bindingUi.boundId??''} onchange={(event)=>bindingUi.onchange(event.currentTarget.value||null)}><option value="">전역 활성 페르소나 사용</option>{#each bindingUi.personas as persona}<option value={persona.id}>{persona.name}</option>{/each}</select></label><h4>NPC 스프라이트 갤러리</h4>{#if assets.length}<NpcGallery {assets} {assetUrlFor}/>{:else}<p>표시할 이미지 자산이 없습니다.</p>{/if}</section>
  {:else}<section class="content"><PassportPanel {passport}/></section>{/if}
</aside>

<style>
  .side{width:300px;height:100dvh;flex:none;display:flex;flex-direction:column;border-right:1px solid;color:#e8eaf0}.side>header{padding:16px 16px 10px;border-bottom:1px solid #2c2f36}.passport-count{float:right;font:10px ui-monospace;color:#d8b36a;border:1px solid #5c4b2a;border-radius:999px;padding:2px 7px}.tabs{display:flex;margin-top:13px;gap:12px}.tabs button{display:grid;place-items:center;padding:4px;border:0;background:transparent;color:#858b97}.tabs button.active,.tabs button:hover{color:#eee}.tabs button:last-child.active{color:#d8b36a}.content{flex:1;min-height:0;padding:12px;overflow:auto}.new{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px;border:1px dashed #424753;background:transparent;color:#aeb4c1;border-radius:7px;margin-bottom:9px}.new:hover{border-color:#22c55e;color:#22c55e}.search{box-sizing:border-box;width:100%;padding:8px;border:1px solid #343944;border-radius:6px;background:#171a20;color:#eee}.transfer{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:6px 0 9px}.transfer button{padding:6px;border:1px solid #343944;border-radius:5px;background:#222630;color:#aeb4c1}.hidden{display:none}.chat{display:flex;align-items:center;border-radius:6px}.chat:hover,.chat.active{background:#292c33}.chat>button{border:0;background:transparent;color:#9299a7;padding:7px 5px}.chat .select{flex:1;display:flex;justify-content:space-between;color:#e5e7ed;text-align:left}.chat small{font:10px ui-monospace;color:#747b88}.engine{margin:12px;border:1px solid #343840;border-radius:8px;background:#1b1d22;overflow:hidden}.engine-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px dashed #343840;font-size:10px;color:#d8b36a}.engine-head strong{display:flex;align-items:center;gap:5px}.engine-head span,.mode{color:#87909e}.mode{padding:5px 10px;font-size:10px}.engine dl{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:3px 10px 8px}.engine dl div{display:flex;justify-content:space-between;background:#22252b;padding:5px 7px;border-radius:4px}.engine dt,.engine dd{font-size:11px;margin:0}.engine ul{list-style:none;padding:2px 0;margin:0}.engine li{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:11px;color:#a9cfbc}.engine li span{margin-left:auto;font-family:ui-monospace}.engine li.rejected{color:#d06d55}.history{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px 10px}.history button{display:flex;align-items:center;justify-content:center;gap:5px;padding:7px;border:1px solid #3c414b;border-radius:6px;background:#252830;color:#ddd}.history button:disabled{opacity:.35}.history span{font:10px ui-monospace}.basic p{white-space:pre-wrap;color:#aeb3bd;font-size:13px;line-height:1.6}.basic label{display:grid;gap:6px;font-size:12px;color:#aeb3bd}.basic select{padding:8px;background:#181a1f;color:#eee;border:1px solid #3b3f48;border-radius:6px}button{cursor:pointer;transition:.12s}button:active:not(:disabled){transform:translateY(1px) scale(.98)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #6c98f4;outline-offset:2px}@media(max-width:1000px){.side{display:none}}
  .inspect{width:calc(100% - 20px);display:flex;align-items:center;justify-content:center;gap:6px;margin:4px 10px;padding:7px;border:1px solid #46516a;border-radius:6px;background:#222938;color:#a9c2f5}
  .compile{width:calc(100% - 20px);display:flex;align-items:center;justify-content:center;gap:6px;margin:8px 10px 4px;padding:8px;border:1px solid #6a8550;border-radius:6px;background:#283321;color:#c7e7aa}.compile:disabled{opacity:.55}
  .simulate{width:calc(100% - 20px);display:flex;align-items:center;justify-content:center;gap:6px;margin:5px 10px;padding:8px;border:1px solid #80652f;border-radius:6px;background:#302817;color:#ebc66f}
  .edit-card{float:right;display:inline-flex;align-items:center;gap:4px;margin-right:8px;padding:3px 6px;border:1px solid #3b414c;border-radius:5px;background:#22262e;color:#aeb6c4;font-size:10px}.edit-card:hover{border-color:#6c98f4;color:#dce6fb}
</style>
