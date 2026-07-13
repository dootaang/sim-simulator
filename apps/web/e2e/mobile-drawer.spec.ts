import { expect, test } from '@playwright/test';

// 오너 실플레이 회귀: 모바일 드로어의 채팅 탭에 '새 채팅' 버튼이 아예 없었다(목록만 렌더).
// 데스크톱 사이드 패널과 동등한 조작(새 채팅·이름변경·삭제)이 모바일에도 있어야 한다.
test.use({ viewport: { width: 390, height: 844 } }); // iPhone 급 화면

test('모바일 앱바 → 드로어에서 카드·채팅에 도달한다', async ({ page }) => {
  await page.goto('/');
  // 앱바의 메뉴로 드로어를 연다(데스크톱 아바타 스트립은 이 폭에서 숨는다).
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await expect(page.getByRole('complementary', { name: '주 메뉴' })).toBeVisible();
  await page.getByRole('button', { name: /봇 목록/ }).click();
  await expect(page.getByRole('button', { name: '봇카드 가져오기', exact: true }).last()).toBeVisible();
  // 채팅 탭으로 전환 — 카드가 없으면 안내 문구가 뜬다.
  await page.getByRole('button', { name: '뒤로' }).click();
  await page.getByRole('button', { name: /채팅 목록/ }).click();
  await expect(page.getByText(/봇을 선택하면 채팅 목록/)).toBeVisible();
  // 설정 진입로가 모바일에 존재한다(예전엔 없어서 설정에 갈 방법이 아예 없었다).
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '설정 열기' })).toBeVisible();
});
