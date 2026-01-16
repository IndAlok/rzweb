let cachedVersion: string | null = null;

export async function getRizinVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  
  const envVersion = (import.meta as unknown as { env?: { VITE_RIZIN_VERSION?: string } }).env?.VITE_RIZIN_VERSION;
  if (envVersion) {
    cachedVersion = envVersion;
    return cachedVersion;
  }
  
  try {
    const response = await fetch('/VERSION');
    if (response.ok) {
      cachedVersion = (await response.text()).trim();
      return cachedVersion;
    }
  } catch {
    // Fallback if VERSION file not available
  }
  
  cachedVersion = '0.8.1';
  return cachedVersion;
}

export function getRizinVersionSync(): string {
  const envVersion = (import.meta as unknown as { env?: { VITE_RIZIN_VERSION?: string } }).env?.VITE_RIZIN_VERSION;
  return cachedVersion || envVersion || '0.8.1';
}
