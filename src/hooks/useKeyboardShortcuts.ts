import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/stores';

export function useKeyboardShortcuts() {
  const {
    setCommandPaletteOpen,
    setSearchDialogOpen,
    toggleSidebar,
    setSettingsDialogOpen,
    setShortcutsDialogOpen,
  } = useUIStore();

  useHotkeys('mod+k', (e) => {
    e.preventDefault();
    setCommandPaletteOpen(true);
  });

  useHotkeys('mod+f', (e) => {
    e.preventDefault();
    setSearchDialogOpen(true);
  });

  useHotkeys('mod+b', (e) => {
    e.preventDefault();
    toggleSidebar();
  });

  useHotkeys('mod+,', (e) => {
    e.preventDefault();
    setSettingsDialogOpen(true);
  });

  useHotkeys('mod+/', (e) => {
    e.preventDefault();
    setShortcutsDialogOpen(true);
  });

  useHotkeys('escape', () => {
    setCommandPaletteOpen(false);
    setSearchDialogOpen(false);
    setSettingsDialogOpen(false);
    setShortcutsDialogOpen(false);
  });
}

export const shortcuts = [
  { keys: ['Ctrl', 'K'], description: 'Open command palette' },
  { keys: ['Ctrl', 'F'], description: 'Search' },
  { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
  { keys: ['Ctrl', ','], description: 'Settings' },
  { keys: ['Ctrl', '/'], description: 'Keyboard shortcuts' },
  { keys: ['Escape'], description: 'Close dialogs' },
];
