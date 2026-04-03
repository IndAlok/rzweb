import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatAddressShort } from '@/lib/utils/format';
import type { RzString } from '@/types/rizin';
import { Input, Badge } from '@/components/ui';
import { Search, Quote, ChevronUp, ChevronDown } from 'lucide-react';

interface StringsViewProps {
  strings: RzString[];
  onSelect?: (s: RzString) => void;
  className?: string;
}

const ROW_HEIGHT = 32;
const OVERSCAN = 10;

export function StringsView({ strings, onSelect, className }: StringsViewProps) {
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  const validStrings = useMemo(() => {
    return strings.filter(s => s && typeof s.string === 'string');
  }, [strings]);

  const filteredStrings = useMemo(() => {
    if (!filter.trim()) return validStrings;
    const term = filter.toLowerCase();
    return validStrings.filter(
      (s) =>
        (s.string?.toLowerCase() || '').includes(term) ||
        formatAddressShort(s.vaddr).includes(term)
    );
  }, [validStrings, filter]);

  const totalRows = filteredStrings.length;
  const totalHeight = totalRows * ROW_HEIGHT;
  
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  
  const visibleRows = useMemo(() => {
    return filteredStrings.slice(startRow, endRow).map((s, i) => ({
      index: startRow + i,
      data: s
    }));
  }, [filteredStrings, startRow, endRow]);

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

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleStringClick = useCallback((s: RzString) => {
    if (!s.string) return;
    navigator.clipboard.writeText(s.string).then(() => {
      const preview = s.string.length > 40 ? s.string.substring(0, 40) + '...' : s.string;
      toast.success(`Copied: ${preview}`, { duration: 1500 });
    }).catch(() => {
      toast.error('Failed to copy');
    });
    onSelect?.(s);
  }, [onSelect]);

  const jumpToStart = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, []);

  const jumpToEnd = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = totalHeight - containerHeight;
  }, [totalHeight, containerHeight]);

  const getAddress = useCallback((s: RzString) => {
    const vaddr = s.vaddr;
    const paddr = s.paddr;
    if (vaddr != null && typeof vaddr === 'number' && vaddr > 0 && vaddr < 1e18) {
      return formatAddressShort(vaddr);
    }
    return `p:${formatAddressShort(paddr)}`;
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <div className="p-3 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Quote className="h-4 w-4 text-primary" />
            Strings
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">
              {filteredStrings.length.toLocaleString()}{filter && ` / ${validStrings.length.toLocaleString()}`}
            </Badge>
          </h3>
          <div className="flex gap-1">
            <button onClick={jumpToStart} className="p-1 hover:bg-accent rounded" title="Jump to start">
              <ChevronUp className="h-3 w-3" />
            </button>
            <button onClick={jumpToEnd} className="p-1 hover:bg-accent rounded" title="Jump to end">
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search strings..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8 text-xs bg-muted/20"
          />
        </div>
      </div>

      <header className="flex h-7 items-center border-b border-border bg-muted/30 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0 font-mono">
        <div className="w-24">Address</div>
        <div className="w-12">Len</div>
        <div className="flex-1 px-4">String</div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map(({ index, data: s }) => (
            <button
              key={`${s.vaddr ?? s.paddr ?? index}-${index}`}
              onClick={() => handleStringClick(s)}
              style={{
                position: 'absolute',
                top: index * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
              className="w-full flex items-center px-4 hover:bg-accent text-left transition-colors font-mono text-xs group"
            >
              <div className="w-24 shrink-0 text-code-address opacity-80 group-hover:opacity-100">
                {getAddress(s)}
              </div>
              <div className="w-12 shrink-0 text-muted-foreground text-[10px] opacity-60">
                {s.length ?? s.size ?? 0}
              </div>
              <div className="flex-1 px-4 truncate text-foreground">
                {s.string || '<empty>'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {filteredStrings.length === 0 && (
        <div className="p-8 text-center text-muted-foreground italic space-y-2">
          <p className="text-sm">No strings found</p>
          <p className="text-xs opacity-70">
            {filter ? 'Try a different search term' : 'String extraction may be limited in WASM mode. Try: izz'}
          </p>
        </div>
      )}

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Viewing {Math.min(endRow - startRow, totalRows)} of {totalRows.toLocaleString()}</span>
        <span>Row {Math.floor(scrollTop / ROW_HEIGHT) + 1}</span>
      </footer>
    </div>
  );
}
