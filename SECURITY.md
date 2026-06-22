# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue.

- Use [GitHub private vulnerability reporting](https://github.com/IndAlok/rzweb/security/advisories/new), or
- Reach a maintainer via the [Telegram community](https://telegram.dog/rizinweb).

We aim to acknowledge reports within a few days and will keep you updated on a
fix and disclosure timeline.

## Scope

RzWeb runs entirely in the browser: binaries are loaded into WebAssembly memory
and browser storage (IndexedDB) and are **never uploaded to a server**.
Security-relevant areas include:

- The Rizin WASM sandbox boundary (see [rzwasi](https://github.com/IndAlok/rzwasi)).
- Cross-Origin-Isolation headers (COOP/COEP) required for the WASM runtime.
- Handling of untrusted binaries and project (`.rzdb`) files.

## Supported versions

This is an actively developed project, fixes are done on `main` and are deployed
continuously. Please test against the latest `main` before reporting.
