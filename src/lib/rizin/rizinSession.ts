import type { RizinModule } from './RizinLoader';
import {
  computeFileHash,
  getCachedAnalysis,
  setCachedAnalysis,
  type CachedAnalysis,
} from './analysisCache';
import type {
  AnalysisData,
  FunctionDetailCacheEntry,
  RizinAutocompleteResult,
  RizinCommandHelpEntry,
  RizinFile,
  RizinInstanceConfig,
  RizinNotice,
  RizinStateSnapshot,
  RizinWorkerEvent,
  XrefEntry,
  XrefsResult,
} from './rizinProtocol';
import { decodeProjectBundle, encodeProjectBundle } from './projectBundle';

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
  setWriteMode?: (sessionId: number, enable: number) => number;
  commitChanges?: (sessionId: number) => number;
  getFileSize?: (sessionId: number) => number;
}

interface CommandTokenBounds {
  start: number;
  end: number;
  fragment: string;
}

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LARGE_BINARY_ALERT_BYTES = 1024 * 1024;
const PERSIST_THROTTLE_MS = 1500;
const ESC = String.fromCharCode(27);
// CSI sequences (colours, cursor moves, line clears). SGR colour codes end in
// 'm' and are kept so terminal output retains Rizin's syntax highlighting.
// Every other CSI sequence (cursor positioning, clears) is dropped.
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
// OSC sequences (e.g. window title) terminated by BEL or String Terminator.
const OSC_RE = new RegExp(`${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)`, 'g');
// A lone ESC that is not the start of a CSI sequence we kept above.
const LONE_ESC_RE = new RegExp(`${ESC}(?!\\[)`, 'g');
// Strip control/non-printable bytes but keep tab, newlines and ESC (for SGR).
const NON_PRINTABLE_RE = new RegExp(`[^\\n\\r\\t${ESC} -~]`, 'g');
// Removes all ANSI styling, used where output must be plain (e.g. decompiler).
const ANSI_STRIP_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

// Matches Rizin's command-parser debug lines so we can drop them from stderr.
const PARSER_DEBUG_RE = /^\s*DEBUG:\s/;

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

// Parses a `p8` hex dump into raw bytes. Skips whitespace and stops at the first
// non-hex character (e.g. a truncation note), tolerating short or odd reads.
function parseHexBytes(text: string): Uint8Array {
  const nibbles = new Uint8Array(text.length);
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 32 || c === 9) continue;
    let value: number;
    if (c >= 48 && c <= 57) value = c - 48;
    else if (c >= 97 && c <= 102) value = c - 87;
    else if (c >= 65 && c <= 70) value = c - 55;
    else break;
    nibbles[count++] = value;
  }
  const byteCount = count >> 1;
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = (nibbles[2 * i] << 4) | nibbles[2 * i + 1];
  }
  return bytes;
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

function compareAutocompleteValues(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  return a.localeCompare(b);
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

// Owns the Rizin module inside the worker: native calls, FS, JSON parsing, and
// persistence. State reaches the facade via the injected `emit` and snapshot().
export class RizinSession {
  private module: RizinModule;
  private emit: (event: RizinWorkerEvent) => void;
  private file: RizinFile | null = null;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
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
  private writeMode = false;
  private dirty = false;
  // Mutable copy of the raw file backing the hex editor (physical offsets).
  private fileImage: Uint8Array | null = null;
  private commandCatalogCache: Record<string, RizinCommandHelpEntry> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDirty = false;
  // Stderr from the most recent user (terminal) command only. Captured before the
  // background refresh runs so the terminal never shows other commands' errors.
  private lastCommandStderr = '';
  // Decompiler command this build exposes, resolved once from the command
  // catalog: null = not yet looked up, '' = none shipped, otherwise the command.
  private decompilerCmd: string | null = null;
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

  constructor(module: RizinModule, emit: (event: RizinWorkerEvent) => void) {
    this.module = module;
    this.emit = emit;
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
    };

    this.module._printErrHandler = (text: string) => {
      const cleaned = this.cleanText(text);
      if (!cleaned) return;
      // Drop the parser debug spew so it neither floods the terminal nor reads as an error.
      const filtered = cleaned
        .split('\n')
        .filter(line => !PARSER_DEBUG_RE.test(line))
        .join('\n');
      if (!filtered.trim()) return;
      this.stderrBuffer.push(filtered);
    };
  }

  // Sanitizes Rizin output for display while keeping SGR colour codes intact so
  // the terminal renders Rizin's native syntax highlighting.
  private cleanText(text: string): string {
    return text
      .replace(OSC_RE, '')
      .replace(CSI_RE, seq => (seq.endsWith('m') ? seq : ''))
      .replace(LONE_ESC_RE, '')
      .replace(/[\u2500-\u257F]/g, '-')
      .replace(NON_PRINTABLE_RE, '');
  }

  // Fully removes ANSI styling for consumers that render their own highlighting
  // (e.g. the decompiler view) or parse the text.
  private stripAnsi(text: string): string {
    return text.replace(ANSI_STRIP_RE, '');
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
      const hasSetWriteMode = typeof exported._rzweb_set_write_mode === 'function';
      const hasCommitChanges = typeof exported._rzweb_commit_changes === 'function';
      const hasGetFileSize = typeof exported._rzweb_get_file_size === 'function';
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
        setWriteMode: hasSetWriteMode
          ? this.module.cwrap('rzweb_set_write_mode', 'number', ['number', 'number']) as (
              sessionId: number,
              enable: number
            ) => number
          : undefined,
        commitChanges: hasCommitChanges
          ? this.module.cwrap('rzweb_commit_changes', 'number', ['number']) as (
              sessionId: number
            ) => number
          : undefined,
        getFileSize: hasGetFileSize
          ? this.module.cwrap('rzweb_get_file_size', 'number', ['number']) as (
              sessionId: number
            ) => number
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

    // Reset per-command so getLastStderr()/snapshot reflect only this command and
    // background view-RPC errors never accumulate into the terminal's stderr view.
    this.stdoutBuffer = [];
    this.stderrBuffer = [];

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

    this.applyDisplayDefaults();
    this.writeMode = writeMode;

    return true;
  }

  // Display/runtime settings applied after any core (re)initialization. The C
  // session resets these to defaults on every open/load, so re-apply them here.
  // scr.color=3 enables truecolor SGR output so the terminal shows Rizin's
  // native syntax highlighting. scr.utf8 stays off to keep output ASCII-safe.
  private applyDisplayDefaults(): void {
    this.runNativeCommand(
      'e scr.color=3;e scr.color.args=true;e scr.color.bytes=true;e scr.interactive=false;e scr.prompt=false;e scr.utf8=false;e scr.utf8.curvy=false;e log.level=0;e scr.pager=',
      { context: 'metadata', commandLabel: 'Native bootstrap', suppressNotice: true }
    );
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
    if (loaded) {
      // loadProject resets the core and clears our display settings, re-apply them.
      this.applyDisplayDefaults();
    }
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

  async exportProject(): Promise<Uint8Array> {
    if (!this._isOpen || !this.file) {
      throw new Error('Open a binary before saving a Rizin project.');
    }

    const data = await this.persistNativeProject();
    if (!data || data.byteLength === 0) {
      throw new Error(this.getNativeLastError() || 'Rizin did not produce project data for this binary.');
    }
    // Wrap the rzdb together with the binary so the saved file reopens cold. A
    // bare rzdb only stores the binary's path, not its bytes.
    return encodeProjectBundle(this.file.name, this.file.data, data);
  }

  async importProject(projectData: Uint8Array): Promise<void> {
    if (!projectData || projectData.byteLength === 0) {
      throw new Error('The selected project file is empty.');
    }

    // Self-contained RzWeb bundle: cold-open the embedded binary and restore the
    // project in one step, regardless of what (if anything) is currently open.
    const bundle = decodeProjectBundle(projectData);
    if (bundle) {
      await this.open({ name: bundle.name, data: bundle.binary }, undefined, bundle.rzdb);
      return;
    }

    // Raw Rizin .rzdb: it references the binary by path, so the matching binary
    // must already be open for the project to resolve.
    if (!this._isOpen || !this.file) {
      throw new Error('Open the matching binary first, then load this raw Rizin project, or load a project saved from RzWeb.');
    }

    if (!this.restoreNativeProject(projectData)) {
      throw new Error(this.getNativeLastError() || 'Rizin could not load this project into the current binary.');
    }

    this.analysisCompleted = true;
    if (this.analysisData) {
      this.analysisData.functionDetails = {};
    }
    this.refreshCurrentAddress();
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
    this.emitAnalysisChanged();
  }

  // Reopen the file read-write or read-only without losing analysis.
  setWriteMode(enable: boolean): boolean {
    if (!this._isOpen || !this.file) {
      throw new Error('Open a binary before toggling write mode.');
    }
    if (!this.hasNativeSession() || !this.nativeApi || this.nativeSessionId == null) {
      throw new Error('Write mode needs the native session API, which is unavailable in this build.');
    }

    if (this.nativeApi.setWriteMode) {
      this.nativeApi.setWriteMode(this.nativeSessionId, enable ? 1 : 0);
    } else {
      // oo+ is read-write, oo is read-only.
      this.runNativeCommand(enable ? 'oo+' : 'oo', {
        context: 'metadata',
        commandLabel: 'Toggle write mode',
        suppressNotice: true,
      });
    }

    // Reopening resets the core display settings, so restore them.
    this.applyDisplayDefaults();
    this.writeMode = enable;
    this.refreshCurrentAddress();
    return this.writeMode;
  }

  // --- Raw file access (hex editor) -----------------------------------------
  // The hex view works on the raw file image at physical offsets, so search and
  // edits are like HxD (hehe) (every byte, mapped or not).

  readFileSlice(offset: number, length: number): Uint8Array {
    if (!this.fileImage || offset < 0 || offset >= this.fileImage.length) {
      return new Uint8Array(0);
    }
    return this.fileImage.slice(offset, Math.min(offset + length, this.fileImage.length));
  }

  // Exact byte search over the whole raw file. caseInsensitive folds ASCII A-Z.
  searchFileBytes(needle: Uint8Array, caseInsensitive: boolean): number[] {
    const hay = this.fileImage;
    const n = needle.length;
    if (!hay || n === 0 || n > hay.length) return [];
    const fold = caseInsensitive
      ? (b: number) => (b >= 65 && b <= 90 ? b + 32 : b)
      : (b: number) => b;
    const first = fold(needle[0]);
    const matches: number[] = [];
    const limit = hay.length - n;
    for (let i = 0; i <= limit; i++) {
      if (fold(hay[i]) !== first) continue;
      let ok = true;
      for (let j = 1; j < n; j++) {
        if (fold(hay[i + j]) !== fold(needle[j])) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matches.push(i);
        if (matches.length >= 100000) break;
      }
    }
    return matches;
  }

  patchFile(offset: number, hex: string): { ok: boolean; error?: string } {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length === 0 || clean.length % 2 !== 0) {
      return { ok: false, error: 'Enter an even number of hex digits.' };
    }
    if (!this.fileImage) return { ok: false, error: 'No binary is open.' };
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    if (offset < 0 || offset + bytes.length > this.fileImage.length) {
      return { ok: false, error: 'Patch is out of range.' };
    }
    this.fileImage.set(bytes, offset);
    this.dirty = true;
    return { ok: true };
  }

  // Returns the edited raw file. Merges in any terminal write-cache edits.
  async exportBinary(): Promise<{ data: Uint8Array; name: string }> {
    if (!this.file || !this.fileImage) {
      throw new Error('Open a binary before exporting it.');
    }
    const merged = new Uint8Array(this.fileImage);
    if (this.hasNativeSession() && this.nativeApi && this.nativeSessionId != null) {
      if (this.nativeApi.commitChanges) this.nativeApi.commitChanges(this.nativeSessionId);
      else this.runNativeCommand('wci', { context: 'metadata', commandLabel: 'Commit changes', suppressNotice: true });
      const rizinBytes = this.filePath ? readFsBytes(this.module, this.filePath) : null;
      const orig = this.file.data;
      if (rizinBytes && rizinBytes.length === orig.length) {
        // Apply terminal/rizin edits where the hex editor did not change a byte.
        for (let i = 0; i < merged.length; i++) {
          if (rizinBytes[i] !== orig[i] && merged[i] === orig[i]) merged[i] = rizinBytes[i];
        }
      }
    }
    this.dirty = false;
    return { data: merged, name: this.file.name };
  }

  // --- Scripting ------------------------------------------------------------

  // Synchronous command API exposed to JavaScript scripts
  private buildScriptApi(logs: string[]) {
    const runCmd = (command: unknown): string => {
      const result = this.runNativeCommand(String(command ?? ''), {
        context: 'command',
        commandLabel: 'Script',
        suppressNotice: true,
      });
      return this.stripAnsi(result.output);
    };
    const runCmdJson = (command: unknown): unknown => {
      const out = runCmd(command).trim();
      return out ? JSON.parse(out) : null;
    };
    const push = (args: unknown[]) =>
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    return {
      cmd: runCmd,
      call: runCmd,
      cmdj: runCmdJson,
      callj: runCmdJson,
      cmdAt: (command: unknown, at: unknown) => runCmd(`${command} @ ${at}`),
      log: (...args: unknown[]) => push(args),
    };
  }

  runScript(source: string, language: 'rz' | 'js'): { output: string; error?: string } {
    if (!this._isOpen || !this.file) {
      return { output: '', error: 'Open a binary before running a script.' };
    }
    if (!this.hasNativeSession()) {
      return { output: '', error: 'Scripting needs the native session API.' };
    }

    if (language === 'rz') {
      const path = `${this.workDir}/.rzweb-script.rz`;
      try {
        this.module.FS.writeFile(path, source);
      } catch {
        return { output: '', error: 'Could not stage the script.' };
      }
      const result = this.runNativeCommand(`. ${path}`, {
        context: 'command',
        commandLabel: 'Run script',
        suppressNotice: true,
      });
      try {
        this.module.FS.unlink(path);
      } catch {
        // Already gone, ignore.
      }
      const stderr = this.stderrBuffer.join('\n').trim();
      return { output: this.stripAnsi(result.output), error: stderr || undefined };
    }

    const logs: string[] = [];
    const api = this.buildScriptApi(logs);
    const consoleShim = { log: api.log, info: api.log, warn: api.log, error: api.log };
    try {
      // The Scripts panel is an opt-in sandbox: the user runs their own
      // JavaScript against the rz API inside this worker, like a REPL. The
      // source is authored locally by the same operator (typed in the editor or
      // loaded from a file they pick), never supplied by a remote party, so this
      // is not a code-injection vector despite the editor-to-Function dataflow.
      const fn = new Function('rz', 'console', `"use strict";\n${source}`);
      const returned = fn(api, consoleShim);
      if (returned !== undefined) {
        logs.push(typeof returned === 'string' ? returned : JSON.stringify(returned, null, 2));
      }
      return { output: logs.join('\n') };
    } catch (error) {
      return { output: logs.join('\n'), error: error instanceof Error ? error.message : String(error) };
    }
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
    const safeInput = input.slice(0, 4095);
    const safeCursorPos = Math.max(0, Math.min(cursorPos, safeInput.length));
    const safeMaxResults = Math.max(1, Math.min(maxResults, 100));
    if (this.hasNativeSession() && this.nativeApi?.autocomplete && this.nativeSessionId != null) {
      try {
        const raw = this.nativeApi.autocomplete(this.nativeSessionId, safeInput, safeCursorPos, safeMaxResults);
        const parsed = this.parseJSON(raw);
        if (isRecord(parsed) && Array.isArray(parsed.options)) {
          const options = parsed.options
            .filter((option): option is string => typeof option === 'string' && option.length > 0)
            .slice(0, safeMaxResults);

          if (options.length > 0) {
            const start = typeof parsed.start === 'number' ? parsed.start : safeCursorPos;
            const end = typeof parsed.end === 'number' ? parsed.end : safeCursorPos;

            return {
              start: Math.max(0, Math.min(start, safeInput.length)),
              end: Math.max(0, Math.min(Math.max(end, start), safeInput.length)),
              endString: typeof parsed.endString === 'string' ? parsed.endString : '',
              options,
            };
          }
        }
      } catch {
        // Fall back to command-catalog completion below.
      }
    }

    return this.buildCommandAutocompleteFallback(safeInput, safeCursorPos, safeMaxResults);
  }

  getCommandCatalog(): Record<string, RizinCommandHelpEntry> {
    if (this.commandCatalogCache) {
      return this.commandCatalogCache;
    }

    let catalog = this.loadCommandCatalogFromNative();
    if (!catalog || Object.keys(catalog).length === 0) {
      catalog = this.loadCommandCatalogFromHelpSearch();
    }

    this.commandCatalogCache = catalog ?? {};
    return this.commandCatalogCache;
  }

  get allNotices(): RizinNotice[] {
    return [...this.notices];
  }

  // Synchronously-readable state pushed to the facade after each operation.
  snapshot(): RizinStateSnapshot {
    return {
      currentAddress: this.currentAddress,
      isOpen: this._isOpen,
      isAnalysisComplete: this.analysisCompleted,
      fileHash: this._fileHash,
      cacheHit: this._cacheHit,
      notices: [...this.notices],
      lastStderr: this.lastCommandStderr,
      fileName: this.file?.name ?? null,
      writeMode: this.writeMode,
      isDirty: this.dirty,
    };
  }

  // The facade only renders the six lists + info, so heavy per-function detail
  // is omitted here and fetched on demand through getFunctionDetails.
  snapshotAnalysis(): AnalysisData | null {
    if (!this.analysisData) return null;
    return {
      functions: this.analysisData.functions,
      strings: this.analysisData.strings,
      imports: this.analysisData.imports,
      exports: this.analysisData.exports,
      sections: this.analysisData.sections,
      info: this.analysisData.info,
      functionDetails: {},
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
    this.emit({ event: 'notice', notice: fullNotice });
  }

  private emitAnalysisChanged(): void {
    this.emit({ event: 'analysisChanged', analysis: this.snapshotAnalysis(), state: this.snapshot() });
  }

  private normalizeCommandCatalog(parsed: unknown): Record<string, RizinCommandHelpEntry> {
    const catalog: Record<string, RizinCommandHelpEntry> = {};

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!isRecord(entry)) continue;
        const name =
          typeof entry.name === 'string'
            ? entry.name
            : typeof entry.cmd === 'string'
              ? entry.cmd
              : '';
        if (!name) continue;

        catalog[name] = {
          name,
          summary: typeof entry.summary === 'string' ? entry.summary : undefined,
          description: typeof entry.description === 'string' ? entry.description : undefined,
          args:
            typeof entry.args === 'string'
              ? entry.args
              : typeof entry.args_str === 'string'
                ? entry.args_str
                : undefined,
        };
      }

      return catalog;
    }

    if (!isRecord(parsed)) {
      return catalog;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const name =
        typeof value.name === 'string'
          ? value.name
          : typeof value.cmd === 'string'
            ? value.cmd
            : key;
      if (!name) continue;

      catalog[name] = {
        name,
        summary: typeof value.summary === 'string' ? value.summary : undefined,
        description: typeof value.description === 'string' ? value.description : undefined,
        args:
          typeof value.args === 'string'
            ? value.args
            : typeof value.args_str === 'string'
              ? value.args_str
              : undefined,
      };
    }

    return catalog;
  }

  private loadCommandCatalogFromNative(): Record<string, RizinCommandHelpEntry> | null {
    if (!this.hasNativeSession() || !this.nativeApi?.getCommandCatalog || this.nativeSessionId == null) {
      return null;
    }

    try {
      const raw = this.nativeApi.getCommandCatalog(this.nativeSessionId);
      const parsed = this.parseJSON(raw);
      const catalog = this.normalizeCommandCatalog(parsed);
      return Object.keys(catalog).length > 0 ? catalog : null;
    } catch {
      return null;
    }
  }

  private loadCommandCatalogFromHelpSearch(): Record<string, RizinCommandHelpEntry> | null {
    if (!this._isOpen || !this.filePath) {
      return null;
    }

    const result = this.runSessionCommand('?*j', {
      context: 'metadata',
      commandLabel: 'Command catalog',
      maxOutputBytes: Math.max(this.runtimeConfig.maxOutputBytes, 4 * 1024 * 1024),
      suppressNotice: true,
    });
    if (result.truncated) {
      return null;
    }

    const parsed = this.parseJSON(result.output);
    const catalog = this.normalizeCommandCatalog(parsed);
    return Object.keys(catalog).length > 0 ? catalog : null;
  }

  private getCommandTokenBounds(input: string, cursorPos: number): CommandTokenBounds | null {
    if (!input) {
      return null;
    }

    let segmentStart = 0;
    for (let i = Math.max(0, cursorPos - 1); i >= 0; i--) {
      const char = input[i];
      if (char === ';' || char === '|' || char === '\n' || char === '\r') {
        segmentStart = i + 1;
        break;
      }
    }

    while (segmentStart < input.length && /\s/.test(input[segmentStart] ?? '')) {
      segmentStart++;
    }

    if (segmentStart >= input.length || cursorPos < segmentStart) {
      return null;
    }

    const left = input.slice(segmentStart, cursorPos);
    if (/\s/.test(left)) {
      return null;
    }

    let end = cursorPos;
    while (end < input.length) {
      const char = input[end];
      if (!char || /\s/.test(char) || char === ';' || char === '|' || char === '\n' || char === '\r') {
        break;
      }
      end++;
    }

    return {
      start: segmentStart,
      end,
      fragment: input.slice(segmentStart, cursorPos),
    };
  }

  private buildCommandAutocompleteFallback(
    input: string,
    cursorPos: number,
    maxResults: number
  ): RizinAutocompleteResult | null {
    const bounds = this.getCommandTokenBounds(input, cursorPos);
    if (!bounds || !bounds.fragment) {
      return null;
    }

    const catalog = this.getCommandCatalog();
    const commandNames = Object.keys(catalog);
    if (commandNames.length === 0) {
      return null;
    }

    const query = bounds.fragment.toLowerCase();
    const prefixMatches = commandNames
      .filter(name => name.toLowerCase().startsWith(query))
      .sort(compareAutocompleteValues);
    const substringMatches = commandNames
      .filter(name => !name.toLowerCase().startsWith(query) && name.toLowerCase().includes(query))
      .sort(compareAutocompleteValues);

    const options = [...prefixMatches, ...substringMatches].slice(0, maxResults);
    if (options.length === 0) {
      return null;
    }

    return {
      start: bounds.start,
      end: bounds.end,
      endString: ' ',
      options,
    };
  }

  private buildArgs(command: string, filePath: string): string[] {
    const args = [
      '-e', 'scr.color=3',
      '-e', 'scr.color.args=true',
      '-e', 'scr.color.bytes=true',
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
      // Rizin/Emscripten may throw after a command completes. The captured
      // buffers are the source of truth.
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
        console.error('[RizinSession:parseJSON] Sanitization failed:', err.message);
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
    this.schedulePersist();
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
        this.runFunctionDetailCommand(`s ${hexAddress};agf json`, 'Function graph').output
      );

      if (graph == null) {
        graph = this.parseJSON(
          this.runFunctionDetailCommand(`s ${hexAddress};agf json_disasm`, 'Function graph').output
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

  private cancelScheduledPersist(): void {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // Coalesce cache writes: a burst of commands triggers at most one persist per
  // throttle window instead of re-serializing the project after every command.
  private schedulePersist(): void {
    this.persistDirty = true;
    if (this.persistTimer != null) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (!this.persistDirty) return;
      this.persistDirty = false;
      void this.persistCurrentAnalysis();
    }, PERSIST_THROTTLE_MS);
  }

  private async persistCurrentAnalysis(): Promise<void> {
    if (!this.shouldPersistCache(false) || !this.file || !this.analysisData) {
      return;
    }

    const cacheIsBlocked = this.notices.some(notice => CACHE_BLOCKING_NOTICE_CODES.has(notice.code));
    if (cacheIsBlocked) return;

    // Snapshot before the first await: persistNativeProject() yields, and a
    // concurrent close() may null these out before the cache entry is built.
    const file = this.file;
    const analysisData = this.analysisData;
    const fileHash = this._fileHash;
    const analysisDepth = this.runtimeConfig.analysisDepth;

    const serialized = JSON.stringify(analysisData);
    const projectData = await this.persistNativeProject();
    const cacheEntry: CachedAnalysis = {
      hash: fileHash,
      fileName: file.name,
      fileSize: file.data.length,
      timestamp: Date.now(),
      analysisDepth,
      dataSize: serialized.length + (projectData?.byteLength ?? 0) + file.data.byteLength,
      complete: true,
      binaryData: file.data,
      projectData: projectData ?? undefined,
      data: analysisData,
    };
    await setCachedAnalysis(cacheEntry);
  }

  async open(file: RizinFile, config?: RizinInstanceConfig, restoreProjectData?: Uint8Array): Promise<void> {
    await this.close();
    this.file = file;
    this.stdoutBuffer = [];
    this.stderrBuffer = [];
    this.lastCommandStderr = '';
    this._isOpen = true;
    this.analysisCompleted = false;
    this._cacheHit = false;
    this.currentAddress = '0x00000000';
    this.notices = [];
    this.commandCatalogCache = null;
    this.writeMode = false;
    this.dirty = false;
    this.fileImage = new Uint8Array(file.data);
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

    // An explicit project payload (cold-loading a saved RzWeb project) takes
    // precedence over any cached analysis. Otherwise fall back to cached project
    // data so reopening a previously-analyzed binary restores instantly.
    const explicitRestore = !!restoreProjectData && restoreProjectData.byteLength > 0;
    const projectToRestore = explicitRestore ? restoreProjectData : cached?.projectData;

    if (this.ensureNativeSession() && this.restoreNativeProject(projectToRestore)) {
      this.analysisCompleted = true;
      this.refreshCurrentAddress();

      // A freshly cold-loaded project owns the truth: re-read analysis from the
      // restored core instead of trusting whatever cache happened to be present.
      if (explicitRestore || !hasUsableAnalysisData(this.analysisData)) {
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

    // Open r/w so hex and terminal edits persist and can be exported.
    const nativeSessionReady = this.startNativeFileSession(true);
    this.refreshCurrentAddress();

    if (file.data.length >= LARGE_BINARY_ALERT_BYTES) {
      this.emitNotice({
        severity: 'warning',
        code: 'large-binary',
        message: `Large binary (${formatBytes(file.data.length)}). Full analysis runs on open.`,
        detail: 'Analysis runs entirely in your browser via WebAssembly, so larger files may take longer to process.',
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

        // Capture stderr now, before the background refresh below runs more
        // commands, so the terminal surfaces only the user command's own errors.
        this.lastCommandStderr = this.stderrBuffer.join('\n');

        this.updateCurrentAddressFromCommand(finalCmd);
        // Terminal write commands also dirty the binary.
        if (this.writeMode && /(^|;)\s*w/i.test(originalCmd)) {
          this.dirty = true;
        }
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
          this.schedulePersist();
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
    return this.lastCommandStderr;
  }

  getCurrentAddress(): string {
    return this.currentAddress;
  }

  // Reads `size` bytes at `address` via a temporary `@` seek. Short reads at an
  // unmapped tail return fewer bytes, which callers pad with placeholders.
  readMemory(address: number, size: number): Uint8Array {
    const safeSize = Math.max(0, Math.min(Math.floor(size), 1 << 20));
    if (safeSize === 0 || !this._isOpen) {
      return new Uint8Array(0);
    }

    const addrHex = `0x${Math.max(0, Math.floor(address)).toString(16)}`;
    const result = this.runSessionCommand(`p8 ${safeSize} @ ${addrHex}`, {
      context: 'metadata',
      commandLabel: 'Read bytes',
      suppressNotice: true,
      maxOutputBytes: safeSize * 2 + 64,
    });

    return parseHexBytes(result.output);
  }

  private static toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value) {
      const n = value.startsWith('0x') || value.startsWith('0X') ? parseInt(value, 16) : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Normalizes varied xref JSON item shapes into one list.
  private normalizeXrefs(value: unknown, addrKeys: string[]): XrefEntry[] {
    if (!Array.isArray(value)) return [];
    const out: XrefEntry[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      let addr: number | null = null;
      for (const key of addrKeys) {
        addr = RizinSession.toNumber(rec[key]);
        if (addr != null) break;
      }
      if (addr == null) continue;
      const type = typeof rec.type === 'string' ? rec.type : '';
      const name = [rec.fcn_name, rec.refname, rec.name, rec.flag, rec.realname].find(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      const opcode = typeof rec.opcode === 'string' ? rec.opcode : undefined;
      out.push({ addr, type, name, opcode });
    }
    return out;
  }

  // Cross-references for the function/address: who points here (to) and where it points (from).
  getXrefs(address: number): XrefsResult {
    if (!this._isOpen) return { to: [], from: [] };
    const addr = `0x${Math.max(0, Math.floor(address)).toString(16)}`;

    const toRaw = this.runSessionCommand(`axtj @ ${addr}`, {
      context: 'metadata',
      commandLabel: 'Xrefs to',
      suppressNotice: true,
    });
    const to = this.normalizeXrefs(this.parseJSON(toRaw.output), ['from', 'at', 'addr']);

    const fromRaw = this.runSessionCommand(`axfj @ ${addr}`, {
      context: 'metadata',
      commandLabel: 'Xrefs from',
      suppressNotice: true,
    });
    const from = this.normalizeXrefs(this.parseJSON(fromRaw.output), ['ref', 'to', 'addr']);

    return { to, from };
  }

  // Renders the function at `address`. Uses a real decompiler plugin (pdg from
  // rz-ghidra, pdd from jsdec, or pdc) when the build ships one, else falls back
  // to Rizin's pseudo-disassembly so the view is never empty. The `pseudo` flag
  // lets the UI label fallback output.
  getDecompilation(address: number): { code: string; pseudo: boolean } {
    if (!this._isOpen) return { code: '', pseudo: false };
    const addr = `0x${Math.max(0, Math.floor(address)).toString(16)}`;

    const cmd = this.resolveDecompilerCommand();
    if (cmd) {
      const result = this.runSessionCommand(`${cmd} @ ${addr}`, {
        context: 'command',
        commandLabel: 'Decompile',
        suppressNotice: true,
      });
      const code = this.stripAnsi(result.output).trim();
      if (code) return { code, pseudo: false };
    }

    return { code: this.getPseudocode(addr), pseudo: true };
  }

  // The command catalog is authoritative, so this resolves to a real decompiler
  // the moment a build adds one. Cached: null = unresolved, '' = none shipped.
  private resolveDecompilerCommand(): string | null {
    if (this.decompilerCmd !== null) return this.decompilerCmd || null;
    const catalog = this.getCommandCatalog();
    this.decompilerCmd = ['pdg', 'pdd', 'pdc'].find(cmd => Boolean(catalog[cmd])) ?? '';
    return this.decompilerCmd || null;
  }

  // Rizin's pseudo-disassembly rendered as clean C-like statements (e.g.
  // `eax = 0`). The address, bytes, and jump-arrow columns are dropped so the
  // output reads like code rather than a disassembly listing. Every toggle is
  // set before and restored after the single command so nothing leaks into the
  // disassembly or graph views, which read their own JSON.
  private getPseudocode(addr: string): string {
    const setup = 'e asm.pseudo=true;e asm.offset=false;e asm.bytes=false;e asm.lines=false;e asm.xrefs=false;e asm.sub.names=true;e asm.sub.var=true';
    const restore = 'e asm.pseudo=false;e asm.offset=true;e asm.bytes=true;e asm.lines=true;e asm.xrefs=true';
    const result = this.runSessionCommand(`${setup};pdf @ ${addr};${restore}`, {
      context: 'command',
      commandLabel: 'Decompile',
      suppressNotice: true,
    });
    return this.stripAnsi(result.output).trim();
  }

  async close(): Promise<void> {
    this.cancelScheduledPersist();
    if (this._isOpen) {
      // Flush any throttled persist while the native session is still alive so
      // saveProject() runs before the session is torn down.
      if (this.persistDirty) {
        this.persistDirty = false;
        try {
          await this.persistCurrentAnalysis();
        } catch {
          // A failed final persist must not block teardown.
        }
      }

      if (this.nativeApi && this.nativeSessionId != null) {
        try {
          this.nativeApi.closeSession(this.nativeSessionId);
        } catch {
          // Ignore native session teardown failures during cleanup.
        }
      }

      this._isOpen = false;
      this.writeMode = false;
      this.dirty = false;
      this.fileImage = null;
      this.stdoutBuffer = [];
      this.stderrBuffer = [];
      this.lastCommandStderr = '';
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
      this.decompilerCmd = null;
    }
  }
}
