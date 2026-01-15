import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import { useTheme } from './ThemeProvider';

export function ToastProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'bg-card text-card-foreground border-border',
          duration: 4000,
        }}
        theme={resolvedTheme}
        richColors
        closeButton
      />
    </>
  );
}
