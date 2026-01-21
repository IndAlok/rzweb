import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LoadedFile {
  id: string;
  name: string;
  data: Uint8Array;
  size: number;
  loadedAt: number;
  path?: string;
}

export interface RecentFile {
  name: string;
  size: number;
  loadedAt: number;
}

interface FileState {
  currentFile: LoadedFile | null;
  recentFiles: RecentFile[];
  maxRecentFiles: number;

  setCurrentFile: (file: LoadedFile | null) => void;
  addRecentFile: (file: { name: string; size: number }) => void;
  removeRecentFile: (name: string) => void;
  clearCurrentFile: () => void;
  clearRecentFiles: () => void;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      currentFile: null,
      recentFiles: [],
      maxRecentFiles: 10,

      setCurrentFile: (file) => {
        set({ currentFile: file });
        if (file) {
          get().addRecentFile({ name: file.name, size: file.size });
        }
      },

      addRecentFile: (file) => {
        set((state) => {
          const filtered = state.recentFiles.filter((f) => f.name !== file.name);
          const newRecent = [
            { ...file, loadedAt: Date.now() },
            ...filtered,
          ].slice(0, state.maxRecentFiles);
          return { recentFiles: newRecent };
        });
      },

      removeRecentFile: (name) => {
        set((state) => ({
          recentFiles: state.recentFiles.filter((f) => f.name !== name),
        }));
      },

      clearCurrentFile: () => set({ currentFile: null }),

      clearRecentFiles: () => set({ recentFiles: [] }),
    }),
    {
      name: 'rzweb-files',
      partialize: (state) => ({ recentFiles: state.recentFiles }),
    }
  )
);
