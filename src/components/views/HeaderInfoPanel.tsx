import { cn } from '@/lib/utils';
import { formatAddress, formatSize } from '@/lib/utils/format';
import { Info, Shield, ShieldCheck, ShieldX } from 'lucide-react';

interface HeaderInfoPanelProps {
  info: unknown;
  fileSize?: number;
  className?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function prettyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function isAddressKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('addr') || lower.endsWith('entry') || lower === 'fd' || lower === 'offset';
}

function isSizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('size') || lower.endsWith('sz') || lower === 'block';
}

function formatValue(key: string, value: unknown, bits = 64): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (isAddressKey(key)) return formatAddress(value, bits);
    if (isSizeKey(key) && value > 0) return `${formatSize(value)} (${value})`;
    return value.toLocaleString();
  }
  if (Array.isArray(value)) {
    const primitiveItems = value.every(
      item => item == null || ['string', 'number', 'boolean'].includes(typeof item)
    );
    return primitiveItems
      ? value.map(item => formatValue(key, item, bits)).join(', ')
      : `${value.length.toLocaleString()} items`;
  }
  if (value && typeof value === 'object') {
    const record = asRecord(value);
    if (!record) return JSON.stringify(value, null, 2);

    const recordValues = Object.values(record);
    const primitiveRecord = recordValues.every(
      entry => entry == null || ['string', 'number', 'boolean'].includes(typeof entry)
    );
    return primitiveRecord
      ? JSON.stringify(record, null, 2)
      : `${Object.keys(record).length.toLocaleString()} fields`;
  }
  return String(value);
}

function SecurityBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium',
        enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
      )}
    >
      {enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
      {label}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/20 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="max-w-[60%] break-words text-right font-mono text-xs text-foreground">
        {value}
      </span>
    </div>
  );
}

function InfoSection({
  title,
  data,
  bits,
}: {
  title: string;
  data: Record<string, unknown>;
  bits?: number;
}) {
  const entries = Object.entries(data).filter(([, value]) => value != null && value !== '');

  if (entries.length === 0) return null;

  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-0">
        {entries.map(([key, value]) => (
          <InfoRow key={key} label={prettyLabel(key)} value={formatValue(key, value, bits)} />
        ))}
      </div>
    </section>
  );
}

function ArraySection({
  title,
  items,
  bits,
}: {
  title: string;
  items: unknown[];
  bits?: number;
}) {
  if (items.length === 0) return null;

  const previewLimit = title.toLowerCase().includes('relocation') || title.toLowerCase().includes('version')
    ? 20
    : 40;
  const visibleItems = items.slice(0, previewLimit);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {items.length.toLocaleString()} items
        </span>
      </div>

      <div className="space-y-2">
        {visibleItems.map((item, index) => {
          const record = asRecord(item);

          if (!record) {
            return (
              <div
                key={`${title}-${index}`}
                className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 font-mono text-xs text-foreground"
              >
                {formatValue('value', item, bits)}
              </div>
            );
          }

          const entries = Object.entries(record).filter(([, value]) => value != null && value !== '');
          return (
            <div
              key={`${title}-${index}`}
              className="rounded-md border border-border/40 bg-muted/20 px-3 py-2"
            >
              <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
                {entries.slice(0, 8).map(([key, value]) => (
                  <InfoRow
                    key={key}
                    label={prettyLabel(key)}
                    value={formatValue(key, value, bits)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {items.length > visibleItems.length && (
          <p className="text-xs text-muted-foreground">
            Showing the first {visibleItems.length.toLocaleString()} items to keep the panel responsive.
          </p>
        )}
      </div>
    </section>
  );
}

export function HeaderInfoPanel({ info, fileSize, className }: HeaderInfoPanelProps) {
  const root = asRecord(info);
  const overview = asRecord(root?.overview) ?? root;
  const core = asRecord(overview?.core) ?? {};
  const legacyBin = asRecord(overview?.bin);
  const richBin = asRecord(root?.binaryInfo);
  const bin = richBin ?? legacyBin ?? asRecord(info) ?? {};
  const bits = typeof bin.bits === 'number' ? bin.bits : 64;

  const summaryData: Record<string, unknown> = {};
  if (fileSize) summaryData.fileSize = fileSize;
  if (Object.keys(core).length === 0 && Object.keys(bin).length > 0) {
    Object.assign(summaryData, bin);
  }

  const extraObjectSections = Object.entries(root ?? {}).filter(
    ([key, value]) =>
      !['core', 'bin', 'overview', 'binaryInfo', 'hashes'].includes(key) &&
      asRecord(value)
  ) as Array<[string, Record<string, unknown>]>;

  const extraArraySections = Object.entries(root ?? {}).filter(
    ([key, value]) =>
      !['core', 'bin', 'overview', 'binaryInfo'].includes(key) &&
      Array.isArray(value)
  ) as Array<[string, unknown[]]>;

  const checksums = asRecord(bin.checksums) ?? asRecord(root?.hashes);

  const securityFlags = [
    { label: 'Canary', value: !!bin.canary },
    { label: 'NX', value: !!(bin.NX ?? bin.nx) },
    { label: 'PIE', value: !!(bin.PIE ?? bin.pic) },
    { label: 'RELRO', value: !!(bin.RELROCS ?? bin.relocs ?? bin.relro) },
    { label: 'Static', value: !!bin.static },
    { label: 'Symbols', value: !bin.stripped },
  ];

  if (!root && !Object.keys(bin).length) {
    return (
      <div className={cn('flex h-full items-center justify-center text-sm text-muted-foreground', className)}>
        No binary info available
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col overflow-auto', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Binary Info</span>
      </div>

      <div className="space-y-6 p-4">
        {Object.keys(core).length > 0 && (
          <InfoSection
            title="Core"
            data={{ ...core, ...(fileSize ? { uploadedFileSize: fileSize } : {}) }}
            bits={bits}
          />
        )}

        {Object.keys(bin).length > 0 && (
          <InfoSection
            title="Binary"
            data={Object.fromEntries(Object.entries(bin).filter(([key]) => key !== 'checksums'))}
            bits={bits}
          />
        )}

        {Object.keys(summaryData).length > 0 && (
          <InfoSection title="Summary" data={summaryData} bits={bits} />
        )}

        {Object.keys(bin).length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                Security
              </div>
            </h4>
            <div className="flex flex-wrap gap-2">
              {securityFlags.map(flag => (
                <SecurityBadge key={flag.label} enabled={flag.value} label={flag.label} />
              ))}
            </div>
          </section>
        )}

        {checksums && <InfoSection title="Checksums" data={checksums} bits={bits} />}

        {extraObjectSections.map(([key, value]) => (
          <InfoSection key={key} title={prettyLabel(key)} data={value} bits={bits} />
        ))}

        {extraArraySections.map(([key, value]) => (
          <ArraySection key={key} title={prettyLabel(key)} items={value} bits={bits} />
        ))}
      </div>
    </div>
  );
}
