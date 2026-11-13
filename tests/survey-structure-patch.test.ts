import {
  assertSurveyStructurePatch,
  MAX_SURVEY_ID_BYTES,
  MAX_SURVEY_JSON_BYTES,
  MAX_SURVEY_NAME_BYTES,
  MAX_SURVEY_TEMPLATE_UUID_BYTES,
  SURVEY_STRUCTURE_PATCH_KEYS,
} from '../src/tools/survey-structure-patch.js';

function surveyJsonOfByteLength(bytes: number): { pages: string } {
  const prefix = '{"pages":"';
  const suffix = '"}';
  const filler = bytes - Buffer.byteLength(prefix + suffix, 'utf8');
  return { pages: 'p'.repeat(filler) };
}

describe('assertSurveyStructurePatch', () => {
  it('accepts SurveySerializer writable fields', () => {
    const patch = { name: 'Wave 2', json: { pages: [] } };
    expect(assertSurveyStructurePatch(patch)).toBe(patch);
    expect(SURVEY_STRUCTURE_PATCH_KEYS.has('json')).toBe(true);
  });

  it('rejects unknown keys before any HTTP call', () => {
    expect(() => assertSurveyStructurePatch({ foo: 1, name: 'x' })).toThrow(/Unsupported survey patch/);
    expect(() => assertSurveyStructurePatch({ foo: 1, name: 'x' })).toThrow(/foo/);
  });

  it('rejects empty patch', () => {
    expect(() => assertSurveyStructurePatch({})).toThrow(/at least one/);
  });

  it('accepts survey json at 100000 bytes and rejects a larger value', () => {
    expect(MAX_SURVEY_JSON_BYTES).toBe(100_000);
    const accepted = surveyJsonOfByteLength(MAX_SURVEY_JSON_BYTES);
    const rejected = surveyJsonOfByteLength(MAX_SURVEY_JSON_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(accepted), 'utf8')).toBe(100_000);
    expect(Buffer.byteLength(JSON.stringify(rejected), 'utf8')).toBe(100_001);

    expect(assertSurveyStructurePatch({ json: accepted })).toEqual({ json: accepted });
    expect(() => assertSurveyStructurePatch({ json: rejected })).toThrow(/at most 100000 bytes/);
  });

  it('accepts a survey name at 100000 bytes and rejects a larger value', () => {
    expect(MAX_SURVEY_NAME_BYTES).toBe(100_000);
    const accepted = 'n'.repeat(MAX_SURVEY_NAME_BYTES - 2);
    const rejected = 'n'.repeat(MAX_SURVEY_NAME_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(accepted), 'utf8')).toBe(100_000);
    expect(Buffer.byteLength(JSON.stringify(rejected), 'utf8')).toBe(100_001);

    expect(assertSurveyStructurePatch({ name: accepted })).toEqual({ name: accepted });
    expect(() => assertSurveyStructurePatch({ name: rejected })).toThrow(/Survey name must be at most 100000 bytes/);
  });

  it('accepts a survey id at 100000 bytes and rejects a larger value', () => {
    expect(MAX_SURVEY_ID_BYTES).toBe(100_000);
    const accepted = 'i'.repeat(MAX_SURVEY_ID_BYTES - 2);
    const rejected = 'i'.repeat(MAX_SURVEY_ID_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(accepted), 'utf8')).toBe(100_000);
    expect(Buffer.byteLength(JSON.stringify(rejected), 'utf8')).toBe(100_001);

    expect(assertSurveyStructurePatch({ id: accepted })).toEqual({ id: accepted });
    expect(() => assertSurveyStructurePatch({ id: rejected })).toThrow(/Survey id must be at most 100000 bytes/);
  });

  it('accepts a survey template uuid at 100000 bytes and rejects a larger value', () => {
    expect(MAX_SURVEY_TEMPLATE_UUID_BYTES).toBe(100_000);
    const accepted = 'u'.repeat(MAX_SURVEY_TEMPLATE_UUID_BYTES - 2);
    const rejected = 'u'.repeat(MAX_SURVEY_TEMPLATE_UUID_BYTES - 1);
    expect(Buffer.byteLength(JSON.stringify(accepted), 'utf8')).toBe(100_000);
    expect(Buffer.byteLength(JSON.stringify(rejected), 'utf8')).toBe(100_001);

    expect(assertSurveyStructurePatch({ survey_template_uuid: accepted })).toEqual({
      survey_template_uuid: accepted,
    });
    expect(() => assertSurveyStructurePatch({ survey_template_uuid: rejected })).toThrow(
      /Survey template uuid must be at most 100000 bytes/,
    );
  });
});
