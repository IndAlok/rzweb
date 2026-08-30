# Hosted RzWeb MCP

This folder is a Cloudflare Worker plus a Container image sketch. The Worker is a coordination plane: API key, MCP JSON-RPC, R2 for artifacts and `.rzdb` files. It does not run `aaa`.

Do not deploy this on the free path. Cloudflare Pages for the browser app is already free. GitHub Pages for `rzwasi` is already free. Cloudflare Containers are paid. A real hosted `aaa` will also upload malware samples to R2.

Putting `rizin.wasm` in a 128MB Worker isolate is an experiment only. Do not advertise that as serverless Rizin. A real `aaa` will time out or OOM.

Keep this tree in the repo for later. The product people should use today is the browser app plus local `../mcp`.

## If you ignore that and deploy anyway

1. Cloudflare account, R2 bucket `rzweb-contexts` (R2 has a free allowance, the Container does not).
2. `npx wrangler login` then `npx wrangler deploy` from this directory after `npm install`.
3. `ENGINE_URL` has to be an HTTP MCP process. `rizin-mcp` is stdio only. There is no adapter in this repo.
4. Set `MCP_API_KEY`.
5. The Dockerfile is a template. Native rizin plus an HTTP front are still your problem.

Write and raw command tools stay off.
