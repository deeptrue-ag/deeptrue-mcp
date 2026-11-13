export type McpConfig = {
  apiBase: string;
  surveyEngineBase: string;
  apiKey?: string;
  org?: string;
  publicUrl: string;
  /** OAuth resource indicator: the MCP endpoint, not the host root. */
  resourceUrl: string;
  oauthIssuerUrl: string;
  port: number;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function ensureV1Base(value: string): string {
  const base = stripTrailingSlash(value);
  return base.endsWith('/v1') ? `${base}/` : `${base}/v1/`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiBase = ensureV1Base(env.DEEPTRUE_API_BASE ?? 'http://127.0.0.1:8001');
  const surveyEngineBase = ensureV1Base(
    env.DEEPTRUE_SURVEY_ENGINE_BASE ?? 'http://127.0.0.1:8050',
  );
  const publicUrl = stripTrailingSlash(env.MCP_PUBLIC_URL ?? 'http://127.0.0.1:3100');
  const resourceUrl = publicUrl.endsWith('/mcp') ? publicUrl : `${publicUrl}/mcp`;
  const oauthIssuerUrl = stripTrailingSlash(
    env.DEEPTRUE_OAUTH_ISSUER_URL ?? stripTrailingSlash(apiBase.replace(/\/v1\/?$/, '')),
  );

  return {
    apiBase,
    surveyEngineBase,
    apiKey: env.DEEPTRUE_API_KEY || undefined,
    org: env.DEEPTRUE_ORG || undefined,
    publicUrl,
    resourceUrl,
    oauthIssuerUrl,
    port: Number(env.MCP_PORT ?? env.PORT ?? 3100),
  };
}
