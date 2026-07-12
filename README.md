# SimBot Simulator

봇 카드를 장기 세션용 시뮬레이션으로 만드는 노코드 메이커 겸 플레이어입니다. LLM은 서사를 쓰고, 수치·판정·선택지·상태는 결정론적 TypeScript 엔진이 소유합니다.

## 현재 구조

- `apps/web` — Svelte 5 플레이어와 편집기
- `packages/kernel` — 결정론적 RNG, 상태 생성, 모듈 레지스트리
- `packages/modules` — 공통 RPG·전투·헌터·여관 장르 규칙
- `packages/card` — JSON·PNG·CharX·Risum 카드 파서
- `packages/compiler` — 근거 기반 SimPack 초안 컴파일러
- `packages/risu` — 페르소나·프롬프트·로어북·안전 정규식 호환 계층
- `packages/session` — 장기 채팅, 엔진 이벤트 검증, 기억 조립
- `packages/memory` — 근거·유효기간·범위를 갖는 lexical/Voyage 혼합 검색
- `packages/persistence` — SQLite WASM + OPFS Worker, IndexedDB fallback
- `packages/simpack` — 이식 가능한 프로젝트 컨테이너

## 개발

```bash
pnpm install
pnpm check
pnpm dev
```

프로덕션 산출물은 `apps/web/dist`에 생성됩니다. `pnpm deploy`는 이 디렉터리를 Firebase Hosting에 배포합니다.

## 안전 원칙

- 카드의 산문만으로 장르 실행 모듈을 자동 설치하지 않습니다.
- LLM이 제안한 미등록 이벤트와 임의 수치는 적용하지 않습니다.
- 엔진 결과만 승인 기억이 되며, 서사에서 추출한 기억은 승인 전까지 검색되지 않습니다.
- Lua·CJS·MCP·저수준 trigger는 보존·진단할 수 있지만 자동 실행하지 않습니다.

라이선스와 외부 프로젝트의 출처는 [THIRD_PARTY_PROVENANCE.md](docs/THIRD_PARTY_PROVENANCE.md)를 참고하세요.
