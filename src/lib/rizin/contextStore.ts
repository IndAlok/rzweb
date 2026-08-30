import { openDB, type IDBPDatabase } from 'idb';
import {
  getCachedAnalysisEntry,
  listCachedAnalyses,
  computeFileHash,
} from './analysisCache';
import type {
  ContextRevision,
  RevisionReason,
  RzwebContext,
  StoredArtifact,
} from '../context/types';

const DB_NAME = 'rzweb-contexts';
const DB_VERSION = 1;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_REVISIONS = 10;

interface StoredContext extends Omit<RzwebContext, never> {
  id: string;
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('artifacts')) {
        db.createObjectStore('artifacts', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('contexts')) {
        const contexts = db.createObjectStore('contexts', { keyPath: 'id' });
        contexts.createIndex('artifactHash', 'artifactHash');
        contexts.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('revisions')) {
        const revisions = db.createObjectStore('revisions', { keyPath: 'id' });
        revisions.createIndex('contextId', 'contextId');
      }
      if (!db.objectStoreNames.contains('analysisIndex')) {
        db.createObjectStore('analysisIndex', { keyPath: 'contextId' });
      }
    },
  });
}

let migrated = false;

async function readAllContexts(): Promise<RzwebContext[]> {
  try {
    const db = await getDB();
    const all = (await db.getAll('contexts')) as StoredContext[];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function migrateLegacyCache(): Promise<void> {
  if (migrated) return;
  migrated = true;
  try {
    const existing = await readAllContexts();
    if (existing.length > 0) return;
    const summaries = await listCachedAnalyses();
    for (const summary of summaries) {
      const cached = await getCachedAnalysisEntry(summary.hash);
      if (!cached?.binaryData || cached.binaryData.byteLength === 0) continue;
      await createContext({
        name: cached.fileName,
        data: cached.binaryData,
        analysisDepth: cached.analysisDepth,
        rzdb: cached.projectData,
        id: crypto.randomUUID(),
      });
    }
  } catch {
    migrated = false;
  }
}

export async function listContexts(): Promise<RzwebContext[]> {
  await migrateLegacyCache();
  return readAllContexts();
}

export async function putArtifact(fileName: string, data: Uint8Array): Promise<StoredArtifact> {
  const hash = await computeFileHash(data);
  const db = await getDB();
  const artifact: StoredArtifact = { hash, data, fileName, fileSize: data.byteLength };
  await db.put('artifacts', artifact);
  return artifact;
}

export async function getArtifact(hash: string): Promise<StoredArtifact | undefined> {
  const db = await getDB();
  return db.get('artifacts', hash) as Promise<StoredArtifact | undefined>;
}

export async function createContext(params: {
  name: string;
  data: Uint8Array;
  analysisDepth?: number;
  rzdb?: Uint8Array;
  id?: string;
}): Promise<RzwebContext> {
  const artifact = await putArtifact(params.name, params.data);
  const now = Date.now();
  const id = params.id ?? crypto.randomUUID();
  const context: StoredContext = {
    id,
    name: params.name,
    artifactHash: artifact.hash,
    fileSize: artifact.fileSize,
    currentRevisionId: null,
    job: 'idle',
    analysisDepth: params.analysisDepth ?? 2,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDB();
  await db.put('contexts', context);
  if (params.rzdb && params.rzdb.byteLength > 0) {
    await commitRevision(id, params.rzdb, 'open');
  }
  await evictIfNeeded();
  return (await getContext(id)) ?? context;
}

export async function listContextsForHash(hash: string): Promise<RzwebContext[]> {
  const all = await listContexts();
  return all.filter((ctx) => ctx.artifactHash === hash);
}

export async function getContext(id: string): Promise<RzwebContext | undefined> {
  const db = await getDB();
  return db.get('contexts', id) as Promise<RzwebContext | undefined>;
}

export async function updateContext(
  id: string,
  patch: Partial<Pick<RzwebContext, 'name' | 'job' | 'analysisDepth' | 'currentRevisionId'>>
): Promise<void> {
  const db = await getDB();
  const current = (await db.get('contexts', id)) as StoredContext | undefined;
  if (!current) return;
  await db.put('contexts', { ...current, ...patch, updatedAt: Date.now() });
}

export async function deleteContext(id: string): Promise<void> {
  const db = await getDB();
  const ctx = (await db.get('contexts', id)) as StoredContext | undefined;
  const revisions = await listRevisions(id);
  for (const rev of revisions) {
    await db.delete('revisions', rev.id);
  }
  await db.delete('analysisIndex', id);
  await db.delete('contexts', id);
  if (ctx) {
    const remaining = (await readAllContexts()).filter((item) => item.artifactHash === ctx.artifactHash);
    if (remaining.length === 0) {
      await db.delete('artifacts', ctx.artifactHash);
    }
  }
}

export async function commitRevision(
  contextId: string,
  rzdb: Uint8Array,
  reason: RevisionReason
): Promise<ContextRevision | null> {
  if (!rzdb || rzdb.byteLength === 0) return null;
  const db = await getDB();
  const ctx = (await db.get('contexts', contextId)) as StoredContext | undefined;
  if (!ctx) return null;

  const revision: ContextRevision = {
    id: crypto.randomUUID(),
    contextId,
    parentId: ctx.currentRevisionId,
    reason,
    createdAt: Date.now(),
    rzdb,
  };
  await db.put('revisions', revision);
  await db.put('contexts', {
    ...ctx,
    currentRevisionId: revision.id,
    updatedAt: Date.now(),
  });

  const all = await listRevisions(contextId);
  if (all.length > MAX_REVISIONS) {
    const drop = all.slice(MAX_REVISIONS);
    for (const old of drop) {
      await db.delete('revisions', old.id);
    }
  }
  await evictIfNeeded();
  return revision;
}

export async function listRevisions(contextId: string): Promise<ContextRevision[]> {
  const db = await getDB();
  const all = (await db.getAllFromIndex('revisions', 'contextId', contextId)) as ContextRevision[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRevisionMeta(
  contextId: string
): Promise<Array<Omit<ContextRevision, 'rzdb'>>> {
  const all = await listRevisions(contextId);
  return all.map((rev) => ({
    id: rev.id,
    contextId: rev.contextId,
    parentId: rev.parentId,
    reason: rev.reason,
    createdAt: rev.createdAt,
  }));
}

export async function restoreRevision(
  contextId: string,
  revisionId: string
): Promise<ContextRevision | null> {
  const rev = await getRevision(revisionId);
  if (!rev || rev.contextId !== contextId) return null;
  return commitRevision(contextId, rev.rzdb, 'manual');
}

export async function getRevision(id: string): Promise<ContextRevision | undefined> {
  const db = await getDB();
  return db.get('revisions', id) as Promise<ContextRevision | undefined>;
}

export async function getCurrentRzdb(contextId: string): Promise<Uint8Array | undefined> {
  const ctx = await getContext(contextId);
  if (!ctx?.currentRevisionId) return undefined;
  const rev = await getRevision(ctx.currentRevisionId);
  return rev?.rzdb;
}

export async function forkContext(sourceId: string, name?: string): Promise<RzwebContext | null> {
  const source = await getContext(sourceId);
  const artifact = source ? await getArtifact(source.artifactHash) : undefined;
  const rzdb = await getCurrentRzdb(sourceId);
  if (!source || !artifact) return null;
  return createContext({
    name: name ?? `${source.name} (fork)`,
    data: artifact.data,
    analysisDepth: source.analysisDepth,
    rzdb,
  });
}

async function evictIfNeeded(): Promise<void> {
  const db = await getDB();
  const contexts = (await db.getAll('contexts')) as StoredContext[];
  const artifacts = (await db.getAll('artifacts')) as StoredArtifact[];
  const revisions = (await db.getAll('revisions')) as ContextRevision[];
  let total =
    artifacts.reduce((sum, a) => sum + a.data.byteLength, 0)
    + revisions.reduce((sum, r) => sum + r.rzdb.byteLength, 0);
  if (total <= MAX_BYTES) return;

  const sorted = contexts.sort((a, b) => a.updatedAt - b.updatedAt);
  for (const ctx of sorted) {
    if (total <= MAX_BYTES) break;
    const revs = revisions.filter((r) => r.contextId === ctx.id);
    const art = artifacts.find((a) => a.hash === ctx.artifactHash);
    const stillUsed = contexts.some((c) => c.id !== ctx.id && c.artifactHash === ctx.artifactHash);
    total -= revs.reduce((sum, r) => sum + r.rzdb.byteLength, 0);
    if (!stillUsed && art) total -= art.data.byteLength;
    await deleteContext(ctx.id);
  }
}

export { computeFileHash };
