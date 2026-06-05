let cachedVersion: string | null = null;
let fetching: Promise<string> | null = null;

function cleanVersionText(text: string): string | null {
  const version = text.trim();
  if (!version || version === 'undefined') return null;
  if (version.length > 80 || /<[/a-z!][\s\S]*>/i.test(version)) return null;
  return version;
}

async function fetchVersion(): Promise<string> {
  const envVersion = (import.meta as unknown as { env?: { VITE_RIZIN_VERSION?: string } }).env?.VITE_RIZIN_VERSION;
  const cleanEnvVersion = envVersion ? cleanVersionText(envVersion) : null;
  if (cleanEnvVersion) {
    return cleanEnvVersion;
  }
  
  try {
    const response = await fetch('/VERSION');
    if (response.ok) {
      const version = cleanVersionText(await response.text());
      if (version) {
        return version;
      }
    }
  } catch {

  }
  
  try {
    const base =
      (import.meta as unknown as { env?: { VITE_WASM_BASE_URL?: string } }).env?.VITE_WASM_BASE_URL?.replace(/\/+$/, '') ||
      'https://indalok.github.io/rzwasi';
    const response = await fetch(`${base}/VERSION`);
    if (response.ok) {
      const version = cleanVersionText(await response.text());
      if (version) {
        return version;
      }
    }
  } catch {

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
