import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionTab {
  id: string;
  name: string;
  fileId: string;
  createdAt: number;
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;
  commandHistory: string[];
  maxHistorySize: number;

  addTab: (tab: Omit<SessionTab, 'id' | 'createdAt'>) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  addToHistory: (command: string) => void;
  clearHistory: () => void;
  clearTabs: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, _get) => ({
      tabs: [],
      activeTabId: null,
      commandHistory: [],
      maxHistorySize: 1000,

      addTab: (tab) => {
        const id = crypto.randomUUID();
        const newTab: SessionTab = {
          ...tab,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
        return id;
      },

      removeTab: (id) => {
        set((state) => {
          const remaining = state.tabs.filter((t) => t.id !== id);
          let newActiveId = state.activeTabId;
          
          if (state.activeTabId === id) {
            const index = state.tabs.findIndex((t) => t.id === id);
            newActiveId = remaining[Math.max(0, index - 1)]?.id || null;
          }
          
          return {
            tabs: remaining,
            activeTabId: newActiveId,
          };
        });
      },

      setActiveTab: (activeTabId) => set({ activeTabId }),

      renameTab: (id, name) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
        }));
      },

      addToHistory: (command) => {
        if (!command.trim()) return;
        set((state) => {
          const filtered = state.commandHistory.filter((c) => c !== command);
          const newHistory = [command, ...filtered].slice(0, state.maxHistorySize);
          return { commandHistory: newHistory };
        });
      },

      clearHistory: () => set({ commandHistory: [] }),

      clearTabs: () => set({ tabs: [], activeTabId: null }),
    }),
    {
      name: 'rzweb-sessions',
      partialize: (state) => ({
        commandHistory: state.commandHistory.slice(0, 100),
      }),
    }
  )
);
