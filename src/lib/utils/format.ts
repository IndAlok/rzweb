export function formatAddress(addr: number, bits: number = 64): string {
  const hexLength = bits / 4;
  return '0x' + addr.toString(16).padStart(hexLength, '0');
}

export function formatAddressShort(addr: number): string {
  return '0x' + addr.toString(16);
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return '0%';
  return ((value / total) * 100).toFixed(1) + '%';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function parseAddress(addr: string): number | null {
  const cleaned = addr.trim().toLowerCase();
  if (cleaned.startsWith('0x')) {
    const parsed = parseInt(cleaned, 16);
    return isNaN(parsed) ? null : parsed;
  }
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

export function hexDump(data: Uint8Array, offset: number = 0, bytesPerRow: number = 16): string[] {
  const lines: string[] = [];

  for (let i = 0; i < data.length; i += bytesPerRow) {
    const addr = formatAddress(offset + i, 32);
    const slice = data.slice(i, Math.min(i + bytesPerRow, data.length));

    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');

    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');

    const padding = '   '.repeat(bytesPerRow - slice.length);
    lines.push(`${addr}  ${hex}${padding}  |${ascii}|`);
  }

  return lines;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
