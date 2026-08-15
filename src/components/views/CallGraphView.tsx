import { useState, useEffect } from 'react';
import { GraphView } from './GraphView';
import type { CallGraphMode, RizinInstance } from '@/lib/rizin';
import type { GraphElements } from '@/lib/rizin/graphs';
import { Button } from '@/components/ui';

interface CallGraphViewProps {
  rizin: RizinInstance;
  address: number;
  onSeek?: (address: number) => void;
  className?: string;
}

export function CallGraphView({ rizin, address, onSeek, className }: CallGraphViewProps) {
  const [elements, setElements] = useState<GraphElements>({ nodes: [], edges: [], truncated: false, source: 'empty' });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<CallGraphMode>('neighborhood');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    rizin
      .getCallGraph(address, mode)
      .then((graph) => {
        if (cancelled) return;
        setElements({
          nodes: graph.nodes,
          edges: graph.edges,
          truncated: graph.truncated,
          source: graph.source,
        });
      })
      .catch(() => {
        if (!cancelled) setElements({ nodes: [], edges: [], truncated: false, source: 'empty' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rizin, address, mode]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Building call graph...</div>;
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute top-4 right-4 z-10 flex gap-1 rounded-md border border-border bg-background/90 p-1 text-xs shadow-sm">
        <Button
          size="sm"
          variant={mode === 'neighborhood' ? 'secondary' : 'ghost'}
          className="h-7 px-2"
          onClick={() => setMode('neighborhood')}
        >
          Neighborhood
        </Button>
        <Button
          size="sm"
          variant={mode === 'global' ? 'secondary' : 'ghost'}
          className="h-7 px-2"
          onClick={() => setMode('global')}
        >
          Global (capped)
        </Button>
      </div>
      <GraphView
        nodes={elements.nodes}
        edges={elements.edges}
        currentAddress={address}
        onSeek={onSeek}
        className={className}
        variant="call"
        truncated={elements.truncated}
        emptyHint="Select a function to view callers and callees. The global program graph is never dumped in full."
      />
    </div>
  );
}
