import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';
import { MAX_REPORT_HTML_BYTES } from '../src/tools/report-html.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

const projectId = '42';

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

type FetchCall = { url: string; method: string; body?: string };

function htmlOfByteLength(bytes: number): { pages: string } {
  const prefix = '{"pages":"';
  const suffix = '"}';
  const filler = bytes - Buffer.byteLength(prefix + suffix, 'utf8');
  return { pages: 'p'.repeat(filler) };
}

describe('trigger_report_refresh html size', () => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  const client = new DeepTrueApiClient(
    config,
    { token: 'jwt-report-html', org: 'public', scopes: ['mcp:reports'] },
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

  async function refreshReport(html: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: {
          name: 'trigger_report_refresh',
          arguments: { project_id: projectId, html, confirm: true },
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

  it('sends report html at the 100000 byte cap', async () => {
    expect(MAX_REPORT_HTML_BYTES).toBe(100_000);
    const html = htmlOfByteLength(MAX_REPORT_HTML_BYTES);
    expect(Buffer.byteLength(JSON.stringify(html), 'utf8')).toBe(100_000);

    const result = await refreshReport(html);

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/projects/${projectId}/report/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual(html);
  });

  it('rejects report html over 100000 bytes before a request', async () => {
    const html = htmlOfByteLength(MAX_REPORT_HTML_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(html), 'utf8')).toBe(100_001);

    const result = await refreshReport(html);

    expectRejectedBeforeFetch(result);
  });
});
