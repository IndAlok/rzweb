import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatAddressShort } from '@/lib/utils/format';
import type { RzString } from '@/types/rizin';
import { Input, Badge } from '@/components/ui';
import { Search, Quote, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from 'lucide-react';

interface StringsViewProps {
  strings: RzString[];
  onSelect?: (s: RzString) => void;
  className?: string;
}

const PAGE_SIZE = 100;
const ROW_HEIGHT = 32;
const VISIBLE_BUFFER = 5;

export function StringsView({ strings, onSelect, className }: StringsViewProps) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  const filteredStrings = useMemo(() => {
    if (!filter.trim()) return strings;
    const term = filter.toLowerCase();
    return strings.filter(
      (s) =>
        s.string?.toLowerCase().includes(term) ||
        formatAddressShort(s.vaddr).includes(term)
    );
  }, [strings, filter]);

  const totalPages = Math.ceil(filteredStrings.length / PAGE_SIZE);
  const startIdx = page * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filteredStrings.length);
  const pageStrings = filteredStrings.slice(startIdx, endIdx);

  // Virtual scrolling within page
  const visibleStartRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER);
  const visibleEndRow = Math.min(pageStrings.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VISIBLE_BUFFER);
  const visibleStrings = pageStrings.slice(visibleStartRow, visibleEndRow);
  const totalHeight = pageStrings.length * ROW_HEIGHT;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    setContainerHeight(container.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPage(0);
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [filter]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleStringClick = useCallback((s: RzString) => {
    navigator.clipboard.writeText(s.string || '').then(() => {
      const preview = (s.string || '').length > 40 ? (s.string || '').substring(0, 40) + '...' : s.string;
      toast.success(`Copied: ${preview}`, { duration: 1500 });
    }).catch(() => {
      toast.error('Failed to copy');
    });
    onSelect?.(s);
  }, [onSelect]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <div className="p-2 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Quote className="h-3.5 w-3.5 text-primary" />
            Strings
            <Badge variant="secondary" className="ml-1 px-1 py-0 h-4 text-[10px]">
              {filteredStrings.length.toLocaleString()}
            </Badge>
          </h3>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 text-[10px]">
              <button onClick={() => setPage(0)} disabled={page === 0} className="p-0.5 hover:bg-accent rounded disabled:opacity-30">
                <ChevronsUp className="h-3 w-3" />
              </button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-0.5 hover:bg-accent rounded disabled:opacity-30">
                <ChevronUp className="h-3 w-3" />
              </button>
              <span className="text-muted-foreground whitespace-nowrap">
                {page + 1}/{totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-0.5 hover:bg-accent rounded disabled:opacity-30">
                <ChevronDown className="h-3 w-3" />
              </button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="p-0.5 hover:bg-accent rounded disabled:opacity-30">
                <ChevronsDown className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search strings..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-7 h-7 text-xs bg-muted/20"
          />
        </div>
      </div>

      <header className="flex h-6 items-center border-b border-border bg-muted/30 px-3 text-[9px] font-medium text-muted-foreground uppercase tracking-wider shrink-0 font-mono">
        <div className="w-20">Address</div>
        <div className="w-10">Len</div>
        <div className="flex-1 px-2">String</div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleStrings.map((s, localIdx) => {
            const rowIdx = visibleStartRow + localIdx;
            return (
              <button
                key={`${s.vaddr ?? rowIdx}-${startIdx + rowIdx}`}
                onClick={() => handleStringClick(s)}
                style={{
                  position: 'absolute',
                  top: rowIdx * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
                className="flex items-center px-3 hover:bg-accent text-left transition-colors font-mono text-xs group"
              >
                <div className="w-20 shrink-0 text-code-address opacity-70">
                  {s.vaddr != null && s.vaddr > 1e18 ? `p:${formatAddressShort(s.paddr)}` : formatAddressShort(s.vaddr)}
                </div>
                <div className="w-10 shrink-0 text-muted-foreground text-[10px] opacity-50">
                  {s.length ?? 0}
                </div>
                <div className="flex-1 px-2 truncate text-foreground">
                  {s.string || ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Showing {startIdx + 1}-{endIdx} of {filteredStrings.length.toLocaleString()}</span>
        <span>{PAGE_SIZE}/page</span>
      </footer>
    </div>
  );
}
