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

  private parseJSON(text: string): unknown[] | unknown | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    
    const jsonMatch = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // JSON parse failed
      }
    }
    
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
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

      const AUTO_ANALYZE_THRESHOLD = 1024 * 1024;
      const shouldAutoAnalyze = file.data.length < AUTO_ANALYZE_THRESHOLD;
      
      if (shouldAutoAnalyze) {
        const depth = config?.analysisDepth || 1;
        const analysisCmd = depth >= 3 ? 'aaaa' : (depth >= 2 ? 'aaa' : 'aa');
        await this.yield();
        const analysisOutput = this.runCommand(`${analysisCmd};aflj`, this.filePath);
        
        const functions = this.parseJSON(analysisOutput);
        if (Array.isArray(functions)) {
          this.analysisData.functions = functions;
        }
      } else {
        const quickOutput = this.runCommand('aflj', this.filePath);
        const functions = this.parseJSON(quickOutput);
        if (Array.isArray(functions)) {
          this.analysisData.functions = functions;
        }
      }

      await this.yield();
      const stringsOutput = this.runCommand('izzj', this.filePath);
      const strings = this.parseJSON(stringsOutput);
      if (Array.isArray(strings)) {
        this.analysisData.strings = strings;
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

  /**
   * @brief Check if command needs analysis prefix
   * @details Scans all semicolon-separated parts for analysis commands
   */
  private needsAnalysis(cmd: string): boolean {
    const analysisCommands = ['pdf', 'afl', 'afn', 'agf', 'agc', 'VV', 'ax', 'af', 'pd '];
    const parts = cmd.trim().split(';').map(p => p.trim());
    
    return parts.some(part => {
      if (part.startsWith('s ') || part === 's' || part.startsWith('s;')) {
        return false;
      }
      return analysisCommands.some(ac => part.startsWith(ac));
    });
  }

  async executeCommand(command: string): Promise<string> {
    if (!this._isOpen || !this.file) {
      return 'Error: No file loaded';
    }

    let finalCmd = command;
    if (this.needsAnalysis(command) && !command.includes('aa')) {
      finalCmd = `aa;${command}`;
    }

    return this.runCommand(finalCmd, this.filePath);
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
    return this.executeCommand(`aa;s ${address};pdfj`);
  }

  async getGraph(address: number): Promise<unknown> {
    const output = await this.executeCommand(`aa;s ${address};agfj`);
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
