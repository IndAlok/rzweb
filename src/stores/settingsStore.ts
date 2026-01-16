import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface SettingsState {
  theme: Theme;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalCursorBlink: boolean;
  analysisDepth: number;
  ioCache: boolean;
  autoAnalysis: boolean;
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
  setAnalysisDepth: (depth: number) => void;
  setIoCache: (enabled: boolean) => void;
  setAutoAnalysis: (enabled: boolean) => void;
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
  analysisDepth: 24,
  ioCache: true,
  autoAnalysis: false,
  showLineNumbers: true,
  hexBytesPerRow: 16,
  defaultVersion: '0.8.1',
  cacheVersions: true,
  enableAnimations: true,
  compactMode: false,
  writeMode: false,
  debugMode: false,
  noAnalysis: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => set({ theme }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalScrollback: (terminalScrollback) => set({ terminalScrollback }),
      setTerminalCursorBlink: (terminalCursorBlink) => set({ terminalCursorBlink }),
      setAnalysisDepth: (analysisDepth) => set({ analysisDepth }),
      setIoCache: (ioCache) => set({ ioCache }),
      setAutoAnalysis: (autoAnalysis) => set({ autoAnalysis }),
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
