import { z } from 'zod';

/**
 * Writable survey fields accepted by PATCH /v1/org/<org>/surveys/<uuid>/.
 * Source: engine.surveys.serializers.SurveySerializer Meta (excludes read_only uuid, project_uuid).
 */
export const SURVEY_STRUCTURE_PATCH_KEYS = new Set(['id', 'name', 'json', 'survey_template_uuid']);

/**
 * UTF-8 size of the survey `json` value. Stdio has no express body limit, so the
 * tool schema rejects a larger value before a request is built.
 */
export const MAX_SURVEY_JSON_BYTES = 100_000;

function surveyJsonUtf8Bytes(json: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(json);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Survey json must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function assertSurveyJsonWithinLimit(json: unknown): void {
  const bytes = surveyJsonUtf8Bytes(json);
  if (bytes > MAX_SURVEY_JSON_BYTES) {
    throw new Error(`Survey json must be at most ${MAX_SURVEY_JSON_BYTES} bytes.`);
  }
}

/**
 * UTF-8 size of the survey `name` value copied into the survey PATCH.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_SURVEY_NAME_BYTES = 100_000;

function surveyNameUtf8Bytes(name: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(name);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Survey name must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function assertSurveyName<T>(name: T): T {
  const bytes = surveyNameUtf8Bytes(name);
  if (bytes > MAX_SURVEY_NAME_BYTES) {
    throw new Error(`Survey name must be at most ${MAX_SURVEY_NAME_BYTES} bytes.`);
  }
  return name;
}

/**
 * UTF-8 size of the survey `id` value copied into the survey PATCH.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_SURVEY_ID_BYTES = 100_000;

function surveyIdUtf8Bytes(id: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(id);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Survey id must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function assertSurveyId<T>(id: T): T {
  const bytes = surveyIdUtf8Bytes(id);
  if (bytes > MAX_SURVEY_ID_BYTES) {
    throw new Error(`Survey id must be at most ${MAX_SURVEY_ID_BYTES} bytes.`);
  }
  return id;
}

/**
 * UTF-8 size of the survey `survey_template_uuid` value copied into the survey PATCH.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_SURVEY_TEMPLATE_UUID_BYTES = 100_000;

function surveyTemplateUuidUtf8Bytes(surveyTemplateUuid: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(surveyTemplateUuid);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Survey template uuid must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function assertSurveyTemplateUuid<T>(surveyTemplateUuid: T): T {
  const bytes = surveyTemplateUuidUtf8Bytes(surveyTemplateUuid);
  if (bytes > MAX_SURVEY_TEMPLATE_UUID_BYTES) {
    throw new Error(`Survey template uuid must be at most ${MAX_SURVEY_TEMPLATE_UUID_BYTES} bytes.`);
  }
  return surveyTemplateUuid;
}

export const surveyStructurePatchSchema = z.record(z.unknown()).superRefine((patch, ctx) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'json')) {
    try {
      assertSurveyJsonWithinLimit(patch.json);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json'],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    try {
      assertSurveyName(patch.name);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'id')) {
    try {
      assertSurveyId(patch.id);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'survey_template_uuid')) {
    try {
      assertSurveyTemplateUuid(patch.survey_template_uuid);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['survey_template_uuid'],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

export function assertSurveyStructurePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new Error('patch must include at least one survey field.');
  }
  const unknown = keys.filter((key) => !SURVEY_STRUCTURE_PATCH_KEYS.has(key));
  if (unknown.length > 0) {
    const allowed = [...SURVEY_STRUCTURE_PATCH_KEYS].sort().join(', ');
    throw new Error(
      `Unsupported survey patch field(s): ${unknown.join(', ')}. Allowed fields: ${allowed}.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'json')) {
    assertSurveyJsonWithinLimit(patch.json);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    assertSurveyName(patch.name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'id')) {
    assertSurveyId(patch.id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'survey_template_uuid')) {
    assertSurveyTemplateUuid(patch.survey_template_uuid);
  }
  return patch;
}
