// 럭키 시뮬레이터 — 용사여관 [ysp_*] 태그 → 엔진 이벤트 번역기 (순수 함수).
// ADR 0002: 리스 카드의 Lua를 실행하지 않고 태그 계약의 의미를 우리 엔진 이벤트로 옮긴다.
// 카드가 손코딩하던 누적·롤백·재인덱싱은 엔진(sessionJournal)이 네이티브로 대신하므로,
// 이 계층은 "LLM 본문의 태그를 엔진 이벤트 목록으로 바꾸고 본문에서 제거"만 한다.
//
// 등급(호환성 여권): 'exact' 그대로 직역 | 'approx' 의미 근사 변환(엔진 계약 차이) | 'preserved' 미지원(보존).

export interface TranslatedEvent { id: string; params: Record<string, unknown>; grade: 'exact' | 'approx'; tag: string; }
export interface UnsupportedTag { tag: string; kind: string; reason: string; }
export interface YspTranslation { events: TranslatedEvent[]; unsupported: UnsupportedTag[]; residue: string; }

// 키에 한글 세력명 등이 올 수 있어(예: ysp_rep_마을) ']'·':'만 제외하고 넓게 잡는다.
const TAG_RE = /\[((?:ysp_|YSP_)[^\]:]+)((?:::[^\]]*)?)\]/g;

function num(value: string | undefined): number { const n = Number(String(value ?? '').trim()); return Number.isFinite(n) ? Math.trunc(n) : 0; }
// 리스 태그의 raw 델타(±N)를 엔진 scale_delta의 stepped size로 근사. 결정론(같은 N=같은 size).
function stepFromMagnitude(magnitude: number): 'S' | 'M' | 'L' | 'XL' { const m = Math.abs(magnitude); return m >= 10 ? 'XL' : m >= 6 ? 'L' : m >= 3 ? 'M' : 'S'; }

export function translateYspTags(text: string): YspTranslation {
  const events: TranslatedEvent[] = [];
  const unsupported: UnsupportedTag[] = [];
  const source = String(text ?? '');
  const residue = source.replace(TAG_RE, (match, rawKey, rawArgs) => {
    const key = String(rawKey).toLowerCase();
    const args = String(rawArgs || '').split('::').slice(1).map((s) => s.trim()); // 첫 원소는 '' (앞의 ::)
    const push = (id: string, params: Record<string, unknown>, grade: 'exact' | 'approx' = 'exact') => events.push({ id, params, grade, tag: match });
    const skip = (kind: string, reason: string) => unsupported.push({ tag: match, kind, reason });
    switch (key) {
      case 'ysp_gold': push('gold_delta', { amount: num(args[0]), reason: args[1] ?? '' }); break;
      case 'ysp_food': push('resource_delta', { resource: 'food', amount: num(args[0]) }); break;
      case 'ysp_drink': push('resource_delta', { resource: 'drink', amount: num(args[0]) }); break;
      case 'ysp_material': push('resource_delta', { resource: 'material', amount: num(args[0]) }); break;
      case 'ysp_affinity': case 'ysp_lewd': case 'ysp_pop': case 'ysp_obd': {
        const scale = key === 'ysp_affinity' ? 'affinity' : key.slice(4);
        const target = args[0] ?? '', delta = num(args[1]);
        push('scale_delta', { scale, target, size: stepFromMagnitude(delta), direction: delta < 0 ? '-' : '+' }, 'approx');
        break;
      }
      case 'ysp_checkin': push('checkin', { roomNo: args[0] ?? '', guestName: args[1] ?? '', stayDays: num(args[2]) || 1 }); break;
      case 'ysp_checkout': push('checkout', { roomNo: args[0] ?? '', guestName: args[1] ?? '' }); break;
      case 'ysp_nextday': push('day_end', {}); break;
      case 'ysp_hire': push('hire', { npcId: args[0] ?? '', dailyWage: num(args[1]) }); break;
      case 'ysp_fire': push('fire', { npcId: args[0] ?? '' }); break;
      case 'ysp_sex': skip('사교/관계', 'ysp_sex는 현재 스키마에 대응 상태가 없어 보존(관계 모듈 확장 대기)'); break;
      case 'ysp_exp': skip('경험치', 'exp_gain은 소스(category) 계약이라 raw 델타를 직역 불가 — 근거 태그 재설계 대기'); break;
      case 'ysp_hp': case 'ysp_mp': skip('풀', `${key}는 pool 회복 계약 매핑 대기`); break;
      case 'ysp_capture': case 'ysp_release': skip('포로', '포로 모듈 미구현 — 원본 보존'); break;
      case 'ysp_equip_add': case 'ysp_equip_remove': skip('장비', '장비 인벤 매핑 대기'); break;
      default:
        if (key.startsWith('ysp_rep_')) skip('평판', 'rep_event는 axis/category 계약이라 raw 델타 직역 불가 — 매핑 테이블 대기');
        else if (key.startsWith('ysp_gate') || key.startsWith('ysp_dungeon')) skip('던전/게이트', '던전 모듈 미구현 — 원본 보존');
        else skip('미분류', `알 수 없는 태그: ${key}`);
    }
    return ''; // 본문에서 태그 제거
  });
  return { events, unsupported, residue: residue.replace(/\n{3,}/g, '\n\n').trim() };
}

// 호환성 여권용 요약 — 카드 임포트 시 태그 계약이 어느 등급으로 번역되는지.
export function tagCompatibilityGrades(sampleText: string): { exact: string[]; approx: string[]; preserved: string[] } {
  const t = translateYspTags(sampleText);
  const exact = [...new Set(t.events.filter((e) => e.grade === 'exact').map((e) => e.id))];
  const approx = [...new Set(t.events.filter((e) => e.grade === 'approx').map((e) => e.id))];
  const preserved = [...new Set(t.unsupported.map((u) => u.kind))];
  return { exact, approx, preserved };
}
