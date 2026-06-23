import { create } from 'zustand';
import type { LoadedFile } from './fileStore';
import type { ActivePanel } from './uiStore';

// Per tab view state paused while another tab is active, restored on return.
export interface TabViewState {
  view: ActivePanel;
  address: number;
  selectedFunction: string | null;
}

export interface AnalysisTab {
  id: string;
  file: LoadedFile;
  parked: TabViewState | null;
}

interface TabState {
  tabs: AnalysisTab[];
  activeTabId: string | null;

  openTab: (file: LoadedFile) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  parkTab: (id: string, state: TabViewState) => void;
  reset: () => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (file) => {
    const id = file.id;
    const exists = get().tabs.some((t) => t.id === id);
    if (!exists) {
      set((state) => ({ tabs: [...state.tabs, { id, file, parked: null }] }));
    }
    set({ activeTabId: id });
    return id;
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeTabId = state.activeTabId;
      if (state.activeTabId === id) {
        const next = tabs[index] ?? tabs[index - 1] ?? tabs[0] ?? null;
        activeTabId = next?.id ?? null;
      }
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  parkTab: (id, parked) =>
    set((state) => ({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, parked } : t)) })),

  reset: () => set({ tabs: [], activeTabId: null }),
}));
