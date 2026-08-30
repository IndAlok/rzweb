# RzWeb local MCP

Node MCP server for RzWeb Contexts. Same `rizin.js` / `rizin.wasm` pair as the browser app. Contexts live on disk under `~/.rzweb/contexts` (or `RZWEB_CONTEXT_DIR`).

Do not compile rizin-mcp to WASM. Point this server at a rzwasi dist.

Binaries stay on this machine. That is the privacy path. `../hosted` is an upload sketch and is not part of the free deploy.

This server speaks stock MCP over stdio (default) or streamable HTTP. It is not tied to any one editor.

## Setup

Needs Node 20.19+ or 22.12+. Ubuntu apt Node 18 is too old.

```bash
cd mcp
npm install
npm run build
```

Put `rizin.js` and `rizin.wasm` somewhere Node can read them. Published pair:

```bash
mkdir -p "$HOME/rzwasi-dist"
curl -fsSL -o "$HOME/rzwasi-dist/rizin.js" https://indalok.github.io/rzwasi/rizin.js
curl -fsSL -o "$HOME/rzwasi-dist/rizin.wasm" https://indalok.github.io/rzwasi/rizin.wasm
export RZWEB_WASM_DIR="$HOME/rzwasi-dist"
node dist/index.js
```

Or, after you build rzwasi yourself, set `RZWEB_WASM_DIR` to that `dist/`.

Stdio is the default. Streamable HTTP:

```bash
node dist/index.js --http 8788
```

Write tools (`rename_function`, `set_comment`) stay off unless you pass `--allow-write`. Raw `command` stays off unless `--allow-raw`.

## Agent (Antigravity CLI)

Google AI Pro no longer serves the old `gemini` CLI. Use [Antigravity CLI](https://www.antigravity.google/docs/cli/install/) and sign in with the same Google account.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
# new shell so ~/.local/bin is on PATH
agy
```

First launch opens a browser. Sign in. Then add a workspace MCP profile. Copy `../.agents/mcp_config.json.example` to `.agents/mcp_config.json` at the repo root and fix the two paths:

```json
{
  "mcpServers": {
    "rzweb": {
      "command": "node",
      "args": ["/absolute/path/to/rzweb/mcp/dist/index.js"],
      "env": {
        "RZWEB_WASM_DIR": "/absolute/path/to/rzwasi-dist"
      }
    }
  }
}
```

`node` here must be 20.19+ (the nvm one, not `/usr/bin/node`). If `agy` cannot find it, put the full nvm binary path in `command`.

Global equivalent: `~/.gemini/config/mcp_config.json` with the same object.

Create a context with `context_create` and a local binary path, then `analysis_start`, then `function_briefing`. Confirm a briefing without uploading anything.

Do not buy a Gemini API key for day to day work. AI Pro login on `agy` is the quota you already pay for. An AI Studio key is a last resort for headless CI and it burns the free API cap fast.

## Tools

Lifecycle: `context_create`, `context_import`, `context_list`, `context_get`, `context_checkpoint`, `context_restore_revision`, `context_fork`, `context_close`, `context_export_bundle`.

Analysis: `analysis_start`, `analysis_status`, `analysis_cancel` (cancel is a notice here, because this process runs stages inside one tool call).

Read: `list_functions`, `list_strings`, `function_briefing`, `decompile`, `disasm`, `xrefs`, `binary_info`.

Prompts: `triage_binary`, `analyze_function`, `find_vulnerabilities`. They take `context_id`.

Stock WASM has no Ghidra. `decompile` tags the engine (`pdg` / `pdd` / `pdc` / `pseudo`).
