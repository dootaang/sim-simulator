import { expect, test } from '@playwright/test';

test('긴 채팅은 보이는 대화만 그리며 과거를 읽을 때 새 메시지가 위치를 빼앗지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ mount }, { default: MessageList }, { PlaySession }, { ProjectRuntime }, { defaultCardPreset }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/player/MessageList.svelte'),
      import('/@fs/C:/freetalk/simbot-simulator/packages/session/src/index.ts'),
      import('/@fs/C:/freetalk/simbot-simulator/packages/runtime/src/index.ts'),
      import('/@fs/C:/freetalk/simbot-simulator/packages/risu/src/index.ts'),
    ]);
    let reply = 0;
    const session = new PlaySession({
      id: 'long-window',
      runtime: new ProjectRuntime({ projectId: 'long-window', schema: { initialState: {} }, screens: [], navigation: [], content: {}, featureToggles: {}, moduleIds: [] }),
      preset: defaultCardPreset(),
      card: { name: '긴 채팅' },
      provider: { async complete() { return { text: `답변 ${++reply}` }; } },
    });
    for (let index = 1; index <= 60; index += 1) await session.send(`질문 ${index}`);
    const host = document.createElement('main');
    host.style.cssText = 'height:844px;overflow-y:auto;display:flex;flex-direction:column';
    document.body.replaceChildren(host);
    mount(MessageList, { target: host, props: { session, version: 1, cardName: '긴 채팅', userName: '사용자', model: 'test', portraitFor: () => null, onchange: () => {} } });
    await new Promise(resolve => setTimeout(resolve, 300));
    const initialDomCount = host.querySelectorAll('.message').length;
    const initialHasLatest = host.textContent?.includes('답변 60') ?? false;
    host.scrollTop = 0;
    host.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 100));
    const topBeforeAppend = host.scrollTop;
    const topHasFirst = host.textContent?.includes('질문 1') ?? false;
    await session.send('과거를 읽는 중 추가');
    await new Promise(resolve => setTimeout(resolve, 100));
    const topAfterAppend = host.scrollTop;
    const finalDomCount = host.querySelectorAll('.message').length;
    const latestRect=host.querySelector<HTMLElement>('.latest-button')?.getBoundingClientRect()??null;
    return { total: session.messageCount, initialDomCount, finalDomCount, initialHasLatest, topHasFirst, topBeforeAppend, topAfterAppend,latestRect:latestRect?{left:latestRect.left,right:latestRect.right,width:latestRect.width}:null };
  });
  expect(result.total).toBe(122);
  expect(result.initialHasLatest).toBe(true);
  expect(result.topBeforeAppend).toBeLessThan(2);
  expect(result.topHasFirst).toBe(true);
  expect(result.initialDomCount).toBeLessThan(20);
  expect(result.finalDomCount).toBeLessThan(20);
  expect(Math.abs(result.topAfterAppend - result.topBeforeAppend)).toBeLessThan(2);
  expect(result.latestRect).not.toBeNull();
  expect(result.latestRect!.left).toBeGreaterThanOrEqual(12);
  expect(result.latestRect!.right).toBeLessThanOrEqual(378);
  expect(result.latestRect!.width).toBeLessThan(180);
});
