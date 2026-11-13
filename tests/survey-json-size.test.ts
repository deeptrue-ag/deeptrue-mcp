import { DeepTrueApiClient } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';
import {
  MAX_SURVEY_ID_BYTES,
  MAX_SURVEY_JSON_BYTES,
  MAX_SURVEY_NAME_BYTES,
  MAX_SURVEY_TEMPLATE_UUID_BYTES,
} from '../src/tools/survey-structure-patch.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

const surveyUuid = '550e8400-e29b-41d4-a716-446655440000';

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

type ProtocolServer = {
  _requestHandlers: Map<string, (request: unknown, extra?: unknown) => Promise<ToolResult>>;
};

type FetchCall = { url: string; method: string; body?: string };

function surveyJsonOfByteLength(bytes: number): { pages: string } {
  const prefix = '{"pages":"';
  const suffix = '"}';
  const filler = bytes - Buffer.byteLength(prefix + suffix, 'utf8');
  return { pages: 'p'.repeat(filler) };
}

describe('update_survey_structure json size', () => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  const client = new DeepTrueApiClient(
    config,
    { token: 'jwt-survey-json', org: 'public', scopes: ['mcp:surveys'] },
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

  async function updateSurvey(patch: Record<string, unknown>): Promise<ToolResult> {
    return callTool(
      {
        method: 'tools/call',
        params: {
          name: 'update_survey_structure',
          arguments: { survey_uuid: surveyUuid, patch, confirm: true },
        },
      },
      {},
    );
  }

  it('sends survey json at the 100000 byte cap', async () => {
    expect(MAX_SURVEY_JSON_BYTES).toBe(100_000);
    const json = surveyJsonOfByteLength(MAX_SURVEY_JSON_BYTES);
    expect(Buffer.byteLength(JSON.stringify(json), 'utf8')).toBe(100_000);

    const result = await updateSurvey({ json });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/surveys/${surveyUuid}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ json });
  });

  it('rejects survey json over 100000 bytes before a request', async () => {
    const json = surveyJsonOfByteLength(MAX_SURVEY_JSON_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(json), 'utf8')).toBe(100_001);

    const result = await updateSurvey({ json });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  });

  it('sends a survey name at the 100000 byte cap', async () => {
    expect(MAX_SURVEY_NAME_BYTES).toBe(100_000);
    const name = 'n'.repeat(MAX_SURVEY_NAME_BYTES - 2);
    expect(Buffer.byteLength(JSON.stringify(name), 'utf8')).toBe(100_000);

    const result = await updateSurvey({ name });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/surveys/${surveyUuid}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ name });
  });

  it('rejects a survey name over 100000 bytes before a request', async () => {
    const name = 'n'.repeat(MAX_SURVEY_NAME_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(name), 'utf8')).toBe(100_001);

    const result = await updateSurvey({ name });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  });

  it('sends a survey id at the 100000 byte cap', async () => {
    expect(MAX_SURVEY_ID_BYTES).toBe(100_000);
    const id = 'i'.repeat(MAX_SURVEY_ID_BYTES - 2);
    expect(Buffer.byteLength(JSON.stringify(id), 'utf8')).toBe(100_000);

    const result = await updateSurvey({ id });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/surveys/${surveyUuid}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ id });
  });

  it('rejects a survey id over 100000 bytes before a request', async () => {
    const id = 'i'.repeat(MAX_SURVEY_ID_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(id), 'utf8')).toBe(100_001);

    const result = await updateSurvey({ id });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  });

  it('sends a survey template uuid at the 100000 byte cap', async () => {
    expect(MAX_SURVEY_TEMPLATE_UUID_BYTES).toBe(100_000);
    const survey_template_uuid = 'u'.repeat(MAX_SURVEY_TEMPLATE_UUID_BYTES - 2);
    expect(Buffer.byteLength(JSON.stringify(survey_template_uuid), 'utf8')).toBe(100_000);

    const result = await updateSurvey({ survey_template_uuid });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    const url = new URL(calls[0].url);
    expect(url.host).toBe('api.test');
    expect(url.pathname).toBe(`/v1/org/public/surveys/${surveyUuid}/`);
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ survey_template_uuid });
  });

  it('rejects a survey template uuid over 100000 bytes before a request', async () => {
    const survey_template_uuid = 'u'.repeat(MAX_SURVEY_TEMPLATE_UUID_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(survey_template_uuid), 'utf8')).toBe(100_001);

    const result = await updateSurvey({ survey_template_uuid });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Input validation error/);
    expect(result.content[0].text).toMatch(/100000/);
    expect(calls).toHaveLength(0);
  });
});
