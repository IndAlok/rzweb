let cachedVersion: string | null = null;
let fetching: Promise<string> | null = null;

async function fetchVersion(): Promise<string> {
  const envVersion = (import.meta as unknown as { env?: { VITE_RIZIN_VERSION?: string } }).env?.VITE_RIZIN_VERSION;
  if (envVersion && envVersion !== 'undefined' && envVersion.trim()) {
    return envVersion.trim();
  }
  
  try {
    const response = await fetch('/VERSION');
    if (response.ok) {
      const text = await response.text();
      const version = text.trim();
      if (version && version !== 'undefined') {
        return version;
      }
    }
  } catch {
    // Local VERSION not available
  }
  
  try {
    const response = await fetch('https://indalok.github.io/rzwasi/VERSION');
    if (response.ok) {
      const text = await response.text();
      const version = text.trim();
      if (version && version !== 'undefined') {
        return version;
      }
    }
  } catch {
    // Remote VERSION not available
  }
  
  return 'unknown';
}

export async function getRizinVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  
  if (!fetching) {
    fetching = fetchVersion().then(v => {
      cachedVersion = v;
      fetching = null;
      return v;
    });
  }
  
  return fetching;
}

export function getRizinVersionSync(): string {
  return cachedVersion || '...';
}
