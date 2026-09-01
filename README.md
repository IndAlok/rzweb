# RzWeb

<p align="center">
  <a href="https://telegram.dog/rizinweb">
    <img src="https://img.shields.io/badge/Telegram-Join%20the%20community-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Support & Discussion">
  </a>
</p>

RzWeb is a browser UI for [Rizin](https://rizin.re) compiled to WebAssembly. You drop a binary in. Analysis stays on this machine. Rizin runs in a Web Worker so the page does not freeze while WASM loads. `aaa` still owns that worker until the command returns.

Each open binary is a context. Artifact bytes, a current `.rzdb`, and a short revision history live in IndexedDB. Home can resume a hash or start a new context on the same file. One tab is one worker. Close the tab and that core dies.

The WASM build comes from [rzwasi](https://github.com/IndAlok/rzwasi). Stock Pages WASM has no jsdec or rz-ghidra. Decompiler view uses `pdg`, `pdd`, or `pdc` when the build ships one, otherwise `pdf` with `asm.pseudo`.

An MCP server lives in [`mcp/`](mcp/). Same wasm, contexts on disk. Point any MCP client at it. See that folder.

## Screenshots

**Homepage**

![Homepage](public/Homepage.png)

**Terminal**

![Terminal](public/Terminal.png)

**Disassembly**

![Disassembly](public/Disassembly.png)

**Decompiler**

![Decompiler](public/Decompiler.png)

**Cross-references**

![Cross-references](public/Xrefs.png)

**Control flow graph**

![Graph](public/Graph.png)

**Hex dump**

![Hex Dump](public/HexDump.png)

**Strings**

![Strings](public/Strings.png)

**Imports**

![Imports](public/Imports.png)

**Exports**

![Exports](public/Exports.png)

**Sections**

![Sections](public/Sections.png)

**Binary info**

![Binary Info](public/BinInfo.png)

## What is in the app

- Tabs, each with its own worker
- Terminal with catalog autocomplete
- Disassembly, decompiler, xrefs, CFG, hex, strings, imports, exports, sections, bin info
- Scripts view (rizin cmd or JS with a sync `rz` API)
- Themes. Terminal and graph follow the active one
- Palette (`Ctrl`/`Cmd`+`K`) and view shortcuts (`Alt`+`1`..`9`)
- Snapshot, history, and `RZWEBPRJ` export that embeds the binary
- Hex and write-mode patches, then save the file

Formats are whatever the bundled Rizin build opens. ELF, PE, Mach-O, raw dumps.

## How it works

1. Open the app.
2. Drop a binary. Resume the old context or start a new one.
3. The worker mounts the file. Analysis runs as a job on that tab.
4. Snapshot or export `RZWEBPRJ` when you want a copy. History applies an older `.rzdb` onto the open file.

Files stay on the device. WebAssembly memory and IndexedDB only. Nothing is uploaded.

## Limits

- No `ptrace` in the browser.
- One `RzCore` per live context. That worker cannot take other commands until `aaa` returns.
- Cancel works between stages (`aa` then `aaa`/`aaaa`). Not mid-command.
- Restore needs `rzweb_apply_project` in the wasm you load. Older dists fall back to `Po` and show a notice.
- jsdec is an opt-in rzwasi build. Point `VITE_WASM_BASE_URL` at that dist. Do not make it the default Pages build.

## Manual checks

Vitest cannot load `rizin.wasm`. After a wasm publish, click through:

- Two tabs. Rename in A, switch to B and back. The rename is still in A.
- Cold `RZWEBPRJ` from Home.
- Restore an older snapshot from history.
- Depth 2 job banner. Cancel between `aa` and `aaa`.
- Missing `rzweb_apply_project` shows the apply-project notice.

## Run it locally

Node 20.19+ or 22.12+. Ubuntu apt `nodejs` is 18. Vite then dies with `crypto.hash is not a function`. The repo pins 22 in `.nvmrc`.

If `node -v` still prints v18:

```bash
mkdir -p "$HOME/.local"
curl -fsSL https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz -o /tmp/node22.tar.xz
tar -xJf /tmp/node22.tar.xz -C "$HOME/.local"
ln -sfn "$HOME/.local/node-v22.23.2-linux-x64" "$HOME/.local/node"
export PATH="$HOME/.local/node/bin:$PATH"
```

Put that `export` in `~/.bashrc` so new terminals keep it.

```bash
cd rzweb
node -v
npm install
npm run dev
```

`node -v` must print v22. Open http://localhost:3000. Default wasm is the GitHub Pages rzwasi build. Leave `VITE_WASM_BASE_URL` unset unless you are testing a local dist.

## Community

[Telegram](https://telegram.dog/rizinweb)

Built by [IndAlok](https://github.com/IndAlok). Powered by [Rizin](https://rizin.re).
