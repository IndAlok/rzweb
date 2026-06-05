export function formatAddress(addr: number | undefined | null, bits: number = 64): string {
  if (addr == null || typeof addr !== 'number' || isNaN(addr)) return '0x0';
  const hexLength = bits / 4;
  return '0x' + addr.toString(16).padStart(hexLength, '0');
}

export function formatAddressShort(addr: number | undefined | null): string {
  if (addr == null || typeof addr !== 'number' || isNaN(addr)) return '0x0';
  return '0x' + addr.toString(16);
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
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
