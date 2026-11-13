import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authMaterialFromHeaders, resolveSession, type AuthMaterial, type McpSession } from './auth.js';
import { DeepTrueApiClient } from './client/http.js';
import type { McpConfig } from './config.js';
import { registerOrgTools } from './tools/orgs.js';
import { registerPanelTools } from './tools/panels.js';
import { registerProjectTools } from './tools/projects.js';
import { registerReportTools } from './tools/reports.js';
import { registerSurveyTools } from './tools/surveys.js';

export const SERVER_INSTRUCTIONS = [
  'DeepTrue research assistant MCP.',
  'Typical project sequence: create_project → submit_briefing_answers → accept_project → start_fielding → finish_fielding.',
  'Mutating tools require confirm=true and write scopes (mcp:write or a finer write scope).',
  'Organization is per request: pass the organization argument or send X-DeepTrue-Org. set_active_organization does not stick on stateless HTTP.',
  'Do not invent API fields; prefer get_project / get_survey before updates.',
  'Respondent tools redact PII unless include_pii=true and the token has mcp:pii (not granted by mcp:write).',
  'Remote OpenAI/ChatGPT connectors must use OAuth bearer tokens; do not configure API keys (dt_…) for ChatGPT.',
].join(' ');

export type SessionFactory = (material?: AuthMaterial) => Promise<DeepTrueApiClient>;

export function createSessionFactory(config: McpConfig, fixed?: AuthMaterial): SessionFactory {
  let cached: { key: string; client: DeepTrueApiClient } | undefined;

  return async (material?: AuthMaterial) => {
    const bearerToken = material?.bearerToken ?? fixed?.bearerToken;
    const explicitApiKey = material?.apiKey ?? fixed?.apiKey;
    // Do not fill the process API key when this request already presented an OAuth bearer.
    const merged: AuthMaterial = {
      apiKey: explicitApiKey || (bearerToken ? undefined : config.apiKey),
      bearerToken,
      org: material?.org ?? fixed?.org ?? config.org,
    };
    const cacheKey = JSON.stringify(merged);
    // A different key or bearer misses this slot. A 401 clears it so the rejected
    // JWT is not reused; the next call has to exchange again.
    if (cached?.key === cacheKey && cached.client.hasSessionToken) {
      return cached.client;
    }
    cached = undefined;
    const session: McpSession = await resolveSession(config, merged);
    let client!: DeepTrueApiClient;
    client = new DeepTrueApiClient(config, session, merged, {
      onUnauthorized: () => {
        if (cached?.client === client) cached = undefined;
      },
      onRefreshed: (refreshed) => {
        if (refreshed === client && (cached === undefined || cached.client === client)) {
          cached = { key: cacheKey, client };
        }
      },
    });
    cached = { key: cacheKey, client };
    return client;
  };
}

export function createDeepTrueMcpServer(
  config: McpConfig,
  options?: { getClient?: SessionFactory; authMaterial?: AuthMaterial },
): McpServer {
  const getClient = options?.getClient ?? createSessionFactory(config, options?.authMaterial);

  const server = new McpServer(
    {
      name: 'deeptrue',
      version: '0.1.0',
      websiteUrl: 'https://www.deeptrue.ch',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerOrgTools(server, getClient);
  registerProjectTools(server, getClient);
  registerSurveyTools(server, getClient);
  registerPanelTools(server, getClient);
  registerReportTools(server, getClient);

  return server;
}

export function sessionFactoryFromHttpHeaders(
  config: McpConfig,
  headers: Record<string, string | string[] | undefined>,
): SessionFactory {
  const material = authMaterialFromHeaders(headers, {
    apiKey: config.apiKey,
    org: config.org,
  });
  return createSessionFactory(config, material);
}
