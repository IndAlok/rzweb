# RzWeb

A complete browser-based reverse engineering platform built on Rizin, running entirely client-side via WebAssembly.

## Key Features

**Full Rizin Terminal**  
Complete CLI access - run any Rizin command directly in your browser. Seek, disassemble, analyze, patch - everything works.

**Interactive Disassembly**  
Syntax-highlighted disassembly view with jump navigation, cross-references, and real-time address tracking.

**Control Flow Graphs**  
Visual function graphs rendered with Cytoscape. See basic blocks, branches, and call relationships at a glance.

**Hex Editor**  
Browse and inspect raw bytes. Navigate to any offset, view multiple formats.

**String Analysis**  
Find all embedded strings - ASCII, UTF-8, wide strings. Quick search and filter.

**Binary Patching**  
Modify bytes directly via terminal commands. Export patched binaries.

**100% Private**  
Files never leave your device. No uploads, no server processing. Everything runs locally in WASM.

**Offline Capable**  
Cache the WASM module for offline use. Analyze binaries without internet.

## Supported Formats

- ELF (Linux executables/libraries)
- PE/PE+ (Windows executables/DLLs)
- Mach-O (macOS/iOS binaries)
- Raw binaries
- Firmware images
- And more via Rizin's format support

## Usage

1. Go to [rzweb-cm6.pages.dev](https://rzweb-cm6.pages.dev)
2. Drop any binary file
3. Click **Analyze**


## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
├─────────────────────────────────────────────────┤
│  RzWeb (React + TypeScript + Tailwind)          │
│  ├── Terminal (xterm.js)                        │
│  ├── Views (Disasm, Graph, Hex, Strings)        │
│  └── State (Zustand)                            │
├─────────────────────────────────────────────────┤
│  Rizin WASM (via Emscripten)                    │
│  └── Full Rizin core compiled to WebAssembly    │
└─────────────────────────────────────────────────┘
```

## Current Limitations

- **Stateless CLI**: Each command runs as fresh process - seek doesn't persist between commands. Use `s <addr>;pdf` syntax.
- **Single-threaded**: WASM runs single-threaded, large file analysis takes time.
- **No debugger**: ptrace not available in browser.
- **1MB auto-analysis limit**: Larger files skip auto-analysis to prevent browser hangs.

## Development

```bash
git clone https://github.com/IndAlok/rzweb
cd rzweb
npm install
npm run dev
```

## Credits

Built by [IndAlok](https://github.com/IndAlok)

Powered by [Rizin](https://rizin.re) - the open-source reverse engineering framework.
