import type { RizinModule } from './RizinLoader';
import { computeFileHash, getCachedAnalysis, setCachedAnalysis, type CachedAnalysis } from './analysisCache';

export interface RizinFile {
  name: string;
  data: Uint8Array;
}

export interface RizinInstanceConfig {
  ioCache?: boolean;
  analysisDepth?: number;
  extraArgs?: string[];
  noAnalysis?: boolean;
  maxOutputBytes?: number;
  enableCache?: boolean;
}

export interface AnalysisData {
  functions: unknown[];
  strings: unknown[];
  imports: unknown[];
  exports: unknown[];
  sections: unknown[];
  info: unknown;
  functionDetails: Record<string, FunctionDetailCacheEntry>;
}

export interface FunctionDetailCacheEntry {
  disasm?: unknown;
  graph?: unknown;
  updatedAt: number;
}

export interface RizinNotice {
  id: string;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  detail?: string;
}

interface CommandQueueItem {
  command: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface ActiveOutputCapture {
  maxOutputBytes: number;
  stdoutLength: number;
  truncated: boolean;
  context: 'analysis' | 'metadata' | 'command';
  commandLabel?: string;
}

interface RunCommandOptions {
  maxOutputBytes?: number;
  context?: ActiveOutputCapture['context'];
  commandLabel?: string;
  suppressNotice?: boolean;
}

interface RunCommandResult {
  output: string;
  truncated: boolean;
  durationMs: number;
}

interface DataLoadResult {
  loaded: boolean;
  truncated: boolean;
}

interface RefreshPlan {
  markAnalysisComplete: boolean;
  refreshFunctions: boolean;
  refreshStrings: boolean;
  refreshImports: boolean;
  refreshExports: boolean;
  refreshSections: boolean;
  refreshInfo: boolean;
}

interface RuntimeConfig {
  ioCache: boolean;
  analysisDepth: number;
  extraArgs: string[];
  noAnalysis: boolean;
  maxOutputBytes: number;
  enableCache: boolean;
}

export interface RizinAutocompleteResult {
  start: number;
  end: number;
  endString: string;
  options: string[];
}

export interface RizinCommandHelpEntry {
  name: string;
  summary?: string;
  description?: string;
  args?: string;
}

interface NativeSessionApi {
  createSession: () => number;
  closeSession: (sessionId: number) => number;
  openFile: (sessionId: number, filePath: string, writeMode: number, ioCache: number) => number;
  command: (sessionId: number, command: string) => string;
  getSeek: (sessionId: number) => string;
  saveProject: (sessionId: number, projectPath: string, compress: number) => number;
  loadProject: (sessionId: number, projectPath: string, loadBinIo: number) => number;
  getLastError: (sessionId: number) => string;
  autocomplete?: (sessionId: number, input: string, cursorPos: number, maxResults: number) => string;
  getCommandCatalog?: (sessionId: number) => string;
}

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LARGE_BINARY_ALERT_BYTES = 1024 * 1024;
const MAX_COMMAND_HISTORY_BYTES = 1024;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g');
const NON_ASCII_RE = /[^\n\r\t -~]/g;

const CACHE_BLOCKING_NOTICE_CODES = new Set([
  'output-truncated',
  'metadata-unavailable',
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function hasUsableAnalysisData(data: AnalysisData | null): boolean {
  if (!data) return false;
  const hasInfo =
    data.info != null &&
    (typeof data.info !== 'object' ||
      Array.isArray(data.info) ||
      Object.keys(data.info as Record<string, unknown>).length > 0);

  return (
    data.functions.length > 0 ||
    data.strings.length > 0 ||
    data.imports.length > 0 ||
    data.exports.length > 0 ||
    data.sections.length > 0 ||
    hasInfo ||
    Object.keys(data.functionDetails).length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function extractDisasmOps(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.ops)) {
    return value.ops.filter(isRecord);
  }

  if (Array.isArray(value.instructions)) {
    return value.instructions.filter(isRecord);
  }

  return [];
}

function hasUsableDisasmPayload(value: unknown): boolean {
  return extractDisasmOps(value).length > 0;
}

function looksLikeGraphBlock(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  return (
    'offset' in value ||
    'id' in value ||
    'jump' in value ||
    'fail' in value ||
    Array.isArray(value.ops) ||
    Array.isArray(value.out_nodes)
  );
}

function extractGraphBlocks(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (value.every(looksLikeGraphBlock)) {
      return value.filter(looksLikeGraphBlock);
    }

    if (value.length > 0 && isRecord(value[0])) {
      const first = value[0];
      if (Array.isArray(first.blocks)) {
        return first.blocks.filter(looksLikeGraphBlock);
      }
      if (Array.isArray(first.nodes)) {
        return first.nodes.filter(looksLikeGraphBlock);
      }
    }

    return [];
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.blocks)) {
    return value.blocks.filter(looksLikeGraphBlock);
  }

  if (Array.isArray(value.nodes)) {
    return value.nodes.filter(looksLikeGraphBlock);
  }

  if (isRecord(value.graph)) {
    return extractGraphBlocks(value.graph);
  }

  return [];
}

function hasUsableGraphPayload(value: unknown): boolean {
  return extractGraphBlocks(value).length > 0;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'binary';
}

function readFsBytes(module: RizinModule, path: string): Uint8Array | null {
  try {
    const value = module.FS.readFile(path);
    return value instanceof Uint8Array ? value : new Uint8Array(value as unknown as ArrayLike<number>);
  } catch {
    return null;
  }
}

export class RizinInstance {
  private module: RizinModule;
  private file: RizinFile | null = null;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private outputCallbacks: ((text: string) => void)[] = [];
  private errorCallbacks: ((text: string) => void)[] = [];
  private noticeCallbacks: ((notice: RizinNotice) => void)[] = [];
  private analysisCallbacks: (() => void)[] = [];
  private _isOpen = false;
  private workDir = '/work';
  private analysisData: AnalysisData | null = null;
  private filePath = '';
  private analysisCompleted = false;
  private _fileHash = '';
  private _cacheHit = false;
  private notices: RizinNotice[] = [];
  private commandQueue: CommandQueueItem[] = [];
  private processing = false;
  private activeOutputCapture: ActiveOutputCapture | null = null;
  private pendingFunctionDetailLoads = new Map<string, Promise<FunctionDetailCacheEntry>>();
  private currentAddress = '0x00000000';
  private projectPath = '';
  private nativeApi: NativeSessionApi | null = null;
  private nativeSessionId: number | null = null;
  private nativeApiChecked = false;
  private commandCatalogCache: Record<string, RizinCommandHelpEntry> | null = null;
  private runtimeConfig: RuntimeConfig = {
    ioCache: true,
    analysisDepth: 2,
    extraArgs: [],
    noAnalysis: false,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    enableCache: true,
  };

  private yield(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  constructor(module: RizinModule) {
    this.module = module;
    this.nativeApi = this.resolveNativeApi();
    this.nativeApiChecked = true;

    this.module._printHandler = (text: string) => {
      const cleaned = this.cleanText(text);
      if (!cleaned) return;

      let accepted = cleaned;
      const capture = this.activeOutputCapture;

      if (capture) {
        const remaining = Math.max(capture.maxOutputBytes - capture.stdoutLength, 0);
        if (remaining === 0) {
          capture.truncated = true;
          return;
        }
        if (accepted.length > remaining) {
          accepted = accepted.slice(0, remaining);
          capture.truncated = true;
        }
        capture.stdoutLength += accepted.length + 1;
      }

      if (!accepted) return;

      this.stdoutBuffer.push(accepted);
      this.outputCallbacks.forEach(cb => cb(`${accepted}\n`));
    };

    this.module._printErrHandler = (text: string) => {
      const cleaned = this.cleanText(text);
      if (!cleaned) return;
      this.stderrBuffer.push(cleaned);
      this.errorCallbacks.forEach(cb => cb(`${cleaned}\n`));
    };
  }

  private cleanText(text: string): string {
    return text
      .replace(ANSI_ESCAPE_RE, '')
      .replace(/\[2K/g, '')
      .replace(/[\u2500-\u257F]/g, '-')
      .replace(/ï¿¢ï¾€ï¾•/g, '-')
      .replace(/ï¿¢ï¾”ï¾‚/g, '|')
      .replace(/ï¿¢ï¾”ï¾Œ/g, '+')
      .replace(/ï¿¢ï¾”ï¾”/g, '+')
      .replace(NON_ASCII_RE, '');
  }

  private resolveNativeApi(): NativeSessionApi | null {
    if (this.nativeApiChecked) {
      return this.nativeApi;
    }

    const exported = this.module as RizinModule & Record<string, unknown>;
    if (typeof exported._rzweb_create_session !== 'function') {
      return null;
    }

    try {
      const hasAutocomplete = typeof exported._rzweb_autocomplete === 'function';
      const hasCommandCatalog = typeof exported._rzweb_get_command_catalog === 'function';
      return {
        createSession: this.module.cwrap('rzweb_create_session', 'number', []) as () => number,
        closeSession: this.module.cwrap('rzweb_close_session', 'number', ['number']) as (sessionId: number) => number,
        openFile: this.module.cwrap('rzweb_open_file', 'number', ['number', 'string', 'number', 'number']) as (
          sessionId: number,
          filePath: string,
          writeMode: number,
          ioCache: number
        ) => number,
        command: this.module.cwrap('rzweb_cmd', 'string', ['number', 'string']) as (
          sessionId: number,
          command: string
        ) => string,
        getSeek: this.module.cwrap('rzweb_get_seek', 'string', ['number']) as (sessionId: number) => string,
        saveProject: this.module.cwrap('rzweb_save_project', 'number', ['number', 'string', 'number']) as (
          sessionId: number,
          projectPath: string,
          compress: number
        ) => number,
        loadProject: this.module.cwrap('rzweb_load_project', 'number', ['number', 'string', 'number']) as (
          sessionId: number,
          projectPath: string,
          loadBinIo: number
        ) => number,
        getLastError: this.module.cwrap('rzweb_get_last_error', 'string', ['number']) as (sessionId: number) => string,
        autocomplete: hasAutocomplete
          ? this.module.cwrap('rzweb_autocomplete', 'string', ['number', 'string', 'number', 'number']) as (
              sessionId: number,
              input: string,
              cursorPos: number,
              maxResults: number
            ) => string
          : undefined,
        getCommandCatalog: hasCommandCatalog
          ? this.module.cwrap('rzweb_get_command_catalog', 'string', ['number']) as (
              sessionId: number
            ) => string
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private hasNativeSession(): boolean {
    return this.nativeSessionId != null && this.nativeApi != null;
  }

  private ensureNativeSession(): boolean {
    if (!this.nativeApiChecked) {
      this.nativeApi = this.resolveNativeApi();
      this.nativeApiChecked = true;
    }

    if (!this.nativeApi) {
      return false;
    }

    if (this.nativeSessionId != null) {
      return true;
    }

    const sessionId = this.nativeApi.createSession();
    if (sessionId <= 0) {
      return false;
    }

    this.nativeSessionId = sessionId;
    return true;
  }

  private getNativeLastError(): string {
    if (!this.nativeApi || this.nativeSessionId == null) return '';
    try {
      return this.nativeApi.getLastError(this.nativeSessionId) ?? '';
    } catch {
      return '';
    }
  }

  private buildStablePaths(file: RizinFile, hash: string): void {
    const safeName = sanitizeFileName(file.name);
    this.filePath = `${this.workDir}/${hash.slice(0, 16)}-${safeName}`;
    this.projectPath = `${this.workDir}/${hash}.rzdb`;
  }

  private ensureWorkDir(): void {
    try {
      this.module.FS.mkdir(this.workDir);
    } catch {
      // The working directory already exists in the in-memory FS.
    }
  }

  private finalizeOutput(
    rawOutput: string,
    options: RunCommandOptions = {},
    startedAt: number
  ): RunCommandResult {
    const maxOutputBytes = Math.max(options.maxOutputBytes ?? this.runtimeConfig.maxOutputBytes, 1024);
    let output = rawOutput;
    let truncated = false;

    if (output.length > maxOutputBytes) {
      output = `${output.slice(0, maxOutputBytes)}\n[output truncated at ${formatBytes(maxOutputBytes)}]`;
      truncated = true;

      if (!options.suppressNotice) {
        const label = options.commandLabel || 'Command output';
        const limitLabel = formatBytes(maxOutputBytes);
        this.emitNotice({
          severity: 'error',
          code: 'output-truncated',
          message: `${label} exceeded ${limitLabel} and was truncated.`,
          detail: 'Increase Max Output Size in Settings for larger binaries or verbose commands.',
        });
      }
    }

    return {
      output,
      truncated,
      durationMs: Date.now() - startedAt,
    };
  }

  private runNativeCommand(command: string, options: RunCommandOptions = {}): RunCommandResult {
    if (!this.nativeApi || this.nativeSessionId == null) {
      return { output: '', truncated: false, durationMs: 0 };
    }

    const startedAt = Date.now();

    try {
      const output = this.nativeApi.command(this.nativeSessionId, command) ?? '';
      return this.finalizeOutput(this.cleanText(output), options, startedAt);
    } catch (error) {
      const detail = this.getNativeLastError();
      if (!options.suppressNotice) {
        this.emitNotice({
          severity: 'error',
          code: 'native-command-failed',
          message: options.commandLabel || 'Command execution failed.',
          detail: detail || (error instanceof Error ? error.message : String(error)),
        });
      }
      return this.finalizeOutput('', options, startedAt);
    }
  }

  private runSessionCommand(command: string, options: RunCommandOptions = {}): RunCommandResult {
    if (this.hasNativeSession()) {
      return this.runNativeCommand(command, options);
    }

    if (!this.filePath) {
      return { output: '', truncated: false, durationMs: 0 };
    }

    return this.runCommand(command, this.filePath, options);
  }

  private runFunctionDetailCommand(command: string, label: string): RunCommandResult {
    const needsBootstrapAnalysis = !this.hasNativeSession();
    const finalCommand = needsBootstrapAnalysis
      ? `${this.getConfiguredAnalysisCommand()};${command}`
      : command;

    return this.runSessionCommand(finalCommand, {
      context: 'command',
      commandLabel: label,
      suppressNotice: true,
    });
  }

  private startNativeFileSession(writeMode = false): boolean {
    if (!this.filePath) {
      return false;
    }

    if (!this.ensureNativeSession() || !this.nativeApi || this.nativeSessionId == null) {
      this.emitNotice({
        severity: 'warning',
        code: 'native-session-unavailable',
        message: 'Persistent native session is unavailable. Falling back to compatibility mode.',
        detail: 'Disassembly and graph views still work, but switching functions will stay slower until the rzweb session API opens successfully.',
      });
      return false;
    }

    const opened = this.nativeApi.openFile(
      this.nativeSessionId,
      this.filePath,
      writeMode ? 1 : 0,
      this.runtimeConfig.ioCache ? 1 : 0
    );

    if (!opened) {
      const detail = this.getNativeLastError();
      this.emitNotice({
        severity: 'warning',
        code: 'native-session-open-failed',
        message: 'Persistent native session could not open this binary. Falling back to command invocations.',
        detail: detail || 'The WebAssembly module does not expose the native session API yet.',
      });
      this.nativeApi = null;
      this.nativeSessionId = null;
      return false;
    }

    this.runNativeCommand(
      'e scr.color=0;e scr.interactive=false;e scr.prompt=false;e scr.utf8=false;e scr.utf8.curvy=false;e log.level=0;e scr.pager=',
      { context: 'metadata', commandLabel: 'Native bootstrap', suppressNotice: true }
    );

    return true;
  }

  private restoreNativeProject(projectData: Uint8Array | undefined): boolean {
    if (!projectData || projectData.byteLength === 0 || !this.ensureNativeSession() || !this.projectPath || !this.nativeApi || this.nativeSessionId == null) {
      return false;
    }

    try {
      this.module.FS.writeFile(this.projectPath, projectData);
    } catch {
      return false;
    }

    const loaded = this.nativeApi.loadProject(this.nativeSessionId, this.projectPath, 1);
    return !!loaded;
  }

  private async persistNativeProject(): Promise<Uint8Array | null> {
    if (!this.hasNativeSession() || !this.nativeApi || this.nativeSessionId == null || !this.projectPath) {
      return null;
    }

    const saved = this.nativeApi.saveProject(this.nativeSessionId, this.projectPath, 0);
    if (!saved) {
      return null;
    }

    return readFsBytes(this.module, this.projectPath);
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  get currentFile(): RizinFile | null {
    return this.file;
  }

  get analysis(): AnalysisData | null {
    return this.analysisData;
  }

  get isAnalysisComplete(): boolean {
    return this.analysisCompleted;
  }

  get fileHash(): string {
    return this._fileHash;
  }

  get cacheHit(): boolean {
    return this._cacheHit;
  }

  getAutocomplete(input: string, cursorPos: number, maxResults: number): RizinAutocompleteResult | null {
    if (!this.hasNativeSession() || !this.nativeApi || !this.nativeApi.autocomplete || this.nativeSessionId == null) {
      return null;
    }

    const safeInput = input.slice(0, 4095);
    const safeCursorPos = Math.max(0, Math.min(cursorPos, safeInput.length));
    const safeMaxResults = Math.max(1, Math.min(maxResults, 100));

    try {
      const raw = this.nativeApi.autocomplete(this.nativeSessionId, safeInput, safeCursorPos, safeMaxResults);
      const parsed = this.parseJSON(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.options)) {
        return null;
      }

      const options = parsed.options
        .filter((option): option is string => typeof option === 'string' && option.length > 0)
        .slice(0, safeMaxResults);

      if (options.length === 0) {
        return null;
      }

      const start = typeof parsed.start === 'number' ? parsed.start : safeCursorPos;
      const end = typeof parsed.end === 'number' ? parsed.end : safeCursorPos;

      return {
        start: Math.max(0, Math.min(start, safeInput.length)),
        end: Math.max(0, Math.min(Math.max(end, start), safeInput.length)),
        endString: typeof parsed.endString === 'string' ? parsed.endString : '',
        options,
      };
    } catch {
      return null;
    }
  }

  getCommandCatalog(): Record<string, RizinCommandHelpEntry> {
    if (this.commandCatalogCache) {
      return this.commandCatalogCache;
    }

    if (!this.hasNativeSession() || !this.nativeApi || !this.nativeApi.getCommandCatalog || this.nativeSessionId == null) {
      return {};
    }

    try {
      const raw = this.nativeApi.getCommandCatalog(this.nativeSessionId);
      const parsed = this.parseJSON(raw);
      if (!isRecord(parsed)) {
        return {};
      }

      const catalog: Record<string, RizinCommandHelpEntry> = {};
      for (const [name, value] of Object.entries(parsed)) {
        if (!isRecord(value)) continue;
        catalog[name] = {
          name,
          summary: typeof value.summary === 'string' ? value.summary : undefined,
          description: typeof value.description === 'string' ? value.description : undefined,
          args: typeof value.args === 'string' ? value.args : undefined,
        };
      }

      this.commandCatalogCache = catalog;
      return catalog;
    } catch {
      return {};
    }
  }

  get allNotices(): RizinNotice[] {
    return [...this.notices];
  }

  onOutput(callback: (text: string) => void): () => void {
    this.outputCallbacks.push(callback);
    return () => {
      const idx = this.outputCallbacks.indexOf(callback);
      if (idx >= 0) this.outputCallbacks.splice(idx, 1);
    };
  }

  onError(callback: (text: string) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const idx = this.errorCallbacks.indexOf(callback);
      if (idx >= 0) this.errorCallbacks.splice(idx, 1);
    };
  }

  onNotice(callback: (notice: RizinNotice) => void): () => void {
    this.noticeCallbacks.push(callback);
    return () => {
      const idx = this.noticeCallbacks.indexOf(callback);
      if (idx >= 0) this.noticeCallbacks.splice(idx, 1);
    };
  }

  onAnalysisChanged(callback: () => void): () => void {
    this.analysisCallbacks.push(callback);
    return () => {
      const idx = this.analysisCallbacks.indexOf(callback);
      if (idx >= 0) this.analysisCallbacks.splice(idx, 1);
    };
  }

  private emitNotice(notice: Omit<RizinNotice, 'id'>): void {
    const existing = this.notices.find(
      item =>
        item.code === notice.code &&
        item.message === notice.message &&
        item.detail === notice.detail
    );
    if (existing) return;

    const fullNotice: RizinNotice = {
      id: `${notice.code}-${this.notices.length + 1}`,
      ...notice,
    };
    this.notices = [...this.notices, fullNotice];
    this.noticeCallbacks.forEach(cb => cb(fullNotice));
  }

  private emitAnalysisChanged(): void {
    this.analysisCallbacks.forEach(cb => cb());
  }

  private buildArgs(command: string, filePath: string): string[] {
    const args = [
      '-e', 'scr.color=0',
      '-e', 'scr.interactive=false',
      '-e', 'scr.prompt=false',
      '-e', 'scr.utf8=false',
      '-e', 'scr.utf8.curvy=false',
      '-e', 'log.level=0',
      '-e', 'scr.pager=',
      '-e', `io.cache=${this.runtimeConfig.ioCache ? 'true' : 'false'}`,
      ...this.runtimeConfig.extraArgs,
      '-q',
      '-c', command,
      filePath,
    ];

    return args;
  }

  private runCommand(command: string, filePath: string, options: RunCommandOptions = {}): RunCommandResult {
    this.stdoutBuffer = [];
    this.stderrBuffer = [];

    const args = this.buildArgs(command, filePath);
    const maxOutputBytes = Math.max(options.maxOutputBytes ?? this.runtimeConfig.maxOutputBytes, 1024);
    const startedAt = Date.now();

    this.activeOutputCapture = {
      maxOutputBytes,
      stdoutLength: 0,
      truncated: false,
      context: options.context ?? 'command',
      commandLabel: options.commandLabel,
    };

    try {
      this.module.callMain(args);
    } catch {
      // Rizin/Emscripten may throw after command completion; the captured buffers are the source of truth.
    } finally {
      const capture = this.activeOutputCapture;
      this.activeOutputCapture = null;

      if (capture?.truncated) {
        const limitLabel = formatBytes(maxOutputBytes);
        const suffix = `[output truncated at ${limitLabel}]`;
        this.stdoutBuffer.push(suffix);

        if (!options.suppressNotice) {
          const label = options.commandLabel || 'Command output';
          this.emitNotice({
            severity: 'error',
            code: 'output-truncated',
            message: `${label} exceeded ${limitLabel} and was truncated.`,
            detail: 'Increase Max Output Size in Settings for larger binaries or verbose commands.',
          });
        }
      }
    }

    return {
      output: this.stdoutBuffer.join('\n'),
      truncated: this.stdoutBuffer.includes(`[output truncated at ${formatBytes(maxOutputBytes)}]`),
      durationMs: Date.now() - startedAt,
    };
  }

  private sanitizeJSON(jsonStr: string): string {
    let result = '';
    let inString = false;
    let i = 0;

    while (i < jsonStr.length) {
      const char = jsonStr[i];
      const code = jsonStr.charCodeAt(i);

      if (inString && char === '\\' && i + 1 < jsonStr.length) {
        const nextChar = jsonStr[i + 1];

        if ('"\\\\/bfnrt'.includes(nextChar)) {
          result += char + nextChar;
          i += 2;
          continue;
        }

        if (nextChar === 'u' && i + 5 < jsonStr.length) {
          const hex = jsonStr.substring(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result += jsonStr.substring(i, i + 6);
            i += 6;
            continue;
          }
        }

        if (nextChar === 'x' && i + 3 < jsonStr.length) {
          const hex = jsonStr.substring(i + 2, i + 4);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            result += `\\u00${hex}`;
            i += 4;
            continue;
          }
        }

        if (nextChar >= '0' && nextChar <= '7') {
          let octal = '';
          let j = i + 1;
          while (j < jsonStr.length && j < i + 4 && jsonStr[j] >= '0' && jsonStr[j] <= '7') {
            octal += jsonStr[j];
            j++;
          }
          const val = parseInt(octal, 8);
          result += `\\u${val.toString(16).padStart(4, '0')}`;
          i = j;
          continue;
        }

        result += '\\\\';
        i++;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        result += char;
        i++;
        continue;
      }

      if (inString && code <= 0x1f) {
        result += `\\u${code.toString(16).padStart(4, '0')}`;
        i++;
        continue;
      }

      if (inString && code > 0x7f && code < 0xa0) {
        result += `\\u${code.toString(16).padStart(4, '0')}`;
        i++;
        continue;
      }

      if (!inString && (char === '\n' || char === '\r')) {
        i++;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  private tryParseJSONValue(jsonStr: string): unknown[] | unknown | null {
    try {
      return JSON.parse(jsonStr);
    } catch {
      try {
        return JSON.parse(this.sanitizeJSON(jsonStr));
      } catch (e: unknown) {
        const err = e as Error;
        console.error('[RizinInstance:parseJSON] Sanitization failed:', err.message);
        return null;
      }
    }
  }

  private extractBalancedJSON(text: string, startIndex: number, opener: '{' | '['): string | null {
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === opener) depth++;
      if (char === closer) depth--;

      if (depth === 0) {
        return text.substring(startIndex, i + 1);
      }
    }

    return null;
  }

  private parseJSON(text: string): unknown[] | unknown | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    if (/^(true|false|null)$/i.test(trimmed)) {
      return JSON.parse(trimmed.toLowerCase());
    }

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char !== '[' && char !== '{') {
        continue;
      }

      const jsonStr = this.extractBalancedJSON(trimmed, i, char);
      if (!jsonStr) {
        continue;
      }

      const parsed = this.tryParseJSONValue(jsonStr);
      if (parsed !== null) {
        return parsed;
      }
    }

    const jsonMatch = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      const parsed = this.tryParseJSONValue(jsonMatch[1]);
      if (parsed !== null) {
        return parsed;
      }

      const lines = trimmed.split('\n');
      for (const line of lines) {
        const lineTrim = line.trim();
        if (
          (lineTrim.startsWith('[') && lineTrim.endsWith(']')) ||
          (lineTrim.startsWith('{') && lineTrim.endsWith('}'))
        ) {
          const lineParsed = this.tryParseJSONValue(lineTrim);
          if (lineParsed !== null) {
            return lineParsed;
          }
        }
      }
    }

    return null;
  }

  private parseAddressLiteral(expr: string): number | null {
    const trimmed = expr.trim();
    if (!trimmed) return null;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return parseInt(trimmed, 16);
    }
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    return null;
  }

  private updateCurrentAddressFromCommand(command: string): void {
    const parts = this.splitCommands(command);
    for (const part of parts) {
      const seekMatch = part.match(/^s\s+(.+)$/);
      if (seekMatch) {
        const parsed = this.parseAddressLiteral(seekMatch[1]);
        if (parsed != null) {
          this.currentAddress = `0x${parsed.toString(16)}`;
        }
      }

      const atMatch = part.match(/@\s*(0x[0-9a-f]+|\d+)/i);
      if (atMatch) {
        const parsed = this.parseAddressLiteral(atMatch[1]);
        if (parsed != null) {
          this.currentAddress = `0x${parsed.toString(16)}`;
        }
      }
    }
  }

  private splitCommands(command: string): string[] {
    return command
      .split(';')
      .map(part => part.trim())
      .filter(Boolean);
  }

  private getFunctionDetailKey(address: number): string {
    return `0x${address.toString(16)}`;
  }

  private needsSeekRestore(command: string): boolean {
    const parts = this.splitCommands(command);
    if (parts.length === 0) return false;

    const hasExplicitSeek = parts.some(
      part => part === 's' || part.startsWith('s ') || part.includes('@')
    );

    if (hasExplicitSeek) {
      return parts.length === 1 && parts[0] === 's';
    }

    const seekSensitive = [
      'pdf',
      'pd ',
      'pdj',
      'p8',
      'px',
      'agf',
      'agc',
      'vv',
      'af',
      'ao',
    ];

    return parts.some(part => {
      const lower = part.toLowerCase();
      return seekSensitive.some(prefix => lower.startsWith(prefix));
    });
  }

  private resolveAnalysisCommand(depth: number): string {
    return depth >= 3 ? 'aaaa' : depth >= 2 ? 'aaa' : 'aa';
  }

  private getConfiguredAnalysisCommand(): string {
    return this.resolveAnalysisCommand(this.runtimeConfig.analysisDepth);
  }

  private buildRefreshPlan(command: string): RefreshPlan {
    const parts = this.splitCommands(command);
    const lowerParts = parts.map(part => part.toLowerCase());

    const markAnalysisComplete = lowerParts.some(
      part => part === 'aa' || part === 'aaa' || part === 'aaaa' || part === 'af' || part === 'af+'
    );

    const refreshFunctions =
      markAnalysisComplete || lowerParts.some(part => part.startsWith('afl') || part.startsWith('afj'));
    const refreshStrings = lowerParts.some(part => part.startsWith('iz'));
    const refreshImports = parts.some(part => part.startsWith('ii'));
    const refreshExports = parts.some(part => part.startsWith('iE'));
    const refreshSections = parts.some(part => part.startsWith('iS'));
    const refreshInfo = parts.some(
      part =>
        part === 'i' ||
        part.startsWith('ij') ||
        part.startsWith('iI') ||
        part.startsWith('ie') ||
        part.startsWith('ih') ||
        part.startsWith('iH') ||
        part.startsWith('il') ||
        part.startsWith('iM') ||
        part.startsWith('ir') ||
        part.startsWith('iT') ||
        part.startsWith('iV')
    );

    return {
      markAnalysisComplete,
      refreshFunctions,
      refreshStrings,
      refreshImports,
      refreshExports,
      refreshSections,
      refreshInfo,
    };
  }

  private readJsonValue(commands: string[], label: string): { value: unknown[] | unknown | null; truncated: boolean } {
    let sawTruncation = false;

    for (const command of commands) {
      const result = this.runSessionCommand(command, {
        context: 'metadata',
        commandLabel: label,
        suppressNotice: true,
      });
      sawTruncation = sawTruncation || result.truncated;

      const parsed = this.parseJSON(result.output);
      if (parsed !== null) {
        return { value: parsed, truncated: sawTruncation };
      }
    }

    if (sawTruncation) {
      this.emitNotice({
        severity: 'error',
        code: 'metadata-unavailable',
        message: `${label} could not be fully loaded within the current output limit.`,
        detail: 'Increase Max Output Size in Settings and reopen the binary to index this view completely.',
      });
    }

    return { value: null, truncated: sawTruncation };
  }

  private loadArrayIntoAnalysis(
    key: 'functions' | 'strings' | 'imports' | 'exports' | 'sections',
    commands: string[],
    label: string
  ): DataLoadResult {
    if (!this.analysisData) return { loaded: false, truncated: false };

    const { value, truncated } = this.readJsonValue(commands, label);
    if (Array.isArray(value)) {
      this.analysisData[key] = value;
      return { loaded: true, truncated };
    }
    return { loaded: false, truncated };
  }

  private loadInfoIntoAnalysis(): DataLoadResult {
    if (!this.analysisData) return { loaded: false, truncated: false };

    const infoRecord =
      this.analysisData.info && typeof this.analysisData.info === 'object' && !Array.isArray(this.analysisData.info)
        ? this.analysisData.info as Record<string, unknown>
        : {};

    let loaded = false;
    let truncated = false;

    const sections: Array<{ key: string; commands: string[]; label: string }> = [
      { key: 'overview', commands: ['ij'], label: 'Binary overview' },
      { key: 'binaryInfo', commands: ['iIj'], label: 'Binary info' },
      { key: 'entries', commands: ['iej'], label: 'Entrypoints' },
      { key: 'initFini', commands: ['ieej'], label: 'Init/Fini' },
      { key: 'headerFields', commands: ['ihj'], label: 'Header fields' },
      { key: 'structuredHeader', commands: ['iHj'], label: 'Structured header' },
      { key: 'libraries', commands: ['ilj'], label: 'Libraries' },
      { key: 'mainAddress', commands: ['iMj'], label: 'Main address' },
      { key: 'segments', commands: ['iSSj'], label: 'Segments' },
      { key: 'hashes', commands: ['iTj'], label: 'Hashes' },
      { key: 'versionInfo', commands: ['iVj'], label: 'Version info' },
      { key: 'relocations', commands: ['irj'], label: 'Relocations' },
    ];

    for (const section of sections) {
      const { value, truncated: sectionTruncated } = this.readJsonValue(section.commands, section.label);
      truncated = truncated || sectionTruncated;

      if (value !== null) {
        infoRecord[section.key] = value;
        loaded = true;
      }
    }

    if (loaded) {
      this.analysisData.info = infoRecord;
      return { loaded: true, truncated };
    }

    return { loaded: false, truncated };
  }

  private getCachedFunctionDetail(address: number): FunctionDetailCacheEntry | null {
    if (!this.analysisData) return null;
    const cached = this.analysisData.functionDetails[this.getFunctionDetailKey(address)] ?? null;
    if (!cached) return null;

    return {
      ...cached,
      disasm: hasUsableDisasmPayload(cached.disasm) ? cached.disasm : undefined,
      graph: hasUsableGraphPayload(cached.graph) ? cached.graph : undefined,
    };
  }

  private async persistFunctionDetail(
    address: number,
    detail: Partial<FunctionDetailCacheEntry>
  ): Promise<FunctionDetailCacheEntry | null> {
    if (!this.analysisData) return null;

    const key = this.getFunctionDetailKey(address);
    const nextDetail: FunctionDetailCacheEntry = {
      ...this.analysisData.functionDetails[key],
      ...detail,
      updatedAt: Date.now(),
    };
    this.analysisData.functionDetails[key] = nextDetail;
    await this.persistCurrentAnalysis();
    return nextDetail;
  }

  async getFunctionDetails(address: number): Promise<FunctionDetailCacheEntry> {
    const hexAddress = this.getFunctionDetailKey(address);
    const cached = this.getCachedFunctionDetail(address);
    if (cached && hasUsableDisasmPayload(cached.disasm) && hasUsableGraphPayload(cached.graph)) {
      return cached;
    }

    const pending = this.pendingFunctionDetailLoads.get(hexAddress);
    if (pending) {
      return pending;
    }

    const loadPromise = (async () => {
      this.currentAddress = hexAddress;

      const disasmResult = this.runFunctionDetailCommand(`s ${hexAddress};pdfj`, 'Function disassembly');
      const disasm = this.parseJSON(disasmResult.output);

      let graph = this.parseJSON(
        this.runFunctionDetailCommand(`s ${hexAddress};agfj`, 'Function graph').output
      );

      if (graph == null) {
        graph = this.parseJSON(
          this.runFunctionDetailCommand(`s ${hexAddress};agf json`, 'Function graph').output
        );
      }

      const nextDisasm = hasUsableDisasmPayload(disasm)
        ? disasm
        : hasUsableDisasmPayload(cached?.disasm)
          ? cached?.disasm
          : undefined;
      const nextGraph = hasUsableGraphPayload(graph)
        ? graph
        : hasUsableGraphPayload(cached?.graph)
          ? cached?.graph
          : undefined;

      const detail =
        nextDisasm || nextGraph
          ? await this.persistFunctionDetail(address, {
              disasm: nextDisasm,
              graph: nextGraph,
            })
          : null;

      return detail ?? {
        disasm: nextDisasm,
        graph: nextGraph,
        updatedAt: Date.now(),
      };
    })();

    this.pendingFunctionDetailLoads.set(hexAddress, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.pendingFunctionDetailLoads.delete(hexAddress);
    }
  }

  private refreshCurrentAddress(): void {
    const output = this.hasNativeSession()
      ? this.runNativeCommand('s', {
          context: 'metadata',
          commandLabel: 'Current seek',
          suppressNotice: true,
          maxOutputBytes: 1024,
        }).output
      : this.filePath
        ? this.runCommand('s', this.filePath, {
            context: 'metadata',
            commandLabel: 'Current seek',
            suppressNotice: true,
            maxOutputBytes: 1024,
          }).output
        : '';

    const match = output.trim().match(/^(0x[0-9a-fA-F]+)/);
    if (match) {
      this.currentAddress = match[1];
    }
  }

  private async refreshAnalysisData(plan: RefreshPlan): Promise<{ changed: boolean; truncated: boolean }> {
    if (!this.analysisData || !this.filePath) {
      return { changed: false, truncated: false };
    }

    let changed = false;
    let truncated = false;

    if (plan.markAnalysisComplete && !this.analysisCompleted) {
      this.analysisCompleted = true;
      changed = true;
    }

    if (plan.refreshFunctions) {
      const functionCommands = this.hasNativeSession()
        ? ['aflj']
        : [`${this.getConfiguredAnalysisCommand()};aflj`];
      const result = this.loadArrayIntoAnalysis(
        'functions',
        functionCommands,
        'Functions'
      );
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
      await this.yield();
    }

    if (plan.refreshStrings) {
      const result = this.loadArrayIntoAnalysis('strings', ['izzj', 'izj'], 'Strings');
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
      await this.yield();
    }

    if (plan.refreshImports) {
      const result = this.loadArrayIntoAnalysis('imports', ['iij'], 'Imports');
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
      await this.yield();
    }

    if (plan.refreshExports) {
      const result = this.loadArrayIntoAnalysis('exports', ['iEj'], 'Exports');
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
      await this.yield();
    }

    if (plan.refreshSections) {
      const result = this.loadArrayIntoAnalysis('sections', ['iSj'], 'Sections');
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
      await this.yield();
    }

    if (plan.refreshInfo) {
      const result = this.loadInfoIntoAnalysis();
      changed = changed || result.loaded;
      truncated = truncated || result.truncated;
    }

    if (changed) {
      this.emitAnalysisChanged();
    }

    return { changed, truncated };
  }

  private shouldPersistCache(truncated: boolean): boolean {
    if (truncated) return false;
    if (!this.runtimeConfig.enableCache) return false;
    if (!this.analysisCompleted) return false;
    if (!this.file || !this._fileHash || !this.analysisData) return false;
    return hasUsableAnalysisData(this.analysisData);
  }

  private async persistCurrentAnalysis(): Promise<void> {
    if (!this.shouldPersistCache(false) || !this.file || !this.analysisData) {
      return;
    }

    const cacheIsBlocked = this.notices.some(notice => CACHE_BLOCKING_NOTICE_CODES.has(notice.code));
    if (cacheIsBlocked) return;

    const serialized = JSON.stringify(this.analysisData);
    const projectData = await this.persistNativeProject();
    const cacheEntry: CachedAnalysis = {
      hash: this._fileHash,
      fileName: this.file.name,
      fileSize: this.file.data.length,
      timestamp: Date.now(),
      analysisDepth: this.runtimeConfig.analysisDepth,
      dataSize: serialized.length + (projectData?.byteLength ?? 0) + this.file.data.byteLength,
      complete: true,
      binaryData: this.file.data,
      projectData: projectData ?? undefined,
      data: this.analysisData,
    };
    await setCachedAnalysis(cacheEntry);
  }

  async open(file: RizinFile, config?: RizinInstanceConfig): Promise<void> {
    this.close();
    this.file = file;
    this.stdoutBuffer = [];
    this.stderrBuffer = [];
    this._isOpen = true;
    this.analysisCompleted = false;
    this._cacheHit = false;
    this.currentAddress = '0x00000000';
    this.notices = [];
    this.commandCatalogCache = null;
    this.runtimeConfig = {
      ioCache: config?.ioCache ?? true,
      analysisDepth: config?.analysisDepth ?? 2,
      extraArgs: config?.extraArgs ?? [],
      noAnalysis: config?.noAnalysis ?? false,
      maxOutputBytes: config?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      enableCache: config?.enableCache ?? true,
    };

    this.analysisData = {
      functions: [],
      strings: [],
      imports: [],
      exports: [],
      sections: [],
      info: null,
      functionDetails: {},
    };

    this._fileHash = await computeFileHash(file.data);
    this.buildStablePaths(file, this._fileHash);
    this.ensureWorkDir();
    this.module.FS.writeFile(this.filePath, file.data);

    const cached = this.runtimeConfig.enableCache
      ? await getCachedAnalysis(this._fileHash, this.runtimeConfig.analysisDepth)
      : null;
    if (cached) {
      this.analysisData = {
        ...cached.data,
        functionDetails: cached.data.functionDetails ?? {},
      };
      this._cacheHit = true;
    }

    if (this.ensureNativeSession() && this.restoreNativeProject(cached?.projectData)) {
      this.analysisCompleted = true;
      this.refreshCurrentAddress();

      if (!hasUsableAnalysisData(this.analysisData)) {
        const refreshResult = await this.refreshAnalysisData({
          markAnalysisComplete: true,
          refreshFunctions: true,
          refreshStrings: true,
          refreshImports: true,
          refreshExports: true,
          refreshSections: true,
          refreshInfo: true,
        });

        if (!refreshResult.truncated) {
          await this.persistCurrentAnalysis();
        }
      } else {
        this.emitAnalysisChanged();
      }

      return;
    }

    if (cached && !this.hasNativeSession()) {
      this.analysisCompleted = true;
      this.refreshCurrentAddress();
      this.emitAnalysisChanged();
      return;
    }

    const nativeSessionReady = this.startNativeFileSession();
    this.refreshCurrentAddress();

    if (file.data.length >= LARGE_BINARY_ALERT_BYTES) {
      this.emitNotice({
        severity: 'error',
        code: 'large-binary',
        message: `Large binary detected (${formatBytes(file.data.length)}). Initial analysis is being front-loaded on open.`,
        detail: 'This avoids empty sidebars and repeated aa; ... chaining, but browser/WASM analysis may still take longer on bigger files.',
      });
    }

    let truncated = false;

    if (nativeSessionReady && !this.runtimeConfig.noAnalysis) {
      const analysisResult = this.runNativeCommand(this.getConfiguredAnalysisCommand(), {
        context: 'analysis',
        commandLabel: 'Initial analysis',
        suppressNotice: true,
      });
      truncated = truncated || analysisResult.truncated;
      this.analysisCompleted = true;
      await this.yield();
    } else if (!this.runtimeConfig.noAnalysis) {
      const functionsResult = this.loadArrayIntoAnalysis(
        'functions',
        [`${this.getConfiguredAnalysisCommand()};aflj`],
        'Functions'
      );
      truncated = truncated || functionsResult.truncated;
      this.analysisCompleted = true;
      if (!functionsResult.loaded) {
        this.emitNotice({
          severity: 'warning',
          code: 'functions-unavailable',
          message: 'Function analysis did not populate during startup.',
          detail: 'The binary is open, but function indexing could not be parsed from the current WASM run.',
        });
      }
      await this.yield();
    } else {
      this.emitNotice({
        severity: 'warning',
        code: 'auto-analysis-disabled',
        message: 'Auto-analysis is disabled. Function and graph views stay empty until you run aa, aaa, or aaaa.',
      });
    }

    const refreshResult = await this.refreshAnalysisData({
      markAnalysisComplete: this.analysisCompleted,
      refreshFunctions: nativeSessionReady && !this.runtimeConfig.noAnalysis,
      refreshStrings: true,
      refreshImports: true,
      refreshExports: true,
      refreshSections: true,
      refreshInfo: true,
    });

    truncated = truncated || refreshResult.truncated;

    if (!truncated) {
      await this.persistCurrentAnalysis();
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this._isOpen || !this.file) {
      return 'Error: No file loaded';
    }

    return new Promise<string>((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.commandQueue.length === 0) return;
    this.processing = true;

    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift()!;
      try {
        const originalCmd = item.command.trim();
        let finalCmd = originalCmd;

        if (this.needsSeekRestore(finalCmd)) {
          finalCmd = `s ${this.currentAddress};${finalCmd}`;
        }

        const prefixedAnalysis = !this.hasNativeSession() && this.needsAnalysisPrefix(finalCmd);
        if (prefixedAnalysis) {
          finalCmd = `${this.getConfiguredAnalysisCommand()};${finalCmd}`;
        }

        const result = this.runSessionCommand(finalCmd, {
          context: 'command',
          commandLabel: 'Command output',
        });

        this.updateCurrentAddressFromCommand(finalCmd);
        item.resolve(result.output);

        const refreshPlan = this.buildRefreshPlan(originalCmd);
        if (prefixedAnalysis) {
          refreshPlan.markAnalysisComplete = true;
        }
        const refreshResult = await this.refreshAnalysisData(refreshPlan);
        const shouldPersist =
          !refreshResult.truncated &&
          (this.hasNativeSession() || refreshPlan.markAnalysisComplete);

        if (shouldPersist) {
          await this.persistCurrentAnalysis();
        }
      } catch (e) {
        item.reject(e instanceof Error ? e : new Error(String(e)));
      }
      await this.yield();
    }

    this.processing = false;
  }

  private needsAnalysisPrefix(cmd: string): boolean {
    const analysisCommands = ['pdf', 'afl', 'afn', 'agf', 'agc', 'vv', 'ax', 'af', 'pd '];
    const parts = this.splitCommands(cmd);

    return parts.some(part => {
      const lower = part.toLowerCase();
      if (lower.startsWith('s ') || lower === 's' || lower.startsWith('s;')) {
        return false;
      }
      if (lower.startsWith('aa') || lower === 'af' || lower === 'af+') {
        return false;
      }
      return analysisCommands.some(prefix => lower.startsWith(prefix));
    });
  }

  getLastStderr(): string {
    return this.stderrBuffer.join('\n');
  }

  getCurrentAddress(): string {
    return this.currentAddress;
  }

  async getDisassembly(address: number): Promise<string> {
    this.currentAddress = `0x${address.toString(16)}`;
    const detail = await this.getFunctionDetails(address);
    return detail.disasm ? JSON.stringify(detail.disasm) : '';
  }

  async getGraph(address: number): Promise<unknown> {
    this.currentAddress = `0x${address.toString(16)}`;
    const detail = await this.getFunctionDetails(address);
    return detail.graph ?? null;
  }

  async getHexDump(address: number, length = 256): Promise<string> {
    this.currentAddress = `0x${address.toString(16)}`;
    return this.executeCommand(`s ${address};pxj ${length}`);
  }

  sendInput(input: string): void {
    const command = input.replace(/[\r\n]+$/, '').slice(0, MAX_COMMAND_HISTORY_BYTES);
    if (command) {
      this.executeCommand(command);
    }
  }

  close(): void {
    if (this._isOpen) {
      if (this.nativeApi && this.nativeSessionId != null) {
        try {
          this.nativeApi.closeSession(this.nativeSessionId);
        } catch {
          // Ignore native session teardown failures during cleanup.
        }
      }

      this._isOpen = false;
      this.stdoutBuffer = [];
      this.stderrBuffer = [];
      this.commandQueue = [];
      this.processing = false;
      this.activeOutputCapture = null;
      this.pendingFunctionDetailLoads.clear();

      if (this.filePath && this.module?.FS) {
        try {
          this.module.FS.unlink(this.filePath);
        } catch {
          // The file may already have been removed during teardown.
        }
      }

      if (this.projectPath && this.module?.FS) {
        try {
          this.module.FS.unlink(this.projectPath);
        } catch {
          // The project file may not exist yet in the in-memory FS.
        }
      }

      this.file = null;
      this.analysisData = null;
      this.filePath = '';
      this.projectPath = '';
      this.analysisCompleted = false;
      this._fileHash = '';
      this._cacheHit = false;
      this.notices = [];
      this.currentAddress = '0x00000000';
      this.nativeSessionId = null;
      this.commandCatalogCache = null;
    }
  }
}
