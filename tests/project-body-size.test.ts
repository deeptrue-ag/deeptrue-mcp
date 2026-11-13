import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';
import { MAX_PROJECT_BODY_BYTES } from '../src/tools/project-body.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

const projectId = '42';

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

type FetchCall = { url: string; method: string; body?: string };

function objectOfByteLength(bytes: number): { pages: string } {
  const prefix = '{"pages":"';
  const suffix = '"}';
  const filler = bytes - Buffer.byteLength(prefix + suffix, 'utf8');
  return { pages: 'p'.repeat(filler) };
}

function stringOfJsonByteLength(bytes: number): string {
  return 'n'.repeat(bytes - 2);
}

describe('project create and update body size', () => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  const client = new DeepTrueApiClient(
    config,
    { token: 'jwt-project-body', org: 'public', scopes: ['mcp:write'] },
    { apiKey: 'dt_test', org: 'public' },
  );
  const server = createDeepTrueMcpServer(config, { getClient: async () => client });
  const callTool = (server as unknown as { server: ProtocolServer }).server._requestHandlers.get('tools/call');
  if (!callTool) {
    throw new Error('missing tools/call handler');
  }

  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function createProject(arguments_: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: { confirm: true, ...arguments_ },
        },
      },
      {},
    );
  }

  async function updateProject(patch: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: {
          name: 'update_project',
          arguments: { project_id: projectId, patch, confirm: true },
        },
      },
      {},
    );
  }

  function expectRejectedBeforeFetch(result: ToolResult): void {
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  }

  it('sends a create body whose json is at the 100000 byte cap', async () => {
    expect(MAX_PROJECT_BODY_BYTES).toBe(100_000);
    const json = objectOfByteLength(MAX_PROJECT_BODY_BYTES);
    expect(Buffer.byteLength(JSON.stringify(json), 'utf8')).toBe(100_000);

    const result = await createProject({ name: 'Study', json });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe('/v1/org/public/projects/');
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ name: 'Study', json });
  });

  it('rejects create json over 100000 bytes before a request', async () => {
    const json = objectOfByteLength(MAX_PROJECT_BODY_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(json), 'utf8')).toBe(100_001);

    const result = await createProject({ name: 'Study', json });

    expectRejectedBeforeFetch(result);
  });

  it('sends a create name at the 100000 byte cap', async () => {
    const name = stringOfJsonByteLength(MAX_PROJECT_BODY_BYTES);
    expect(Buffer.byteLength(JSON.stringify(name), 'utf8')).toBe(100_000);

    const result = await createProject({ name });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ name });
  });

  it('rejects a create name over 100000 bytes before a request', async () => {
    const name = stringOfJsonByteLength(MAX_PROJECT_BODY_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(name), 'utf8')).toBe(100_001);

    const result = await createProject({ name });

    expectRejectedBeforeFetch(result);
  });

  it('sends a product slug at the 100000 byte cap', async () => {
    const product_slug = stringOfJsonByteLength(MAX_PROJECT_BODY_BYTES);
    expect(Buffer.byteLength(JSON.stringify(product_slug), 'utf8')).toBe(100_000);

    const result = await createProject({ name: 'Study', product_slug });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ name: 'Study', product_slug });
  });

  it('rejects a product slug over 100000 bytes before a request', async () => {
    const product_slug = stringOfJsonByteLength(MAX_PROJECT_BODY_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(product_slug), 'utf8')).toBe(100_001);

    const result = await createProject({ name: 'Study', product_slug });

    expectRejectedBeforeFetch(result);
  });

  it('sends an update patch at the 100000 byte cap', async () => {
    const patch = objectOfByteLength(MAX_PROJECT_BODY_BYTES);
    expect(Buffer.byteLength(JSON.stringify(patch), 'utf8')).toBe(100_000);

    const result = await updateProject(patch);

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/projects/${projectId}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual(patch);
  });

  it('rejects an update patch over 100000 bytes before a request', async () => {
    const patch = objectOfByteLength(MAX_PROJECT_BODY_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(patch), 'utf8')).toBe(100_001);

    const result = await updateProject(patch);

    expectRejectedBeforeFetch(result);
  });
});
