# RzWeb

A browser-based reverse engineering platform that runs Rizin entirely in your browser through WebAssembly. No installations, no uploads, no servers - just drop a binary and start analyzing.

## Screenshots

**Homepage** - Drop a binary and start analyzing

![Homepage](public/Homepage.png)

**Terminal** - Full Rizin CLI access

![Terminal](public/Terminal.png)

**Disassembly** - Syntax-highlighted assembly view

![Disassembly](public/Disassembly.png)

**Control Flow Graph** - Visual function structure

![Graph](public/Graph.png)

**Hex Dump** - Raw byte inspection

![Hex Dump](public/HexDump.png)

**Strings** - Extracted strings from the binary

![Strings](public/Strings.png)

## What It Does

RzWeb brings the full power of Rizin to your browser. You get a complete terminal where you can run any Rizin command, plus dedicated views for disassembly, control flow graphs, hex dumps, and strings. Everything processes locally on your machine - your files never leave your device.

### Terminal

The integrated terminal gives you direct access to Rizin's CLI. Run `pdf` to disassemble a function, `afl` to list all functions, `px` to dump hex, or any other command you would use in a normal Rizin session. Commands can be chained with semicolons like `s main;pdf`.

### Disassembly

Syntax-highlighted assembly with address navigation. Click on addresses to jump around, see cross-references, and track your current position in the binary.

### Control Flow Graphs

Visual representation of function structure. See how basic blocks connect, identify loops, and understand the control flow at a glance.

### Hex View

Raw byte inspection. Navigate to any offset and examine the binary data directly.

### Strings

Automatically extracted strings from the binary. Useful for finding hardcoded paths, error messages, encryption keys, and other interesting data.

## Supported Formats

RzWeb supports everything Rizin supports:

- **ELF** - Linux executables and shared libraries
- **PE/PE+** - Windows executables and DLLs
- **Mach-O** - macOS and iOS binaries
- **Raw** - Firmware, dumps, anything else

## How to Use

1. Visit the live deployment
2. Drop your binary file onto the page
3. Click Analyze
4. Use the terminal or switch between views

## Privacy

All analysis happens in your browser. The binary is loaded into WebAssembly memory and never sent anywhere. You can even cache the WASM module and use RzWeb offline.

## Limitations

These are inherent to running in a browser environment:

- **Stateless commands** - Each command runs as a fresh Rizin invocation. Use semicolons to chain commands that depend on each other, like `s 0x1000;pdf`.
- **Single-threaded** - WebAssembly is single-threaded, so analysis of large binaries takes time.
- **No debugger** - ptrace is not available in browsers.
- **Large files** - Files over 1MB skip auto-analysis to prevent browser hangs. You can run `aa` manually.

## Building Locally

```bash
git clone https://github.com/IndAlok/rzweb
cd rzweb
npm install
npm run dev
```

## Architecture

The frontend is React with TypeScript and Tailwind CSS. State management uses Zustand. The terminal is powered by xterm.js. Rizin is compiled to WebAssembly using Emscripten and loaded from the companion [rzwasi](https://github.com/IndAlok/rzwasi) repository.

## Credits

Built by [IndAlok](https://github.com/IndAlok)

Powered by [Rizin](https://rizin.re), the open-source reverse engineering framework. 
