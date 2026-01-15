import { useEffect, useRef, useMemo } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useTheme } from '@/providers';
import { cn } from '@/lib/utils';
import { Share2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui';

let dagreRegistered = false;
if (!dagreRegistered) {
  cytoscape.use(dagre);
  dagreRegistered = true;
}

interface GraphNode {
  id: string;
  label: string;
  body?: string;
  type?: 'default' | 'entry' | 'exit';
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
  className?: string;
}

export function GraphView({ nodes, edges, className }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const { resolvedTheme } = useTheme();

  const elements = useMemo(() => {
    if (!nodes.length) return [];
    const cyNodes = nodes.map((n) => ({
      data: { 
        id: n.id, 
        label: n.body ? `${n.label}\n${n.body}` : n.label,
        body: n.body 
      },
    }));
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
      style: [
        {
          selector: 'node',
          style: {
            'shape': 'round-rectangle',
            'background-color': resolvedTheme === 'dark' ? '#1e293b' : '#f8fafc',
            'label': 'data(label)',
            'color': resolvedTheme === 'dark' ? '#e2e8f0' : '#0f172a',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '400px',
            'width': '420px',
            'height': 'label',
            'padding': '20px',
            'border-width': 2,
            'border-color': resolvedTheme === 'dark' ? '#475569' : '#cbd5e1',
            'font-family': 'JetBrains Mono, Consolas, monospace',
            'font-size': '10px',
            'min-height': '40px',
            'min-width': '80px',
          } as any,
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': resolvedTheme === 'dark' ? '#475569' : '#cbd5e1',
            'target-arrow-color': resolvedTheme === 'dark' ? '#475569' : '#cbd5e1',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        {
          selector: 'edge[type="jump"]',
          style: { 'line-color': '#22c55e', 'target-arrow-color': '#22c55e' },
        },
        {
          selector: 'edge[type="fail"]',
          style: { 'line-color': '#ef4444', 'target-arrow-color': '#ef4444' },
        },
        {
          selector: 'edge[type="call"]',
          style: { 'line-color': '#3b82f6', 'target-arrow-color': '#3b82f6', 'line-style': 'dashed' },
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 50,
        rankSep: 100,
      } as cytoscape.LayoutOptions,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, resolvedTheme]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit();

  if (!nodes.length) {
    return (
      <div className={cn('flex flex-col h-full w-full items-center justify-center bg-background text-muted-foreground gap-4', className)}>
        <Share2 className="h-12 w-12 opacity-30" />
        <div className="text-center space-y-2">
          <p className="text-sm">No graph data available</p>
          <p className="text-xs opacity-70">
            Select a function from the sidebar to view its control flow graph.
            Graph feature requires function analysis.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full bg-background overflow-hidden', className)}>
      <div ref={containerRef} className="h-full w-full" />
      
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <Button variant="secondary" size="icon-sm" onClick={handleZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon-sm" onClick={handleZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon-sm" onClick={handleFit}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute top-4 left-4 p-2 bg-background/80 backdrop-blur rounded-md border border-border shadow-sm">
        <h3 className="text-xs font-semibold flex items-center gap-2">
          <Share2 className="h-3 w-3 text-primary" />
          Control Flow Graph
        </h3>
      </div>
    </div>
  );
}
