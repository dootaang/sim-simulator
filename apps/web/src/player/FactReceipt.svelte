<script lang="ts" module>
  // 럭키 매직을 눈에 보이게: 엔진이 이번 턴에 '확정한 사실'을 영수증으로 렌더한다.
  // LLM은 서사만 쓰고, 숫자는 엔진 로그(lastLogs)가 소유한다는 걸 플레이어가 직접 본다.
  type Log = Record<string, unknown>;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const fmt = (v: number): string => v.toLocaleString('en-US');
  const signed = (v: number): string => (v >= 0 ? `+${fmt(v)}` : fmt(v));

  const RESOURCE_LABEL: Record<string, string> = { food: '식자재', drink: '주류', material: '재료', gold: '골드' };
  const RESOURCE_ICON: Record<string, string> = { food: '🍚', drink: '🍶', material: '🪵', gold: '🪙' };
  const REJECT_REASON: Record<string, string> = {
    unregistered_model_event: '엔진에 없는 이벤트라 무시',
    model_event_not_allowed: 'LLM이 직접 바꿀 수 없는 값 — 엔진이 차단',
  };

  export interface FactLine { key: string; icon: string; label: string; delta: string | null; after: string | null; note: string; rejected: boolean; }

  // 엔진 로그 한 줄 → 사람이 읽는 영수증 한 줄. 알 수 없는 형태도 안전하게 요약한다.
  export function toFactLine(log: Log, index: number): FactLine {
    const event = s(log.event), reason = s(log.reason);
    if (log.ok === false) {
      const why = s(log.reason);
      return { key: `${index}`, icon: '🚫', label: event || '거부된 이벤트', delta: null, after: null, note: REJECT_REASON[why] ?? why, rejected: true };
    }
    const before = n(log.before), after = n(log.after);
    const deltaStr = (d: number | null): string | null => (d == null ? null : signed(d));

    if (event === 'gold_delta' || (event === 'resource_delta' && s(log.resource) === 'gold')) {
      return { key: `${index}`, icon: '🪙', label: '골드', delta: deltaStr(n(log.amount)), after: after != null ? fmt(after) : null, note: reason, rejected: false };
    }
    if (event === 'resource_delta' || event === 'gain_resource') {
      const id = s(log.resource);
      return { key: `${index}`, icon: RESOURCE_ICON[id] ?? '📦', label: RESOURCE_LABEL[id] ?? id, delta: deltaStr(n(log.amount) ?? n(log.qty)), after: after != null ? fmt(after) : null, note: reason, rejected: false };
    }
    if (event === 'scale_delta') {
      const tier = log.tierChanged as Record<string, Record<string, unknown>> | undefined;
      const tierNote = tier ? `${s(tier.from?.label)} → ${s(tier.to?.label)}` : reason;
      const capped = log.capped === true ? '오늘 상한 도달' : tierNote;
      return { key: `${index}`, icon: '❤️', label: `${s(log.target)} ${s(log.scale)}`, delta: deltaStr(n(log.delta)), after: after != null ? fmt(after) : null, note: capped, rejected: false };
    }
    if (event === 'exp_gain') {
      const ups = Array.isArray(log.levelUps) ? log.levelUps : [];
      return { key: `${index}`, icon: '⭐', label: '경험치', delta: deltaStr(n(log.amount)), after: null, note: ups.length ? `레벨 업! → Lv.${ups[ups.length - 1]}` : reason, rejected: false };
    }
    if (event === 'checkin' || event === 'checkout') {
      return { key: `${index}`, icon: event === 'checkin' ? '🛏️' : '🚪', label: event === 'checkin' ? '체크인' : '체크아웃', delta: null, after: null, note: `${s(log.roomNo)}호 · ${s(log.guestName)}`, rejected: false };
    }
    if (event === 'day_end') {
      return { key: `${index}`, icon: '🌙', label: '하루 마감', delta: null, after: after != null ? `${fmt(after)}일차` : null, note: reason, rejected: false };
    }
    if (event === 'hire' || event === 'fire') {
      return { key: `${index}`, icon: event === 'hire' ? '🤝' : '👋', label: event === 'hire' ? '고용' : '해고', delta: null, after: null, note: s(log.npcId), rejected: false };
    }
    // 알 수 없는 성공 이벤트: 델타/애프터가 있으면 그것만, 아니면 이벤트명.
    return { key: `${index}`, icon: '⚙️', label: event || '엔진 처리', delta: deltaStr(n(log.amount) ?? n(log.delta)), after: after != null ? fmt(after) : null, note: reason, rejected: false };
  }
</script>

<script lang="ts">
  let { logs }: { logs: Log[] } = $props();
  let lines = $derived(logs.map((log, i) => toFactLine(log, i)));
  let confirmed = $derived(lines.filter((l) => !l.rejected).length);
  let blocked = $derived(lines.filter((l) => l.rejected).length);
</script>

{#if lines.length}
  <section class="receipt" aria-label="엔진이 확정한 사실">
    <header>
      <span class="stamp">엔진 확정</span>
      <span class="count">{confirmed}건 확정{#if blocked} · {blocked}건 차단{/if}</span>
    </header>
    <ol>
      {#each lines as line (line.key)}
        <li class:rejected={line.rejected}>
          <span class="icon" aria-hidden="true">{line.icon}</span>
          <span class="label">{line.label}</span>
          {#if line.delta}<span class="delta" class:down={line.delta.startsWith('-')}>{line.delta}</span>{/if}
          {#if line.after}<span class="after">→ {line.after}</span>{/if}
          {#if line.note}<span class="note">{line.note}</span>{/if}
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .receipt { border: 1px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-panel); overflow: hidden; font-size: .82rem; }
  header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px dashed var(--color-line); background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
  .stamp { font-weight: 700; letter-spacing: .04em; color: var(--color-accent); text-transform: uppercase; font-size: .7rem; }
  .count { color: var(--color-muted); font-size: .72rem; margin-left: auto; font-variant-numeric: tabular-nums; }
  ol { list-style: none; margin: 0; padding: var(--space-1) 0; display: flex; flex-direction: column; }
  li { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-3); }
  li + li { border-top: 1px solid color-mix(in srgb, var(--color-line) 45%, transparent); }
  .icon { flex: none; }
  .label { font-weight: 600; }
  .delta { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--color-accent); }
  .delta.down { color: var(--color-danger); }
  .after { font-variant-numeric: tabular-nums; color: var(--color-muted); }
  .note { color: var(--color-muted); margin-left: auto; text-align: right; font-size: .74rem; }
  li.rejected { background: color-mix(in srgb, var(--color-danger) 8%, transparent); }
  li.rejected .label { color: var(--color-danger); }
</style>
