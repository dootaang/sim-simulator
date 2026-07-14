# Claude × Codex 자동 교대 감독기

사용자는 목표를 한 번만 적고, Claude가 구현한 변경을 Codex가 읽기 전용으로 감사합니다. 감사에서 결함이 나오면 그 JSON 보고서가 다음 Claude 라운드에 자동 전달됩니다. 둘을 동시에 풀어놓지 않으며, 현재 프로젝트와 분리된 Git worktree에서 작업하므로 사용자의 화면 작업이나 미추적 파일과도 섞이지 않습니다.

## 사용 순서

1. 다른 Claude/Codex 작업을 모두 끝내고 커밋합니다. 추적된 파일이 수정된 상태에서는 감독기가 시작되지 않습니다.
2. 목표 파일을 만듭니다. 화면에서 원하는 결과, 금지사항, 완료 조건을 적습니다.
3. 환경을 확인합니다.

```powershell
pnpm ai:pair:doctor
```

4. 실제 호출 없이 프롬프트와 잠금 동작만 미리 봅니다.

```powershell
pnpm ai:pair -- --objective .\MY-OBJECTIVE.md --dry-run
```

5. 자동 교대를 시작합니다.

```powershell
pnpm ai:pair -- --objective .\MY-OBJECTIVE.md --max-rounds 3 --claude-budget-usd 5
```

실행 기록은 Git에 올라가지 않는 `.ai-coordination/runs/<시각>/`에, 실제 변경은 `.ai-coordination/worktrees/<시각>/`에 남습니다. `STATUS.json`의 최종 상태는 다음 중 하나입니다.

- `approved_unpublished`: 구현자와 감사자가 합의했지만 아직 커밋·푸시하지 않음
- `needs_user`: 제품 선택이 필요함
- `max_rounds_reached`: 정해진 횟수 안에 합의하지 못함
- `failed`: CLI 실패, 시간 초과, 외부 커밋 또는 안전 규칙 위반

## 안전선

- Claude만 작업 파일을 수정하고 Codex는 `read-only` 샌드박스에서 감사합니다.
- AI는 격리된 detached worktree에서만 작업합니다. 현재 프로젝트의 미추적 파일과 진행 중인 화면은 복사되지 않습니다.
- 격리 작업 트리의 HEAD가 바뀌면 즉시 중단합니다. 일반적인 commit·push 명령은 도구 권한에서도 차단합니다.
- `.ai-coordination`의 로그에는 모델 응답이 들어갈 수 있으므로 공유하거나 커밋하지 않습니다.
- 기본 최대 3라운드, Claude 라운드당 5달러, 각 호출 45분입니다.
- 양측 합의는 증거이지 최종 진실이 아닙니다. 게시 전 실제 diff와 사용자 화면을 확인합니다.

승인된 변경을 게시한 뒤에는 `git worktree remove <STATUS.json의 worktree 경로>`로 격리 작업 트리를 정리할 수 있습니다. 미커밋 변경이 남아 있을 때 Git은 기본적으로 제거를 거부합니다.

강제 종료로 잠금 파일만 남았고 실행 중인 감독기가 없다는 것을 직접 확인한 경우에만 `--force-unlock`을 사용합니다.
