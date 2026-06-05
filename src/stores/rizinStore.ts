import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RizinFile {
  name: string;
  data: Uint8Array;
  size: number;
}

type LoadPhase = 'idle' | 'initializing' | 'downloading' | 'processing' | 'analyzing' | 'ready' | 'error';

interface RizinState {
  isLoading: boolean;
  loadProgress: number;
  loadPhase: LoadPhase;
  loadMessage: string;
  currentVersion: string;
  cachedVersions: string[];
  error: string | null;

  setLoading: (loading: boolean) => void;
  setLoadProgress: (progress: number) => void;
  setLoadPhase: (phase: LoadPhase) => void;
  setLoadMessage: (message: string) => void;
  setCurrentVersion: (version: string) => void;
  setCachedVersions: (versions: string[]) => void;
  addCachedVersion: (version: string) => void;
  removeCachedVersion: (version: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  isLoading: false,
  loadProgress: 0,
  loadPhase: 'idle' as LoadPhase,
  loadMessage: '',
  currentVersion: '',
  cachedVersions: [] as string[],
  error: null,
};

export const useRizinStore = create<RizinState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setLoading: (isLoading) => set({ isLoading }),
      setLoadProgress: (loadProgress) => set({ loadProgress }),
      setLoadPhase: (loadPhase) => set({ loadPhase }),
      setLoadMessage: (loadMessage) => set({ loadMessage }),
      setCurrentVersion: (currentVersion) => set({ currentVersion }),
      setCachedVersions: (cachedVersions) => set({ cachedVersions }),
      addCachedVersion: (version) =>
        set((state) => ({
          cachedVersions: state.cachedVersions.includes(version)
            ? state.cachedVersions
            : [...state.cachedVersions, version],
        })),
      removeCachedVersion: (version) =>
        set((state) => ({
          cachedVersions: state.cachedVersions.filter((v) => v !== version),
        })),
      setError: (error) => set({ error }),
      reset: () =>
        set({
          ...initialState,
          cachedVersions: get().cachedVersions,
        }),
    }),
    {
      name: 'rzweb-rizin',
      partialize: (state) => ({
        currentVersion: state.currentVersion,
        cachedVersions: state.cachedVersions,
      }),
    }
  )
);
