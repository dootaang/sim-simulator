// SPDX-License-Identifier: GPL-3.0-or-later
// 브라우저 세션 영구 저장 계약. SQLite/OPFS Worker를 우선하고 사용할 수 없는 환경은
// IndexedDB로 내려가서 자동 저장 자체가 사라지지 않게 한다.

export interface PersistedPlaySession {
  id: string;
  schemaHash: string;
  title: string;
  updatedAt: number;
  payload: unknown;
}

export interface PersistenceHealth {
  backend: 'sqlite-opfs' | 'indexeddb' | 'memory';
  persistent: boolean;
  detail?: string;
}

export interface PlaySessionPersistence {
  readonly health: PersistenceHealth;
  put(session: PersistedPlaySession): Promise<void>;
  get(id: string): Promise<PersistedPlaySession | null>;
  getLatest(schemaHash: string): Promise<PersistedPlaySession | null>;
  list(): Promise<PersistedPlaySession[]>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

interface RpcWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
}

type WorkerFactory = () => RpcWorker;

class SqliteWorkerPersistence implements PlaySessionPersistence {
  readonly health: PersistenceHealth;
  private worker: RpcWorker;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private onMessageBound: (event: any) => void;
  private onErrorBound: (event: any) => void;

  constructor(worker: RpcWorker, health: PersistenceHealth) {
    this.worker = worker;
    this.health = health;
    this.onMessageBound = (event) => this.onMessage(event);
    this.onErrorBound = (event) => this.onError(event);
    worker.addEventListener('message', this.onMessageBound);
    worker.addEventListener('error', this.onErrorBound);
  }

  private call(type: string, payload?: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sqlite_worker_timeout:${type}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, payload });
    });
  }

  private onMessage(event: any): void {
    const message = event?.data;
    const pending = this.pending.get(Number(message?.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(Number(message.id));
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(String(message.error || 'sqlite_worker_error')));
  }

  private onError(event: any): void {
    const error = new Error(String(event?.message || 'sqlite_worker_crashed'));
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async init(): Promise<PersistenceHealth> { return this.call('init'); }
  async put(session: PersistedPlaySession): Promise<void> { await this.call('put', session); }
  async get(id: string): Promise<PersistedPlaySession | null> { return this.call('get', { id }); }
  async getLatest(schemaHash: string): Promise<PersistedPlaySession | null> { return this.call('getLatest', { schemaHash }); }
  async list(): Promise<PersistedPlaySession[]> { return this.call('list'); }
  async delete(id: string): Promise<void> { await this.call('delete', { id }); }
  async close(): Promise<void> {
    try { await this.call('close'); } finally {
      this.worker.removeEventListener('message', this.onMessageBound);
      this.worker.removeEventListener('error', this.onErrorBound);
      this.worker.terminate();
    }
  }
}

class IndexedDbPersistence implements PlaySessionPersistence {
  readonly health: PersistenceHealth = { backend: 'indexeddb', persistent: true };
  private db: IDBDatabase;
  constructor(db: IDBDatabase) { this.db = db; }

  private transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sessions', mode);
      const fail = () => reject(tx.error || new Error('indexeddb_transaction_failed'));
      tx.addEventListener('abort', fail, { once: true });
      tx.addEventListener('error', fail, { once: true });
      run(tx.objectStore('sessions'), resolve, reject);
    });
  }

  async put(session: PersistedPlaySession): Promise<void> {
    await this.transaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.put(session);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error || new Error('indexeddb_put_failed'));
    });
  }
  async get(id: string): Promise<PersistedPlaySession | null> {
    return this.transaction('readonly', (store, resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as PersistedPlaySession | undefined) ?? null);
      request.onerror = () => reject(request.error || new Error('indexeddb_get_failed'));
    });
  }
  async getLatest(schemaHash: string): Promise<PersistedPlaySession | null> {
    const rows = await this.transaction<PersistedPlaySession[]>('readonly', (store, resolve, reject) => {
      const request = store.index('schemaHash').getAll(schemaHash);
      request.onsuccess = () => resolve(request.result as PersistedPlaySession[]);
      request.onerror = () => reject(request.error || new Error('indexeddb_query_failed'));
    });
    return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0] ?? null;
  }
  async list(): Promise<PersistedPlaySession[]> {
    const rows = await this.transaction<PersistedPlaySession[]>('readonly', (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as PersistedPlaySession[]);
      request.onerror = () => reject(request.error || new Error('indexeddb_list_failed'));
    });
    return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  async delete(id: string): Promise<void> {
    await this.transaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error || new Error('indexeddb_delete_failed'));
    });
  }
  async close(): Promise<void> { this.db.close(); }
}

class ResilientPersistence implements PlaySessionPersistence {
  private active: PlaySessionPersistence;
  private fallbackPromise: Promise<PlaySessionPersistence> | null = null;
  constructor(primary: PlaySessionPersistence) { this.active = primary; }
  get health(): PersistenceHealth { return this.active.health; }
  private async fallback(): Promise<PlaySessionPersistence> {
    if (!this.fallbackPromise) this.fallbackPromise = openIndexedDb().catch(() => createMemoryPlaySessionPersistence());
    const next = await this.fallbackPromise;
    if (this.active !== next) { try { await this.active.close(); } catch (_) {} this.active = next; }
    return next;
  }
  private async run<T>(operation: (store: PlaySessionPersistence) => Promise<T>): Promise<T> {
    try { return await operation(this.active); }
    catch (_) { return operation(await this.fallback()); }
  }
  async put(session: PersistedPlaySession): Promise<void> { await this.run((store) => store.put(session)); }
  async get(id: string): Promise<PersistedPlaySession | null> { return this.run((store) => store.get(id)); }
  async getLatest(schemaHash: string): Promise<PersistedPlaySession | null> { return this.run((store) => store.getLatest(schemaHash)); }
  async list(): Promise<PersistedPlaySession[]> { return this.run((store) => store.list()); }
  async delete(id: string): Promise<void> { await this.run((store) => store.delete(id)); }
  async close(): Promise<void> { await this.active.close(); }
}

export function createMemoryPlaySessionPersistence(): PlaySessionPersistence {
  const rows = new Map<string, PersistedPlaySession>();
  return {
    health: { backend: 'memory', persistent: false, detail: 'test-or-last-resort' },
    async put(session) { rows.set(session.id, structuredClone(session)); },
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id)!) : null; },
    async getLatest(schemaHash) {
      return Array.from(rows.values()).filter((row) => row.schemaHash === schemaHash)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map((row) => structuredClone(row))[0] ?? null;
    },
    async list() { return Array.from(rows.values()).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map((row) => structuredClone(row)); },
    async delete(id) { rows.delete(id); },
    async close() {},
  };
}

async function openIndexedDb(): Promise<PlaySessionPersistence> {
  if (typeof indexedDB === 'undefined') return createMemoryPlaySessionPersistence();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('simbot-sessions', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains('sessions')
        ? request.transaction!.objectStore('sessions')
        : db.createObjectStore('sessions', { keyPath: 'id' });
      if (!store.indexNames.contains('schemaHash')) store.createIndex('schemaHash', 'schemaHash', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
  });
  return new IndexedDbPersistence(db);
}

export async function createBrowserPlaySessionPersistence(options: {
  workerFactory?: WorkerFactory;
  workerUrl?: string;
} = {}): Promise<PlaySessionPersistence> {
  if (typeof Worker !== 'undefined' || options.workerFactory) {
    let sqlite: SqliteWorkerPersistence | null = null;
    try {
      const worker = options.workerFactory
        ? options.workerFactory()
        : new Worker(options.workerUrl ?? './sqlite-worker.js', { type: 'module', name: 'simbot-sqlite' }) as unknown as RpcWorker;
      sqlite = new SqliteWorkerPersistence(worker, { backend: 'sqlite-opfs', persistent: false });
      const health = await sqlite.init();
      if (health?.persistent) return new ResilientPersistence(Object.assign(sqlite, { health }));
      await sqlite.close();
    } catch (_) {
      if (sqlite) try { await sqlite.close(); } catch (_) {}
    }
  }
  try { return await openIndexedDb(); } catch (_) { return createMemoryPlaySessionPersistence(); }
}
