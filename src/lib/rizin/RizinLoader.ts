import RizinWorker from './rizin.worker.ts?worker';
import type { RizinControl, RizinOutbound } from './rizinProtocol';

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

export function destroyRizinWorker(worker: Worker | null | undefined): void {
  worker?.terminate();
}

export async function createRizinWorker(
  options: {
    onProgress?: ProgressCallback;
  } = {}
): Promise<Worker> {
  const { onProgress } = options;

  return new Promise<Worker>((resolve, reject) => {
    const w = new RizinWorker();

    const cleanup = () => {
      w.removeEventListener('message', handleMessage);
      w.removeEventListener('error', handleError);
    };

    const fail = (message: string) => {
      cleanup();
      w.terminate();
      reject(new Error(message));
    };

    const handleMessage = (event: MessageEvent<RizinOutbound>) => {
      const data = event.data;
      if (!('event' in data)) return;
      if (data.event === 'progress') {
        onProgress?.({ phase: data.phase, progress: data.progress, message: data.message });
        if (data.phase === 'error') fail(data.message);
      } else if (data.event === 'ready') {
        cleanup();
        resolve(w);
      }
    };

    const handleError = (event: ErrorEvent) => {
      fail(event.message || 'Rizin worker failed to load');
    };

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError);

    onProgress?.({ phase: 'initializing', progress: 5, message: 'Loading Rizin module...' });
    const init: RizinControl = { control: 'init' };
    w.postMessage(init);
  });
}

export async function loadRizinModule(
  options: {
    onProgress?: ProgressCallback;
  } = {}
): Promise<Worker> {
  return createRizinWorker(options);
}

export async function getCachedVersions(): Promise<string[]> {
  return ['nightly'];
}

export async function clearCache(): Promise<void> {
  // Callers own workers and must terminate them. Kept for API compatibility.
}
