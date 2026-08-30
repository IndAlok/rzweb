import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type JobStatus = 'idle' | 'analyzing' | 'failed';
export type RevisionReason = 'open' | 'analysis' | 'edits' | 'manual' | 'park';

export interface StoredContext {
  id: string;
  name: string;
  artifactHash: string;
  fileSize: number;
  currentRevisionId: string | null;
  job: JobStatus;
  analysisDepth: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredRevisionMeta {
  id: string;
  contextId: string;
  parentId: string | null;
  reason: RevisionReason;
  createdAt: number;
}

export interface StoredArtifactMeta {
  hash: string;
  fileName: string;
  fileSize: number;
}

const MAX_REVISIONS = 10;

export function defaultRoot(): string {
  return process.env.RZWEB_CONTEXT_DIR || path.join(os.homedir(), '.rzweb', 'contexts');
}

export class DiskContextStore {
  constructor(private readonly root = defaultRoot()) {}

  private artifactsDir(): string {
    return path.join(this.root, 'artifacts');
  }

  private contextsDir(): string {
    return path.join(this.root, 'contexts');
  }

  private revisionsDir(): string {
    return path.join(this.root, 'revisions');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.artifactsDir(), { recursive: true });
    await fs.mkdir(this.contextsDir(), { recursive: true });
    await fs.mkdir(this.revisionsDir(), { recursive: true });
  }

  async hashBytes(data: Uint8Array): Promise<string> {
    return createHash('sha256').update(data).digest('hex');
  }

  async putArtifact(fileName: string, data: Uint8Array): Promise<StoredArtifactMeta> {
    await this.init();
    const hash = await this.hashBytes(data);
    const meta: StoredArtifactMeta = { hash, fileName, fileSize: data.byteLength };
    await fs.writeFile(path.join(this.artifactsDir(), hash), data);
    await fs.writeFile(path.join(this.artifactsDir(), `${hash}.json`), JSON.stringify(meta));
    return meta;
  }

  async getArtifact(hash: string): Promise<{ meta: StoredArtifactMeta; data: Uint8Array } | null> {
    try {
      const [data, raw] = await Promise.all([
        fs.readFile(path.join(this.artifactsDir(), hash)),
        fs.readFile(path.join(this.artifactsDir(), `${hash}.json`), 'utf8'),
      ]);
      return { meta: JSON.parse(raw) as StoredArtifactMeta, data };
    } catch {
      return null;
    }
  }

  async createContext(params: {
    name: string;
    data: Uint8Array;
    analysisDepth?: number;
    rzdb?: Uint8Array;
    id?: string;
  }): Promise<StoredContext> {
    const artifact = await this.putArtifact(params.name, params.data);
    const now = Date.now();
    const ctx: StoredContext = {
      id: params.id ?? randomUUID(),
      name: params.name,
      artifactHash: artifact.hash,
      fileSize: artifact.fileSize,
      currentRevisionId: null,
      job: 'idle',
      analysisDepth: params.analysisDepth ?? 2,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeContext(ctx);
    if (params.rzdb && params.rzdb.byteLength > 0) {
      await this.commitRevision(ctx.id, params.rzdb, 'open');
      return (await this.get(ctx.id)) ?? ctx;
    }
    return ctx;
  }

  async list(): Promise<StoredContext[]> {
    await this.init();
    const names = await fs.readdir(this.contextsDir());
    const out: StoredContext[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const ctx = await this.get(name.replace(/\.json$/, ''));
      if (ctx) out.push(ctx);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredContext | null> {
    try {
      const raw = await fs.readFile(path.join(this.contextsDir(), `${id}.json`), 'utf8');
      return JSON.parse(raw) as StoredContext;
    } catch {
      return null;
    }
  }

  async update(id: string, patch: Partial<Pick<StoredContext, 'name' | 'job' | 'analysisDepth' | 'currentRevisionId'>>): Promise<void> {
    const ctx = await this.get(id);
    if (!ctx) return;
    await this.writeContext({ ...ctx, ...patch, updatedAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    const ctx = await this.get(id);
    const revs = await this.listRevisions(id);
    for (const rev of revs) {
      await fs.rm(path.join(this.revisionsDir(), `${rev.id}.json`), { force: true });
      await fs.rm(path.join(this.revisionsDir(), `${rev.id}.rzdb`), { force: true });
    }
    await fs.rm(path.join(this.contextsDir(), `${id}.json`), { force: true });
    if (ctx) {
      const remaining = (await this.list()).filter((item) => item.artifactHash === ctx.artifactHash);
      if (remaining.length === 0) {
        await fs.rm(path.join(this.artifactsDir(), ctx.artifactHash), { force: true });
        await fs.rm(path.join(this.artifactsDir(), `${ctx.artifactHash}.json`), { force: true });
      }
    }
  }

  async commitRevision(contextId: string, rzdb: Uint8Array, reason: RevisionReason): Promise<StoredRevisionMeta | null> {
    const ctx = await this.get(contextId);
    if (!ctx || rzdb.byteLength === 0) return null;
    const meta: StoredRevisionMeta = {
      id: randomUUID(),
      contextId,
      parentId: ctx.currentRevisionId,
      reason,
      createdAt: Date.now(),
    };
    await fs.writeFile(path.join(this.revisionsDir(), `${meta.id}.json`), JSON.stringify(meta));
    await fs.writeFile(path.join(this.revisionsDir(), `${meta.id}.rzdb`), rzdb);
    await this.writeContext({ ...ctx, currentRevisionId: meta.id, updatedAt: Date.now() });
    const all = await this.listRevisions(contextId);
    for (const extra of all.slice(MAX_REVISIONS)) {
      await fs.rm(path.join(this.revisionsDir(), `${extra.id}.json`), { force: true });
      await fs.rm(path.join(this.revisionsDir(), `${extra.id}.rzdb`), { force: true });
    }
    return meta;
  }

  async listRevisions(contextId: string): Promise<StoredRevisionMeta[]> {
    await this.init();
    const names = await fs.readdir(this.revisionsDir());
    const out: StoredRevisionMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.revisionsDir(), name), 'utf8');
        const meta = JSON.parse(raw) as StoredRevisionMeta;
        if (meta.contextId === contextId) out.push(meta);
      } catch { /* ignore */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getRevisionBytes(id: string): Promise<Uint8Array | null> {
    try {
      const buf = await fs.readFile(path.join(this.revisionsDir(), `${id}.rzdb`));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  async getCurrentRzdb(contextId: string): Promise<Uint8Array | null> {
    const ctx = await this.get(contextId);
    if (!ctx?.currentRevisionId) return null;
    return this.getRevisionBytes(ctx.currentRevisionId);
  }

  async restoreRevision(contextId: string, revisionId: string): Promise<StoredRevisionMeta | null> {
    const bytes = await this.getRevisionBytes(revisionId);
    const metaRaw = await fs.readFile(path.join(this.revisionsDir(), `${revisionId}.json`), 'utf8').catch(() => null);
    if (!bytes || !metaRaw) return null;
    const meta = JSON.parse(metaRaw) as StoredRevisionMeta;
    if (meta.contextId !== contextId) return null;
    return this.commitRevision(contextId, bytes, 'manual');
  }

  async fork(sourceId: string, name?: string): Promise<StoredContext | null> {
    const source = await this.get(sourceId);
    const artifact = source ? await this.getArtifact(source.artifactHash) : null;
    const rzdb = await this.getCurrentRzdb(sourceId);
    if (!source || !artifact) return null;
    return this.createContext({
      name: name ?? `${source.name} (fork)`,
      data: artifact.data,
      analysisDepth: source.analysisDepth,
      rzdb: rzdb ?? undefined,
    });
  }

  private async writeContext(ctx: StoredContext): Promise<void> {
    await this.init();
    await fs.writeFile(path.join(this.contextsDir(), `${ctx.id}.json`), JSON.stringify(ctx, null, 2));
  }
}

export const MAGIC = 'RZWEBPRJ';

export function encodeBundle(name: string, binary: Uint8Array, rzdb: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const magic = encoder.encode(MAGIC);
  const nameBytes = encoder.encode(name);
  const total = 8 + 1 + 4 + nameBytes.length + 4 + binary.length + 4 + rzdb.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  out.set(magic, offset);
  offset += 8;
  view.setUint8(offset, 1);
  offset += 1;
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  view.setUint32(offset, binary.length, true);
  offset += 4;
  out.set(binary, offset);
  offset += binary.length;
  view.setUint32(offset, rzdb.length, true);
  offset += 4;
  out.set(rzdb, offset);
  return out;
}

export function decodeBundle(data: Uint8Array): { name: string; binary: Uint8Array; rzdb: Uint8Array } | null {
  if (data.byteLength < 13) return null;
  const decoder = new TextDecoder();
  if (decoder.decode(data.subarray(0, 8)) !== MAGIC) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  if (view.getUint8(offset) !== 1) return null;
  offset += 1;
  const nameLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + nameLen > data.byteLength) return null;
  const name = decoder.decode(data.subarray(offset, offset + nameLen));
  offset += nameLen;
  const binLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + binLen > data.byteLength) return null;
  const binary = data.slice(offset, offset + binLen);
  offset += binLen;
  const rzdbLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + rzdbLen > data.byteLength) return null;
  return { name, binary, rzdb: data.slice(offset, offset + rzdbLen) };
}
