import { create } from 'zustand';

export type ActivePanel = 
  | 'terminal' 
  | 'disasm' 
  | 'hex' 
  | 'strings' 
  | 'functions' 
  | 'imports' 
  | 'exports' 
  | 'sections'
  | 'graph'
  | 'xrefs';

export type SidebarTab = 'files' | 'functions' | 'symbols' | 'search';

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarTab: SidebarTab;
  activePanel: ActivePanel;
  activePanels: ActivePanel[];
  splitDirection: 'horizontal' | 'vertical';
  commandPaletteOpen: boolean;
  settingsDialogOpen: boolean;
  shortcutsDialogOpen: boolean;
  searchDialogOpen: boolean;
  aboutDialogOpen: boolean;
  currentAddress: number;
  selectedFunction: string | null;
  currentView: ActivePanel;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setCurrentView: (view: ActivePanel) => void;
  addPanel: (panel: ActivePanel) => void;
  removePanel: (panel: ActivePanel) => void;
  setSplitDirection: (direction: 'horizontal' | 'vertical') => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setSearchDialogOpen: (open: boolean) => void;
  setAboutDialogOpen: (open: boolean) => void;
  setCurrentAddress: (address: number) => void;
  setSelectedFunction: (name: string | null) => void;
  navigateTo: (address: number) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  sidebarWidth: 280,
  sidebarTab: 'files',
  activePanel: 'terminal',
  activePanels: ['terminal'],
  splitDirection: 'horizontal',
  commandPaletteOpen: false,
  settingsDialogOpen: false,
  shortcutsDialogOpen: false,
  searchDialogOpen: false,
  aboutDialogOpen: false,
  currentAddress: 0,
  selectedFunction: null,
  currentView: 'terminal',

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  
  setActivePanel: (activePanel) => set({ activePanel, currentView: activePanel }),
  setCurrentView: (currentView) => set({ currentView, activePanel: currentView }),
  
  addPanel: (panel) =>
    set((state) => ({
      activePanels: state.activePanels.includes(panel)
        ? state.activePanels
        : [...state.activePanels, panel],
      activePanel: panel,
      currentView: panel,
    })),
  
  removePanel: (panel) =>
    set((state) => {
      const remaining = state.activePanels.filter((p) => p !== panel);
      return {
        activePanels: remaining.length > 0 ? remaining : ['terminal'],
        activePanel:
          state.activePanel === panel
            ? remaining[0] || 'terminal'
            : state.activePanel,
      };
    }),
  
  setSplitDirection: (splitDirection) => set({ splitDirection }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setSettingsDialogOpen: (settingsDialogOpen) => set({ settingsDialogOpen }),
  setShortcutsDialogOpen: (shortcutsDialogOpen) => set({ shortcutsDialogOpen }),
  setSearchDialogOpen: (searchDialogOpen) => set({ searchDialogOpen }),
  setAboutDialogOpen: (aboutDialogOpen) => set({ aboutDialogOpen }),
  setCurrentAddress: (currentAddress) => set({ currentAddress }),
  setSelectedFunction: (selectedFunction) => set({ selectedFunction }),
  
  navigateTo: (address) => {
    set({ currentAddress: address });
  },
}));
