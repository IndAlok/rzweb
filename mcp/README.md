# RzWeb MCP

A local MCP server for RzWeb contexts. Same `rizin.js` and `rizin.wasm` as the browser app. Contexts live under `~/.rzweb/contexts` unless you set `RZWEB_CONTEXT_DIR`.

This is stock MCP. Stdio is the default. `--http` is there for clients that only take a URL. It is not tied to one editor.

Do not compile rizin-mcp to WASM. Point this process at a rzwasi dist.

The `hosted/` folder is a Cloudflare Worker sketch. Containers are paid. Do not deploy it.

## Build

Node 20.19 or 22.12 and newer. Ubuntu apt Node 18 is too old.

```bash
cd mcp
npm install
npm run build
```

You need a folder that contains both `rizin.js` and `rizin.wasm`. Published pair:

```bash
mkdir -p "$HOME/rzwasi-dist"
curl -fsSL -o "$HOME/rzwasi-dist/rizin.js" https://indalok.github.io/rzwasi/rizin.js
curl -fsSL -o "$HOME/rzwasi-dist/rizin.wasm" https://indalok.github.io/rzwasi/rizin.wasm
```

Or set `RZWEB_WASM_DIR` to a `dist/` you built yourself.

Smoke it from a terminal:

```bash
export RZWEB_WASM_DIR="$HOME/rzwasi-dist"
node dist/index.js
```

Stdio stays quiet until a client talks to it. That is normal.

## The server block

Copy [stdio.example.json](stdio.example.json) and fill the three absolute paths.

```json
{
  "mcpServers": {
    "rzweb": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/rzweb/mcp/dist/index.js"],
      "env": {
        "RZWEB_WASM_DIR": "/absolute/path/to/rzwasi-dist"
      }
    }
  }
}
```

`command` has to be a real Node 20.19+ or 22.12+ binary. GUI clients do not inherit your shell `PATH`. If you write `node` and the client finds apt Node 18, the server dies the same way Vite does.

On Windows use `node.exe`. Paths can use `/`. Do not paste a Unix home path.

Optional env:

- `RZWEB_CONTEXT_DIR` if you do not want `~/.rzweb/contexts`
- `RZWEB_ALLOW_WRITE=1` or put `--allow-write` in `args`
- `RZWEB_ALLOW_RAW=1` or put `--allow-raw` in `args`

Write tools and raw `command` stay off until you turn them on.

`analysis_start` can sit in `aaa` for minutes. If your client has a tool timeout field, raise it. Antigravity uses `timeout` in milliseconds. Default is 600000. A short timeout looks like a hang.

If you turn on a VS Code MCP sandbox, allow reads of the WASM dir and the context dir. Do not enable sandbox in the example.

## Where the block goes

Most clients wrap that object in `mcpServers` and drop it in their own file.

- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/.config/Claude/claude_desktop_config.json` on Linux
- Claude Code: project `.mcp.json`, or `claude mcp add`. HTTP uses `type` set to `http` or `streamable-http`, plus `url`
- Cursor: `~/.cursor/mcp.json` or project `.cursor/mcp.json`
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Cline: `cline_mcp_settings.json` under the VS Code globalStorage path for `saoudrizwan.claude-dev`
- Continue: put the JSON in `.continue/mcpServers/`
- Antigravity CLI: workspace `.agents/mcp_config.json` or `~/.gemini/config/mcp_config.json`. Remote URL field is `serverUrl`, not `url`

Two wrappers change the root key.

VS Code Copilot uses `servers` in `.vscode/mcp.json` or the user MCP config. Same `command`, `args`, and `env`. You can set `"type": "stdio"`.

Zed uses `context_servers` in its settings file. Same three fields.

Anyone else gets the block and the two rules. Absolute `node`. Absolute `RZWEB_WASM_DIR`.

## HTTP

Some clients will not spawn a process. They want a URL.

```bash
export RZWEB_WASM_DIR="$HOME/rzwasi-dist"
node dist/index.js --http 8788
```

That listens on `http://127.0.0.1:8788/mcp`. Point `url` or `serverUrl` at it. One process, one session. Fine for a single client on this machine.

## First calls

Create a context with `context_create` and a local binary path. Then `analysis_start` with that `context_id`. Then `function_briefing`. Nothing should leave the machine.

## Tools

Lifecycle: `context_create`, `context_import`, `context_list`, `context_get`, `context_checkpoint`, `context_restore_revision`, `context_fork`, `context_close`, `context_export_bundle`.

Analysis: `analysis_start`, `analysis_status`, `analysis_cancel`. Cancel is a notice here. This process runs stages back to back in one tool call.

Read: `list_functions`, `list_strings`, `function_briefing`, `decompile`, `disasm`, `xrefs`, `binary_info`.

Prompts: `triage_binary`, `analyze_function`, `find_vulnerabilities`. They take `context_id`.

Stock WASM has no Ghidra. `decompile` tags the engine (`pdg` / `pdd` / `pdc` / `pseudo`).
