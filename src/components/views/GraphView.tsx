import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useTheme } from '@/providers';
import { cn, cssVarHex } from '@/lib/utils';
import { Share2, ZoomIn, ZoomOut, Maximize, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { CFG_BLOCK_CAP, CALL_GRAPH_NODE_CAP } from '@/lib/rizin/analysisModel';

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
  variant?: 'cfg' | 'call';
  truncated?: boolean;
  emptyHint?: string;
}

function readPalette() {
  return {
    nodeBg: cssVarHex('--card'),
    nodeText: cssVarHex('--foreground'),
    nodeBorder: cssVarHex('--border'),
    edge: cssVarHex('--muted-foreground'),
    entry: cssVarHex('--success'),
    exit: cssVarHex('--warning'),
    current: cssVarHex('--primary'),
    fail: cssVarHex('--destructive'),
    call: cssVarHex('--code-function'),
  };
}

function buildStylesheet(variant: 'cfg' | 'call'): cytoscape.StylesheetStyle[] {
  const c = readPalette();
  const isCall = variant === 'call';
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
        'text-max-width': isCall ? '120px' : '400px',
        width: isCall ? '140px' : '420px',
        height: 'data(h)',
        padding: isCall ? '8px' : '14px',
        'border-width': 2,
        'border-color': c.nodeBorder,
        'font-family': 'JetBrains Mono, Consolas, monospace',
        'font-size': isCall ? '11px' : '10px',
        'text-justification': isCall ? 'center' : 'left',
        'min-height': '32px',
      },
    },
    {
      selector: 'node[type="entry"]',
      style: { 'border-color': c.entry, 'border-width': 3 },
    },
    {
      selector: 'node[type="exit"]',
      style: { 'border-color': c.exit },
    },
    {
      selector: 'node.current',
      style: { 'border-color': c.current, 'border-width': 4 },
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
    { selector: 'edge[type="jump"]', style: { 'line-color': c.entry, 'target-arrow-color': c.entry } },
    { selector: 'edge[type="fail"]', style: { 'line-color': c.fail, 'target-arrow-color': c.fail } },
    {
      selector: 'edge[type="call"]',
      style: { 'line-color': c.call, 'target-arrow-color': c.call, 'line-style': 'dashed' },
    },
  ];
}

export function GraphView({
  nodes,
  edges,
  currentAddress,
  onSeek,
  className,
  variant = 'cfg',
  truncated = false,
  emptyHint,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const { resolvedThemeId } = useTheme();
  const [ready, setReady] = useState(false);
  const layoutBudget = variant === 'call' ? CALL_GRAPH_NODE_CAP : CFG_BLOCK_CAP;
  const tooLarge = nodes.length > layoutBudget;

  const elements = useMemo<cytoscape.ElementDefinition[]>(() => {
    if (!nodes.length) return [];
    const withIn = new Set(edges.map((e) => e.target));
    const withOut = new Set(edges.map((e) => e.source));
    const cyNodes = nodes.map((n) => {
      const label = variant === 'cfg' && n.body ? `${n.label}\n${n.body}` : n.label;
      const lineCount = label.split('\n').length;
      return {
        data: {
          id: n.id,
          label,
          offset: n.offset,
          h: Math.max(32, lineCount * (variant === 'call' ? 16 : 15) + (variant === 'call' ? 16 : 28)),
          type: !withIn.has(n.id) ? 'entry' : !withOut.has(n.id) ? 'exit' : 'default',
        },
      };
    });
    const cyEdges = edges.map((e, i) => ({
      data: { id: `e${i}`, source: e.source, target: e.target, label: e.label, type: e.type },
    }));
    return [...cyNodes, ...cyEdges];
  }, [nodes, edges, variant]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setReady(el.clientWidth > 0 && el.clientHeight > 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [nodes.length]);

  useEffect(() => {
    if (!containerRef.current || !elements.length || !ready || tooLarge) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: buildStylesheet(variant),
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: variant === 'call' ? 24 : 40, rankSep: variant === 'call' ? 48 : 80 } as cytoscape.LayoutOptions,
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
  }, [elements, ready, tooLarge, variant]);

  useEffect(() => {
    cyRef.current?.style(buildStylesheet(variant));
  }, [resolvedThemeId, variant]);

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
          <p className="text-xs opacity-70">
            {emptyHint ?? (variant === 'call' ? 'Select a function to view its call neighborhood.' : 'Select a function to view its control flow graph.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full bg-background overflow-hidden', className)}>
      <div ref={containerRef} className="h-full w-full" />

      {tooLarge && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-center text-sm text-muted-foreground">
          <div className="max-w-sm space-y-2">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p>This graph has {nodes.length} nodes and would freeze the browser if laid out.</p>
            <p className="text-xs">Narrow the selection or stay in the neighborhood view.</p>
          </div>
        </div>
      )}

      {(truncated || tooLarge) && !tooLarge && (
        <div className="absolute top-12 left-4 right-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Graph was truncated to keep the layout responsive.</span>
        </div>
      )}

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
        <span className="font-semibold">{variant === 'call' ? 'Call Graph' : 'Control Flow Graph'}</span>
        <span className="text-muted-foreground">- click a node to seek</span>
      </div>
    </div>
  );
}
