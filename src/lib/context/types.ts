export type ContextJobStatus = 'idle' | 'analyzing' | 'failed';

export type RevisionReason = 'open' | 'analysis' | 'edits' | 'manual' | 'park';

export type DecompilerEngine = 'pdg' | 'pdd' | 'pdc' | 'pseudo' | '';

export interface AnalysisJob {
  id: string;
  contextId: string;
  phase: string;
  progress: number;
  message: string;
  status: ContextJobStatus;
}

export interface RzwebContext {
  id: string;
  name: string;
  artifactHash: string;
  fileSize: number;
  currentRevisionId: string | null;
  job: ContextJobStatus;
  analysisDepth: number;
  createdAt: number;
  updatedAt: number;
}

export interface ContextRevision {
  id: string;
  contextId: string;
  parentId: string | null;
  reason: RevisionReason;
  createdAt: number;
  rzdb: Uint8Array;
}

export interface StoredArtifact {
  hash: string;
  data: Uint8Array;
  fileName: string;
  fileSize: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface FunctionSummary {
  addr: number;
  name: string;
  size: number;
  nbb: number;
}

export interface FunctionBriefing {
  summary: FunctionSummary;
  prototype?: string;
  vars?: unknown;
  xrefs: {
    to: Array<{ addr: number; type: string; name?: string }>;
    from: Array<{ addr: number; type: string; name?: string }>;
  };
  strings: Array<{ addr: number; string: string }>;
  decompile?: { code: string; engine: DecompilerEngine };
}

export interface StructuredError {
  code: string;
  message: string;
  detail?: string;
}

export interface ListQuery {
  offset?: number;
  limit?: number;
  query?: string;
  contains?: string;
}
