/*
 * Kissago client persistence validator.
 *
 * Usage:
 * 1. Open a loaded Kissago story in Chrome.
 * 2. Open DevTools > Console.
 * 3. Paste this entire file and press Enter.
 *
 * This script is read-only. Its report is also stored on
 * window.__kissagoPersistenceReport for further inspection.
 */

(async () => {
  const DB_NAME = 'kissago-story-persistence';
  const DB_VERSION = 1;
  const CACHE_NAME = 'kissago-story-media-v1';
  const FLAG_KEY = 'kissago_client_story_persistence_enabled';
  const EXPECTED_STORES = ['manifests', 'progress', 'media'];

  const checks = [];
  const addCheck = (status, check, details) => {
    checks.push({ status, check, details });
  };
  const pass = (check, details) => addCheck('PASS', check, details);
  const warn = (check, details) => addCheck('WARN', check, details);
  const fail = (check, details) => addCheck('FAIL', check, details);

  const requestResult = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });

  const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Unable to open ${DB_NAME}`));
  });

  const readStore = async (db, storeName) => {
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll());
  };

  console.group('Kissago client persistence validation');
  console.info('This validation does not modify or delete cached data.');

  const flagValue = localStorage.getItem(FLAG_KEY);
  if (flagValue === 'true') {
    pass('Feature flag', `${FLAG_KEY}=true`);
  } else if (flagValue === 'false') {
    fail('Feature flag', 'Persistence is disabled for this browser. Enable it in Global Settings, then reload.');
  } else {
    fail('Feature flag', 'No locally remembered flag value. Reload after enabling the server-side feature flag.');
  }

  if ('indexedDB' in window) {
    pass('IndexedDB support', 'Available');
  } else {
    fail('IndexedDB support', 'Unavailable in this browser/context');
  }

  if ('caches' in window) {
    pass('Cache Storage support', 'Available');
  } else {
    fail('Cache Storage support', 'Unavailable in this browser/context');
  }

  let databaseExists = true;
  if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    databaseExists = databases.some((database) => database.name === DB_NAME);
    if (databaseExists) {
      pass('Persistence database', DB_NAME);
    } else {
      fail('Persistence database', `${DB_NAME} does not exist. Open a story after enabling persistence.`);
    }
  }

  let manifests = [];
  let progress = [];
  let mediaRecords = [];

  if ('indexedDB' in window && databaseExists) {
    let db;
    try {
      db = await openDatabase();
      if (db.version === DB_VERSION) {
        pass('Database version', String(db.version));
      } else {
        fail('Database version', `Expected ${DB_VERSION}, found ${db.version}`);
      }

      const storeNames = Array.from(db.objectStoreNames);
      const missingStores = EXPECTED_STORES.filter((name) => !storeNames.includes(name));
      if (missingStores.length === 0) {
        pass('Object stores', EXPECTED_STORES.join(', '));
        [manifests, progress, mediaRecords] = await Promise.all([
          readStore(db, 'manifests'),
          readStore(db, 'progress'),
          readStore(db, 'media'),
        ]);
      } else {
        fail('Object stores', `Missing: ${missingStores.join(', ')}`);
      }
    } catch (error) {
      fail('Database read', error instanceof Error ? error.message : String(error));
    } finally {
      db?.close();
    }
  }

  if (manifests.length > 0) {
    pass('Cached manifests', `${manifests.length} record(s)`);
  } else {
    warn('Cached manifests', 'None found. Open or replay a story first.');
  }

  const invalidManifests = manifests.filter((record) => {
    const manifest = record.manifest;
    return !manifest
      || manifest.schemaVersion !== 1
      || !['story', 'explore', 'storyline'].includes(manifest.readerKind)
      || manifest.userId !== record.userId
      || manifest.storyId !== record.storyId
      || !Array.isArray(manifest.assets);
  });
  if (invalidManifests.length === 0 && manifests.length > 0) {
    pass('Manifest integrity', 'Schema, user, story, reader, and asset fields are valid');
  } else if (invalidManifests.length > 0) {
    fail('Manifest integrity', `${invalidManifests.length} invalid record(s)`);
  }

  if (progress.length > 0) {
    pass('Playback progress', `${progress.length} record(s)`);
  } else {
    warn('Playback progress', 'None found. Play or navigate a story, wait five seconds, then rerun.');
  }

  const invalidProgress = progress.filter((record) => {
    const value = record.progress;
    if (!value || value.userId !== record.userId || value.storyId !== record.storyId) return true;
    if (!Number.isFinite(value.audioTimeMs) || value.audioTimeMs < 0 || !value.updatedAt) return true;
    return value.readerKind === 'storyline'
      ? !Number.isInteger(value.currentPageIndex) || value.currentPageIndex < 0
      : typeof value.currentNodeId !== 'string' || value.currentNodeId.length === 0;
  });
  if (invalidProgress.length === 0 && progress.length > 0) {
    pass('Progress integrity', 'Reader position and audio timestamps are valid');
  } else if (invalidProgress.length > 0) {
    fail('Progress integrity', `${invalidProgress.length} invalid record(s)`);
  }

  const cacheNames = 'caches' in window ? await caches.keys() : [];
  const cacheExists = cacheNames.includes(CACHE_NAME);
  if (cacheExists) {
    pass('Media cache', CACHE_NAME);
  } else {
    warn('Media cache', `${CACHE_NAME} does not exist. Allow story media to finish loading, then rerun.`);
  }

  let cacheEntries = [];
  let missingCacheEntries = [];
  let unhealthyResponses = [];
  let orphanedCacheEntries = [];

  if (cacheExists) {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    const indexedCacheKeys = new Set(mediaRecords.map((record) => record.cacheKey));
    const requestUrls = new Set(requests.map((request) => request.url));

    cacheEntries = await Promise.all(requests.map(async (request) => {
      const response = await cache.match(request);
      const blob = response ? await response.clone().blob() : null;
      return {
        url: request.url,
        ok: Boolean(response?.ok),
        status: response?.status,
        contentType: response?.headers.get('content-type') || blob?.type || '(unknown)',
        bytes: blob?.size || 0,
      };
    }));

    missingCacheEntries = mediaRecords.filter((record) => !requestUrls.has(record.cacheKey));
    orphanedCacheEntries = cacheEntries.filter((entry) => !indexedCacheKeys.has(entry.url));
    unhealthyResponses = cacheEntries.filter((entry) => !entry.ok || entry.bytes === 0);

    if (mediaRecords.length > 0) {
      pass('Media index', `${mediaRecords.length} IndexedDB record(s)`);
    } else {
      warn('Media index', 'No media index records found');
    }

    if (cacheEntries.length > 0) {
      pass('Cached media responses', `${cacheEntries.length} response(s)`);
    } else {
      warn('Cached media responses', 'Cache exists but contains no media');
    }

    if (missingCacheEntries.length === 0 && mediaRecords.length > 0) {
      pass('Index to cache consistency', 'Every media index record has a cached response');
    } else if (missingCacheEntries.length > 0) {
      fail('Index to cache consistency', `${missingCacheEntries.length} indexed asset(s) are missing from Cache Storage`);
    }

    if (orphanedCacheEntries.length === 0 && cacheEntries.length > 0) {
      pass('Cache to index consistency', 'Every cached response has an IndexedDB media record');
    } else if (orphanedCacheEntries.length > 0) {
      warn('Cache to index consistency', `${orphanedCacheEntries.length} orphaned cached response(s)`);
    }

    if (unhealthyResponses.length === 0 && cacheEntries.length > 0) {
      pass('Cached response health', 'All cached responses are successful and non-empty');
    } else if (unhealthyResponses.length > 0) {
      fail('Cached response health', `${unhealthyResponses.length} empty or unsuccessful response(s)`);
    }
  }

  const manifestAssets = manifests.flatMap((record) => record.manifest?.assets || []);
  const mediaRecordKeys = new Set(mediaRecords.map((record) => record.key));
  const uncachedManifestAssets = manifestAssets.filter((asset) => {
    const key = [asset.userId, asset.assetId, asset.version].join(':');
    return !mediaRecordKeys.has(key);
  });

  if (manifestAssets.length > 0 && uncachedManifestAssets.length === 0) {
    pass('Manifest media coverage', `All ${manifestAssets.length} declared asset(s) are cached`);
  } else if (uncachedManifestAssets.length > 0) {
    warn(
      'Manifest media coverage',
      `${uncachedManifestAssets.length} of ${manifestAssets.length} declared asset(s) are not cached yet. Prefetch intentionally covers the current item plus the next two.`
    );
  }

  const currentId = location.pathname.match(/^\/(?:story|explore|storyline)\/([^/]+)/)?.[1];
  if (currentId) {
    const matchingManifest = manifests.find((record) => (
      record.storyId === currentId
      || record.manifest?.storylineId === currentId
      || record.manifest?.payload?.storylineId === currentId
    ));
    if (matchingManifest) {
      pass('Current page manifest', `${matchingManifest.readerKind}:${currentId}`);
    } else {
      warn('Current page manifest', `No manifest found for ${location.pathname}`);
    }
  } else {
    warn('Current page', 'Run this while viewing /story/:id, /explore/:id, or /storyline/:id for page-specific validation.');
  }

  const blobMedia = Array.from(document.querySelectorAll('img, audio, video, source'))
    .map((element) => element.currentSrc || element.src)
    .filter((source) => typeof source === 'string' && source.startsWith('blob:'));
  if (blobMedia.length > 0) {
    pass('Active blob media', `${blobMedia.length} DOM media element(s) currently use cached blob URLs`);
  } else {
    warn('Active blob media', 'No active DOM media element currently uses a blob URL. Start image/audio playback and rerun.');
  }

  let storageEstimate = null;
  if (navigator.storage?.estimate) {
    storageEstimate = await navigator.storage.estimate();
    const usage = storageEstimate.usage || 0;
    const quota = storageEstimate.quota || 0;
    const percent = quota > 0 ? (usage / quota) * 100 : 0;
    pass(
      'Storage estimate',
      `${(usage / 1024 / 1024).toFixed(2)} MiB of ${(quota / 1024 / 1024).toFixed(2)} MiB (${percent.toFixed(2)}%)`
    );
  }

  const totals = checks.reduce((result, check) => {
    result[check.status] += 1;
    return result;
  }, { PASS: 0, WARN: 0, FAIL: 0 });

  console.table(checks);
  if (manifests.length) console.table(manifests.map((record) => ({
    key: record.key,
    readerKind: record.readerKind,
    storyId: record.storyId,
    userId: record.userId,
    assets: record.manifest?.assets?.length || 0,
    lastOpenedAt: new Date(record.lastOpenedAt).toISOString(),
  })));
  if (progress.length) console.table(progress.map((record) => ({
    key: record.key,
    readerKind: record.readerKind,
    storyId: record.storyId,
    audioTimeMs: record.progress?.audioTimeMs,
    position: record.progress?.currentNodeId ?? record.progress?.currentPageIndex,
    updatedAt: record.progress?.updatedAt,
  })));
  if (cacheEntries.length) console.table(cacheEntries);

  const report = {
    generatedAt: new Date().toISOString(),
    totals,
    checks,
    manifests,
    progress,
    mediaRecords,
    cacheEntries,
    uncachedManifestAssets,
    missingCacheEntries,
    orphanedCacheEntries,
    unhealthyResponses,
    activeBlobUrls: blobMedia,
    storageEstimate,
  };

  window.__kissagoPersistenceReport = report;
  const summary = `${totals.PASS} passed, ${totals.WARN} warning(s), ${totals.FAIL} failed`;
  if (totals.FAIL > 0) {
    console.error(`Kissago persistence validation: ${summary}`);
  } else if (totals.WARN > 0) {
    console.warn(`Kissago persistence validation: ${summary}`);
  } else {
    console.info(`Kissago persistence validation: ${summary}`);
  }
  console.info('Full report: window.__kissagoPersistenceReport');
  console.groupEnd();
  return report;
})();
