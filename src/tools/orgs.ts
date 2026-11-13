import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, MAX_ORGANIZATION_LENGTH } from '../auth.js';
import { DeepTrueApiClient, errorResult, textResult } from '../client/http.js';
import { ACTIVE_ORG_DOES_NOT_PERSIST, clientForOrganization, organizationField } from './org-context.js';

export function registerOrgTools(server: McpServer, getClient: () => Promise<DeepTrueApiClient>): void {
  server.registerTool(
    'list_organizations',
    {
      title: 'List organizations',
      description:
        'List organizations available to the authenticated DeepTrue user. Use when choosing an org context.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const client = await getClient();
        if (!hasScope({ token: '', org: client.org, scopes: client.scopes }, 'mcp:read')) {
          throw new Error('Missing mcp:read scope');
        }
        const data = await client.request({ path: 'organizations/' });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_organization',
    {
      title: 'Get organization',
      description:
        'Get organization address/info for one organization domain/slug. The choice applies only to this call.',
      inputSchema: {
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        const org = client.org;
        const info = await client.request({
          path: client.orgPath('organizations/info/'),
        });
        return textResult({ organization: org, info });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'set_active_organization',
    {
      title: 'Check organization',
      description:
        'Validate that the user can use an organization. Does not persist across stateless HTTP requests. Pass organization on later tools or send X-DeepTrue-Org / DEEPTRUE_ORG.',
      inputSchema: {
        organization: z
          .string()
          .max(MAX_ORGANIZATION_LENGTH)
          .describe('Organization domain/slug (URL org name).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        return textResult({
          organization: client.org,
          persisted: false,
          message: ACTIVE_ORG_DOES_NOT_PERSIST,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
