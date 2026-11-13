import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope } from '../auth.js';
import { DeepTrueApiClient, errorResult, textResult } from '../client/http.js';
import { adminRouteError, resolvePanelPath } from './panel-routes.js';

function assertScope(client: DeepTrueApiClient, scope: string): void {
  if (!hasScope({ token: '', org: client.org, scopes: client.scopes }, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export function registerPanelTools(
  server: McpServer,
  getClient: () => Promise<DeepTrueApiClient>,
): void {
  server.registerTool(
    'get_feasibility',
    {
      title: 'Get panel feasibility / status',
      description:
        'Fetch a provider ops snapshot from the existing admin routes (cint/status, dynata/status, bilendi/projects). These routes return 403 for non-admins. There is no separate member feasibility route.',
      inputSchema: {
        provider: z
          .enum(['cint', 'bilendi', 'dynata'])
          .optional()
          .describe('Panel provider (default cint)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider }) => {
      const selected = provider ?? 'cint';
      const resource = selected === 'bilendi' ? 'projects' : 'status';
      let path = `${selected}/${resource}/`;
      try {
        const client = await getClient();
        assertScope(client, 'mcp:fielding');
        path = resolvePanelPath(selected, resource);
        const data = await client.request({
          path,
          ...(selected === 'bilendi' ? { params: { limit: 1 } } : {}),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(adminRouteError(error, `GET ${path}`));
      }
    },
  );

  server.registerTool(
    'list_panel_projects',
    {
      title: 'List panel projects / demands',
      description:
        'List Cint demands or audit, Bilendi projects or audit, or Dynata projects or audit. These routes require a deeptrue admin. A 403 is an admin refusal, not an empty list.',
      inputSchema: {
        provider: z.enum(['cint', 'bilendi', 'dynata']).optional(),
        resource: z
          .enum(['demands', 'audit', 'projects', 'target-groups'])
          .optional()
          .describe('Panel resource the deeptrue API exposes for this provider'),
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider, resource, limit, offset }) => {
      const selected = provider ?? 'cint';
      const res = resource ?? (selected === 'cint' ? 'demands' : 'projects');
      let path = `${selected}/${res}/`;
      try {
        const client = await getClient();
        assertScope(client, 'mcp:fielding');
        path = resolvePanelPath(selected, res);
        const data = await client.request({
          path,
          params: { limit, offset },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(adminRouteError(error, `GET ${path}`));
      }
    },
  );
}
