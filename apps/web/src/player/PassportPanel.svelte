<script lang="ts">
  import type { CardPassport } from '@simbot/risu';
  import Icon from '@simbot/ui/Icon.svelte';
  let {passport}:{passport:CardPassport}=$props();
  let rows=$derived([
    {label:'직역',icon:'star' as const,values:passport.grades.exact,empty:'직역 태그 없음'},
    {label:'근사',icon:'refresh' as const,values:passport.grades.approx,empty:'근사 태그 없음'},
    {label:'보존',icon:'box' as const,values:passport.grades.preserved,empty:'보존 태그 없음'}
  ]);
</script>

<section class="passport" aria-label="카드 호환성 여권">
  <header><div><span class="eyebrow">호환성 여권</span><strong>{passport.cardName}</strong></div><span class:full={passport.mode==='full-sim'} class="mode">{passport.mode==='full-sim'?'완전 시뮬':'일반 채팅'}</span></header>
  {#if passport.runtime}
    <div class="runtime">
      <div><strong>카드 내부 프로그램 발견</strong><span class="blocked">직접 실행 차단 · Lucky 변환 필요</span></div>
      <p>Lua {passport.runtime.luaChars.toLocaleString()}자 · 초기 변수 {passport.runtime.defaultVariableChars.toLocaleString()}자 · 화면 스크립트 {passport.runtime.regexScripts.toLocaleString()}개 · 트리거 {passport.runtime.triggerScripts.toLocaleString()}개 · 에셋 {passport.runtime.assets.toLocaleString()}개</p>
      {#if passport.runtime.lowLevelAccess}<small>원본은 채팅 수정과 화면 강제 갱신 권한을 요구합니다. Lucky는 이 권한을 열지 않고 안전한 엔진 규칙으로 변환합니다.</small>{/if}
    </div>
  {/if}
  <dl>{#each rows as row}<div><dt><Icon name={row.icon} size={13}/> {row.label}</dt><dd class:empty={!row.values.length}>{row.values.length?row.values.join(' · '):row.empty}</dd></div>{/each}</dl>
</section>

<style>
  .passport{margin-bottom:var(--space-4);border:1px dashed var(--color-line);border-radius:var(--radius-md);background:var(--color-panel);overflow:hidden;font-size:.8rem}header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-3);border-bottom:1px dashed var(--color-line)}header>div{display:grid;gap:.15rem}.eyebrow{color:var(--color-muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}.mode{padding:.2rem .55rem;border:1px solid var(--color-line);border-radius:999px;color:var(--color-muted);font-size:.7rem}.mode.full{border-color:var(--color-accent);color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 8%,transparent)}dl{margin:0}dl>div{display:grid;grid-template-columns:5rem 1fr;gap:var(--space-2);padding:var(--space-2) var(--space-3)}dl>div+div{border-top:1px solid color-mix(in srgb,var(--color-line) 45%,transparent)}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}.empty{color:var(--color-muted)}
  .runtime{display:grid;gap:.45rem;padding:var(--space-3);border-bottom:1px dashed var(--color-line);background:color-mix(in srgb,#c78a35 8%,var(--color-panel))}.runtime>div{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}.runtime p,.runtime small{margin:0;line-height:1.45}.runtime p{color:var(--color-text)}.runtime small{color:var(--color-muted)}.blocked{padding:.15rem .45rem;border:1px solid #8d672f;border-radius:999px;color:#e1ba73;font-size:.65rem}
</style>
