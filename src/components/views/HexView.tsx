import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useSettingsStore, useUIStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import type { RizinInstance } from '@/lib/rizin';
import { Input } from '@/components/ui';
import { Search, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Pencil, Binary } from 'lucide-react';

interface HexViewProps {
  rizin: RizinInstance;
  baseAddress: number;
  totalSize: number;
  className?: string;
  writeMode?: boolean;
  onAfterWrite?: () => void;
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

type SearchType = 'hex' | 'string' | 'int' | 'float';
type StringEncoding = 'ascii' | 'utf8' | 'utf16le';

export function HexView({ rizin, baseAddress, totalSize, className, writeMode = false, onAfterWrite }: HexViewProps) {
  const { hexBytesPerRow } = useSettingsStore();
  const hexTarget = useUIStore((s) => s.hexTarget);
  // The hex view addresses the raw file (physical offsets), so the cursor is
  // local rather than the shared virtual-address seek.
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const cancelEditRef = useRef(false);
  const scrollTopRef = useRef(0);
  const fetchSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const [editing, setEditing] = useState<{ addr: number; value: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [memWindow, setMemWindow] = useState<MemWindow>(EMPTY_WINDOW);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('string');
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const [encoding, setEncoding] = useState<StringEncoding>('ascii');
  const [intWidth, setIntWidth] = useState<1 | 2 | 4 | 8>(4);
  const [floatWidth, setFloatWidth] = useState<32 | 64>(32);
  const [bigEndian, setBigEndian] = useState(false);
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchHitLen, setSearchHitLen] = useState(1);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorBE, setInspectorBE] = useState(false);

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
      .readFileSlice(startAddr, length)
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

  // Interpret the bytes at the cursor as the common scalar types.
  const inspector = useMemo(() => {
    const offset = cursor - memWindow.start;
    if (!showInspector || offset < 0 || offset >= memWindow.bytes.length) return null;
    const slice = memWindow.bytes.subarray(offset, offset + 8);
    const n = slice.length;
    const buf = new Uint8Array(8);
    buf.set(slice);
    const dv = new DataView(buf.buffer);
    const le = !inspectorBE;
    const fmtFloat = (v: number) => (Number.isFinite(v) ? (Object.is(v, -0) ? '0' : Number(v.toPrecision(7)).toString()) : String(v));
    const rows: Array<{ label: string; value: string }> = [
      { label: 'int8', value: n >= 1 ? String(dv.getInt8(0)) : '—' },
      { label: 'uint8', value: n >= 1 ? String(dv.getUint8(0)) : '—' },
      { label: 'int16', value: n >= 2 ? String(dv.getInt16(0, le)) : '—' },
      { label: 'uint16', value: n >= 2 ? String(dv.getUint16(0, le)) : '—' },
      { label: 'int32', value: n >= 4 ? String(dv.getInt32(0, le)) : '—' },
      { label: 'uint32', value: n >= 4 ? String(dv.getUint32(0, le)) : '—' },
      { label: 'int64', value: n >= 8 ? dv.getBigInt64(0, le).toString() : '—' },
      { label: 'uint64', value: n >= 8 ? dv.getBigUint64(0, le).toString() : '—' },
      { label: 'float32', value: n >= 4 ? fmtFloat(dv.getFloat32(0, le)) : '—' },
      { label: 'float64', value: n >= 8 ? fmtFloat(dv.getFloat64(0, le)) : '—' },
      { label: 'char', value: n >= 1 && slice[0] >= 0x20 && slice[0] <= 0x7e ? `'${String.fromCharCode(slice[0])}'` : '—' },
      { label: 'binary', value: n >= 1 ? slice[0].toString(2).padStart(8, '0') : '—' },
    ];
    return rows;
  }, [showInspector, inspectorBE, cursor, memWindow]);

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
    setCursor(addr);
  }, [baseAddress, bpr, scrollToRow, setCursor]);

  // Jump to a physical offset requested from another view ("show in hex").
  useEffect(() => {
    if (hexTarget) goToAddress(hexTarget.offset);
    // Re-run on each new request, even for the same offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexTarget?.nonce]);

  useEffect(() => {
    if (cursor < baseAddress || cursor >= baseAddress + totalSize) return;
    const rowTop = Math.floor((cursor - baseAddress) / bpr) * ROW_HEIGHT;
    const viewTop = scrollTopRef.current;
    if (rowTop < viewTop || rowTop + ROW_HEIGHT > viewTop + containerHeight) {
      scrollToRow(Math.floor((cursor - baseAddress) / bpr));
    }
  }, [cursor, baseAddress, totalSize, bpr, containerHeight, scrollToRow]);

  // Builds the byte pattern to search for over the raw file. Returns the needle
  // plus a case-insensitive flag (ASCII only). null when the query is incomplete.
  const buildNeedle = useCallback((): { needle: Uint8Array; caseInsensitive: boolean } | null => {
    const q = searchQuery;
    if (searchType === 'hex') {
      const hex = q.replace(/[^0-9a-fA-F]/g, '');
      if (hex.length < 2) return null;
      const even = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
      const bytes = new Uint8Array(even.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(even.slice(i * 2, i * 2 + 2), 16);
      return { needle: bytes, caseInsensitive: false };
    }
    if (searchType === 'string') {
      if (!q) return null;
      let bytes: Uint8Array;
      if (encoding === 'utf16le') {
        bytes = new Uint8Array(q.length * 2);
        for (let i = 0; i < q.length; i++) {
          const c = q.charCodeAt(i);
          bytes[i * 2] = c & 0xff;
          bytes[i * 2 + 1] = (c >> 8) & 0xff;
        }
      } else if (encoding === 'utf8') {
        bytes = new TextEncoder().encode(q);
      } else {
        bytes = new Uint8Array(q.length);
        for (let i = 0; i < q.length; i++) bytes[i] = q.charCodeAt(i) & 0xff;
      }
      return { needle: bytes, caseInsensitive };
    }
    if (searchType === 'int') {
      const trimmed = q.trim();
      if (!/^-?(0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) return null;
      const mask = (1n << BigInt(intWidth * 8)) - 1n;
      const u = BigInt(trimmed) & mask;
      const bytes = new Uint8Array(intWidth);
      const dv = new DataView(bytes.buffer);
      if (intWidth === 1) dv.setUint8(0, Number(u));
      else if (intWidth === 2) dv.setUint16(0, Number(u), !bigEndian);
      else if (intWidth === 4) dv.setUint32(0, Number(u), !bigEndian);
      else dv.setBigUint64(0, u, !bigEndian);
      return { needle: bytes, caseInsensitive: false };
    }
    const num = Number(q);
    if (!Number.isFinite(num) || q.trim() === '') return null;
    const bytes = new Uint8Array(floatWidth / 8);
    const dv = new DataView(bytes.buffer);
    if (floatWidth === 32) dv.setFloat32(0, num, !bigEndian);
    else dv.setFloat64(0, num, !bigEndian);
    return { needle: bytes, caseInsensitive: false };
  }, [searchQuery, searchType, caseInsensitive, encoding, intWidth, floatWidth, bigEndian]);

  const handleSearch = useCallback(async () => {
    const built = buildNeedle();
    setHasSearched(true);
    if (!built) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const matches = await rizin.searchFileBytes(built.needle, built.caseInsensitive);
      if (seq !== searchSeqRef.current) return;
      setSearchResults(matches.slice(0, MAX_HITS));
      setSearchHitLen(Math.max(1, built.needle.length));
      setCurrentSearchIndex(0);
      if (matches.length > 0) goToAddress(matches[0]);
    } catch {
      if (seq === searchSeqRef.current) setSearchResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [buildNeedle, rizin, goToAddress]);

  const navigateResult = useCallback((direction: 1 | -1) => {
    if (searchResults.length === 0) return;
    const next = (currentSearchIndex + direction + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(next);
    goToAddress(searchResults[next]);
  }, [searchResults, currentSearchIndex, goToAddress]);

  const resetSearch = useCallback(() => {
    setSearchResults([]);
    setHasSearched(false);
  }, []);

  // Locking editing discards any in-progress byte edit.
  useEffect(() => {
    if (!writeMode) setEditing(null);
  }, [writeMode]);

  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  const beginEdit = useCallback((addr: number, current: number | null) => {
    if (!writeMode || current === null) return;
    cancelEditRef.current = false;
    setEditing({ addr, value: '' });
  }, [writeMode]);

  const cancelEdit = useCallback(() => {
    cancelEditRef.current = true;
    setEditing(null);
  }, []);

  const commitEdit = useCallback(async () => {
    // Escape sets this before the unmount blur fires, so skip the commit.
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    if (!editing) return;
    const value = editing.value;
    const addr = editing.addr;
    setEditing(null);
    if (value.length === 0) return;

    const result = await rizin.patchFile(addr, value);
    if (!result.ok) {
      toast.error(result.error ?? 'Write failed');
      return;
    }
    // Refetch the window so the patched byte shows immediately.
    fetchSeqRef.current++;
    setMemWindow(EMPTY_WINDOW);
    onAfterWrite?.();
  }, [editing, rizin, onAfterWrite]);

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
        <span className="hidden whitespace-nowrap text-[10px] font-medium text-muted-foreground sm:inline">
          {totalSize.toLocaleString()} bytes • {totalRows.toLocaleString()} rows
        </span>
        <span className="hidden text-[10px] text-muted-foreground lg:inline">
          Row {Math.floor(scrollTop / ROW_HEIGHT) + 1}
        </span>
        {writeMode && (
          <span
            className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-500"
            title="Double-click a byte to edit"
          >
            <Pencil className="h-2.5 w-2.5" />
            Edit
          </span>
        )}
        <div className="hidden gap-1 md:flex">
          <button onClick={jumpToStart} className="p-1 hover:bg-accent rounded" title="Jump to start">
            <ChevronUp className="h-3 w-3" />
          </button>
          <button onClick={jumpToEnd} className="p-1 hover:bg-accent rounded" title="Jump to end">
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => setShowInspector((v) => !v)}
          className={cn('rounded p-1 hover:bg-accent', showInspector && 'text-primary')}
          title="Data inspector"
        >
          <Binary className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <select
            value={searchType}
            onChange={(e) => { setSearchType(e.target.value as SearchType); resetSearch(); }}
            className="h-6 rounded border border-border bg-background px-1 text-[11px]"
            title="Search type"
          >
            <option value="hex">Hex</option>
            <option value="string">Text</option>
            <option value="int">Int</option>
            <option value="float">Float</option>
          </select>

          {searchType === 'string' && (
            <>
              <button
                onClick={() => { setCaseInsensitive((v) => !v); resetSearch(); }}
                title={caseInsensitive ? 'Case-insensitive (click for case-sensitive)' : 'Case-sensitive (click to ignore case)'}
                className={cn('h-6 rounded border px-1.5 text-[11px] font-medium', caseInsensitive ? 'border-border text-muted-foreground' : 'border-primary text-primary')}
              >
                Aa
              </button>
              <select
                value={encoding}
                onChange={(e) => { setEncoding(e.target.value as StringEncoding); resetSearch(); }}
                className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                title="Encoding"
              >
                <option value="ascii">ASCII</option>
                <option value="utf8">UTF-8</option>
                <option value="utf16le">UTF-16</option>
              </select>
            </>
          )}
          {(searchType === 'int' || searchType === 'float') && (
            <>
              <select
                value={searchType === 'int' ? intWidth : floatWidth}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (searchType === 'int') setIntWidth(n as 1 | 2 | 4 | 8);
                  else setFloatWidth(n as 32 | 64);
                  resetSearch();
                }}
                className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                title="Width"
              >
                {searchType === 'int'
                  ? [1, 2, 4, 8].map((w) => <option key={w} value={w}>{w}B</option>)
                  : [32, 64].map((w) => <option key={w} value={w}>{w}b</option>)}
              </select>
              <button
                onClick={() => { setBigEndian((v) => !v); resetSearch(); }}
                title={bigEndian ? 'Big-endian (click for little-endian)' : 'Little-endian (click for big-endian)'}
                className="h-6 rounded border border-border px-1.5 text-[11px] font-medium text-muted-foreground"
              >
                {bigEndian ? 'BE' : 'LE'}
              </button>
            </>
          )}

          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder={searchType === 'hex' ? 'deadbeef' : searchType === 'string' ? 'text…' : searchType === 'int' ? '0x1000' : '3.14'}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); resetSearch(); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (searchResults.length > 0) navigateResult(e.shiftKey ? -1 : 1);
                else handleSearch();
              }}
              className="pl-7 h-6 text-[11px] w-32"
            />
          </div>

          <button onClick={handleSearch} className="rounded p-1 hover:bg-accent" title="Search (Enter)">
            <Search className="h-3 w-3" />
          </button>

          {searching && <span className="text-[10px] text-muted-foreground">…</span>}
          {!searching && searchResults.length > 0 && (
            <>
              <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button onClick={() => navigateResult(-1)} className="rounded p-0.5 hover:bg-accent" title="Previous (Shift+Enter)">
                <ArrowUp className="h-3 w-3" />
              </button>
              <button onClick={() => navigateResult(1)} className="rounded p-0.5 hover:bg-accent" title="Next (Enter)">
                <ArrowDown className="h-3 w-3" />
              </button>
            </>
          )}
          {!searching && hasSearched && searchResults.length === 0 && (
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">No matches</span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-6 items-center border-b border-border bg-muted/20 px-3 text-[9px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        <div className={cn(addrColClass, 'shrink-0')}>Offset</div>
        <div className="flex-1 text-center">Hex</div>
        <div className="w-36 text-center border-l border-border pl-2">ASCII</div>
      </header>

      <div ref={containerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((line) => {
            const isCurrentRow = line.offset <= cursor && cursor < line.offset + bpr;
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
                  onClick={() => setCursor(line.offset)}
                >
                  {formatAddress(line.offset, addrBits)}
                </div>

                <div className="flex-1 flex gap-0.5 justify-center">
                  {line.bytes.map((byte, i) => {
                    const byteAddr = line.offset + i;
                    const isCurrent = byteAddr === cursor;
                    const isSearchHit = highlightSet.has(byteAddr);
                    if (editing && editing.addr === byteAddr) {
                      return (
                        <input
                          key={i}
                          ref={editInputRef}
                          value={editing.value}
                          onChange={(e) =>
                            setEditing({ addr: byteAddr, value: e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2) })
                          }
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            else if (e.key === 'Escape') cancelEdit();
                          }}
                          className="w-5 text-center text-[11px] tabular-nums rounded-sm bg-primary text-primary-foreground outline-none ring-1 ring-primary-foreground/60 lowercase"
                        />
                      );
                    }
                    return (
                      <span
                        key={i}
                        onClick={() => setCursor(byteAddr)}
                        onDoubleClick={() => beginEdit(byteAddr, byte)}
                        title={writeMode && byte !== null ? 'Double-click to edit' : undefined}
                        className={cn(
                          'w-5 text-center text-[11px] tabular-nums cursor-pointer rounded-sm',
                          byte === null
                            ? 'text-muted-foreground/30'
                            : byte === 0
                              ? 'text-muted-foreground/25'
                              : 'text-foreground',
                          isCurrent && 'bg-primary text-primary-foreground font-semibold',
                          isSearchHit && !isCurrent && 'bg-yellow-400/80 text-black',
                          writeMode && byte !== null && !isCurrent && 'hover:bg-primary/30'
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

                <div className="w-36 shrink-0 whitespace-pre border-l border-border/40 pl-2 text-[11px] tabular-nums tracking-tight text-muted-foreground">
                  {line.bytes.map((byte, i) => {
                    const byteAddr = line.offset + i;
                    const isCurrent = byteAddr === cursor;
                    const isSearchHit = highlightSet.has(byteAddr);
                    const printable = byte !== null && byte >= 0x20 && byte <= 0x7e;
                    return (
                      <span
                        key={i}
                        onClick={() => setCursor(byteAddr)}
                        className={cn(
                          'cursor-pointer',
                          !printable && 'text-muted-foreground/40',
                          isCurrent && 'bg-primary text-primary-foreground',
                          isSearchHit && !isCurrent && 'bg-yellow-400/80 text-black'
                        )}
                      >
                        {printable ? String.fromCharCode(byte as number) : '·'}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
        </div>

        {showInspector && inspector && (
          <aside className="w-44 shrink-0 overflow-auto border-l border-border bg-muted/20 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Inspector</span>
              <button
                onClick={() => setInspectorBE((v) => !v)}
                className="rounded border border-border px-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                title={inspectorBE ? 'Big-endian (click for little-endian)' : 'Little-endian (click for big-endian)'}
              >
                {inspectorBE ? 'BE' : 'LE'}
              </button>
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {inspector.map((row) => (
                  <tr key={row.label} className="border-b border-border/40 last:border-0">
                    <td className="py-0.5 pr-2 text-muted-foreground">{row.label}</td>
                    <td className="break-all py-0.5 text-right font-mono tabular-nums text-foreground">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </aside>
        )}
      </div>

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Viewing {visibleRowCount} of {totalRows.toLocaleString()} rows</span>
        <span>Current: {formatAddress(cursor, addrBits)}</span>
      </footer>
    </div>
  );
}
