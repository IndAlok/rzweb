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
  autoAnalysis: boolean;
  maxOutputSizeMb: number;
  showLineNumbers: boolean;
  hexBytesPerRow: number;
  defaultVersion: string;
  cacheVersions: boolean;
  enableAnimations: boolean;
  compactMode: boolean;
  writeMode: boolean;
  debugMode: boolean;
  noAnalysis: boolean;

  setTheme: (theme: Theme) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalScrollback: (lines: number) => void;
  setTerminalCursorBlink: (blink: boolean) => void;
  setTerminalAutocompleteMinChars: (chars: number) => void;
  setTerminalAutocompleteMaxResults: (count: number) => void;
  setAnalysisDepth: (depth: number) => void;
  setIoCache: (enabled: boolean) => void;
  setAutoAnalysis: (enabled: boolean) => void;
  setMaxOutputSizeMb: (size: number) => void;
  setShowLineNumbers: (show: boolean) => void;
  setHexBytesPerRow: (bytes: number) => void;
  setDefaultVersion: (version: string) => void;
  setCacheVersions: (cache: boolean) => void;
  setEnableAnimations: (enable: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  setWriteMode: (enabled: boolean) => void;
  setDebugMode: (enabled: boolean) => void;
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
  autoAnalysis: false,
  maxOutputSizeMb: 16,
  showLineNumbers: true,
  hexBytesPerRow: 16,
  defaultVersion: 'latest',
  cacheVersions: true,
  enableAnimations: true,
  compactMode: false,
  writeMode: false,
  debugMode: false,
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
      setAutoAnalysis: (autoAnalysis) => set({ autoAnalysis }),
      setMaxOutputSizeMb: (maxOutputSizeMb) => set({ maxOutputSizeMb }),
      setShowLineNumbers: (showLineNumbers) => set({ showLineNumbers }),
      setHexBytesPerRow: (hexBytesPerRow) => set({ hexBytesPerRow }),
      setDefaultVersion: (defaultVersion) => set({ defaultVersion }),
      setCacheVersions: (cacheVersions) => set({ cacheVersions }),
      setEnableAnimations: (enableAnimations) => set({ enableAnimations }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setWriteMode: (writeMode) => set({ writeMode }),
      setDebugMode: (debugMode) => set({ debugMode }),
      setNoAnalysis: (noAnalysis) => set({ noAnalysis }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'rzweb-settings',
    }
  )
);
