import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FileCode2, Copy, Check } from 'lucide-react';
import type { RizinInstance } from '@/lib/rizin';

interface DecompilerViewProps {
  rizin: RizinInstance;
  address: number;
  functionName?: string | null;
  className?: string;
}

const KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'return', 'goto', 'break', 'continue', 'switch', 'case', 'default',
  'do', 'sizeof', 'struct', 'union', 'enum', 'typedef', 'const', 'static', 'extern', 'void', 'int',
  'char', 'long', 'short', 'unsigned', 'signed', 'float', 'double', 'bool', 'volatile', 'register',
]);

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(0[xX][0-9a-fA-F]+|\b\d+\b)|([A-Za-z_]\w*)|(\s+)|([^\sA-Za-z_]+)/g;

// Token highlighter; React escapes each span's text, so this stays injection-safe.
function highlightLine(line: string, lineKey: number): ReactNode[] {
  const parts: ReactNode[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let token = 0;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    const [text, comment, str, num, ident, ws] = match;
    if (ws) {
      parts.push(text);
    } else if (comment) {
      parts.push(<span key={`${lineKey}-${token}`} className="italic text-muted-foreground">{text}</span>);
    } else if (str) {
      parts.push(<span key={`${lineKey}-${token}`} className="text-emerald-400">{text}</span>);
    } else if (num) {
      parts.push(<span key={`${lineKey}-${token}`} className="text-amber-400">{text}</span>);
    } else if (ident && KEYWORDS.has(ident)) {
      parts.push(<span key={`${lineKey}-${token}`} className="text-purple-400">{text}</span>);
    } else {
      parts.push(text);
    }
    token++;
  }
  return parts;
}

export function DecompilerView({ rizin, address, functionName, className }: DecompilerViewProps) {
  const [code, setCode] = useState('');
  const [pseudo, setPseudo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestRef = useRef(0);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (address <= 0) {
      setCode('');
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    rizin
      .getDecompilation(address)
      .then((result) => {
        if (requestId !== requestRef.current) return;
        setCode(result.code.trim());
        setPseudo(result.pseudo);
      })
      .catch(() => {
        if (requestId === requestRef.current) setCode('');
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
  }, [rizin, address]);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const handleCopy = useCallback(() => {
    if (!code || !navigator.clipboard) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  if (address <= 0) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 text-muted-foreground', className)}>
        <FileCode2 className="h-12 w-12 opacity-30" />
        <p className="text-sm">Select a function to decompile it.</p>
      </div>
    );
  }

  const lines = code ? code.split('\n') : [];

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">
          {pseudo ? 'Pseudocode' : 'Decompiler'}{functionName ? ` - ${functionName}` : ''}
        </span>
        {pseudo && code ? (
          <span
            title="This build has no decompiler plugin (jsdec or rz-ghidra). Showing Rizin pseudo-disassembly instead."
            className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Pseudo
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleCopy}
          disabled={!code}
          title="Copy decompiled code"
          className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-[#0f172a]">
        {loading && lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Decompiling...</div>
        ) : lines.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No output available for this function.
          </div>
        ) : (
          <pre className="min-w-max p-3 font-mono text-xs leading-relaxed text-slate-200">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="mr-4 w-8 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
                <span className="whitespace-pre">{highlightLine(line, i)}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
