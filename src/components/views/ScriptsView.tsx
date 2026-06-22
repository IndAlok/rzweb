import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, foldKeymap, bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { toast } from 'sonner';
import { useScriptStore, useSettingsStore, type SavedScript } from '@/stores';
import { useTheme } from '@/providers';
import { cn, stripAnsi } from '@/lib/utils';
import { languageExtension, editorTheme, completionSource, languageOf } from '@/lib/codemirror';
import { Button, Input, ScrollArea } from '@/components/ui';
import { Play, Save, Plus, Trash2, FileCode, Upload, Download } from 'lucide-react';
import type { RizinInstance } from '@/lib/rizin';

interface ScriptsViewProps {
  rizin: RizinInstance;
  className?: string;
}

export function ScriptsView({ rizin, className }: ScriptsViewProps) {
  const { scripts, upsertScript, deleteScript } = useScriptStore();
  const { terminalAutocompleteMinChars, terminalAutocompleteMaxResults } = useSettingsStore();
  const { resolvedThemeId, resolvedTheme } = useTheme();

  const editorParentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const completionCompartment = useRef(new Compartment());
  const uploadRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const language = languageOf(name || '.rz');

  // Stable refs so editor keybindings always call the latest handlers.
  const runRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => void>(() => {});

  const getSource = useCallback(() => viewRef.current?.state.doc.toString() ?? '', []);

  const setSource = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, []);

  // Create the editor once.
  useEffect(() => {
    if (!editorParentRef.current) return;
    const dark = resolvedTheme === 'dark';
    const state = EditorState.create({
      doc: '# One rizin command per line. Lines starting with # are comments.\nafl\npdf @ main',
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        langCompartment.current.of(languageExtension('rz')),
        completionCompartment.current.of(
          autocompletion({
            override: [completionSource('rz', rizin.getCommandCatalog(), terminalAutocompleteMinChars)],
            maxRenderedOptions: terminalAutocompleteMaxResults,
          })
        ),
        themeCompartment.current.of(editorTheme(dark)),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...foldKeymap,
          indentWithTab,
          { key: 'Mod-Enter', run: () => { runRef.current(); return true; } },
          { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true; } },
        ]),
      ],
    });
    const view = new EditorView({ state, parent: editorParentRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(resolvedTheme === 'dark')),
    });
  }, [resolvedThemeId, resolvedTheme]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        langCompartment.current.reconfigure(languageExtension(language)),
        completionCompartment.current.reconfigure(
          autocompletion({
            override: [completionSource(language, rizin.getCommandCatalog(), terminalAutocompleteMinChars)],
            maxRenderedOptions: terminalAutocompleteMaxResults,
          })
        ),
      ],
    });
  }, [language, rizin, terminalAutocompleteMinChars, terminalAutocompleteMaxResults]);

  const loadScript = useCallback((script: SavedScript) => {
    setActiveId(script.id);
    setName(script.name);
    setSource(script.content);
  }, [setSource]);

  const newScript = useCallback(() => {
    setActiveId(null);
    setName('');
    setSource('');
    setOutput('');
  }, [setSource]);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await rizin.runScript(getSource(), language);
      const text = stripAnsi(result.output);
      setOutput(result.error ? `${text}${text ? '\n' : ''}Error: ${result.error}` : text || '(no output)');
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [getSource, language, rizin, running]);

  const save = useCallback(() => {
    const script = upsertScript(name, getSource());
    setActiveId(script.id);
    setName(script.name);
    toast.success('Script saved');
  }, [name, getSource, upsertScript]);

  runRef.current = run;
  saveRef.current = save;

  const handleDelete = useCallback((id: string) => {
    deleteScript(id);
    if (activeId === id) newScript();
  }, [deleteScript, activeId, newScript]);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setActiveId(null);
    setName(file.name);
    setSource(text);
  }, [setSource]);

  const download = useCallback(() => {
    const blob = new Blob([getSource()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (name.trim() || 'script') + (languageOf(name) === 'js' ? '' : name.includes('.') ? '' : '.rz');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [getSource, name]);

  return (
    <div className={cn('flex h-full bg-background overflow-hidden', className)}>
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="flex h-9 items-center justify-between border-b border-border px-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Saved</span>
          <button onClick={newScript} className="rounded p-1 hover:bg-accent" title="New script">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1">
            {scripts.length === 0 ? (
              <p className="p-3 text-[11px] italic text-muted-foreground">No saved scripts</p>
            ) : (
              scripts.map((script) => (
                <div
                  key={script.id}
                  className={cn(
                    'group flex items-center justify-between rounded px-2 py-1.5 text-xs cursor-pointer',
                    activeId === script.id ? 'bg-primary/15 text-foreground' : 'hover:bg-accent/50 text-muted-foreground'
                  )}
                  onClick={() => loadScript(script)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FileCode className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{script.name}</span>
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(script.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/30 px-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="script.rz"
            className="h-6 max-w-[180px] text-[11px]"
          />
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-secondary-foreground">
            {language === 'js' ? 'JavaScript' : 'Rizin'}
          </span>
          <div className="flex-1" />
          <input ref={uploadRef} type="file" accept=".rz,.js,text/plain" className="hidden" onChange={handleUpload} />
          <Button size="sm" variant="ghost" onClick={() => uploadRef.current?.click()} title="Upload script">
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={download} title="Download script">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={save} title="Save (Ctrl/Cmd+S)">
            <Save className="mr-1 h-3.5 w-3.5" /> Save
          </Button>
          <Button size="sm" onClick={() => void run()} loading={running} title="Run (Ctrl/Cmd+Enter)">
            <Play className="mr-1 h-3.5 w-3.5" /> Run
          </Button>
        </div>

        <div ref={editorParentRef} className="min-h-0 flex-1 overflow-hidden text-sm" />

        <div className="flex h-[36%] shrink-0 flex-col border-t border-border">
          <div className="flex h-6 items-center justify-between bg-muted/20 px-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</span>
            {output && (
              <button onClick={() => setOutput('')} className="text-[10px] text-muted-foreground hover:text-foreground">
                Clear
              </button>
            )}
          </div>
          <ScrollArea className="flex-1">
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs text-foreground">{output}</pre>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
