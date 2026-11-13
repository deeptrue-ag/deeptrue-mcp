export type McpConfig = {
  apiBase: string;
  apiKey?: string;
  org?: string;
  publicUrl: string;
  /** OAuth resource indicator: the MCP endpoint, not the host root. */
  resourceUrl: string;
  oauthIssuerUrl: string;
  port: number;
};

/** Production API origin. `DEEPTRUE_API_BASE` overrides this for deeptrue staff. */
export const DEFAULT_API_ORIGIN = 'https://api.deeptrue.ch';

/** Production MCP HTTP host. `MCP_PUBLIC_URL` overrides this for deeptrue staff. */
export const DEFAULT_MCP_PUBLIC_URL = 'https://mcp.deeptrue.ch';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function ensureV1Base(value: string): string {
  const base = stripTrailingSlash(value);
  return base.endsWith('/v1') ? `${base}/` : `${base}/v1/`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiBase = ensureV1Base(env.DEEPTRUE_API_BASE ?? DEFAULT_API_ORIGIN);
  const publicUrl = stripTrailingSlash(env.MCP_PUBLIC_URL ?? DEFAULT_MCP_PUBLIC_URL);
  const resourceUrl = publicUrl.endsWith('/mcp') ? publicUrl : `${publicUrl}/mcp`;
  const oauthIssuerUrl = stripTrailingSlash(
    env.DEEPTRUE_OAUTH_ISSUER_URL ?? stripTrailingSlash(apiBase.replace(/\/v1\/?$/, '')),
  );

  return {
    apiBase,
    apiKey: env.DEEPTRUE_API_KEY || undefined,
    org: env.DEEPTRUE_ORG || undefined,
    publicUrl,
    resourceUrl,
    oauthIssuerUrl,
    port: Number(env.MCP_PORT ?? env.PORT ?? 3100),
  };
}
