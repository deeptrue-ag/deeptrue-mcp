import type { McpConfig } from './config.js';

export type McpSession = {
  token: string;
  org: string;
  scopes: string[];
  userEmail?: string;
};

export type AuthMaterial = {
  apiKey?: string;
  bearerToken?: string;
  org?: string;
};

/** Domain/slug sent to the session exchange and placed in an API path. */
export const MAX_ORGANIZATION_LENGTH = 128;

export function assertOrganizationLength(org: string): void {
  if (org.length > MAX_ORGANIZATION_LENGTH) {
    throw new Error(`Organization must be at most ${MAX_ORGANIZATION_LENGTH} characters.`);
  }
}

const WRITE_SCOPES = new Set([
  'mcp:write',
  'mcp:projects',
  'mcp:surveys',
  'mcp:fielding',
  'mcp:reports',
]);

/** Not implied by mcp:write — must be granted explicitly. */
const EXPLICIT_ONLY_SCOPES = new Set(['mcp:pii']);

export function hasScope(session: McpSession, scope: string): boolean {
  if (EXPLICIT_ONLY_SCOPES.has(scope)) {
    return session.scopes.includes(scope);
  }
  if (session.scopes.includes('*') || session.scopes.includes('mcp:write')) {
    return true;
  }
  if (scope === 'mcp:read') {
    return session.scopes.length === 0 || session.scopes.includes('mcp:read') || session.scopes.some((s) => WRITE_SCOPES.has(s));
  }
  return session.scopes.includes(scope);
}

export function requireWriteConfirm(confirm: boolean | undefined, action: string): void {
  if (!confirm) {
    throw new Error(`Refusing ${action}: pass confirm=true to proceed.`);
  }
}

function extractBearer(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() || headerValue.trim();
}

export function authMaterialFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallback?: AuthMaterial,
): AuthMaterial {
  const normalize = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const apiKeyHeader = normalize(headers['x-deeptrue-api-key']);
  const authorization = normalize(headers.authorization);
  const bearer = extractBearer(authorization);
  const orgHeader = normalize(headers['x-deeptrue-org']);
  const requestApiKey = apiKeyHeader || (bearer?.startsWith('dt_') ? bearer : undefined);
  const requestBearer = bearer && !bearer.startsWith('dt_') ? bearer : undefined;

  // A presented OAuth bearer is the caller. Do not attach the process API key as well.
  return {
    apiKey: requestApiKey || (requestBearer ? undefined : fallback?.apiKey),
    bearerToken: requestBearer || (requestApiKey ? undefined : fallback?.bearerToken),
    org: orgHeader || fallback?.org,
  };
}

export async function resolveSession(
  config: McpConfig,
  material: AuthMaterial,
): Promise<McpSession> {
  const orgHint = material.org || config.org;
  if (orgHint) {
    assertOrganizationLength(orgHint);
  }
  const body: Record<string, string> = {};

  // Process API key is the stdio fallback only. It must not replace a presented OAuth bearer,
  // or the API is called as the server key (often a broader user and scope set).
  const processKey = config.apiKey;
  const presentedKey = material.apiKey && material.apiKey !== processKey ? material.apiKey : undefined;
  if (material.bearerToken && !presentedKey) {
    body.access_token = material.bearerToken;
  } else if (presentedKey || material.apiKey || processKey) {
    body.api_key = presentedKey || material.apiKey || processKey!;
  } else {
    throw new Error(
      'Missing credentials. Set DEEPTRUE_API_KEY for stdio, or send Authorization / X-DeepTrue-Api-Key for HTTP.',
    );
  }

  if (orgHint) {
    body.organization = orgHint;
  }

  const response = await fetch(new URL('auth/mcp/session/', config.apiBase), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP session exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    token: string;
    organization: string;
    scopes?: string[];
    user?: { email?: string };
  };

  if (!data.token || !data.organization) {
    throw new Error('MCP session exchange returned an incomplete payload.');
  }

  return {
    token: data.token,
    org: data.organization,
    scopes: data.scopes?.length ? data.scopes : ['mcp:read'],
    userEmail: data.user?.email,
  };
}
