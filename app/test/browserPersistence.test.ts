import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPlaySessionPersistence, createMemoryPlaySessionPersistence } from '../core/session/browserPersistence.ts';

test('browser persistence: memory 기준 구현은 최신 스키마 세션과 결정론 정렬을 제공한다', async () => {
  const store = createMemoryPlaySessionPersistence();
  await store.put({ id: 'b', schemaHash: 's1', title: '둘', updatedAt: 20, payload: { turn: 2 } });
  await store.put({ id: 'a', schemaHash: 's1', title: '하나', updatedAt: 10, payload: { turn: 1 } });
  await store.put({ id: 'c', schemaHash: 's2', title: '셋', updatedAt: 30, payload: { turn: 3 } });
  assert.equal((await store.getLatest('s1'))?.id, 'b');
  assert.deepEqual((await store.list()).map((row) => row.id), ['c', 'b', 'a']);
  const fetched = await store.get('b');
  (fetched!.payload as any).turn = 999;
  assert.deepEqual((await store.get('b'))?.payload, { turn: 2 });
  await store.delete('b');
  assert.equal(await store.get('b'), null);
});

class FakeWorker {
  listeners = { message: new Set<(event: any) => void>(), error: new Set<(event: any) => void>() };
  rows = new Map<string, any>();
  terminated = false;
  failPut = false;
  addEventListener(type: 'message' | 'error', listener: (event: any) => void) { this.listeners[type].add(listener); }
  removeEventListener(type: 'message' | 'error', listener: (event: any) => void) { this.listeners[type].delete(listener); }
  terminate() { this.terminated = true; }
  postMessage(message: any) {
    queueMicrotask(() => {
      if (message.type === 'put' && this.failPut) {
        for (const listener of this.listeners.message) listener({ data: { id: message.id, ok: false, error: 'opfs_write_failed' } });
        return;
      }
      let result: any = null;
      if (message.type === 'init') result = { backend: 'sqlite-opfs', persistent: true, detail: '/test.sqlite3' };
      if (message.type === 'put') this.rows.set(message.payload.id, structuredClone(message.payload));
      if (message.type === 'get') result = this.rows.get(message.payload.id) ?? null;
      if (message.type === 'getLatest') result = Array.from(this.rows.values()).filter((row) => row.schemaHash === message.payload.schemaHash).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      if (message.type === 'list') result = Array.from(this.rows.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      if (message.type === 'delete') this.rows.delete(message.payload.id);
      for (const listener of this.listeners.message) listener({ data: { id: message.id, ok: true, result } });
    });
  }
}

test('browser persistence: SQLite Worker RPC는 init 뒤 저장·복구·종료를 직렬화한다', async () => {
  const worker = new FakeWorker();
  const store = await createBrowserPlaySessionPersistence({ workerFactory: () => worker });
  assert.equal(store.health.backend, 'sqlite-opfs');
  assert.equal(store.health.persistent, true);
  await store.put({ id: 'play:s', schemaHash: 's', title: '세션', updatedAt: 1, payload: { contract: 'play-session/0.1' } });
  assert.equal((await store.getLatest('s'))?.id, 'play:s');
  await store.close();
  assert.equal(worker.terminated, true);
});

test('browser persistence: OPFS 쓰기 실패 시 같은 저장 요청을 fallback 저장소에 재시도한다', async () => {
  const worker = new FakeWorker();
  const store = await createBrowserPlaySessionPersistence({ workerFactory: () => worker });
  worker.failPut = true;
  await store.put({ id: 'play:fallback', schemaHash: 'f', title: '복구', updatedAt: 2, payload: { turn: 9 } });
  assert.equal(store.health.backend, 'memory'); // Node 테스트에는 IndexedDB가 없어 최종 안전망 사용
  assert.deepEqual((await store.get('play:fallback'))?.payload, { turn: 9 });
  assert.equal(worker.terminated, true);
});
