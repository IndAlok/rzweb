import { createContext, useContext } from 'react';
import type { Theme } from '@/stores';
import type { Appearance, ThemeId } from '@/lib/themes';

export interface ThemeContextValue {
  theme: Theme;
  resolvedThemeId: ThemeId;
  resolvedTheme: Appearance;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
