import {
  findFunctionAt,
  formatFnLabel,
  functionBounds,
  toNumber,
  type FunctionLike,
  type XrefSource,
} from './analysisModel';
import type { XrefEntry, XrefsResult } from './rizinProtocol';

function xrefName(rec: Record<string, unknown>): string | undefined {
  return [rec.fcn_name, rec.refname, rec.name, rec.flag, rec.realname].find(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
}

export function parseXrefRecord(item: unknown): XrefEntry | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const from = toNumber(rec.from ?? rec.at);
  const to = toNumber(rec.to ?? rec.ref);
  const fallback = toNumber(rec.addr);
  if (from == null && to == null && fallback == null) return null;
  const type = typeof rec.type === 'string' ? rec.type : '';
  const opcode = typeof rec.opcode === 'string' ? rec.opcode : undefined;
  return {
    addr: fallback ?? to ?? from ?? 0,
    from: from ?? undefined,
    to: to ?? undefined,
    type,
    name: xrefName(rec),
    opcode,
  };
}

export function parseXrefList(value: unknown): XrefEntry[] {
  if (!Array.isArray(value)) return [];
  const out: XrefEntry[] = [];
  for (const item of value) {
    const parsed = parseXrefRecord(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

function inRange(addr: number | undefined, start: number, end: number): boolean {
  return addr != null && addr >= start && addr < end;
}

export function xrefsFromFunctionRecord(fn: FunctionLike, address: number): XrefsResult | null {
  const bounds = functionBounds(fn);
  if (!bounds) return null;

  const to: XrefEntry[] = [];
  const from: XrefEntry[] = [];

  for (const ref of fn.codexrefs ?? []) {
    const source = toNumber(ref.addr) ?? toNumber(ref.at);
    if (source == null) continue;
    to.push({
      addr: source,
      from: source,
      to: address,
      type: typeof ref.type === 'string' ? ref.type : 'CODE',
    });
  }

  for (const ref of fn.dataxrefs ?? []) {
    const source = typeof ref === 'number' ? ref : toNumber(ref.addr);
    if (source == null) continue;
    to.push({ addr: source, from: source, to: address, type: 'DATA' });
  }

  for (const ref of fn.callrefs ?? []) {
    const target = toNumber(ref.addr);
    if (target == null) continue;
    const site = toNumber(ref.at) ?? address;
    from.push({
      addr: target,
      from: site,
      to: target,
      type: typeof ref.type === 'string' ? ref.type : 'CALL',
    });
  }

  for (const ref of fn.datarefs ?? []) {
    const target = typeof ref === 'number' ? ref : toNumber(ref.addr);
    if (target == null) continue;
    from.push({ addr: target, from: address, to: target, type: 'DATA' });
  }

  if (to.length === 0 && from.length === 0) return null;
  return { to, from, source: 'aflj' };
}

export function assembleFunctionXrefs(
  value: unknown,
  address: number,
  fn?: FunctionLike
): XrefsResult {
  const bounds = fn ? functionBounds(fn) : { start: address, end: address + 1 };
  const start = bounds?.start ?? address;
  const end = bounds?.end ?? address + 1;
  const to: XrefEntry[] = [];
  const from: XrefEntry[] = [];

  for (const item of parseXrefList(value)) {
    const incoming = item.to != null && (item.to === address || inRange(item.to, start, end));
    const outgoing = item.from != null && (item.from === address || inRange(item.from, start, end));
    if (incoming && !outgoing) {
      to.push({ ...item, addr: item.from ?? item.addr });
    } else if (outgoing) {
      from.push({ ...item, addr: item.to ?? item.addr });
    } else if (item.to != null && item.to !== address) {
      from.push({ ...item, addr: item.to });
    } else if (item.from != null) {
      to.push({ ...item, addr: item.from });
    }
  }

  return { to, from, source: 'afx' };
}

export function assembleInstructionXrefs(
  toJson: unknown,
  fromJson: unknown,
  address: number
): XrefsResult {
  const to = parseXrefList(toJson).map((item) => ({
    ...item,
    addr: item.from ?? item.addr,
    to: item.to ?? address,
  }));
  const from = parseXrefList(fromJson).map((item) => ({
    ...item,
    addr: item.to ?? item.addr,
    from: item.from ?? address,
  }));
  return { to, from, source: 'instruction' };
}

export function enrichXrefNames(result: XrefsResult, functions: FunctionLike[]): XrefsResult {
  const nameFor = (addr: number, current?: string) => current || formatFnLabel(findFunctionAt(addr, functions), addr);
  return {
    ...result,
    to: result.to.map((entry) => ({ ...entry, name: nameFor(entry.addr, entry.name) })),
    from: result.from.map((entry) => ({ ...entry, name: nameFor(entry.addr, entry.name) })),
  };
}

export function emptyXrefs(source: XrefSource = 'empty', error?: string): XrefsResult {
  return { to: [], from: [], source, error };
}
