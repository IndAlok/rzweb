import { describe, expect, it } from 'vitest';
import { decodeProjectBundle, encodeProjectBundle, isProjectBundle } from '../projectBundle';

describe('projectBundle', () => {
  it('round-trips name, binary, and rzdb', () => {
    const binary = new Uint8Array([1, 2, 3, 4]);
    const rzdb = new Uint8Array([9, 8, 7]);
    const encoded = encodeProjectBundle('hello.bin', binary, rzdb);
    expect(isProjectBundle(encoded)).toBe(true);
    const decoded = decodeProjectBundle(encoded);
    expect(decoded?.name).toBe('hello.bin');
    expect(Array.from(decoded!.binary)).toEqual([1, 2, 3, 4]);
    expect(Array.from(decoded!.rzdb)).toEqual([9, 8, 7]);
  });

  it('returns null for a raw rzdb', () => {
    expect(decodeProjectBundle(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});
