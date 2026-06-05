import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/stores';
import { VIEW_SHORTCUTS } from '@/lib/shortcuts';

const CAPTURE = {
  enableOnFormTags: true,
  preventDefault: true,
  eventListenerOptions: { capture: true },
};

export function useKeyboardShortcuts() {
  useHotkeys(
    'mod+k',
    (e) => {
      e.stopPropagation();
      const ui = useUIStore.getState();
      ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
    },
    CAPTURE
  );

  useHotkeys(
    'mod+b',
    (e) => {
      e.stopPropagation();
      useUIStore.getState().toggleSidebar();
    },
    CAPTURE
  );

  useHotkeys(
    'mod+comma',
    (e) => {
      e.stopPropagation();
      useUIStore.getState().setSettingsDialogOpen(true);
    },
    CAPTURE
  );

  useHotkeys(
    'mod+slash',
    (e) => {
      e.stopPropagation();
      useUIStore.getState().setShortcutsDialogOpen(true);
    },
    CAPTURE
  );

  useHotkeys(
    'alt+1,alt+2,alt+3,alt+4,alt+5,alt+6,alt+7,alt+8,alt+9',
    (e, handler) => {
      e.stopPropagation();
      const digit = handler.keys?.[0];
      const target = digit ? VIEW_SHORTCUTS[Number(digit) - 1] : undefined;
      if (target) {
        useUIStore.getState().setCurrentView(target.view);
      }
    },
    CAPTURE
  );

  useHotkeys(
    'escape',
    () => {
      const ui = useUIStore.getState();
      if (ui.commandPaletteOpen) ui.setCommandPaletteOpen(false);
      if (ui.settingsDialogOpen) ui.setSettingsDialogOpen(false);
      if (ui.shortcutsDialogOpen) ui.setShortcutsDialogOpen(false);
    },
    { enableOnFormTags: true }
  );
}
