import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useUIStore, useSettingsStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import type { RizinInstance } from '@/lib/rizin';
import { Input } from '@/components/ui';
import { Search, ArrowUp, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react';

interface HexViewProps {
  rizin: RizinInstance;
  baseAddress: number;
  totalSize: number;
  className?: string;
}

interface MemWindow {
  start: number;
  length: number;
  bytes: Uint8Array;
}

const ROW_HEIGHT = 22;
const OVERSCAN = 10;
const MAX_HITS = 1000;
const EMPTY = new Uint8Array(0);
const EMPTY_WINDOW: MemWindow = { start: 0, length: 0, bytes: EMPTY };

export function HexView({ rizin, baseAddress, totalSize, className }: HexViewProps) {
  const { hexBytesPerRow } = useSettingsStore();
  const { currentAddress, setCurrentAddress } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const fetchSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [memWindow, setMemWindow] = useState<MemWindow>(EMPTY_WINDOW);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchHitLen, setSearchHitLen] = useState(1);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const bpr = hexBytesPerRow;
  const windowBytes = Math.min(Math.max(bpr * 256, 8192), 65536);
  const totalRows = Math.ceil(totalSize / bpr);
  const totalHeight = totalRows * ROW_HEIGHT;
  const addrBits = baseAddress + totalSize > 0xffffffff ? 64 : 32;
  const addrColClass = addrBits === 64 ? 'w-36' : 'w-20';

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleRowCount = endRow - startRow;

  // Drop any stale window when the binary or its mapped span changes.
  useEffect(() => {
    setMemWindow(EMPTY_WINDOW);
  }, [rizin, baseAddress, totalSize]);

  useEffect(() => {
    if (totalSize <= 0) return;

    const viewStartByte = startRow * bpr;
    const viewEndByte = Math.min(endRow * bpr, totalSize);
    const viewStartAddr = baseAddress + viewStartByte;
    const viewEndAddr = baseAddress + viewEndByte;

    const covered =
      memWindow.length > 0 &&
      memWindow.start <= viewStartAddr &&
      viewEndAddr <= memWindow.start + memWindow.length;
    if (covered) return;

    const center = (viewStartByte + viewEndByte) / 2;
    let startByte = Math.floor(center - windowBytes / 2);
    startByte = Math.max(0, Math.min(startByte, Math.max(0, totalSize - windowBytes)));
    startByte = Math.floor(startByte / bpr) * bpr;
    const length = Math.min(windowBytes, totalSize - startByte);
    const startAddr = baseAddress + startByte;

    const seq = ++fetchSeqRef.current;
    rizin
      .readMemory(startAddr, length)
      .then((bytes) => {
        if (seq !== fetchSeqRef.current) return;
        setMemWindow({ start: startAddr, length, bytes });
      })
      .catch(() => {
        // Keep the prior window
      });
  }, [rizin, baseAddress, totalSize, bpr, windowBytes, startRow, endRow, memWindow]);

  const visibleRows = useMemo(() => {
    const rows: Array<{ index: number; offset: number; bytes: (number | null)[] }> = [];
    for (let row = startRow; row < endRow; row++) {
      const rowStartByte = row * bpr;
      const addr = baseAddress + rowStartByte;
      const count = Math.min(bpr, totalSize - rowStartByte);
      const bytes: (number | null)[] = [];
      for (let i = 0; i < count; i++) {
        const idx = addr + i - memWindow.start;
        bytes.push(idx >= 0 && idx < memWindow.bytes.length ? memWindow.bytes[idx] : null);
      }
      rows.push({ index: row, offset: addr, bytes });
    }
    return rows;
  }, [startRow, endRow, bpr, baseAddress, totalSize, memWindow]);

  const highlightSet = useMemo(() => {
    const set = new Set<number>();
    const span = Math.max(1, searchHitLen);
    if (searchResults.length * span <= 20000) {
      for (const r of searchResults) for (let i = 0; i < span; i++) set.add(r + i);
    } else {
      for (const r of searchResults) set.add(r);
    }
    return set;
  }, [searchResults, searchHitLen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    setContainerHeight(container.clientHeight);

    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    scrollTopRef.current = e.currentTarget.scrollTop;
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const scrollToRow = useCallback((row: number) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, row * ROW_HEIGHT - containerHeight / 2 + ROW_HEIGHT);
    }
  }, [containerHeight]);

  const goToAddress = useCallback((addr: number) => {
    const row = Math.floor((addr - baseAddress) / bpr);
    scrollToRow(row);
    setCurrentAddress(addr);
  }, [baseAddress, bpr, scrollToRow, setCurrentAddress]);

  useEffect(() => {
    if (currentAddress < baseAddress || currentAddress >= baseAddress + totalSize) return;
    const rowTop = Math.floor((currentAddress - baseAddress) / bpr) * ROW_HEIGHT;
    const viewTop = scrollTopRef.current;
    if (rowTop < viewTop || rowTop + ROW_HEIGHT > viewTop + containerHeight) {
      scrollToRow(Math.floor((currentAddress - baseAddress) / bpr));
    }
  }, [currentAddress, baseAddress, totalSize, bpr, containerHeight, scrollToRow]);

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const compact = query.replace(/\s+/g, '');
    const looksHex = /^[0-9a-fA-F]+$/.test(compact) && compact.length >= 2;
    const hex = looksHex ? compact.slice(0, compact.length - (compact.length % 2)) : '';
    const command = hex ? `/xj ${hex}` : `/j ${query}`;
    const hitLen = hex ? hex.length / 2 : new TextEncoder().encode(query).length;

    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const output = await rizin.executeCommand(command);
      if (seq !== searchSeqRef.current) return;
      const parsed = JSON.parse(output);
      const hits = Array.isArray(parsed)
        ? parsed
            .map((hit) => (hit && typeof hit.offset === 'number' ? hit.offset : null))
            .filter((offset): offset is number => offset != null)
            .slice(0, MAX_HITS)
        : [];
      setSearchResults(hits);
      setSearchHitLen(Math.max(1, hitLen));
      setCurrentSearchIndex(0);
      if (hits.length > 0) goToAddress(hits[0]);
    } catch {
      if (seq === searchSeqRef.current) setSearchResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [searchQuery, rizin, goToAddress]);

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

  if (totalSize <= 0) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-background text-muted-foreground', className)}>
        No mapped data to display
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-background font-mono overflow-hidden', className)}>
      <header className="flex h-9 items-center border-b border-border bg-muted/30 px-3 gap-3 shrink-0">
        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          {totalSize.toLocaleString()} bytes • {totalRows.toLocaleString()} rows
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
            placeholder="Hex bytes or text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-7 h-6 text-[11px] w-36"
          />
          {searching && <span className="text-[10px] text-muted-foreground">…</span>}
          {!searching && searchResults.length > 0 && (
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
        <div className={cn(addrColClass, 'shrink-0')}>Offset</div>
        <div className="flex-1 text-center">Hex</div>
        <div className="w-36 text-center border-l border-border pl-2">ASCII</div>
      </header>

      <div ref={containerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((line) => {
            const isCurrentRow = line.offset <= currentAddress && currentAddress < line.offset + bpr;
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
                  className={cn(addrColClass, 'shrink-0 text-code-address opacity-70 cursor-pointer hover:opacity-100')}
                  onClick={() => setCurrentAddress(line.offset)}
                >
                  {formatAddress(line.offset, addrBits)}
                </div>

                <div className="flex-1 flex gap-0.5 justify-center">
                  {line.bytes.map((byte, i) => {
                    const byteAddr = line.offset + i;
                    const isCurrent = byteAddr === currentAddress;
                    const isSearchHit = highlightSet.has(byteAddr);
                    return (
                      <span
                        key={i}
                        onClick={() => setCurrentAddress(byteAddr)}
                        className={cn(
                          'w-5 text-center text-[11px] tabular-nums cursor-pointer rounded-sm',
                          byte === null
                            ? 'text-muted-foreground/30'
                            : byte === 0
                              ? 'text-muted-foreground/25'
                              : 'text-foreground',
                          isCurrent && 'bg-primary text-primary-foreground font-semibold',
                          isSearchHit && !isCurrent && 'bg-yellow-400/80 text-black'
                        )}
                      >
                        {byte === null ? '··' : byte.toString(16).padStart(2, '0')}
                      </span>
                    );
                  })}
                  {line.bytes.length < bpr && Array(bpr - line.bytes.length).fill(0).map((_, i) => (
                    <span key={`pad-${i}`} className="w-5" />
                  ))}
                </div>

                <div className="w-36 shrink-0 text-muted-foreground border-l border-border/40 pl-2 text-[11px] tabular-nums tracking-tight">
                  {line.bytes.map((b) => (b !== null && b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·')).join('')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Viewing {visibleRowCount} of {totalRows.toLocaleString()} rows</span>
        <span>Current: {formatAddress(currentAddress, addrBits)}</span>
      </footer>
    </div>
  );
}
