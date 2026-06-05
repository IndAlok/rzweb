import type { ActivePanel } from '@/stores';

// Show the right modifier name for the host platform.
const isMac =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');

export const MOD_KEY = isMac ? 'Cmd' : 'Ctrl';
export const ALT_KEY = 'Alt';

export interface ViewShortcut {
  view: ActivePanel;
  label: string;
}

// Order drives Alt+1..Alt+9 view switching. Capped at 9 single-digit combos.
export const VIEW_SHORTCUTS: readonly ViewShortcut[] = [
  { view: 'terminal', label: 'Terminal' },
  { view: 'disasm', label: 'Disassembly' },
  { view: 'hex', label: 'Hex' },
  { view: 'strings', label: 'Strings' },
  { view: 'graph', label: 'Graph' },
  { view: 'imports', label: 'Imports' },
  { view: 'exports', label: 'Exports' },
  { view: 'sections', label: 'Sections' },
  { view: 'info', label: 'Info' },
];

// Palette-navigable views without an Alt shortcut.
export const EXTRA_VIEWS: readonly ViewShortcut[] = [
  { view: 'decompiler', label: 'Decompiler' },
  { view: 'xrefs', label: 'Xrefs' },
];

export interface KeyShortcut {
  keys: string[];
  description: string;
}

export const GLOBAL_SHORTCUTS: readonly KeyShortcut[] = [
  { keys: [MOD_KEY, 'K'], description: 'Command palette' },
  { keys: [MOD_KEY, 'B'], description: 'Toggle sidebar' },
  { keys: [MOD_KEY, ','], description: 'Settings' },
  { keys: [MOD_KEY, '/'], description: 'Keyboard shortcuts' },
  { keys: ['Esc'], description: 'Close dialogs' },
];
