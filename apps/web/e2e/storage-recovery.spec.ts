import{expect,test}from'@playwright/test';

test('데이터·기억 설정은 카드·채팅 저장 사용량만 간결하게 보여준다',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('저장소를 여는 중…')).toHaveCount(0);
  await page.getByRole('button',{name:'전체 설정'}).click();
  const settings=page.getByRole('dialog',{name:'전체 설정'});
  await settings.getByRole('button',{name:'데이터·기억'}).click();
  await expect(settings.getByRole('group',{name:'내 카드·채팅 저장'})).toContainText('사용량');
  await expect(settings.getByText(/고속 브라우저 파일 저장|호환 저장소|영구 저장/)).toHaveCount(0);
  await expect(settings.getByText('삭제되었을 때 복구 방법')).toHaveCount(0);
});
