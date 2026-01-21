import { useMemo } from 'react';
import { useUIStore, useSettingsStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import { ScrollArea } from '@/components/ui';

interface HexViewProps {
  data: Uint8Array;
  offset: number;
  className?: string;
}

export function HexView({ data, offset, className }: HexViewProps) {
  const { hexBytesPerRow } = useSettingsStore();
  const { currentAddress } = useUIStore();
  
  const lines = useMemo(() => {
    const res = [];
    for (let i = 0; i < data.length; i += hexBytesPerRow) {
      const chunk = data.slice(i, i + hexBytesPerRow);
      res.push({
        offset: offset + i,
        bytes: Array.from(chunk),
      });
    }
    return res;
  }, [data, offset, hexBytesPerRow]);

  return (
    <div className={cn('flex flex-col h-full bg-background font-mono overflow-hidden', className)}>
      <header className="flex h-8 items-center border-b border-border bg-muted/30 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        <div className="w-24">Offset</div>
        <div className="flex-1 px-4 text-center">Hex</div>
        <div className="w-48 text-center border-l border-border">ASCII</div>
      </header>

      <ScrollArea className="flex-1">
        <div className="py-2">
          {lines.map((line) => (
            <div
              key={line.offset}
              className={cn(
                'flex px-4 py-0.5 text-sm hover:bg-accent/30 leading-tight transition-colors',
                line.offset <= currentAddress && currentAddress < line.offset + hexBytesPerRow && 'bg-primary/10'
              )}
            >
              <div className="w-24 shrink-0 text-code-address opacity-80">
                {formatAddress(line.offset, 32)}
              </div>

              <div className="flex-1 px-4 flex gap-1 justify-center">
                {line.bytes.map((byte, i) => {
                  const isCurrent = line.offset + i === currentAddress;
                  return (
                    <span
                      key={i}
                      className={cn(
                        'w-6 text-center text-xs tabular-nums',
                        byte === 0 ? 'text-muted-foreground/30' : 'text-foreground',
                        isCurrent && 'bg-primary text-primary-foreground rounded-sm font-bold'
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
      </ScrollArea>
    </div>
  );
}
