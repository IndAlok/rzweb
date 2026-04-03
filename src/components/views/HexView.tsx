import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useUIStore, useSettingsStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { Input } from '@/components/ui';
import { Search, ArrowUp, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react';

interface HexViewProps {
  data: Uint8Array;
  offset: number;
  className?: string;
}

const ROW_HEIGHT = 22;
const OVERSCAN = 10;

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
  
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleRowCount = endRow - startRow;
  
  const visibleRows = useMemo(() => {
    const rows = [];
    for (let row = startRow; row < endRow; row++) {
      const start = row * hexBytesPerRow;
      const end = Math.min(start + hexBytesPerRow, data.length);
      const chunk = data.slice(start, end);
      rows.push({
        index: row,
        offset: offset + start,
        bytes: Array.from(chunk),
      });
    }
    return rows;
  }, [data, offset, hexBytesPerRow, startRow, endRow]);

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

  const scrollToRow = useCallback((row: number) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, row * ROW_HEIGHT - containerHeight / 2 + ROW_HEIGHT);
    }
  }, [containerHeight]);

  const goToAddress = useCallback((addr: number) => {
    const byteOffset = addr - offset;
    const row = Math.floor(byteOffset / hexBytesPerRow);
    scrollToRow(row);
    setCurrentAddress(addr);
  }, [offset, hexBytesPerRow, scrollToRow, setCurrentAddress]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const results: number[] = [];
    const query = searchQuery.toLowerCase().replace(/\s/g, '');
    

    if (/^[0-9a-f]+$/.test(query) && query.length >= 2) {
      const searchBytes: number[] = [];
      for (let i = 0; i < query.length - (query.length % 2); i += 2) {
        searchBytes.push(parseInt(query.substring(i, i + 2), 16));
      }
      
      if (searchBytes.length > 0) {
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
            if (results.length >= 500) break;
          }
        }
      }
    }
    

    const queryBytes = new TextEncoder().encode(searchQuery);
    if (queryBytes.length > 0) {
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
          if (results.length >= 500) break;
        }
      }
    }
    
    setSearchResults(results);
    setCurrentSearchIndex(0);
    if (results.length > 0) {
      goToAddress(results[0]);
    }
  }, [searchQuery, data, offset, goToAddress]);

  const navigateResult = useCallback((direction: 1 | -1) => {
    if (searchResults.length === 0) return;
    const next = (currentSearchIndex + direction + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(next);
    goToAddress(searchResults[next]);
  }, [searchResults, currentSearchIndex, goToAddress]);

  const jumpToStart = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, []);

  const jumpToEnd = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = totalHeight - containerHeight;
  }, [totalHeight, containerHeight]);

  return (
    <div className={cn('flex flex-col h-full bg-background font-mono overflow-hidden', className)}>
      <header className="flex h-9 items-center border-b border-border bg-muted/30 px-3 gap-3 shrink-0">
        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          {data.length.toLocaleString()} bytes • {totalRows.toLocaleString()} rows
        </span>
        <span className="text-[10px] text-muted-foreground">
          Row {Math.floor(scrollTop / ROW_HEIGHT) + 1}
        </span>
        <div className="flex gap-1">
          <button onClick={jumpToStart} className="p-1 hover:bg-accent rounded" title="Jump to start">
            <ChevronUp className="h-3 w-3" />
          </button>
          <button onClick={jumpToEnd} className="p-1 hover:bg-accent rounded" title="Jump to end">
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <div className="flex-1" />
        <div className="relative flex items-center gap-1">
          <Search className="absolute left-2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Hex or ASCII..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-7 h-6 text-[11px] w-36"
          />
          {searchResults.length > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button onClick={() => navigateResult(-1)} className="p-0.5 hover:bg-accent rounded">
                <ArrowUp className="h-3 w-3" />
              </button>
              <button onClick={() => navigateResult(1)} className="p-0.5 hover:bg-accent rounded">
                <ArrowDown className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </header>

      <header className="flex h-6 items-center border-b border-border bg-muted/20 px-3 text-[9px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        <div className="w-20">Offset</div>
        <div className="flex-1 text-center">Hex</div>
        <div className="w-36 text-center border-l border-border pl-2">ASCII</div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((line) => {
            const isCurrentRow = line.offset <= currentAddress && currentAddress < line.offset + hexBytesPerRow;
            return (
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
                  'flex items-center px-3 text-xs hover:bg-accent/20',
                  isCurrentRow && 'bg-primary/10'
                )}
              >
                <div 
                  className="w-20 shrink-0 text-code-address opacity-70 cursor-pointer hover:opacity-100"
                  onClick={() => setCurrentAddress(line.offset)}
                >
                  {formatAddress(line.offset, 32)}
                </div>

                <div className="flex-1 flex gap-0.5 justify-center">
                  {line.bytes.map((byte, i) => {
                    const byteAddr = line.offset + i;
                    const isCurrent = byteAddr === currentAddress;
                    const isSearchHit = searchResults.some(r => r <= byteAddr && byteAddr < r + (searchQuery.length / 2 || 1));
                    return (
                      <span
                        key={i}
                        onClick={() => setCurrentAddress(byteAddr)}
                        className={cn(
                          'w-5 text-center text-[11px] tabular-nums cursor-pointer rounded-sm',
                          byte === 0 ? 'text-muted-foreground/25' : 'text-foreground',
                          isCurrent && 'bg-primary text-primary-foreground font-semibold',
                          isSearchHit && !isCurrent && 'bg-yellow-400/80 text-black'
                        )}
                      >
                        {byte.toString(16).padStart(2, '0')}
                      </span>
                    );
                  })}
                  {/* Pad if row is incomplete */}
                  {line.bytes.length < hexBytesPerRow && Array(hexBytesPerRow - line.bytes.length).fill(0).map((_, i) => (
                    <span key={`pad-${i}`} className="w-5" />
                  ))}
                </div>

                <div className="w-36 shrink-0 text-muted-foreground border-l border-border/40 pl-2 text-[11px] tabular-nums tracking-tight">
                  {line.bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·')).join('')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Viewing {visibleRowCount} of {totalRows.toLocaleString()} rows</span>
        <span>Current: 0x{currentAddress.toString(16).toUpperCase()}</span>
      </footer>
    </div>
  );
}
