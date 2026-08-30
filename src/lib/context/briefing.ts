import { functionBounds, toNumber, type FunctionLike } from '../rizin/analysisModel';
import type { DecompilerEngine, FunctionBriefing, FunctionSummary } from './types';

export function mapFunctionSummary(fn: FunctionLike, extra?: { nbb?: number }): FunctionSummary {
  const addr = toNumber(fn.offset) ?? 0;
  const size = toNumber(fn.size) ?? 0;
  const rec = fn as { bbs?: unknown[]; nbbs?: number };
  let nbb = extra?.nbb ?? 0;
  if (!nbb && Array.isArray(rec.bbs)) nbb = rec.bbs.length;
  if (!nbb && typeof rec.nbbs === 'number') nbb = rec.nbbs;
  return {
    addr,
    name: fn.name || `fcn.${addr.toString(16)}`,
    size,
    nbb,
  };
}

export function stringsInFunctionBounds(
  fn: FunctionLike,
  strings: Array<{ vaddr?: number; paddr?: number; string?: string; offset?: number }>
): Array<{ addr: number; string: string }> {
  const bounds = functionBounds(fn);
  if (!bounds) return [];
  const out: Array<{ addr: number; string: string }> = [];
  for (const entry of strings) {
    const addr = toNumber(entry.vaddr) ?? toNumber(entry.offset) ?? toNumber(entry.paddr);
    if (addr == null || addr < bounds.start || addr >= bounds.end) continue;
    const text = typeof entry.string === 'string' ? entry.string : '';
    if (!text) continue;
    out.push({ addr, string: text });
  }
  return out;
}

export function assembleFunctionBriefing(args: {
  fn: FunctionLike;
  xrefs?: FunctionBriefing['xrefs'];
  strings?: Array<{ addr: number; string: string }>;
  prototype?: string;
  vars?: unknown;
  decompile?: { code: string; engine: DecompilerEngine };
}): FunctionBriefing {
  return {
    summary: mapFunctionSummary(args.fn),
    prototype: args.prototype,
    vars: args.vars,
    xrefs: args.xrefs ?? { to: [], from: [] },
    strings: args.strings ?? [],
    decompile: args.decompile,
  };
}
