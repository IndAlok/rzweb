import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { Search, ArrowUpRight } from 'lucide-react';
import type { RzExport } from '@/types/rizin';

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

interface ExportsViewProps {
  exports: RzExport[];
  onNavigate?: (address: number) => void;
  className?: string;
}

export function ExportsView({ exports: exportsList, onNavigate, className }: ExportsViewProps) {
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const filtered = useMemo(() => {
    if (!filter) return exportsList;
    const lower = filter.toLowerCase();
    return exportsList.filter(exp =>
      exp.name?.toLowerCase().includes(lower) ||
      exp.demname?.toLowerCase().includes(lower)
    );
  }, [exportsList, filter]);

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
          placeholder="Filter exports..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        />
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((exp, i) => {
            const idx = startIdx + i;
            return (
              <div
                key={idx}
                style={{ position: 'absolute', top: idx * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
                className={cn(
                  'flex items-center px-3 gap-3 border-b border-border/30 cursor-pointer hover:bg-accent/50 transition-colors',
                  idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                )}
                onClick={() => exp.vaddr && onNavigate?.(exp.vaddr)}
              >
                <ArrowUpRight className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <span className="text-xs font-mono text-cyan-400 truncate flex-1">
                  {exp.demname || exp.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{exp.type || ''}</span>
                <span className="text-xs font-mono text-yellow-400 shrink-0">
                  {exp.size ? `${exp.size}B` : ''}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {formatAddress(exp.vaddr, 32)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {exportsList.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No exports found
        </div>
      )}
    </div>
  );
}
