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
  private runtimeConfig: RuntimeConfig = {
    ioCache: true,
    analysisDepth: 2,
    extraArgs: [],
    noAnalysis: false,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };

  private yield(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  constructor(module: RizinModule) {
    this.module = module;

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

  private parseJSON(text: string): unknown[] | unknown | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    if (/^(true|false|null)$/i.test(trimmed)) {
      return JSON.parse(trimmed.toLowerCase());
    }

    const arrayStart = trimmed.indexOf('[');
    if (arrayStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = arrayStart; i < trimmed.length; i++) {
        const char = trimmed[i];
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

        if (char === '[') depth++;
        if (char === ']') depth--;

        if (depth === 0) {
          const jsonStr = trimmed.substring(arrayStart, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            try {
              return JSON.parse(this.sanitizeJSON(jsonStr));
            } catch (e: unknown) {
              const err = e as Error;
              console.error('[RizinInstance:parseJSON] Sanitization failed:', err.message);
            }
          }
          break;
        }
      }
    }

    const objStart = trimmed.indexOf('{');
    if (objStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = objStart; i < trimmed.length; i++) {
        const char = trimmed[i];
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

        if (char === '{') depth++;
        if (char === '}') depth--;

        if (depth === 0) {
          const jsonStr = trimmed.substring(objStart, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            try {
              return JSON.parse(this.sanitizeJSON(jsonStr));
            } catch {
              // Fall through to the remaining parsers below.
            }
          }
          break;
        }
      }
    }

    const jsonMatch = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        const lines = trimmed.split('\n');
        for (const line of lines) {
          const lineTrim = line.trim();
          if (
            (lineTrim.startsWith('[') && lineTrim.endsWith(']')) ||
            (lineTrim.startsWith('{') && lineTrim.endsWith('}'))
          ) {
            try {
              return JSON.parse(lineTrim);
            } catch {
              // Keep scanning for a parseable JSON line.
            }
          }
        }
      }
    }

    return null;
  }

  private parseJSONSequence(text: string): unknown[] {
    const values: unknown[] = [];
    const trimmed = text.trim();
    if (!trimmed) return values;

    let index = 0;

    while (index < trimmed.length) {
      while (index < trimmed.length && trimmed[index] !== '{' && trimmed[index] !== '[') {
        index++;
      }

      if (index >= trimmed.length) {
        break;
      }

      const opener = trimmed[index];
      const closer = opener === '{' ? '}' : ']';
      const start = index;
      let depth = 0;
      let inString = false;
      let escape = false;

      for (; index < trimmed.length; index++) {
        const char = trimmed[index];
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
          const parsed = this.parseJSON(trimmed.slice(start, index + 1));
          if (parsed !== null) {
            values.push(parsed);
          }
          index++;
          break;
        }
      }
    }

    return values;
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
      const result = this.runCommand(command, this.filePath, {
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
    return this.analysisData.functionDetails[this.getFunctionDetailKey(address)] ?? null;
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
    if (cached?.disasm && cached?.graph) {
      return cached;
    }

    const pending = this.pendingFunctionDetailLoads.get(hexAddress);
    if (pending) {
      return pending;
    }

    const loadPromise = (async () => {
      const output = await this.executeCommand(
        `pdfj @ ${hexAddress};s ${hexAddress};agf json`
      );

      const parsedValues = this.parseJSONSequence(output);
      const disasm = parsedValues[0] ?? null;
      const graph = parsedValues[1] ?? null;

      const detail = await this.persistFunctionDetail(address, {
        disasm: disasm ?? cached?.disasm,
        graph: graph ?? cached?.graph,
      });

      return detail ?? {
        disasm: disasm ?? undefined,
        graph: graph ?? undefined,
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
    if (!this.filePath) return;

    const result = this.runCommand('s', this.filePath, {
      context: 'metadata',
      commandLabel: 'Current seek',
      suppressNotice: true,
      maxOutputBytes: 1024,
    });
    const match = result.output.trim().match(/^(0x[0-9a-fA-F]+)/);
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
      const result = this.loadArrayIntoAnalysis(
        'functions',
        [`${this.getConfiguredAnalysisCommand()};aflj`],
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
    const cacheEntry: CachedAnalysis = {
      hash: this._fileHash,
      fileName: this.file.name,
      fileSize: this.file.data.length,
      timestamp: Date.now(),
      analysisDepth: this.runtimeConfig.analysisDepth,
      dataSize: serialized.length,
      complete: true,
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
    this.filePath = `${this.workDir}/${file.name}`;
    this.currentAddress = '0x00000000';
    this.notices = [];
    this.runtimeConfig = {
      ioCache: config?.ioCache ?? true,
      analysisDepth: config?.analysisDepth ?? 2,
      extraArgs: config?.extraArgs ?? [],
      noAnalysis: config?.noAnalysis ?? false,
      maxOutputBytes: config?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
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

    const cached = await getCachedAnalysis(this._fileHash, this.runtimeConfig.analysisDepth);
    if (cached) {
      this.analysisData = {
        ...cached.data,
        functionDetails: cached.data.functionDetails ?? {},
      };
      this.analysisCompleted = true;
      this._cacheHit = true;

      const cachedFs = this.module.FS;
      try {
        cachedFs.mkdir(this.workDir);
      } catch {
        // The working directory already exists in the in-memory FS.
      }
      cachedFs.writeFile(this.filePath, file.data);
      this.refreshCurrentAddress();
      this.emitAnalysisChanged();
      return;
    }

    const fs = this.module.FS;
    try {
      fs.mkdir(this.workDir);
    } catch {
      // The working directory already exists in the in-memory FS.
    }
    fs.writeFile(this.filePath, file.data);
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

    if (!this.runtimeConfig.noAnalysis) {
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
      refreshFunctions: false,
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

        const prefixedAnalysis = this.needsAnalysisPrefix(finalCmd);
        if (prefixedAnalysis) {
          finalCmd = `${this.getConfiguredAnalysisCommand()};${finalCmd}`;
        }

        const result = this.runCommand(finalCmd, this.filePath, {
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
        if (refreshPlan.markAnalysisComplete && !refreshResult.truncated) {
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

      this.file = null;
      this.analysisData = null;
      this.filePath = '';
      this.analysisCompleted = false;
      this._fileHash = '';
      this._cacheHit = false;
      this.notices = [];
      this.currentAddress = '0x00000000';
    }
  }
}
