# 시뮬봇 시뮬레이터 (sim-simulator)

RisuAI 계열 봇카드(.charx / .png / .jpg / .json / .risum)를 브라우저에 드롭하면 내부 NPC·로어북·에셋·활성화 구조를 탐색할 수 있는 **완전 로컬 웹 도구**입니다.

- 서버·LLM·네트워크 요청 없음 — 카드 파일은 브라우저 메모리 안에서만 처리되며 어디로도 전송되지 않습니다.
- 카드 재수출·재배포 기능 없음 (개인 플레이용 로컬 도구 포지셔닝).

## 사용

호스팅된 페이지를 열거나, `app/dist/index.html`을 브라우저에서 직접(file://) 열어 카드를 드롭하세요.

## 빌드

```
cd app
npm install
npm run build    # → app/dist/index.html (자기완결 단일 HTML)
npm run deploy   # 빌드 + Firebase Hosting 배포 (firebase CLI 로그인 필요)
```

호스팅: https://sim-simulator-d1330.web.app

## 구조

- `app/core/` — 카드 파싱·로어북 정규화/활성화 코어 ([LorebookExtractor](https://github.com/dootaang) 계보, 수정 없이 복사)
- `app/src/` — UI (Vanilla JS): 개요 / NPC 갤러리 / 로어북 / 활성화 시뮬 / 에셋 탭
- `SPEC-M0-card-playground.md`, `BACKLOG.md` — 기획·작업 문서

## 라이선스

GPL-3.0-or-later — [LICENSE](LICENSE) 참조.
