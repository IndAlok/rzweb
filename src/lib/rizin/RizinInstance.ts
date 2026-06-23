// sends typed RPC requests and caches the latest snapshot so synchronous getters never block on a round trip.

import type {
  AnalysisData,
  FunctionDetailCacheEntry,
  RizinAutocompleteResult,
  RizinCommandHelpEntry,
  RizinFile,
  RizinInstanceConfig,
  RizinMethod,
  RizinNotice,
  RizinOutbound,
  RizinRequest,
  RizinResult,
  RizinResultMap,
  RizinStateSnapshot,
  RizinWorkerEvent,
  XrefsResult,
} from './rizinProtocol';

export type {
  AnalysisData,
  FunctionDetailCacheEntry,
  RizinAutocompleteResult,
  RizinCommandHelpEntry,
  RizinFile,
  RizinInstanceConfig,
  RizinNotice,
  XrefEntry,
  XrefsResult,
} from './rizinProtocol';

interface PendingRequest {
  resolve: (value: RizinResult) => void;
  reject: (error: Error) => void;
}

export class RizinInstance {
  private readonly worker: Worker;
  private readonly listener: (event: MessageEvent<RizinOutbound>) => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private disposed = false;

  private file: RizinFile | null = null;
  private analysisData: AnalysisData | null = null;
  private commandCatalog: Record<string, RizinCommandHelpEntry> = {};
  private currentAddress = '0x00000000';
  private _cacheHit = false;
  private notices: RizinNotice[] = [];
  private lastStderr = '';
  private _writeMode = false;
  private _isDirty = false;

  private noticeCallbacks: Array<(notice: RizinNotice) => void> = [];
  private analysisCallbacks: Array<() => void> = [];
  private stateCallbacks: Array<() => void> = [];

  constructor(worker: Worker) {
    this.worker = worker;
    this.listener = event => this.handleMessage(event.data);
    this.worker.addEventListener('message', this.listener);
  }

  get analysis(): AnalysisData | null {
    return this.analysisData;
  }

  get currentFile(): RizinFile | null {
    return this.file;
  }

  get cacheHit(): boolean {
    return this._cacheHit;
  }

  get isWriteMode(): boolean {
    return this._writeMode;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get allNotices(): RizinNotice[] {
    return [...this.notices];
  }

  async open(file: RizinFile, config?: RizinInstanceConfig, restoreProjectData?: Uint8Array): Promise<void> {
    this.file = file;
    this.notices = [];
    this.lastStderr = '';
    const result = await this.send<'open'>({ id: ++this.nextId, method: 'open', file, config, restoreProjectData });
    this.analysisData = result.analysis;
    this.commandCatalog = result.commandCatalog;
  }

  async executeCommand(command: string): Promise<string> {
    const result = await this.send<'executeCommand'>({ id: ++this.nextId, method: 'executeCommand', command });
    return result.output;
  }

  async getFunctionDetails(address: number): Promise<FunctionDetailCacheEntry> {
    const result = await this.send<'getFunctionDetails'>({ id: ++this.nextId, method: 'getFunctionDetails', address });
    return result.detail;
  }

  async getAutocomplete(input: string, cursorPos: number, maxResults: number): Promise<RizinAutocompleteResult | null> {
    const result = await this.send<'getAutocomplete'>({
      id: ++this.nextId,
      method: 'getAutocomplete',
      input,
      cursorPos,
      maxResults,
    });
    return result.result;
  }

  async readMemory(address: number, size: number): Promise<Uint8Array> {
    const result = await this.send<'readMemory'>({ id: ++this.nextId, method: 'readMemory', address, size });
    return result.bytes;
  }

  async getXrefs(address: number): Promise<XrefsResult> {
    const result = await this.send<'getXrefs'>({ id: ++this.nextId, method: 'getXrefs', address });
    return result.xrefs;
  }

  async getDecompilation(address: number): Promise<{ code: string; pseudo: boolean }> {
    const result = await this.send<'getDecompilation'>({ id: ++this.nextId, method: 'getDecompilation', address });
    return { code: result.code, pseudo: result.pseudo };
  }

  async exportProject(): Promise<Uint8Array> {
    const result = await this.send<'exportProject'>({ id: ++this.nextId, method: 'exportProject' });
    return result.data;
  }

  async importProject(data: Uint8Array): Promise<void> {
    const result = await this.send<'importProject'>({ id: ++this.nextId, method: 'importProject', data });
    this.analysisData = result.analysis;
    this.commandCatalog = result.commandCatalog;
  }

  async setWriteMode(enable: boolean): Promise<boolean> {
    const result = await this.send<'setWriteMode'>({ id: ++this.nextId, method: 'setWriteMode', enable });
    return result.writeMode;
  }

  async readFileSlice(offset: number, length: number): Promise<Uint8Array> {
    const result = await this.send<'readFileSlice'>({ id: ++this.nextId, method: 'readFileSlice', offset, length });
    return result.bytes;
  }

  async searchFileBytes(needle: Uint8Array, caseInsensitive: boolean): Promise<number[]> {
    const result = await this.send<'searchFileBytes'>({ id: ++this.nextId, method: 'searchFileBytes', needle, caseInsensitive });
    return result.matches;
  }

  async patchFile(offset: number, hex: string): Promise<{ ok: boolean; error?: string }> {
    return this.send<'patchFile'>({ id: ++this.nextId, method: 'patchFile', offset, hex });
  }

  async exportBinary(): Promise<{ data: Uint8Array; name: string }> {
    return this.send<'exportBinary'>({ id: ++this.nextId, method: 'exportBinary' });
  }

  async runScript(source: string, language: 'rz' | 'js'): Promise<{ output: string; error?: string }> {
    return this.send<'runScript'>({ id: ++this.nextId, method: 'runScript', source, language });
  }

  getCommandCatalog(): Record<string, RizinCommandHelpEntry> {
    return this.commandCatalog;
  }

  getLastStderr(): string {
    return this.lastStderr;
  }

  getCurrentAddress(): string {
    return this.currentAddress;
  }

  onNotice(callback: (notice: RizinNotice) => void): () => void {
    this.noticeCallbacks.push(callback);
    return () => {
      this.noticeCallbacks = this.noticeCallbacks.filter(cb => cb !== callback);
    };
  }

  onAnalysisChanged(callback: () => void): () => void {
    this.analysisCallbacks.push(callback);
    return () => {
      this.analysisCallbacks = this.analysisCallbacks.filter(cb => cb !== callback);
    };
  }

  // Fires after each state snapshot so the UI can track write-mode and dirty flags.
  onStateChanged(callback: () => void): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter(cb => cb !== callback);
    };
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.send<'close'>({ id: ++this.nextId, method: 'close' });
    } finally {
      this.dispose();
    }
  }

  private send<M extends RizinMethod>(request: Extract<RizinRequest, { method: M }>): Promise<RizinResultMap[M]> {
    if (this.disposed) {
      return Promise.reject(new Error('Rizin instance has been disposed'));
    }
    return new Promise<RizinResultMap[M]>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: value => resolve(value as RizinResultMap[M]),
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(data: RizinOutbound): void {
    if ('event' in data) {
      this.handleEvent(data);
      return;
    }
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);
    if (data.ok) {
      // Refresh cached state before resolving so callers
      this.applyState(data.state);
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(data.error));
    }
  }

  private handleEvent(event: RizinWorkerEvent): void {
    switch (event.event) {
      case 'notice':
        this.notices = [...this.notices, event.notice];
        this.noticeCallbacks.forEach(cb => cb(event.notice));
        break;
      case 'analysisChanged':
        this.analysisData = event.analysis;
        this.applyState(event.state);
        this.analysisCallbacks.forEach(cb => cb());
        break;
      default:
        break;
    }
  }

  private applyState(state: RizinStateSnapshot): void {
    this.currentAddress = state.currentAddress;
    this._cacheHit = state.cacheHit;
    this.notices = state.notices;
    this.lastStderr = state.lastStderr;
    this._writeMode = state.writeMode;
    this._isDirty = state.isDirty;
    this.stateCallbacks.forEach(cb => cb());
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.listener);
    this.pending.forEach(entry => entry.reject(new Error('Rizin instance has been disposed')));
    this.pending.clear();
    this.noticeCallbacks = [];
    this.analysisCallbacks = [];
    this.stateCallbacks = [];
  }
}
