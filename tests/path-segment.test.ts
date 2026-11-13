import { DeepTrueApiClient, encodePathSegment } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createDeepTrueMcpServer } from '../src/server.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
});

const normalSurveyId = '550e8400-e29b-41d4-a716-446655440000';

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };
type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
};

type ToolCase = {
  tool: string;
  field: string;
  extra?: Record<string, unknown>;
  host: string;
  pathname: (segment: string) => string;
  normal: string;
  label: string;
};

const toolCases: ToolCase[] = [
  {
    tool: 'get_project',
    field: 'project_id',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'update_project',
    field: 'project_id',
    extra: { confirm: true, patch: { name: 'n' } },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'get_briefing',
    field: 'project_id',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/briefing-answers-json/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'submit_briefing_answers',
    field: 'project_id',
    extra: { confirm: true, answers: { q: 1 } },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'accept_project',
    field: 'project_id',
    extra: { confirm: true },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/accept/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'start_fielding',
    field: 'project_id',
    extra: { confirm: true },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/collect/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'finish_fielding',
    field: 'project_id',
    extra: { confirm: true },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/finish/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'archive_project',
    field: 'project_id',
    extra: { confirm: true },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/archive/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'restore_project',
    field: 'project_id',
    extra: { confirm: true },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/restore/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'get_survey',
    field: 'survey_uuid',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/surveys/${segment}/`,
    normal: normalSurveyId,
    label: 'Survey id',
  },
  {
    tool: 'update_survey_structure',
    field: 'survey_uuid',
    extra: { confirm: true, patch: { name: 'Wave' } },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/surveys/${segment}/`,
    normal: normalSurveyId,
    label: 'Survey id',
  },
  {
    tool: 'get_survey_statistics',
    field: 'project_uuid',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/surveys/statistics/${segment}/`,
    normal: normalSurveyId,
    label: 'Project id',
  },
  {
    tool: 'list_respondents',
    field: 'survey_uuid',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/surveys/responses/${segment}/progress/`,
    normal: normalSurveyId,
    label: 'Survey id',
  },
  {
    tool: 'get_report',
    field: 'report_id',
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/reports/${segment}/`,
    normal: '9',
    label: 'Report id',
  },
  {
    tool: 'get_report_layouts',
    field: 'project_id',
    extra: { audience: 'org' },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/report-layouts/org/`,
    normal: '42',
    label: 'Project id',
  },
  {
    tool: 'trigger_report_refresh',
    field: 'project_id',
    extra: { confirm: true, html: { body: '<p></p>' } },
    host: 'api.test',
    pathname: (segment) => `/v1/org/public/projects/${segment}/report/`,
    normal: '42',
    label: 'Project id',
  },
];

const confinedValues = [
  '%2E',
  '%2E%2E',
  '%2e',
  '%2e%2e',
  'foo/bar',
  'a?b=1',
  'a#frag',
  'https://evil.example/x',
  'user@evil.example',
  'id\r\nX-Injected: yes',
  'id\0hidden',
  '../other',
  '1.2',
];

describe('encodePathSegment', () => {
  it('rejects dot segments and keeps every other value inside one segment', () => {
    for (const value of ['.', '..']) {
      expect(() => encodePathSegment(value, 'Project id')).toThrow(/Project id must be a single path segment/);
    }

    for (const value of confinedValues) {
      const encoded = encodePathSegment(value, 'Project id');
      expect(encoded).toBe(encodeURIComponent(value));
      const url = new URL(`http://api.test/v1/org/public/projects/${encoded}/tail/`);
      expect(url.hostname).toBe('api.test');
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(url.pathname).toBe(`/v1/org/public/projects/${encoded}/tail/`);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
    }

    expect(encodePathSegment(42, 'Project id')).toBe('42');
    expect(encodePathSegment(normalSurveyId, 'Survey id')).toBe(normalSurveyId);
    expect(encodePathSegment('admin', 'Audience')).toBe('admin');
    expect(encodePathSegment('org', 'Audience')).toBe('org');
  });

  it('accepts a 128-character id as one path segment and rejects 129', () => {
    const accepted = 'a'.repeat(128);
    const rejected = 'b'.repeat(129);

    for (const label of ['Project id', 'Survey id', 'Report id', 'Audience']) {
      const encoded = encodePathSegment(accepted, label);
      expect(encoded).toBe(accepted);
      const url = new URL(`http://api.test/v1/org/public/projects/${encoded}/tail/`);
      expect(url.pathname).toBe(`/v1/org/public/projects/${accepted}/tail/`);
      expect(url.pathname.split('/').filter(Boolean)).toEqual(['v1', 'org', 'public', 'projects', accepted, 'tail']);
      expect(() => encodePathSegment(rejected, label)).toThrow(
        new RegExp(`${label} must be at most 128 characters`),
      );
    }
  });
});

describe('tool path arguments', () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];
  let tools: Record<string, RegisteredTool>;

  beforeAll(() => {
    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-path', org: 'public', scopes: ['mcp:write'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    const server = createDeepTrueMcpServer(config, { getClient: async () => client });
    tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  });

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

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = tools[name];
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.handler(args);
  }

  function expectOneRequest(host: string, pathname: string): void {
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.host).toBe(host);
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.pathname).toBe(pathname);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(calls[0]).not.toMatch(/[\r\n\0]/);
  }

  it('keeps a normal id on the route that tool already called', async () => {
    for (const toolCase of toolCases) {
      calls.length = 0;
      const result = await callTool(toolCase.tool, { ...toolCase.extra, [toolCase.field]: toolCase.normal });
      expect(result.isError).toBeUndefined();
      expectOneRequest(toolCase.host, toolCase.pathname(toolCase.normal));
    }

    calls.length = 0;
    const numeric = await callTool('get_project', { project_id: 42 });
    expect(numeric.isError).toBeUndefined();
    expectOneRequest('api.test', '/v1/org/public/projects/42/');

    calls.length = 0;
    const admin = await callTool('get_report_layouts', { project_id: 42, audience: 'admin' });
    expect(admin.isError).toBeUndefined();
    expectOneRequest('api.test', '/v1/org/public/projects/42/report-layouts/admin/');
  });

  it('rejects dot segments before fetch and confines other id characters', async () => {
    for (const toolCase of toolCases) {
      for (const dot of ['.', '..']) {
        calls.length = 0;
        const result = await callTool(toolCase.tool, { ...toolCase.extra, [toolCase.field]: dot });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(new RegExp(`${toolCase.label} must be a single path segment`));
        expect(calls).toHaveLength(0);
      }

      for (const value of confinedValues) {
        calls.length = 0;
        const result = await callTool(toolCase.tool, { ...toolCase.extra, [toolCase.field]: value });
        expect(result.isError).toBeUndefined();
        expectOneRequest(toolCase.host, toolCase.pathname(encodeURIComponent(value)));
      }
    }

    for (const audience of ['.', '..']) {
      calls.length = 0;
      const result = await callTool('get_report_layouts', { project_id: 42, audience });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Audience must be a single path segment/);
      expect(calls).toHaveLength(0);
    }

    calls.length = 0;
    const encodedAudience = await callTool('get_report_layouts', { project_id: 42, audience: '%2E%2E' });
    expect(encodedAudience.isError).toBeUndefined();
    expectOneRequest('api.test', '/v1/org/public/projects/42/report-layouts/%252E%252E/');
  });

  it('sends a 128-character id as one path segment and rejects 129 before a request', async () => {
    const accepted = 'c'.repeat(128);
    const rejected = 'd'.repeat(129);
    const audienceCases: ToolCase[] = [
      {
        tool: 'get_report_layouts',
        field: 'audience',
        extra: { project_id: 42 },
        host: 'api.test',
        pathname: (segment) => `/v1/org/public/projects/42/report-layouts/${segment}/`,
        normal: 'org',
        label: 'Audience',
      },
    ];

    for (const toolCase of [...toolCases, ...audienceCases]) {
      calls.length = 0;
      const ok = await callTool(toolCase.tool, { ...toolCase.extra, [toolCase.field]: accepted });
      expect(ok.isError).toBeUndefined();
      expectOneRequest(toolCase.host, toolCase.pathname(accepted));
      expect(new URL(calls[0]).pathname.split('/').filter(Boolean)).toContain(accepted);

      calls.length = 0;
      const bad = await callTool(toolCase.tool, { ...toolCase.extra, [toolCase.field]: rejected });
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toMatch(new RegExp(`${toolCase.label} must be at most 128 characters`));
      expect(calls).toHaveLength(0);
    }
  });

  it('requests panel routes only from the fixed allowlist', async () => {
    const allowed = await callTool('list_panel_projects', {});
    expect(allowed.isError).toBeUndefined();
    expectOneRequest('api.test', '/v1/cint/demands/');

    calls.length = 0;
    const status = await callTool('get_feasibility', { provider: 'dynata' });
    expect(status.isError).toBeUndefined();
    expectOneRequest('api.test', '/v1/dynata/status/');

    calls.length = 0;
    const rejected = await callTool('get_feasibility', { provider: '..' });
    expect(rejected.isError).toBe(true);
    expect(calls).toHaveLength(0);

    calls.length = 0;
    const rejectedResource = await callTool('list_panel_projects', { provider: 'cint', resource: '..' });
    expect(rejectedResource.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
