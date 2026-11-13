import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

describe('list_projects search length', () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  const client = new DeepTrueApiClient(
    config,
    { token: 'jwt-search', org: 'public', scopes: ['mcp:read'] },
    { apiKey: 'dt_test', org: 'public' },
  );
  const server = createDeepTrueMcpServer(config, { getClient: async () => client });
  const callTool = (server as unknown as { server: ProtocolServer }).server._requestHandlers.get('tools/call');
  if (!callTool) {
    throw new Error('missing tools/call handler');
  }

  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function listProjects(args: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: { name: 'list_projects', arguments: args },
      },
      {},
    );
  }

  it('sends a 200-character search as one encoded query value', async () => {
    const search = `${'n'.repeat(199)}&`;
    expect(search).toHaveLength(200);

    const result = await listProjects({ search });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe('/v1/org/public/projects/');
    expect(url.hash).toBe('');
    expect(Array.from(url.searchParams.keys())).toEqual(['search']);
    expect(url.searchParams.getAll('search')).toEqual([search]);
    expect(url.search).toBe(`?search=${'n'.repeat(199)}%26`);
  });

  it('rejects a 201-character search before a request', async () => {
    const result = await listProjects({ search: 'n'.repeat(201) });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/200/);
    expect(calls).toHaveLength(0);
  });

  it('omits search when the caller omits it', async () => {
    const result = await listProjects({});

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/v1/org/public/projects/');
    expect(url.search).toBe('');
    expect(url.searchParams.has('search')).toBe(false);
  });
});
