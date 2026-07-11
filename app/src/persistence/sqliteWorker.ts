// SPDX-License-Identifier: GPL-3.0-or-later
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Message = { id: number; type: string; payload?: any };
const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: Message }) => void) | null;
};

let db: any = null;
let health = { backend: 'sqlite-opfs', persistent: false, detail: 'not-initialized' };
let queue = Promise.resolve();

function locateFile(name: string): string {
  return new URL(name, import.meta.url).href;
}

function execRows(sql: string, bind: unknown[] = []): any[] {
  const rows: any[] = [];
  db.exec({ sql, bind, rowMode: 'object', callback: (row: any) => rows.push(row) });
  return rows;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function initialize(): Promise<typeof health> {
  if (db) return health;
  const init = sqlite3InitModule as unknown as (options?: { locateFile(name: string): string }) => Promise<any>;
  const sqlite3: any = await init({ locateFile });
  if (!sqlite3.oo1?.OpfsDb || !('opfs' in sqlite3)) throw new Error('sqlite_opfs_unavailable');
  db = new sqlite3.oo1.OpfsDb('/simbot-sessions.sqlite3');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      schema_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_schema_updated ON sessions(schema_hash, updated_at DESC);
    CREATE TABLE IF NOT EXISTS session_revisions (
      id TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      PRIMARY KEY(id, updated_at)
    );
    CREATE INDEX IF NOT EXISTS revisions_id_updated ON session_revisions(id, updated_at DESC);
  `);
  health = { backend: 'sqlite-opfs', persistent: true, detail: String(db.filename || '/simbot-sessions.sqlite3') };
  return health;
}

function rowToSession(row: any): any {
  if (!row) return null;
  const json = String(row.payload_json || '');
  if (hashText(json) !== String(row.payload_hash || '')) throw new Error(`sqlite_session_hash_mismatch:${row.id}`);
  return { id: String(row.id), schemaHash: String(row.schema_hash), title: String(row.title), updatedAt: Number(row.updated_at), payload: JSON.parse(json) };
}

function latestValidRevision(id: string): any {
  for (const row of execRows('SELECT * FROM session_revisions WHERE id=? ORDER BY updated_at DESC LIMIT 5', [id])) {
    try { return rowToSession(row); } catch (_) {}
  }
  return null;
}

function primaryOrRevision(row: any): any {
  if (!row) return null;
  try { return rowToSession(row); } catch (_) { return latestValidRevision(String(row.id)); }
}

async function handle(message: Message): Promise<any> {
  if (message.type === 'init') return initialize();
  await initialize();
  const payload = message.payload || {};
  if (message.type === 'put') {
    const json = JSON.stringify(payload.payload);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec({
        sql: `INSERT OR REPLACE INTO session_revisions(id,schema_hash,title,updated_at,payload_json,payload_hash) VALUES(?,?,?,?,?,?)`,
        bind: [String(payload.id), String(payload.schemaHash), String(payload.title || ''), Number(payload.updatedAt), json, hashText(json)],
      });
      db.exec({
        sql: `INSERT INTO sessions(id,schema_hash,title,updated_at,payload_json,payload_hash)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET schema_hash=excluded.schema_hash,title=excluded.title,
                updated_at=excluded.updated_at,payload_json=excluded.payload_json,payload_hash=excluded.payload_hash`,
        bind: [String(payload.id), String(payload.schemaHash), String(payload.title || ''), Number(payload.updatedAt), json, hashText(json)],
      });
      db.exec({
        sql: `DELETE FROM session_revisions WHERE id=? AND updated_at NOT IN
              (SELECT updated_at FROM session_revisions WHERE id=? ORDER BY updated_at DESC LIMIT 5)`,
        bind: [String(payload.id), String(payload.id)],
      });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
    return null;
  }
  if (message.type === 'get') return primaryOrRevision(execRows('SELECT * FROM sessions WHERE id=?', [String(payload.id)])[0]);
  if (message.type === 'getLatest') return primaryOrRevision(execRows('SELECT * FROM sessions WHERE schema_hash=? ORDER BY updated_at DESC,id ASC LIMIT 1', [String(payload.schemaHash)])[0]);
  if (message.type === 'list') return execRows('SELECT * FROM sessions ORDER BY updated_at DESC,id ASC').map(primaryOrRevision).filter(Boolean);
  if (message.type === 'delete') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec({ sql: 'DELETE FROM sessions WHERE id=?', bind: [String(payload.id)] });
      db.exec({ sql: 'DELETE FROM session_revisions WHERE id=?', bind: [String(payload.id)] });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
    return null;
  }
  if (message.type === 'close') { if (db) db.close(); db = null; return null; }
  throw new Error(`unknown_sqlite_worker_message:${message.type}`);
}

scope.onmessage = (event) => {
  const message = event.data;
  queue = queue.then(async () => {
    try { scope.postMessage({ id: message.id, ok: true, result: await handle(message) }); }
    catch (error) { scope.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
};
