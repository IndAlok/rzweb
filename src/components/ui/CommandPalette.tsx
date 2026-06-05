import { useMemo, useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { Search, Code, Terminal, Share2, Quote, Layout, Keyboard, Settings, Package, ArrowUpRight, Layers, Info, FunctionSquare, Hash, ChevronRight, Braces, ArrowLeftRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUIStore, type ActivePanel } from '@/stores';
import { VIEW_SHORTCUTS, EXTRA_VIEWS, ALT_KEY, MOD_KEY } from '@/lib/shortcuts';
import { formatAddressShort } from '@/lib/utils/format';
import type { RzFunction, RzString } from '@/types/rizin';

const VIEW_ICONS: Record<ActivePanel, LucideIcon> = {
  terminal: Terminal,
  disasm: Code,
  decompiler: Braces,
  hex: Layout,
  strings: Quote,
  graph: Share2,
  xrefs: ArrowLeftRight,
  imports: Package,
  exports: ArrowUpRight,
  sections: Layers,
  info: Info,
};

const MAX_RESULTS = 50;

interface CommandPaletteProps {
  functions?: RzFunction[];
  strings?: RzString[];
  onSeek?: (address: number, view?: ActivePanel) => void;
  onSelectFunction?: (fn: RzFunction) => void;
  onRunCommand?: (command: string) => void;
}

// just fuzzy match
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === q[qi]) { found = k; break; }
    }
    if (found === -1) return -1;
    score += found === prev + 1 ? 3 : 1;
    if (found === 0) score += 2;
    prev = found;
    ti = found + 1;
  }
  return score;
}

function parseSeek(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]+$/.test(s)) return parseInt(s, 16);
  return null;
}

export function CommandPalette({ functions = [], strings = [], onSeek, onSelectFunction, onRunCommand }: CommandPaletteProps) {
  const { commandPaletteOpen, setCommandPaletteOpen, setCurrentView, setSettingsDialogOpen, setShortcutsDialogOpen } = useUIStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!commandPaletteOpen) setQuery('');
  }, [commandPaletteOpen]);

  const trimmed = query.trim();
  const isCommand = trimmed.startsWith('>');
  const commandText = isCommand ? trimmed.slice(1).trim() : '';
  const seekAddr = !isCommand && onSeek ? parseSeek(trimmed) : null;

  const fnMatches = useMemo(() => {
    if (!commandPaletteOpen || isCommand || !trimmed || !onSelectFunction || functions.length === 0) return [];
    const scored: Array<{ fn: RzFunction; score: number }> = [];
    for (const fn of functions) {
      const name = fn.name || '';
      const byName = fuzzyScore(trimmed, name);
      const byAddr = formatAddressShort(fn.offset).includes(trimmed.toLowerCase()) ? 6 : -1;
      const score = Math.max(byName, byAddr);
      if (score >= 0) scored.push({ fn, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map((entry) => entry.fn);
  }, [commandPaletteOpen, isCommand, trimmed, functions, onSelectFunction]);

  const strMatches = useMemo(() => {
    if (!commandPaletteOpen || isCommand || !trimmed || !onSeek || strings.length === 0) return [];
    const scored: Array<{ str: RzString; score: number }> = [];
    for (const str of strings) {
      const content = str.string || '';
      const byText = fuzzyScore(trimmed, content);
      const byAddr = formatAddressShort(str.vaddr).includes(trimmed.toLowerCase()) ? 6 : -1;
      const score = Math.max(byText, byAddr);
      if (score >= 0) scored.push({ str, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map((entry) => entry.str);
  }, [commandPaletteOpen, isCommand, trimmed, strings, onSeek]);

  const navMatches = useMemo(() => {
    if (isCommand) return [];
    const alt = VIEW_SHORTCUTS.map((entry, index) => ({ ...entry, alt: index + 1 as number | null }));
    const extra = EXTRA_VIEWS.map((entry) => ({ ...entry, alt: null as number | null }));
    return [...alt, ...extra].filter((entry) => fuzzyScore(trimmed, entry.label) >= 0);
  }, [isCommand, trimmed]);

  if (!commandPaletteOpen) return null;

  const close = () => setCommandPaletteOpen(false);
  const goTo = (view: ActivePanel) => { setCurrentView(view); close(); };

  const runCommand = () => {
    if (commandText && onRunCommand) {
      onRunCommand(commandText);
      close();
    }
  };

  const seekTo = (address: number, view: ActivePanel = 'hex') => {
    onSeek?.(address, view);
    close();
  };

  const selectFunction = (fn: RzFunction) => {
    onSelectFunction?.(fn);
    close();
  };

  const showSettings = !isCommand && (!trimmed || fuzzyScore(trimmed, 'open settings') >= 0 || fuzzyScore(trimmed, 'keyboard shortcuts') >= 0);
  const hasAny =
    (isCommand ? commandText.length > 0 : false) ||
    seekAddr !== null ||
    fnMatches.length > 0 ||
    strMatches.length > 0 ||
    navMatches.length > 0 ||
    showSettings;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-black/60 backdrop-blur-sm animate-fade-in" onClick={close}>
      <div
        className="w-full max-w-[640px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} className="flex h-full w-full flex-col">
          <div className="flex items-center border-b border-border px-3" cmdk-input-wrapper="">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search functions, seek 0x..., or > run a command"
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto overflow-x-hidden p-2 scrollbar-thin">
            {!hasAny && <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>}

            {isCommand && commandText && onRunCommand && (
              <Command.Group heading="Rizin" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <CommandItem value="run-command" onSelect={runCommand}>
                  <ChevronRight className="mr-2 h-4 w-4 text-primary" />
                  <span className="font-mono">{commandText}</span>
                  <CommandShortcut>Run</CommandShortcut>
                </CommandItem>
              </Command.Group>
            )}

            {seekAddr !== null && (
              <Command.Group heading="Seek" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <CommandItem value="seek" onSelect={() => seekTo(seekAddr)}>
                  <Hash className="mr-2 h-4 w-4" />
                  <span>Seek to <span className="font-mono text-code-address">{formatAddressShort(seekAddr)}</span></span>
                </CommandItem>
              </Command.Group>
            )}

            {fnMatches.length > 0 && (
              <Command.Group heading="Functions" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {fnMatches.map((fn) => (
                  <CommandItem key={`fn-${fn.offset}-${fn.name}`} value={`fn-${fn.offset}-${fn.name}`} onSelect={() => selectFunction(fn)}>
                    <FunctionSquare className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">{fn.name}</span>
                    <CommandShortcut className="font-mono">{formatAddressShort(fn.offset)}</CommandShortcut>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {strMatches.length > 0 && (
              <Command.Group heading="Strings" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {strMatches.map((str, index) => (
                  <CommandItem key={`str-${str.vaddr}-${index}`} value={`str-${str.vaddr}-${index}`} onSelect={() => seekTo(str.vaddr)}>
                    <Quote className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">{str.string}</span>
                    <CommandShortcut className="font-mono">{formatAddressShort(str.vaddr)}</CommandShortcut>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {navMatches.length > 0 && (
              <Command.Group heading="Navigation" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {navMatches.map(({ view, label, alt }) => {
                  const Icon = VIEW_ICONS[view];
                  return (
                    <CommandItem key={view} value={`nav-${view}`} onSelect={() => goTo(view)}>
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{label}</span>
                      {alt !== null && <CommandShortcut>{ALT_KEY}{alt}</CommandShortcut>}
                    </CommandItem>
                  );
                })}
              </Command.Group>
            )}

            {showSettings && (
              <Command.Group heading="Settings & Info" className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <CommandItem value="settings" onSelect={() => { setSettingsDialogOpen(true); close(); }}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Open Settings</span>
                  <CommandShortcut>{MOD_KEY},</CommandShortcut>
                </CommandItem>
                <CommandItem value="shortcuts" onSelect={() => { setShortcutsDialogOpen(true); close(); }}>
                  <Keyboard className="mr-2 h-4 w-4" />
                  <span>Keyboard Shortcuts</span>
                  <CommandShortcut>{MOD_KEY}/</CommandShortcut>
                </CommandItem>
              </Command.Group>
            )}
          </Command.List>
          <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-3">
            <span><span className="font-mono text-foreground">0x...</span> seek</span>
            <span><span className="font-mono text-foreground">&gt;</span> run command</span>
            <span><span className="font-mono text-foreground">Enter</span> select</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({ children, value, onSelect }: { children: React.ReactNode; value: string; onSelect?: () => void }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
      {children}
    </Command.Item>
  );
}

function CommandShortcut({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`ml-auto pl-3 text-xs tracking-widest text-muted-foreground ${className ?? ''}`}>
      {children}
    </span>
  );
}
