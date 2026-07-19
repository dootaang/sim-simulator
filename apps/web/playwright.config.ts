import { defineConfig } from '@playwright/test';

const port=process.env.SIMBOT_E2E_PORT??'4173',baseURL=`http://127.0.0.1:${port}`;

// e2e는 vite dev 서버로 돌린다. 프리뷰(빌드 산출물)는 패키지 원본 모듈을 서빙하지 않아
// 브라우저에서 새니타이저를 직접 import해 검증할 수 없다 — XSS 테스트가 '모듈 로드 실패'로
// 조용히 죽는다(실제로 그렇게 죽어 있었다). dev 서버는 /@fs/ 경로로 소스를 서빙한다.
export default defineConfig({
  // 모든 파일이 같은 Vite 개발 서버와 OPFS/IndexedDB 초기화 경로를 공유한다. 파일 병렬 실행은
  // 제품 동시성 검증이 아니라 저장소 생성 경쟁을 만들어 단독 통과 시나리오를 간헐적으로 깨뜨렸다.
  testDir:'./e2e',timeout:60_000,fullyParallel:false,workers:1,
  use:{baseURL,trace:'retain-on-failure'},
  webServer:{command:`pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,url:baseURL,reuseExistingServer:process.env.SIMBOT_E2E_REUSE==='1',timeout:120_000},
  projects:[{name:'chromium',use:{browserName:'chromium'}}]
});
