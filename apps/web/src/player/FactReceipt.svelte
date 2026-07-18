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
    encounter_active: '이미 전투 중',
    no_enemies: '상대가 없음',
    invalid_enemy_hp: '적 HP가 올바르지 않음',
    player_hp_pool_missing: '플레이어 HP가 없음',
    no_encounter: '진행 중인 전투가 없음',
    no_encounter_to_end: '끝낼 전투가 없음',
    encounter_unresolved: '전투가 아직 끝나지 않음',
    player_dead: '쓰러진 상태',
    combat_number_not_allowed: '전투 수치 직접 지정 불가',
    unknown_combat_action: '알 수 없는 전투 행동',
    unknown_target: '대상을 찾을 수 없음',
    target_dead: '이미 쓰러진 대상',
    unknown_skill: '알 수 없는 기술',
    unknown_enemy: '적을 찾을 수 없음',
    enemy_dead: '이미 쓰러진 적',
    item_number_not_allowed: '아이템 수치 직접 지정 불가',
    unknown_item: '알 수 없는 아이템',
    insufficient_stock: '재고 부족',
    out_of_stock: '재고 없음',
    no_pool: '회복할 능력치가 없음',
    pool_full: '이미 최대치',
    in_combat: '전투 중에는 이용 불가',
    empty_purchase_batch: '구매 품목이 없음',
    unknown_resource: '알 수 없는 품목',
    invalid_qty: '수량이 올바르지 않음',
    insufficient_gold: '골드 부족',
  };

  export interface FactLine { key: string; icon: string; label: string; delta: string | null; after: string | null; note: string; rejected: boolean; }
  export function factIconName(icon:string){return({['🍚']:'food',['🍶']:'drink',['🪵']:'box',['🪙']:'coin',['❤️']:'heart',['⭐']:'star',['✨']:'star',['⚠️']:'alert',['🛏️']:'bed',['🚪']:'bed',['🌙']:'moon',['🤝']:'user',['👋']:'user',['⚙️']:'settings',['🚫']:'blocked'}as const)[icon as '🍚']??'settings';}

  // 엔진 로그 한 줄 → 사람이 읽는 영수증 한 줄. 알 수 없는 형태도 안전하게 요약한다.
  export function toFactLine(log: Log, index: number): FactLine {
    const event = s(log.event), reason = s(log.reason);
    if (log.ok === false) {
      const why = s(log.reason);
      const whyText = REJECT_REASON[why] ?? (why.startsWith('insufficient_') ? `${why.slice('insufficient_'.length).toLocaleUpperCase()} 부족` : why);
      return { key: `${index}`, icon: '🚫', label: event || '거부된 이벤트', delta: null, after: null, note: whyText, rejected: true };
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
      const from = s(tier?.from?.label), to = s(tier?.to?.label);
      // 티어 통과는 특별한 순간 — 승급(새 구간의 시작이 더 높음)은 ✨, 강등은 ⚠로 구분한다(조종석 슬라이스 5).
      const fromStart = n((tier?.from?.range as unknown[] | undefined)?.[0]), toStart = n((tier?.to?.range as unknown[] | undefined)?.[0]);
      const promoted = fromStart != null && toStart != null ? toStart > fromStart : true;
      const tierNote = tier && (from || to) ? `${from} → ${to}` : reason;
      const capped = log.capped === true ? '오늘 상한 도달' : tierNote;
      return { key: `${index}`, icon: tier && (from || to) ? (promoted ? '✨' : '⚠️') : '❤️', label: `${s(log.target)} ${s(log.scale)}`, delta: deltaStr(n(log.delta)), after: after != null ? fmt(after) : null, note: capped, rejected: false };
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
    if (event === 'start_encounter') {
      const enemies = Array.isArray(log.enemies) ? log.enemies as Log[] : [];
      const first = s(enemies[0]?.name);
      const summary = first ? (enemies.length > 1 ? `${first} 외 ${enemies.length - 1}` : first) : '';
      return { key: `${index}`, icon: '⭐', label: '전투 개시', delta: null, after: null, note: summary, rejected: false };
    }
    if (event === 'combat_action') {
      const action = s(log.action);
      if (action === 'defend') return { key: `${index}`, icon: '❤️', label: '방어 태세', delta: null, after: null, note: '', rejected: false };
      if (action === 'flee') {
        const fled = log.fled === true;
        return { key: `${index}`, icon: fled ? '⭐' : '⚠️', label: `도주 ${fled ? '성공' : '실패'}`, delta: null, after: null, note: '', rejected: false };
      }
      if (action === 'attack' || action === 'skill') {
        const foe = log.enemy as Log | undefined;
        const target = s(foe?.name) || s(log.target);
        const skill = s(log.skill);
        const hit = log.hit === true;
        const critical = s(log.tier) === 'critical_success';
        const hp = n((foe?.hp as Log | undefined)?.cur);
        const notes = [hit ? (critical ? '치명타' : '명중') : '빗나감', log.cleared === true ? '적 전멸' : ''].filter(Boolean);
        return { key: `${index}`, icon: hit ? '⭐' : '⚠️', label: `${target || '대상'} · ${action === 'skill' ? (skill || '기술') : '공격'}`, delta: hit ? deltaStr(n(log.damage) == null ? null : -n(log.damage)!) : null, after: hp != null ? `HP ${fmt(hp)}` : null, note: notes.join(' · '), rejected: false };
      }
    }
    if (event === 'enemy_turn') {
      const results = Array.isArray(log.results) ? log.results as Log[] : [];
      const hits = results.filter((result) => result.hit === true);
      const damage = hits.reduce((total, result) => total + (n(result.damage) ?? 0), 0);
      const hp = n((log.playerHp as Log | undefined)?.cur);
      return { key: `${index}`, icon: log.playerDead === true ? '⚠️' : '❤️', label: `적 반격 · ${hits.length}회 명중 · 피해`, delta: damage ? signed(-damage) : null, after: hp != null ? `HP ${fmt(hp)}` : null, note: log.playerDead === true ? '쓰러짐' : '', rejected: false };
    }
    if (event === 'end_encounter') {
      const outcome = ({ victory: '승리', fled: '도주', defeat: '패배', ended: '종료' } as Record<string, string>)[s(log.outcome)] ?? '종료';
      const ups = Array.isArray(log.levelUps) ? log.levelUps : [];
      const notes = [`경험치 ${signed(n(log.expGained) ?? 0)}`, `골드 ${signed(n(log.goldGained) ?? 0)}`];
      if (ups.length) notes.push(`레벨 업 → Lv.${ups[ups.length - 1]}`);
      const revivedHp = n(log.revivedHp);
      if (revivedHp != null) notes.push(`HP ${fmt(revivedHp)}로 부활`);
      return { key: `${index}`, icon: outcome === '승리' ? '⭐' : '⚠️', label: `전투 ${outcome}`, delta: null, after: null, note: notes.join(' · '), rejected: false };
    }
    if (event === 'use_item') {
      const pool = s(log.pool);
      const remaining = n(log.remaining);
      return { key: `${index}`, icon: '❤️', label: `${s(log.itemId)}${pool ? ` · ${pool}` : ''}`, delta: deltaStr(n(log.amount)), after: after != null ? fmt(after) : null, note: remaining != null ? `남은 ${fmt(remaining)}` : '', rejected: false };
    }
    if (event === 'sale') {
      const consumed = log.consumed as Log | undefined;
      const stock = consumed ? Object.entries(consumed).map(([id, value]) => `${RESOURCE_LABEL[id] ?? id} -${fmt(n(value) ?? 0)}`).join(' · ') : '';
      return { key: `${index}`, icon: '🪙', label: `${s(log.menuName)} ×${fmt(n(log.qty) ?? 0)}`, delta: deltaStr(n(log.goldDelta)), after: null, note: stock, rejected: false };
    }
    if (event === 'buy_item') {
      const owned = n(log.owned);
      return { key: `${index}`, icon: '🪙', label: `${s(log.menuName)} ×${fmt(n(log.qty) ?? 0)}`, delta: deltaStr(n(log.goldDelta)), after: null, note: owned != null ? `보유 ${fmt(owned)}` : '', rejected: false };
    }
    if (event === 'purchase' || event === 'purchase_batch') {
      const items = Array.isArray(log.items) ? log.items as Log[] : [];
      const single = `${s(log.resource)} ×${fmt(n(log.qty) ?? 0)}`;
      const itemNote = items.map((item) => `${s(item.resource)} ×${fmt(n(item.qty) ?? 0)}`).join(' · ');
      return { key: `${index}`, icon: '🪙', label: event === 'purchase' ? single : `품목 ${items.length}종 구매`, delta: deltaStr(n(log.goldDelta)), after: null, note: event === 'purchase_batch' ? itemNote : '', rejected: false };
    }
    if (event === 'upgrade') {
      return { key: `${index}`, icon: '⭐', label: `${s(log.facility)} Lv.${fmt(n(log.level) ?? 0)}`, delta: deltaStr(n(log.goldDelta)), after: null, note: '', rejected: false };
    }
    if (event === 'attempt_quest') {
      const text = s(log.text);
      if (text) return { key: `${index}`, icon: '⭐', label: '의뢰 조우', delta: null, after: null, note: text, rejected: false };
      const success = log.success === true;
      const roll = n(log.roll);
      const tier = s(log.tier);
      const tierNote = tier === 'critical_success' ? '대성공' : tier === 'critical_failure' ? '대실패' : '';
      return { key: `${index}`, icon: success ? '⭐' : '⚠️', label: `${s(log.name) || s(log.questId)} · ${success ? '성공' : '실패'}`, delta: deltaStr(n(log.goldDelta)), after: null, note: [`굴림 ${roll == null ? '-' : fmt(roll)}`, tierNote].filter(Boolean).join(' · '), rejected: false };
    }
    if (event === 'reward') {
      return { key: `${index}`, icon: '🪙', label: '의뢰 보상', delta: deltaStr(n(log.goldDelta)), after: after != null ? fmt(after) : null, note: s(log.reason) || s(log.questId), rejected: false };
    }
    if (event === 'lodging_accept') {
      return { key: `${index}`, icon: '🛏️', label: `${s(log.roomNo)}호 숙박 수락`, delta: deltaStr(n(log.goldDelta)), after: null, note: s(log.requestId), rejected: false };
    }
    if (event === 'lodging_reject') {
      return { key: `${index}`, icon: '🚪', label: '숙박 거절', delta: null, after: null, note: s(log.requestId), rejected: false };
    }
    if (event === 'traffic_wave') {
      if (log.skipped === true) return { key: `${index}`, icon: '🚪', label: '영업 건너뜀', delta: null, after: null, note: s(log.wave), rejected: false };
      if (log.awaitingChoice === true) return { key: `${index}`, icon: '⚠️', label: '영업 사건 발생', delta: null, after: null, note: s(log.label), rejected: false };
      const served = n(log.served), customers = n(log.customers), stockout = n(log.stockout);
      return { key: `${index}`, icon: '🪙', label: `영업${served != null ? ` · ${fmt(served)}명 응대` : ''}`, delta: deltaStr(n(log.revenue)), after: null, note: [s(log.wave), customers != null ? `방문 ${fmt(customers)}` : '', stockout != null ? `미응대 ${fmt(stockout)}` : ''].filter(Boolean).join(' · '), rejected: false };
    }
    if (event === 'incident_choice') {
      const wave = log.wave as Log | undefined;
      const waveRevenue = n(wave?.revenue), shortfall = n(log.goldShortfall);
      return { key: `${index}`, icon: '🪙', label: '영업 사건 해결', delta: deltaStr(n(log.goldDelta)), after: null, note: [s(log.choice), waveRevenue != null ? `영업 매출 ${signed(waveRevenue)}` : '', shortfall ? `미지급 ${fmt(shortfall)}` : ''].filter(Boolean).join(' · '), rejected: false };
    }
    if (event === 'lodging_review') {
      const requests = Array.isArray(log.requests) ? log.requests as Log[] : [];
      return { key: `${index}`, icon: '🛏️', label: '숙박 문의 확인', delta: null, after: `${fmt(requests.length)}건`, note: '', rejected: false };
    }
    if (event === 'mail_check') {
      const letters = Array.isArray(log.letters) ? log.letters : [];
      return { key: `${index}`, icon: '⭐', label: '우편 확인', delta: null, after: `${fmt(letters.length)}건`, note: '', rejected: false };
    }
    if (event === 'mail_open') {
      return { key: `${index}`, icon: '🪙', label: s(log.type) === 'reward' ? '우편 보상' : '의뢰 우편', delta: deltaStr(n(log.goldDelta)), after: null, note: s(log.axis), rejected: false };
    }
    // GFL 네이티브 이벤트 — 보상·전리품·EXP가 "조용한 입금"이 되지 않게 사람 말로 옮긴다(2026-07-19 오너 실측).
    if (event.startsWith('gfl/')) {
      const name = s(log.name), outcome = s(log.outcome);
      if (event === 'gfl/sortie/resolve' || event === 'gfl/sortie/finish' || event === 'gfl/sortie/engage') {
        const victory = outcome === 'victory';
        const note = [s(log.missionId), s(log.factionLabel), n(log.roundCount) != null ? `${fmt(n(log.roundCount)!)}라운드` : ''].filter(Boolean).join(' · ');
        return { key: `${index}`, icon: victory ? '⭐' : '⚠️', label: victory ? '작전 승리' : '작전 실패', delta: null, after: null, note, rejected: false };
      }
      if (event === 'gfl/sortie/stage') {
        const stage = s(log.stageType);
        if (stage === 'recon') return { key: `${index}`, icon: '🔍', label: '정찰 완료', delta: null, after: null, note: '다음 교전 명중 +1', rejected: false };
        if (stage === 'other') { const res = log.resource as Log | null; return { key: `${index}`, icon: '🚩', label: '돌발 상황', delta: res ? signed(n(res.qty) ?? 0) : null, after: null, note: res ? '자원 발견' : '이상 없음', rejected: false }; }
        const enc = log.encounter as Log | undefined;
        return { key: `${index}`, icon: '❓', label: '정체불명 구역', delta: null, after: null, note: enc ? `무소속 인형 발견 · ${s(enc.name)}` : (Array.isArray(log.loot) && (log.loot as Log[]).length ? '물자 발견' : '아무것도 없었다'), rejected: false };
      }
      if (event === 'gfl/sortie/auto') {
        const stop: Record<string, string> = { complete: '작전 완료', defeat: '작전 실패', boss: '보스 직전 정지', encounter: '무소속 인형 발견', prisoner: '포로 발생' };
        return { key: `${index}`, icon: '⭐', label: `자동 진행 · ${fmt(n(log.stepCount) ?? 0)}단계`, delta: null, after: null, note: stop[s(log.stopReason)] ?? s(log.stopReason), rejected: false };
      }
      if (event === 'gfl/sortie/interrogate') { const success = log.success === true; return { key: `${index}`, icon: success ? '⭐' : '⚠️', label: success ? '심문 성공' : '심문 실패', delta: null, after: null, note: success ? '적 정보 확보 — 다음 교전 명중 +1' : '허위 정보 — 다음 교전 매복 주의', rejected: false }; }
      if (event === 'gfl/sortie/retreat') return { key: `${index}`, icon: '🚪', label: '작전 퇴각', delta: null, after: null, note: '전리품 유지 · 완료 보상 없음', rejected: false };
      if (event === 'gfl/logistics/collect') { const reward = log.reward as Log | undefined; return { key: `${index}`, icon: '📦', label: '군수지원 수령', delta: null, after: null, note: `자금 ${signed(n(reward?.gold) ?? 0)} · 자원 ${signed(n(reward?.res) ?? 0)}`, rejected: false }; }
      if (event === 'gfl/refinery/collect') { const y = log.yield as Log | undefined; return { key: `${index}`, icon: '⚗️', label: '가공 완료', delta: null, after: null, note: Object.entries(y ?? {}).map(([k, v]) => `${RESOURCE_LABEL[k] ?? k} +${fmt(n(v) ?? 0)}`).join(' · '), rejected: false }; }
      if (event === 'gfl/market/buy') return { key: `${index}`, icon: '🕶️', label: `암시장 · ${name}`, delta: deltaStr(-(n(log.price) ?? 0)), after: null, note: `의심도 ${fmt(n(log.suspicion) ?? 0)}`, rejected: false };
      if (event === 'gfl/relation/check') { const tier = s(log.tier); const tierNote = tier === 'critical_success' ? '대성공' : tier === 'critical_failure' ? '대실패' : tier === 'success' ? '성공' : '실패'; const up = (log.tierChanged as Log | undefined)?.to as Log | undefined; return { key: `${index}`, icon: log.success === true ? '❤️' : '⚠️', label: `${name} · ${s(log.label)}`, delta: deltaStr(n(log.affinityDelta)), after: `호감 ${fmt(n(log.affinity) ?? 0)}`, note: [`🎲 ${fmt(n(log.roll) ?? 0)} → ${tierNote}`, up ? `관계 승급 · ${s(up.label)}` : ''].filter(Boolean).join(' · '), rejected: false }; }
      if (event === 'gfl/relation/session/end') return { key: `${index}`, icon: '❤️', label: `${name} · 대화 마무리`, delta: deltaStr(n(log.affinityDelta)), after: `호감 ${fmt(n(log.affinity) ?? 0)}`, note: `기분 ${signed(n(log.moodDelta) ?? 0)}`, rejected: false };
      if (event === 'gfl/relation/outing') return { key: `${index}`, icon: '❤️', label: `${name} · 외출`, delta: deltaStr(n(log.affinityDelta)), after: null, note: [s(log.place), `기분 ${signed(n(log.moodDelta) ?? 0)}`].filter(Boolean).join(' · '), rejected: false };
      if (event === 'gfl/hire/contract' || event === 'gfl/hire/snipe') return { key: `${index}`, icon: '🤝', label: `${name} 계약`, delta: deltaStr(-(n(log.cost) ?? 0)), after: null, note: '다음 시간대 도착', rejected: false };
      if (event === 'gfl/boss/recruit' || event === 'gfl/encounter/recruit') return { key: `${index}`, icon: '🤝', label: `${name} 영입`, delta: null, after: null, note: event === 'gfl/boss/recruit' ? '6성 BOSS 합류' : '무소속 인형 합류', rejected: false };
      if (event === 'gfl/facility/upgrade') return { key: `${index}`, icon: '⭐', label: `시설 증설 Lv.${fmt(n(log.level) ?? 0)}`, delta: null, after: null, note: s(log.facilityId), rejected: false };
      if (event === 'gfl/time/end-day') {
        const raid = log.raid as Log | undefined, social = log.social as Log | undefined;
        const notes = [raid?.occurred === true ? (raid.success === true ? `습격 방어 성공 ${signed(n(raid.resourceDelta) ?? 0)}` : `습격 피해 ${signed(n(raid.resourceDelta) ?? 0)}`) : '', social ? `불만도 ${fmt(n(social.dissatisfaction) ?? 0)}` : ''].filter(Boolean);
        return { key: `${index}`, icon: '🌙', label: '하루 마감', delta: null, after: n(log.day) != null ? `${fmt(n(log.day)!)}일차` : null, note: notes.join(' · '), rejected: false };
      }
      const GFL_LABEL: Record<string, string> = { 'gfl/sortie/start': '작전 출격', 'gfl/relation/session/start': '대화 시작', 'gfl/crew/assign': '근무 배치', 'gfl/crew/remove': '근무 해제', 'gfl/refinery/start': '가공 시작', 'gfl/facility/specialize': '시설 특화', 'gfl/item/use': '물품 사용', 'gfl/time/advance': '시간 진행', 'gfl/location/move': '이동' };
      return { key: `${index}`, icon: '⚙️', label: GFL_LABEL[event] ?? event, delta: deltaStr(n(log.affinityDelta) ?? n(log.amount)), after: null, note: name || reason, rejected: false };
    }
    // 알 수 없는 성공 이벤트: 델타/애프터가 있으면 그것만, 아니면 이벤트명.
    return { key: `${index}`, icon: '⚙️', label: event || '엔진 처리', delta: deltaStr(n(log.amount) ?? n(log.delta)), after: after != null ? fmt(after) : null, note: reason, rejected: false };
  }

  // 굵직한 GFL 결과(보상·전리품·지휘 EXP)는 한 줄에 안 담긴다 — 로그 하나를 여러 영수증 줄로 펼친다.
  export function toFactLines(log: Log, index: number): FactLine[] {
    const lines = [toFactLine(log, index)];
    if (log.ok === false) return lines;
    const event = s(log.event);
    // 오토런은 단계 로그 묶음 — 각 단계를 재귀로 펼쳐 보상·전리품이 접히지 않게 한다.
    if (event === 'gfl/sortie/auto') {
      for (const [at, step] of (Array.isArray(log.steps) ? (log.steps as Log[]) : []).entries())
        for (const line of toFactLines(step, index)) lines.push({ ...line, key: `${index}-a${at}-${line.key}` });
      return lines;
    }
    if (event === 'gfl/sortie/resolve' || event === 'gfl/sortie/finish' || event === 'gfl/sortie/engage' || event === 'gfl/sortie/stage') {
      const rewards = log.rewards as Log | null | undefined;
      for (const [resource, amount] of Object.entries(rewards ?? {})) {
        const qty = n(amount); if (qty == null || !qty) continue;
        lines.push({ key: `${index}-r-${resource}`, icon: resource === 'gold' ? '🪙' : RESOURCE_ICON[resource] ?? '📦', label: resource === 'gold' ? '작전 보상 · 자금' : `작전 보상 · ${RESOURCE_LABEL[resource] ?? resource}`, delta: signed(qty), after: null, note: n(log.rewardRate) != null && n(log.rewardRate)! < 1 ? '재클리어 35%' : '', rejected: false });
      }
      for (const [at, item] of (Array.isArray(log.loot) ? (log.loot as Log[]) : []).entries())
        lines.push({ key: `${index}-l-${at}`, icon: '🎁', label: `전리품 · ${s(item.name) || s(item.id)}`, delta: `+${fmt(n(item.qty) ?? 1)}`, after: null, note: '', rejected: false });
      const exp = log.commanderExp as Log | undefined;
      if (n(exp?.gained)) lines.push({ key: `${index}-exp`, icon: '🎖️', label: '지휘 EXP', delta: signed(n(exp!.gained)!), after: `누적 ${fmt(n(exp!.total) ?? 0)}`, note: '', rejected: false });
      const up = log.levelUp as Log | undefined;
      if (n(up?.to)) lines.push({ key: `${index}-lv`, icon: '✨', label: `지휘관 진급 → Lv ${fmt(n(up!.to)!)}`, delta: null, after: null, note: '', rejected: false });
    }
    return lines;
  }
</script>

<script lang="ts">
  import Icon from '@simbot/ui/Icon.svelte';
  let { logs }: { logs: Log[] } = $props();
  let lines = $derived(logs.flatMap((log, i) => toFactLines(log, i)));
  let confirmed = $derived(lines.filter((l) => !l.rejected).length);
  let blocked = $derived(lines.filter((l) => l.rejected).length);
</script>

{#if lines.length}
  <section class="receipt" aria-label="엔진이 확정한 사실">
    <header>
      <span class="stamp"><Icon name="star" size={12}/> 엔진 확정</span>
      <span class="count">{confirmed}건 확정{#if blocked} · {blocked}건 차단{/if}</span>
    </header>
    <ol>
      {#each lines as line (line.key)}
        <li class:rejected={line.rejected}>
          <span class="icon" aria-hidden="true"><Icon name={factIconName(line.icon)} size={14}/></span>
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
