// SPDX-License-Identifier: GPL-3.0-or-later
import type { Persona, PromptPreset } from './contracts';

export interface CompatibilityLibrary {
  listPersonas(): Promise<Persona[]>;
  putPersona(persona: Persona): Promise<void>;
  deletePersona(id: string): Promise<void>;
  listPresets(): Promise<PromptPreset[]>;
  putPreset(preset: PromptPreset): Promise<void>;
  deletePreset(id: string): Promise<void>;
}

export async function createCompatibilityLibrary(): Promise<CompatibilityLibrary> {
  if (typeof indexedDB === 'undefined') return memoryLibrary();
  const db = await openDb();
  return {
    listPersonas: () => listStore<Persona>(db, 'personas'),
    putPersona: (value) => putStore(db, 'personas', value),
    deletePersona: (id) => deleteStore(db, 'personas', id),
    listPresets: () => listStore<PromptPreset>(db, 'presets'),
    putPreset: (value) => putStore(db, 'presets', value),
    deletePreset: (id) => deleteStore(db, 'presets', id),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('simbot-compatibility-library', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('personas')) db.createObjectStore('personas', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Compatibility library open failed'));
  });
}

function listStore<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return requestOf<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll()).then((items) => items.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))));
}
function putStore(db: IDBDatabase, store: string, value: unknown): Promise<void> { return requestOf(db.transaction(store, 'readwrite').objectStore(store).put(clone(value))).then(() => undefined); }
function deleteStore(db: IDBDatabase, store: string, id: string): Promise<void> { return requestOf(db.transaction(store, 'readwrite').objectStore(store).delete(id)).then(() => undefined); }
function requestOf<T = unknown>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('IndexedDB request failed')); }); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function memoryLibrary(): CompatibilityLibrary {
  const personas = new Map<string, Persona>(); const presets = new Map<string, PromptPreset>();
  return {
    async listPersonas() { return Array.from(personas.values(), clone); },
    async putPersona(value) { personas.set(value.id, clone(value)); }, async deletePersona(id) { personas.delete(id); },
    async listPresets() { return Array.from(presets.values(), clone); },
    async putPreset(value) { presets.set(value.id, clone(value)); }, async deletePreset(id) { presets.delete(id); },
  };
}

