import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpConfig } from '../src/config.js';
import { createHttpApp, isAllowedHostHeader } from '../src/transports/http.js';

const allowedHosts = ['127.0.0.1', 'localhost', 'mcp.dev.deeptrue.ch'];
const listenPort = 3100;

describe('isAllowedHostHeader', () => {
  it('allows an exact host on the listening port, and a bare public host', () => {
    expect(isAllowedHostHeader('localhost:3100', allowedHosts, listenPort)).toBe(true);
    expect(isAllowedHostHeader('127.0.0.1:3100', allowedHosts, listenPort)).toBe(true);
    expect(isAllowedHostHeader('LocalHost:3100', allowedHosts, listenPort)).toBe(true);
    expect(isAllowedHostHeader('mcp.dev.deeptrue.ch', allowedHosts, listenPort)).toBe(true);
    expect(isAllowedHostHeader('localhost', allowedHosts, listenPort)).toBe(true);
  });

  it('rejects a foreign host, a trailing dot, and an unexpected port', () => {
    expect(isAllowedHostHeader('localhost.evil.com', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('localhost.evil.com:3100', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('localhost.', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('localhost.:3100', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('evil.com', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('localhost:9999', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1:80', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1:evil.com', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader(undefined, allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('', allowedHosts, listenPort)).toBe(false);
    expect(isAllowedHostHeader('   ', allowedHosts, listenPort)).toBe(false);
  });

  it('rejects a different spelling, a shared prefix or suffix, and a port-less foreign host', () => {
    const names = ['allowed.example', '127.0.0.1', 'localhost'];
    expect(isAllowedHostHeader('allowed.example.evil', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('allowed.example.evil:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('evil.allowed.example', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1.evil', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1.evil:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.1:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('0x7f.0.0.1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('2130706433', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('0177.0.0.1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.000.000.001', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.000.000.001:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1.', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1.:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127%2e0%2e0%2e1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127%2e0%2e0%2e1:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('evil.com@127.0.0.1', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('evil.com@127.0.0.1:3100', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('localhost\\@evil.com', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1/.evil', names, listenPort)).toBe(false);
    expect(isAllowedHostHeader('evil.com', names, listenPort)).toBe(false);
  });
});

describe('HTTP Host allowlist', () => {
  let server: http.Server;
  let port = 0;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const config: McpConfig = {
    apiBase: 'http://127.0.0.1:8001/v1/',
    surveyEngineBase: 'http://127.0.0.1:8050/v1/',
    publicUrl: 'http://127.0.0.1:3100',
    resourceUrl: 'http://127.0.0.1:3100/mcp',
    oauthIssuerUrl: 'http://127.0.0.1:8001',
    port: 3100,
  };

  beforeAll(async () => {
    process.env.MCP_ALLOWED_HOSTS = '127.0.0.1,localhost';
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

  function request(
    method: 'GET' | 'POST',
    path: string,
    host: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; message?: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: { Host: host, ...extraHeaders },
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
      if (method === 'POST') req.end('{}');
      else req.end();
    });
  }

  function get(host: string): Promise<{ status: number; message?: string }> {
    return request('GET', '/healthz', host);
  }

  function postMcp(
    host: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; message?: string }> {
    return request('POST', '/mcp', host, {
      'content-type': 'application/json',
      ...extraHeaders,
    });
  }

  it('rejects an explicit port that is not the connection port', async () => {
    const result = await get('localhost:9999');
    expect(result.status).toBe(403);
    expect(result.message).toBe('Invalid Host header');
  });

  it('allows the host on the port that accepted the connection', async () => {
    expect((await get(`127.0.0.1:${port}`)).status).toBe(200);
    expect((await get('localhost')).status).toBe(200);
  });

  it('rejects a mismatched Host on POST /mcp before the handler', async () => {
    const forwarded = {
      'x-forwarded-host': `127.0.0.1:${port}`,
      'x-forwarded-proto': 'https',
      forwarded: `host=127.0.0.1:${port};proto=https`,
    };
    for (const host of ['127.1', `127.1:${port}`, '127.0.0.1.evil', 'evil.com@127.0.0.1', 'localhost.evil.com']) {
      const result = await postMcp(host, forwarded);
      expect(result.status).toBe(403);
      expect(result.message === 'Invalid Host header' || result.message?.startsWith('Invalid Host')).toBe(true);
    }
  });

  it('lets an allowlisted host with the listening port reach the auth challenge', async () => {
    const result = await postMcp(`127.0.0.1:${port}`, {
      'x-forwarded-host': 'evil.com',
      'x-forwarded-proto': 'http',
      forwarded: 'host=evil.com',
    });
    expect(result.status).toBe(401);
  });
});
