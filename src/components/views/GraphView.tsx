import { useEffect, useRef, useMemo, useCallback } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useTheme } from '@/providers';
import { cn } from '@/lib/utils';
import { Share2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui';

cytoscape.use(dagre);

interface GraphNode {
  id: string;
  label: string;
  body?: string;
  offset?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  type?: 'jump' | 'fail' | 'call';
}

interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  currentAddress?: number;
  onSeek?: (address: number) => void;
  className?: string;
}

const palette = (dark: boolean) => ({
  nodeBg: dark ? '#1e293b' : '#f8fafc',
  nodeText: dark ? '#e2e8f0' : '#0f172a',
  nodeBorder: dark ? '#475569' : '#cbd5e1',
  edge: dark ? '#475569' : '#cbd5e1',
});

function buildStylesheet(dark: boolean): cytoscape.StylesheetStyle[] {
  const c = palette(dark);
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        'background-color': c.nodeBg,
        label: 'data(label)',
        color: c.nodeText,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '400px',
        width: '420px',
        height: 'data(h)',
        padding: '14px',
        'border-width': 2,
        'border-color': c.nodeBorder,
        'font-family': 'JetBrains Mono, Consolas, monospace',
        'font-size': '10px',
        'text-justification': 'left',
        'min-height': '32px',
      },
    },
    {
      selector: 'node[type="entry"]',
      style: { 'border-color': '#22c55e', 'border-width': 3 },
    },
    {
      selector: 'node[type="exit"]',
      style: { 'border-color': '#f59e0b' },
    },
    {
      selector: 'node.current',
      style: { 'border-color': '#38bdf8', 'border-width': 4 },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': c.edge,
        'target-arrow-color': c.edge,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
      },
    },
    { selector: 'edge[type="jump"]', style: { 'line-color': '#22c55e', 'target-arrow-color': '#22c55e' } },
    { selector: 'edge[type="fail"]', style: { 'line-color': '#ef4444', 'target-arrow-color': '#ef4444' } },
    {
      selector: 'edge[type="call"]',
      style: { 'line-color': '#3b82f6', 'target-arrow-color': '#3b82f6', 'line-style': 'dashed' },
    },
  ];
}

export function GraphView({ nodes, edges, currentAddress, onSeek, className }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const darkRef = useRef(dark);
  darkRef.current = dark;

  const elements = useMemo<cytoscape.ElementDefinition[]>(() => {
    if (!nodes.length) return [];
    const withIn = new Set(edges.map((e) => e.target));
    const withOut = new Set(edges.map((e) => e.source));
    const cyNodes = nodes.map((n) => {
      const label = n.body ? `${n.label}\n${n.body}` : n.label;
      const lineCount = label.split('\n').length;
      return {
        data: {
          id: n.id,
          label,
          offset: n.offset,
          h: Math.max(32, lineCount * 15 + 28),
          type: !withIn.has(n.id) ? 'entry' : !withOut.has(n.id) ? 'exit' : 'default',
        },
      };
    });
    const cyEdges = edges.map((e, i) => ({
      data: { id: `e${i}`, source: e.source, target: e.target, label: e.label, type: e.type },
    }));
    return [...cyNodes, ...cyEdges];
  }, [nodes, edges]);

  useEffect(() => {
    if (!containerRef.current || !elements.length) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: buildStylesheet(darkRef.current),
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: 40, rankSep: 80 } as cytoscape.LayoutOptions,
    });

    cy.on('tap', 'node', (evt) => {
      const offset = evt.target.data('offset');
      if (typeof offset === 'number') onSeekRef.current?.(offset);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements]);

  useEffect(() => {
    cyRef.current?.style(buildStylesheet(dark));
  }, [dark]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('current');
    if (typeof currentAddress !== 'number') return;
    let best: cytoscape.NodeSingular | null = null;
    let bestOffset = -1;
    cy.nodes().forEach((node) => {
      const offset = node.data('offset');
      if (typeof offset === 'number' && offset <= currentAddress && offset > bestOffset) {
        best = node;
        bestOffset = offset;
      }
    });
    (best as cytoscape.NodeSingular | null)?.addClass('current');
  }, [currentAddress, elements]);

  const handleZoomIn = useCallback(() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2), []);
  const handleZoomOut = useCallback(() => cyRef.current?.zoom(cyRef.current.zoom() * 0.8), []);
  const handleFit = useCallback(() => cyRef.current?.fit(undefined, 30), []);

  if (!nodes.length) {
    return (
      <div className={cn('flex flex-col h-full w-full items-center justify-center bg-background text-muted-foreground gap-4', className)}>
        <Share2 className="h-12 w-12 opacity-30" />
        <div className="text-center space-y-2">
          <p className="text-sm">No graph data available</p>
          <p className="text-xs opacity-70">Select a function to view its control flow graph.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full bg-background overflow-hidden', className)}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <Button variant="secondary" size="icon-sm" onClick={handleZoomIn} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon-sm" onClick={handleZoomOut} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon-sm" onClick={handleFit} title="Fit graph">
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute top-4 left-4 flex items-center gap-2 rounded-md border border-border bg-background/80 p-2 text-xs shadow-sm backdrop-blur">
        <Share2 className="h-3 w-3 text-primary" />
        <span className="font-semibold">Control Flow Graph</span>
        <span className="text-muted-foreground">- click a block to seek</span>
      </div>
    </div>
  );
}
