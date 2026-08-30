# RzWeb local MCP

This is the Node MCP server for RzWeb Contexts. It uses the same `rizin.js` / `rizin.wasm` pair as the browser app. Contexts live on disk under `~/.rzweb/contexts` (or `RZWEB_CONTEXT_DIR`).

Do not compile rizin-mcp to WASM. Point this server at a rzwasi dist.

Binaries stay on this machine. That is the local privacy path. Hosted MCP in `../hosted` is an upload.

## Setup

```bash
cd mcp
npm install
npm run build
```

Put `rizin.js` and `rizin.wasm` somewhere Node can read them. After you build rzwasi:

```bash
export RZWEB_WASM_DIR=/path/to/rzwasi/dist
node dist/index.js
```

Stdio is the default. Streamable HTTP:

```bash
node dist/index.js --http 8788
```

Write tools (`rename_function`, `set_comment`) stay off unless you pass `--allow-write`. Raw `command` stays off unless `--allow-raw`.

## Cursor

`~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rzweb": {
      "command": "node",
      "args": ["/absolute/path/to/rzweb/mcp/dist/index.js"],
      "env": {
        "RZWEB_WASM_DIR": "/absolute/path/to/rzwasi/dist"
      }
    }
  }
}
```

Create a context with `context_create` and a local binary path, then `analysis_start`, then `function_briefing`. Confirm a briefing without uploading anything.

## Tools

Lifecycle: `context_create`, `context_import`, `context_list`, `context_get`, `context_checkpoint`, `context_restore_revision`, `context_fork`, `context_close`, `context_export_bundle`.

Analysis: `analysis_start`, `analysis_status`, `analysis_cancel` (cancel is a notice here, because this process runs stages inside one tool call).

Read: `list_functions`, `list_strings`, `function_briefing`, `decompile`, `disasm`, `xrefs`, `binary_info`.

Prompts: `triage_binary`, `analyze_function`, `find_vulnerabilities`. They take `context_id`.

Stock WASM has no Ghidra. `decompile` tags the engine (`pdg` / `pdd` / `pdc` / `pseudo`).
