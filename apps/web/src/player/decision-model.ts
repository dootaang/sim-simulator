// 결정 카드 모델 — "지금 엔진이 결정을 기다리는 것"을 채팅 흐름 안 캡슐로 만든다(조종석 ②).
// 실제 선택지는 엔진만 제시한다(ADR 0002 §5): 여기의 모든 옵션은 셀렉터가 available이라고 판정한
// 엔진 이벤트뿐이며, LLM 서사에 등장하는 가짜 선택지와 시각적으로 구분되는 서명(★)을 단다.
// 카드가 해소되면(상태 변화) 캡슐은 사라지고 사실 영수증·서사가 기록으로 남는다.
import type { SimulationActionMode } from './simulation-action';

export interface DecisionOption { label: string; id: string; params: Record<string, unknown>; mode: SimulationActionMode; kind: 'primary' | 'ghost'; intent?: string }
export interface DecisionCardModel { key: string; icon: 'alert' | 'star' | 'bed' | 'heart'; title: string; desc: string; options: DecisionOption[]; more: string; dismissible?: boolean }

const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown) => (Array.isArray(v) ? v.map(rec) : []);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function safeSelect(select: (id: string) => unknown, id: string): unknown {
  try { return select(id); } catch { return null; } // 미등록 셀렉터(타 장르·순수 채팅)는 결정 없음으로 취급
}

// 티어 승급 = 서사 이벤트(조종석 슬라이스 5). 직전 턴 로그의 tierChanged 승급을 "특별한 장면" 제안 카드로.
// 발생 시점은 엔진이, 장면 내용은 LLM이 — 이 제품의 분업 그대로. 강등은 카드 없이 경고 칩만(대칭 설계).
function tierCards(logs: ReadonlyArray<Record<string, unknown>>, turn: number, nameFor: (id: string) => string): DecisionCardModel[] {
  const cards: DecisionCardModel[] = [];
  for (const log of logs) {
    if (log.ok !== true || log.event !== 'scale_delta') continue;
    const tier = rec(log.tierChanged), from = rec(tier.from), to = rec(tier.to);
    if (!to.label) continue;
    const range = (v: unknown) => (Array.isArray(v) ? v : []);
    const fromStart = num(range(from.range)[0], Number.NaN), toStart = num(range(to.range)[0], Number.NaN);
    if (Number.isFinite(fromStart) && Number.isFinite(toStart) && toStart <= fromStart) continue; // 강등은 칩만
    const target = String(log.target ?? ''), name = nameFor(target) || target, label = String(to.label);
    cards.push({ key: `tier:${turn}:${target}:${label}`, icon: 'heart', title: '관계가 깊어졌다', desc: `${name}: ${String(from.label ?? '')} → ${label}${to.brief ? ` — ${String(to.brief)}` : ''}`, more: '', dismissible: true,
      options: [{ label: '특별한 장면 열기', id: 'tier_scene', params: {}, mode: 'scene', kind: 'primary', intent: `${name}와의 관계가 방금 '${label}' 단계에 접어들었다. 그 변화가 서로에게 느껴지는 특별한 장면을 짧게 열어라.` }] });
  }
  // GFL 관계 판정·대화 마무리의 티어 승급 — 같은 "엔진이 시점을, LLM이 장면을" 분업을 그대로 쓴다.
  for (const log of logs) {
    if (log.ok !== true || (log.event !== 'gfl/relation/check' && log.event !== 'gfl/relation/session/end' && log.event !== 'gfl/relation/outing')) continue;
    const tier = rec(log.tierChanged), from = rec(tier.from), to = rec(tier.to);
    if (!to.label) continue;
    const name = String(log.name ?? log.dollId ?? ''), label = String(to.label);
    cards.push({ key: `gfl-tier:${turn}:${String(log.dollId)}:${label}`, icon: 'heart', title: '관계가 깊어졌다', desc: `${name}: ${String(from.label ?? '')} → ${label}${to.description ? ` — ${String(to.description)}` : ''}`, more: '', dismissible: true,
      options: [{ label: '특별한 장면 열기', id: 'tier_scene', params: {}, mode: 'scene', kind: 'primary', intent: `${name}와의 관계가 방금 '${label}' 단계에 접어들었다. 그 변화가 서로에게 느껴지는 특별한 장면을 짧게 열어라.` }] });
  }
  // 지휘관 진급도 엔진 로그가 시점을 확정하고, 선택 시 LLM은 짧은 축하 장면만 연출한다.
  for (const log of logs) {
    if (log.ok !== true || (log.event !== 'gfl/sortie/engage' && log.event !== 'gfl/sortie/resolve' && log.event !== 'gfl/sortie/finish')) continue;
    const levelUp = rec(log.levelUp), to = num(levelUp.to);
    if (to < 2) continue;
    cards.push({
      key: `gfl-commander-level:${turn}:${to}`,
      icon: 'star',
      title: `진급 — Lv ${to}`,
      desc: `작전 경험이 쌓여 지휘관 레벨 ${to}에 도달했다.`,
      more: '',
      dismissible: true,
      options: [{ label: '진급 보고 장면 열기', id: 'commander_level_scene', params: {}, mode: 'scene', kind: 'primary', intent: `지휘관이 방금 Lv ${to}로 진급했다. 기지에 그 소식이 퍼지는 짧은 장면을 열어라.` }],
    });
  }
  return cards;
}

export interface DecisionContext { logs?: ReadonlyArray<Record<string, unknown>>; turn?: number; nameFor?: (id: string) => string }

export function buildDecisionCards(select: (id: string) => unknown, context: DecisionContext = {}): DecisionCardModel[] {
  const cards: DecisionCardModel[] = tierCards(context.logs ?? [], context.turn ?? 0, context.nameFor ?? ((id) => id));
  const gflStatus = rec(safeSelect(select, 'gfl/status'));
  const logistics = arr(safeSelect(select, 'gfl/logistics'));
  for (const job of logistics.filter((entry) => entry.status === 'complete')) {
    const reward = rec(job.reward);
    cards.push({
      key: `gfl-logistics:${String(job.id)}`,
      icon: 'star',
      title: `군수지원 복귀 · ${String(job.echelonName ?? job.echelonId)}`,
      desc: `파견 때 확정된 보상: 자금 ${num(reward.gold).toLocaleString()} · 자원 ${num(reward.res).toLocaleString()}`,
      more: '수령 전까지 제대 대기',
      options: [{ label: '보급품을 수령한다', id: 'gfl/logistics/collect', params: { jobId: String(job.id) }, mode: 'ledger', kind: 'primary' }],
    });
  }
  // 대화 세션 상주 카드 — 시간이 멈춰 있음을 계속 보여주고, 마무리(=보너스 확정) 출구를 하나만 남긴다.
  const dialogue = rec(gflStatus.dialogue);
  if (dialogue.dollId) {
    cards.push({
      key: `gfl-dialogue:${String(dialogue.dollId)}:${String(dialogue.day)}`,
      icon: 'heart',
      title: `${String(dialogue.name ?? dialogue.dollId)}와 대화 중 · 시간 정지`,
      desc: '자유롭게 대화를 나누세요. 마무리하면 엔진이 교감 보너스를 확정하고 기지의 시간이 다시 흐릅니다.',
      more: '인형별 하루 1회',
      options: [{ label: '대화를 마무리한다', id: 'gfl/relation/session/end', params: {}, mode: 'narrated', kind: 'primary' }],
    });
  }
  // 판정 직후의 후속 캡슐 — 엔진이 상태에 기록한 제안만 카드가 되고, DC 보정도 상태에서 온다.
  const followUp = rec(gflStatus.followUp), followOptions = arr(followUp.options);
  if (followUp.dollId && followOptions.length) {
    cards.push({
      key: `gfl-followup:${String(followUp.dollId)}:${String(followUp.source)}:${String(followUp.day)}`,
      icon: 'heart',
      title: `${String(followUp.name ?? followUp.dollId)} — 이어지는 분위기`,
      desc: '방금의 교감이 좋았다. 지금이라면 한 걸음 더 나아갈 수 있다. 시간대가 넘어가면 사라진다.',
      more: 'DC 보정 적용',
      dismissible: true,
      options: followOptions.map((option) => ({ label: `${String(option.label)} (DC ${num(option.dc)})`, id: 'gfl/relation/check', params: { dollId: String(followUp.dollId), choice: String(option.choice), followup: true }, mode: 'narrated' as const, kind: 'primary' as const })),
    });
  }
  const bossRecruit = rec(gflStatus.bossRecruit);
  if (bossRecruit.bossId) {
    const name = String(bossRecruit.name ?? bossRecruit.bossId);
    cards.push({
      key: `gfl-boss-recruit:${String(bossRecruit.bossId)}`,
      icon: 'star',
      title: `${name} · 구속 완료 — 영입하시겠습니까?`,
      desc: '첫 격파한 보스를 전술인형으로 편입할 수 있습니다. 숙소 자리 하나를 사용합니다.',
      more: '6성 · BOSS 병과',
      dismissible: true,
      options: [
        { label: '영입한다', id: 'gfl/boss/recruit', params: {}, mode: 'narrated', kind: 'primary' },
        { label: '보내준다', id: 'gfl/boss/dismiss', params: {}, mode: 'ledger', kind: 'ghost' },
      ],
    });
  }
  const prisoner = rec(gflStatus.prisoner);
  if (prisoner.active) {
    cards.push({
      key: `gfl-prisoner:${String(prisoner.missionId)}:${String(prisoner.capturedAt)}`,
      icon: 'alert',
      title: '포로 심문',
      desc: '심문에 성공하면 다음 교전 명중과 적 정보가 열린다. 실패하면 적의 매복으로 아군이 첫 라운드에 공격하지 못한다.',
      more: '다음 단계로 진행하면 포로는 자동으로 보내진다.',
      dismissible: true,
      options: [
        { label: '심문한다', id: 'gfl/sortie/interrogate', params: {}, mode: 'narrated', kind: 'primary' },
        { label: '보내준다', id: 'gfl/sortie/prisoner/release', params: {}, mode: 'ledger', kind: 'ghost' },
      ],
    });
  }
  const promiseRequest = rec(gflStatus.promiseRequest);
  if (promiseRequest.dollId) {
    const labels: Record<string,string> = { sortie: '다음 작전에 데려가 주세요', repair: '수복을 미루지 말아 주세요', anniversary: '기념일에 시간을 내주세요' };
    cards.push({ key: `gfl-promise:${String(promiseRequest.dollId)}:${String(promiseRequest.requestedDay)}`, icon: 'heart', title: `${String(promiseRequest.name)}의 약속`,
      desc: labels[String(promiseRequest.type)] ?? '약속을 지켜 주세요', more: String(promiseRequest.type) === 'repair' ? 'HP 50% 미만부터 1일 · 동시 3개까지' : `기한 ${num(promiseRequest.deadline)}일차 · 동시 3개까지`, dismissible: true,
      options: [{ label: '약속한다', id: 'gfl/relation/promise/accept', params: {}, mode: 'narrated', kind: 'primary' }, { label: '지금은 어렵다', id: 'gfl/relation/promise/decline', params: {}, mode: 'ledger', kind: 'ghost' }] });
  }
  for (const anniversary of arr(gflStatus.anniversaries).filter((entry) => entry.viewed !== true)) {
    cards.push({ key: `gfl-anniversary:${String(anniversary.dollId)}:${num(anniversary.days)}`, icon: 'heart', title: `함께한 지 ${num(anniversary.days)}일`, desc: `${String(anniversary.name)}와의 계약 기념일이다. 오늘 관계 행동 효과가 1.5배가 된다.`, more: '오늘 자정까지',
      options: [{ label: '특별한 장면 열기', id: 'gfl/relation/anniversary', params: { dollId: String(anniversary.dollId) }, mode: 'scene', kind: 'primary' }] });
  }
  // 암시장 브로커 — 엔진이 7일마다 제안을 확정하고, 구매는 의심도를 쌓는다(감사 리스크는 카드에 명시).
  const market = rec(gflStatus.market), marketPurchased = Array.isArray(market.purchased) ? (market.purchased as unknown[]).map(String) : [],
    marketOffers = arr(market.offers).filter((offer) => !marketPurchased.includes(String(offer.id)));
  if (marketOffers.length) {
    cards.push({
      key: `gfl-market:${String(market.day)}`,
      icon: 'star',
      title: '암시장 브로커 접선',
      desc: `정가의 60%. 단 거래마다 상부의 의심이 쌓입니다(현재 의심도 ${num(market.suspicion)}) — 20을 넘기면 감사 대상.`,
      more: '7일마다 갱신',
      dismissible: true,
      options: marketOffers.slice(0, 3).map((offer) => ({ label: `${String(offer.name)} · ${num(offer.price).toLocaleString()}자금`, id: 'gfl/market/buy', params: { offerId: String(offer.id) }, mode: 'ledger' as const, kind: 'primary' as const })),
    });
  }
  const sortie = rec(gflStatus.sortie);
  if (sortie.active) {
    const encounter = rec(sortie.encounter);
    if (encounter.dollId) {
      cards.push({
        key: `gfl-encounter:${String(sortie.missionId)}:${String(encounter.dollId)}`,
        icon: 'star',
        title: `무소속 전술인형 『${String(encounter.name ?? encounter.dollId)}』 발견`,
        desc: '작전 현장에서 단독 행동 중인 인형과 마주쳤다. 숙소에 자리가 있으면 즉시 부대에 합류시킬 수 있다.',
        more: '작전당 1명',
        options: [
          { label: '영입을 시도한다', id: 'gfl/encounter/recruit', params: {}, mode: 'narrated', kind: 'primary' },
          { label: '두고 간다', id: 'gfl/encounter/skip', params: {}, mode: 'ledger', kind: 'ghost' },
        ],
      });
    } else {
    const stages = arr(sortie.stages), current = num(sortie.current), stage = stages[current] ?? { type: 'battle' },
      type = String(stage.type ?? 'battle'), combat = type === 'battle' || type === 'boss', total = Math.max(1, stages.length),
      quick = String(sortie.engagementMode) === 'quick', gauge = num(sortie.command),
      icons: Record<string, string> = { battle: '교전', boss: 'BOSS', recon: '정찰', other: '돌발', mystery: '???' };
    // 전투의 결정권을 채팅으로 — 전술 3택·개입·오토런이 관리창 없이도 이 카드에서 끝난다.
    const options: DecisionOption[] = [];
    const narration=String(rec(gflStatus.settings).stageNarration),eachStage=narration==='each',combatMode:DecisionOption['mode']=narration==='silent'?'ledger':'narrated';
    if (quick) {
      if (type === 'boss') options.push({ label: '보스 교전', id: 'gfl/sortie/stage', params: {}, mode: combatMode, kind: 'primary' });
      else if (eachStage) options.push({ label: '단계 진행', id: 'gfl/sortie/stage', params: {}, mode: combatMode, kind: 'primary' });
      else {
        options.push({ label: '자동 진행 · 정지 지점까지', id: 'gfl/sortie/auto', params: {}, mode: combatMode, kind: 'primary' });
        options.push({ label: '한 단계만', id: 'gfl/sortie/stage', params: {}, mode: combatMode, kind: 'ghost' });
      }
    } else if (combat) {
      options.push({ label: '집중 사격', id: 'gfl/sortie/engage', params: { tactic: 'focus' }, mode: combatMode, kind: 'primary' });
      options.push({ label: '균형 전술', id: 'gfl/sortie/engage', params: { tactic: 'balanced' }, mode: combatMode, kind: 'primary' });
      options.push({ label: '엄폐 전진', id: 'gfl/sortie/engage', params: { tactic: 'cover' }, mode: combatMode, kind: 'primary' });
      if (gauge >= 100) for (const [kind2, label] of [['focus', '지휘 개입 · 집중사격'], ['brace', '지휘 개입 · 긴급 엄폐'], ['barrage', '지휘 개입 · 탄막 요청']] as const)
        options.push({ label: `${label} + 균형 전술 · 1라운드`, id: 'gfl/sortie/engage', params: { tactic: 'balanced', intervention: { round: 1, type: kind2 } }, mode: combatMode, kind: 'ghost' });
    } else {
      options.push({ label: '단계 진행', id: 'gfl/sortie/stage', params: {}, mode: combatMode, kind: 'primary' });
    }
    cards.push({
      key: `gfl-sortie:${String(sortie.missionId)}:${String(sortie.echelonId)}:${current}`,
      icon: 'alert',
      title: `다음 단계 진행 · ${current + 1}/${total} · ${icons[type] ?? type}`,
      desc: combat
        ? `제대 ${String(sortie.echelonId)} · 전투력 ${num(sortie.power).toLocaleString()} — 현재 교전을 엔진이 계산합니다.`
        : `${icons[type] ?? type} 단계 — 전투 없이 현재 상황을 해소합니다.`,
      more: `지휘 게이지 ${gauge}/100${sortie.scouted ? ' · 정찰 보정 +1 대기' : ''}`,
      options,
    });
    }
  }
  const traffic = rec(safeSelect(select, 'inn/traffic'));
  if (!Object.keys(traffic).length) return cards;
  const incident = rec(traffic.incident);
  if (Object.keys(incident).length) {
    cards.push({ key: `incident:${String(incident.id)}`, icon: 'alert', title: String(incident.label ?? '돌발 사건'), desc: String(incident.desc ?? ''), more: '',
      options: arr(incident.choices).map((choice) => ({ label: String(choice.label ?? choice.id), id: 'incident_choice', params: { choice: String(choice.id) }, mode: 'narrated' as const, kind: 'primary' as const })) });
    return cards; // 사건이 대기 중이면 다른 결정은 엔진이 어차피 잠근다 — 카드도 하나만 보여 혼선을 막는다.
  }
  const wave = arr(traffic.waves).find((item) => item.available);
  if (wave) cards.push({ key: `wave:${String(wave.id)}`, icon: 'star', title: `${String(wave.label ?? wave.id)} 대기`, desc: '', more: '',
    options: [{ label: '영업 시작', id: 'traffic_wave', params: { wave: String(wave.id) }, mode: 'narrated', kind: 'primary' }, { label: '건너뛰기', id: 'traffic_wave', params: { wave: String(wave.id), skip: true }, mode: 'ledger', kind: 'ghost' }] });
  const lodging = arr(traffic.lodging);
  const request = lodging[0];
  if (request) {
    const party = num(request.party, 1), stay = num(request.stayDays, 1), revenue = num(request.revenue);
    cards.push({ key: `lodging:${String(request.id)}`, icon: 'bed', title: `숙박 문의 · ${String(request.guestName ?? '손님')} 일행 ${party}명 · ${stay}박`, desc: request.available ? (revenue ? `수락 시 +${revenue.toLocaleString()}원 (${String(request.roomNo)}호)` : '') : String(request.reason ?? ''), more: lodging.length > 1 ? `외 ${lodging.length - 1}건은 관리 화면에서` : '',
      options: [...(request.available ? [{ label: '수락', id: 'lodging_accept', params: { requestId: String(request.id) }, mode: 'narrated' as const, kind: 'primary' as const }] : []), { label: '거절', id: 'lodging_reject', params: { requestId: String(request.id) }, mode: 'narrated' as const, kind: 'ghost' as const }] });
  }
  return cards;
}
