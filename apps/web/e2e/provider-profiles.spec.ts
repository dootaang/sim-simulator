import{expect,test}from'@playwright/test';

// 프로바이더별 자격 프로필 — 키·주소가 프로바이더를 넘나들며 새지 않고, 전환 왕복에 각자 복원된다.
test('프로바이더를 바꾸면 API 키가 각자 저장·복원된다',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'전체 설정'}).click();
  const key=page.getByLabel(/API 키|서비스 계정 JSON|GitHub OAuth 토큰/);
  const provider=page.getByLabel('AI 서비스');
  // Vertex에 서비스 계정 JSON을 넣는다
  await provider.selectOption('vertex');
  await key.fill('{"vertex":"service-account"}');
  // OpenAI로 전환 — Vertex 정보가 따라오면 안 된다
  await provider.selectOption('openai');
  await expect(key).toHaveValue('');
  await key.fill('sk-openai-test');
  // Ollama로 전환 — 역시 빈 칸에서 시작(로컬은 무키)
  await provider.selectOption('ollama');
  await expect(key).toHaveValue('');
  // Vertex로 복귀 — 원래 JSON이 복원된다
  await provider.selectOption('vertex');
  await expect(key).toHaveValue('{"vertex":"service-account"}');
  // OpenAI로 복귀 — sk 키 복원
  await provider.selectOption('openai');
  await expect(key).toHaveValue('sk-openai-test');
  // 저장 후 재로드해도 프로필이 살아 있다
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'전체 설정'}).click();
  await expect(page.getByLabel('AI 서비스')).toHaveValue('openai');
  await expect(page.getByLabel(/API 키/)).toHaveValue('sk-openai-test');
});
