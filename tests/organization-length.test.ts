import { resolveSession } from '../src/auth.js';
import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
  DEEPTRUE_API_KEY: 'dt_test',
});

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

describe('organization length', () => {
  const originalFetch = global.fetch;
  const calls: { url: string; body?: string }[] = [];

  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body === undefined ? undefined : String(init.body) });
      if (url.includes('auth/mcp/session')) {
        const sent = JSON.parse(String(init?.body)) as { organization?: string };
        return new Response(
          JSON.stringify({
            token: 'jwt-org',
            organization: sent.organization ?? 'public',
            scopes: ['mcp:read'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('accepts a 128-character organization as one path segment', async () => {
    const org = 'a'.repeat(128);
    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-org', org, scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org },
    );

    expect(client.orgPath('projects/')).toBe(`org/${org}/projects/`);
    await client.request({ path: client.orgPath('projects/') });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/${org}/projects/`);
    expect(url.pathname.split('/').filter(Boolean)).toEqual(['v1', 'org', org, 'projects']);
    expect(calls[0].url).not.toContain('auth/mcp/session');
  });

  it('rejects a 129-character organization before a path request or session exchange', async () => {
    const org = 'a'.repeat(129);
    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-org', org, scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org },
    );
    const publicClient = new DeepTrueApiClient(
      config,
      { token: 'jwt-org', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    const longConfig = loadConfig({
      DEEPTRUE_API_BASE: 'http://api.test',
      DEEPTRUE_API_KEY: 'dt_test',
      DEEPTRUE_ORG: org,
    });

    expect(() => client.orgPath('projects/')).toThrow(/at most 128 characters/);
    expect(() => client.request({ path: client.orgPath('projects/') })).toThrow(/at most 128 characters/);
    await expect(publicClient.withOrg(org)).rejects.toThrow(/at most 128 characters/);
    await expect(resolveSession(longConfig, {})).rejects.toThrow(/at most 128 characters/);
    await expect(resolveSession(config, { apiKey: 'dt_test', org })).rejects.toThrow(/at most 128 characters/);
    expect(calls).toHaveLength(0);
  });

  it('sends a 128-character organization in the session exchange and keeps a short slug', async () => {
    const org = 'b'.repeat(128);
    const longConfig = loadConfig({
      DEEPTRUE_API_BASE: 'http://api.test',
      DEEPTRUE_API_KEY: 'dt_test',
      DEEPTRUE_ORG: org,
    });

    const session = await resolveSession(longConfig, {});
    expect(session.org).toBe(org);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ api_key: 'dt_test', organization: org });

    const client = new DeepTrueApiClient(longConfig, session, { apiKey: 'dt_test', org });
    await client.request({ path: client.orgPath('projects/') });
    const url = new URL(calls[1].url);
    expect(url.pathname).toBe(`/v1/org/${org}/projects/`);

    calls.length = 0;
    const publicSession = await resolveSession(config, { apiKey: 'dt_test', org: 'public' });
    expect(publicSession.org).toBe('public');
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ api_key: 'dt_test', organization: 'public' });
  });

  it('rejects a 129-character list_projects organization before a request', async () => {
    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-org', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    const server = createDeepTrueMcpServer(config, { getClient: async () => client });
    const callTool = (server as unknown as { server: ProtocolServer }).server._requestHandlers.get('tools/call');
    if (!callTool) {
      throw new Error('missing tools/call handler');
    }

    const accepted = 'c'.repeat(128);
    const ok = await callTool(
      {
        method: 'tools/call',
        params: { name: 'list_projects', arguments: { organization: accepted } },
      },
      {},
    );
    expect(ok.isError).toBeUndefined();
    expect(calls.map((call) => call.url).some((url) => url.includes('auth/mcp/session'))).toBe(true);
    const projectCall = calls.find((call) => call.url.includes('/projects/'));
    expect(projectCall).toBeDefined();
    const projectUrl = new URL(projectCall!.url);
    expect(projectUrl.pathname).toBe(`/v1/org/${accepted}/projects/`);
    expect(JSON.parse(calls.find((call) => call.url.includes('auth/mcp/session'))?.body ?? '')).toEqual({
      api_key: 'dt_test',
      organization: accepted,
    });

    const before = calls.length;
    const rejected = await callTool(
      {
        method: 'tools/call',
        params: { name: 'list_projects', arguments: { organization: 'c'.repeat(129) } },
      },
      {},
    );
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toMatch(/128/);
    expect(calls).toHaveLength(before);
  });
});
