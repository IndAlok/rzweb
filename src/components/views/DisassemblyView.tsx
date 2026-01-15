import { useRef, useEffect } from 'react';
import { useUIStore } from '@/stores';
import { cn } from '@/lib/utils';
import { formatAddress } from '@/lib/utils/format';
import type { RzDisasmLine, RzReference } from '@/types/rizin';
import { ScrollArea } from '@/components/ui';
import { ChevronRight } from 'lucide-react';

interface DisassemblyViewProps {
  lines: RzDisasmLine[];
  onNavigate?: (address: number) => void;
  className?: string;
}

export function DisassemblyView({ lines, onNavigate, className }: DisassemblyViewProps) {
  const { currentAddress } = useUIStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Optional: add scroll to current address logic here
  }, [currentAddress]);

  return (
    <div className={cn('flex flex-col h-full bg-background font-mono overflow-hidden', className)}>
      <header className="flex h-8 items-center border-b border-border bg-muted/30 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        <div className="w-24">Address</div>
        <div className="w-16">Bytes</div>
        <div className="flex-1 px-2">Instruction</div>
      </header>
      
      <ScrollArea className="flex-1">
        <div className="py-2" ref={scrollRef}>
          {lines.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground italic text-sm">
              No disassembly data loaded
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.offset}
                className={cn(
                  'group flex min-h-[1.5rem] px-4 py-0.5 text-sm hover:bg-accent/50 cursor-pointer transition-colors',
                  line.offset === currentAddress && 'bg-primary/20 hover:bg-primary/25 border-l-2 border-primary'
                )}
                onClick={() => onNavigate?.(line.offset)}
              >
                <div className="w-24 shrink-0 text-code-address opacity-80 group-hover:opacity-100">
                  {formatAddress(line.offset, 32)}
                </div>
                
                <div className="w-16 shrink-0 text-muted-foreground text-[10px] truncate pr-2 opacity-60">
                  {line.bytes}
                </div>
                
                <div className="flex-1 overflow-hidden px-2">
                  <span className="text-code-instruction font-medium mr-2">
                    {line.opcode.split(' ')[0]}
                  </span>
                  <span className="text-foreground">
                    {line.opcode.split(' ').slice(1).join(' ')}
                  </span>
                  
                  {line.comment && (
                    <span className="ml-4 text-code-comment italic">
                      ; {line.comment}
                    </span>
                  )}
                  
                  {line.refs && line.refs.length > 0 && (
                    <span className="ml-2 inline-flex gap-1">
                      {line.refs.map((ref: RzReference, i: number) => (
                        <span key={i} className="inline-flex items-center rounded-full border border-transparent bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                          {ref.type}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                
                {line.jump !== undefined && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground opacity-40 self-center" />
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
