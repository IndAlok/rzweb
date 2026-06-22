import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useUIStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddressShort, formatSize } from '@/lib/utils/format';
import type { RzFunction } from '@/types/rizin';
import { Input, Badge } from '@/components/ui';
import { Search, Hash, Box, ChevronUp, ChevronDown, Pencil, Binary } from 'lucide-react';

interface FunctionsViewProps {
  functions: RzFunction[];
  onSelect?: (fcn: RzFunction) => void;
  onRename?: (offset: number, name: string) => void;
  onShowInHex?: (offset: number) => void;
  className?: string;
}

const ROW_HEIGHT = 52;
const OVERSCAN = 5;

export function FunctionsView({ functions, onSelect, onRename, onShowInHex, className }: FunctionsViewProps) {
  const [filter, setFilter] = useState('');
  const { selectedFunction } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const [renaming, setRenaming] = useState<{ offset: number; value: string } | null>(null);

  const submitRename = useCallback(() => {
    if (renaming) onRename?.(renaming.offset, renaming.value);
    setRenaming(null);
  }, [renaming, onRename]);

  const validFunctions = useMemo(() => {
    return functions.filter(f => f && typeof f.name === 'string');
  }, [functions]);

  const filteredFunctions = useMemo(() => {
    if (!filter.trim()) return validFunctions;
    const term = filter.toLowerCase();
    return validFunctions.filter(
      (f) =>
        (f.name?.toLowerCase() || '').includes(term) ||
        formatAddressShort(f.offset).includes(term)
    );
  }, [validFunctions, filter]);

  const totalRows = filteredFunctions.length;
  const totalHeight = totalRows * ROW_HEIGHT;
  
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  
  const visibleRows = useMemo(() => {
    return filteredFunctions.slice(startRow, endRow).map((f, i) => ({
      index: startRow + i,
      data: f
    }));
  }, [filteredFunctions, startRow, endRow]);

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

  const handleFunctionClick = useCallback((fcn: RzFunction) => {
    if (!fcn.name) return;
    navigator.clipboard.writeText(fcn.name).then(() => {
      toast.success(`Copied: ${fcn.name}`, { duration: 1500 });
    }).catch(() => {
      toast.error('Failed to copy');
    });
    onSelect?.(fcn);
  }, [onSelect]);

  const jumpToStart = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, []);

  const jumpToEnd = useCallback(() => {
    if (containerRef.current) containerRef.current.scrollTop = totalHeight - containerHeight;
  }, [totalHeight, containerHeight]);

  return (
    <div className={cn('flex flex-col h-full bg-background border-r border-border', className)}>
      <div className="p-3 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Box className="h-4 w-4 text-primary" />
            Functions
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">
              {filteredFunctions.length.toLocaleString()}{filter && ` / ${validFunctions.length.toLocaleString()}`}
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
            placeholder="Search functions..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-1"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map(({ index, data: fcn }) => (
            <div
              key={`${fcn.offset ?? index}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => handleFunctionClick(fcn)}
              style={{
                position: 'absolute',
                top: index * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
              className={cn(
                'w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-md transition-colors text-left group mx-0.5 cursor-pointer',
                selectedFunction === fcn.name
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <div className="flex items-center justify-between w-full gap-2">
                {renaming?.offset === fcn.offset ? (
                  <Input
                    autoFocus
                    value={renaming.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ offset: fcn.offset, value: e.target.value })}
                    onBlur={submitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      else if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="h-5 flex-1 text-xs"
                  />
                ) : (
                  <span className="text-sm font-medium truncate flex-1">
                    {fcn.name || '<unnamed>'}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                  {onRename && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming({ offset: fcn.offset, value: fcn.name ?? '' }); }}
                      className="rounded p-0.5 hover:bg-background/30"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {onShowInHex && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onShowInHex(fcn.offset); }}
                      className="rounded p-0.5 hover:bg-background/30"
                      title="Show in hex"
                    >
                      <Binary className="h-3 w-3" />
                    </button>
                  )}
                </span>
                <span className={cn(
                  "text-[10px] tabular-nums",
                  selectedFunction === fcn.name ? "text-primary-foreground/70" : "text-muted-foreground"
                )}>
                  {formatAddressShort(fcn.offset)}
                </span>
              </div>
              <div className="flex items-center gap-3 w-full">
                <span className={cn(
                  "text-[10px] flex items-center gap-1",
                  selectedFunction === fcn.name ? "text-primary-foreground/60" : "text-muted-foreground"
                )}>
                  <Hash className="h-3 w-3" />
                  {formatSize(fcn.size ?? 0)}
                </span>
                {(fcn.nbbs ?? 0) > 0 && (
                  <span className={cn(
                    "text-[10px]",
                    selectedFunction === fcn.name ? "text-primary-foreground/60" : "text-muted-foreground"
                  )}>
                    {fcn.nbbs} blocks
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {filteredFunctions.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground italic">
          {filter ? 'No functions match filter' : 'No functions found'}
        </div>
      )}

      <footer className="flex h-5 items-center justify-between border-t border-border bg-muted/20 px-3 text-[9px] text-muted-foreground shrink-0">
        <span>Viewing {Math.min(endRow - startRow, totalRows)} of {totalRows.toLocaleString()}</span>
        <span>Row {Math.floor(scrollTop / ROW_HEIGHT) + 1}</span>
      </footer>
    </div>
  );
}
