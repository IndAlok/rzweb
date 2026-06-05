import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface SettingsState {
  theme: Theme;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalCursorBlink: boolean;
  terminalAutocompleteMinChars: number;
  terminalAutocompleteMaxResults: number;
  analysisDepth: number;
  ioCache: boolean;
  maxOutputSizeMb: number;
  showLineNumbers: boolean;
  hexBytesPerRow: number;
  cacheVersions: boolean;
  noAnalysis: boolean;

  setTheme: (theme: Theme) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalScrollback: (lines: number) => void;
  setTerminalCursorBlink: (blink: boolean) => void;
  setTerminalAutocompleteMinChars: (chars: number) => void;
  setTerminalAutocompleteMaxResults: (count: number) => void;
  setAnalysisDepth: (depth: number) => void;
  setIoCache: (enabled: boolean) => void;
  setMaxOutputSizeMb: (size: number) => void;
  setShowLineNumbers: (show: boolean) => void;
  setHexBytesPerRow: (bytes: number) => void;
  setCacheVersions: (cache: boolean) => void;
  setNoAnalysis: (enabled: boolean) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'dark' as Theme,
  terminalFontSize: 14,
  terminalScrollback: 10000,
  terminalCursorBlink: true,
  terminalAutocompleteMinChars: 2,
  terminalAutocompleteMaxResults: 12,
  analysisDepth: 2,
  ioCache: true,
  maxOutputSizeMb: 16,
  showLineNumbers: true,
  hexBytesPerRow: 16,
  cacheVersions: true,
  noAnalysis: false,
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => set({ theme }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalScrollback: (terminalScrollback) => set({ terminalScrollback }),
      setTerminalCursorBlink: (terminalCursorBlink) => set({ terminalCursorBlink }),
      setTerminalAutocompleteMinChars: (terminalAutocompleteMinChars) => set({
        terminalAutocompleteMinChars: clampInt(terminalAutocompleteMinChars, 1, 10),
      }),
      setTerminalAutocompleteMaxResults: (terminalAutocompleteMaxResults) => set({
        terminalAutocompleteMaxResults: clampInt(terminalAutocompleteMaxResults, 1, 100),
      }),
      setAnalysisDepth: (analysisDepth) => set({ analysisDepth }),
      setIoCache: (ioCache) => set({ ioCache }),
      setMaxOutputSizeMb: (maxOutputSizeMb) => set({ maxOutputSizeMb }),
      setShowLineNumbers: (showLineNumbers) => set({ showLineNumbers }),
      setHexBytesPerRow: (hexBytesPerRow) => set({ hexBytesPerRow }),
      setCacheVersions: (cacheVersions) => set({ cacheVersions }),
      setNoAnalysis: (noAnalysis) => set({ noAnalysis }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'rzweb-settings',
    }
  )
);
