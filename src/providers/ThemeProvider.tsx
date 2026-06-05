import { useEffect, useState, type ReactNode } from 'react';
import { useSettingsStore, type Theme } from '@/stores';
import { ThemeContext } from './theme-context';

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const { theme, setTheme } = useSettingsStore();
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (t: Theme) => {
      if (t === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', systemDark);
        setResolvedTheme(systemDark ? 'dark' : 'light');
      } else {
        root.classList.toggle('dark', t === 'dark');
        setResolvedTheme(t);
      }
    };

    applyTheme(theme || defaultTheme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme, defaultTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
