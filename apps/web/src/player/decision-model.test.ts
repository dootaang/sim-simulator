import { describe, expect, it } from 'vitest';
import { buildDecisionCards } from './decision-model';

const selectFrom = (traffic: unknown) => (id: string) => (id === 'inn/traffic' ? traffic : null);

describe('결정 카드 모델', () => {
  it('소녀전선 작전의 현재 단계를 채팅 안 진행 버튼으로 고정한다', () => {
    const cards = buildDecisionCards((id) => id === 'gfl/status' ? { sortie: { active: true, missionId: 'alpha', echelonId: 'e1', power: 1800, current: 1, stages: [{type:'recon',completed:true},{type:'battle'},{type:'boss'}] } } : null);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'gfl-sortie:alpha:e1:1', title: '다음 단계 진행 · 2/3 ⚔', more: '단계 시퀀스 확정됨' });
    expect(cards[0]!.options[0]).toMatchObject({ label: '교전 진행', id: 'gfl/sortie/resolve', mode: 'narrated' });
    const recon = buildDecisionCards((id) => id === 'gfl/status' ? { sortie: { active: true, missionId: 'alpha', echelonId: 'e1', current: 0, stages: [{type:'recon'},{type:'battle'}] } } : null);
    expect(recon[0]).toMatchObject({ title: '다음 단계 진행 · 1/2 🔍', options: [{ label: '단계 진행', id: 'gfl/sortie/stage' }] });
  });
  it('야전 조우 인형은 엔진 상태에 있을 때만 영입·두고 가기 카드로 제시한다', () => {
    const cards = buildDecisionCards((id) => id === 'gfl/status' ? { sortie: { active: true, missionId: 'alpha', encounter: { dollId: 'springfield', name: 'Springfield' } } } : null);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'gfl-encounter:alpha:springfield', title: '무소속 전술인형 『Springfield』 발견', more: '작전당 1명' });
    expect(cards[0]!.options).toEqual([
      expect.objectContaining({ label: '영입을 시도한다', id: 'gfl/encounter/recruit', kind: 'primary' }),
      expect.objectContaining({ label: '두고 간다', id: 'gfl/encounter/skip', kind: 'ghost' }),
    ]);
  });
  it('대기 중인 첫 영업 파동을 영업 시작(서사)·건너뛰기(장부) 카드로 만든다', () => {
    const cards = buildDecisionCards(selectFrom({ waves: [{ id: 'lunch', label: '점심 영업', available: false, reason: '완료' }, { id: 'dinner', label: '저녁 영업', available: true }], incident: null, lodging: [] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]!).toMatchObject({ key: 'wave:dinner', title: '저녁 영업 대기' });
    expect(cards[0]!.options.map((option) => `${option.label}:${option.mode}`)).toEqual(['영업 시작:narrated', '건너뛰기:ledger']);
    expect(cards[0]!.options[1]!.params).toEqual({ wave: 'dinner', skip: true });
  });
  it('사건이 대기 중이면 사건 카드만 만든다 — 엔진이 나머지를 잠그기 때문', () => {
    const cards = buildDecisionCards(selectFrom({ incident: { id: 'thief', label: '좀도둑', desc: '주방을 노린다', choices: [{ id: 'chase', label: '쫓아낸다' }, { id: 'ignore', label: '모른 척한다' }] }, waves: [{ id: 'lunch', available: true }], lodging: [{ id: 'r1', available: true }] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]!).toMatchObject({ icon: 'alert', title: '좀도둑', desc: '주방을 노린다' });
    expect(cards[0]!.options.map((option) => option.params.choice)).toEqual(['chase', 'ignore']);
  });
  it('숙박 문의는 첫 건을 카드로, 나머지는 관리 화면 안내로 접는다. 수용 불가면 수락 버튼이 없다', () => {
    const cards = buildDecisionCards(selectFrom({ incident: null, waves: [], lodging: [{ id: 'a', guestName: '박', party: 2, stayDays: 3, available: true, roomNo: '201', revenue: 24000 }, { id: 'b', available: false, reason: '빈 객실 없음' }] }));
    expect(cards[0]!).toMatchObject({ icon: 'bed', title: '숙박 문의 · 박 일행 2명 · 3박', desc: '수락 시 +24,000원 (201호)', more: '외 1건은 관리 화면에서' });
    const full = buildDecisionCards(selectFrom({ incident: null, waves: [], lodging: [{ id: 'b', available: false, reason: '빈 객실 없음' }] }));
    expect(full[0]!.options.map((option) => option.label)).toEqual(['거절']);
    expect(full[0]!.desc).toBe('빈 객실 없음');
  });
  it('티어 승급 로그는 특별한 장면 제안 카드가 되고, 강등은 카드를 만들지 않는다', () => {
    const up = { ok: true, event: 'scale_delta', target: 'silvia', scale: 'affinity', tierChanged: { from: { label: '신뢰', range: [81, 150] }, to: { label: '애착', range: [151, 180], brief: '감정적 의존' } } };
    const down = { ok: true, event: 'scale_delta', target: 'clem', tierChanged: { from: { label: '호의', range: [81, 110] }, to: { label: '중립', range: [51, 80] } } };
    const cards = buildDecisionCards(() => null, { logs: [up, down], turn: 7, nameFor: (id) => (id === 'silvia' ? '실비아' : id) });
    expect(cards).toHaveLength(1);
    expect(cards[0]!).toMatchObject({ key: 'tier:7:silvia:애착', icon: 'heart', title: '관계가 깊어졌다', desc: '실비아: 신뢰 → 애착 — 감정적 의존', dismissible: true });
    expect(cards[0]!.options[0]!).toMatchObject({ mode: 'scene', label: '특별한 장면 열기' });
    expect(cards[0]!.options[0]!.intent).toContain("실비아와의 관계가 방금 '애착' 단계");
  });
  it('여관 셀렉터가 없는 카드(순수 채팅·타 장르)는 빈 배열 — 캡슐 자체가 안 뜬다', () => {
    expect(buildDecisionCards(() => null)).toEqual([]);
    expect(buildDecisionCards(() => { throw new Error('unknown_selector'); })).toEqual([]);
  });
  it('GFL 대화 세션과 후속 캡슐을 결정 카드로 만든다', () => {
    const cards = buildDecisionCards((id) => id === 'gfl/status' ? {
      dialogue: { dollId: 'm4a1', name: 'M4A1', day: 3 },
      followUp: { dollId: 'm4a1', name: 'M4A1', day: 3, source: 'talk', options: [{ choice: 'nickname', label: '서로 부를 별명을 정한다', dc: 9, dcMod: -1 }] },
    } : null);
    const dialogue = cards.find((card) => card.key === 'gfl-dialogue:m4a1:3');
    expect(dialogue?.title).toContain('시간 정지');
    expect(dialogue?.options[0]).toMatchObject({ id: 'gfl/relation/session/end', mode: 'narrated' });
    const follow = cards.find((card) => card.key.startsWith('gfl-followup:m4a1:talk'));
    expect(follow?.dismissible).toBe(true);
    expect(follow?.options[0]).toMatchObject({ id: 'gfl/relation/check', params: { dollId: 'm4a1', choice: 'nickname', followup: true }, mode: 'narrated' });
    expect(follow?.options[0]?.label).toContain('DC 9');
  });
  it('GFL 관계 판정의 티어 승급을 특별한 장면 카드로 만든다', () => {
    const log = { ok: true, event: 'gfl/relation/check', dollId: 'm4a1', name: 'M4A1', tierChanged: { from: { label: '첫 만남', index: 0 }, to: { label: '신뢰', index: 1, description: '서로를 믿는다' } } };
    const cards = buildDecisionCards(() => null, { logs: [log], turn: 5 });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'gfl-tier:5:m4a1:신뢰', title: '관계가 깊어졌다', dismissible: true });
    expect(cards[0]?.options[0]).toMatchObject({ mode: 'scene' });
    expect(cards[0]?.options[0]?.intent).toContain('신뢰');
    expect(cards[0]?.desc).toContain('서로를 믿는다');
  });
  it('GFL 지휘관 레벨업 로그를 진급 장면 카드로 만든다', () => {
    const log = { ok: true, event: 'gfl/sortie/resolve', levelUp: { from: 1, to: 3 } };
    const cards = buildDecisionCards(() => null, { logs: [log], turn: 8 });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'gfl-commander-level:8:3', icon: 'star', title: '진급 — Lv 3', dismissible: true });
    expect(cards[0]?.options[0]).toMatchObject({ label: '진급 보고 장면 열기', mode: 'scene' });
    expect(cards[0]?.options[0]?.intent).toContain('Lv 3');
  });
  it('첫 격파 보스의 구속 결과를 영입 결정 카드로 표시한다', () => {
    const cards = buildDecisionCards((id) => id === 'gfl/status' ? { bossRecruit: { bossId: 'scarecrow', name: 'Scarecrow' } } : null);
    expect(cards[0]).toMatchObject({ key: 'gfl-boss-recruit:scarecrow', title: '⚠ Scarecrow · 구속 완료 — 영입하시겠습니까?', more: '6성 · BOSS 병과', dismissible: true });
    expect(cards[0]!.options).toEqual([
      expect.objectContaining({ label: '영입한다', id: 'gfl/boss/recruit', kind: 'primary' }),
      expect.objectContaining({ label: '보내준다', id: 'gfl/boss/dismiss', kind: 'ghost' }),
    ]);
  });
  it('복귀한 군수지원은 확정 보상과 수령 버튼을 결정 카드로 표시한다', () => {
    const cards = buildDecisionCards((id) => id === 'gfl/logistics' ? [{ id: 'logistics:1:0', echelonId: 'e1', echelonName: '제1제대', status: 'complete', reward: { gold: 321, res: 192 } }] : id === 'gfl/status' ? {} : null);
    expect(cards[0]).toMatchObject({ key: 'gfl-logistics:logistics:1:0', title: '군수지원 복귀 · 제1제대', desc: '파견 때 확정된 보상: 자금 321 · 자원 192', more: '수령 전까지 제대 대기' });
    expect(cards[0]?.options[0]).toMatchObject({ label: '보급품을 수령한다', id: 'gfl/logistics/collect', params: { jobId: 'logistics:1:0' }, mode: 'ledger' });
  });
});
