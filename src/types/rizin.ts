export interface RzBinInfo {
  arch: string;
  baddr: number;
  binsz: number;
  bintype: string;
  bits: number;
  canary: boolean;
  class: string;
  compiled: string;
  compiler: string;
  crypto: boolean;
  dbg_file: string;
  endian: string;
  havecode: boolean;
  guid: string;
  intrp: string;
  laddr: number;
  lang: string;
  linenum: boolean;
  lsyms: boolean;
  machine: string;
  maxopsz: number;
  minopsz: number;
  nx: boolean;
  os: string;
  overlay: boolean;
  pic: boolean;
  relocs: boolean;
  rpath: string;
  sanitiz: boolean;
  static: boolean;
  stripped: boolean;
  subsys: string;
  va: boolean;
  checksums: Record<string, string>;
}

export interface RzFunction {
  offset: number;
  name: string;
  size: number;
  is_pure: string;
  realsz: number;
  noreturn: boolean;
  stackframe: number;
  calltype: string;
  cost: number;
  cc: number;
  bits: number;
  type: string;
  nbbs: number;
  edges: number;
  ebbs: number;
  signature: string;
  minbound: number;
  maxbound: number;
  callrefs: RzCallRef[];
  datarefs: number[];
  codexrefs: RzCodeXref[];
  dataxrefs: number[];
  indegree: number;
  outdegree: number;
  nlocals: number;
  nargs: number;
  bpvars: RzVariable[];
  spvars: RzVariable[];
  regvars: RzVariable[];
  difftype: string;
}

export interface RzCallRef {
  addr: number;
  type: string;
  at: number;
}

export interface RzCodeXref {
  addr: number;
  type: string;
  at: number;
}

export interface RzVariable {
  name: string;
  kind: string;
  type: string;
  ref: { base: string; offset: number };
}

export interface RzSection {
  name: string;
  size: number;
  vsize: number;
  paddr: number;
  vaddr: number;
  perm: string;
  type: string;
  flags: string[];
}

export interface RzString {
  vaddr: number;
  paddr: number;
  ordinal: number;
  size: number;
  length: number;
  section: string;
  type: string;
  string: string;
}

export interface RzImport {
  ordinal: number;
  bind: string;
  type: string;
  name: string;
  libname: string;
  plt: number;
}

export interface RzExport {
  name: string;
  demname: string;
  flagname: string;
  ordinal: number;
  bind: string;
  size: number;
  type: string;
  vaddr: number;
  paddr: number;
  is_imported: boolean;
}

export interface RzSymbol {
  name: string;
  demname: string;
  flagname: string;
  ordinal: number;
  bind: string;
  size: number;
  type: string;
  vaddr: number;
  paddr: number;
  is_imported: boolean;
}

export interface RzXref {
  from: number;
  to: number;
  type: string;
  opcode?: string;
  fcn_addr?: number;
  fcn_name?: string;
  refname?: string;
}

export interface RzReference {
  addr: number;
  type: string;
}

export interface RzDisasmLine {
  offset: number;
  size: number;
  opcode: string;
  disasm: string;
  bytes: string;
  family: string;
  type: string;
  type_num: number;
  type2_num: number;
  jump?: number;
  fail?: number;
  refs?: { addr: number; type: string }[];
  xrefs?: { addr: number; type: string }[];
  comment?: string;
  esil?: string;
  sign?: boolean;
  prefix?: number;
  id?: number;
  ptr?: number;
  val?: number;
  stackptr?: number;
  refptr?: number;
}

export interface RzBasicBlock {
  addr: number;
  size: number;
  jump: number;
  fail: number;
  opaddr: number;
  inputs: number;
  outputs: number;
  ninstr: number;
  instrs: number[];
  traced: boolean;
  folded: boolean;
  colorize: number;
  label?: string;
  switch_op?: RzSwitchOp;
}

export interface RzSwitchOp {
  addr: number;
  min_val: number;
  max_val: number;
  def_val: number;
  cases: { addr: number; jump: number; value: number }[];
}

export interface RzGraphNode {
  id: string;
  offset: number;
  title: string;
  body: string;
  out_nodes: string[];
}

export interface RzFlag {
  name: string;
  realname: string;
  offset: number;
  size: number;
}

export interface RzMemoryMap {
  addr: number;
  addr_end: number;
  size: number;
  perm: string;
  name: string;
}

export interface RzRegister {
  name: string;
  type: number;
  type_str: string;
  size: number;
  value: number;
}

export interface RzAnalysis {
  functions: RzFunction[];
  xrefs: RzXref[];
  flags: RzFlag[];
}

export interface RzSessionState {
  file: {
    name: string;
    path: string;
    size: number;
  };
  seek: number;
  blocksize: number;
  config: Record<string, string | number | boolean>;
  flags: RzFlag[];
  functions: RzFunction[];
  comments: Record<number, string>;
  analysis: RzAnalysis;
}

export interface RzVersion {
  version: string;
  date: string;
  tag: string;
  asset_url: string;
}
