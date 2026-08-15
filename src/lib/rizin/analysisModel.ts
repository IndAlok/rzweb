// Shared helpers for Rizin JSON (aflj / axt / axf / ag*). Kept free of the
// WASM session so parsers can be unit-tested against fixtures.

export const CALL_GRAPH_NODE_CAP = 250;
export const CALL_GRAPH_EDGE_CAP = 400;
export const CFG_BLOCK_CAP = 200;
export const XREF_OPCODE_ENRICH_LIMIT = 16;

export type XrefSource = 'aflj' | 'afx' | 'instruction' | 'empty';
export type CallGraphMode = 'neighborhood' | 'global';
export type CallGraphSource = 'aflj' | 'agc' | 'agC' | 'empty';

export interface FunctionLike {
  offset?: number;
  name?: string;
  size?: number;
  minbound?: number;
  maxbound?: number;
  callrefs?: Array<{ addr?: number; type?: string; at?: number }>;
  datarefs?: Array<number | { addr?: number }>;
  codexrefs?: Array<{ addr?: number; type?: string; at?: number }>;
  dataxrefs?: Array<number | { addr?: number }>;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const n = value.startsWith('0x') || value.startsWith('0X') ? parseInt(value, 16) : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseAddressValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.match(/0x[0-9a-fA-F]+|[0-9a-fA-F]{6,}/);
  if (!match) return undefined;
  const raw = match[0];
  const parsed = raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function functionBounds(fn: FunctionLike): { start: number; end: number } | null {
  const start = toNumber(fn.offset) ?? toNumber(fn.minbound);
  if (start == null) return null;
  const maxbound = toNumber(fn.maxbound);
  const size = toNumber(fn.size) ?? 0;
  const end = maxbound != null && maxbound > start ? maxbound : start + Math.max(size, 1);
  return { start, end };
}

export function findFunctionAt<T extends FunctionLike>(address: number, functions: T[]): T | undefined {
  const exact = functions.find((fn) => toNumber(fn.offset) === address);
  if (exact) return exact;
  return functions.find((fn) => {
    const bounds = functionBounds(fn);
    return bounds != null && address >= bounds.start && address < bounds.end;
  });
}

export function formatFnLabel(fn: FunctionLike | undefined, address: number): string {
  if (fn?.name) return fn.name;
  return `0x${address.toString(16)}`;
}
