import { cn } from '@/lib/utils';
import { formatAddress, formatSize } from '@/lib/utils/format';
import { Info, Shield, ShieldCheck, ShieldX } from 'lucide-react';
import type { RzBinInfo } from '@/types/rizin';

interface HeaderInfoPanelProps {
  info: RzBinInfo | null;
  fileSize?: number;
  className?: string;
}

function SecurityBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium',
      enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
    )}>
      {enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
      {label}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono text-foreground">{String(value)}</span>
    </div>
  );
}

export function HeaderInfoPanel({ info, fileSize, className }: HeaderInfoPanelProps) {
  if (!info) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm text-muted-foreground', className)}>
        No binary info available
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-auto', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Binary Info</span>
      </div>

      <div className="p-4 space-y-6">
        <section>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Architecture</h4>
          <div className="space-y-0">
            <InfoRow label="Architecture" value={info.arch} />
            <InfoRow label="Bits" value={info.bits} />
            <InfoRow label="Endianness" value={info.endian} />
            <InfoRow label="OS" value={info.os} />
            <InfoRow label="Machine" value={info.machine} />
            <InfoRow label="Class" value={info.class} />
            <InfoRow label="Subsystem" value={info.subsys} />
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Binary</h4>
          <div className="space-y-0">
            <InfoRow label="Type" value={info.bintype} />
            <InfoRow label="Compiler" value={info.compiler} />
            <InfoRow label="Language" value={info.lang} />
            <InfoRow label="Interpreter" value={info.intrp} />
            <InfoRow label="Base Address" value={formatAddress(info.baddr, info.bits || 64)} />
            <InfoRow label="Binary Size" value={info.binsz ? formatSize(info.binsz) : undefined} />
            {fileSize && <InfoRow label="File Size" value={formatSize(fileSize)} />}
            <InfoRow label="Compiled" value={info.compiled} />
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Security
            </div>
          </h4>
          <div className="flex flex-wrap gap-2">
            <SecurityBadge enabled={!!info.canary} label="Canary" />
            <SecurityBadge enabled={!!info.nx} label="NX" />
            <SecurityBadge enabled={!!info.pic} label="PIC" />
            <SecurityBadge enabled={!!info.crypto} label="Crypto" />
            <SecurityBadge enabled={!info.stripped} label="Symbols" />
            <SecurityBadge enabled={!!info.static} label="Static" />
            <SecurityBadge enabled={!!info.relocs} label="Relocs" />
          </div>
        </section>

        {info.checksums && Object.keys(info.checksums).length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Checksums</h4>
            <div className="space-y-0">
              {Object.entries(info.checksums).map(([algo, hash]) => (
                <InfoRow key={algo} label={algo.toUpperCase()} value={hash} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
