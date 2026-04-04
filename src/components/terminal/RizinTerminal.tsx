import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { useSettingsStore, useSessionStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { RizinCommandHelpEntry, RizinInstance } from '@/lib/rizin';

export interface RizinTerminalRef {
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  sendInput: (input: string) => void;
  search: (term: string) => void;
  clearTerminal: () => void;
  focus: () => void;
}

interface RizinTerminalProps {
  rizin: RizinInstance | null;
  className?: string;
  onReady?: () => void;
}

interface AutocompleteSuggestion {
  value: string;
  meta?: RizinCommandHelpEntry;
}

interface TerminalAutocompleteState {
  visible: boolean;
  suggestions: AutocompleteSuggestion[];
  selectedIndex: number;
  replacementStart: number;
  replacementEnd: number;
  endString: string;
  manualSelection: boolean;
}

const EMPTY_AUTOCOMPLETE_STATE: TerminalAutocompleteState = {
  visible: false,
  suggestions: [],
  selectedIndex: 0,
  replacementStart: 0,
  replacementEnd: 0,
  endString: '',
  manualSelection: false,
};

function getAutocompleteFragmentLength(input: string, cursorPos: number): number {
  const left = input.slice(0, cursorPos);
  const fragment = left.split(/[\s;|(),]+/).pop() ?? '';
  return fragment.length;
}

function computeCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0] ?? '';
  for (let i = 1; i < values.length; i++) {
    const value = values[i] ?? '';
    let nextLength = 0;
    while (nextLength < prefix.length && nextLength < value.length && prefix[nextLength] === value[nextLength]) {
      nextLength++;
    }
    prefix = prefix.slice(0, nextLength);
    if (!prefix) {
      break;
    }
  }
  return prefix;
}

export const RizinTerminal = forwardRef<RizinTerminalRef, RizinTerminalProps>(
  ({ rizin, className, onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const connectedRef = useRef<RizinInstance | null>(null);
    const inputBuffer = useRef('');
    const cursorPos = useRef(0);
    const historyIndex = useRef(-1);
    const autocompleteRef = useRef<TerminalAutocompleteState>(EMPTY_AUTOCOMPLETE_STATE);
    const commandCatalogRef = useRef<Record<string, RizinCommandHelpEntry>>({});

    const {
      terminalFontSize,
      terminalScrollback,
      terminalCursorBlink,
      terminalAutocompleteMinChars,
      terminalAutocompleteMaxResults,
    } = useSettingsStore();
    const { addToHistory, commandHistory } = useSessionStore();

    const [autocompleteState, setAutocompleteState] = useState<TerminalAutocompleteState>(EMPTY_AUTOCOMPLETE_STATE);

    const addToHistoryRef = useRef(addToHistory);
    const commandHistoryRef = useRef(commandHistory);
    const rizinRef = useRef(rizin);

    useEffect(() => {
      addToHistoryRef.current = addToHistory;
      commandHistoryRef.current = commandHistory;
      rizinRef.current = rizin;
      commandCatalogRef.current = rizin?.getCommandCatalog?.() ?? {};
      autocompleteRef.current = EMPTY_AUTOCOMPLETE_STATE;
      setAutocompleteState(EMPTY_AUTOCOMPLETE_STATE);
    }, [addToHistory, commandHistory, rizin]);

    const setAutocompleteView = useCallback((nextState: TerminalAutocompleteState) => {
      autocompleteRef.current = nextState;
      setAutocompleteState(nextState);
    }, []);

    const hideAutocomplete = useCallback(() => {
      if (!autocompleteRef.current.visible) {
        return;
      }
      setAutocompleteView(EMPTY_AUTOCOMPLETE_STATE);
    }, [setAutocompleteView]);

    const executeCommand = useCallback(async (command: string) => {
      const term = terminalRef.current;
      const rz = rizinRef.current;
      if (!term || !rz) return;

      try {
        const result = await rz.executeCommand(command);
        const stderr = rz.getLastStderr();

        if (stderr && stderr.trim()) {
          const stderrLines = stderr.split('\n').filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (trimmed.startsWith('INFO:')) return false;
            if (trimmed.startsWith('DEBUG:')) return false;
            if (trimmed.startsWith('VERBOSE:')) return false;
            if (trimmed.startsWith('WARNING:')) return false;
            if (trimmed.includes('Cannot open directory')) return false;
            if (trimmed.includes('Jump table target is not valid')) return false;
            if (trimmed.includes('No calling convention')) return false;
            if (trimmed.includes('to extract register arguments')) return false;
            if (trimmed.includes('Neither hash nor gnu_hash')) return false;
            if (trimmed.includes('rz_config_node_desc: assertion')) return false;
            if (trimmed.includes('rz_config_set:')) return false;
            if (trimmed.includes('rz_config_get:')) return false;
            if (trimmed.includes('variable') && trimmed.includes('not found')) return false;
            return true;
          });
          stderrLines.forEach(line => {
            if (line.startsWith('ERROR:')) {
              term.writeln(`\x1b[31m${line}\x1b[0m`);
            } else if (line.startsWith('Usage:') || line.startsWith('|')) {
              term.writeln(`\x1b[36m${line}\x1b[0m`);
            } else {
              term.writeln(`\x1b[33m${line}\x1b[0m`);
            }
          });
        }

        if (result && result.trim()) {
          const LINES_PER_PAGE = 100;
          const allLines = result.split('\n');
          const totalLines = allLines.length;

          if (totalLines <= LINES_PER_PAGE) {
            allLines.forEach(line => term.writeln(line));
          } else {
            const totalPages = Math.ceil(totalLines / LINES_PER_PAGE);

            const renderPage = (page: number) => {
              const start = page * LINES_PER_PAGE;
              const end = Math.min(start + LINES_PER_PAGE, totalLines);
              const pageLines = allLines.slice(start, end);

              pageLines.forEach(line => term.writeln(line));

              if (end < totalLines) {
                const remaining = totalLines - end;
                const nextPage = page + 1;
                term.writeln('');
                term.writeln('\x1b[36m------------------------------------------------------------\x1b[0m');
                term.writeln(`\x1b[1;36m  Page ${nextPage}/${totalPages}  \x1b[0m|\x1b[33m  Lines ${start + 1}-${end} of ${totalLines}  \x1b[0m|\x1b[32m  ${remaining} more lines  \x1b[0m`);
                term.writeln('\x1b[36m------------------------------------------------------------\x1b[0m');
                term.writeln('\x1b[35m  [m]\x1b[0m Show more  |  \x1b[35m[a]\x1b[0m Show all  |  \x1b[35m[Enter]\x1b[0m Continue to prompt');
                term.writeln('\x1b[36m------------------------------------------------------------\x1b[0m');

                (term as any)._paginationState = {
                  allLines,
                  currentPage: nextPage,
                  totalPages,
                  totalLines,
                  LINES_PER_PAGE,
                  renderPage,
                  renderAll: () => {
                    const CHUNK_SIZE = 50;
                    let currentIdx = end;
                    (term as any)._renderingAll = true;

                    const renderChunk = () => {
                      if (currentIdx >= totalLines) {
                        term.writeln(`\x1b[36m-- End of output (${totalLines} total lines) --\x1b[0m`);
                        (term as any)._paginationState = null;
                        (term as any)._renderingAll = false;
                        return;
                      }

                      const chunkEnd = Math.min(currentIdx + CHUNK_SIZE, totalLines);
                      for (let i = currentIdx; i < chunkEnd; i++) {
                        term.writeln(allLines[i]);
                      }
                      currentIdx = chunkEnd;

                      if (currentIdx % 500 === 0 && currentIdx < totalLines) {
                        term.writeln(`\x1b[90m... rendered ${currentIdx}/${totalLines} lines (press q to stop) ...\x1b[0m`);
                      }

                      requestAnimationFrame(renderChunk);
                    };

                    term.writeln('');
                    term.writeln(`\x1b[32mRendering all ${totalLines - end} remaining lines...\x1b[0m`);
                    requestAnimationFrame(renderChunk);
                  },
                };
              } else {
                term.writeln(`\x1b[36m-- End of output (${totalLines} total lines) --\x1b[0m`);
                (term as any)._paginationState = null;
              }
            };

            renderPage(0);
          }
        }
      } catch (error) {
        term.writeln(`\x1b[31mError: ${error}\x1b[0m`);
      }
    }, []);

    const showPrompt = useCallback(() => {
      const term = terminalRef.current;
      const rz = rizinRef.current;
      if (term) {
        const addr = rz?.getCurrentAddress?.() || '0x00000000';
        term.write(`\x1b[1;33m[${addr}]>\x1b[0m `);
      }
    }, []);

    const renderInputLine = useCallback(() => {
      const term = terminalRef.current;
      if (!term) return;

      term.write('\x1b[2K\r');
      showPrompt();
      term.write(inputBuffer.current);

      const remaining = inputBuffer.current.length - cursorPos.current;
      if (remaining > 0) {
        term.write(`\x1b[${remaining}D`);
      }
    }, [showPrompt]);

    const updateAutocomplete = useCallback((force = false): TerminalAutocompleteState | null => {
      const rz = rizinRef.current;
      if (!rz) {
        hideAutocomplete();
        return null;
      }

      const fragmentLength = getAutocompleteFragmentLength(inputBuffer.current, cursorPos.current);
      if (!force && fragmentLength < terminalAutocompleteMinChars) {
        hideAutocomplete();
        return null;
      }

      const result = rz.getAutocomplete(inputBuffer.current, cursorPos.current, terminalAutocompleteMaxResults);
      if (!result || result.options.length === 0) {
        hideAutocomplete();
        return null;
      }

      const replacementStart = Math.max(0, Math.min(result.start, inputBuffer.current.length));
      const replacementEnd = Math.max(replacementStart, Math.min(result.end, inputBuffer.current.length));
      if (Object.keys(commandCatalogRef.current).length === 0) {
        commandCatalogRef.current = rz.getCommandCatalog?.() ?? {};
      }
      const suggestions = result.options.map(value => ({
        value,
        meta: commandCatalogRef.current[value],
      }));

      const nextState: TerminalAutocompleteState = {
        visible: true,
        suggestions,
        selectedIndex: Math.min(autocompleteRef.current.selectedIndex, Math.max(suggestions.length - 1, 0)),
        replacementStart,
        replacementEnd,
        endString: result.endString,
        manualSelection: false,
      };
      setAutocompleteView(nextState);
      return nextState;
    }, [
      hideAutocomplete,
      setAutocompleteView,
      terminalAutocompleteMaxResults,
      terminalAutocompleteMinChars,
    ]);

    const replaceAutocompleteText = useCallback((replacement: string, appendEndString: string) => {
      const state = autocompleteRef.current;
      const before = inputBuffer.current.slice(0, state.replacementStart);
      const after = inputBuffer.current.slice(state.replacementEnd);

      let nextInput = before + replacement + after;
      let nextCursor = before.length + replacement.length;
      if (appendEndString && state.replacementEnd === inputBuffer.current.length) {
        nextInput += appendEndString;
        nextCursor += appendEndString.length;
      }

      inputBuffer.current = nextInput;
      cursorPos.current = nextCursor;
      renderInputLine();
    }, [renderInputLine]);

    const acceptAutocomplete = useCallback((state?: TerminalAutocompleteState) => {
      const current = state ?? autocompleteRef.current;
      if (!current.visible || current.suggestions.length === 0) {
        return false;
      }

      const selectionIndex = Math.min(current.selectedIndex, current.suggestions.length - 1);
      const suggestion = current.suggestions[selectionIndex];
      if (!suggestion) {
        return false;
      }

      replaceAutocompleteText(suggestion.value, current.endString);
      hideAutocomplete();
      return true;
    }, [hideAutocomplete, replaceAutocompleteText]);

    const acceptAutocompleteIndex = useCallback((index: number) => {
      const state = autocompleteRef.current;
      if (!state.visible || index < 0 || index >= state.suggestions.length) {
        return false;
      }

      return acceptAutocomplete({
        ...state,
        selectedIndex: index,
        manualSelection: true,
      });
    }, [acceptAutocomplete]);

    const expandCommonPrefix = useCallback((state: TerminalAutocompleteState) => {
      const prefix = computeCommonPrefix(state.suggestions.map(suggestion => suggestion.value));
      const currentFragment = inputBuffer.current.slice(state.replacementStart, state.replacementEnd);
      if (!prefix || prefix.length <= currentFragment.length) {
        return false;
      }

      replaceAutocompleteText(prefix, '');
      return true;
    }, [replaceAutocompleteText]);

    const moveAutocompleteSelection = useCallback((delta: number) => {
      const state = autocompleteRef.current;
      if (!state.visible || state.suggestions.length === 0) {
        return false;
      }

      const nextIndex = Math.max(0, Math.min(state.selectedIndex + delta, state.suggestions.length - 1));
      if (nextIndex === state.selectedIndex && state.manualSelection) {
        return true;
      }

      setAutocompleteView({
        ...state,
        selectedIndex: nextIndex,
        manualSelection: true,
      });
      return true;
    }, [setAutocompleteView]);

    useImperativeHandle(ref, () => ({
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      searchAddon: searchAddonRef.current,
      sendInput: (input: string) => { void executeCommand(input); },
      search: (term: string) => { searchAddonRef.current?.findNext(term); },
      clearTerminal: () => { terminalRef.current?.clear(); },
      focus: () => { terminalRef.current?.focus(); },
    }));

    useEffect(() => {
      if (!containerRef.current || terminalRef.current) return;

      const term = new Terminal({
        cursorBlink: terminalCursorBlink,
        convertEol: true,
        scrollback: terminalScrollback,
        fontSize: terminalFontSize,
        fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
        theme: {
          background: '#0f172a',
          foreground: '#e2e8f0',
          cursor: '#38bdf8',
          cursorAccent: '#0f172a',
          selectionBackground: '#334155',
          black: '#1e293b',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#fca5a5',
          brightGreen: '#86efac',
          brightYellow: '#fde047',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      const clipboardAddon = new ClipboardAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
      term.loadAddon(clipboardAddon);
      term.loadAddon(webLinksAddon);

      term.open(containerRef.current);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => { webglAddon.dispose(); });
        term.loadAddon(webglAddon);
      } catch {
        // Ignore WebGL acceleration issues and keep the software renderer.
      }

      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      term.writeln('\x1b[1;36m============================================================\x1b[0m');
      term.writeln('\x1b[1;36m|\x1b[0m          \x1b[1;37mRzWeb - Rizin Web Interface\x1b[0m                      \x1b[1;36m|\x1b[0m');
      term.writeln('\x1b[1;36m|\x1b[0m          Browser-based reverse engineering                \x1b[1;36m|\x1b[0m');
      term.writeln('\x1b[1;36m============================================================\x1b[0m');
      term.writeln('');
      term.writeln('\x1b[33mWaiting for Rizin...\x1b[0m');

      onReady?.();

      const handleResize = () => {
        try {
          fitAddon.fit();
        } catch {
          // Ignore fit failures during transient layout changes.
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
        terminalRef.current = null;
      };
    }, [onReady, terminalCursorBlink, terminalFontSize, terminalScrollback]);

    useEffect(() => {
      const term = terminalRef.current;
      if (!term || !rizin) return;

      if (connectedRef.current === rizin) return;
      connectedRef.current = rizin;

      term.writeln('\x1b[32mConnected to Rizin!\x1b[0m');
      term.writeln(`\x1b[90mFile: ${rizin.currentFile?.name || 'unknown'}\x1b[0m`);

      const analysis = rizin.analysis;
      if (analysis) {
        term.writeln(`\x1b[90mFunctions: ${analysis.functions.length}, Strings: ${analysis.strings.length}\x1b[0m`);
      }

      term.writeln('\x1b[90mType commands. Try: "afl", "iz", "pdf @ main", "?"\x1b[0m');
      term.writeln('');

      showPrompt();

      const dataHandler = term.onData((data) => {
        const paginationState = (term as any)._paginationState;
        if (paginationState) {
          if (data === 'm' || data === 'M') {
            term.writeln('');
            paginationState.renderPage(paginationState.currentPage);
            return;
          }
          if (data === 'a' || data === 'A') {
            paginationState.renderAll();
            showPrompt();
            return;
          }
          if (data === '\r' || data === '\n') {
            (term as any)._paginationState = null;
            term.writeln('');
            showPrompt();
            return;
          }
          return;
        }

        if (data === '\x03') {
          hideAutocomplete();
          inputBuffer.current = '';
          cursorPos.current = 0;
          term.write('^C\r\n');
          showPrompt();
          return;
        }

        if (data === '\x1b' && autocompleteRef.current.visible) {
          hideAutocomplete();
          return;
        }

        if (data === '\r' || data === '\n') {
          if (autocompleteRef.current.visible && autocompleteRef.current.manualSelection) {
            if (acceptAutocomplete()) {
              return;
            }
          }

          hideAutocomplete();

          const command = inputBuffer.current.trim();
          term.write('\r\n');

          if (command) {
            addToHistoryRef.current(command);
            historyIndex.current = -1;
            void executeCommand(command).then(() => { showPrompt(); });
          } else {
            showPrompt();
          }

          inputBuffer.current = '';
          cursorPos.current = 0;
          return;
        }

        if (data === '\t') {
          if (autocompleteRef.current.visible) {
            if (acceptAutocomplete()) {
              return;
            }
          }

          const nextState = updateAutocomplete(true);
          if (!nextState) {
            return;
          }

          if (nextState.suggestions.length === 1) {
            void acceptAutocomplete(nextState);
            return;
          }

          if (expandCommonPrefix(nextState)) {
            void updateAutocomplete(true);
          }
          return;
        }

        if (data === '\x1b[A') {
          if (autocompleteRef.current.visible && moveAutocompleteSelection(-1)) {
            return;
          }

          hideAutocomplete();
          const history = commandHistoryRef.current;
          if (historyIndex.current < history.length - 1) {
            historyIndex.current++;
            const command = history[historyIndex.current] || '';
            inputBuffer.current = command;
            cursorPos.current = command.length;
            renderInputLine();
          }
          return;
        }

        if (data === '\x1b[B') {
          if (autocompleteRef.current.visible && moveAutocompleteSelection(1)) {
            return;
          }

          hideAutocomplete();
          const history = commandHistoryRef.current;
          if (historyIndex.current > 0) {
            historyIndex.current--;
            const command = history[historyIndex.current] || '';
            inputBuffer.current = command;
            cursorPos.current = command.length;
            renderInputLine();
          } else if (historyIndex.current === 0) {
            historyIndex.current = -1;
            inputBuffer.current = '';
            cursorPos.current = 0;
            renderInputLine();
          }
          return;
        }

        if (data === '\x1b[D') {
          if (cursorPos.current > 0) {
            cursorPos.current--;
            term.write('\x1b[D');
            void updateAutocomplete(false);
          }
          return;
        }

        if (data === '\x1b[C') {
          if (cursorPos.current < inputBuffer.current.length) {
            cursorPos.current++;
            term.write('\x1b[C');
            void updateAutocomplete(false);
          }
          return;
        }

        if (data === '\x1b[H' || data === '\x01') {
          if (cursorPos.current > 0) {
            term.write(`\x1b[${cursorPos.current}D`);
            cursorPos.current = 0;
            void updateAutocomplete(false);
          }
          return;
        }

        if (data === '\x1b[F' || data === '\x05') {
          const remaining = inputBuffer.current.length - cursorPos.current;
          if (remaining > 0) {
            term.write(`\x1b[${remaining}C`);
            cursorPos.current = inputBuffer.current.length;
            void updateAutocomplete(false);
          }
          return;
        }

        if (data === '\x7f' || data === '\b') {
          if (cursorPos.current > 0) {
            const before = inputBuffer.current.slice(0, cursorPos.current - 1);
            const after = inputBuffer.current.slice(cursorPos.current);
            inputBuffer.current = before + after;
            cursorPos.current--;
            term.write(`\b${after} \x1b[${after.length + 1}D`);
            void updateAutocomplete(false);
          }
          return;
        }

        if (data === '\x1b[3~') {
          if (cursorPos.current < inputBuffer.current.length) {
            const before = inputBuffer.current.slice(0, cursorPos.current);
            const after = inputBuffer.current.slice(cursorPos.current + 1);
            inputBuffer.current = before + after;
            term.write(`${after} \x1b[${after.length + 1}D`);
            void updateAutocomplete(false);
          }
          return;
        }

        if (data >= ' ') {
          const before = inputBuffer.current.slice(0, cursorPos.current);
          const after = inputBuffer.current.slice(cursorPos.current);
          inputBuffer.current = before + data + after;
          cursorPos.current += data.length;
          term.write(data + after);
          if (after.length > 0) {
            term.write(`\x1b[${after.length}D`);
          }
          void updateAutocomplete(false);
        }
      });

      return () => {
        dataHandler.dispose();
        connectedRef.current = null;
      };
    }, [
      acceptAutocomplete,
      executeCommand,
      expandCommonPrefix,
      hideAutocomplete,
      moveAutocompleteSelection,
      renderInputLine,
      rizin,
      showPrompt,
      updateAutocomplete,
    ]);

    useEffect(() => {
      if (fitAddonRef.current) {
        setTimeout(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            // Ignore fit errors while panels are settling.
          }
        }, 0);
      }
    }, [className]);

    return (
      <div className={cn('terminal-container relative h-full w-full', className)}>
        <div ref={containerRef} className="h-full w-full" />
        {autocompleteState.visible && (
          <div className="absolute bottom-3 left-3 z-10 max-w-[min(40rem,calc(100%-1.5rem))] overflow-hidden rounded-md border border-sky-500/30 bg-slate-950/95 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-slate-400">
              <span>Autocomplete</span>
              <span>{autocompleteState.suggestions.length} matches</span>
            </div>
            <div className="max-h-72 overflow-auto">
              {autocompleteState.suggestions.map((suggestion, index) => {
                const isSelected = index === autocompleteState.selectedIndex;
                return (
                    <div
                      key={`${suggestion.value}-${index}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void acceptAutocompleteIndex(index);
                      }}
                      className={cn(
                        'cursor-pointer border-b border-slate-900/80 px-3 py-2 font-mono last:border-b-0',
                        isSelected ? 'bg-sky-500/12' : 'bg-transparent'
                      )}
                    >
                    <div className="flex items-center justify-between gap-4">
                      <span className={cn('truncate text-sm', isSelected ? 'text-sky-200' : 'text-slate-100')}>
                        {suggestion.value}
                      </span>
                      {suggestion.meta?.args && (
                        <span className="truncate text-[10px] text-slate-500">
                          {suggestion.meta.args}
                        </span>
                      )}
                    </div>
                    {(suggestion.meta?.summary || suggestion.meta?.description) && (
                      <div className="mt-1 truncate text-[10px] text-slate-400">
                        {suggestion.meta.summary || suggestion.meta.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-slate-800 px-3 py-2 text-[10px] font-mono text-slate-500">
              Tab completes. Arrow keys browse. Enter accepts only after selection. The list shows up to your configured max.
            </div>
          </div>
        )}
      </div>
    );
  }
);

RizinTerminal.displayName = 'RizinTerminal';
