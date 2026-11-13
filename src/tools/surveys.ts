import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, requireWriteConfirm } from '../auth.js';
import { DeepTrueApiClient, encodePathSegment, errorResult, textResult } from '../client/http.js';
import {
  assertSurveyStructurePatch,
  SURVEY_STRUCTURE_PATCH_KEYS,
  surveyStructurePatchSchema,
} from './survey-structure-patch.js';
import { clientForOrganization, organizationField } from './org-context.js';

const allowedPatchFields = [...SURVEY_STRUCTURE_PATCH_KEYS].sort().join(', ');

function assertScope(client: DeepTrueApiClient, scope: string): void {
  if (!hasScope({ token: '', org: client.org, scopes: client.scopes }, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export function registerSurveyTools(
  server: McpServer,
  getClient: () => Promise<DeepTrueApiClient>,
): void {
  server.registerTool(
    'list_surveys',
    {
      title: 'List surveys',
      description: 'List surveys in the active organization via survey-engine.',
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
        assertScope(client, 'mcp:read');
        const data = await client.request({
          base: 'survey',
          path: client.orgPath('surveys/'),
          params: { limit, offset },
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_survey',
    {
      title: 'Get survey',
      description: 'Fetch a survey by uuid from survey-engine.',
      inputSchema: {
        survey_uuid: z.string().describe('Survey UUID'),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ survey_uuid, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        const data = await client.request({
          base: 'survey',
          path: client.orgPath(`surveys/${encodePathSegment(survey_uuid, 'Survey id')}/`),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_survey_structure',
    {
      title: 'Update survey structure',
      description:
        'PATCH an existing survey with a documented survey-engine payload only. Requires confirm=true. Do not invent schema fields.',
      inputSchema: {
        survey_uuid: z.string(),
        patch: surveyStructurePatchSchema.describe(
          `Partial SurveySerializer payload only (${allowedPatchFields})`,
        ),
        confirm: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ survey_uuid, patch, confirm, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:surveys');
        requireWriteConfirm(confirm, 'update_survey_structure');
        const body = assertSurveyStructurePatch(patch);
        const data = await client.request({
          base: 'survey',
          method: 'PATCH',
          path: client.orgPath(`surveys/${encodePathSegment(survey_uuid, 'Survey id')}/`),
          body,
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_survey_statistics',
    {
      title: 'Get survey statistics',
      description: 'Fetch survey statistics by project uuid from survey-engine.',
      inputSchema: {
        project_uuid: z.string().describe('Project UUID used by statistics endpoint'),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_uuid, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        const data = await client.request({
          base: 'survey',
          path: client.orgPath(`surveys/statistics/${encodePathSegment(project_uuid, 'Project id')}/`),
        });
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_respondents',
    {
      title: 'List respondents',
      description:
        'List respondent progress rows for a survey (status, timing, quota, furthest question). PII redacted unless include_pii=true and token has mcp:pii scope.',
      inputSchema: {
        survey_uuid: z.string(),
        include_pii: z.boolean().optional(),
        ...organizationField,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ survey_uuid, include_pii, organization }) => {
      try {
        const client = await clientForOrganization(getClient, organization);
        assertScope(client, 'mcp:read');
        if (include_pii) {
          assertScope(client, 'mcp:pii');
        }
        const data = await client.request<unknown>({
          base: 'survey',
          path: client.orgPath(`surveys/responses/${encodePathSegment(survey_uuid, 'Survey id')}/progress/`),
        });

        if (include_pii) {
          return textResult(data);
        }

        const redact = (row: Record<string, unknown>) => {
          const {
            email: _email,
            first_name: _fn,
            last_name: _ln,
            phone: _phone,
            respondent,
            ...rest
          } = row;
          const respondentSafe =
            respondent && typeof respondent === 'object'
              ? {
                  id: (respondent as Record<string, unknown>).id,
                  status: (respondent as Record<string, unknown>).status,
                }
              : respondent;
          return { ...rest, respondent: respondentSafe };
        };

        if (Array.isArray(data)) {
          return textResult(data.map((row) => (row && typeof row === 'object' ? redact(row as Record<string, unknown>) : row)));
        }
        if (data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)) {
          const payload = data as { results: unknown[]; count?: number };
          return textResult({
            ...payload,
            results: payload.results.map((row) =>
              row && typeof row === 'object' ? redact(row as Record<string, unknown>) : row,
            ),
          });
        }
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
