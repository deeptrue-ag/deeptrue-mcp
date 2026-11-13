import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, requireWriteConfirm } from '../auth.js';
import { DeepTrueApiClient, encodePathSegment, errorResult, textResult } from '../client/http.js';
import { adminRouteError } from './panel-routes.js';
import { clientForOrganization, organizationField } from './org-context.js';
import { assertReportHtml, reportHtmlSchema } from './report-html.js';

function assertScope(client: DeepTrueApiClient, scope: string): void {
  if (!hasScope({ token: '', org: client.org, scopes: client.scopes }, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export function registerReportTools(
  server: McpServer,
  getClient: () => Promise<DeepTrueApiClient>,
): void {
  server.registerTool(
    'list_reports',
    {
      title: 'List report files',
      description: 'List report files for the active organization.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, offset, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:reports');
        const data = await client.request({
          path: client.orgPath('projects/reports/'),
          params: { limit, offset },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get report file',
      description: 'Fetch a report file by id.',
      inputSchema: {
        report_id: z.union([z.string(), z.number()]),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ report_id, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:reports');
        const data = await client.request({
          path: client.orgPath(`projects/reports/${encodePathSegment(report_id, 'Report id')}/`),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_report_layouts',
    {
      title: 'Get report layouts',
      description: 'Read project report layouts for audience admin or org.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        audience: z.enum(['admin', 'org']).default('org'),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id, audience, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:reports');
        const path = client.orgPath(
          `projects/${encodePathSegment(project_id, 'Project id')}/report-layouts/${encodePathSegment(audience, 'Audience')}/`,
        );
        const data = await client.request({ path });
        return textResult(data);
      } catch (error) {
        if (audience === 'admin') {
          return errorResult(adminRouteError(error, 'GET report-layouts/admin'));
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'trigger_report_refresh',
    {
      title: 'Save report HTML snapshot',
      description:
        'POST project report HTML via projects/{id}/report/. That route is limited to deeptrue admins. Requires confirm=true. A 403 means the account is not an admin; nothing was saved.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        html: reportHtmlSchema.describe('Report HTML payload accepted by projects/{id}/report/'),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ project_id, html, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:reports');
        requireWriteConfirm(confirm, 'trigger_report_refresh');
        const data = await client.request({
          method: 'POST',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/report/`),
          body: assertReportHtml(html),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(adminRouteError(error, 'POST projects/{id}/report/'));
      }
    },
  );
}
