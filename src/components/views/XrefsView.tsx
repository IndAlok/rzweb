import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { ArrowLeftRight, ArrowRight, ArrowLeft } from 'lucide-react';
import type { RizinInstance, XrefEntry } from '@/lib/rizin';

interface XrefsViewProps {
  rizin: RizinInstance;
  address: number;
  onSeek?: (address: number) => void;
  className?: string;
}

function XrefRow({ entry, onSeek }: { entry: XrefEntry; onSeek?: (address: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSeek?.(entry.addr)}
      className="flex w-full items-center gap-3 border-b border-border/30 px-3 py-1.5 text-left transition-colors hover:bg-accent/50"
    >
      <span className="w-24 shrink-0 font-mono text-xs text-primary">{formatAddress(entry.addr, 32)}</span>
      {entry.type && (
        <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">{entry.type}</span>
      )}
      <span className="flex-1 truncate font-mono text-xs text-foreground">
        {entry.opcode || entry.name || ''}
      </span>
      {entry.opcode && entry.name && (
        <span className="hidden max-w-[140px] truncate font-mono text-[10px] text-cyan-400 sm:block">{entry.name}</span>
      )}
    </button>
  );
}

export function XrefsView({ rizin, address, onSeek, className }: XrefsViewProps) {
  const [to, setTo] = useState<XrefEntry[]>([]);
  const [from, setFrom] = useState<XrefEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (address <= 0) {
      setTo([]);
      setFrom([]);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    rizin
      .getXrefs(address)
      .then((result) => {
        if (requestId !== requestRef.current) return;
        setTo(result.to);
        setFrom(result.from);
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setTo([]);
        setFrom([]);
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
  }, [rizin, address]);

  if (address <= 0) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 text-muted-foreground', className)}>
        <ArrowLeftRight className="h-12 w-12 opacity-30" />
        <p className="text-sm">Select a function or seek to an address to see cross-references.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col overflow-auto', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">
          Cross-references at {formatAddress(address, 32)}
        </span>
        {loading && <span className="ml-auto text-[10px] text-muted-foreground">Loading...</span>}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-emerald-500">
        <ArrowLeft className="h-3 w-3" /> Referenced from ({to.length})
      </div>
      {to.length === 0 ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">No incoming references.</p>
      ) : (
        to.map((entry, i) => <XrefRow key={`to-${i}`} entry={entry} onSeek={onSeek} />)
      )}

      <div className="mt-2 flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-blue-400">
        <ArrowRight className="h-3 w-3" /> Calls / references out ({from.length})
      </div>
      {from.length === 0 ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">No outgoing references.</p>
      ) : (
        from.map((entry, i) => <XrefRow key={`from-${i}`} entry={entry} onSeek={onSeek} />)
      )}
    </div>
  );
}
