import type { RizinModule } from './RizinLoader';

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

/**
 * @class RizinInstance
 * @brief Wrapper for Rizin WASM module operations
 */
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

  private runCommand(command: string, filePath: string): string {
    this.stdoutBuffer = [];
    this.stderrBuffer = [];
    
    const args = [
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

    try {
      this.module.callMain(args);
    } catch {
      // Command execution failed
    }

    return this.stdoutBuffer.join('\n');
  }

  private sanitizeJSON(jsonStr: string): string {
    // Comprehensive JSON sanitization for rizin output
    // Handles: control chars, invalid escapes (\x, \0, etc), high bytes
    let result = '';
    let inString = false;
    let i = 0;
    
    while (i < jsonStr.length) {
      const char = jsonStr[i];
      const code = jsonStr.charCodeAt(i);
      
      // Handle escape sequences in strings
      if (inString && char === '\\' && i + 1 < jsonStr.length) {
        const nextChar = jsonStr[i + 1];
        
        // Valid JSON escapes: " \ / b f n r t and uXXXX
        if ('"\\\/bfnrt'.includes(nextChar)) {
          result += char + nextChar;
          i += 2;
          continue;
        }
        
        // Handle \uXXXX
        if (nextChar === 'u' && i + 5 < jsonStr.length) {
          const hex = jsonStr.substring(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result += jsonStr.substring(i, i + 6);
            i += 6;
            continue;
          }
        }
        
        // Handle \xXX (not valid JSON, convert to \u00XX)
        if (nextChar === 'x' && i + 3 < jsonStr.length) {
          const hex = jsonStr.substring(i + 2, i + 4);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            result += '\\u00' + hex;
            i += 4;
            continue;
          }
        }
        
        // Handle \0, \1, etc (octal - not valid JSON)
        if (nextChar >= '0' && nextChar <= '7') {
          // Convert to \u00XX
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
        
        // Any other invalid escape - just escape the backslash itself
        result += '\\\\';
        i++;
        continue;
      }
      
      // Toggle string state on unescaped quotes
      if (char === '"') {
        inString = !inString;
        result += char;
        i++;
        continue;
      }
      
      // In strings: escape control characters
      if (inString && code <= 0x1F) {
        result += '\\u' + code.toString(16).padStart(4, '0');
        i++;
        continue;
      }
      
      // In strings: escape high-byte characters that might cause issues
      if (inString && code > 0x7F && code < 0xA0) {
        result += '\\u' + code.toString(16).padStart(4, '0');
        i++;
        continue;
      }
      
      // OUTSIDE strings: remove newlines/carriage returns that break JSON structure
      // (These come from stdoutBuffer.join('\n') splitting up values)
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
    
    // Try to find JSON array starting with [
    const arrayStart = trimmed.indexOf('[');
    if (arrayStart !== -1) {
      // Find matching closing bracket
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
            // First try direct parse
            const parsed = JSON.parse(jsonStr);
            console.log('[RizinInstance:parseJSON] Parsed array with', Array.isArray(parsed) ? parsed.length : 0, 'items');
            return parsed;
          } catch (directErr) {
            // Try with sanitization for control characters
            try {
              const sanitized = this.sanitizeJSON(jsonStr);
              const parsed = JSON.parse(sanitized);
              console.log('[RizinInstance:parseJSON] Parsed sanitized array with', Array.isArray(parsed) ? parsed.length : 0, 'items');
              return parsed;
            } catch (e: unknown) {
              const err = e as Error;
              console.log('[RizinInstance:parseJSON] Failed to parse even after sanitization:', err.message);
              
              // Extract position from error message
              const posMatch = err.message.match(/position (\d+)/);
              if (posMatch) {
                const pos = parseInt(posMatch[1]);
                const sanitized = this.sanitizeJSON(jsonStr);
                const start = Math.max(0, pos - 100);
                const end = Math.min(sanitized.length, pos + 100);
                const context = sanitized.substring(start, end);
                
                console.log(`[RizinInstance:parseJSON] Error at position ${pos}:`);
                console.log(`[RizinInstance:parseJSON] Context (${start}-${end}):`);
                console.log(context);
                
                // Show hex codes around error
                const hexStart = Math.max(0, pos - 20);
                const hexEnd = Math.min(sanitized.length, pos + 20);
                const hexChars = [];
                for (let h = hexStart; h < hexEnd; h++) {
                  const code = sanitized.charCodeAt(h);
                  hexChars.push(`${h === pos ? '>>>' : ''}${code.toString(16).padStart(2, '0')}${h === pos ? '<<<' : ''}`);
                }
                console.log('[RizinInstance:parseJSON] Hex around error:', hexChars.join(' '));
                
                // Show the actual character at error position
                console.log(`[RizinInstance:parseJSON] Char at ${pos}: "${sanitized[pos]}" (0x${sanitized.charCodeAt(pos).toString(16)})`);
              }
              
              // Log first 500 chars to see structure
              console.log('[RizinInstance:parseJSON] First 500 chars of sanitized JSON:');
              console.log(jsonStr.substring(0, 500));
            }
          }
          break;
        }
      }
    }
    
    // Try object extraction
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
            // Continue trying
          }
          break;
        }
      }
    }
    
    // Fallback: simple regex match
    const jsonMatch = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Try parsing each line for a clean JSON line
        const lines = trimmed.split('\n');
        for (const line of lines) {
          const lineTrim = line.trim();
          if ((lineTrim.startsWith('[') && lineTrim.endsWith(']')) ||
              (lineTrim.startsWith('{') && lineTrim.endsWith('}'))) {
            try {
              return JSON.parse(lineTrim);
            } catch {
              // Continue
            }
          }
        }
      }
    }
    
    console.log('[RizinInstance:parseJSON] Failed to extract JSON from:', trimmed.substring(0, 200));
    return null;
  }

  /**
   * @brief Open a binary file for analysis
   * @param file Binary file data
   * @param config Optional configuration (ioCache, analysisDepth)
   */
  async open(file: RizinFile, config?: RizinInstanceConfig): Promise<void> {
    this.close();
    this.file = file;
    this.stdoutBuffer = [];
    this.stderrBuffer = [];
    this._isOpen = true;
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
      const fs = this.module.FS;
      try {
        fs.mkdir(this.workDir);
      } catch {
        // Directory exists
      }

      fs.writeFile(this.filePath, file.data);

      if (config?.ioCache !== undefined) {
        this.runCommand(`e io.cache=${config.ioCache}`, this.filePath);
      }

      // Always run analysis to populate functions
      // Use lighter analysis for large files to avoid UI freezing
      const AUTO_ANALYZE_THRESHOLD = 1024 * 1024;
      const isLargeFile = file.data.length >= AUTO_ANALYZE_THRESHOLD;
      
      await this.yield();
      
      if (isLargeFile) {
        console.log('[RizinInstance:open] Large file mode - using aF;aflj');
        const analysisOutput = this.runCommand('aF;aflj', this.filePath);
        console.log('[RizinInstance:open] aflj output length:', analysisOutput.length);
        const functions = this.parseJSON(analysisOutput);
        if (Array.isArray(functions)) {
          this.analysisData.functions = functions;
          console.log('[RizinInstance:open] Found', functions.length, 'functions');
        } else {
          console.log('[RizinInstance:open] No functions parsed');
        }
      } else {
        const depth = config?.analysisDepth || 1;
        const analysisCmd = depth >= 3 ? 'aaaa' : (depth >= 2 ? 'aaa' : 'aa');
        console.log('[RizinInstance:open] Small file mode - using', analysisCmd);
        const analysisOutput = this.runCommand(`${analysisCmd};aflj`, this.filePath);
        console.log('[RizinInstance:open] aflj output length:', analysisOutput.length);
        const functions = this.parseJSON(analysisOutput);
        if (Array.isArray(functions)) {
          this.analysisData.functions = functions;
          console.log('[RizinInstance:open] Found', functions.length, 'functions');
        } else {
          console.log('[RizinInstance:open] No functions parsed');
        }
      }

      await this.yield();
      console.log('[RizinInstance:open] Running izzj for strings');
      const stringsOutput = this.runCommand('izzj', this.filePath);
      console.log('[RizinInstance:open] izzj output length:', stringsOutput.length);
      const strings = this.parseJSON(stringsOutput);
      if (Array.isArray(strings)) {
        this.analysisData.strings = strings;
        console.log('[RizinInstance:open] Found', strings.length, 'strings');
      } else {
        console.log('[RizinInstance:open] No strings parsed');
      }

      await this.yield();
      const importsOutput = this.runCommand('iij', this.filePath);
      const imports = this.parseJSON(importsOutput);
      if (Array.isArray(imports)) {
        this.analysisData.imports = imports;
      }

      await this.yield();
      const sectionsOutput = this.runCommand('iSj', this.filePath);
      const sections = this.parseJSON(sectionsOutput);
      if (Array.isArray(sections)) {
        this.analysisData.sections = sections;
      }
    } catch (e) {
      throw e;
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this._isOpen || !this.file) {
      return 'Error: No file loaded';
    }

    // Analysis done once on file open, just run the command directly
    return this.runCommand(command, this.filePath);
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
    // Analysis already done on file open, just seek and disassemble
    return this.executeCommand(`s ${address};pdfj`);
  }

  async getGraph(address: number): Promise<unknown> {
    // Analysis already done on file open, just seek and get graph
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
      this.file = null;
      this.analysisData = null;
      this.filePath = '';
    }
  }
}
