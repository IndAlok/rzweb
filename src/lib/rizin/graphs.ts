import { stripAnsi } from '@/lib/utils';
import {
  CALL_GRAPH_EDGE_CAP,
  CALL_GRAPH_NODE_CAP,
  CFG_BLOCK_CAP,
  findFunctionAt,
  formatFnLabel,
  parseAddressValue,
  toNumber,
  type CallGraphMode,
  type CallGraphSource,
  type FunctionLike,
} from './analysisModel';

export interface GraphNode {
  id: string;
  label: string;
  body?: string;
  offset?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  type?: 'jump' | 'fail' | 'call';
}

export interface GraphElements {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  source: CallGraphSource | 'agf';
}

interface RawGraphBlock {
  id?: number | string;
  offset?: number;
  addr?: number | string;
  vaddr?: number | string;
  title?: string;
  name?: string;
  body?: string;
  ops?: Array<{ disasm?: string; opcode?: string }>;
  jump?: number;
  fail?: number;
  out_nodes?: Array<number | string>;
}

interface RawGraphContainer {
  nodes?: RawGraphBlock[];
  blocks?: RawGraphBlock[];
  graph?: { nodes?: RawGraphBlock[]; blocks?: RawGraphBlock[] };
}

function extractBlocks(graph: unknown): RawGraphBlock[] {
  if (Array.isArray(graph)) {
    const arr = graph as RawGraphBlock[];
    const looksLikeBlocks =
      arr.length > 0 &&
      arr.every(
        (node) =>
          !!node &&
          typeof node === 'object' &&
          ('offset' in node || 'id' in node || 'jump' in node || 'fail' in node || Array.isArray(node.ops) || Array.isArray(node.out_nodes))
      );
    if (looksLikeBlocks) return arr;
    if (arr.length > 0) {
      const first = arr[0] as RawGraphContainer;
      return first?.blocks ?? first?.nodes ?? [];
    }
    return [];
  }
  if (graph && typeof graph === 'object') {
    const container = graph as RawGraphContainer;
    return container.nodes ?? container.blocks ?? container.graph?.nodes ?? container.graph?.blocks ?? [];
  }
  return [];
}

export function buildCfgElements(graph: unknown, cap = CFG_BLOCK_CAP): GraphElements {
  const all = extractBlocks(graph);
  if (!all.length) {
    return { nodes: [], edges: [], truncated: false, source: 'agf' };
  }

  const truncated = all.length > cap;
  const blocks = truncated ? all.slice(0, cap) : all;
  const allowed = new Set(blocks.map((node, idx) => String(node.id ?? node.offset ?? idx)));

  const offsetToId = new Map<number, string>();
  const nodes = blocks.map((node, idx) => {
    const nodeId = String(node.id ?? node.offset ?? idx);
    const nodeOffset = parseAddressValue(node.offset ?? node.addr ?? node.vaddr ?? node.id ?? node.title ?? node.body);
    if (typeof nodeOffset === 'number') {
      offsetToId.set(nodeOffset, nodeId);
    }
    return {
      id: nodeId,
      label: node.title ?? node.name ?? `0x${(nodeOffset ?? 0).toString(16)}`,
      body: stripAnsi(node.body ?? node.ops?.map((op) => op.disasm ?? op.opcode ?? '').join('\n') ?? ''),
      offset: nodeOffset,
    };
  });

  const edges: GraphEdge[] = [];
  blocks.forEach((node) => {
    const sourceId = String(node.id ?? node.offset ?? 0);
    const outNodes = Array.isArray(node.out_nodes) ? node.out_nodes : [];

    if (outNodes.length > 0) {
      outNodes.forEach((targetId, idx) => {
        const edgeType = outNodes.length === 2 ? (idx === 0 ? ('jump' as const) : ('fail' as const)) : ('jump' as const);
        const targetAddress = parseAddressValue(targetId);
        const target = targetAddress == null ? String(targetId) : offsetToId.get(targetAddress) ?? String(targetId);
        if (!allowed.has(target)) return;
        edges.push({ source: sourceId, target, type: edgeType });
      });
      return;
    }

    if (typeof node.jump === 'number') {
      const target = offsetToId.get(node.jump) ?? String(node.jump);
      if (allowed.has(target)) {
        edges.push({ source: sourceId, target, type: 'jump' });
      }
    }
    if (typeof node.fail === 'number') {
      const target = offsetToId.get(node.fail) ?? String(node.fail);
      if (allowed.has(target)) {
        edges.push({ source: sourceId, target, type: 'fail' });
      }
    }
  });

  return { nodes, edges, truncated, source: 'agf' };
}

export function buildCallGraphFromAgc(
  data: unknown,
  caps: { nodeCap?: number; edgeCap?: number } = {}
): GraphElements {
  const nodeCap = caps.nodeCap ?? CALL_GRAPH_NODE_CAP;
  const edgeCap = caps.edgeCap ?? CALL_GRAPH_EDGE_CAP;
  let blocks: RawGraphBlock[] = [];
  if (Array.isArray(data)) {
    const first = data[0] as { nodes?: RawGraphBlock[] } | undefined;
    blocks = Array.isArray(first?.nodes) ? first.nodes! : (data as RawGraphBlock[]);
  } else if (data && typeof data === 'object') {
    blocks = (data as { nodes?: RawGraphBlock[] }).nodes ?? [];
  }

  if (!blocks.length) {
    return { nodes: [], edges: [], truncated: false, source: 'agc' };
  }

  const truncatedNodes = blocks.length > nodeCap;
  const used = truncatedNodes ? blocks.slice(0, nodeCap) : blocks;
  const allowed = new Set(used.map((n, i) => String(n.id ?? n.offset ?? i)));

  const nodes = used.map((n, i) => ({
    id: String(n.id ?? n.offset ?? i),
    label: n.title ?? n.name ?? `0x${Number(n.offset ?? 0).toString(16)}`,
    offset: typeof n.offset === 'number' ? n.offset : typeof n.addr === 'number' ? n.addr : parseAddressValue(n.offset ?? n.addr),
  }));

  const edges: GraphEdge[] = [];
  for (const n of used) {
    const source = String(n.id ?? n.offset ?? 0);
    for (const target of Array.isArray(n.out_nodes) ? n.out_nodes : []) {
      const targetId = String(target);
      if (!allowed.has(targetId)) continue;
      edges.push({ source, target: targetId, type: 'call' });
      if (edges.length >= edgeCap) {
        return { nodes, edges, truncated: true, source: 'agc' };
      }
    }
  }

  return { nodes, edges, truncated: truncatedNodes, source: 'agc' };
}

function functionIndex(functions: FunctionLike[]): Map<number, FunctionLike> {
  const map = new Map<number, FunctionLike>();
  for (const fn of functions) {
    const offset = toNumber(fn.offset);
    if (offset != null) map.set(offset, fn);
  }
  return map;
}

function outgoingTargets(fn: FunctionLike): number[] {
  const targets: number[] = [];
  for (const ref of fn.callrefs ?? []) {
    const addr = toNumber(ref.addr);
    if (addr != null) targets.push(addr);
  }
  return targets;
}

function incomingSources(fn: FunctionLike, byOffset: Map<number, FunctionLike>): number[] {
  const sources: number[] = [];
  for (const ref of fn.codexrefs ?? []) {
    const addr = toNumber(ref.addr);
    if (addr != null) sources.push(addr);
  }
  const self = toNumber(fn.offset);
  if (self == null) return sources;
  for (const other of byOffset.values()) {
    const otherOff = toNumber(other.offset);
    if (otherOff == null || otherOff === self) continue;
    if (outgoingTargets(other).includes(self)) sources.push(otherOff);
  }
  return sources;
}

export function buildCallGraphFromFunctions(
  functions: FunctionLike[],
  focusAddress: number,
  options: { mode?: CallGraphMode; nodeCap?: number; edgeCap?: number } = {}
): GraphElements {
  const mode = options.mode ?? 'neighborhood';
  const nodeCap = options.nodeCap ?? CALL_GRAPH_NODE_CAP;
  const edgeCap = options.edgeCap ?? CALL_GRAPH_EDGE_CAP;
  const byOffset = functionIndex(functions);
  if (byOffset.size === 0) {
    return { nodes: [], edges: [], truncated: false, source: 'empty' };
  }

  const focus = findFunctionAt(focusAddress, functions);
  const focusOffset = toNumber(focus?.offset) ?? (byOffset.has(focusAddress) ? focusAddress : [...byOffset.keys()][0]);
  if (focusOffset == null) {
    return { nodes: [], edges: [], truncated: false, source: 'empty' };
  }

  const selected = new Set<number>();
  const queue: number[] = [focusOffset];
  const maxDepth = mode === 'neighborhood' ? 1 : Number.POSITIVE_INFINITY;
  const depth = new Map<number, number>([[focusOffset, 0]]);

  while (queue.length > 0 && selected.size < nodeCap) {
    const current = queue.shift()!;
    if (selected.has(current)) continue;
    selected.add(current);
    const currentDepth = depth.get(current) ?? 0;
    if (currentDepth >= maxDepth) continue;
    const fn = byOffset.get(current);
    if (!fn) continue;
    const neighbors = [...outgoingTargets(fn), ...incomingSources(fn, byOffset)];
    for (const next of neighbors) {
      if (selected.has(next) || depth.has(next)) continue;
      if (selected.size + queue.length >= nodeCap) continue;
      depth.set(next, currentDepth + 1);
      queue.push(next);
    }
  }

  const truncated = selected.size >= nodeCap || (mode === 'global' && byOffset.size > selected.size);

  const nodes: GraphNode[] = [...selected].map((offset) => ({
    id: String(offset),
    label: formatFnLabel(byOffset.get(offset), offset),
    offset,
  }));

  const allowed = new Set([...selected].map(String));
  const edges: GraphEdge[] = [];
  for (const offset of selected) {
    const fn = byOffset.get(offset);
    if (!fn) continue;
    for (const target of outgoingTargets(fn)) {
      const targetId = String(target);
      if (!allowed.has(targetId)) continue;
      edges.push({ source: String(offset), target: targetId, type: 'call' });
      if (edges.length >= edgeCap) {
        return { nodes, edges, truncated: true, source: 'aflj' };
      }
    }
  }

  return { nodes, edges, truncated, source: 'aflj' };
}
