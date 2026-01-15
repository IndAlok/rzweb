import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatAddressShort } from '@/lib/utils/format';
import type { RzString } from '@/types/rizin';
import { ScrollArea, Input, Badge } from '@/components/ui';
import { Search, Quote } from 'lucide-react';

interface StringsViewProps {
  strings: RzString[];
  onSelect?: (s: RzString) => void;
  className?: string;
}

export function StringsView({ strings, onSelect, className }: StringsViewProps) {
  const [filter, setFilter] = useState('');

  const filteredStrings = useMemo(() => {
    const term = filter.toLowerCase();
    return strings.filter(
      (s) =>
        s.string.toLowerCase().includes(term) ||
        formatAddressShort(s.vaddr).includes(term)
    );
  }, [strings, filter]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <div className="p-3 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Quote className="h-4 w-4 text-primary" />
            Strings
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">
              {strings.length}
            </Badge>
          </h3>
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

      <header className="flex h-8 items-center border-b border-border bg-muted/30 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0 font-mono">
        <div className="w-24">Address</div>
        <div className="w-12">Len</div>
        <div className="flex-1 px-4">String</div>
      </header>

      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/30">
          {filteredStrings.map((s, i) => (
            <button
              key={`${s.vaddr}-${i}`}
              onClick={() => onSelect?.(s)}
              className="w-full flex items-center px-4 py-2 hover:bg-accent text-left transition-colors font-mono text-xs group"
            >
              <div className="w-24 shrink-0 text-code-address opacity-80 group-hover:opacity-100">
                {s.vaddr > 1e18 ? `p:${formatAddressShort(s.paddr)}` : formatAddressShort(s.vaddr)}
              </div>
              <div className="w-12 shrink-0 text-muted-foreground text-[10px] opacity-60">
                {s.length}
              </div>
              <div className="flex-1 px-4 truncate text-foreground group-hover:whitespace-normal group-wrap-all">
                {s.string}
              </div>
            </button>
          ))}
          {filteredStrings.length === 0 && (
            <div className="p-8 text-center text-muted-foreground italic space-y-2">
              <p className="text-sm">No strings found</p>
              <p className="text-xs opacity-70">
                String extraction may be limited in WASM mode. 
                Try using the terminal: izz or /s keyword
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
