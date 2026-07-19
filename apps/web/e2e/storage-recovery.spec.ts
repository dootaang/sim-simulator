import{expect,test}from'@playwright/test';

test('설정에서 실제 저장 방식과 삭제 범위별 복구 방법을 확인한다',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('저장소를 여는 중…')).toHaveCount(0);
  await page.getByRole('button',{name:'전체 설정'}).click();
  const settings=page.getByRole('dialog',{name:'전체 설정'});
  await settings.getByRole('button',{name:'기타'}).click();
  await expect(settings.getByText(/고속 브라우저 파일 저장|호환 저장소/)).toBeVisible();
  await settings.getByText('삭제되었을 때 복구 방법').click();
  await expect(settings.getByText(/빠른 이미지 캐시만 삭제/)).toBeVisible();
  await expect(settings.getByText(/사이트 데이터 전체 삭제/)).toBeVisible();
  await expect(settings.getByText(/백업과 원본 파일도 없음/)).toBeVisible();
});
