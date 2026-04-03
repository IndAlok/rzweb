import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { Search, Package } from 'lucide-react';
import type { RzImport } from '@/types/rizin';

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

interface ImportsViewProps {
  imports: RzImport[];
  onNavigate?: (address: number) => void;
  className?: string;
}

export function ImportsView({ imports, onNavigate, className }: ImportsViewProps) {
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const filtered = useMemo(() => {
    if (!filter) return imports;
    const lower = filter.toLowerCase();
    return imports.filter(imp =>
      imp.name?.toLowerCase().includes(lower) ||
      imp.libname?.toLowerCase().includes(lower)
    );
  }, [imports, filter]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleItems = filtered.slice(startIdx, endIdx);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter imports..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        />
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((imp, i) => {
            const idx = startIdx + i;
            return (
              <div
                key={idx}
                style={{ position: 'absolute', top: idx * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
                className={cn(
                  'flex items-center px-3 gap-3 border-b border-border/30 cursor-pointer hover:bg-accent/50 transition-colors',
                  idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                )}
                onClick={() => imp.plt && onNavigate?.(imp.plt)}
              >
                <Package className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">
                  {imp.ordinal ?? '-'}
                </span>
                <span className="text-xs font-mono text-cyan-400 truncate flex-1">{imp.name}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[120px]">{imp.libname || ''}</span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {imp.plt ? formatAddress(imp.plt, 32) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {imports.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No imports found
        </div>
      )}
    </div>
  );
}
