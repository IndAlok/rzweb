import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  commitRevision,
  createContext,
  deleteContext,
  forkContext,
  getContext,
  getCurrentRzdb,
  listRevisionMeta,
  restoreRevision,
} from '../contextStore';

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('contextStore', () => {
  it('creates a context, commits revisions, and restores a copy', async () => {
    const ctx = await createContext({
      name: 'sample.bin',
      data: bytes([1, 2, 3, 4]),
      rzdb: bytes([9, 9, 9]),
    });
    expect(ctx.name).toBe('sample.bin');
    expect(ctx.currentRevisionId).toBeTruthy();

    const first = await getCurrentRzdb(ctx.id);
    expect(Array.from(first ?? [])).toEqual([9, 9, 9]);

    const second = await commitRevision(ctx.id, bytes([8, 8, 8]), 'edits');
    expect(second?.parentId).toBe(ctx.currentRevisionId);

    const meta = await listRevisionMeta(ctx.id);
    expect(meta.length).toBe(2);
    expect(meta[0].reason).toBe('edits');

    const restored = await restoreRevision(ctx.id, meta[1].id);
    expect(restored?.reason).toBe('manual');
    expect(Array.from((await getCurrentRzdb(ctx.id)) ?? [])).toEqual([9, 9, 9]);
  });

  it('forks a context onto the same artifact', async () => {
    const ctx = await createContext({
      name: 'a.bin',
      data: bytes([4, 5, 6]),
      rzdb: bytes([1]),
    });
    const forked = await forkContext(ctx.id, 'a.bin fork');
    expect(forked).toBeTruthy();
    expect(forked!.id).not.toBe(ctx.id);
    expect(forked!.artifactHash).toBe(ctx.artifactHash);
    expect(Array.from((await getCurrentRzdb(forked!.id)) ?? [])).toEqual([1]);
  });

  it('deletes a context and drops an unused artifact', async () => {
    const ctx = await createContext({ name: 'gone.bin', data: bytes([7, 7]) });
    await deleteContext(ctx.id);
    expect(await getContext(ctx.id)).toBeUndefined();
  });
});
