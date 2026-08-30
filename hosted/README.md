# Hosted RzWeb MCP

This folder is a Cloudflare Worker plus a Container image. The Worker is the coordination plane: OAuth or API key, MCP JSON-RPC, R2 for artifacts and `.rzdb` files. It does **not** run `aaa`. Analysis goes to a sticky native runtime (Cloudflare Container or any Linux VM) that runs [rizin-mcp](https://github.com/rizinorg/rizin-mcp).

Binaries leave the device in this mode. Do not use it if you need RzWeb's local privacy claim.

Putting `rizin.wasm` in a 128MB Worker isolate is an experiment only. Do not advertise that as serverless Rizin. A real `aaa` will time out or OOM.

## What you deploy

1. Cloudflare account, R2 bucket `rzweb-contexts`.
2. `npx wrangler login` then `npx wrangler deploy` from this directory after `npm install`.
3. Set `ENGINE_URL` to the Container (or any host) running native rizin + rizin-mcp.
4. Set `MCP_API_KEY`, or wire OAuth / Cloudflare Access in front of `/mcp`.
5. Build the Dockerfile from a rizin-mcp checkout:

```bash
docker build -f /path/to/rzweb/hosted/Dockerfile /path/to/rizin-mcp
```

Install native rizin in that image before you rely on analysis. Keep `--no-raw`. Leave write tools off unless a Context says otherwise.

6. Quota the container. `aaaa` on a huge sample can eat the account.

7. Point Cursor at the Worker URL (`https://<worker>/mcp`) as a remote MCP server.

## Tools

The Worker implements context list/get/create/export against R2. Read and analysis tools are forwarded to `ENGINE_URL`. `rename_function`, `set_comment`, and raw `command` return `not-permitted`.

## Layout

- `src/index.ts` Worker fetch handler. No WASM, no `aaa`.
- `wrangler.toml` R2 binding and `ENGINE_URL`.
- `Dockerfile` native engine template.
