# REPORT — 엔진 클릭 지연 수술 (진행 기록)

지시서: WORKORDER-SESSION-SAVE-PERF-2026-07-19.md / 설계: SPEC-SESSION-SAVE-PERF-2026-07-19.md
하니스: `corepack pnpm --filter @simbot/session perf:clicks`
(합성 회차 — 유닛 60기 상당 벌크 상태, 임포트 프리셋 raw ~80KB 모사, IDB는 구조적 클론+직렬화 근사)

## 하니스 수치 누적표

| 시점 | 50이벤트 p50/p95 (ms) | 1,000이벤트 p50/p95 (ms) | 1,000이벤트 payload | p95 성장배율 |
|---|---|---|---|---|
| **기준선 (파동 0)** | 78.6 / 108.1 | 635.3 / 712.3 | 30.7MB | 6.59× |
| 파동 1 (다이어트) | 12.4 / 18.8 | 139.3 / 158.6 | 6.1MB | 8.56× |
| 파동 2 (에폭 분리) | 12.9 / 19.0 | 143.5 / 155.9 | 6.1MB | 8.19× |
| 파동 3 (integrity v2) | 12.2 / 19.1 | 127.4 / 137.7 | 6.1MB | 7.21× |

목표: 1,000이벤트 p95 ≤ 50ms, 성장배율 ≈ 1×(역사 비비례).

## 파동 진행 기록

### 파동 0 — 하니스 (완료)
- packages/session/scripts/click-perf-harness.mts + `perf:clicks` 스크립트.
- 기준선이 진단과 일치: 클릭당 비용·payload가 역사에 비례(6.6×/5.1×).

### 파동 1 — 속효 다이어트 (완료)
- 1a 저널 발산 감시: 기대 '스냅샷' 대신 기대 해시+RNG 위치만 유지 — append당 전체 상태
  문자열화 3→1회, 전체 클론 1회 제거(감시력 등가: 외부 변조 거부 테스트 고정).
- 1b 체크포인트 프리셋 참조화: presetRef {id,version} + 세션 presetSnapshots 사전(변경 시점만 본문).
  저장 history에는 참조된 비현행 프리셋만 동봉. 구형 인라인 체크포인트 하위호환.
- 1c 디스크 undo 5개(RAM 30 유지 — 오너 결정 1).
- 신규 테스트 3(발산 감시·참조 undo 왕복·깊이 분리), 세션 126/126.
- 효과: 1,000이벤트 p95 712→158.6ms(4.5×), payload 30.7→6.1MB. 성장배율은 여전 —
  남은 지배 항(저널 전량 직렬화·integrity 전량 해시)은 파동 2·3 대상.

### 파동 2 — 봉인 에폭 분리 보관 (완료)
- 핫 저장은 `sealedEpochRefs`(offset·sealedIndex·sealHash)만, 본문은 `<세션id>::sealed-epoch:<n>`
  불변 레코드로 봉인 시점 1회 기록. 로드는 `PlaySession.assembleSnapshot`이 본문을 fetch·sealHash
  대조 후 integrity 범위 밖 `sealedEpochBodies`로 동봉 → restore가 참조 검증 후 합체.
- 변조 탐지 3면 테스트: 본문 변조→조립 거부, 참조 변조→integrity 거부, 본문 누락→bodies_missing.
- 구형 인라인 스냅샷 로드→다음 save 승격, 채팅 삭제 GC(레코드 동반 삭제) 테스트 고정. 세션 130/130.
- **봉인 시나리오 실증**: 이벤트 600·에폭 2 회차의 클릭 p95 86.4ms·payload 3.8MB —
  payload가 전체 역사(600)가 아니라 현 에폭(200)에만 비례한다. 내보내기/백업은 여전히 자기완결(인라인).

### 파동 3 — integrity v2 (완료)
- 섹션 해시 합성(meta/messages/engine/memory/journal/history/bindings/extras) + `integrityVersion: 2`.
  저장 시 큰 두 섹션은 롤링 체인 재사용: 저널은 클래스 유지 이벤트 체인+initial 다이제스트+기대 해시
  기반 head(저장마다 전체 상태 재문자열화 제거), 메시지는 append O(1) 연장·그 외 변형 시 무효화.
- 검증은 전체 재계산 대조(로드 1회 O(n)). 커버리지는 v1 초집합(lastLogs 신규 포함).
- **변조 매트릭스**: 8개 섹션 1필드 변조 + 서명 삭제 + v1 다운그레이드 위장 전부 거부(신규 테스트 2).
  구형(버전 없음) 스냅샷은 구 알고리즘으로 계속 검증(하위호환 테스트 유지). 세션 132/132.
- 봉인 시나리오 p95 86.4→79.7ms. 잔여 지배 항은 payload 클론·IDB 구조적 클론 — 파동 4 대상.
- 롱런 카나리아의 에폭 위조 재서명 지점을 v2 인지형으로 갱신(디싱크 0·해시 일치 재확인).
