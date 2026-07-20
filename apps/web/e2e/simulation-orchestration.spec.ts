import { expect, test, type Page } from '@playwright/test';
import { normalizeCompiledSchema } from '@simbot/compiler';

const greeting = ['영업 준비가 끝났다.', ...Array.from({ length: 45 }, (_, index) => `준비 기록 ${index + 1}`)].join('\n\n');
const card = Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '오케스트레이션 카드', description: '여관 경영과 숙박 체크인', first_mes: greeting, mes_example: '', personality: '', scenario: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'test', character_version: '1', extensions: {}, group_only_greetings: [], character_book: { entries: [] }, assets: [] } }));
const raw = { meta: { id: 'orchestration-e2e' }, resources: { food: { label: '식자재', unit: '인분', min: 0, basePrice: 3000 } }, scales: [], ladders: [], entities: { facility: { instances: { tavern: { label: '주점', maxLevel: 2, upgradeCosts: { '2': 1000 } }, kitchen: { label: '주방', maxLevel: 2, upgradeCosts: { '2': 1000 } }, room: { label: '객실', maxLevel: 2, upgradeCosts: { '2': 1000 } }, quarters: { label: '직원 숙소', maxLevel: 2, upgradeCosts: { '2': 1000 } } } }, room: { instances: { '101': { kind: 'single', pricePerNight: 30000, capacity: 1, requiresRoomLevel: 1 } } }, menuItem: { instances: { stew: { name: '스튜', category: 'food', price: 5000, consumes: { food: 1 } } } } }, events: [], initialState: { day: 1, gold: 100000, resources: { food: 10 }, facilities: { tavern: 1, kitchen: 1, room: 1, quarters: 1 }, staff: [], rooms: {}, npcs: {}, player: {} } };
const schema = normalizeCompiledSchema(raw, ['genre.inn']).schema;
const compiled = { schema, moduleIds: ['genre.inn'], screens: [{ id: 'management', title: '여관 경영', layout: 'dashboard', regions: { main: [{ widget: 'inn-management' }] } }], navigation: [{ id: 'management', screenId: 'management', label: '여관 경영' }] };

async function seed(page: Page) {
  await page.route(/(?:sqlite3\.wasm|sqlite\.worker\.ts)/, route => route.abort());
  await page.addInitScript(() => localStorage.setItem('simbot.llm', JSON.stringify({ provider: 'custom', endpoint: 'http://127.0.0.1:4173/test-llm', model: 'test', apiKey: 'key', keepSimulationOpen: false })));
  await page.route('http://127.0.0.1:4173/test-llm', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '점심 영업이 활기차게 이어졌다.' } }] }) }); });
  await page.goto('/');
  await page.locator('input[accept=".simpack,.charx,.png,.json"]').setInputFiles({ name: 'orchestration.json', mimeType: 'application/json', buffer: card });
  await expect(page.getByText('영업 준비가 끝났다.')).toBeVisible();
  let projectId = '';
  await expect.poll(async () => projectId = await page.evaluate(async () => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('simbot-sessions', 1); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); const row = await new Promise<any>((resolve, reject) => { const request = db.transaction('sessions').objectStore('sessions').get('cardlib:index'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); db.close(); return String(row?.payload?.cards?.[0]?.projectId ?? ''); }), { timeout: 15_000 }).not.toBe('');
  await page.evaluate(async ({ artifact, id }) => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('simbot-sessions', 1); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); await new Promise<void>((resolve, reject) => { const request = db.transaction('sessions', 'readwrite').objectStore('sessions').put({ id: `cardlib:${id}:compiler`, schemaHash: 'cardlib-compiler', title: 'Engine compilation', updatedAt: Date.now(), payload: artifact }); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(); }); await new Promise<void>((resolve, reject) => { const store = db.transaction('sessions', 'readwrite').objectStore('sessions'), request = store.openCursor(); request.onerror = () => reject(request.error); request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(); return; } if (String(cursor.key).startsWith(`${id}:chat:`)) cursor.delete(); cursor.continue(); }; }); db.close(); }, { artifact: compiled, id: projectId });
  await page.reload();
}

async function openCard(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '현재 봇 메뉴' }).click();
  else if (await page.getByTitle('오케스트레이션 카드').count()) await page.getByTitle('오케스트레이션 카드').click();
  await page.getByRole('button', { name: '시뮬레이션 열기' }).click();
  await expect(page.getByRole('dialog', { name: '시뮬레이션' })).toBeVisible();
}

for (const item of [{ name: '데스크톱', viewport: { width: 1280, height: 800 }, mobile: false }, { name: '모바일', viewport: { width: 390, height: 844 }, mobile: true }]) test(`${item.name} 현장 행동은 (창 유지 끔 설정에서) 패널을 닫고 채팅 대기와 최신 응답으로 복귀한다`, async ({ page }) => {
  await page.setViewportSize(item.viewport); await page.addInitScript(()=>localStorage.setItem('simbot.sim.pinned','0')); await seed(page);
  await expect.poll(()=>page.evaluate(()=>{const bottom=document.querySelector<HTMLElement>('[data-chat-bottom]');let host=bottom?.parentElement??null;while(host&&host.scrollHeight<=host.clientHeight+1)host=host.parentElement;return host?host.scrollHeight-host.scrollTop-host.clientHeight:0;})).toBeLessThan(160);
  await openCard(page, item.mobile);
  await page.getByRole('dialog', { name: '시뮬레이션' }).getByRole('button', { name: '점심 영업' }).click();
  await expect(page.getByRole('dialog', { name: '시뮬레이션' })).toBeHidden();
  const typing = page.getByRole('article', { name: '응답 작성 중' }); await expect(typing).toBeVisible(); await expect(typing).not.toContainText('응답을 만들고 있습니다');
  const management = page.getByText('점심 영업이 활기차게 이어졌다.'); await expect(management).toBeVisible(); await expect(management).toBeInViewport();
  const scrollTop = () => page.evaluate(() => { const bottom = document.querySelector<HTMLElement>('[data-chat-bottom]'); let host = bottom?.parentElement ?? null; while (host && host.scrollHeight <= host.clientHeight + 1) host = host.parentElement; if (host) host.scrollTop = 0; });
  await scrollTop(); await page.getByRole('textbox', { name: '메시지를 입력하세요' }).fill('새 사용자 입력'); await page.getByRole('button', { name: '보내기', exact: true }).click(); await expect(typing).toBeVisible(); await expect(page.getByText('새 사용자 입력')).toBeInViewport();
  await scrollTop(); await expect(management).toHaveCount(2); await expect(management.last()).not.toBeInViewport(); await openCard(page, item.mobile);
  const dialog = page.getByRole('dialog', { name: '시뮬레이션' }); await dialog.getByRole('button', { name: '증축' }).first().click(); await expect(dialog).toBeVisible(); await expect(typing).toHaveCount(0);
});

test('완전 시뮬 카드는 계기판을 표시하고 별도 관리 진입 버튼으로 시뮬레이션을 연다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.addInitScript(()=>localStorage.setItem('simbot.sim.pinned','0')); await seed(page); if (await page.getByTitle('오케스트레이션 카드').count()) await page.getByTitle('오케스트레이션 카드').click();
  const hud = page.getByRole('status', { name: '엔진 계기판' }); await expect(hud).toBeVisible(); await expect(hud).toContainText('일차'); await expect(hud).toContainText('골드'); await expect(hud.getByRole('button', { name: '관리 화면 열기' })).toHaveCount(0);
  await page.getByRole('button', { name: '시뮬레이션 열기' }).click(); await expect(page.getByRole('dialog', { name: '시뮬레이션' })).toBeVisible();
});

test('넓은 화면(≥1200px)은 자동 핀 — 시뮬레이션이 우측 칼럼으로 열리고 해제하면 오버레이로 돌아간다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await seed(page); if (await page.getByTitle('오케스트레이션 카드').count()) await page.getByTitle('오케스트레이션 카드').click(); await page.getByRole('button', { name: '시뮬레이션 열기' }).click();
  // 저장된 선호가 없으면 1280px에서 핀이 기본값 — 클릭 없이 곧장 칼럼이어야 한다.
  const column = page.getByRole('complementary', { name: '시뮬레이션' }); await expect(page.getByRole('dialog', { name: '시뮬레이션' })).toHaveCount(0); await expect(column).toBeVisible(); await expect(page.getByRole('textbox', { name: '메시지를 입력하세요' })).toBeVisible(); await column.getByRole('button', { name: '점심 영업' }).click(); await expect(page.getByText('점심 영업이 활기차게 이어졌다.')).toBeVisible(); await expect(column).toBeVisible();
  await page.getByRole('button', { name: '시뮬레이션 고정 해제' }).click(); await expect(page.getByRole('dialog', { name: '시뮬레이션' })).toBeVisible(); await expect(await page.evaluate(() => localStorage.getItem('simbot.sim.pinned'))).toBe('0');
});

test('대기 중 영업이 채팅 안 결정 카드로 뜨고 처리하면 다음 결정으로 넘어간다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.addInitScript(()=>localStorage.setItem('simbot.sim.pinned','0')); await seed(page); if (await page.getByTitle('오케스트레이션 카드').count()) await page.getByTitle('오케스트레이션 카드').click(); const dock = page.getByRole('region', { name: '엔진 결정 카드' }); await expect(dock).toContainText('점심 영업 대기'); await dock.getByRole('button', { name: '영업 시작' }).click(); await expect(page.getByText('점심 영업이 활기차게 이어졌다.')).toBeVisible(); await expect(dock).toContainText('저녁 영업 대기'); await dock.getByRole('button', { name: '건너뛰기' }).click(); await expect(dock).toHaveCount(0);
});
