import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedScript {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

interface ScriptState {
  scripts: SavedScript[];
  upsertScript: (name: string, content: string) => SavedScript;
  deleteScript: (id: string) => void;
}

const STARTER_SCRIPTS: SavedScript[] = [
  {
    id: 'starter-overview',
    name: 'overview.rz',
    content: '# Format, sections, and function count\ni\niS\nafl~?',
    updatedAt: 0,
  },
  {
    id: 'starter-strings',
    name: 'strings.rz',
    content: '# Quiet list of strings\nizzq',
    updatedAt: 0,
  },
  {
    id: 'starter-functions-js',
    name: 'list-functions.js',
    content:
      '// JavaScript with the synchronous rz API.\n' +
      'const fns = rz.cmdj("aflj") || [];\n' +
      'rz.log(`Functions: ${fns.length}`);\n' +
      'for (const f of fns.slice(0, 25)) {\n' +
      '  rz.log(`0x${f.offset.toString(16).padStart(8, "0")}  ${f.name}`);\n' +
      '}',
    updatedAt: 0,
  },
];

export const useScriptStore = create<ScriptState>()(
  persist(
    (set, get) => ({
      scripts: STARTER_SCRIPTS,

      upsertScript: (name, content) => {
        const trimmed = name.trim() || 'Untitled';
        const existing = get().scripts.find((s) => s.name === trimmed);
        const script: SavedScript = {
          id: existing?.id ?? crypto.randomUUID(),
          name: trimmed,
          content,
          updatedAt: Date.now(),
        };
        set((state) => ({
          scripts: existing
            ? state.scripts.map((s) => (s.id === existing.id ? script : s))
            : [script, ...state.scripts],
        }));
        return script;
      },

      deleteScript: (id) => set((state) => ({ scripts: state.scripts.filter((s) => s.id !== id) })),
    }),
    {
      name: 'rzweb-scripts',
      partialize: (state) => ({ scripts: state.scripts }),
    }
  )
);
