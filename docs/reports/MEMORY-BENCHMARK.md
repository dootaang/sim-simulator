# 기억 벤치마크 결과 (Phase A~C · schema 0.2)

> 이 표는 **외부 API 없는 고정(결정론) 임베딩 provider**로 측정한 것이다. 목적은 검색 파이프라인·지표가 올바른지, 네 방식의 상대적 강약을 재는 것이다. **절대적 의미 품질이 아니다** — 실제 임베딩 품질은 Voyage 실호출(Phase C, `--live-voyage`)에서 별도 측정한다.

- provider: `fixed-hashgram-256` (문자 3-gram 해시, 256차원)
- 비교군: A 최근창만 / B 구조화+어휘 / C HypaV3 재현 / D Simbot 하이브리드 / E Grounded Continuity

## 검색 품질

| 지표 | A. recent-only | B. structured+lexical | C. hypa-v3 | D. simbot-hybrid | E. grounded-continuity |
|---|---|---|---|---|---|
| Recall@1 | 10.0% | 23.0% | 10.0% | 16.0% | 17.0% |
| Recall@5 | 16.0% | 53.0% | 22.0% | 49.0% | 28.0% |
| Recall@10 | 16.0% | 73.0% | 45.0% | 72.0% | 32.0% |
| MRR | 12.5% | 35.9% | 17.6% | 30.5% | 21.5% |
| nDCG@10 | 13.4% | 43.5% | 23.0% | 39.4% | 23.8% |
| 근거 정확도 precision@5 (정답 대비) | 5.0% | 11.8% | 4.5% | 10.1% | 5.8% |
| 출처 보유율(precision 아님·참고) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 폐기 기억 거부율(현재사실 블록) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

## 게임 사실 안전성 (낮을수록 좋음, 단 abstention은 높을수록 좋음)

| 지표 | A. recent-only | B. structured+lexical | C. hypa-v3 | D. simbot-hybrid | E. grounded-continuity |
|---|---|---|---|---|---|
| 현재사실 정확도(current-fact 정답이 현재사실 블록에) | 0.0% | 100.0% | 0.0% | 100.0% | 100.0% |
| 폐기 과거값을 현재 사실로 노출(건) | 0 | 0 | 0 | 0 | 0 |
| 폐기 기억이 주입후보 top10에 섞인 평균(건) | 0.20 | 7.01 | 1.36 | 7.56 | 1.00 |
| NPC 혼동(오답이 top1, 건) | 1 | 1 | 1 | 2 | 2 |
| negative에서 abstention 성공률 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| 답변가능 질문 과잉 abstention률 | 0.0% | 0.0% | 0.0% | 0.0% | 34.0% |
| 금지 문구 회상(건) | 10 | 31 | 14 | 31 | 23 |

## 자원

| 지표 | A. recent-only | B. structured+lexical | C. hypa-v3 | D. simbot-hybrid | E. grounded-continuity |
|---|---|---|---|---|---|
| 평균 기억 토큰 | 33 | 131 | 124 | 141 | 92 |
| 최대 기억 토큰 | 63 | 190 | 143 | 186 | 228 |

## 카테고리별 Recall@5 (E. grounded-continuity)

| 카테고리 | Recall@5 |
|---|---|
| current-fact | 0.0% |
| superseded | 30.0% |
| promise-secret-relation | 45.0% |
| paraphrase | 15.0% |
| npc-disambiguation | 50.0% |
| negative | n/a (정답 없음) |

## 해석 주의

- **근거 정확도(top5)** = 상위 5 hit 중 실제 정답 근거인 비율(precision@5). 정답 없는 negative는 제외. (이전 버전은 "출처 필드 존재"만 봐 항상 100%였던 것을 교정.)
- **폐기 기억 거부율**은 `supersededRecordIds`를 가진 질문(current-fact 20문항)에서 "폐기된 과거값이 현재 사실 블록에 안 들어갔는지"를 측정한다. superseded 카테고리 질문은 정답 자체가 과거값(회상 대상)이라 이 지표의 대상이 아니며, 대신 forbiddenClaims로 "과거를 현재로 단정" 여부를 잡는다.
- negative 카테고리는 정답 record가 없으므로 Recall 집계에서 제외되고, "금지 문구 회상" 건수로만 평가한다.
- 고정 provider는 어휘가 겹치는 바꿔 말하기에만 신호를 준다. 진짜 동의어·의역 회수 능력은 Voyage 측정에서 판단한다.
- authoritative 현재 사실은 구조화 lookup(B·D·E)이 제공한다. E는 candidate/rejected를 제외하며, 나중에 superseded된 사실도 조회 시점의 유효구간 안에서는 당시 사실로 복원한다.

## 권고 (이번 고정 provider 측정 기준)

1. **현재 검색 품질 기준선은 여전히 B(구조화+어휘)다.** Recall@5가 가장 높고 외부 비용·지연이 없다.
2. **E는 연속성 안전 계약을 처음 얹은 통합 기준선이지, 아직 플레이 기본값이 아니다.** 현재 사실·장면·비밀·롤백 필터는 회귀 테스트를 통과했지만, 이 코퍼스에서 Recall@5가 B보다 낮고 답변 가능한 질문을 과하게 포기한다.
3. **hard-negative abstention은 아직 미해결이다.** E도 이름과 주제가 매우 비슷한 거짓 질문을 관련 기억으로 오인했다. 단순 점수 임계값만 올리면 정상 질문도 더 많이 버리므로, 다음 단계에서 주장 단위 부정 검증과 정규 앵커 일치를 별도 신호로 추가해야 한다.
4. **고정 해시 임베딩은 최종 의미 품질 판정 도구가 아니다.** Voyage 실측 전까지 semantic은 opt-in으로 유지하고, 어휘 근거가 없는 semantic 단독 주입의 하한을 별도로 보정한다.

> 요약: **authoritative 사실은 엔진이, 현재 기본 회수는 구조화+어휘가** 감당한다. E의 시간·장면·지식 경계는 유지하되, 검색·abstention 보정이 끝나기 전에는 라이브 프롬프트에 연결하지 않는다.
