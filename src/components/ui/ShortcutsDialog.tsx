import { Dialog, DialogContent, DialogHeader, DialogTitle, ScrollArea, Button } from '@/components/ui';
import { useUIStore } from '@/stores';
import { Keyboard } from 'lucide-react';

export function ShortcutsDialog() {
  const { shortcutsDialogOpen, setShortcutsDialogOpen } = useUIStore();

  const shortcuts = [
    { keys: ['Ctrl', 'K'], description: 'Open Command Palette' },
    { keys: ['Ctrl', 'D'], description: 'Switch to Disassembly View' },
    { keys: ['Ctrl', 'G'], description: 'Switch to Graph View' },
    { keys: ['Ctrl', 'H'], description: 'Switch to Hex View' },
    { keys: ['Ctrl', 'S'], description: 'Switch to Strings View' },
    { keys: ['Ctrl', 'T'], description: 'Switch to Terminal' },
    { keys: ['Ctrl', 'B'], description: 'Toggle Sidebar' },
    { keys: ['Ctrl', ','], description: 'Open Settings' },
    { keys: ['Ctrl', '/'], description: 'Keyboard Shortcuts' },
    { keys: ['Esc'], description: 'Close Dialogs / Cancel' },
  ];

  return (
    <Dialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] mt-4">
          <div className="space-y-1">
            {shortcuts.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0 px-2">
                <span className="text-sm font-medium">{s.description}</span>
                <div className="flex gap-1">
                  {s.keys.map((k, j) => (
                    <kbd key={j} className="h-6 min-w-[24px] flex items-center justify-center px-1.5 rounded border border-border bg-muted text-[10px] font-mono shadow-sm">
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-6 flex justify-end">
          <Button onClick={() => setShortcutsDialogOpen(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
