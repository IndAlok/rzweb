import { create } from 'zustand';

export type ActivePanel =
  | 'terminal'
  | 'disasm'
  | 'decompiler'
  | 'hex'
  | 'strings'
  | 'graph'
  | 'xrefs'
  | 'imports'
  | 'exports'
  | 'sections'
  | 'info';

interface UIState {
  sidebarOpen: boolean;
  splitDirection: 'horizontal' | 'vertical';
  commandPaletteOpen: boolean;
  settingsDialogOpen: boolean;
  shortcutsDialogOpen: boolean;
  currentAddress: number;
  selectedFunction: string | null;
  currentView: ActivePanel;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSplitDirection: (direction: 'horizontal' | 'vertical') => void;
  setCurrentView: (view: ActivePanel) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setCurrentAddress: (address: number) => void;
  setSelectedFunction: (name: string | null) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  splitDirection: 'horizontal',
  commandPaletteOpen: false,
  settingsDialogOpen: false,
  shortcutsDialogOpen: false,
  currentAddress: 0,
  selectedFunction: null,
  currentView: 'terminal',

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSplitDirection: (splitDirection) => set({ splitDirection }),
  setCurrentView: (currentView) => set({ currentView }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setSettingsDialogOpen: (settingsDialogOpen) => set({ settingsDialogOpen }),
  setShortcutsDialogOpen: (shortcutsDialogOpen) => set({ shortcutsDialogOpen }),
  setCurrentAddress: (currentAddress) => set({ currentAddress }),
  setSelectedFunction: (selectedFunction) => set({ selectedFunction }),
}));
