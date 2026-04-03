import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'rzweb-analysis-cache';
const DB_VERSION = 1;
const STORE_NAME = 'analyses';
const MAX_CACHE_BYTES = 200 * 1024 * 1024;

export interface CachedAnalysis {
  hash: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  analysisDepth: number;
  dataSize: number;
  data: {
    functions: unknown[];
    strings: unknown[];
    imports: unknown[];
    exports: unknown[];
    sections: unknown[];
    info: unknown;
  };
}

export interface CacheStats {
  entryCount: number;
  totalBytes: number;
  entries: Array<{
    hash: string;
    fileName: string;
    fileSize: number;
    timestamp: number;
    dataSize: number;
  }>;
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
        store.createIndex('timestamp', 'timestamp');
      }
    },
  });
}

export async function computeFileHash(data: Uint8Array): Promise<string> {
  const buf = new Uint8Array(data).buffer as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedAnalysis(
  hash: string,
  analysisDepth: number
): Promise<CachedAnalysis | null> {
  try {
    const db = await getDB();
    const entry = await db.get(STORE_NAME, hash) as CachedAnalysis | undefined;

    if (!entry) return null;
    if (entry.analysisDepth < analysisDepth) return null;

    return entry;
  } catch {
    return null;
  }
}

export async function setCachedAnalysis(entry: CachedAnalysis): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, entry);
    await evictIfNeeded(db);
  } catch {
  }
}

async function evictIfNeeded(db: IDBPDatabase): Promise<void> {
  const all = await db.getAll(STORE_NAME) as CachedAnalysis[];
  let totalBytes = all.reduce((sum, e) => sum + e.dataSize, 0);

  if (totalBytes <= MAX_CACHE_BYTES) return;

  const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
  for (const entry of sorted) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    await db.delete(STORE_NAME, entry.hash);
    totalBytes -= entry.dataSize;
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME) as CachedAnalysis[];
    return {
      entryCount: all.length,
      totalBytes: all.reduce((sum, e) => sum + e.dataSize, 0),
      entries: all.map(e => ({
        hash: e.hash,
        fileName: e.fileName,
        fileSize: e.fileSize,
        timestamp: e.timestamp,
        dataSize: e.dataSize,
      })),
    };
  } catch {
    return { entryCount: 0, totalBytes: 0, entries: [] };
  }
}

export async function clearAnalysisCache(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch {
  }
}

export async function removeCachedAnalysis(hash: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, hash);
  } catch {
  }
}
