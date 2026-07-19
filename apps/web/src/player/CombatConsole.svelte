<script lang="ts">
  import Icon from '@simbot/ui/Icon.svelte';
  import type {ProjectRuntime} from '@simbot/runtime';
  import {yieldForActionPaint,type SimulationActionHandler} from './simulation-action';

  type Pool={id:string;cur:number;max:number};
  type Enemy={id:string;name:string;rank:string|null;hp:{cur:number;max:number};dead:boolean;intent:'attack'|'heavy'|null};
  type Skill={id:string;label:string;pool:string;cost:number;affordable:boolean;reason:string};
  type ConsoleModel={present:boolean;active:boolean;round:number;guard:boolean;cleared:boolean;fled:boolean;playerDead:boolean;pools:Pool[];enemies:Enemy[];skills:Skill[];fleeRate:number;canAct:boolean;end:{available:boolean;outcome:'victory'|'fled'|'defeat'|'ended'|null}};
  type UsableItem={id:string;label?:string;owned:number;effect?:{pool?:string;amount?:number}};

  let {runtime,version,busy=false,onaction=null,onchange}:{runtime:ProjectRuntime;version:number;busy?:boolean;onaction?:SimulationActionHandler|null;onchange:()=>void}=$props();
  let lastLog=$state<Record<string,unknown>[]>([]),pending=$state(false);
  const empty:ConsoleModel={present:false,active:false,round:0,guard:false,cleared:false,fled:false,playerDead:false,pools:[],enemies:[],skills:[],fleeRate:0,canAct:false,end:{available:false,outcome:null}};
  function select<T>(id:string,fallback:T):T{try{return runtime.select(id) as T;}catch{return fallback;}}
  let model=$derived.by(()=>{version;return select<ConsoleModel>('combat/console',empty);});
  let items=$derived.by(()=>{version;const value=select<unknown>('inventory/usable-items',[]);return Array.isArray(value)?value as UsableItem[]:[];});
  let living=$derived(model.enemies.filter(value=>!value.dead));
  let status=$derived.by(()=>{const failed=lastLog.find(row=>row.ok===false);if(failed)return reasonText(String(failed.reason??'unknown'));return lastLog.length?'행동이 처리되었습니다.':'';});

  function reasonText(reason:string){
    const known:Record<string,string>={no_encounter:'진행 중인 전투가 없습니다.',no_encounter_to_end:'종료할 전투가 없습니다.',player_dead:'플레이어가 쓰러져 행동할 수 없습니다.',unknown_target:'대상을 찾을 수 없습니다.',target_dead:'이미 쓰러진 대상입니다.',unknown_skill:'스킬을 찾을 수 없습니다.',combat_number_not_allowed:'전투 수치는 화면에서 지정할 수 없습니다.',encounter_unresolved:'전투가 아직 끝나지 않았습니다.',out_of_stock:'소모품 재고가 없습니다.',pool_full:'해당 수치가 이미 가득 찼습니다.',no_pool:'회복할 수치를 찾을 수 없습니다.',unknown_item:'소모품을 찾을 수 없습니다.',item_number_not_allowed:'소모품 수치는 화면에서 지정할 수 없습니다.'};
    if(reason.startsWith('insufficient_'))return `${reason.slice('insufficient_'.length).toLocaleUpperCase()}가 부족합니다.`;
    return known[reason]??`처리하지 못했습니다: ${reason}`;
  }
  async function run(id:string,params:Record<string,unknown>={},events?:Array<{id:string;params:Record<string,unknown>}>){if(pending||busy)return;pending=true;lastLog=[];try{await yieldForActionPaint();if(onaction)lastLog=await onaction({id,params,mode:'narrated',...(events?{events}:{})});else{const queue=events??[{id,params}];lastLog=queue.flatMap(event=>runtime.dispatch(event.id,event.params).log as Record<string,unknown>[]);}onchange();}finally{pending=false;}}
  const turn=(first:{id:string;params:Record<string,unknown>})=>run(first.id,first.params,[first,{id:'enemy_turn',params:{}}]);
  function endLabel(outcome:ConsoleModel['end']['outcome']){return outcome==='victory'?'전투 종료 (승리)':outcome==='fled'?'전투 종료 (도주)':outcome==='defeat'?'전투 종료 (패배)':'전투 종료';}
  function finish(){const gfl=(runtime.state.gfl&&typeof runtime.state.gfl==='object'?runtime.state.gfl:{})as Record<string,unknown>,sortie=(gfl.sortie&&typeof gfl.sortie==='object'?gfl.sortie:{})as Record<string,unknown>;return run(sortie.active?'gfl/sortie/finish':'end_encounter');}
</script>

{#if model.present}
<div class="combat-console" aria-label="전투 콘솔">
  <header><div><h2>전투 콘솔</h2><small>라운드 {model.round}{model.guard?' · 방어 태세':''}</small></div></header>

  <section aria-label="적 목록"><h3>적</h3><div class="enemy-grid">{#each model.enemies as enemy}<article class:dead={enemy.dead}><div class="enemy-title"><b>{enemy.name}</b>{#if enemy.rank}<span>{enemy.rank}</span>{/if}</div><label>HP {enemy.hp.cur} / {enemy.hp.max}<progress value={enemy.hp.cur} max={enemy.hp.max}></progress></label>{#if enemy.dead}<strong class="dead-label">사망</strong>{:else if enemy.intent==='heavy'}<strong class="warning"><Icon name="alert" size={12}/> 강공 예고</strong>{:else if enemy.intent==='attack'}<small>공격 예고</small>{/if}</article>{/each}</div></section>

  <section aria-label="플레이어 상태"><h3>플레이어</h3><div class="pool-grid">{#each model.pools as pool}<label><span>{pool.id.toLocaleUpperCase()} <b>{pool.cur} / {pool.max}</b></span><progress value={pool.cur} max={pool.max}></progress></label>{/each}</div></section>

  <section aria-label="전투 행동"><h3>행동</h3>
    <div class="action-block"><b>공격</b><div class="actions">{#each living as enemy}<button disabled={busy||pending||!model.canAct} onclick={()=>turn({id:'combat_action',params:{action:'attack',target:enemy.id}})}>{living.length===1?'공격':`공격 · ${enemy.name}`}</button>{/each}</div></div>
    {#if model.skills.length}<div class="action-block"><b>스킬</b>{#each model.skills as skill}<div class="skill"><span>{skill.label} · {skill.pool.toLocaleUpperCase()} {skill.cost}</span><div class="actions">{#each living as enemy}<button disabled={busy||pending||!model.canAct||!skill.affordable} title={skill.affordable?'':skill.reason} onclick={()=>turn({id:'combat_action',params:{action:'skill',target:enemy.id,skill:skill.id}})}>{living.length===1?skill.label:`${skill.label} · ${enemy.name}`}</button>{/each}</div>{#if !skill.affordable}<small class="reason">{skill.reason}</small>{/if}</div>{/each}</div>{/if}
    <div class="actions"><button disabled={busy||pending||!model.canAct} onclick={()=>turn({id:'combat_action',params:{action:'defend'}})}>방어</button><button disabled={busy||pending||!model.canAct} onclick={()=>turn({id:'combat_action',params:{action:'flee'}})}>도주 · 성공률 {model.fleeRate}%</button></div>
  </section>

  {#if items.length}<section aria-label="소모품"><h3><Icon name="flask" size={13}/> 소모품</h3><div class="actions">{#each items as item}<button disabled={busy||pending||!model.canAct} onclick={()=>turn({id:'use_item',params:{itemId:item.id}})}>{String(item.label??item.id)} · 보유 {item.owned}{#if item.effect} · {String(item.effect.pool??'')} +{String(item.effect.amount??'')}{/if}</button>{/each}</div></section>{/if}

  {#if model.end.available}<section class="ending"><button disabled={busy||pending} onclick={finish}>{endLabel(model.end.outcome)}</button></section>{/if}
  {#if status}<p class:failed={lastLog.some(row=>row.ok===false)} class="status" aria-live="polite">{status}</p>{/if}
</div>
{/if}

<style>
  .combat-console{display:grid;gap:12px;color:#e7e9ee}.combat-console>header,.combat-console>section{padding:12px;border:1px solid #343944;border-radius:9px;background:#191c22}.combat-console header{border-color:#6d5332;background:#211c16}.combat-console h2,.combat-console h3{margin:0}.combat-console h2{font-size:16px}.combat-console h3{margin-bottom:9px;font-size:13px;color:#c6ccd8}.combat-console small{font-size:11px;color:#9299a7}.enemy-grid,.pool-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.enemy-grid article{display:grid;gap:6px;padding:10px;border:1px solid #3d424d;border-radius:7px;background:#222630}.enemy-grid article.dead{opacity:.55}.enemy-title,.pool-grid label span{display:flex;justify-content:space-between;gap:8px}.enemy-title span{color:#d8b36a}.enemy-grid label,.pool-grid label{display:grid;gap:4px;font-size:11px;color:#aeb5c2}progress{width:100%;height:8px;accent-color:#ca5d5d}.pool-grid progress{accent-color:#6d91d8}.warning{color:#f0b56b;font-size:12px}.dead-label{color:#ca7a7a;font-size:12px}.action-block,.skill{display:grid;gap:6px;margin-bottom:9px}.skill{padding-left:8px;border-left:2px solid #353d4c}.skill>span,.action-block>b{font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:6px}button{padding:7px 10px;border:1px solid #46516a;border-radius:6px;background:#252c3a;color:#c9d8f5;cursor:pointer}button:hover{border-color:#6f91d2}button:disabled{opacity:.4;cursor:not-allowed}.reason{color:#d9a079!important}.ending{border-color:#47664e!important}.ending button{border-color:#5f8b69;color:#c8e8cf}.status{position:sticky;bottom:0;margin:0;padding:9px;border:1px solid #3d6b54;border-radius:7px;background:#183023;color:#bce7ca}.status.failed{border-color:#805044;background:#351e1a;color:#efb8a8}
</style>
