# 시뮬봇 시뮬레이터 (sim-simulator)

RisuAI 계열 봇카드(.charx / .png / .jpg / .json / .risum)를 브라우저에 드롭하면 내부 NPC·로어북·에셋·활성화 구조를 탐색할 수 있는 **완전 로컬 웹 도구**입니다.

- 카드 탐색은 완전 로컬입니다. 플레이 탭에서 BYOK를 설정한 경우에만, 사용자가 선택한 LLM 제공자(Gemini/OpenAI/Anthropic/호환 서버)로 대화·발동 로어북·상태 요약이 전송됩니다.
- 카드 재수출·재배포 기능 없음 (개인 플레이용 로컬 도구 포지셔닝).
- 임포트 탭은 카드 로어북 규칙을 게임 스키마 제안으로 컴파일합니다. 제안은 검증과 사용자 승인을 모두 통과해야 메모리상의 활성 엔진 스키마가 되며, 스키마 저장·다운로드·내보내기 버튼은 없습니다.

## 사용

호스팅된 페이지를 열거나, `app/dist/index.html`을 브라우저에서 직접(file://) 열어 카드를 드롭하세요.

## 빌드

```
cd app
npm install
npm run build    # → app/dist/index.html (자기완결 단일 HTML)
npm run deploy   # 빌드 + Firebase Hosting 배포 (firebase CLI 로그인 필요)
```

호스팅: https://simbot-simulator.web.app

## 구조

- `app/core/` — 카드 파싱·로어북 정규화/활성화 코어 ([LorebookExtractor](https://github.com/dootaang) 계보, 수정 없이 복사)
- `app/src/` — UI (Vanilla JS): 개요 / NPC 갤러리 / 로어북 / 활성화 시뮬 / 에셋 / 엔진 / 플레이 탭
- `SPEC-M0-card-playground.md`, `BACKLOG.md` — 기획·작업 문서

## 라이선스

GPL-3.0-or-later — [LICENSE](LICENSE) 참조.
