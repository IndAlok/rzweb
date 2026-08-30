import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { DiskContextStore, decodeBundle, encodeBundle } from './store.js';
import { WasmEngine, paginate } from './engine.js';
import { ANALYZE_FUNCTION_PROMPT, FIND_VULNS_PROMPT, TRIAGE_PROMPT } from './prompts.js';

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(code: string, message: string, detail?: string) {
  return jsonResult({ code, message, detail });
}

export interface ServerOptions {
  store: DiskContextStore;
  engine: WasmEngine;
  allowWrite: boolean;
  allowRaw: boolean;
}

export function createRzwebMcpServer(options: ServerOptions): McpServer {
  const { store, engine, allowWrite, allowRaw } = options;
  const server = new McpServer(
    { name: 'rzweb', version: '1.0.0' },
    {
      instructions:
        'RzWeb Context MCP. Open or create a context, then call analysis_start and wait. Read tools take context_id. Hosted deployments should keep write and raw command tools off.',
    }
  );

  const requireContext = async (contextId: string) => {
    const ctx = await store.get(contextId);
    if (!ctx) throw new Error(`Unknown context_id ${contextId}`);
    return ctx;
  };

  const ensureLive = async (contextId: string) => {
    if (engine.currentContextId === contextId) return;
    const ctx = await requireContext(contextId);
    const artifact = await store.getArtifact(ctx.artifactHash);
    if (!artifact) throw new Error('Artifact bytes are missing for this context.');
    const rzdb = await store.getCurrentRzdb(contextId);
    await engine.openContext(contextId, ctx.name, artifact.data, rzdb);
  };

  server.registerTool('context_list', { description: 'List stored contexts' }, async () => jsonResult(await store.list()));

  server.registerTool(
    'context_get',
    { description: 'Get one context by id', inputSchema: { context_id: z.string() } },
    async ({ context_id }) => {
      const ctx = await store.get(context_id);
      if (!ctx) return errorResult('not-found', 'Unknown context_id');
      const revisions = await store.listRevisions(context_id);
      return jsonResult({ ...ctx, revisions });
    }
  );

  server.registerTool(
    'context_create',
    {
      description: 'Create a context from a local file path',
      inputSchema: { path: z.string(), name: z.string().optional(), analysis_depth: z.number().optional() },
    },
    async ({ path: filePath, name, analysis_depth }) => {
      const data = new Uint8Array(await fs.readFile(filePath));
      const ctx = await store.createContext({
        name: name || filePath.split(/[\\/]/).pop() || 'binary',
        data,
        analysisDepth: analysis_depth,
      });
      await engine.openContext(ctx.id, ctx.name, data, null);
      return jsonResult({ context_id: ctx.id, job: 'idle' });
    }
  );

  server.registerTool(
    'context_import',
    { description: 'Import an RZWEBPRJ bundle from a local path', inputSchema: { path: z.string() } },
    async ({ path: filePath }) => {
      const data = new Uint8Array(await fs.readFile(filePath));
      const bundle = decodeBundle(data);
      if (!bundle) return errorResult('invalid-bundle', 'Not an RZWEBPRJ bundle');
      const ctx = await store.createContext({
        name: bundle.name,
        data: bundle.binary,
        rzdb: bundle.rzdb,
      });
      await engine.openContext(ctx.id, ctx.name, bundle.binary, bundle.rzdb);
      return jsonResult({ context_id: ctx.id });
    }
  );

  server.registerTool(
    'context_checkpoint',
    { description: 'Write a manual revision from the live core', inputSchema: { context_id: z.string() } },
    async ({ context_id }) => {
      await ensureLive(context_id);
      const rzdb = engine.saveRzdb();
      if (!rzdb) return errorResult('checkpoint-failed', 'Could not save .rzdb');
      const rev = await store.commitRevision(context_id, rzdb, 'manual');
      return jsonResult(rev);
    }
  );

  server.registerTool(
    'context_restore_revision',
    {
      description: 'Copy an older rzdb to current, then apply it onto the open file',
      inputSchema: { context_id: z.string(), revision_id: z.string() },
    },
    async ({ context_id, revision_id }) => {
      const rev = await store.restoreRevision(context_id, revision_id);
      if (!rev) return errorResult('not-found', 'Unknown revision');
      const ctx = await requireContext(context_id);
      const artifact = await store.getArtifact(ctx.artifactHash);
      const rzdb = await store.getCurrentRzdb(context_id);
      if (!artifact || !rzdb) return errorResult('restore-failed', 'Missing artifact or rzdb');
      await engine.openContext(context_id, ctx.name, artifact.data, rzdb);
      return jsonResult(rev);
    }
  );

  server.registerTool(
    'context_fork',
    { description: 'Fork a context onto the same artifact', inputSchema: { context_id: z.string(), name: z.string().optional() } },
    async ({ context_id, name }) => jsonResult(await store.fork(context_id, name))
  );

  server.registerTool(
    'context_close',
    { description: 'Park the live core (save rzdb) and drop the WASM session', inputSchema: { context_id: z.string() } },
    async ({ context_id }) => {
      if (engine.currentContextId === context_id) {
        const rzdb = engine.saveRzdb();
        if (rzdb) await store.commitRevision(context_id, rzdb, 'park');
        engine.close();
      }
      await store.update(context_id, { job: 'idle' });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    'context_export_bundle',
    { description: 'Write an RZWEBPRJ file to a local path', inputSchema: { context_id: z.string(), path: z.string() } },
    async ({ context_id, path: outPath }) => {
      const ctx = await requireContext(context_id);
      const artifact = await store.getArtifact(ctx.artifactHash);
      let rzdb = await store.getCurrentRzdb(context_id);
      if (engine.currentContextId === context_id) {
        rzdb = engine.saveRzdb() ?? rzdb;
      }
      if (!artifact || !rzdb) return errorResult('export-failed', 'Need artifact and rzdb');
      await fs.writeFile(outPath, encodeBundle(ctx.name, artifact.data, rzdb));
      return jsonResult({ path: outPath });
    }
  );

  server.registerTool(
    'analysis_start',
    {
      description: 'Run staged analysis (aa then aaa/aaaa). Returns after the job. This WASM isolate stays busy until it finishes.',
      inputSchema: { context_id: z.string(), depth: z.number().optional() },
    },
    async ({ context_id, depth }) => {
      await ensureLive(context_id);
      const ctx = await requireContext(context_id);
      const analysisDepth = depth ?? ctx.analysisDepth;
      await store.update(context_id, { job: 'analyzing', analysisDepth });
      const stages = analysisDepth >= 3 ? ['aa', 'aaaa'] : analysisDepth >= 2 ? ['aa', 'aaa'] : ['aa'];
      for (const cmd of stages) {
        engine.cmd(cmd);
      }
      const rzdb = engine.saveRzdb();
      if (rzdb) await store.commitRevision(context_id, rzdb, 'analysis');
      await store.update(context_id, { job: 'idle' });
      return jsonResult({ context_id, status: 'idle', phases: stages });
    }
  );

  server.registerTool(
    'analysis_status',
    { description: 'Current job status for a context', inputSchema: { context_id: z.string() } },
    async ({ context_id }) => {
      const ctx = await requireContext(context_id);
      return jsonResult({ context_id, job: ctx.job, live: engine.currentContextId === context_id });
    }
  );

  server.registerTool(
    'analysis_cancel',
    {
      description: 'Cancel is only possible between stages. Mid-aaa cannot be interrupted in this WASM build.',
      inputSchema: { context_id: z.string() },
    },
    async () => errorResult(
      'cancel-unavailable',
      'Cancel only works between staged commands. This Node WASM path runs stages back to back in one tool call.'
    )
  );

  server.registerTool(
    'list_functions',
    {
      description: 'Paginated function list',
      inputSchema: { context_id: z.string(), offset: z.number().optional(), limit: z.number().optional(), query: z.string().optional() },
    },
    async ({ context_id, offset, limit, query }) => {
      await ensureLive(context_id);
      const raw = (engine.cmdj('aflj') as Array<{ offset?: number; name?: string; size?: number; nbbs?: number }> | null) ?? [];
      const mapped = raw.map((fn) => ({
        addr: fn.offset ?? 0,
        name: fn.name ?? `fcn.${(fn.offset ?? 0).toString(16)}`,
        size: fn.size ?? 0,
        nbb: fn.nbbs ?? 0,
      }));
      const needle = query?.trim().toLowerCase();
      const filtered = needle
        ? mapped.filter((item) => `${item.name} ${item.addr.toString(16)}`.toLowerCase().includes(needle))
        : mapped;
      return jsonResult(paginate(filtered, offset, limit));
    }
  );

  server.registerTool(
    'list_strings',
    {
      description: 'Paginated string list',
      inputSchema: { context_id: z.string(), offset: z.number().optional(), limit: z.number().optional(), contains: z.string().optional() },
    },
    async ({ context_id, offset, limit, contains }) => {
      await ensureLive(context_id);
      const raw = (engine.cmdj('izzj') as Array<{ vaddr?: number; string?: string; length?: number }> | null) ?? [];
      const mapped = raw.map((entry) => ({
        addr: entry.vaddr ?? 0,
        string: entry.string ?? '',
        length: entry.length,
      }));
      const needle = contains?.trim().toLowerCase();
      const filtered = needle ? mapped.filter((item) => item.string.toLowerCase().includes(needle)) : mapped;
      return jsonResult(paginate(filtered, offset, limit));
    }
  );

  server.registerTool(
    'function_briefing',
    {
      description: 'One-call function briefing: afij, xrefs, in-range strings, decompile with engine tag',
      inputSchema: { context_id: z.string(), address: z.string() },
    },
    async ({ context_id, address }) => {
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      const afi = engine.cmdj(`afij @ ${at}`);
      const rec = Array.isArray(afi) ? afi[0] : afi;
      const info = (rec && typeof rec === 'object' ? rec : {}) as Record<string, unknown>;
      const addr = Number(info.offset ?? parseInt(at, 16));
      const size = Number(info.size ?? 0);
      const xrefsTo = (engine.cmdj(`axtj @ ${at}`) as unknown[]) ?? [];
      const xrefsFrom = (engine.cmdj(`axfj @ ${at}`) as unknown[]) ?? [];
      const stringsRaw = (engine.cmdj('izzj') as Array<{ vaddr?: number; string?: string }> | null) ?? [];
      const strings = stringsRaw.filter((s) => typeof s.vaddr === 'number' && s.vaddr >= addr && s.vaddr < addr + size);
      const decompile = decompileAt(engine, at);
      return jsonResult({
        summary: { addr, name: info.name ?? `fcn.${addr.toString(16)}`, size, nbb: info.nbbs ?? 0 },
        prototype: info.signature,
        vars: info.vars,
        xrefs: { to: xrefsTo, from: xrefsFrom },
        strings,
        decompile,
      });
    }
  );

  server.registerTool(
    'decompile',
    {
      description: 'Decompile a function. engine is pdg, pdd, pdc, or pseudo.',
      inputSchema: { context_id: z.string(), address: z.string() },
    },
    async ({ context_id, address }) => {
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      return jsonResult(decompileAt(engine, at));
    }
  );

  server.registerTool(
    'disasm',
    { description: 'Disassemble a function (pdf)', inputSchema: { context_id: z.string(), address: z.string() } },
    async ({ context_id, address }) => {
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      return jsonResult({ listing: engine.cmd(`pdf @ ${at}`) });
    }
  );

  server.registerTool(
    'xrefs',
    { description: 'Cross references to and from an address', inputSchema: { context_id: z.string(), address: z.string() } },
    async ({ context_id, address }) => {
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      return jsonResult({
        to: engine.cmdj(`axtj @ ${at}`),
        from: engine.cmdj(`axfj @ ${at}`),
      });
    }
  );

  server.registerTool(
    'binary_info',
    { description: 'Binary info (ij)', inputSchema: { context_id: z.string() } },
    async ({ context_id }) => {
      await ensureLive(context_id);
      return jsonResult(engine.cmdj('ij'));
    }
  );

  server.registerTool(
    'rename_function',
    {
      description: 'Rename a function (afn). Disabled unless write tools are on.',
      inputSchema: { context_id: z.string(), address: z.string(), name: z.string() },
    },
    async ({ context_id, address, name }) => {
      if (!allowWrite) return errorResult('not-permitted', 'Write tools are off. Start with --allow-write.');
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      const safe = name.trim().replace(/[^A-Za-z0-9_.]/g, '_');
      return jsonResult({ output: engine.cmd(`afn ${safe} @ ${at}`) });
    }
  );

  server.registerTool(
    'set_comment',
    {
      description: 'Set or clear a comment. Disabled unless write tools are on.',
      inputSchema: { context_id: z.string(), address: z.string(), text: z.string().optional() },
    },
    async ({ context_id, address, text }) => {
      if (!allowWrite) return errorResult('not-permitted', 'Write tools are off. Start with --allow-write.');
      await ensureLive(context_id);
      const at = address.startsWith('0x') ? address : `0x${address}`;
      const comment = (text ?? '').trim().replace(/[\n\r@]/g, ' ');
      return jsonResult({ output: engine.cmd(comment ? `CC ${comment} @ ${at}` : `CC- @ ${at}`) });
    }
  );

  server.registerTool(
    'command',
    { description: 'Raw rizin command. Off unless --allow-raw.', inputSchema: { context_id: z.string(), command: z.string() } },
    async ({ context_id, command }) => {
      if (!allowRaw) return errorResult('not-permitted', 'Raw command is off. Start with --allow-raw.');
      await ensureLive(context_id);
      return jsonResult({ output: engine.cmd(command) });
    }
  );

  server.registerPrompt(
    'triage_binary',
    { description: 'Guided first-pass triage of a context', argsSchema: { context_id: z.string() } },
    ({ context_id }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: TRIAGE_PROMPT.replaceAll('{context_id}', context_id) } }],
    })
  );

  server.registerPrompt(
    'analyze_function',
    { description: 'Analyze a specific function in a context', argsSchema: { context_id: z.string(), address: z.string() } },
    ({ context_id, address }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: ANALYZE_FUNCTION_PROMPT.replaceAll('{context_id}', context_id).replaceAll('{address}', address),
        },
      }],
    })
  );

  server.registerPrompt(
    'find_vulnerabilities',
    { description: 'Hunt for common vulnerability patterns', argsSchema: { context_id: z.string() } },
    ({ context_id }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: FIND_VULNS_PROMPT.replaceAll('{context_id}', context_id) } }],
    })
  );

  return server;
}

function decompileAt(engine: WasmEngine, at: string): { code: string; engine: string } {
  for (const cmd of ['pdg', 'pdd', 'pdc']) {
    const code = engine.cmd(`${cmd} @ ${at}`).trim();
    if (code && !/unknown command|invalid/i.test(code)) {
      return { code, engine: cmd };
    }
  }
  const setup = 'e asm.pseudo=true;e asm.offset=false;e asm.bytes=false;e asm.lines=false';
  const restore = 'e asm.pseudo=false;e asm.offset=true;e asm.bytes=true;e asm.lines=true';
  const code = engine.cmd(`${setup};pdf @ ${at};${restore}`).trim();
  return { code, engine: 'pseudo' };
}
