import { jest } from '@jest/globals';
import { authMaterialFromHeaders, requireWriteConfirm, resolveSession } from '../src/auth.js';
import { DeepTrueApiClient, errorResult } from '../src/client/http.js';
import { loadConfig } from '../src/config.js';
import { createSessionFactory } from '../src/server.js';
import { ACTIVE_ORG_DOES_NOT_PERSIST } from '../src/tools/org-context.js';
import { resolvePanelPath } from '../src/tools/panel-routes.js';

const config = loadConfig({
  DEEPTRUE_API_BASE: 'http://api.test',
  DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
});

describe('requireWriteConfirm', () => {
  it('refuses mutating tools unless confirm is true', () => {
    expect(() => requireWriteConfirm(undefined, 'create_project')).toThrow(/confirm=true/);
    expect(() => requireWriteConfirm(false, 'create_project')).toThrow(/create_project/);
    expect(() => requireWriteConfirm(true, 'create_project')).not.toThrow();
  });
});

describe('resolvePanelPath', () => {
  it('uses Django routes that exist and rejects unknown combinations', () => {
    expect(resolvePanelPath('cint', 'demands')).toBe('cint/demands/');
    expect(resolvePanelPath('bilendi', 'projects')).toBe('bilendi/projects/');
    expect(() => resolvePanelPath('cint', 'projects')).toThrow(/No cint route/);
  });
});

describe('DeepTrueApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('refreshes the session JWT once after a 401 and retries', async () => {
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('auth/mcp/session')) {
        return new Response(
          JSON.stringify({ token: 'jwt-2', organization: 'public', scopes: ['mcp:read'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      if (auth.includes('jwt-1')) {
        return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    const data = await client.request({ path: 'organizations/' });
    expect(data).toEqual({ ok: true });
    expect(calls.filter((url) => url.includes('auth/mcp/session'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('organizations'))).toHaveLength(2);
  });

  it('selects another organization for one client and does not pretend it sticks', async () => {
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({ token: 'jwt-other', organization: 'acme', scopes: ['mcp:read'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      config,
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    const switched = await client.withOrg('acme');
    expect(switched.org).toBe('acme');
    expect(client.org).toBe('public');
    expect(ACTIVE_ORG_DOES_NOT_PERSIST).toMatch(/does not stick/);
  });

  it('refreshes a 401 with the caller OAuth bearer, not the process API key', async () => {
    const sessionBodies: unknown[] = [];
    const apiAuth: string[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      if (url.includes('auth/mcp/session')) {
        sessionBodies.push(JSON.parse(String(init?.body)));
        const body = sessionBodies.at(-1) as { api_key?: string; access_token?: string };
        if (body.api_key) {
          return new Response(
            JSON.stringify({ token: 'jwt-server', organization: 'public', scopes: ['mcp:write'] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ token: 'jwt-user', organization: 'public', scopes: ['mcp:read'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      apiAuth.push(authorization);
      if (authorization.includes('jwt-stale')) {
        return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
      }
      if (authorization.includes('jwt-user')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ detail: 'wrong token' }), { status: 401 });
    }) as typeof fetch;

    const configWithKey = loadConfig({
      DEEPTRUE_API_BASE: 'http://api.test',
      DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
      DEEPTRUE_API_KEY: 'dt_server_admin',
    });
    const client = new DeepTrueApiClient(
      configWithKey,
      { token: 'jwt-stale', org: 'public', scopes: ['mcp:read'] },
      { bearerToken: 'oauth-user', org: 'public' },
    );
    const data = await client.request({ path: 'organizations/' });
    expect(data).toEqual({ ok: true });
    expect(sessionBodies).toEqual([{ access_token: 'oauth-user', organization: 'public' }]);
    expect(apiAuth.some((header) => header.includes('jwt-server'))).toBe(false);
    expect(apiAuth.filter((header) => header.includes('jwt-user'))).toHaveLength(1);
  });
});

describe('session cache', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reuses one exchanged JWT until the credential changes', async () => {
    const sessionBodies: unknown[] = [];
    const apiAuth: string[] = [];
    let issued = 0;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('auth/mcp/session')) {
        sessionBodies.push(JSON.parse(String(init?.body)));
        issued += 1;
        return new Response(
          JSON.stringify({ token: `jwt-${issued}`, organization: 'public', scopes: ['mcp:read'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      apiAuth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const factory = createSessionFactory(config);
    const first = await factory({ apiKey: 'dt_one', org: 'public' });
    const again = await factory({ apiKey: 'dt_one', org: 'public' });
    expect(again).toBe(first);
    await first.request({ path: 'organizations/' });

    const second = await factory({ apiKey: 'dt_two', org: 'public' });
    await second.request({ path: 'organizations/' });
    const bearer = await factory({ bearerToken: 'oauth-user', org: 'public' });
    await bearer.request({ path: 'organizations/' });

    expect(sessionBodies).toEqual([
      { api_key: 'dt_one', organization: 'public' },
      { api_key: 'dt_two', organization: 'public' },
      { access_token: 'oauth-user', organization: 'public' },
    ]);
    expect(apiAuth).toEqual(['JWT jwt-1', 'JWT jwt-2', 'JWT jwt-3']);
  });

  it('drops the cached JWT when the API and the exchange return 401', async () => {
    const apiAuth: string[] = [];
    let exchanges = 0;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('auth/mcp/session')) {
        exchanges += 1;
        if (exchanges === 1) {
          return new Response(
            JSON.stringify({ token: 'jwt-1', organization: 'public', scopes: ['mcp:read'] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ detail: 'revoked' }), { status: 401 });
      }
      apiAuth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(JSON.stringify({ detail: 'revoked' }), { status: 401 });
    }) as typeof fetch;

    const factory = createSessionFactory(config, { apiKey: 'dt_test', org: 'public' });
    const client = await factory();
    await expect(client.request({ path: 'organizations/' })).rejects.toThrow(/401/);
    await expect(client.request({ path: 'organizations/' })).rejects.toThrow(/401/);
    await expect(factory().then((next) => next.request({ path: 'organizations/' }))).rejects.toThrow(/401/);

    expect(apiAuth).toEqual(['JWT jwt-1']);
    expect(exchanges).toBe(4);
  });

  it('sends organization as one encoded path segment and rejects dot segments', async () => {
    const calls: { url: string; headers: Array<[string, string]> }[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: [...new Headers(init?.headers).entries()],
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const confined: Array<[string, string]> = [
      ['public', '/v1/org/public/projects/'],
      ['acme.example', '/v1/org/acme.example/projects/'],
      ['public/../../other', '/v1/org/public%2F..%2F..%2Fother/projects/'],
      ['public%2Fother', '/v1/org/public%252Fother/projects/'],
      ['public?x=1', '/v1/org/public%3Fx%3D1/projects/'],
      ['https://evil.example/x', '/v1/org/https%3A%2F%2Fevil.example%2Fx/projects/'],
      ['user@evil.example', '/v1/org/user%40evil.example/projects/'],
      ['public\r\nX-Injected: yes', '/v1/org/public%0D%0AX-Injected%3A%20yes/projects/'],
      ['public\0hidden', '/v1/org/public%00hidden/projects/'],
    ];

    for (const [org, pathname] of confined) {
      calls.length = 0;
      const client = new DeepTrueApiClient(
        config,
        { token: 'jwt-org', org, scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org },
      );
      expect(client.orgPath('organizations/info/')).toBe(
        `org/${pathname.slice('/v1/org/'.length, -'/projects/'.length)}/organizations/info/`,
      );
      await client.request({ path: client.orgPath('projects/') });
      const url = new URL(calls[0].url);
      expect(url.host).toBe('api.test');
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(url.pathname).toBe(pathname);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
      for (const [key, value] of calls[0].headers) {
        expect(`${key}:${value}`).not.toMatch(/[\r\n\0]/);
      }
      expect(calls[0].headers.map(([key]) => key)).not.toContain('x-deeptrue-org');
    }

    let fetches = calls.length;
    for (const org of ['.', '..']) {
      const client = new DeepTrueApiClient(
        config,
        { token: 'jwt-org', org, scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org },
      );
      expect(() => client.orgPath('projects/')).toThrow(/single path segment/);
      expect(() => client.request({ path: client.orgPath('projects/') })).toThrow(/single path segment/);
    }
    expect(calls).toHaveLength(fetches);
  });

  function clientWithSession(): DeepTrueApiClient {
    return new DeepTrueApiClient(
      config,
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
  }

  it.each([
    [300, 'https://evil.example/collect'],
    [301, 'https://evil.example/collect'],
    [302, 'http://api.test:9/v1/organizations/'],
    [303, '//evil.example/collect'],
    [307, 'http://survey.test/v1/org/public/surveys/'],
    [308, 'http://api.test.evil.example/collect'],
  ] as const)(
    'does not request a %s Location on another host',
    async (status, location) => {
      const calls: { url: string; redirect: RequestInit['redirect'] }[] = [];
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), redirect: init?.redirect });
        return new Response(null, { status, headers: { Location: location } });
      }) as typeof fetch;

      await expect(clientWithSession().request({ path: 'organizations/' })).rejects.toThrow(
        /redirect location is a different host/,
      );
      expect(calls).toEqual([{ url: 'http://api.test/v1/organizations/', redirect: 'manual' }]);
    },
  );

  it.each([
    ['http://api.test', 'http://evil.com@api.test/next'],
    ['http://api.test', 'http://user:pass@api.test/next'],
    ['http://api.test', 'http://@api.test/next'],
    ['http://api.test', 'http://api%2etest/next'],
    ['http://api.test', 'http://api.test:80/next'],
    ['http://api.test', 'http://api.test./next'],
    ['http://api.test', 'HTTP://api.test/next'],
    ['http://api.test', 'http://API.test/next'],
    ['http://api.test', 'https://api.test/v1/organizations/canonical/'],
    ['http://api.test', 'http://api.test.evil.example/next'],
    ['https://api.test', 'https://evil.com@api.test/next'],
    ['https://api.test', 'https://api.test:443/next'],
    ['https://api.test', 'http://api.test/next'],
    ['http://127.0.0.1:8001', 'http://evil.com@127.0.0.1:8001/next'],
    ['http://127.0.0.1:8001', 'https://evil.com@127.0.0.1:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.1:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.0.1:8001/next'],
    ['http://127.0.0.1:8001', 'http://0x7f.0.0.1:8001/next'],
    ['http://127.0.0.1:8001', 'http://0x7f000001:8001/next'],
    ['http://127.0.0.1:8001', 'http://2130706433:8001/next'],
    ['http://127.0.0.1:8001', 'http://0177.0.0.1:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.000.000.001:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.0.0.1.:8001/next'],
    ['http://127.0.0.1:8001', 'http://127%2e0%2e0%2e1:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.0.0.1%2e:8001/next'],
    ['http://127.0.0.1:8001', 'http://127.0.0.1:9999/next'],
    ['http://127.0.0.1:8001', 'http://127.0.0.1:08001/next'],
    ['http://127.0.0.1:8001', 'http://127.0.0.1.evil:8001/next'],
    ['http://127.0.0.1:8001', 'http://0x7f.0.0.0x1:8001/next'],
    ['http://127.0.0.1:3100', '//evil.com/path'],
    ['http://127.0.0.1:3100', '/\\evil.com'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100\\@evil.com/x'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100%00.evil.com/'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100%5c@evil.com/x'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/cb%5C@evil.com'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/cb%5c@evil.com'],
    ['http://127.0.0.1:3100', '/cb%5C@evil.com'],
    ['http://127.0.0.1:3100', '/cb%5c@evil.com'],
    ['http://127.0.0.1:3100', '/next%5C'],
    ['http://127.0.0.1:3100', '/next%5c'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/next%5C'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/next%5c'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/next?q=%5C'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100/next?q=%5c'],
    ['http://127.0.0.1:3100', '/%5C%5Cevil.com'],
    ['http://127.0.0.1:3100', '/%5c%5cevil.com'],
  ] as const)(
    'does not follow %s redirect Location %s',
    async (apiBase, location) => {
      const calls: string[] = [];
      global.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, { status: 302, headers: { Location: location } });
      }) as typeof fetch;

      const client = new DeepTrueApiClient(
        loadConfig({
          DEEPTRUE_API_BASE: apiBase,
          DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
        }),
        { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org: 'public' },
      );
      await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
        /redirect location is a different host/,
      );
      expect(calls).toEqual([`${apiBase}/v1/organizations/`]);
    },
  );

  it.each([
    'http://127.0.0.1:3100/next\r\n',
    'http://127.0.0.1\r\n:3100/next',
    '/next\r\n',
    'http://127.0.0.1:3100/next\nhttp://evil.com/',
    'http://127.0.0.1:3100/next\rhttp://evil.com/',
  ])('does not follow a Location containing a raw CR or LF: %j', async (location) => {
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // Fetch Headers rejects an embedded CR/LF, so the follower is given the raw value directly.
      return {
        status: 302,
        headers: { get: () => location },
        body: null,
      } as unknown as Response;
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      loadConfig({
        DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
        DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
      }),
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
      /redirect location is a different host/,
    );
    expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/']);
  });

  it.each([
    'http://127.0.0.1:3100/next\t',
    'http://127.0.0.1:3100/next ',
    ' http://127.0.0.1:3100/next',
    '/next\t',
    '/next ',
    ' /next',
    'http://127.0.0.1\t:3100/next',
    'http://127.0.0.1 :3100/next',
    'http://127.0.0.1:31\t00/next',
    'http://127.0.0.1:31 00/next',
    'http://127.0.0.\t1:3100/next',
    'http://127.0.0. 1:3100/next',
    '\vhttp://127.0.0.1:3100/next',
    'http://127.0.0.1:3100/next\v',
    'http://127.0.0.1:3100/ne\vxt',
    'http://127.0.0.1\v:3100/next',
    '\fhttp://127.0.0.1:3100/next',
    'http://127.0.0.1:3100/next\f',
    'http://127.0.0.1:3100/ne\fxt',
    'http://127.0.0.1\f:3100/next',
    'http://127.0.0.1:3100/next\u0085',
    'http://127.0.0.1:3100/next\u2028',
    'http://127.0.0.1:3100/next\u2029',
    'http://127.0.0.1\u0085:3100/next',
    'http://127.0.0.1\u2028:3100/next',
    'http://127.0.0.1\u2029:3100/next',
    '/next\u0085',
    '/next\u2028',
    '/ne\u0085xt',
    '/ne\u2029xt',
    '\u0085http://127.0.0.1:3100/next',
    '\u2028http://127.0.0.1:3100/next',
    'ht\u0085tp://127.0.0.1:3100/next',
    'ht\u2029tp://127.0.0.1:3100/next',
  ])('does not follow a Location containing stripped whitespace: %j', async (location) => {
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // Fetch Headers drops a trailing tab or space and rejects U+2028 / U+2029,
      // so the follower is given the raw value directly.
      return {
        status: 302,
        headers: { get: () => location },
        body: null,
      } as unknown as Response;
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      loadConfig({
        DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
        DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
      }),
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
      /redirect location is a different host/,
    );
    expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/']);
  });

  const c0OrDelLocations = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14,
    0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f,
  ].flatMap((code) => {
    const ch = String.fromCharCode(code);
    return [
      ch,
      `${ch}http://127.0.0.1:3100/next`,
      `http://127.0.0.1:3100/next${ch}`,
      `http://127.0.0.1:3100/ne${ch}xt`,
      `http://127.0.0.1:3100/next?q=a${ch}b`,
      `http://127.0.0.${ch}1:3100/next`,
      `/ne${ch}xt`,
      `${ch}/next`,
      `http://evil.com${ch}@127.0.0.1:3100/next`,
    ];
  });

  it.each(c0OrDelLocations)(
    'does not follow a Location containing a C0 control or DEL: %j',
    async (location) => {
      const calls: string[] = [];
      global.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        // Fetch Headers rejects NUL and may pass other C0 controls or DEL through,
        // so the follower is given the raw value directly.
        return {
          status: 302,
          headers: { get: () => location },
          body: null,
        } as unknown as Response;
      }) as typeof fetch;

      const client = new DeepTrueApiClient(
        loadConfig({
          DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
          DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
        }),
        { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org: 'public' },
      );
      await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
        /redirect location is a different host/,
      );
      expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/']);
    },
  );

  const encodedC0OrDelLocations = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    0x7f,
  ].flatMap((code) => {
    const lower = `%${code.toString(16).padStart(2, '0')}`;
    const upper = lower.toUpperCase();
    const encodings = lower === upper ? [lower] : [lower, upper];
    return encodings.flatMap((enc) => [
      `http://127.0.0.1:3100/ne${enc}xt`,
      `http://127.0.0.1:3100/next${enc}`,
      `/ne${enc}xt`,
      `${enc}/next`,
      `http://127.0.0.1:3100/next?q=a${enc}b`,
      `/next?q=${enc}`,
    ]);
  });

  it.each(encodedC0OrDelLocations)(
    'does not follow a Location whose C0 control or DEL appears only after one percent-decode: %j',
    async (location) => {
      const calls: string[] = [];
      global.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, { status: 302, headers: { Location: location } });
      }) as typeof fetch;

      const client = new DeepTrueApiClient(
        loadConfig({
          DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
          DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
        }),
        { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org: 'public' },
      );
      await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
        /redirect location is a different host/,
      );
      expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/']);
    },
  );

  const encodedUnicodeLineBreakLocations = [
    '%C2%85',
    '%c2%85',
    '%E2%80%A8',
    '%e2%80%a8',
    '%E2%80%A9',
    '%e2%80%a9',
  ].flatMap((enc) => [
    `http://127.0.0.1:3100/ne${enc}xt`,
    `http://127.0.0.1:3100/next${enc}`,
    `http://127.0.0.1:3100/next${enc}http://evil.com/`,
    `/ne${enc}xt`,
    `${enc}/next`,
    `http://127.0.0.1:3100/next?q=a${enc}b`,
    `/next?q=${enc}`,
  ]);

  it.each(encodedUnicodeLineBreakLocations)(
    'does not follow a Location whose U+0085, U+2028, or U+2029 appears only after one UTF-8 percent-decode: %j',
    async (location) => {
      const calls: string[] = [];
      global.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, { status: 302, headers: { Location: location } });
      }) as typeof fetch;

      const client = new DeepTrueApiClient(
        loadConfig({
          DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
          DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
        }),
        { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org: 'public' },
      );
      await expect(client.request({ path: 'organizations/' })).rejects.toThrow(
        /redirect location is a different host/,
      );
      expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/']);
    },
  );

  it.each([
    ['/next', 'http://127.0.0.1:3100/next'],
    ['http://127.0.0.1:3100/v1/organizations/next/', 'http://127.0.0.1:3100/v1/organizations/next/'],
    ['/ne xt', 'http://127.0.0.1:3100/ne%20xt'],
    ['/next?q=a b', 'http://127.0.0.1:3100/next?q=a%20b'],
    ['http://127.0.0.1:3100/ne xt', 'http://127.0.0.1:3100/ne%20xt'],
    ['http://127.0.0.1:3100/next?q=a b', 'http://127.0.0.1:3100/next?q=a%20b'],
    ['/ne%20xt', 'http://127.0.0.1:3100/ne%20xt'],
    ['/next?q=a%20b', 'http://127.0.0.1:3100/next?q=a%20b'],
    ['http://127.0.0.1:3100/cb%255c@evil.com', 'http://127.0.0.1:3100/cb%255c@evil.com'],
    ['http://127.0.0.1:3100/cb%255C@evil.com', 'http://127.0.0.1:3100/cb%255C@evil.com'],
    ['/cb%255c', 'http://127.0.0.1:3100/cb%255c'],
    ['/next%250a', 'http://127.0.0.1:3100/next%250a'],
    ['http://127.0.0.1:3100/next%250A', 'http://127.0.0.1:3100/next%250A'],
    ['/next?q=%250a', 'http://127.0.0.1:3100/next?q=%250a'],
    ['/ne%85xt', 'http://127.0.0.1:3100/ne%85xt'],
    ['/next%25C2%2585', 'http://127.0.0.1:3100/next%25C2%2585'],
    ['/next%25E2%2580%25A8', 'http://127.0.0.1:3100/next%25E2%2580%25A8'],
    ['http://127.0.0.1:3100/next%25E2%2580%25A8', 'http://127.0.0.1:3100/next%25E2%2580%25A8'],
    ['/next?q=%25E2%2580%25A9', 'http://127.0.0.1:3100/next?q=%25E2%2580%25A9'],
  ] as const)(
    'follows same-origin Location %s from http://127.0.0.1:3100',
    async (location, nextUrl) => {
      const calls: string[] = [];
      global.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (calls.length === 1) {
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new DeepTrueApiClient(
        loadConfig({
          DEEPTRUE_API_BASE: 'http://127.0.0.1:3100',
          DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
        }),
        { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
        { apiKey: 'dt_test', org: 'public' },
      );
      await expect(client.request({ path: 'organizations/' })).resolves.toEqual({ ok: true });
      expect(calls).toEqual(['http://127.0.0.1:3100/v1/organizations/', nextUrl]);
    },
  );

  it('follows a Location whose raw origin is exactly the current request origin', async () => {
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1:8001/v1/organizations/next/' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      loadConfig({
        DEEPTRUE_API_BASE: 'http://127.0.0.1:8001',
        DEEPTRUE_SURVEY_ENGINE_BASE: 'http://127.0.0.1:8050',
      }),
      { token: 'jwt-1', org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_test', org: 'public' },
    );
    await expect(client.request({ path: 'organizations/' })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      'http://127.0.0.1:8001/v1/organizations/',
      'http://127.0.0.1:8001/v1/organizations/next/',
    ]);
  });

  it('does not follow a survey-engine redirect onto the API host', async () => {
    const calls: { url: string; redirect: RequestInit['redirect'] }[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://api.test/v1/organizations/' },
      });
    }) as typeof fetch;

    await expect(
      clientWithSession().request({ base: 'survey', path: 'org/public/surveys/' }),
    ).rejects.toThrow(/redirect location is a different host/);
    expect(calls).toEqual([
      { url: 'http://survey.test/v1/org/public/surveys/', redirect: 'manual' },
    ]);
  });

  it.each([
    [302, 'GET', undefined],
    [307, 'POST', '{"a":1}'],
  ] as const)(
    'follows a same-origin %s and sends the bearer again',
    async (status, nextMethod, nextBody) => {
      const calls: {
        url: string;
        redirect: RequestInit['redirect'];
        authorization: string | null;
        method: string;
        body: BodyInit | null | undefined;
      }[] = [];
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          redirect: init?.redirect,
          authorization: new Headers(init?.headers).get('authorization'),
          method: init?.method ?? 'GET',
          body: init?.body,
        });
        if (calls.length === 1) {
          return new Response(null, {
            status,
            headers: { Location: 'http://api.test/v1/organizations/canonical/' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const data = await clientWithSession().request({
        path: 'organizations/',
        method: 'POST',
        body: { a: 1 },
      });
      expect(data).toEqual({ ok: true });
      expect(calls).toEqual([
        {
          url: 'http://api.test/v1/organizations/',
          redirect: 'manual',
          authorization: 'JWT jwt-1',
          method: 'POST',
          body: '{"a":1}',
        },
        {
          url: 'http://api.test/v1/organizations/canonical/',
          redirect: 'manual',
          authorization: 'JWT jwt-1',
          method: nextMethod,
          body: nextBody,
        },
      ]);
    },
  );

  it('follows a same-host survey-engine redirect and sends the bearer again', async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (calls.length === 1) {
        return new Response(null, {
          status: 308,
          headers: { Location: '/v1/org/public/surveys/canonical/' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const data = await clientWithSession().request({
      base: 'survey',
      path: 'org/public/surveys/',
    });
    expect(data).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: 'http://survey.test/v1/org/public/surveys/',
        authorization: 'JWT jwt-1',
      },
      {
        url: 'http://survey.test/v1/org/public/surveys/canonical/',
        authorization: 'JWT jwt-1',
      },
    ]);
  });

  it('stops a same-host redirect loop after 5 hops', async () => {
    const calls: { url: string; redirect: RequestInit['redirect']; authorization: string | null }[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        redirect: init?.redirect,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (calls.length > 8) {
        return new Response(JSON.stringify({ detail: 'unbounded' }), { status: 500 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://api.test/v1/organizations/' },
      });
    }) as typeof fetch;

    await expect(clientWithSession().request({ path: 'organizations/' })).rejects.toThrow(
      /too many redirects on the configured host/,
    );
    // Initial request plus 5 same-host hops. The next 302 is not followed.
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.url === 'http://api.test/v1/organizations/')).toBe(true);
    expect(calls.every((call) => call.redirect === 'manual')).toBe(true);
    expect(calls.every((call) => call.authorization === 'JWT jwt-1')).toBe(true);
  });

  it('rejects a fetch that never completes when its 60 second deadline is reached', async () => {
    jest.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const urls: string[] = [];
      let releaseFirst: ((response: Response) => void) | undefined;
      global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) return Promise.reject(new Error('missing abort signal'));
        expect(init?.redirect).toBe('manual');
        signals.push(signal);
        urls.push(String(input));
        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => {
            reject(signal.reason);
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
          if (signals.length === 1) releaseFirst = resolve;
        });
      }) as typeof fetch;

      let settled = false;
      const pending = clientWithSession()
        .request({ path: 'organizations/' })
        .finally(() => {
          settled = true;
        });
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'The operation was aborted due to timeout',
      });

      await jest.advanceTimersByTimeAsync(59_999);
      expect(settled).toBe(false);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(false);
      expect(urls).toEqual(['http://api.test/v1/organizations/']);

      if (!releaseFirst) throw new Error('first fetch was not started');
      releaseFirst(
        new Response(null, {
          status: 302,
          headers: { Location: 'http://api.test/v1/organizations/next/' },
        }),
      );
      for (let i = 0; i < 20 && signals.length < 2; i += 1) {
        await Promise.resolve();
      }
      expect(signals).toHaveLength(2);
      expect(signals[0]?.aborted).toBe(false);
      expect(signals[1]?.aborted).toBe(false);
      expect(urls[1]).toBe('http://api.test/v1/organizations/next/');

      // The first hop's deadline has expired. The next hop still has its own 60 seconds.
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(false);
      expect(signals[0]?.aborted).toBe(false);
      expect(signals[1]?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(59_998);
      expect(settled).toBe(false);
      expect(signals[1]?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await assertion;
      expect(signals[0]?.aborted).toBe(false);
      expect(signals[1]?.aborted).toBe(true);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not include a planted Authorization value in a failed call error', async () => {
    const planted = 'planted-auth-value-9f3c';
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      throw new TypeError(`Headers.append: "${authorization}" is an invalid header value.`);
    }) as typeof fetch;

    const client = new DeepTrueApiClient(
      config,
      { token: planted, org: 'public', scopes: ['mcp:read'] },
      { apiKey: 'dt_planted_api_key_9f3c', org: 'public' },
    );

    let caught: unknown;
    try {
      await client.request({ path: 'organizations/' });
    } catch (error) {
      caught = error;
    }

    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toContain(planted);
    expect(message).not.toContain('dt_planted_api_key_9f3c');
    expect(message).not.toContain('Authorization');
    const shown = errorResult(caught);
    expect(shown.content[0]?.text).toBe(message);
    expect(shown.content[0]?.text).not.toContain(planted);
  });
});

describe('resolveSession credentials', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exchanges an HTTP OAuth bearer instead of the process API key', async () => {
    const bodies: unknown[] = [];
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ token: 'jwt-user', organization: 'public', scopes: ['mcp:read'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const configWithKey = loadConfig({
      DEEPTRUE_API_BASE: 'http://api.test',
      DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
      DEEPTRUE_API_KEY: 'dt_server_admin',
      DEEPTRUE_ORG: 'public',
    });
    const material = authMaterialFromHeaders(
      { authorization: 'Bearer oauth-user' },
      { apiKey: configWithKey.apiKey, org: 'public' },
    );
    const client = await createSessionFactory(configWithKey, material)();
    expect(client.scopes).toEqual(['mcp:read']);
    expect(bodies).toEqual([{ access_token: 'oauth-user', organization: 'public' }]);
  });

  it('still uses the process API key when the caller presented no credentials', async () => {
    let body: unknown;
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ token: 'jwt-server', organization: 'public', scopes: ['mcp:read'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const configWithKey = loadConfig({
      DEEPTRUE_API_BASE: 'http://api.test',
      DEEPTRUE_SURVEY_ENGINE_BASE: 'http://survey.test',
      DEEPTRUE_API_KEY: 'dt_server_admin',
    });
    const session = await resolveSession(configWithKey, {});
    expect(session.token).toBe('jwt-server');
    expect(body).toEqual({ api_key: 'dt_server_admin' });
  });
});
