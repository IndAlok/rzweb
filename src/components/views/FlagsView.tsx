import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatAddressShort } from '@/lib/utils/format';
import { Input, Button, ScrollArea, Badge } from '@/components/ui';
import { Flag, Plus, Trash2, Search, RefreshCw } from 'lucide-react';
import type { RizinInstance } from '@/lib/rizin';

interface FlagEntry {
  name: string;
  offset: number;
  size: number;
}

interface FlagsViewProps {
  rizin: RizinInstance;
  onSeek?: (address: number) => void;
  className?: string;
}

const MAX_ROWS = 2000;

export function FlagsView({ rizin, onSeek, className }: FlagsViewProps) {
  const [flags, setFlags] = useState<FlagEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddr, setNewAddr] = useState('');

  const refresh = useCallback(async () => {
    try {
      const out = await rizin.executeCommand('flj');
      const parsed = JSON.parse(out);
      const list: FlagEntry[] = Array.isArray(parsed)
        ? parsed
            .map((f) => ({ name: String(f?.name ?? ''), offset: Number(f?.offset ?? 0), size: Number(f?.size ?? 0) }))
            .filter((f) => f.name)
        : [];
      setFlags(list);
    } catch {
      setFlags([]);
    }
  }, [rizin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return flags;
    return flags.filter((f) => f.name.toLowerCase().includes(term) || formatAddressShort(f.offset).includes(term));
  }, [flags, filter]);

  const addFlag = useCallback(async () => {
    const name = newName.trim().replace(/[^A-Za-z0-9_.]/g, '_');
    const addr = newAddr.trim();
    if (!name || !addr) return;
    await rizin.executeCommand(`f ${name} @ ${addr}`);
    setNewName('');
    setNewAddr('');
    toast.success('Flag added');
    await refresh();
  }, [newName, newAddr, rizin, refresh]);

  const deleteFlag = useCallback(async (name: string) => {
    await rizin.executeCommand(`f-${name}`);
    await refresh();
  }, [rizin, refresh]);

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Flag className="h-4 w-4 text-primary" />
            Flags
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 py-0 text-[10px]">
              {filtered.length.toLocaleString()}{filter && ` / ${flags.length.toLocaleString()}`}
            </Badge>
          </h3>
          <button onClick={() => void refresh()} className="rounded p-1 hover:bg-accent" title="Refresh">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Filter flags..." value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 pl-8 text-xs" />
        </div>
        <div className="flex items-center gap-1">
          <Input
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFlag()}
            className="h-7 flex-1 text-[11px]"
          />
          <Input
            placeholder="0x address"
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFlag()}
            className="h-7 w-28 text-[11px]"
          />
          <Button size="sm" variant="ghost" onClick={addFlag} title="Add flag" disabled={!newName.trim() || !newAddr.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-xs italic text-muted-foreground">No flags</p>
          ) : (
            filtered.slice(0, MAX_ROWS).map((f) => (
              <div
                key={f.name}
                onClick={() => onSeek?.(f.offset)}
                className="group flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-accent/50"
              >
                <span className="min-w-0 flex items-center gap-1.5">
                  <Flag className="h-3 w-3 shrink-0 opacity-50" />
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-code-address">{formatAddressShort(f.offset)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteFlag(f.name); }}
                    className="rounded p-0.5 opacity-0 hover:text-destructive group-hover:opacity-100"
                    title="Delete flag"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
            ))
          )}
          {filtered.length > MAX_ROWS && (
            <p className="p-2 text-center text-[10px] text-muted-foreground">Showing first {MAX_ROWS.toLocaleString()}. Refine the filter to see more.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
