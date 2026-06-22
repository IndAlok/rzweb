// Web Worker that owns the single-threaded Rizin WASM module: native calls, FS,
// JSON parsing, and persistence run here, driven by the RizinInstance facade.

import { RizinSession } from './rizinSession';
import type { RizinModule } from './RizinLoader';
import type {
  RizinInbound,
  RizinLoadPhase,
  RizinRequest,
  RizinResponse,
  RizinResult,
  RizinWorkerEvent,
} from './rizinProtocol';

// Set VITE_WASM_BASE_URL to point the worker at a local or preview rzwasi
// build (e.g. one that bundles the jsdec decompiler). Defaults to the hosted CDN.
const WASM_BASE_URL =
  (import.meta.env.VITE_WASM_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://indalok.github.io/rzwasi';
const CHUNK_SIZE = 8192;
const FLUSH_THRESHOLD = 65536;

// Minimal worker-global surface: the app's tsconfig uses the DOM lib, not WebWorker.
interface WorkerScope {
  Module?: unknown;
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', listener: (event: { data: RizinInbound }) => void) => void;
  importScripts?: (...urls: string[]) => void;
}

const ctx = self as unknown as WorkerScope;

function post(message: RizinResponse | RizinWorkerEvent): void {
  ctx.postMessage(message);
}

function emit(event: RizinWorkerEvent): void {
  post(event);
}

function notifyProgress(phase: RizinLoadPhase, progress: number, message: string): void {
  emit({ event: 'progress', phase, progress, message });
}

let session: RizinSession | null = null;

function charsToString(buffer: number[]): string {
  if (buffer.length <= CHUNK_SIZE) {
    return String.fromCharCode.apply(null, buffer);
  }
  const parts: string[] = [];
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    parts.push(String.fromCharCode.apply(null, buffer.slice(i, Math.min(i + CHUNK_SIZE, buffer.length))));
  }
  return parts.join('');
}

// Buffers stdout/stderr and forwards flushed text to the session's print
// handlers, which read `ctx.Module` lazily so they bind to the live session.
function createModuleConfig(): Record<string, unknown> {
  const stdoutBuffer: number[] = [];
  const stderrBuffer: number[] = [];

  const flushStdout = () => {
    if (stdoutBuffer.length === 0) return;
    const text = charsToString(stdoutBuffer);
    stdoutBuffer.length = 0;
    (ctx.Module as RizinModule | undefined)?._printHandler?.(text);
  };

  const flushStderr = () => {
    if (stderrBuffer.length === 0) return;
    const text = charsToString(stderrBuffer);
    stderrBuffer.length = 0;
    (ctx.Module as RizinModule | undefined)?._printErrHandler?.(text);
  };

  return {
    locateFile: (path: string) => `${WASM_BASE_URL}/${path}`,
    noInitialRun: true,
    preRun: [
      () => {
        const mod = ctx.Module as RizinModule | undefined;
        mod?.FS?.init(
          () => null,
          (code: number) => {
            if (code === 10) flushStdout();
            else {
              stdoutBuffer.push(code);
              if (stdoutBuffer.length >= FLUSH_THRESHOLD) flushStdout();
            }
          },
          (code: number) => {
            if (code === 10) flushStderr();
            else {
              stderrBuffer.push(code);
              if (stderrBuffer.length >= FLUSH_THRESHOLD) flushStderr();
            }
          }
        );
      },
    ],
    print: (text: string) => {
      (ctx.Module as RizinModule | undefined)?._printHandler?.(text);
    },
    printErr: (text: string) => {
      (ctx.Module as RizinModule | undefined)?._printErrHandler?.(text);
    },
    onRuntimeInitialized: () => {
      session = new RizinSession(ctx.Module as RizinModule, emit);
      notifyProgress('ready', 100, 'Rizin ready');
      emit({ event: 'ready' });
    },
    onAbort: (msg: string) => {
      notifyProgress('error', 0, `Rizin module aborted: ${msg}`);
    },
  };
}

function init(): void {
  if (ctx.Module) return;
  notifyProgress('initializing', 5, 'Loading Rizin module...');
  ctx.Module = createModuleConfig();
  notifyProgress('downloading', 20, 'Downloading Rizin...');
  void loadRuntime()
    .then(() => notifyProgress('processing', 50, 'Initializing Rizin...'))
    .catch((error) => {
      notifyProgress('error', 0, `Failed to load rizin.js: ${error instanceof Error ? error.message : String(error)}`);
    });
}

// Loads the Emscripten glue regardless of worker type. Classic workers (the
// production build) use importScripts. Vite dev module workers cannot, so the
// classic glue is fetched and run in global scope with importScripts shimmed so
// Emscripten still detects a worker. locateFile pins the wasm to its own host.
async function loadRuntime(): Promise<void> {
  const url = `${WASM_BASE_URL}/rizin.js`;
  // Module workers DEFINE importScripts but throw when it is called, so typeof
  // cannot discriminate. Try it and fall back to fetch + indirect eval on any
  // failure.
  if (typeof ctx.importScripts === 'function') {
    try {
      ctx.importScripts(url);
      return;
    } catch {
      // Module worker: importScripts is unusable. Fall through to fetch+eval.
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching rizin.js`);
  const source = await response.text();
  // Stub importScripts so the sloppy-mode glue (which feature-detects it) finds a
  // callable. locateFile already pins the wasm to its own host.
  ctx.importScripts = () => {};
  (0, eval)(source);
}

async function dispatch(active: RizinSession, request: RizinRequest): Promise<RizinResult> {
  switch (request.method) {
    case 'open':
      await active.open(request.file, request.config, request.restoreProjectData);
      return {
        analysis: active.snapshotAnalysis(),
        commandCatalog: active.getCommandCatalog(),
      };
    case 'executeCommand':
      return { output: await active.executeCommand(request.command) };
    case 'getFunctionDetails':
      return { detail: await active.getFunctionDetails(request.address) };
    case 'getAutocomplete':
      return { result: active.getAutocomplete(request.input, request.cursorPos, request.maxResults) };
    case 'readMemory':
      return { bytes: active.readMemory(request.address, request.size) };
    case 'getXrefs':
      return { xrefs: active.getXrefs(request.address) };
    case 'getDecompilation':
      return active.getDecompilation(request.address);
    case 'exportProject':
      return { data: await active.exportProject() };
    case 'importProject':
      await active.importProject(request.data);
      return {
        analysis: active.snapshotAnalysis(),
        commandCatalog: active.getCommandCatalog(),
      };
    case 'setWriteMode':
      return { writeMode: active.setWriteMode(request.enable) };
    case 'readFileSlice':
      return { bytes: active.readFileSlice(request.offset, request.length) };
    case 'searchFileBytes':
      return { matches: active.searchFileBytes(request.needle, request.caseInsensitive) };
    case 'patchFile':
      return active.patchFile(request.offset, request.hex);
    case 'exportBinary':
      return await active.exportBinary();
    case 'runScript':
      return active.runScript(request.source, request.language);
    case 'close':
      await active.close();
      return {};
  }
}

async function handleRequest(request: RizinRequest): Promise<void> {
  if (!session) {
    post({ id: request.id, ok: false, error: 'Rizin session is not ready' });
    return;
  }

  try {
    const result = await dispatch(session, request);
    post({ id: request.id, ok: true, result, state: session.snapshot() });
  } catch (error) {
    post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

ctx.addEventListener('message', event => {
  const message = event.data;
  if ('control' in message) {
    if (message.control === 'init') init();
    return;
  }
  void handleRequest(message);
});
