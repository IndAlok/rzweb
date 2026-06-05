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

export interface FunctionDetailCacheEntry {
  disasm?: unknown;
  graph?: unknown;
  updatedAt: number;
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

export interface RizinNotice {
  id: string;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  detail?: string;
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

export interface XrefEntry {
  addr: number;
  type: string;
  name?: string;
  opcode?: string;
}

export interface XrefsResult {
  to: XrefEntry[];
  from: XrefEntry[];
}

export type RizinLoadPhase =
  | 'initializing'
  | 'downloading'
  | 'processing'
  | 'ready'
  | 'error';

export interface RizinStateSnapshot {
  currentAddress: string;
  isOpen: boolean;
  isAnalysisComplete: boolean;
  fileHash: string;
  cacheHit: boolean;
  notices: RizinNotice[];
  lastStderr: string;
  fileName: string | null;
}

export type RizinRequest =
  | { id: number; method: 'open'; file: RizinFile; config?: RizinInstanceConfig; restoreProjectData?: Uint8Array }
  | { id: number; method: 'executeCommand'; command: string }
  | { id: number; method: 'getFunctionDetails'; address: number }
  | { id: number; method: 'getAutocomplete'; input: string; cursorPos: number; maxResults: number }
  | { id: number; method: 'readMemory'; address: number; size: number }
  | { id: number; method: 'getXrefs'; address: number }
  | { id: number; method: 'getDecompilation'; address: number }
  | { id: number; method: 'exportProject' }
  | { id: number; method: 'importProject'; data: Uint8Array }
  | { id: number; method: 'close' };

export type RizinMethod = RizinRequest['method'];

export interface RizinResultMap {
  open: {
    analysis: AnalysisData | null;
    commandCatalog: Record<string, RizinCommandHelpEntry>;
  };
  executeCommand: { output: string };
  getFunctionDetails: { detail: FunctionDetailCacheEntry };
  getAutocomplete: { result: RizinAutocompleteResult | null };
  readMemory: { bytes: Uint8Array };
  getXrefs: { xrefs: XrefsResult };
  getDecompilation: { code: string; pseudo: boolean };
  exportProject: { data: Uint8Array };
  importProject: {
    analysis: AnalysisData | null;
    commandCatalog: Record<string, RizinCommandHelpEntry>;
  };
  close: Record<string, never>;
}

export type RizinResult = RizinResultMap[RizinMethod];

export type RizinResponse =
  | { id: number; ok: true; result: RizinResult; state: RizinStateSnapshot }
  | { id: number; ok: false; error: string };

export type RizinWorkerEvent =
  | { event: 'ready' }
  | { event: 'progress'; phase: RizinLoadPhase; progress: number; message: string }
  | { event: 'notice'; notice: RizinNotice }
  | { event: 'analysisChanged'; analysis: AnalysisData | null; state: RizinStateSnapshot };

export type RizinControl = { control: 'init' };

export type RizinInbound = RizinRequest | RizinControl;
export type RizinOutbound = RizinResponse | RizinWorkerEvent;
