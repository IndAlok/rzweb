import { Dialog, DialogContent, DialogHeader, DialogTitle, ScrollArea, Button } from '@/components/ui';
import { useUIStore } from '@/stores';
import { Keyboard } from 'lucide-react';
import { GLOBAL_SHORTCUTS, VIEW_SHORTCUTS, ALT_KEY, type KeyShortcut } from '@/lib/shortcuts';

export function ShortcutsDialog() {
  const { shortcutsDialogOpen, setShortcutsDialogOpen } = useUIStore();

  const viewShortcuts: KeyShortcut[] = VIEW_SHORTCUTS.map((entry, index) => ({
    keys: [ALT_KEY, String(index + 1)],
    description: `Go to ${entry.label}`,
  }));

  const groups: { title: string; items: KeyShortcut[] }[] = [
    { title: 'General', items: [...GLOBAL_SHORTCUTS] },
    { title: 'Views', items: viewShortcuts },
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

        <ScrollArea className="max-h-[440px] mt-4">
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{group.title}</p>
                <div className="space-y-1">
                  {group.items.map((s, i) => (
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
