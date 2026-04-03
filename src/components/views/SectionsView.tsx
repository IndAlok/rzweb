import { cn } from '@/lib/utils';
import { formatAddress, formatSize } from '@/lib/utils/format';
import { Layers } from 'lucide-react';
import type { RzSection } from '@/types/rizin';

interface SectionsViewProps {
  sections: RzSection[];
  onNavigate?: (address: number) => void;
  className?: string;
}

function permBadge(perm: string) {
  const colors: Record<string, string> = {
    r: 'text-green-400',
    w: 'text-yellow-400',
    x: 'text-red-400',
  };
  return (
    <div className="flex gap-0.5">
      {['r', 'w', 'x'].map(p => (
        <span
          key={p}
          className={cn(
            'text-[10px] font-mono font-bold w-4 text-center',
            perm.includes(p) ? colors[p] : 'text-muted-foreground/30'
          )}
        >
          {perm.includes(p) ? p : '-'}
        </span>
      ))}
    </div>
  );
}

export function SectionsView({ sections, onNavigate, className }: SectionsViewProps) {
  const maxSize = Math.max(...sections.map(s => s.size), 1);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Sections</span>
        <span className="text-xs text-muted-foreground ml-auto">{sections.length}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">VAddr</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Size</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Perm</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Usage</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-border/30 cursor-pointer hover:bg-accent/50 transition-colors',
                  i % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                )}
                onClick={() => sec.vaddr && onNavigate?.(sec.vaddr)}
              >
                <td className="px-3 py-2 font-mono text-cyan-400 truncate max-w-[160px]">{sec.name}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{formatAddress(sec.vaddr, 32)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatSize(sec.size)}</td>
                <td className="px-3 py-2">{permBadge(sec.perm || '')}</td>
                <td className="px-3 py-2">
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full"
                      style={{ width: `${(sec.size / maxSize) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sections.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No sections found
          </div>
        )}
      </div>
    </div>
  );
}
