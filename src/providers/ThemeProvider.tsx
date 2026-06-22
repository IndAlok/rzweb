import { useEffect, useState, type ReactNode } from 'react';
import { useSettingsStore, type Theme } from '@/stores';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getThemeMeta,
  isThemeId,
  type Appearance,
  type ThemeId,
} from '@/lib/themes';
import { ThemeContext } from './theme-context';

function resolveThemeId(theme: Theme): ThemeId {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  }
  if (isThemeId(theme)) return theme;
  return theme === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}

export function ThemeProvider({
  children,
  defaultTheme = 'rizin-dark',
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const { theme, setTheme } = useSettingsStore();
  const [resolvedThemeId, setResolvedThemeId] = useState<ThemeId>(DEFAULT_DARK_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<Appearance>('dark');

  useEffect(() => {
    const root = document.documentElement;

    const apply = (t: Theme) => {
      const id = resolveThemeId(t);
      const meta = getThemeMeta(id);
      root.dataset.theme = id;
      root.classList.toggle('dark', meta.appearance === 'dark');
      setResolvedThemeId(id);
      setResolvedTheme(meta.appearance);
    };

    apply(theme || defaultTheme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme, defaultTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedThemeId, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
