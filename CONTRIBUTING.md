# Contributing

Telegram chat is [here](https://telegram.dog/rizinweb). Bugs and ideas go on [GitHub issues](https://github.com/IndAlok/rzweb/issues/new/choose). The wasm build lives in [rzwasi](https://github.com/IndAlok/rzwasi).

## Layout

This repo is the React frontend. Rizin is compiled to WebAssembly in rzwasi and loaded at runtime. There is no native code here.

```
src/
  components/   disassembly, graph, hex views
  lib/rizin/    worker, RPC, session, project bundles
  stores/       Zustand stores
  pages/        Home and Analysis
```

The wasm module runs in `src/lib/rizin/rizin.worker.ts`. The main thread talks to it through a typed RPC facade so the UI does not block.

## Node

20.19 or newer. The repo pins 22.12 in `.nvmrc` and `.node-version`. Ubuntu apt Node 18 will not start Vite. See the root README.

```bash
git clone https://github.com/IndAlok/rzweb
cd rzweb
npm install
npm run dev
```

http://localhost:3000

## Before a PR

CI wants zero warnings.

```bash
npm run lint
npm run typecheck
npm run build
```

Click through UI changes in the running app. Keep the diff to the thing you came to change. No dead code, no leaked listeners, no `any`. Match the surrounding style.

## Commits and PRs

Imperative subjects. `Fix hex view scroll sync` is the shape. Close issues with `Closes #123`. Fill the PR template.

## Security

Do not file public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

Patches use the same license as the repo. See [LICENSE](LICENSE).
