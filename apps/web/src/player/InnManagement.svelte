<script lang="ts">
  import type {ProjectRuntime} from '@simbot/runtime';
  import type {PlaySession} from '@simbot/session';
  import Icon from '@simbot/ui/Icon.svelte';
  let {runtime,version,session=null,onchange}:{runtime:ProjectRuntime;version:number;session?:PlaySession|null;onchange:()=>void}=$props();
  let lastLog=$state<Record<string,unknown>[]>([]),quantities=$state<Record<string,number>>({}),wages=$state<Record<string,number>>({});
  let engineState=$derived.by(()=>{version;return runtime.state;}),schema=$derived(runtime.project.schema);
  const rows=(value:unknown)=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
  function entities(type:string){return rows(schema.entities).find(value=>value.type===type)?.instances as Record<string,unknown>[]??[];}
  function select(id:string):unknown{try{return runtime.select(id);}catch{return{};}}
  let traffic=$derived.by(()=>{version;const value=select('inn/traffic');return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}),quests=$derived.by(()=>{version;return rows(select('inn/quests'));}),rooms=$derived.by(()=>{version;return rows(select('inn/rooms'));});
  let lodging=$derived(rows(traffic.lodging)),mail=$derived(rows(traffic.mail)),waves=$derived(rows(traffic.waves));
  let facilities=$derived(entities('facility')),npcs=$derived(entities('npc')),resources=$derived(rows(schema.resources).filter(value=>value.id!=='gold'));
  async function run(id:string,params:Record<string,unknown>={}){lastLog=(session?await session.dispatchEngineEvent(id,params):runtime.dispatch(id,params)).log as Record<string,unknown>[];onchange();}
  function purchase(){const items=resources.map(value=>({resource:value.id,qty:Math.trunc(quantities[String(value.id)]??0)})).filter(value=>value.qty>0);if(items.length)run('purchase_batch',{items});}
  function staffEntry(id:string){return rows(engineState.staff).find(value=>value.npcId===id);}
</script>

<div class="console">
  <section class="summary"><div><span>일차</span><b>{String(engineState.day??1)}</b></div><div><span>골드</span><b>{Number(engineState.gold??0).toLocaleString()}원</b></div>{#each resources as resource}<div><span>{String(resource.label??resource.id)}</span><b>{String((engineState.resources as Record<string,unknown>)?.[String(resource.id)]??0)} {String(resource.unit??'')}</b></div>{/each}</section>

  <section><h2><Icon name="star"/> 영업</h2><div class="actions">{#each waves as wave}<button disabled={!!wave.resolved} onclick={()=>run('traffic_wave',{wave:wave.id})}>{String(wave.label??wave.id)}{wave.resolved?' · 완료':''}</button>{/each}<button onclick={()=>run('lodging_review')}>숙박 문의</button><button onclick={()=>run('mail_check')}>우편 확인</button><button class="danger" onclick={()=>run('day_end')}>하루 마감</button></div></section>

  {#if traffic.incident}<section class="attention"><h2>{String((traffic.incident as Record<string,unknown>).label??'사건')}</h2><p>{String((traffic.incident as Record<string,unknown>).desc??'')}</p><div class="actions">{#each ((traffic.incident as Record<string,unknown>).choices as Record<string,unknown>[]??[]) as choice}<button onclick={()=>run('incident_choice',{choice:choice.id})}>{String(choice.label??choice.id)}</button>{/each}</div></section>{/if}

  {#if lodging.length}<section><h2>숙박 문의</h2>{#each lodging as request}<article><div><b>{String(request.name??request.label)}</b><small>{String(request.party)}명 · {String(request.stayDays)}박</small></div><div class="actions"><button onclick={()=>run('lodging_accept',{requestId:request.id})}>수락</button><button onclick={()=>run('lodging_reject',{requestId:request.id})}>거절</button></div></article>{/each}</section>{/if}

  {#if mail.length}<section><h2>우편</h2>{#each mail as letter}<article><div><b>{String(letter.type==='reward'?'감사 선물':'의뢰 편지')}</b><small>{String(letter.axis??'')}</small></div><button onclick={()=>run('mail_open',{mailId:letter.id})}>열기</button></article>{/each}</section>{/if}

  <section><h2>재고 구매</h2><div class="purchase">{#each resources as resource}<label><span>{String(resource.label??resource.id)} · 개당 {Number(resource.basePrice??0).toLocaleString()}원</span><input type="number" min="0" max="999" value={quantities[String(resource.id)]??0} oninput={(event)=>quantities[String(resource.id)]=Number(event.currentTarget.value)}/></label>{/each}<button onclick={purchase}>설정한 수량 일괄 구매</button></div></section>

  <section><h2>시설</h2>{#each facilities as facility}<article><div><b>{String(facility.label??facility.id)}</b><small>Lv.{String((engineState.facilities as Record<string,unknown>)?.[String(facility.id)]??1)} / {String(facility.maxLevel??1)}</small></div><button onclick={()=>run('upgrade',{facilityId:facility.id})}>증축</button></article>{/each}</section>

  <section><h2>직원</h2>{#each npcs as npc}{@const id=String(npc.id)}{@const hired=staffEntry(id)}<article><div><b>{String(npc.nameKo??npc.nameEn??id)}</b><small>{hired?`고용 중 · 일급 ${Number(hired.dailyWage??0).toLocaleString()}원`:'고용 가능'}</small></div><label class="wage"><input type="number" min="0" step="1000" value={wages[id]??Number(hired?.dailyWage??10000)} oninput={(event)=>wages[id]=Number(event.currentTarget.value)}/><button onclick={()=>run(hired?'set_wage':'hire',{npcId:id,dailyWage:wages[id]??Number(hired?.dailyWage??10000)})}>{hired?'임금 변경':'고용'}</button></label></article>{/each}</section>

  <section><h2>객실</h2><div class="grid">{#each rooms as room}<div class:locked={room.locked}><b>{String(room.no)}호 · {String(room.kind??'객실')}</b><small>{room.locked?'잠김':`${Number(room.pricePerNight??0).toLocaleString()}원`}</small><small>{((room.guests as unknown[])??[]).length?`투숙 ${((room.guests as unknown[])??[]).length}팀`:'빈방'}</small></div>{/each}</div></section>

  <section><h2>의뢰 게시판</h2>{#if quests.length}{#each quests as quest}<article><div><b>{String(quest.name??quest.id)}</b><small>{String(quest.rewardTier??'')}급 보상</small></div><button onclick={()=>run('attempt_quest',{questId:quest.id})}>수행</button></article>{/each}{:else}<p class="muted">주점 2레벨에서 의뢰 게시판이 열리거나, 현재 가능한 의뢰가 없습니다.</p>{/if}</section>

  {#if lastLog.length}<details open><summary>마지막 엔진 결과</summary><pre>{JSON.stringify(lastLog,null,2)}</pre></details>{/if}
</div>

<style>
  .console{display:grid;gap:12px;color:#e7e9ee}.console section{padding:12px;border:1px solid #343944;border-radius:9px;background:#191c22}.summary{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}.summary div{display:grid;gap:3px;padding:8px;background:#222630;border-radius:6px}.summary span,small,.muted{font-size:11px;color:#9299a7}h2{display:flex;align-items:center;gap:6px;margin:0 0 9px;font-size:14px}.actions{display:flex;flex-wrap:wrap;gap:6px}button{padding:7px 10px;border:1px solid #46516a;border-radius:6px;background:#252c3a;color:#c9d8f5;cursor:pointer}button:hover{border-color:#6f91d2}button:disabled{opacity:.4;cursor:not-allowed}.danger{border-color:#6e493f;color:#e5a18d}.attention{border-color:#7c6334!important;background:#282316!important}.attention p{white-space:pre-wrap}article{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #2c3038}article:last-child{border:0}article>div{display:grid;gap:3px}.purchase{display:grid;gap:7px}.purchase label,.wage{display:flex;align-items:center;justify-content:space-between;gap:8px}.purchase input,.wage input{width:90px;padding:6px;border:1px solid #3d424d;border-radius:5px;background:#11141a;color:#eee}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px}.grid>div{display:grid;gap:4px;padding:8px;border:1px solid #343944;border-radius:6px}.grid .locked{opacity:.45}details{padding:10px;border:1px solid #343944;border-radius:8px}pre{overflow:auto;max-height:260px;font-size:11px;color:#afc5ef}@media(max-width:600px){article{align-items:flex-start;flex-direction:column}.wage{width:100%}.summary{grid-template-columns:1fr 1fr}}
</style>
