import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_HISTORY_SIZE = 1000;
const PERSISTED_HISTORY_SIZE = 100;

interface SessionState {
  commandHistory: string[];
  addToHistory: (command: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      commandHistory: [],

      addToHistory: (command) => {
        if (!command.trim()) return;
        set((state) => {
          const filtered = state.commandHistory.filter((c) => c !== command);
          return { commandHistory: [command, ...filtered].slice(0, MAX_HISTORY_SIZE) };
        });
      },
    }),
    {
      name: 'rzweb-sessions',
      partialize: (state) => ({
        commandHistory: state.commandHistory.slice(0, PERSISTED_HISTORY_SIZE),
      }),
    }
  )
);
