import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpConfig } from '../src/config.js';
import {
  createHttpApp,
  isAllowedBrowserOrigin,
  serverOwnOrigins,
} from '../src/transports/http.js';

const aliasOrigins = [
  'HTTP://LocalHost:3100',
  'http://evil.com@127.0.0.1:3100',
  'https://evil.com@127.0.0.1:3100',
  'http://127.1:3100',
  'http://127.0.1:3100',
  'http://0x7f.0.0.1:3100',
  'http://2130706433:3100',
  'http://0177.0.0.1:3100',
  'http://127.000.000.001:3100',
  'http://127.0.0.1.:3100',
  'http://localhost.:3100',
  'http://127%2e0%2e0%2e1:3100',
  'http://127.0.0.1:9999',
  'http://127.0.0.1.evil:3100',
  'http://localhost.evil.com:3100',
  'http://127.0.0.1:3100/',
];

const config: McpConfig = {
  apiBase: 'http://127.0.0.1:8001/v1/',
  surveyEngineBase: 'http://127.0.0.1:8050/v1/',
  publicUrl: 'http://127.0.0.1:3100',
  resourceUrl: 'http://127.0.0.1:3100/mcp',
  oauthIssuerUrl: 'http://127.0.0.1:8001',
  port: 3100,
};

const allowedHosts = ['127.0.0.1', 'localhost'];

describe('serverOwnOrigins', () => {
  const origins = serverOwnOrigins(config, allowedHosts);

  it('allows a missing Origin and this server’s own origins', () => {
    expect(isAllowedBrowserOrigin(undefined, origins)).toBe(true);
    expect(isAllowedBrowserOrigin('http://127.0.0.1:3100', origins)).toBe(true);
    expect(isAllowedBrowserOrigin('http://localhost:3100', origins)).toBe(true);
  });

  it('rejects a foreign, opaque, or wrong-port Origin', () => {
    expect(isAllowedBrowserOrigin('https://evil.example', origins)).toBe(false);
    expect(isAllowedBrowserOrigin('null', origins)).toBe(false);
    expect(isAllowedBrowserOrigin('http://localhost:9999', origins)).toBe(false);
    expect(isAllowedBrowserOrigin('', origins)).toBe(false);
    expect(isAllowedBrowserOrigin('not a url', origins)).toBe(false);
  });

  it('rejects a normalized alias that is not the exact origin', () => {
    for (const origin of aliasOrigins) {
      expect(isAllowedBrowserOrigin(origin, origins)).toBe(false);
    }
    expect(isAllowedBrowserOrigin(' http://127.0.0.1:3100', origins)).toBe(false);
    expect(isAllowedBrowserOrigin('http://127.0.0.1:3100 ', origins)).toBe(false);
  });
});

describe('POST /mcp Origin', () => {
  let server: http.Server;
  let port = 0;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;

  beforeAll(async () => {
    process.env.MCP_ALLOWED_HOSTS = allowedHosts.join(',');
    const app = createHttpApp(config);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (previousAllowedHosts === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function post(origin?: string): Promise<{ status: number; message?: string }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (origin !== undefined) headers.origin = origin;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const body = (await response.json()) as { error?: { message?: string } };
    return { status: response.status, message: body.error?.message };
  }

  function postRaw(
    headers: Record<string, string>,
  ): Promise<{ status: number; message?: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: `127.0.0.1:${port}`,
            'content-type': 'application/json',
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              error?: { message?: string };
            };
            resolve({ status: res.statusCode ?? 0, message: body.error?.message });
          });
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
  }

  it('rejects a browser Origin that is not this server', async () => {
    const result = await post('https://evil.example');
    expect(result.status).toBe(403);
    expect(result.message).toBe('Forbidden: Origin is not allowed');
  });

  it('allows a missing Origin for non-browser clients', async () => {
    const result = await post();
    expect(result.status).toBe(401);
  });

  it('allows the server’s own origin', async () => {
    expect((await post('http://127.0.0.1:3100')).status).toBe(401);
    expect((await post('http://localhost:3100')).status).toBe(401);
  });

  it('rejects a normalized Origin alias before the MCP handler', async () => {
    for (const origin of aliasOrigins) {
      const result = await postRaw({ Origin: origin });
      expect(result.status).toBe(403);
      expect(result.message).toBe('Forbidden: Origin is not allowed');
    }
  });

  it('does not let forwarded headers supply the Origin', async () => {
    const forwarded = {
      'x-forwarded-host': '127.0.0.1:3100',
      'x-forwarded-proto': 'http',
      forwarded: 'host=127.0.0.1:3100;proto=http',
    };
    expect((await postRaw(forwarded)).status).toBe(401);
    const aliased = await postRaw({ ...forwarded, Origin: 'http://127.1:3100' });
    expect(aliased.status).toBe(403);
    expect(aliased.message).toBe('Forbidden: Origin is not allowed');
  });
});
