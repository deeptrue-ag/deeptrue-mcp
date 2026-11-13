import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';
import { MAX_BRIEFING_ANSWERS_BYTES } from '../src/tools/briefing-answers.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

const projectId = '42';

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

type FetchCall = { url: string; method: string; body?: string };

function answersOfByteLength(bytes: number): { pages: string } {
  const prefix = '{"pages":"';
  const suffix = '"}';
  const filler = bytes - Buffer.byteLength(prefix + suffix, 'utf8');
  return { pages: 'p'.repeat(filler) };
}

describe('submit_briefing_answers json size', () => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  const client = new DeepTrueApiClient(
    config,
    { token: 'jwt-briefing-json', org: 'public', scopes: ['mcp:write'] },
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

  async function submitBriefing(answers: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: {
          name: 'submit_briefing_answers',
          arguments: { project_id: projectId, answers, confirm: true },
        },
      },
      {},
    );
  }

  it('sends briefing answers at the 100000 byte cap', async () => {
    expect(MAX_BRIEFING_ANSWERS_BYTES).toBe(100_000);
    const answers = answersOfByteLength(MAX_BRIEFING_ANSWERS_BYTES);
    expect(Buffer.byteLength(JSON.stringify(answers), 'utf8')).toBe(100_000);

    const result = await submitBriefing(answers);

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/projects/${projectId}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ json: answers });
  });

  it('rejects briefing answers over 100000 bytes before a request', async () => {
    const answers = answersOfByteLength(MAX_BRIEFING_ANSWERS_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(answers), 'utf8')).toBe(100_001);

    const result = await submitBriefing(answers);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  });
});
