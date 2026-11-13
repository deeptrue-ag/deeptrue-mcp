import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { NextFunction, Request, Response } from 'express';
import type { McpConfig } from '../config.js';
import { authMaterialFromHeaders } from '../auth.js';
import { createDeepTrueMcpServer, createSessionFactory } from '../server.js';

function allowedHostnames(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MCP_ALLOWED_HOSTS ?? '127.0.0.1,localhost')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parsePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/**
 * Split a Host header into its raw hostname token and optional port.
 * The token is not URL-normalized, so `127.1`, `127%2e0%2e0%2e1`, and
 * `evil.com@127.0.0.1` stay distinct from `127.0.0.1`.
 */
function splitHostHeader(hostHeader: string): { hostname: string; port?: number } | null {
  const value = hostHeader.trim();
  if (!value) return null;

  if (value.startsWith('[')) {
    const match = /^\[([0-9A-Fa-f:.]+)\](?::([0-9]{1,5}))?$/.exec(value);
    if (!match) return null;
    const hostname = `[${match[1]}]`;
    if (match[2] === undefined) return { hostname };
    const port = parsePort(match[2]);
    if (port === null) return null;
    return { hostname, port };
  }

  const match = /^([^:\s]+)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match?.[1]) return null;
  if (match[2] === undefined) return { hostname: match[1] };
  const port = parsePort(match[2]);
  if (port === null) return null;
  return { hostname: match[1], port };
}

function hostNameAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const candidate = hostname.toLowerCase();
  return allowedHosts.some((host) => host.toLowerCase() === candidate);
}

/**
 * The host token must equal an allowlist entry (ASCII case-insensitive).
 * An explicit `:port` must be the port that accepted the connection, so
 * `localhost:9999` is not treated as `localhost`. A bare allowlisted host
 * stays allowed: a reverse proxy forwards public names without a port.
 * A missing Host is not allowed. Forwarded headers are not read here.
 */
export function isAllowedHostHeader(
  hostHeader: string | string[] | undefined,
  allowedHosts: readonly string[],
  listenPort: number,
): boolean {
  if (typeof hostHeader !== 'string') return false;
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) return false;
  const parsed = splitHostHeader(hostHeader);
  if (!parsed || !hostNameAllowed(parsed.hostname, allowedHosts)) return false;
  if (parsed.port === undefined) return true;
  return parsed.port === listenPort;
}

function hostWithServerPort(host: string, port: number): string {
  if (host.startsWith('[')) {
    return host.includes(']:') ? host : `${host}:${port}`;
  }
  return host.includes(':') ? host : `${host}:${port}`;
}

/** Origins a browser may send: the public URL, plus each allowlisted host on this server's port. */
export function serverOwnOrigins(config: McpConfig, allowedHosts: readonly string[]): Set<string> {
  const origins = new Set<string>();
  let protocol = 'http:';
  try {
    const published = new URL(config.publicUrl);
    protocol = published.protocol;
    origins.add(published.origin);
  } catch {
    // A malformed public URL contributes no origin.
  }
  for (const host of allowedHosts) {
    try {
      origins.add(new URL(`${protocol}//${hostWithServerPort(host, config.port)}`).origin);
    } catch {
      // Skip a malformed allowlist entry.
    }
  }
  return origins;
}

/**
 * Missing Origin is a non-browser client. Any other value must equal a
 * configured origin exactly. The header is not parsed, so a URL alias cannot
 * be rewritten into an allowed origin. Forwarded headers are not read here.
 */
export function isAllowedBrowserOrigin(
  origin: string | undefined,
  ownOrigins: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  return ownOrigins.has(origin);
}

function oauthProtectedResourceMetadata(config: McpConfig) {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.oauthIssuerUrl],
    scopes_supported: [
      'mcp:read',
      'mcp:projects',
      'mcp:surveys',
      'mcp:fielding',
      'mcp:reports',
      'mcp:write',
      'mcp:pii',
    ],
    resource_name: 'DeepTrue MCP',
    bearer_methods_supported: ['header'],
  };
}

export function createHttpApp(config: McpConfig) {
  const bindHost = process.env.MCP_BIND_HOST ?? '127.0.0.1';
  const allowedHosts = allowedHostnames();
  const ownOrigins = serverOwnOrigins(config, allowedHosts);
  const app = createMcpExpressApp({
    host: bindHost,
    allowedHosts,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const listenPort = req.socket.localPort;
    if (listenPort === undefined || !isAllowedHostHeader(req.headers.host, allowedHosts, listenPort)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid Host header' },
        id: null,
      });
      return;
    }
    next();
  });

  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json(oauthProtectedResourceMetadata(config));
  });

  app.get(/^\/\.well-known\/oauth-protected-resource\/.*/, (_req, res) => {
    res.json(oauthProtectedResourceMetadata(config));
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'deeptrue-mcp' });
  });

  const handleMcp = async (req: Request, res: Response) => {
    // DNS rebinding: a browser on another origin can still send Host: localhost.
    if (!isAllowedBrowserOrigin(req.headers.origin, ownOrigins)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Forbidden: Origin is not allowed' },
        id: null,
      });
      return;
    }

    const material = authMaterialFromHeaders(req.headers as Record<string, string | string[] | undefined>, {
      apiKey: config.apiKey,
      org: config.org,
    });

    if (!material.apiKey && !material.bearerToken && !config.apiKey) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer realm="deeptrue-mcp", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized: provide OAuth bearer token or DeepTrue API key' },
        id: null,
      });
      return;
    }

    const server = createDeepTrueMcpServer(config, {
      getClient: createSessionFactory(config, material),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP HTTP error', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    } finally {
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  };

  app.post('/mcp', handleMcp);
  app.get('/mcp', async (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for stateless Streamable HTTP.' },
      id: null,
    });
  });
  app.delete('/mcp', async (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  return app;
}

export async function startHttpServer(config: McpConfig): Promise<void> {
  const app = createHttpApp(config);
  const bindHost = process.env.MCP_BIND_HOST ?? '127.0.0.1';
  await new Promise<void>((resolve) => {
    app.listen(config.port, bindHost, () => {
      console.error(`DeepTrue MCP listening on http://${bindHost}:${config.port}/mcp`);
      resolve();
    });
  });
}
