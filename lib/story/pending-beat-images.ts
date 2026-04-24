export interface PendingBeatImageRecord {
  key: string;
  storyId: string;
  userId: string;
  nodeId: string;
  imageDataUrl: string;
  createdAt: number;
  updatedAt: number;
  attemptCount: number;
  lastError: string | null;
}

const DB_NAME = 'kissago-story-media';
const DB_VERSION = 1;
const STORE_NAME = 'pending-beat-images';
const STORY_INDEX = 'by_story_id';

function getRecordKey(storyId: string, nodeId: string): string {
  return `${storyId}:${nodeId}`;
}

function getIndexedDbFactory(): IDBFactory | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.indexedDB ?? null;
}

function openPendingBeatImageDb(): Promise<IDBDatabase | null> {
  const indexedDb = getIndexedDbFactory();
  if (!indexedDb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex(STORY_INDEX, 'storyId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open pending beat image database'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T
): Promise<T | null> {
  const db = await openPendingBeatImageDb();
  if (!db) {
    return null;
  }

  return new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let settled = false;

    transaction.oncomplete = () => {
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.close();
      resolve(null);
    };

    transaction.onerror = () => {
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.close();
      reject(transaction.error || new Error('Pending beat image transaction failed'));
    };

    Promise.resolve(callback(store))
      .then((result) => {
        transaction.oncomplete = () => {
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          db.close();
          resolve(result);
        };
      })
      .catch((error) => {
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        transaction.abort();
        db.close();
        reject(error);
      });
  });
}

export async function putPendingBeatImage(
  input: Omit<PendingBeatImageRecord, 'key' | 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError'>
): Promise<PendingBeatImageRecord | null> {
  const existing = await getPendingBeatImage(input.storyId, input.nodeId);

  // Idempotent: if the same image data is already staged, don't bump updatedAt.
  // Bumping it would invalidate an in-flight drain that keyed its optimistic-concurrency
  // check on the original updatedAt, causing the drain to discard a successful upload.
  if (existing && existing.imageDataUrl === input.imageDataUrl) {
    return existing;
  }

  const nextRecord: PendingBeatImageRecord = {
    key: getRecordKey(input.storyId, input.nodeId),
    storyId: input.storyId,
    userId: input.userId,
    nodeId: input.nodeId,
    imageDataUrl: input.imageDataUrl,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    attemptCount: 0,
    lastError: null,
  };

  await withStore('readwrite', (store) => {
    store.put(nextRecord);
  });

  return nextRecord;
}

export async function getPendingBeatImage(storyId: string, nodeId: string): Promise<PendingBeatImageRecord | null> {
  const key = getRecordKey(storyId, nodeId);
  const result = await withStore<PendingBeatImageRecord | undefined>('readonly', (store) => {
    return new Promise<PendingBeatImageRecord | undefined>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as PendingBeatImageRecord | undefined);
      request.onerror = () => reject(request.error || new Error('Failed to read pending beat image'));
    });
  });

  return result ?? null;
}

export async function listPendingBeatImagesForStory(storyId: string): Promise<PendingBeatImageRecord[]> {
  const result = await withStore<PendingBeatImageRecord[]>('readonly', (store) => {
    return new Promise<PendingBeatImageRecord[]>((resolve, reject) => {
      const index = store.index(STORY_INDEX);
      const request = index.getAll(storyId);
      request.onsuccess = () => resolve((request.result as PendingBeatImageRecord[] | undefined) || []);
      request.onerror = () => reject(request.error || new Error('Failed to list pending beat images'));
    });
  });

  return result ?? [];
}

export async function updatePendingBeatImageAttempt(
  storyId: string,
  nodeId: string,
  lastError: string | null,
  expectedUpdatedAt?: number
): Promise<{ record: PendingBeatImageRecord | null; updated: boolean }> {
  const existing = await getPendingBeatImage(storyId, nodeId);
  if (!existing) {
    return { record: null, updated: false };
  }
  if (typeof expectedUpdatedAt === 'number' && existing.updatedAt !== expectedUpdatedAt) {
    return { record: existing, updated: false };
  }

  const nextRecord: PendingBeatImageRecord = {
    ...existing,
    updatedAt: Date.now(),
    attemptCount: existing.attemptCount + 1,
    lastError,
  };

  await withStore('readwrite', (store) => {
    store.put(nextRecord);
  });

  return { record: nextRecord, updated: true };
}

export async function deletePendingBeatImage(
  storyId: string,
  nodeId: string,
  expectedUpdatedAt?: number
): Promise<void> {
  if (typeof expectedUpdatedAt === 'number') {
    const existing = await getPendingBeatImage(storyId, nodeId);
    if (!existing || existing.updatedAt !== expectedUpdatedAt) {
      return;
    }
  }

  const key = getRecordKey(storyId, nodeId);
  await withStore('readwrite', (store) => {
    store.delete(key);
  });
}
