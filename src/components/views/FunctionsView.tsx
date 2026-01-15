import { useState, useMemo } from 'react';
import { useUIStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddressShort, formatSize } from '@/lib/utils/format';
import type { RzFunction } from '@/types/rizin';
import { ScrollArea, Input, Badge } from '@/components/ui';
import { Search, Hash, Box } from 'lucide-react';

interface FunctionsViewProps {
  functions: RzFunction[];
  onSelect?: (fcn: RzFunction) => void;
  className?: string;
}

export function FunctionsView({ functions, onSelect, className }: FunctionsViewProps) {
  const [filter, setFilter] = useState('');
  const { selectedFunction } = useUIStore();

  const filteredFunctions = useMemo(() => {
    const term = filter.toLowerCase();
    return functions.filter(
      (f) =>
        f.name.toLowerCase().includes(term) ||
        formatAddressShort(f.offset).includes(term)
    );
  }, [functions, filter]);

  return (
    <div className={cn('flex flex-col h-full bg-background border-r border-border', className)}>
      <div className="p-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Box className="h-4 w-4 text-primary" />
            Functions
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">
              {functions.length}
            </Badge>
          </h3>
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

      <ScrollArea className="flex-1">
        <div className="p-1">
          {filteredFunctions.map((fcn) => (
            <button
              key={fcn.offset}
              onClick={() => onSelect?.(fcn)}
              className={cn(
                'w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-md transition-colors text-left group mb-0.5',
                selectedFunction === fcn.name
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className="text-sm font-medium truncate flex-1">
                  {fcn.name}
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
                  {formatSize(fcn.size)}
                </span>
                {fcn.nbbs > 0 && (
                  <span className={cn(
                    "text-[10px]",
                    selectedFunction === fcn.name ? "text-primary-foreground/60" : "text-muted-foreground"
                  )}>
                    {fcn.nbbs} blocks
                  </span>
                )}
              </div>
            </button>
          ))}
          {filteredFunctions.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground italic">
              No functions found
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
