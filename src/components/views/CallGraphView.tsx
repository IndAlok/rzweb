import { useState, useEffect } from 'react';
import { GraphView } from './GraphView';
import type { RizinInstance } from '@/lib/rizin';

interface CallGraphViewProps {
  rizin: RizinInstance;
  onSeek?: (address: number) => void;
  className?: string;
}

interface RawCallNode {
  id?: number | string;
  offset?: number;
  addr?: number;
  title?: string;
  name?: string;
  out_nodes?: Array<number | string>;
}

type GraphElements = {
  nodes: { id: string; label: string; offset?: number }[];
  edges: { source: string; target: string; type?: 'call' }[];
};

// agCj returns either a flat node array or a wrapper with a `nodes` array.
function buildCallGraph(data: unknown): GraphElements {
  let blocks: RawCallNode[] = [];
  if (Array.isArray(data)) {
    const first = data[0] as { nodes?: RawCallNode[] } | undefined;
    blocks = Array.isArray(first?.nodes) ? first!.nodes! : (data as RawCallNode[]);
  } else if (data && typeof data === 'object') {
    blocks = ((data as { nodes?: RawCallNode[] }).nodes) ?? [];
  }

  const nodes = blocks.map((n, i) => ({
    id: String(n.id ?? n.offset ?? i),
    label: n.title ?? n.name ?? `0x${Number(n.offset ?? 0).toString(16)}`,
    offset: typeof n.offset === 'number' ? n.offset : typeof n.addr === 'number' ? n.addr : undefined,
  }));

  const edges: GraphElements['edges'] = [];
  for (const n of blocks) {
    const source = String(n.id ?? n.offset ?? 0);
    for (const target of Array.isArray(n.out_nodes) ? n.out_nodes : []) {
      edges.push({ source, target: String(target), type: 'call' });
    }
  }
  return { nodes, edges };
}

export function CallGraphView({ rizin, onSeek, className }: CallGraphViewProps) {
  const [elements, setElements] = useState<GraphElements>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    rizin
      .executeCommand('agCj')
      .then((out) => {
        if (cancelled) return;
        try {
          setElements(buildCallGraph(JSON.parse(out)));
        } catch {
          setElements({ nodes: [], edges: [] });
        }
      })
      .catch(() => {
        if (!cancelled) setElements({ nodes: [], edges: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rizin]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Building call graph...</div>;
  }
  return <GraphView nodes={elements.nodes} edges={elements.edges} onSeek={onSeek} className={className} />;
}
