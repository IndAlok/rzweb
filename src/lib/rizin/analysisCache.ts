import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'rzweb-analysis-cache';
const DB_VERSION = 2;
const STORE_NAME = 'analyses';
const BINARY_STORE_NAME = 'binaries';
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
const CACHE_SCHEMA_VERSION = 7;

export interface CachedAnalysisSummary {
  hash: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  dataSize: number;
  analysisDepth: number;
  hasBinaryData: boolean;
}

export interface CachedAnalysis {
  schemaVersion?: number;
  hash: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  analysisDepth: number;
  dataSize: number;
  complete?: boolean;
  binaryData?: Uint8Array;
  projectData?: Uint8Array;
  data: {
    functions: unknown[];
    strings: unknown[];
    imports: unknown[];
    exports: unknown[];
    sections: unknown[];
    info: unknown;
    functionDetails?: Record<string, {
      disasm?: unknown;
      graph?: unknown;
      updatedAt: number;
    }>;
  };
}

// The binary is immutable per entry, so it lives in its own store and is written
// once and the frequently rewritten analysis/project record never reserializes it.
type StoredAnalysis = Omit<CachedAnalysis, 'binaryData'> & {
  schemaVersion: number;
  hasBinary: boolean;
};

interface StoredBinary {
  hash: string;
  data: Uint8Array;
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

function hasProjectData(entry: StoredAnalysis): boolean {
  return entry.projectData instanceof Uint8Array && entry.projectData.byteLength > 0;
}

function hasUsableInfoPayload(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
        store.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains(BINARY_STORE_NAME)) {
        db.createObjectStore(BINARY_STORE_NAME, { keyPath: 'hash' });
      }
    },
  });
}

async function deleteEntry(db: IDBPDatabase, hash: string): Promise<void> {
  await db.delete(STORE_NAME, hash);
  await db.delete(BINARY_STORE_NAME, hash);
}

async function attachBinary(db: IDBPDatabase, entry: StoredAnalysis): Promise<CachedAnalysis> {
  const binary = await db.get(BINARY_STORE_NAME, entry.hash) as StoredBinary | undefined;
  return { ...entry, binaryData: binary?.data };
}

export async function computeFileHash(data: Uint8Array): Promise<string> {
  const buf = new Uint8Array(data).buffer as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function isClearlyIncomplete(entry: StoredAnalysis): boolean {
  if ((entry.schemaVersion ?? 0) < CACHE_SCHEMA_VERSION) return true;
  if (entry.complete === false) return true;
  if (hasProjectData(entry)) return false;

  const { data } = entry;
  return (
    data.functions.length === 0 &&
    data.strings.length === 0 &&
    data.imports.length === 0 &&
    data.exports.length === 0 &&
    data.sections.length === 0 &&
    !hasUsableInfoPayload(data.info) &&
    Object.keys(data.functionDetails ?? {}).length === 0
  );
}

export async function getCachedAnalysis(
  hash: string,
  analysisDepth: number
): Promise<CachedAnalysis | null> {
  try {
    const db = await getDB();
    const entry = await db.get(STORE_NAME, hash) as StoredAnalysis | undefined;

    if (!entry) return null;
    if (entry.analysisDepth < analysisDepth) return null;
    if (isClearlyIncomplete(entry)) {
      await deleteEntry(db, hash);
      return null;
    }

    return attachBinary(db, entry);
  } catch {
    return null;
  }
}

export async function setCachedAnalysis(entry: CachedAnalysis): Promise<void> {
  try {
    const db = await getDB();
    const { binaryData, ...rest } = entry;

    const binaryAlreadyStored = (await db.count(BINARY_STORE_NAME, entry.hash)) > 0;
    const providedBinary =
      binaryData instanceof Uint8Array && binaryData.byteLength > 0 ? binaryData : null;

    if (!binaryAlreadyStored && providedBinary) {
      await db.put(BINARY_STORE_NAME, { hash: entry.hash, data: providedBinary });
    }

    const stored: StoredAnalysis = {
      ...rest,
      schemaVersion: CACHE_SCHEMA_VERSION,
      hasBinary: binaryAlreadyStored || providedBinary != null,
    };
    await db.put(STORE_NAME, stored);
    await evictIfNeeded(db);
  } catch {
    // IndexedDB writes are best-effort. Analysis still continues without a cache write.
  }
}

function toSummary(entry: StoredAnalysis): CachedAnalysisSummary {
  return {
    hash: entry.hash,
    fileName: entry.fileName,
    fileSize: entry.fileSize,
    timestamp: entry.timestamp,
    dataSize: entry.dataSize,
    analysisDepth: entry.analysisDepth,
    hasBinaryData: entry.hasBinary,
  };
}

async function evictIfNeeded(db: IDBPDatabase): Promise<void> {
  const all = await db.getAll(STORE_NAME) as StoredAnalysis[];
  let totalBytes = all.reduce((sum, e) => sum + e.dataSize, 0);

  if (totalBytes <= MAX_CACHE_BYTES) return;

  const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
  for (const entry of sorted) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    await deleteEntry(db, entry.hash);
    totalBytes -= entry.dataSize;
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME) as StoredAnalysis[];
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

export async function listCachedAnalyses(): Promise<CachedAnalysisSummary[]> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME) as StoredAnalysis[];
    return all
      .filter(entry => !isClearlyIncomplete(entry))
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(toSummary);
  } catch {
    return [];
  }
}

export async function getCachedAnalysisEntry(hash: string): Promise<CachedAnalysis | null> {
  try {
    const db = await getDB();
    const entry = await db.get(STORE_NAME, hash) as StoredAnalysis | undefined;
    if (!entry) {
      return null;
    }
    if (isClearlyIncomplete(entry)) {
      await deleteEntry(db, hash);
      return null;
    }
    return attachBinary(db, entry);
  } catch {
    return null;
  }
}

export async function clearAnalysisCache(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
    await db.clear(BINARY_STORE_NAME);
  } catch {
    // Ignore cache-clear failures and leave the current session untouched.
  }
}

export async function removeCachedAnalysis(hash: string): Promise<void> {
  try {
    const db = await getDB();
    await deleteEntry(db, hash);
  } catch {
    // Ignore delete failures. Stale entries are skipped when detected later.
  }
}
