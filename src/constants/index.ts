export const RIZIN_VERSIONS = [
  { value: '0.9.0', label: 'Rizin 0.9.0', latest: true },
  { value: '0.8.0', label: 'Rizin 0.8.0', latest: false },
  { value: '0.7.3', label: 'Rizin 0.7.3', latest: false },
  { value: '0.7.2', label: 'Rizin 0.7.2', latest: false },
  { value: '0.7.1', label: 'Rizin 0.7.1', latest: false },
  { value: '0.7.0', label: 'Rizin 0.7.0', latest: false },
] as const;

export const DEFAULT_VERSION = '0.9.0';

export const GITHUB_RELEASES_URL = 'https://github.com/rizinorg/rizin/releases/download';

export const MAX_FILE_SIZE = 100 * 1024 * 1024;

export const TERMINAL_THEMES = {
  dark: {
    background: '#0f172a',
    foreground: '#e2e8f0',
    cursor: '#38bdf8',
    cursorAccent: '#0f172a',
    selectionBackground: '#334155',
    black: '#1e293b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#f8fafc',
    brightBlack: '#475569',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff',
    foreground: '#1e293b',
    cursor: '#0284c7',
    cursorAccent: '#ffffff',
    selectionBackground: '#bae6fd',
    black: '#1e293b',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#f8fafc',
    brightBlack: '#64748b',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  },
} as const;

export const ANALYSIS_COMMANDS = [
  { command: 'aaa', label: 'Full Analysis', description: 'Run all analysis steps' },
  { command: 'aa', label: 'Basic Analysis', description: 'Analyze functions' },
  { command: 'aac', label: 'Analyze Calls', description: 'Analyze function calls' },
  { command: 'aar', label: 'Analyze Refs', description: 'Analyze references' },
  { command: 'aas', label: 'Analyze Symbols', description: 'Analyze symbols' },
  { command: 'af', label: 'Analyze Function', description: 'Analyze current function' },
] as const;

export const COMMON_COMMANDS = [
  { command: 'pdf', label: 'Print Disassembly', description: 'Print disassembly of function' },
  { command: 'px', label: 'Print Hex', description: 'Print hexdump' },
  { command: 'ps', label: 'Print String', description: 'Print string' },
  { command: 'afl', label: 'List Functions', description: 'List all functions' },
  { command: 'is', label: 'List Symbols', description: 'List symbols' },
  { command: 'iz', label: 'List Strings', description: 'List strings' },
  { command: 'iS', label: 'List Sections', description: 'List sections' },
  { command: 'ii', label: 'List Imports', description: 'List imports' },
  { command: 'iE', label: 'List Exports', description: 'List exports' },
] as const;
