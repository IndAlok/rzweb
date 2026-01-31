import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useUIStore, useSettingsStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { Input } from '@/components/ui';
import { Search, ArrowUp, ArrowDown } from 'lucide-react';

interface HexViewProps {
  data: Uint8Array;
  offset: number;
  className?: string;
}

const ROW_HEIGHT = 24;
const VISIBLE_BUFFER = 5;

export function HexView({ data, offset, className }: HexViewProps) {
  const { hexBytesPerRow } = useSettingsStore();
  const { currentAddress, setCurrentAddress } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  
  const totalRows = Math.ceil(data.length / hexBytesPerRow);
  const totalHeight = totalRows * ROW_HEIGHT;
  
  const visibleStartRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER);
  const visibleEndRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VISIBLE_BUFFER);
  
  const visibleRows = useMemo(() => {
    const rows = [];
    for (let row = visibleStartRow; row < visibleEndRow; row++) {
      const start = row * hexBytesPerRow;
      const chunk = data.slice(start, start + hexBytesPerRow);
      rows.push({
        index: row,
        offset: offset + start,
        bytes: Array.from(chunk),
      });
    }
    return rows;
  }, [data, offset, hexBytesPerRow, visibleStartRow, visibleEndRow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    setContainerHeight(container.clientHeight);

    return () => resizeObserver.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const goToAddress = useCallback((addr: number) => {
    const row = Math.floor((addr - offset) / hexBytesPerRow);
    const newScrollTop = Math.max(0, (row - 3) * ROW_HEIGHT);
    if (containerRef.current) {
      containerRef.current.scrollTop = newScrollTop;
    }
    setCurrentAddress(addr);
  }, [offset, hexBytesPerRow, setCurrentAddress]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const results: number[] = [];
    const query = searchQuery.toLowerCase().replace(/\s/g, '');
    
    // Search as hex bytes
    if (/^[0-9a-f]+$/.test(query) && query.length % 2 === 0) {
      const searchBytes: number[] = [];
      for (let i = 0; i < query.length; i += 2) {
        searchBytes.push(parseInt(query.substring(i, i + 2), 16));
      }
      
      for (let i = 0; i <= data.length - searchBytes.length; i++) {
        let match = true;
        for (let j = 0; j < searchBytes.length; j++) {
          if (data[i + j] !== searchBytes[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          results.push(offset + i);
          if (results.length >= 1000) break;
        }
      }
    }
    
    // Search as ASCII
    const queryBytes = new TextEncoder().encode(searchQuery);
    for (let i = 0; i <= data.length - queryBytes.length; i++) {
      let match = true;
      for (let j = 0; j < queryBytes.length; j++) {
        if (data[i + j] !== queryBytes[j]) {
          match = false;
          break;
        }
      }
      if (match && !results.includes(offset + i)) {
        results.push(offset + i);
        if (results.length >= 1000) break;
      }
    }
    
    setSearchResults(results);
    setCurrentSearchIndex(0);
    if (results.length > 0) {
      goToAddress(results[0]);
    }
  }, [searchQuery, data, offset, goToAddress]);

  const nextResult = useCallback(() => {
    if (searchResults.length === 0) return;
    const next = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(next);
    goToAddress(searchResults[next]);
  }, [searchResults, currentSearchIndex, goToAddress]);

  const prevResult = useCallback(() => {
    if (searchResults.length === 0) return;
    const prev = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(prev);
    goToAddress(searchResults[prev]);
  }, [searchResults, currentSearchIndex, goToAddress]);

  return (
    <div className={cn('flex flex-col h-full bg-background font-mono overflow-hidden', className)}>
      <header className="flex h-10 items-center border-b border-border bg-muted/30 px-4 gap-4 shrink-0">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {totalRows.toLocaleString()} rows • {data.length.toLocaleString()} bytes
        </div>
        <div className="flex-1" />
        <div className="relative flex items-center gap-2">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search hex or ASCII..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-8 h-7 text-xs w-48"
          />
          {searchResults.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button onClick={prevResult} className="p-1 hover:bg-accent rounded">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={nextResult} className="p-1 hover:bg-accent rounded">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      <header className="flex h-8 items-center border-b border-border bg-muted/20 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        <div className="w-24">Offset</div>
        <div className="flex-1 px-4 text-center">Hex</div>
        <div className="w-48 text-center border-l border-border">ASCII</div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((line) => (
            <div
              key={line.offset}
              style={{
                position: 'absolute',
                top: line.index * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
              className={cn(
                'flex px-4 items-center text-sm hover:bg-accent/30 transition-colors',
                line.offset <= currentAddress && currentAddress < line.offset + hexBytesPerRow && 'bg-primary/10',
                searchResults.includes(line.offset) && 'bg-yellow-500/20'
              )}
            >
              <div className="w-24 shrink-0 text-code-address opacity-80">
                {formatAddress(line.offset, 32)}
              </div>

              <div className="flex-1 px-4 flex gap-1 justify-center">
                {line.bytes.map((byte, i) => {
                  const byteAddr = line.offset + i;
                  const isCurrent = byteAddr === currentAddress;
                  const isSearchHit = searchResults.includes(byteAddr);
                  return (
                    <span
                      key={i}
                      onClick={() => setCurrentAddress(byteAddr)}
                      className={cn(
                        'w-6 text-center text-xs tabular-nums cursor-pointer hover:bg-accent rounded',
                        byte === 0 ? 'text-muted-foreground/30' : 'text-foreground',
                        isCurrent && 'bg-primary text-primary-foreground rounded-sm font-bold',
                        isSearchHit && !isCurrent && 'bg-yellow-500 text-black rounded-sm'
                      )}
                    >
                      {byte.toString(16).padStart(2, '0')}
                    </span>
                  );
                })}
              </div>

              <div className="w-48 shrink-0 text-muted-foreground border-l border-border/50 px-4 whitespace-pre text-xs tabular-nums">
                {line.bytes
                  .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
                  .join('')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
