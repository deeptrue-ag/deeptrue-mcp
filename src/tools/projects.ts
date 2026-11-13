import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, requireWriteConfirm } from '../auth.js';
import { DeepTrueApiClient, encodePathSegment, errorResult, textResult } from '../client/http.js';
import { acceptAnswersSchema, assertAcceptAnswers } from './accept-answers.js';
import { acceptProductSlugSchema, assertAcceptProductSlug } from './accept-product-slug.js';
import { assertBriefingAnswers, briefingAnswersSchema } from './briefing-answers.js';
import { clientForOrganization, organizationField } from './org-context.js';
import { assertProjectBody, projectBodyObjectSchema, projectBodyStringSchema } from './project-body.js';

function assertScope(client: DeepTrueApiClient, scope: string): void {
  if (!hasScope({ token: '', org: client.org, scopes: client.scopes }, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export function registerProjectTools(
  server: McpServer,
  getClient: () => Promise<DeepTrueApiClient>,
): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List DeepTrue projects in the active organization. Use for inventory and status scans.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
        search: z.string().max(200).optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, offset, search, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        const data = await client.request({
          path: client.orgPath('projects/'),
          params: { limit, offset, search },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Fetch a single project by numeric id. Use before lifecycle or briefing changes.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]).describe('Project id'),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        const data = await client.request({ path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/`) });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a project in the active organization. Use when starting a new research brief. Requires mcp:write.',
      inputSchema: {
        name: projectBodyStringSchema.describe('Project name'),
        product_slug: projectBodyStringSchema.optional().describe('Product slug when known'),
        json: projectBodyObjectSchema.optional().describe('Initial briefing answers JSON'),
        confirm: z.boolean().optional().describe('Must be true to create'),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ name, product_slug, json, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'create_project');
        const data = await client.request({
          method: 'POST',
          path: client.orgPath('projects/'),
          body: {
            name: assertProjectBody(name),
            product_slug: product_slug === undefined ? undefined : assertProjectBody(product_slug),
            json: json === undefined ? undefined : assertProjectBody(json),
          },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description: 'PATCH project fields (name/json/etc). Use for briefing answer edits before accept.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        patch: projectBodyObjectSchema.describe('Partial project payload'),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ project_id, patch, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'update_project');
        const data = await client.request({
          method: 'PATCH',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/`),
          body: assertProjectBody(patch),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_briefing',
    {
      title: 'Get briefing answers',
      description: 'Read flattened briefing answers JSON for a project.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        const data = await client.request({
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/briefing-answers-json/`),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'submit_briefing_answers',
    {
      title: 'Submit briefing answers',
      description:
        'PATCH project.json with briefing answers. Use before accept_project. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        answers: briefingAnswersSchema.describe('Briefing answers object stored on project.json'),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ project_id, answers, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'submit_briefing_answers');
        const briefingAnswers = assertBriefingAnswers(answers);
        const data = await client.request({
          method: 'PATCH',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/`),
          body: { json: briefingAnswers },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'accept_project',
    {
      title: 'Accept project',
      description:
        'Accept a project offer and spawn the survey. Sequence: briefing → accept → collect. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        product_slug: acceptProductSlugSchema.optional(),
        answers: acceptAnswersSchema.optional().describe('Optional briefing answers override (json)'),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ project_id, product_slug, answers, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'accept_project');
        const data = await client.request({
          method: 'PATCH',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/accept/`),
          body: {
            product_slug: product_slug === undefined ? undefined : assertAcceptProductSlug(product_slug),
            json: answers === undefined ? undefined : assertAcceptAnswers(answers),
          },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'start_fielding',
    {
      title: 'Start fielding',
      description: 'Begin data collection (collect) for an accepted project. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ project_id, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:fielding');
        requireWriteConfirm(confirm, 'start_fielding');
        const data = await client.request({
          method: 'POST',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/collect/`),
          body: {},
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'finish_fielding',
    {
      title: 'Finish fielding',
      description: 'Finish a project that is collecting data. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ project_id, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:fielding');
        requireWriteConfirm(confirm, 'finish_fielding');
        const data = await client.request({
          method: 'POST',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/finish/`),
          body: {},
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'archive_project',
    {
      title: 'Archive project',
      description: 'Archive a project. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ project_id, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'archive_project');
        const data = await client.request({
          method: 'PATCH',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/archive/`),
          body: {},
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'restore_project',
    {
      title: 'Restore project',
      description: 'Restore an archived project. Requires confirm=true.',
      inputSchema: {
        project_id: z.union([z.string(), z.number()]),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ project_id, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:write');
        requireWriteConfirm(confirm, 'restore_project');
        const data = await client.request({
          method: 'PATCH',
          path: client.orgPath(`projects/${encodePathSegment(project_id, 'Project id')}/restore/`),
          body: {},
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
