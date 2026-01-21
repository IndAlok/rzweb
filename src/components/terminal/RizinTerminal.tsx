import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { useSettingsStore, useSessionStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { RizinInstance } from '@/lib/rizin';

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

export const RizinTerminal = forwardRef<RizinTerminalRef, RizinTerminalProps>(
  ({ rizin, className, onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const connectedRef = useRef<RizinInstance | null>(null);
    const inputBuffer = useRef('');
    const cursorPos = useRef(0);  // Track cursor position within buffer
    const historyIndex = useRef(-1);
    
    const { terminalFontSize, terminalScrollback, terminalCursorBlink } = useSettingsStore();
    const { addToHistory, commandHistory } = useSessionStore();
    
    const addToHistoryRef = useRef(addToHistory);
    const commandHistoryRef = useRef(commandHistory);
    const rizinRef = useRef(rizin);
    
    useEffect(() => {
      addToHistoryRef.current = addToHistory;
      commandHistoryRef.current = commandHistory;
      rizinRef.current = rizin;
    }, [addToHistory, commandHistory, rizin]);

    const executeCommand = useCallback(async (command: string) => {
      const term = terminalRef.current;
      const rz = rizinRef.current;
      if (!term || !rz) return;
      
      try {
        const result = await rz.executeCommand(command);
        const stderr = rz.getLastStderr();
        
        // Show stderr first (warnings, errors, command help) in yellow
        if (stderr && stderr.trim()) {
          // Filter out repetitive warnings to reduce noise
          const stderrLines = stderr.split('\n').filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            // Skip repetitive warnings but keep ERROR messages and command help
            if (trimmed.includes('Neither hash nor gnu_hash')) return false;
            if (trimmed.includes('rz_config_node_desc: assertion')) return false;
            return true;
          });
          stderrLines.forEach(line => {
            if (line.startsWith('ERROR:')) {
              term.writeln(`\x1b[31m${line}\x1b[0m`);  // Red for errors
            } else if (line.startsWith('Usage:') || line.startsWith('|')) {
              term.writeln(`\x1b[36m${line}\x1b[0m`);  // Cyan for help
            } else {
              term.writeln(`\x1b[33m${line}\x1b[0m`);  // Yellow for warnings
            }
          });
        }
        
        // Show stdout
        if (result && result.trim()) {
          const lines = result.split('\n');
          lines.forEach(line => {
            term.writeln(line);
          });
        }
      } catch (e) {
        term.writeln(`\x1b[31mError: ${e}\x1b[0m`);
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

    useImperativeHandle(ref, () => ({
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      searchAddon: searchAddonRef.current,
      sendInput: (input: string) => {
        executeCommand(input);
      },
      search: (term: string) => {
        searchAddonRef.current?.findNext(term);
      },
      clearTerminal: () => {
        terminalRef.current?.clear();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
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
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        term.loadAddon(webglAddon);
      } catch {}

      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      term.writeln('\x1b[1;36m╔════════════════════════════════════════════════════════════╗\x1b[0m');
      term.writeln('\x1b[1;36m║\x1b[0m          \x1b[1;37mRzWeb - Rizin Web Interface\x1b[0m                      \x1b[1;36m║\x1b[0m');
      term.writeln('\x1b[1;36m║\x1b[0m          Browser-based reverse engineering                \x1b[1;36m║\x1b[0m');
      term.writeln('\x1b[1;36m╚════════════════════════════════════════════════════════════╝\x1b[0m');
      term.writeln('');
      term.writeln('\x1b[33mWaiting for Rizin...\x1b[0m');

      onReady?.();

      const handleResize = () => {
        try {
          fitAddon.fit();
        } catch {}
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
        terminalRef.current = null;
      };
    }, [terminalFontSize, terminalScrollback, terminalCursorBlink, onReady]);

    useEffect(() => {
      const term = terminalRef.current;
      if (!term || !rizin) return;
      
      if (connectedRef.current === rizin) {
        return;
      }
      connectedRef.current = rizin;
      
      term.writeln('\x1b[32mConnected to Rizin!\x1b[0m');
      term.writeln('\x1b[90mFile: ' + (rizin.currentFile?.name || 'unknown') + '\x1b[0m');
      
      const analysis = rizin.analysis;
      if (analysis) {
        term.writeln(`\x1b[90mFunctions: ${analysis.functions.length}, Strings: ${analysis.strings.length}\x1b[0m`);
      }
      
      term.writeln('\x1b[90mType commands. Try: "afl", "iz", "pdf @ main", "?"\x1b[0m');
      term.writeln('');
      
      showPrompt();

      const dataHandler = term.onData((data) => {
        if (data === '\x03') {
          inputBuffer.current = '';
          term.write('^C\r\n');
          showPrompt();
          return;
        }

        if (data === '\r' || data === '\n') {
          const command = inputBuffer.current.trim();
          term.write('\r\n');
          
          if (command) {
            addToHistoryRef.current(command);
            historyIndex.current = -1;
            executeCommand(command).then(() => {
              showPrompt();
            });
          } else {
            showPrompt();
          }
          
          inputBuffer.current = '';
          cursorPos.current = 0;
          return;
        }

        if (data === '\x1b[A') {
          const history = commandHistoryRef.current;
          if (historyIndex.current < history.length - 1) {
            historyIndex.current++;
            const cmd = history[historyIndex.current] || '';
            term.write('\x1b[2K\r');
            showPrompt();
            term.write(cmd);
            inputBuffer.current = cmd;
            cursorPos.current = cmd.length;  // Cursor at end
          }
          return;
        }

        if (data === '\x1b[B') {
          const history = commandHistoryRef.current;
          if (historyIndex.current > 0) {
            historyIndex.current--;
            const cmd = history[historyIndex.current] || '';
            term.write('\x1b[2K\r');
            showPrompt();
            term.write(cmd);
            inputBuffer.current = cmd;
            cursorPos.current = cmd.length;  // Cursor at end
          } else if (historyIndex.current === 0) {
            historyIndex.current = -1;
            term.write('\x1b[2K\r');
            showPrompt();
            inputBuffer.current = '';
            cursorPos.current = 0;
          }
          return;
        }

        // Left arrow - move cursor left
        if (data === '\x1b[D') {
          if (cursorPos.current > 0) {
            cursorPos.current--;
            term.write('\x1b[D');  // Move cursor left
          }
          return;
        }

        // Right arrow - move cursor right
        if (data === '\x1b[C') {
          if (cursorPos.current < inputBuffer.current.length) {
            cursorPos.current++;
            term.write('\x1b[C');  // Move cursor right
          }
          return;
        }

        // Home key (or Ctrl+A) - move to start
        if (data === '\x1b[H' || data === '\x01') {
          if (cursorPos.current > 0) {
            term.write(`\x1b[${cursorPos.current}D`);  // Move cursor left by N
            cursorPos.current = 0;
          }
          return;
        }

        // End key (or Ctrl+E) - move to end
        if (data === '\x1b[F' || data === '\x05') {
          const remaining = inputBuffer.current.length - cursorPos.current;
          if (remaining > 0) {
            term.write(`\x1b[${remaining}C`);  // Move cursor right by N
            cursorPos.current = inputBuffer.current.length;
          }
          return;
        }

        // Backspace - delete char before cursor
        if (data === '\x7f' || data === '\b') {
          if (cursorPos.current > 0) {
            const before = inputBuffer.current.substring(0, cursorPos.current - 1);
            const after = inputBuffer.current.substring(cursorPos.current);
            inputBuffer.current = before + after;
            cursorPos.current--;
            // Redraw from cursor: move back, write rest + space, move back
            term.write('\b' + after + ' ' + '\x1b[' + (after.length + 1) + 'D');
          }
          return;
        }

        // Delete key - delete char at cursor
        if (data === '\x1b[3~') {
          if (cursorPos.current < inputBuffer.current.length) {
            const before = inputBuffer.current.substring(0, cursorPos.current);
            const after = inputBuffer.current.substring(cursorPos.current + 1);
            inputBuffer.current = before + after;
            term.write(after + ' ' + '\x1b[' + (after.length + 1) + 'D');
          }
          return;
        }

        if (data === '\t') {
          return;
        }

        // Regular character - insert at cursor position
        if (data >= ' ') {
          const before = inputBuffer.current.substring(0, cursorPos.current);
          const after = inputBuffer.current.substring(cursorPos.current);
          inputBuffer.current = before + data + after;
          cursorPos.current++;
          // Write char + rest of line, then move cursor back
          term.write(data + after);
          if (after.length > 0) {
            term.write(`\x1b[${after.length}D`);
          }
        }
      });

      return () => {
        dataHandler.dispose();
        connectedRef.current = null;
      };
    }, [rizin, executeCommand, showPrompt]);

    useEffect(() => {
      if (fitAddonRef.current) {
        setTimeout(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {}
        }, 0);
      }
    }, [className]);

    return (
      <div
        ref={containerRef}
        className={cn('terminal-container', className)}
      />
    );
  }
);

RizinTerminal.displayName = 'RizinTerminal';
