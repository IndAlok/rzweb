export interface Env {
  ARTIFACTS: R2Bucket;
  ENGINE_URL: string;
  MCP_API_KEY?: string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ContextRecord {
  id: string;
  name: string;
  artifactHash: string;
  fileSize: number;
  currentRevisionId: string | null;
  job: 'idle' | 'analyzing' | 'failed';
  analysisDepth: number;
  createdAt: number;
  updatedAt: number;
}

const TOOLS = [
  { name: 'context_list', description: 'List contexts in R2' },
  { name: 'context_get', description: 'Get one context by id' },
  { name: 'context_create', description: 'Create a context. artifact_b64 is the binary. This uploads the sample to R2.' },
  { name: 'context_export_bundle', description: 'Return RZWEBPRJ bytes from R2 (base64)' },
  { name: 'analysis_start', description: 'Forward analysis to the native container. This Worker does not run aaa.' },
  { name: 'analysis_status', description: 'Job status from the context manifest' },
  { name: 'list_functions', description: 'Forward to the native engine' },
  { name: 'list_strings', description: 'Forward to the native engine' },
  { name: 'function_briefing', description: 'Forward to the native engine' },
  { name: 'decompile', description: 'Forward to the native engine' },
  { name: 'disasm', description: 'Forward to the native engine' },
  { name: 'xrefs', description: 'Forward to the native engine' },
  { name: 'binary_info', description: 'Forward to the native engine' },
];

const WRITE_AND_RAW = new Set(['rename_function', 'set_comment', 'command']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/authorize' || url.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        message: 'Configure Cloudflare Access or an OAuth provider. Until then, set MCP_API_KEY and send Authorization: Bearer.',
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }

    if (env.MCP_API_KEY) {
      const auth = request.headers.get('Authorization') || '';
      if (auth !== `Bearer ${env.MCP_API_KEY}`) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    if (url.pathname !== '/mcp' && url.pathname !== '/') {
      return json({ error: 'not found' }, 404);
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST JSON-RPC to /mcp' }, 405);
    }

    let body: JsonRpcRequest;
    try {
      body = (await request.json()) as JsonRpcRequest;
    } catch {
      return json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }, 400);
    }

    try {
      const result = await dispatch(body, env);
      return json({ jsonrpc: '2.0', id: body.id ?? null, result });
    } catch {
      return json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32000, message: 'internal error' } });
    }
  },
};

async function dispatch(body: JsonRpcRequest, env: Env): Promise<unknown> {
  const method = body.method || '';
  const params = body.params || {};

  if (method === 'initialize') {
    return {
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'rzweb-hosted', version: '1.0.0' },
      capabilities: { tools: {}, prompts: {} },
      instructions:
        'Hosted RzWeb Context MCP. This Worker stores artifacts on R2 and routes analysis to a native container. Binaries leave the client device. Write and raw command tools are off.',
    };
  }

  if (method === 'notifications/initialized') {
    return {};
  }

  if (method === 'tools/list') {
    return {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: 'object', additionalProperties: true },
      })),
    };
  }

  if (method === 'tools/call') {
    const name = String(params.name || '');
    const args = (params.arguments || {}) as Record<string, unknown>;
    if (WRITE_AND_RAW.has(name)) {
      return toolText({ code: 'not-permitted', message: 'Write and raw command tools are off on hosted MCP.' });
    }
    return toolText(await callTool(name, args, env));
  }

  if (method === 'prompts/list') {
    return {
      prompts: [
        { name: 'triage_binary', description: 'Triage a hosted context' },
        { name: 'analyze_function', description: 'Analyze one function in a hosted context' },
        { name: 'find_vulnerabilities', description: 'Hunt vulns in a hosted context' },
      ],
    };
  }

  throw new Error(`Unknown method ${method}`);
}

async function callTool(name: string, args: Record<string, unknown>, env: Env): Promise<unknown> {
  switch (name) {
    case 'context_list':
      return listContexts(env);
    case 'context_get':
      return getContext(env, String(args.context_id || ''));
    case 'context_create':
      return createContext(env, args);
    case 'context_export_bundle':
      return exportBundle(env, String(args.context_id || ''));
    case 'analysis_status': {
      const ctx = await getContext(env, String(args.context_id || ''));
      return ctx ? { context_id: (ctx as ContextRecord).id, job: (ctx as ContextRecord).job } : { code: 'not-found', message: 'Unknown context' };
    }
    case 'analysis_start':
    case 'list_functions':
    case 'list_strings':
    case 'function_briefing':
    case 'decompile':
    case 'disasm':
    case 'xrefs':
    case 'binary_info':
      return forwardToEngine(env, name, args);
    default:
      return { code: 'unknown-tool', message: name };
  }
}

async function listContexts(env: Env): Promise<ContextRecord[]> {
  const listed = await env.ARTIFACTS.list({ prefix: 'contexts/' });
  const out: ContextRecord[] = [];
  for (const obj of listed.objects) {
    const got = await env.ARTIFACTS.get(obj.key);
    if (!got) continue;
    out.push(await got.json<ContextRecord>());
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getContext(env: Env, id: string): Promise<ContextRecord | null> {
  if (!id) return null;
  const got = await env.ARTIFACTS.get(`contexts/${id}.json`);
  return got ? got.json<ContextRecord>() : null;
}

async function createContext(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const name = String(args.name || 'binary');
  const b64 = String(args.artifact_b64 || '');
  if (!b64) return { code: 'invalid', message: 'artifact_b64 is required. This uploads the sample.' };
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const id = crypto.randomUUID();
  const now = Date.now();
  const ctx: ContextRecord = {
    id,
    name,
    artifactHash: hash,
    fileSize: bytes.byteLength,
    currentRevisionId: null,
    job: 'idle',
    analysisDepth: Number(args.analysis_depth || 2),
    createdAt: now,
    updatedAt: now,
  };
  await env.ARTIFACTS.put(`artifacts/${hash}`, bytes);
  await env.ARTIFACTS.put(`contexts/${id}.json`, JSON.stringify(ctx));
  return { context_id: id, artifactHash: hash, warning: 'This binary is now stored off-device in R2.' };
}

async function exportBundle(env: Env, id: string): Promise<unknown> {
  const ctx = await getContext(env, id);
  if (!ctx) return { code: 'not-found', message: 'Unknown context' };
  const artifact = await env.ARTIFACTS.get(`artifacts/${ctx.artifactHash}`);
  if (!artifact) return { code: 'not-found', message: 'Missing artifact' };
  const binary = new Uint8Array(await artifact.arrayBuffer());
  let rzdb = new Uint8Array();
  if (ctx.currentRevisionId) {
    const rev = await env.ARTIFACTS.get(`revisions/${ctx.currentRevisionId}.rzdb`);
    if (rev) rzdb = new Uint8Array(await rev.arrayBuffer());
  }
  const bundle = encodeBundle(ctx.name, binary, rzdb);
  let binaryStr = '';
  const chunk = 0x8000;
  for (let i = 0; i < bundle.length; i += chunk) {
    binaryStr += String.fromCharCode(...bundle.subarray(i, i + chunk));
  }
  return { name: ctx.name, bundle_b64: btoa(binaryStr) };
}

async function forwardToEngine(env: Env, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!env.ENGINE_URL) {
    return {
      code: 'engine-unconfigured',
      message: 'Set ENGINE_URL to the Cloudflare Container running native rizin-mcp. This Worker does not run aaa.',
    };
  }
  const response = await fetch(new URL('/mcp', env.ENGINE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return response.json();
}

function encodeBundle(name: string, binary: Uint8Array, rzdb: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const magic = encoder.encode('RZWEBPRJ');
  const nameBytes = encoder.encode(name);
  const total = 8 + 1 + 4 + nameBytes.length + 4 + binary.length + 4 + rzdb.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  out.set(magic, offset);
  offset += 8;
  view.setUint8(offset, 1);
  offset += 1;
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  view.setUint32(offset, binary.length, true);
  offset += 4;
  out.set(binary, offset);
  offset += binary.length;
  view.setUint32(offset, rzdb.length, true);
  offset += 4;
  out.set(rzdb, offset);
  return out;
}

function toolText(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...cors() },
  });
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}
