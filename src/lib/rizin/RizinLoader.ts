/**
 * @file RizinLoader.ts
 * @brief Loads Rizin WASM module from GitHub Pages
 */

export interface RizinModule {
  print: (text: string) => void;
  printErr: (text: string) => void;
  onRuntimeInitialized: () => void;
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (path: string, opts?: { encoding?: string }) => Uint8Array | string;
    mkdir: (path: string) => void;
    unlink: (path: string) => void;
    readdir: (path: string) => string[];
    stat: (path: string) => { size: number };
    init: (
      stdin: (() => number | null) | null,
      stdout: ((code: number) => void) | null,
      stderr: ((code: number) => void) | null
    ) => void;
  };
  ccall: (name: string, returnType: string, argTypes: string[], args: unknown[]) => unknown;
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: unknown[]) => unknown;
  _printHandler?: (text: string) => void;
  _printErrHandler?: (text: string) => void;
}

export interface LoadProgress {
  phase: 'initializing' | 'downloading' | 'processing' | 'ready' | 'error';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: LoadProgress) => void;

const WASM_BASE_URL = 'https://indalok.github.io/rzwasi';

let cachedModule: RizinModule | null = null;
let loadingPromise: Promise<RizinModule> | null = null;

export async function loadRizinModule(
  options: {
    onProgress?: ProgressCallback;
  } = {}
): Promise<RizinModule> {
  const { onProgress } = options;

  const notify = (
    phase: LoadProgress['phase'],
    progress: number,
    message: string
  ) => {
    onProgress?.({ phase, progress, message });
  };

  if (cachedModule) {
    notify('ready', 100, 'Rizin loaded from cache');
    return cachedModule;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      notify('initializing', 5, 'Loading Rizin module...');

      const modulePromise = new Promise<RizinModule>((resolve, reject) => {
        const stdoutBuffer: number[] = [];
        const stderrBuffer: number[] = [];
        
        const flushStdout = () => {
          if (stdoutBuffer.length > 0) {
            const text = String.fromCharCode(...stdoutBuffer);
            stdoutBuffer.length = 0;
            const mod = (window as unknown as { Module: RizinModule }).Module;
            mod?._printHandler?.(text);
          }
        };
        
        const flushStderr = () => {
          if (stderrBuffer.length > 0) {
            const text = String.fromCharCode(...stderrBuffer);
            stderrBuffer.length = 0;
            const mod = (window as unknown as { Module: RizinModule }).Module;
            mod?._printErrHandler?.(text);
          }
        };
        
        const moduleConfig: Partial<RizinModule> & {
          locateFile: (path: string) => string;
          onAbort: (msg: string) => void;
          preRun: (() => void)[];
          noInitialRun: boolean;
        } = {
          locateFile: (path: string) => `${WASM_BASE_URL}/${path}`,
          noInitialRun: true,
          preRun: [
            () => {
              const mod = (window as unknown as { Module: RizinModule }).Module;
              if (mod?.FS?.init) {
                mod.FS.init(
                  () => null,
                  (code: number) => {
                    if (code === 10) flushStdout();
                    else stdoutBuffer.push(code);
                  },
                  (code: number) => {
                    if (code === 10) flushStderr();
                    else stderrBuffer.push(code);
                  }
                );
              }
            }
          ],
          print: (text: string) => {
            const mod = (window as unknown as { Module: RizinModule }).Module;
            mod?._printHandler?.(text);
          },
          printErr: (text: string) => {
            const mod = (window as unknown as { Module: RizinModule }).Module;
            mod?._printErrHandler?.(text);
          },
          onRuntimeInitialized: () => {
            notify('ready', 100, 'Rizin ready');
            cachedModule = (window as unknown as { Module: RizinModule }).Module;
            resolve(cachedModule);
          },
          onAbort: (msg: string) => {
            reject(new Error(`Rizin module aborted: ${msg}`));
          },
        };

        (window as unknown as { Module: typeof moduleConfig }).Module = moduleConfig;

        const script = document.createElement('script');
        script.src = `${WASM_BASE_URL}/rizin.js`;
        script.async = true;
        script.crossOrigin = 'anonymous';
        
        script.onload = () => {
          notify('processing', 50, 'Initializing Rizin...');
        };
        
        script.onerror = () => {
          reject(new Error('Failed to load rizin.js'));
        };

        notify('downloading', 20, 'Downloading Rizin...');
        document.head.appendChild(script);
      });

      return await modulePromise;
    } catch (error) {
      notify('error', 0, `Error: ${error}`);
      loadingPromise = null;
      throw error;
    }
  })();

  return loadingPromise;
}

export async function getCachedVersions(): Promise<string[]> {
  return cachedModule ? ['nightly'] : [];
}

export async function clearCache(): Promise<void> {
  cachedModule = null;
  loadingPromise = null;
}
