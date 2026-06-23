import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { cssVarHex } from '@/lib/utils';
import type { RizinCommandHelpEntry } from '@/lib/rizin';

export type ScriptLanguage = 'rz' | 'js';

export function languageOf(name: string): ScriptLanguage {
  return name.trim().toLowerCase().endsWith('.js') ? 'js' : 'rz';
}

// Lightweight highlighter for rizin cmd scripts: comments, cmd words,
// addrs, operators (@ seek, ~ grep, | pipe), strs, and $vars.
const rizinStream = StreamLanguage.define<{ start: boolean }>({
  startState: () => ({ start: true }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (state.start && stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    const atStart = state.start;
    state.start = false;
    if (stream.match(/^0x[0-9a-fA-F]+/)) return 'number';
    if (stream.match(/^\$[a-zA-Z0-9_]+/)) return 'variableName';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^;/)) {
      state.start = true;
      return 'operator';
    }
    if (stream.match(/^(@@|@|~|\||>|<)/)) return 'operator';
    if (atStart && stream.match(/^[a-zA-Z._?!/\\][a-zA-Z0-9._?!]*/)) return 'keyword';
    if (stream.match(/^[a-zA-Z._][a-zA-Z0-9._]*/)) return 'atom';
    if (stream.match(/^\d+/)) return 'number';
    stream.next();
    return null;
  },
});

export function languageExtension(language: ScriptLanguage): Extension {
  return language === 'js' ? javascript() : rizinStream;
}

// always matches app theme.
export function editorTheme(dark: boolean): Extension {
  const highlight = HighlightStyle.define([
    { tag: t.comment, color: cssVarHex('--code-comment'), fontStyle: 'italic' },
    { tag: [t.keyword, t.operatorKeyword], color: cssVarHex('--code-keyword') },
    { tag: [t.string, t.special(t.string)], color: cssVarHex('--code-string') },
    { tag: [t.number, t.bool, t.null], color: cssVarHex('--code-number') },
    { tag: [t.operator, t.punctuation], color: cssVarHex('--code-operator') },
    { tag: [t.variableName, t.propertyName], color: cssVarHex('--code-function') },
    { tag: [t.function(t.variableName), t.definition(t.variableName)], color: cssVarHex('--code-function') },
    { tag: [t.atom, t.labelName], color: cssVarHex('--code-register') },
    { tag: [t.typeName, t.className, t.tagName], color: cssVarHex('--code-register') },
  ]);

  const view = EditorView.theme(
    {
      '&': { backgroundColor: cssVarHex('--background'), color: cssVarHex('--foreground'), height: '100%' },
      '.cm-content': { fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace', caretColor: cssVarHex('--primary') },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: cssVarHex('--primary') },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: cssVarHex('--accent'),
      },
      '.cm-gutters': { backgroundColor: cssVarHex('--muted'), color: cssVarHex('--muted-foreground'), border: 'none' },
      '.cm-activeLineGutter': { backgroundColor: cssVarHex('--accent') },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-tooltip': {
        backgroundColor: cssVarHex('--popover'),
        color: cssVarHex('--popover-foreground'),
        border: `1px solid ${cssVarHex('--border')}`,
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: cssVarHex('--primary'),
        color: cssVarHex('--primary-foreground'),
      },
    },
    { dark }
  );

  return [view, syntaxHighlighting(highlight)];
}

const RZ_API: Completion[] = [
  { label: 'rz.cmd', type: 'method', detail: '(cmd)', info: 'Run a rizin command, returns its string output' },
  { label: 'rz.cmdj', type: 'method', detail: '(cmd)', info: 'Run a command and JSON.parse its output' },
  { label: 'rz.call', type: 'method', detail: '(cmd)', info: 'Run a command without shell parsing' },
  { label: 'rz.callj', type: 'method', detail: '(cmd)', info: 'Like cmdj, using call' },
  { label: 'rz.cmdAt', type: 'method', detail: '(cmd, at)', info: 'Run a command at an address' },
  { label: 'rz.log', type: 'method', detail: '(...args)', info: 'Print to the output console' },
];

function jsCompletion(context: CompletionContext): CompletionResult | null {
  const dotted = context.matchBefore(/rz\.\w*/);
  if (dotted) {
    return { from: dotted.from, options: RZ_API, validFor: /^rz\.\w*$/ };
  }
  const word = context.matchBefore(/\w+/);
  if (word && word.from !== word.to && /^r/i.test(word.text)) {
    return { from: word.from, options: [{ label: 'rz', type: 'variable', info: 'Synchronous rizin command API' }], validFor: /^\w*$/ };
  }
  return null;
}

// Autocomplete: JS rz API (what we alr used).
export function completionSource(language: ScriptLanguage, catalog: Record<string, RizinCommandHelpEntry>, minChars: number) {
  if (language === 'js') {
    return jsCompletion;
  }
  const options: Completion[] = Object.values(catalog)
    .filter((entry) => entry.name)
    .map((entry) => ({ label: entry.name, type: 'keyword', detail: entry.summary, info: entry.description || entry.args }));
  const floor = Math.max(1, minChars);
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[a-zA-Z._?!/\\][\w._?!]*/);
    if (!word) return null;
    if (!context.explicit && word.to - word.from < floor) return null;
    return { from: word.from, options, validFor: /^[\w._?!/\\]*$/ };
  };
}
