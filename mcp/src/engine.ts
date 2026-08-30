import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export interface NativeApi {
  createSession: () => number;
  closeSession: (id: number) => number;
  openFile: (id: number, filePath: string, writeMode: number, ioCache: number) => number;
  command: (id: number, command: string) => string;
  saveProject: (id: number, projectPath: string, compress: number) => number;
  loadProject: (id: number, projectPath: string, loadBinIo: number) => number;
  applyProject?: (id: number, projectPath: string) => number;
  getLastError: (id: number) => string;
}

interface EmscriptenModule {
  FS: {
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (path: string, opts?: { encoding?: string }) => Uint8Array | string;
    mkdir: (path: string) => void;
  };
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: unknown[]) => unknown;
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string) => string;
  noInitialRun?: boolean;
}

function wasmDir(): string {
  return process.env.RZWEB_WASM_DIR || '';
}

export class WasmEngine {
  private module: EmscriptenModule | null = null;
  private api: NativeApi | null = null;
  private sessionId: number | null = null;
  private liveContextId: string | null = null;
  private hasApply = false;
  private filePath = '';
  private projectPath = '';

  get hasApplyProject(): boolean {
    return this.hasApply;
  }

  get currentContextId(): string | null {
    return this.liveContextId;
  }

  async ensureModule(): Promise<void> {
    if (this.module && this.api) return;
    const dir = wasmDir();
    if (!dir) {
      throw new Error('Set RZWEB_WASM_DIR to a folder that contains rizin.js and rizin.wasm.');
    }
    const jsPath = path.join(dir, 'rizin.js');
    if (!fs.existsSync(jsPath)) {
      throw new Error(`rizin.js not found in ${dir}`);
    }

    const Module: EmscriptenModule = {
      FS: {} as EmscriptenModule['FS'],
      cwrap: () => () => undefined,
      locateFile: (file) => path.join(dir, file),
      noInitialRun: true,
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('rizin.wasm init timed out')), 60_000);
      Module.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve();
      };
      (globalThis as unknown as { Module: EmscriptenModule }).Module = Module;
      try {
        const require = createRequire(pathToFileURL(jsPath).href);
        require(jsPath);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });

    const live = (globalThis as unknown as { Module: EmscriptenModule }).Module;
    const exported = live as unknown as Record<string, unknown>;
    this.hasApply = typeof exported._rzweb_apply_project === 'function';
    this.api = {
      createSession: live.cwrap('rzweb_create_session', 'number', []) as NativeApi['createSession'],
      closeSession: live.cwrap('rzweb_close_session', 'number', ['number']) as NativeApi['closeSession'],
      openFile: live.cwrap('rzweb_open_file', 'number', ['number', 'string', 'number', 'number']) as NativeApi['openFile'],
      command: live.cwrap('rzweb_cmd', 'string', ['number', 'string']) as NativeApi['command'],
      saveProject: live.cwrap('rzweb_save_project', 'number', ['number', 'string', 'number']) as NativeApi['saveProject'],
      loadProject: live.cwrap('rzweb_load_project', 'number', ['number', 'string', 'number']) as NativeApi['loadProject'],
      applyProject: this.hasApply
        ? (live.cwrap('rzweb_apply_project', 'number', ['number', 'string']) as NativeApi['applyProject'])
        : undefined,
      getLastError: live.cwrap('rzweb_get_last_error', 'string', ['number']) as NativeApi['getLastError'],
    };
    this.module = live;
    try {
      live.FS.mkdir('/work');
    } catch { /* exists */ }
  }

  async openContext(contextId: string, fileName: string, data: Uint8Array, rzdb?: Uint8Array | null): Promise<void> {
    await this.ensureModule();
    this.close();
    const api = this.api!;
    const mod = this.module!;
    const id = api.createSession();
    if (!id) throw new Error(api.getLastError(0) || 'rzweb_create_session failed');
    this.sessionId = id;
    this.liveContextId = contextId;
    this.filePath = `/work/${contextId}.bin`;
    this.projectPath = `/work/${contextId}.rzdb`;
    mod.FS.writeFile(this.filePath, data);
    const opened = api.openFile(id, this.filePath, 0, 1);
    if (!opened) {
      throw new Error(api.getLastError(id) || 'rzweb_open_file failed');
    }
    if (rzdb && rzdb.byteLength > 0) {
      mod.FS.writeFile(this.projectPath, rzdb);
      if (api.applyProject) {
        const applied = api.applyProject(id, this.projectPath);
        if (!applied) throw new Error(api.getLastError(id) || 'rzweb_apply_project failed');
      } else {
        const loaded = api.loadProject(id, this.projectPath, 1);
        if (!loaded) throw new Error(api.getLastError(id) || 'rzweb_load_project failed');
      }
    }
  }

  cmd(command: string): string {
    if (this.sessionId == null || !this.api) throw new Error('No live context. Call context_create or open a context first.');
    return this.api.command(this.sessionId, command) ?? '';
  }

  cmdj(command: string): unknown {
    const out = this.cmd(command).trim();
    if (!out) return null;
    return JSON.parse(out);
  }

  saveRzdb(): Uint8Array | null {
    if (this.sessionId == null || !this.api || !this.module) return null;
    const saved = this.api.saveProject(this.sessionId, this.projectPath, 0);
    if (!saved) return null;
    const data = this.module.FS.readFile(this.projectPath, { encoding: 'binary' });
    return data instanceof Uint8Array ? data : null;
  }

  close(): void {
    if (this.sessionId != null && this.api) {
      try {
        this.api.closeSession(this.sessionId);
      } catch { /* ignore */ }
    }
    this.sessionId = null;
    this.liveContextId = null;
  }
}

export function paginate<T>(items: T[], offset = 0, limit = 100): { items: T[]; total: number; offset: number; limit: number } {
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit) || 100));
  return {
    items: items.slice(safeOffset, safeOffset + safeLimit),
    total: items.length,
    offset: safeOffset,
    limit: safeLimit,
  };
}
