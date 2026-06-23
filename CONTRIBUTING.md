# Contributing to RzWeb

Thanks for your interest in improving RzWeb! This guide covers everything you
need to get a change merged.

## Quick links

- Community chat: [Telegram](https://telegram.dog/rizinweb)
- Bugs and ideas: [open an issue](https://github.com/IndAlok/rzweb/issues/new/choose)
- WebAssembly build: [rzwasi](https://github.com/IndAlok/rzwasi)

## Project layout

RzWeb is the React/TypeScript frontend. The Rizin reverse-engineering core is
compiled to WebAssembly in the companion [rzwasi](https://github.com/IndAlok/rzwasi)
repo and loaded at runtime from a CDN — there is no native code in this repo.

```
src/
  components/   UI + per-analysis views (disassembly, graph, hex, …)
  lib/rizin/    Worker, RPC protocol, session logic, project bundles
  stores/       Zustand stores (file, ui, settings, session, rizin)
  pages/        Home + Analysis routes
```

The Rizin WASM module runs in a Web Worker (`src/lib/rizin/rizin.worker.ts`);
the main thread talks to it through a typed RPC facade so the UI never blocks.

## Prerequisites

- **Node ≥ 20.19** (the repo pins **22.12** via `.nvmrc` / `.node-version`).
  If you use `nvm`/`fnm`/`asdf`, run `nvm use` (or equivalent) to match.

## Getting started

```bash
git clone https://github.com/IndAlok/rzweb
cd rzweb
npm install
npm run dev        # http://localhost:3000
```

## Before you open a PR

All three must pass — CI enforces them and the bar is **zero warnings**:

```bash
npm run lint        # eslint, 0 warnings
npm run typecheck   # tsc --noEmit
npm run build       # tsc -b && vite build
```

Please also:

- **Manually verify** UI changes in the running app (`npm run dev`).
- Keep diffs focused; avoid unrelated churn.
- No dead code, no leaked listeners/observers/object URLs, no `any`.
- Match the surrounding code style (naming, comment density, idioms).

## Commit & PR conventions

- Write clear, imperative commit subjects (e.g. `Fix hex view scroll sync`).
- Reference issues you close (`Closes #123`).
- Fill out the PR template checklist.

## Reporting security issues

Please do **not** file public issues for vulnerabilities — see
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the same
license as this repository (see [LICENSE](LICENSE)).
