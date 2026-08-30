#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DiskContextStore } from './store.js';
import { WasmEngine } from './engine.js';
import { createRzwebMcpServer } from './server.js';

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const allowWrite = flag('--allow-write') || process.env.RZWEB_ALLOW_WRITE === '1';
  const allowRaw = flag('--allow-raw') || process.env.RZWEB_ALLOW_RAW === '1';
  const httpPort = flag('--http') ? Number(argValue('--http') || '8788') : 0;
  const store = new DiskContextStore();
  await store.init();
  const engine = new WasmEngine();
  const server = createRzwebMcpServer({ store, engine, allowWrite, allowRaw });

  if (httpPort > 0) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await server.connect(transport);
    const http = createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks);
      let parsed: unknown;
      try {
        parsed = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      } catch {
        res.statusCode = 400;
        res.end('invalid json');
        return;
      }
      await transport.handleRequest(req, res, parsed);
    });
    http.listen(httpPort, () => {
      console.error(`rzweb-mcp http://127.0.0.1:${httpPort}/mcp`);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
