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
}

export interface AnalysisData {
  functions: unknown[];
  strings: unknown[];
  imports: unknown[];
  exports: unknown[];
  sections: unknown[];
  info: unknown;
}

interface CommandQueueItem {
  command: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const BATCH_DELIMITER = '@@RZWEB_DELIM@@';

export class RizinInstance {
  private module: RizinModule;
  private file: RizinFile | null = null;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private outputCallbacks: ((text: string) => void)[] = [];
  private errorCallbacks: ((text: string) => void)[] = [];
  private _isOpen = false;
  private workDir = '/work';
  private analysisData: AnalysisData | null = null;
  private filePath: string = '';
  private analysisCompleted = false;
  private _fileHash: string = '';
  private _cacheHit = false;
  private commandQueue: CommandQueueItem[] = [];
  private processing = false;

  private yield(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  constructor(module: RizinModule) {
    this.module = module;
    
    this.module._printHandler = (text: string) => {
      const cleaned = this.cleanText(text);
      this.stdoutBuffer.push(cleaned);
      this.outputCallbacks.forEach(cb => cb(cleaned + '\n'));
    };
    
    this.module._printErrHandler = (text: string) => {
      const cleaned = this.cleanText(text);
      this.stderrBuffer.push(cleaned);
      this.errorCallbacks.forEach(cb => cb(cleaned + '\n'));
    };
  }

  private cleanText(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\[2K/g, '')
      .replace(/[\u2500-\u257F]/g, '-')
      .replace(/￢ﾀﾕ/g, '-')
      .replace(/￢ﾔﾂ/g, '|')
      .replace(/￢ﾔﾌ/g, '+')
      .replace(/￢ﾔﾔ/g, '+')
      .replace(/[^\x00-\x7F\n\r\t ]/g, '');
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

  private buildArgs(command: string, filePath: string): string[] {
    return [
      '-e', 'scr.color=0',
      '-e', 'scr.interactive=false',
      '-e', 'scr.prompt=false',
      '-e', 'scr.utf8=false',
      '-e', 'scr.utf8.curvy=false',
      '-e', 'log.level=0',
      '-e', 'scr.pager=',
      '-q',
      '-c', command,
      filePath,
    ];
  }

  private runCommand(command: string, filePath: string): string {
    this.stdoutBuffer = [];
    this.stderrBuffer = [];

    const args = this.buildArgs(command, filePath);

    try {
      this.module.callMain(args);
    } catch {
    }

    const output = this.stdoutBuffer.join('\n');
    if (output.length > MAX_OUTPUT_BYTES) {
      return output.substring(0, MAX_OUTPUT_BYTES) + '\n[output truncated at 16MB]';
    }
    return output;
  }

  private runBatchCommands(commands: string[], filePath: string): string[] {
    const batchCmd = commands
      .map((cmd, i) => i < commands.length - 1 ? `${cmd};echo ${BATCH_DELIMITER}` : cmd)
      .join(';');
    
    const rawOutput = this.runCommand(batchCmd, filePath);
    return rawOutput.split(BATCH_DELIMITER).map(s => s.trim());
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
            result += '\\u00' + hex;
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
          result += '\\u' + val.toString(16).padStart(4, '0');
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
      
      if (inString && code <= 0x1F) {
        result += '\\u' + code.toString(16).padStart(4, '0');
        i++;
        continue;
      }
      
      if (inString && code > 0x7F && code < 0xA0) {
        result += '\\u' + code.toString(16).padStart(4, '0');
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
              const sanitized = this.sanitizeJSON(jsonStr);
              return JSON.parse(sanitized);
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
          if ((lineTrim.startsWith('[') && lineTrim.endsWith(']')) ||
              (lineTrim.startsWith('{') && lineTrim.endsWith('}'))) {
            try {
              return JSON.parse(lineTrim);
            } catch {
            }
          }
        }
      }
    }
    
    return null;
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
    
    this.analysisData = {
      functions: [],
      strings: [],
      imports: [],
      exports: [],
      sections: [],
      info: null,
    };

    try {
      this._fileHash = await computeFileHash(file.data);

      const depth = config?.analysisDepth || 2;
      const cached = await getCachedAnalysis(this._fileHash, depth);

      if (cached) {
        this.analysisData = { ...cached.data };
        this.analysisCompleted = true;
        this._cacheHit = true;

        const fs = this.module.FS;
        try { fs.mkdir(this.workDir); } catch { }
        fs.writeFile(this.filePath, file.data);
        return;
      }

      const fs = this.module.FS;
      try { fs.mkdir(this.workDir); } catch { }
      fs.writeFile(this.filePath, file.data);

      const AUTO_ANALYZE_THRESHOLD = 1024 * 1024;
      const isLargeFile = file.data.length >= AUTO_ANALYZE_THRESHOLD;
      
      await this.yield();

      const analysisCmd = isLargeFile
        ? 'aF'
        : (() => {
            return depth >= 3 ? 'aaaa' : (depth >= 2 ? 'aaa' : 'aa');
          })();

      const ioCacheFlag = config?.ioCache !== undefined ? `e io.cache=${config.ioCache};` : '';

      const commands = [
        `${ioCacheFlag}${analysisCmd};aflj`,
        'izzj',
        'iij',
        'iEj',
        'iSj',
        'ij',
      ];

      const results = this.runBatchCommands(commands, this.filePath);

      await this.yield();

      if (results[0]) {
        const functions = this.parseJSON(results[0]);
        if (Array.isArray(functions)) this.analysisData.functions = functions;
      }
      if (results[1]) {
        const strings = this.parseJSON(results[1]);
        if (Array.isArray(strings)) this.analysisData.strings = strings;
      }
      if (results[2]) {
        const imports = this.parseJSON(results[2]);
        if (Array.isArray(imports)) this.analysisData.imports = imports;
      }
      if (results[3]) {
        const exports = this.parseJSON(results[3]);
        if (Array.isArray(exports)) this.analysisData.exports = exports;
      }
      if (results[4]) {
        const sections = this.parseJSON(results[4]);
        if (Array.isArray(sections)) this.analysisData.sections = sections;
      }
      if (results[5]) {
        const info = this.parseJSON(results[5]);
        if (info) this.analysisData.info = info;
      }

      this.analysisCompleted = true;

      const serialized = JSON.stringify(this.analysisData);
      const cacheEntry: CachedAnalysis = {
        hash: this._fileHash,
        fileName: file.name,
        fileSize: file.data.length,
        timestamp: Date.now(),
        analysisDepth: depth,
        dataSize: serialized.length,
        data: this.analysisData,
      };
      setCachedAnalysis(cacheEntry);
    } catch (e) {
      throw e;
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
        let finalCmd = item.command;
        if (!this.analysisCompleted && this.needsAnalysisPrefix(item.command)) {
          finalCmd = `aa;${item.command}`;
        }
        const result = this.runCommand(finalCmd, this.filePath);
        item.resolve(result);
      } catch (e) {
        item.reject(e instanceof Error ? e : new Error(String(e)));
      }
      await this.yield();
    }

    this.processing = false;
  }

  private needsAnalysisPrefix(cmd: string): boolean {
    const analysisCommands = ['pdf', 'afl', 'afn', 'agf', 'agc', 'VV', 'ax', 'af', 'pd '];
    const parts = cmd.trim().split(';').map(p => p.trim());
    
    return parts.some(part => {
      if (part.startsWith('s ') || part === 's' || part.startsWith('s;')) {
        return false;
      }
      if (part.startsWith('aa') || part.startsWith('aF')) {
        return false;
      }
      return analysisCommands.some(ac => part.startsWith(ac));
    });
  }

  getLastStderr(): string {
    return this.stderrBuffer.join('\n');
  }

  getCurrentAddress(): string {
    const seekOutput = this.runCommand('s', this.filePath);
    const match = seekOutput.trim().match(/^(0x[0-9a-fA-F]+)/);
    return match ? match[1] : '0x00000000';
  }

  async getDisassembly(address: number): Promise<string> {
    return this.executeCommand(`s ${address};pdfj`);
  }

  async getGraph(address: number): Promise<unknown> {
    const output = await this.executeCommand(`s ${address};agfj`);
    return this.parseJSON(output);
  }

  async getHexDump(address: number, length: number = 256): Promise<string> {
    return this.executeCommand(`s ${address};pxj ${length}`);
  }

  sendInput(input: string): void {
    const command = input.replace(/[\r\n]+$/, '');
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

      if (this.filePath && this.module?.FS) {
        try { this.module.FS.unlink(this.filePath); } catch { }
      }

      this.file = null;
      this.analysisData = null;
      this.filePath = '';
      this.analysisCompleted = false;
      this._fileHash = '';
      this._cacheHit = false;
    }
  }
}
