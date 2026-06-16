import type { CachedStoryManifest, StoryProgress, StoryReaderKind } from './types';

const DB_NAME = 'kissago-story-persistence';
const DB_VERSION = 1;
export const MANIFEST_STORE = 'manifests';
export const PROGRESS_STORE = 'progress';
export const MEDIA_STORE = 'media';

export interface ManifestRecord {
  key: string;
  userId: string;
  storyId: string;
  readerKind: StoryReaderKind;
  lastOpenedAt: number;
  manifest: CachedStoryManifest;
}

export interface ProgressRecord {
  key: string;
  userId: string;
  storyId: string;
  readerKind: StoryReaderKind;
  progress: StoryProgress;
}

export interface MediaRecord {
  key: string;
  userId: string;
  storyId: string;
  assetId: string;
  version: string;
  cacheKey: string;
  byteSize: number;
  cachedAt: number;
  lastAccessedAt: number;
}

export function manifestRecordKey(input: {
  userId: string;
  storyId: string;
  readerKind: StoryReaderKind;
  storylineId?: string;
}): string {
  return [input.userId, input.readerKind, input.storylineId ?? input.storyId].join(':');
}

export function progressRecordKey(input: {
  userId: string;
  storyId: string;
  readerKind: StoryReaderKind;
  storylineId?: string;
}): string {
  return manifestRecordKey(input);
}

function getFactory(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

export function openPersistenceDb(): Promise<IDBDatabase | null> {
  const factory = getFactory();
  if (!factory) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
        const store = db.createObjectStore(MANIFEST_STORE, { keyPath: 'key' });
        store.createIndex('by_user', 'userId', { unique: false });
        store.createIndex('by_user_last_opened', ['userId', 'lastOpenedAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        const store = db.createObjectStore(PROGRESS_STORE, { keyPath: 'key' });
        store.createIndex('by_user', 'userId', { unique: false });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
        store.createIndex('by_user', 'userId', { unique: false });
        store.createIndex('by_story', ['userId', 'storyId'], { unique: false });
        store.createIndex('by_user_last_accessed', ['userId', 'lastAccessedAt'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open story persistence database'));
  });
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await openPersistenceDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openPersistenceDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openPersistenceDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function idbGetAll<T>(storeName: string, indexName?: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
  const db = await openPersistenceDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const source: IDBObjectStore | IDBIndex = indexName
      ? tx.objectStore(storeName).index(indexName)
      : tx.objectStore(storeName);
    const request = source.getAll(query);
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deletePersistenceDatabaseForTests(): Promise<void> {
  const factory = getFactory();
  if (!factory) return;
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
